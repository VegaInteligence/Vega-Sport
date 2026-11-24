# Accounts, stage 1: failure modes, edge cases and expected outcomes

> Résumé : pour le socle des comptes (VI-38), ce document fixe, **avant les tests et avant le
> code**, ce qui peut se tromper, les cas limites et le résultat attendu. Les tests cités en
> découlent. Rien ici ne crée de ressource Neon, AWS ou Stripe.

- **Status:** written on 23 Nov 2026, before the tests it names and before the code they cover.
  S12 to S14 were added on 24 Nov 2026, before their tests and before the change of the SQL file, when the
  preference contract was agreed with the home page work (VI-48).
  S15, S16 and sections 4 to 9 (stage 2a: the account API) were written on 24 Nov 2026, before
  their tests and before the code they cover; nothing of stage 2a is deployed or applied.
- **Scope of stage 1:** the access levels, the signed pass that carries a level, the decision
  taken on a request before the cache, and the account tables with their database role. The
  sign-in itself (Neon Auth), the account API's HTTP routes, Stripe and every screen come later
  and get their own section here before their tests.
- **Language:** English, because this is the test contract shared with reviewers.

## 0. Terms

| Term | Meaning |
|---|---|
| Level | 0 visitor, 1 free account, 2 Plus, 3 Pro. Hierarchical: a level holds every right of the levels below. |
| Pass | A short-lived signed token issued by the account API. It carries an account id and a level, nothing else about the person. |
| Minimum level of a read | The lowest level allowed to receive it. A read that names none is public (0). |
| Gate | The decision taken on every request at the entry of the CDN, before the shared cache is consulted. |
| Reserved read | A read whose minimum level is 2 or 3. Its answer is the same for every allowed account, so it is cached once and shared. |
| Personal read | An answer that depends on one account (its lists, its plan). It is never stored in a shared cache. |

## 1. The pass (`src/pass.mjs`, `test/pass.test.mjs`)

The pass is a compact JWS (`header.payload.signature`, base64url, HMAC-SHA256). The header names
the key (`kid`); the payload is `{ sub, lvl, iat, exp }`.

| # | What can go wrong | Expected outcome |
|---|---|---|
| P1 | A payload is altered after signing (level raised from 1 to 3). | Verification fails: `signature`. |
| P2 | A pass signed with a key the verifier does not hold. | Fails: `key`. |
| P3 | A pass whose header announces another algorithm (`none`, `HS512`, `RS256`), with or without a signature. | Fails: `header`. The algorithm is fixed by the verifier, never read from the token. |
| P4 | A pass past its expiry. | Fails: `expired`. The expiry second itself is already expired. |
| P5 | A pass whose `iat` is in the future beyond the tolerated clock difference (60 s). | Fails: `not-yet`. |
| P6 | A pass whose lifetime (`exp - iat`) exceeds the maximum (900 s), even correctly signed. | Fails: `lifetime`. A leaked signing call cannot mint a long-lived pass. |
| P7 | A level that is not an integer from 1 to 3 (0, 4, "3", 2.5, missing). | Signing refuses it; verification fails: `claims`. A visitor never holds a pass. |
| P8 | A missing, empty or malformed account id (not `[A-Za-z0-9_-]{1,64}`). | Signing refuses it; verification fails: `claims`. |
| P9 | Not three segments, a segment that is not base64url, a payload that is not a JSON object, a token longer than 1024 characters. | Fails: `format`, before any signature is computed. |
| P10 | Key rotation: two keys are held, the pass is signed with the older one. | Verifies. Signing always uses the key named current. |
| P11 | A signing key shorter than 32 bytes. | Signing and verification refuse to start. |
| P12 | Signature comparison leaks timing. | Signatures are compared in constant time. |
| P13 | Extra claims in the payload (an e-mail, a name). | Signing only writes `sub`, `lvl`, `iat`, `exp`; verification returns only these. |

## 2. The gate (`src/gate.mjs`, `test/gate.test.mjs`)

The gate takes a request (method, path, `X-Vega-Pass` header), the table of minimum levels, the
keys and the time. It answers one of: let through, refuse `401` (no valid pass where one is
required), refuse `403` (valid pass, level too low), or answer a CORS preflight.

| # | What can go wrong | Expected outcome |
|---|---|---|
| G1 | A public read asked without a pass. | Let through unchanged. Today's site keeps working. |
| G2 | A public read asked with an invalid, expired or forged pass. | Let through as a visitor: a stale pass in a browser must not break public pages. The pass is not forwarded. |
| G3 | A reserved read asked without a pass. | `401`, code `PASS_REQUIRED`, with the minimum level, `no-store`. The origin is not called. |
| G4 | A reserved read asked with an expired pass. | `401`, code `PASS_EXPIRED`: the site renews the pass and asks again. |
| G5 | A reserved read asked with any other invalid pass. | `401`, code `PASS_INVALID`. The reason of the failure is not disclosed. |
| G6 | A level-2 read asked with a level-1 pass. | `403`, code `LEVEL_REQUIRED`, with the minimum level. |
| G7 | A level-2 read asked with a level-3 pass. | Let through (hierarchy). |
| G8 | The pass reaches the origin or the cache key. | The pass travels in its own header, `X-Vega-Pass`, which is in no cache key and in no origin request policy. `Authorization` is never used: the CDN signs its requests to the origin with it. Pinned at deployment (stage 3), not by the gate's own tests. |
| G9 | A reserved path reached through a variant spelling: trailing slash, doubled slash, percent-encoded letters, upper case, `/./` or `/../` segments. | The path is normalised before the lookup (case, encoded letters, empty segments). A path with a dot segment, an encoded slash, backslash or percent sign, a control character or an invalid escape is refused `400`, as the origin refuses it. No variant of a reserved path is ever treated as public. |
| G10 | A new reserved read is forgotten in the table. | Not detectable by the gate: the table is the single list, and `test/gate.test.mjs` fails when a rule names a path prefix twice or with an unknown level. The route audit (VI-38) lists what must be in it. |
| G11 | A prefix rule and a longer, more specific rule both match. | The longest matching prefix decides. A rule matches whole path segments only (`/api/read/player` does not match `/api/read/players`). |
| G12 | The header does not hold exactly one token (empty, two tokens, a list), or the pass is sent in `Authorization`. | Treated as no pass. |
| G13 | A preflight (`OPTIONS`), which a browser sends before any read that carries a pass. | Answered by the gate for every path: `204`, allowed methods and headers (including `X-Vega-Pass`), `Access-Control-Max-Age`. No pass is required for a preflight and the origin is not called. |
| G14 | A refusal is stored by a shared cache and served to an entitled account. | Every refusal says `Cache-Control: no-store`. |
| G15 | A refusal cannot be read by the site because CORS headers are missing. | Every answer of the gate carries the API's CORS headers. |
| G16 | A method other than GET, HEAD or OPTIONS on a reserved read. | Let through to the origin, which refuses it (`405`) as today; the gate never widens what the origin accepts. A reserved read is never served to it because the level check applies to every method. |

## 3. The account tables (`sql/001_accounts.sql`, `test/schema.test.mjs`)

Identity lives at Neon Auth. The AWS database keeps, per Neon user id: the plan, the preferences,
the followed competitions and the lists. No e-mail, no name, no password, no IP address.

| # | What can go wrong | Expected outcome |
|---|---|---|
| S1 | The read API's role reads an account table. | `vega_read`, `vega_collect` and `vega_calc` have no privilege on schema `account`. |
| S2 | The account role reads or writes football data. | `vega_account` has no privilege on `core`, `agg`, `ops` or `api`. |
| S3 | An account is deleted (right to erasure). | Deleting the row of `account.accounts` removes every row that names it (cascade), in every account table. |
| S4 | A level outside 2 or 3 is stored for a subscription. | Refused by a check. An account without a live subscription is level 1, by absence. |
| S5 | A subscription whose period has ended still gives its level. | `account.level_of(account, at)` returns the highest level among subscriptions that are `active`, `trialing` or `past_due` and whose period ends after `at`; otherwise 1. An unknown account is 0. |
| S6 | Stripe sends the same event twice, or an older event after a newer one. | The event id is recorded once (`account.stripe_events`); a subscription row is only replaced by an event at least as recent as the one that wrote it. |
| S7 | Two accounts claim the same Stripe customer or subscription. | Refused by a unique constraint. |
| S8 | The same entity is added twice to a list, or followed twice. | One row (primary key); the second write changes nothing. |
| S9 | An identifier that is not a public Vega id (`p_`, `t_`, `m_`, `l_` followed by the id) is stored. | Refused by a check on the kind and the shape of the id. No foreign key to football tables: a purge or a re-identification there never blocks or deletes a person's lists. |
| S10 | Unbounded growth: thousands of lists or entries for one account. | Bounded by the account API (stage 2) and by a check on positions; the bounds are those the site already applies locally. |
| S11 | Preferences that the site does not know (free text, JSON). | Typed columns only, each with a check; no JSON column (repository rule). |
| S12 | The chosen country is kept in another form than the site's (ISO-2 here, the base's three-letter code in the browser), so a synchronised choice is lost or names another country. | `preferences.country` holds what `homeCountry` holds in the browser: the base's three-letter code (`FRA`, `ENG`, `BRA`) or `none` (« Aucun pays », a choice in itself). NULL means no choice was made, and the detected country applies. A two-letter code is refused. |
| S13 | The home priority (« privilégier la localisation ou l'importance du match ») holds a value the site does not know. | `preferences.home_priority` is `location` or `importance`. NULL means the value fixed in the site's code (`home-priority.js`) applies; the account stores a value only once the person chose one. |
| S14 | Favourite clubs and players are kept twice (as follows and as list entries) and drift apart. | One source: the favourites are the clubs and players of the lists, as in the browser (`statarena.research.v1`). `follows` holds competitions and national teams only; a followed club, player or match is refused there. |

| S15 | The order of the followed competitions is lost: `follows` has no position, so a contract written as `[l_b, l_a]` is read back `[l_a, l_b]`. | `sql/002_account_api.sql` adds `follows.position` (0 to 199, the bound of the contract). A contract is read back in the order it was written. |
| S16 | An erased account is brought back: a Neon session stays valid up to 15 minutes after the person is deleted at Neon, and verification is offline, so a second device's next save would create the account again and store preferences after the erasure. | `account.erasures` keeps the erased account id (and the instant), nothing else, and has no foreign key: it outlives the account row. Every store command refuses an erased id (`ACCOUNT_ERASED`), except the erasure itself, which can be repeated. |

The files of `sql/` are applied in the order of their names, each once (`DEPLOYMENT.md`); a file
that was applied somewhere is never edited again. On 24 Nov 2026 none was applied anywhere.

## 4. The Neon session (`src/session.mjs`, `test/session.test.mjs`)

The site sends the person's Neon Auth token in the header `X-Vega-Session`: a JWT signed by
Neon (EdDSA, Ed25519), 15 minutes long, no custom claim. The front verifies it offline with
`jose`; Neon is asked only for its key set (`<auth URL>/.well-known/jwks.json`). `iss` and `aud`
are both the origin of the auth URL. The account id is the token's `sub`, nothing else is read
from it (no e-mail, no name). Times are whole seconds; the clock is injected.

| # | What can go wrong | Expected outcome |
|---|---|---|
| N1 | No `X-Vega-Session` header, or an empty one. | `missing`. The front answers `401 SESSION_REQUIRED`. |
| N2 | Not a compact JWS (not three base64url segments, a comma from two joined headers, a `Bearer ` prefix), or longer than 8192 characters. | `format`, before any key is looked up. |
| N3 | A header that announces another algorithm (`none`, `HS256` signed with the public key as secret, `RS256`, `ES256`). | `header`. Only `EdDSA` is accepted, fixed by the verifier. |
| N4 | A header without `kid`. | `header`: the key is never guessed. (Better Auth names its key; unverified against a real Neon token.) |
| N5 | A token signed by a key Neon does not publish. | `key` after one refetch of the key set; `signature` when the `kid` is Neon's but the signature is not. |
| N6 | A payload altered after signing (another `sub`). | `signature`. |
| N7 | `iss` or `aud` is another origin (another Neon branch, preview auth, a path or a trailing slash added). | `claims`. Exact origin comparison; `aud` may be a list that holds the origin. |
| N8 | Expired token (`exp` at or before now, beyond the tolerated clock difference of 60 s). | `expired`. The front answers `401 SESSION_EXPIRED`: the site asks Neon for a fresh token and tries again. |
| N9 | `iat` or `nbf` in the future beyond 60 s. | `not-yet`. |
| N10 | Missing `sub`, `exp` or `iat`, or a `sub` outside `[A-Za-z0-9_-]{1,64}` (the shape `account.accounts` accepts). | `claims`. Neon's id format (uuid) is not documented; a uuid fits. |
| N11 | Neon rotates its key: a token names a `kid` that the copy has not seen. | The key set is fetched again at once and the token verifies. The key is never pinned in the deployment. |
| N12 | A flood of tokens with random `kid`s makes the front fetch the key set at each request. | At most one fetch per 30 s per copy for unknown `kid`s; within that time an unknown `kid` is `key`. Concurrent requests share one fetch in flight. |
| N13 | A key Neon removed from its set stays accepted. | The set is kept 10 minutes, then fetched again on the next verification; a removed key is refused from then on. |
| N14 | Neon's key set cannot be fetched (network, timeout of 3 s, not 200, not JSON, more than 64 KiB, no `keys` list). | With a known `kid` in a set fetched less than one hour ago: the stale set is used and the fetch is tried again after 30 s. Otherwise `unavailable`: the front answers `503 AUTH_UNAVAILABLE` with `Retry-After`, never a 401, so the site does not sign the person out. |
| N15 | A key in the set that is not an Ed25519 signing key (RSA, P-256, `use: enc`, `alg` other than EdDSA, no `kid`). | Ignored; the other keys are used. |
| N16 | The verifier returns claims the account API should not keep (e-mail, name, image). | It returns `{ accountId, expiresAt }` only. |
| N17 | The auth URL is not https, has a query or a fragment. | The verifier refuses to start. |

## 5. The preference contract (`src/contract.mjs`, `test/contract.test.mjs`)

The JSON the site's module (`dashboard/frontend/src/services/user-preferences.js`, written by
the home page work) reads and writes. Its key names are **provisional**: the whole mapping between
the JSON and the tables is the `FIELDS` table and the `STRUCTURES` of `src/contract.mjs`, so
aligning a name is one line there and its test. Version 1:

```
{ v: 1,
  focus: "europe" | "all", theme: "light" | "dark" | null, country: "FRA" | "none" | null,
  homePriority: "location" | "importance" | null, preferredCompetition: "l_…" | null,
  onboardingComplete: boolean,
  leagues: ["l_…"],                                          // follows, kind competition, in order
  lists: [{ id, name, entries: [{ kind: "players" | "clubs" | "matches", id, season? }] }],
  favourites: { clubs: ["t_…"], players: ["p_…"] } }        // computed on read, ignored on write
```

| # | What can go wrong | Expected outcome |
|---|---|---|
| C1 | The body is not a JSON object (an array, `null`, a string). | Refused, `CONTRACT_INVALID`. |
| C2 | `v` missing, or another version (0, 2, `"1"`). | Refused, `CONTRACT_VERSION`. A version 2 is never stored as if it were 1. |
| C3 | A key the contract does not know, at any level (top, list, entry, favourites). | Refused, `CONTRACT_INVALID`, the path of the key in the message. Never stored, never dropped silently. |
| C4 | A simple preference with a value its column refuses (`focus: "world"`, `country: "FR"`, `theme: "blue"`, `homePriority: "both"`, `preferredCompetition: "t_1"`, `onboardingComplete: "yes"`). | Refused with its path, before the base: the checks of the contract mirror those of `sql/001_accounts.sql`, so a bad value is a 400, never a database error (500). |
| C5 | A simple preference absent or `null`. | No value: `null`, or the column's default (`focus` europe, `onboardingComplete` false). Read back with every key present. |
| C6 | `leagues` holds a non-competition id, a duplicate, or more than 200 ids. | Refused (`CONTRACT_INVALID` / `CONTRACT_LIMIT`). |
| C7 | A list without `id` or `name`, an `id` outside `[A-Za-z0-9_-]{1,80}`, a `name` empty, longer than 60 characters or holding a control character (PostgreSQL refuses a NUL byte in text). | Refused with its path. Characters are counted as code points, as `char_length` counts them. |
| C8 | Two lists with the same `id` in one contract. | Refused: which one is meant cannot be known. |
| C9 | An entry whose `kind` is not players, clubs or matches, whose `id` does not match its kind (`p_`, `t_`, `m_` followed by 1 to 24 letters or digits), whose `season` is not `2025` or `2025/2026`. | Refused with its path. A `nations` entry, which the browser's lists can hold today, is refused too (see section 10). |
| C10 | The same (kind, id) twice in one list. | Kept once, at its first place, with its first season. The site's lists never mean two copies, and refusing would block the whole synchronisation for a harmless repeat. |
| C11 | More than 50 lists, more than 5000 entries in a list, or more than 20000 entries in all. | Refused, `CONTRACT_LIMIT`, nothing stored. The 20000 bound keeps an account's export and every store call under the 6 MB of a Lambda payload (an exported entry is about 120 bytes). |
| C12 | `favourites` written by the site differs from its lists. | Ignored on write (it must be an object of the two known keys if present); on read it is computed from the lists: every club and every player of the lists, in list order then entry order, each once. |
| C13 | What is written is not what is read back (order, missing keys, a season dropped). | `fromRows(toRows(c))` equals the normalised `c`: lists and entries in their order, leagues in their order, `season` present only when set. |

## 6. The merge at the first sign-in (`src/contract.mjs` `merge`, `test/contract.test.mjs`)

When a person signs in on a device that already holds preferences (the browser's), the site sends
them once to `POST /account/preferences/merge`. The store merges them with what the account holds,
**in the same transaction** as the write, so two devices merging at once cannot lose each other's
lists. A separate route rather than a flag on `PUT`: `PUT` keeps one meaning (replace), and a merge
is visible as such in the logs. The merge is a pure function of (account, browser).

| # | What can go wrong | Expected outcome |
|---|---|---|
| M1 | The account has never saved preferences. | The browser's contract is stored as it is. |
| M2 | A simple preference set on both sides. | The account's value wins. `country: "none"` is a value (a choice), not an absence. |
| M3 | A simple preference set on the browser only (`null` on the account). | The browser's value is taken. |
| M4 | `focus`: the column always holds a value once the account saved, so the account's wins. | As M2. Documented: a focus left at its default on the account is not told from a chosen one. |
| M5 | `onboardingComplete`. | True when either side is true: completed once is completed. |
| M6 | `leagues`. | A field: the account's list when it is not empty, else the browser's. |
| M7 | Lists with the same `id` on both sides. | One list: the account's name; its entries, then the browser's entries it lacks (by kind and id), in their order. An entry on both sides keeps the account's season. |
| M8 | A list on one side only. | Kept. The account's lists first in their order, then the browser's new lists in theirs. |
| M9 | The union exceeds a bound (C11). | Refused, `CONTRACT_LIMIT`, nothing changed on the account. The site keeps the account's preferences. |
| M10 | The same merge sent twice (a retry after a lost answer). | The second changes nothing: the result is the same contract. |
| M11 | The browser's contract is invalid. | Refused before any read of the account (C1 to C11). |

## 7. The store (`src/store.mjs`, `test/store.test.mjs`)

The only code with a database connection (login `vega_v2_account`, group `vega_account`, one
connection per copy). It takes typed commands, `{ command, accountId, ... }`, and answers
`{ ok: true, value }` or `{ ok: false, code, message }`. The front reaches it through one seam,
`createStoreClient(invoke)`: in production `invoke` is the Lambda Invoke API, in tests an
in-process call of the same store handler; both carry the command as JSON text, so everything
above the seam runs the same code. Commands: `session`, `getPreferences`, `putPreferences`,
`mergePreferences`, `export`, `erase`.

| # | What can go wrong | Expected outcome |
|---|---|---|
| D1 | A command the store does not know, a missing or malformed `accountId`, extra fields. | `{ ok: false, code: "INVALID_COMMAND" }`; no statement runs. |
| D2 | A contract that fails C1 to C11 reaches the store (the front is the only caller, but the store is the last check before the base). | Refused with the same code as the front's; nothing written. |
| D3 | First session of an account. | The row is created (`created: true`); `last_seen_on` is today; the level is `account.level_of`, 1 for a new account. |
| D4 | Later session the same day, or on a later day. | No new row; `last_seen_on` moves to today only when it was earlier (one write a day at most). |
| D5 | `getPreferences` for an account that never saved, or that does not exist. | `null`. No row is created by a read. |
| D6 | `putPreferences` fails halfway (a bad entry deep in the lists, a lost connection). | One transaction: either everything of the contract is stored or nothing changed. |
| D7 | `putPreferences` drops a list, an entry or a league. | Its rows are deleted. Lists and entries that stay keep their `created_at` / `added_at` (rows are updated in place, keyed by `client_id` and by (kind, id)). Followed national teams, which the contract does not carry, are left alone. |
| D8 | `putPreferences` before any session. | The account row is created first: a write never fails on the foreign key. |
| D9 | Two writes for one account at the same time (two devices, a merge and a put). | Serialised by a transaction lock on the account: the last one wins whole, never a mix. |
| D10 | A command for an erased account (S16), including a session. | `ACCOUNT_ERASED`; nothing is created or written. |
| D11 | The store's payload, either way, exceeds the 6 MB of a synchronous invoke. | The store client refuses to send (`PAYLOAD_TOO_LARGE`) or to read beyond it, in both transports; C11 keeps a valid contract far below. |
| D12 | The store fails (an exception, a lost connection, Lambda throttles it at its reserved 8 copies). | The store client raises `StoreUnavailable`; the front answers `503 STORE_UNAVAILABLE` with `Retry-After`, no detail of the error. |
| D13 | The store runs with more than its role allows. | Tests run it as `vega_account` (`role` option of the pool), the production login's group: a statement that needs more fails in the tests. |

## 8. The front's HTTP behaviour (`src/front.mjs`, `test/front.test.mjs`)

A Lambda Function URL (payload 2.0) outside the VPC. Routes, all under `/account/`, all requiring
a valid Neon session except the preflight:

| Route | Answer |
|---|---|
| `POST /account/session` | `{ accountId, level, created, pass, passExpiresAt }`: the account row is ensured, `last_seen_on` updated, the pass (`src/pass.mjs`, 600 s) carries `account.level_of`. |
| `GET /account/preferences` | The contract, or JSON `null`. |
| `PUT /account/preferences` | Replaces with the body's contract; answers what is now stored. |
| `POST /account/preferences/merge` | Merges the body's contract into the account's (section 6); answers what is now stored. |
| `GET /account/export` | Everything the AWS side holds about the account (section 9). |
| `DELETE /account` | Section 9. |

| # | What can go wrong | Expected outcome |
|---|---|---|
| H1 | An event that is not a Function URL 2.0 event. | `400 INVALID_REQUEST`. |
| H2 | A path no route claims (`/account/`, `/account/preferences/`, `/account//session`, `/ACCOUNT/session`, `/account/preferences%2Fmerge`, `/api/read/x`). | `404 NOT_FOUND`. Exact paths only; no normalisation that could make two spellings of one route. |
| H3 | A known path with another method (`GET /account/session`, `POST /account/preferences`, `HEAD`). | `405 METHOD_NOT_ALLOWED` with `Allow`. |
| H4 | A query string. | `400 INVALID_REQUEST`: no route takes one. |
| H5 | Session failures (section 4). | `401 SESSION_REQUIRED`, `401 SESSION_EXPIRED`, `401 SESSION_INVALID` (the reason is logged, not told), `503 AUTH_UNAVAILABLE` with `Retry-After: 5`. The store is not called. |
| H6 | `PUT` or merge with another content type than `application/json` (a charset parameter allowed). | `415 UNSUPPORTED_MEDIA_TYPE`, checked after the session (an anonymous caller gets the 401 first and learns nothing of the routes' bodies); the store is not called. |
| H7 | A body over 1 MiB (after base64 decoding when the event says so), or a body that is not UTF-8 JSON. | `413 BODY_TOO_LARGE`, `400 INVALID_JSON`. The bound is checked before parsing. |
| H8 | A contract refused by section 5 or 6. | `400 CONTRACT_INVALID` / `400 CONTRACT_VERSION` with the path of the fault, `422 CONTRACT_LIMIT`. The store is not called for C1 to C11. |
| H9 | A request from a browser on another site. | CORS is never `*`. The allowed origins are an exact list from the environment (`VEGA_SITE_ORIGINS`); an answer to an allowed `Origin` carries `Access-Control-Allow-Origin: <that origin>` and `Vary: Origin`; a request whose `Origin` is not in the list is refused `403 ORIGIN_REFUSED` before the session is read. A request without `Origin` (a script, a server) is served: the token is its proof. |
| H10 | A preflight (`OPTIONS`) from an allowed origin. | `204`, `Access-Control-Allow-Methods: GET, PUT, POST, DELETE`, `Access-Control-Allow-Headers: X-Vega-Session, Content-Type`, `Access-Control-Max-Age: 600`, no session needed, the store not called. From any other origin, or without `Origin`: `403`, no CORS header. |
| H11 | A personal answer kept by a cache (a browser, a proxy, a future CDN behaviour). | Every answer, errors and preflights included, says `Cache-Control: no-store`. |
| H12 | An answer read as something else than JSON. | `Content-Type: application/json; charset=utf-8` and `X-Content-Type-Options: nosniff` on every answer with a body. |
| H13 | An error leaks internals (a SQL message, a stack, the store's error). | Errors are `{ ok: false, error: { code, message, retry } }` with the API's own codes; a store or code failure is `503 STORE_UNAVAILABLE` / `500 INTERNAL`, nothing more. |
| H14 | The log keeps personal data. | One line per request: method, route, status, duration, the refusal's reason. Never the token, the account id, an IP or a body. |
| H15 | The front is deployed without its configuration (auth URL, origins, pass keys, store). | Every request is answered `503 NOT_CONFIGURED` (no-store) and the cold start logs which setting is missing; nothing is half served. A `*` in the origins, an http origin other than localhost, or a pass key under 32 bytes is a configuration error. |
| H16 | An erased account (S16) calls any route. | `410 ACCOUNT_ERASED`, except `DELETE /account`, which can be repeated. |

## 9. Export and deletion (`test/account-api.e2e.test.mjs`)

| # | What can go wrong | Expected outcome |
|---|---|---|
| X1 | The export misses something the AWS side holds. | `GET /account/export` answers `{ format: "vega-account-export", v: 1, exportedAt, account: { accountId, createdAt, lastSeenOn, level }, preferences: <contract or null>, follows: [all kinds, with followedAt], lists: [with createdAt, updatedAt, entries with addedAt], stripe: { customer, subscriptions } }` and `Content-Disposition: attachment`. The end-to-end test compares it with every row of every account table for that id. Identity (e-mail, name) is held by Neon and is not in it; the answer says so (`identity`). |
| X2 | Export of an account the base does not hold yet. | `account: null`, empty lists: the person sees that nothing is held. |
| X3 | Deletion is asked with no Neon API key configured (the case until the owner creates it). | `503 DELETION_UNAVAILABLE`, **nothing erased**: the AWS rows stay whole, so the person can try again once deletion works. Failing closed beats an erasure that cannot finish. |
| X4 | The order of the two erasures. | AWS first (one transaction: tombstone, then the account row and its cascade), Neon second. The other order would leave rows that no one can ever erase again: once the Neon user is gone the person can no longer sign in to ask. |
| X5 | Neon refuses or fails after the AWS rows are gone (timeout of 5 s, 5xx, 423, 429, a wrong key). | `502 IDENTITY_DELETE_FAILED` with `erased: true` and `retry` (true for timeouts, 423, 429 and 5xx). The person can still sign in at Neon and repeat `DELETE /account`: the AWS step finds nothing and succeeds, the Neon call is made again. Meanwhile every other route answers `410` (S16). |
| X6 | Neon answers 404 on a retry (the first call deleted the user but its answer was lost). | Success: the user is gone. |
| X7 | A live subscription (active, trialing or past due, period not ended) exists. | `409 SUBSCRIPTION_ACTIVE`, nothing erased: deleting the rows would leave a person billed by Stripe with no account to cancel from. Cancelling first is the person's step (Stripe's portal, a later stage). |
| X8 | After a deletion, something of the account remains on AWS. | Zero rows for the id in every account table except `erasures`, which holds the id and the instant only. |
| X9 | A second device, with a still valid token, saves after the deletion. | `410 ACCOUNT_ERASED`, nothing stored (S16). |
| X10 | The whole path, as the site will drive it: sign in, read `null`, write, read back, a second device merges, export, delete, everything gone. | `test/account-api.e2e.test.mjs` runs it with Function URL events through the real front, the real store and a local PostgreSQL, a token signed by a key made in the test and served through an injected key-set fetcher, and a recorded Neon client. It writes `evidence.json` (setup, inputs, exact rerun command, expected and actual results, the front's log lines, the row counts before and after) to `VEGA_ACCOUNT_E2E_EVIDENCE` or, by default, `<tmp>/vega-account-e2e/<run>/`. |

## 10. Not covered yet

- A real Neon token: the claims and header Neon sets (`kid`, the `sub` format) are taken from
  Neon's documentation and Better Auth's source, not from a token (no Neon project exists yet).
- The Lambda Invoke API itself: the production transport is tested with a stand-in for the SDK's
  `send`; the SDK, IAM and throttling are only exercised once deployed.
- PostgreSQL 18 (production): the suites run on 16 locally; CI runs 18.
- Applying `sql/` in a deployment and its record of applied files (`DEPLOYMENT.md`).
- Entries of kind `nations` (`t_…`), which the browser's lists can hold today (`research-storage.js`):
  the agreed contract and `list_entries` know players, clubs and matches only. To settle with the
  site's module before it lands.
- Optimistic concurrency (`If-Match`) on `PUT`: the last writer wins whole (D9).
- Rate limits: a Function URL takes no web ACL; the front's reserved concurrency bounds it.
- Stripe Checkout, the customer portal and the webhook; the CloudFront function that runs the gate.
- Any screen: sign-in, account, locks, offers (a mock-up is validated first).
