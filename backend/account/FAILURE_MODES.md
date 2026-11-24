# Accounts, stage 1: failure modes, edge cases and expected outcomes

> Résumé : pour le socle des comptes (VI-38), ce document fixe, **avant les tests et avant le
> code**, ce qui peut se tromper, les cas limites et le résultat attendu. Les tests cités en
> découlent. Rien ici ne crée de ressource Neon, AWS ou Stripe.

- **Status:** written on 23 Nov 2026, before the tests it names and before the code they cover.
  S12 to S14 were added on 24 Nov 2026, before their tests and before the change of the SQL file, when the
  preference contract was agreed with the home page work (VI-48).
  S15, S16 and sections 4 to 9 (stage 2a: the account API) were written on 24 Nov 2026, before
  their tests and before the code they cover; nothing of stage 2a is deployed or applied.
  Later on 24 Nov 2026, when the site's contract landed (branch `claude/accueil-importance-pays`,
  ac08d79), the preferences became one document per account (coordinator's decision): S8 to S15
  and the old sections 5 and 6 were withdrawn, S17 and the new section 5 written, sections 7 to 9
  amended, all before their tests and code changed.
  Section 10 (the deployment wiring: `deploy.sh`, the shared templates, the run of `sql/` by
  `migrate.py`) was written on 24 Nov 2026, before its tests and before the shared files changed.
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
| S8 | ~~The same entity is added twice to a list, or followed twice.~~ | **Withdrawn 24 Nov 2026**: the typed tables of preferences, follows and lists are replaced by one document per account (S17). |
| S9 | ~~An identifier that is not a public Vega id (`p_`, `t_`, `m_`, `l_` followed by the id) is stored.~~ | **Withdrawn 24 Nov 2026**: the typed tables of preferences, follows and lists are replaced by one document per account (S17); the ids inside the document are the site's to check. |
| S10 | ~~Unbounded growth: thousands of lists or entries for one account.~~ | **Withdrawn 24 Nov 2026**: bounded now by the size of the document (S17) and by the site's own bounds. |
| S11 | ~~Preferences that the site does not know (free text, JSON).~~ | **Withdrawn 24 Nov 2026**: the preferences are the person's own document, written and validated by the site on every load; the rule « typed tables only » (README) is about source data. The base guarantees the owner, the version, the size and the atomicity of a write (S17); every other column stays typed and checked. |
| S12 | ~~The chosen country is kept in another form than the site's (ISO-2 here, the base's three-letter code in the browser), so a synchronised choice is lost or names another country.~~ | **Withdrawn 24 Nov 2026**: the country is a key of the document, checked by the site (`user-preferences.js`). |
| S13 | ~~The home priority (« privilégier la localisation ou l'importance du match ») holds a value the site does not know.~~ | **Withdrawn 24 Nov 2026**: the home priority is a key of the document, checked by the site. |
| S14 | ~~Favourite clubs and players are kept twice (as follows and as list entries) and drift apart.~~ | **Withdrawn 24 Nov 2026**: follows and lists are gone; the favourites are derived by the site from the document's lists (`favouritesOf`). |

| S15 | ~~The order of the followed competitions is lost: `follows` has no position, so a contract written as `[l_b, l_a]` is read back `[l_a, l_b]`.~~ | **Withdrawn 24 Nov 2026**: `account.follows` is gone; the order of `leagues` is the document's. |
| S16 | An erased account is brought back: a Neon session stays valid up to 15 minutes after the person is deleted at Neon, and verification is offline, so a second device's next save would create the account again and store preferences after the erasure. | `account.erasures` keeps the erased account id (and the instant), nothing else, and has no foreign key: it outlives the account row. Every store command refuses an erased id (`ACCOUNT_ERASED`), except the erasure itself, which can be repeated. |

| S17 | The preferences are lost, mixed between two writes, stored for no account, in another version, or grow without bound. | `account.preferences` holds one row per account: `document jsonb` (the site's contract as sent), `revision bigint` (1 at the first write, +1 at each), `updated_at`; it hangs from the account (cascade). Checks: the document is a JSON object, its `v` is 1, its text form is 3 MiB at most (a backstop: the API's bound is 2 MiB of compact JSON, and the text form of `jsonb` is at most 1.5 times longer); the revision is 1 or more. |

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

## 5. The preference document (`src/contract.mjs`, `test/contract.test.mjs`)

The site owns the shape of its contract (`dashboard/frontend/src/services/user-preferences.js`,
branch `claude/accueil-importance-pays`, ac08d79: `v, focus, theme, leagues, country, homePriority,
defaultSeason, onboarded, competition, lists, activeList, views, templates, comparison,
researchSettings`, with nested objects the research page owns). Its header says the account API
"stores it and returns it as-is". A second validator here would drift from the site's and refuse,
silently, what the site emits; so the server checks only what it must to store it safely.

| # | What can go wrong | Expected outcome |
|---|---|---|
| C1 | The body is not a JSON object (an array, `null`, a string, a number). | Refused, `400 CONTRACT_INVALID`. |
| C2 | `v` missing or not the number 1 (0, 2, `"1"`). | Refused, `422 CONTRACT_VERSION`. A version 2 is never stored as if it were 1. |
| C3 | The document, as compact JSON, is over 2 MiB. | Refused, `413 CONTRACT_LIMIT`, before the store is called. With the 4 MiB bound on the body (H7), every store call and every answer stays under the 6 MB of a Lambda payload. |
| C4 | Any other key, value or nesting (unknown keys, `nations` entries, `scope`, `settings`, `index`, empty strings, `null`s, unicode). | Accepted and stored as sent: no key list, no check per field. |
| C5 | A string the base cannot store in `jsonb` (`\u0000`, a lone surrogate escape such as `\ud800`): PostgreSQL would refuse it and the write would fail as a 500. | Refused, `400 CONTRACT_INVALID`, before the store; the store also maps the base's refusal (22P05) to the same code. |
| C6 | What is read back is not what was written. | Deep-equal after PUT then GET through the whole path (the site's complete example, nested objects, unicode names, empty strings, `null`s). Key order is not kept (`jsonb` orders keys) and does not matter; a key repeated in the body keeps its last value, as `JSON.parse` does. |

## 6. The merge at the first sign-in

**Withdrawn 24 Nov 2026** (M1 to M11): the merge of the browser's preferences with the account's
moves to the site's adapter (`{ load, save }`, VI-38 site side), which knows the contract. The
server stores what it is sent; `If-Match` (D14) lets the adapter merge without losing a write.

## 7. The store (`src/store.mjs`, `test/store.test.mjs`)

The only code with a database connection (login `vega_v2_account`, group `vega_account`, one
connection per copy). It takes typed commands, `{ command, accountId, ... }`, and answers
`{ ok: true, value }` or `{ ok: false, code, message }`. The front reaches it through one seam,
`createStoreClient(invoke)`: in production `invoke` is the Lambda Invoke API, in tests an
in-process call of the same store handler; both carry the command as JSON text, so everything
above the seam runs the same code. Commands: `session`, `getPreferences`, `putPreferences`
(`preferences`, optional `ifMatch`), `export`, `erase`.

| # | What can go wrong | Expected outcome |
|---|---|---|
| D1 | A command the store does not know, a missing or malformed `accountId`, extra fields, an `ifMatch` that is not a whole number of 1 or more. | `{ ok: false, code: "INVALID_COMMAND" }`; no statement runs. |
| D2 | A document that fails C1 to C3 or C5 reaches the store (the front is the only caller, but the store is the last check before the base). | Refused with the same code as the front's; nothing written. |
| D3 | First session of an account. | The row is created (`created: true`); `last_seen_on` is today; the level is `account.level_of`, 1 for a new account. |
| D4 | Later session the same day, or on a later day. | No new row; `last_seen_on` moves to today only when it was earlier (one write a day at most). |
| D5 | `getPreferences` for an account that never saved, or that does not exist. | `{ contract: null, revision: null }`. No row is created by a read. |
| D6 | `putPreferences` fails halfway. | One transaction: the account row and the document are written together or not at all. |
| D7 | The revision. | 1 at the first write, then +1 at each write, whatever the document; `updated_at` moves. |
| D8 | `putPreferences` before any session. | The account row is created first: a write never fails on the foreign key. |
| D9 | Two writes for one account at the same time (two devices). | Serialised by a transaction lock on the account: each gets its own revision, the last one's document is stored whole. |
| D10 | A command for an erased account (S16), including a session. | `ACCOUNT_ERASED`; nothing is created or written. |
| D11 | The store's payload, either way, exceeds the 6 MB of a synchronous invoke. | The store client refuses to send (`PAYLOAD_TOO_LARGE`) or to read beyond it, in both transports; C3 keeps a valid document far below. |
| D12 | The store fails (an exception, a lost connection, Lambda throttles it at its reserved 8 copies). | The store client raises `StoreUnavailable`; the front answers `503 STORE_UNAVAILABLE` with `Retry-After`, no detail of the error. |
| D13 | The store runs with more than its role allows. | Tests run it as `vega_account` (`role` option of the pool), the production login's group: a statement that needs more fails in the tests. |
| D14 | A write based on an old read overwrites a newer one (the site's adapter merges, another device saved meanwhile). | `ifMatch: n`: the document is written only if the stored revision is `n`, in one statement; otherwise `STALE` with the current revision (`null` when the account never saved) and nothing changes. Without `ifMatch` the last write wins. |

## 8. The front's HTTP behaviour (`src/front.mjs`, `test/front.test.mjs`)

A Lambda Function URL (payload 2.0) outside the VPC. Routes, all under `/account/`, all requiring
a valid Neon session except the preflight:

| Route | Answer |
|---|---|
| `POST /account/session` | `{ accountId, level, created, pass, passExpiresAt }`: the account row is ensured, `last_seen_on` updated, the pass (`src/pass.mjs`, 600 s) carries `account.level_of`. |
| `GET /account/preferences` | `{ contract, revision }`: the stored document as it was sent and its revision, both `null` when the account never saved. |
| `PUT /account/preferences` | Stores the body's document (section 5); answers `{ revision }`. Optional `If-Match: <revision>` (D14): `409 STALE` with `revision` (the current one) when it differs. |
| `GET /account/export` | Everything the AWS side holds about the account (section 9). |
| `DELETE /account` | Section 9. |

| # | What can go wrong | Expected outcome |
|---|---|---|
| H1 | An event that is not a Function URL 2.0 event. | `400 INVALID_REQUEST`. |
| H2 | A path no route claims (`/account/`, `/account/preferences/`, `/account//session`, `/ACCOUNT/session`, `/account/preferences/merge` (withdrawn with section 6), `/api/read/x`). | `404 NOT_FOUND`. Exact paths only; no normalisation that could make two spellings of one route. |
| H3 | A known path with another method (`GET /account/session`, `POST /account/preferences`, `HEAD`). | `405 METHOD_NOT_ALLOWED` with `Allow`. |
| H4 | A query string. | `400 INVALID_REQUEST`: no route takes one. |
| H5 | Session failures (section 4). | `401 SESSION_REQUIRED`, `401 SESSION_EXPIRED`, `401 SESSION_INVALID` (the reason is logged, not told), `503 AUTH_UNAVAILABLE` with `Retry-After: 5`. The store is not called. |
| H6 | `PUT` with another content type than `application/json` (a charset parameter allowed). | `415 UNSUPPORTED_MEDIA_TYPE`, checked after the session (an anonymous caller gets the 401 first and learns nothing of the routes' bodies); the store is not called. |
| H7 | A body over 4 MiB (after base64 decoding when the event says so; a Function URL takes 6 MB, and 4 MiB in base64 is 5.6 MB), or a body that is not UTF-8 JSON. | `413 BODY_TOO_LARGE`, `400 INVALID_JSON`. The bound is checked before parsing. |
| H8 | A document refused by section 5. | `400 CONTRACT_INVALID`, `422 CONTRACT_VERSION`, `413 CONTRACT_LIMIT`. The store is not called. |
| H17 | `If-Match` that is not a revision (`*`, `abc`, `0`, two values). | `400 INVALID_REQUEST`; the store is not called. `3` and `"3"` (an entity tag's quotes) are both the revision 3. |
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
| X1 | The export misses something the AWS side holds. | `GET /account/export` answers `{ format: "vega-account-export", v: 1, exportedAt, account: { accountId, createdAt, lastSeenOn, level }, preferences: { contract, revision, updatedAt } or null, stripe: { customer, subscriptions } }` and `Content-Disposition: attachment`. The end-to-end test compares it with every row of every account table for that id. Identity (e-mail, name) is held by Neon and is not in it; the answer says so (`identity`). |
| X2 | Export of an account the base does not hold yet. | `account: null`, `preferences: null`, no subscription: the person sees that nothing is held. |
| X3 | Deletion is asked with no Neon API key configured (the case until the owner creates it). | `503 DELETION_UNAVAILABLE`, **nothing erased**: the AWS rows stay whole, so the person can try again once deletion works. Failing closed beats an erasure that cannot finish. |
| X4 | The order of the two erasures. | AWS first (one transaction: tombstone, then the account row and its cascade), Neon second. The other order would leave rows that no one can ever erase again: once the Neon user is gone the person can no longer sign in to ask. |
| X5 | Neon refuses or fails after the AWS rows are gone (timeout of 5 s, 5xx, 423, 429, a wrong key). | `502 IDENTITY_DELETE_FAILED` with `erased: true` and `retry` (true for timeouts, 423, 429 and 5xx). The person can still sign in at Neon and repeat `DELETE /account`: the AWS step finds nothing and succeeds, the Neon call is made again. Meanwhile every other route answers `410` (S16). |
| X6 | Neon answers 404 on a retry (the first call deleted the user but its answer was lost). | Success: the user is gone. |
| X7 | A live subscription (active, trialing or past due, period not ended) exists. | `409 SUBSCRIPTION_ACTIVE`, nothing erased: deleting the rows would leave a person billed by Stripe with no account to cancel from. Cancelling first is the person's step (Stripe's portal, a later stage). |
| X8 | After a deletion, something of the account remains on AWS. | Zero rows for the id in every account table except `erasures`, which holds the id and the instant only. |
| X9 | A second device, with a still valid token, saves after the deletion. | `410 ACCOUNT_ERASED`, nothing stored (S16). |
| X10 | The whole path, as the site will drive it: sign in, read `null`, write the site's complete example, read it back deep-equal, a second device writes with a stale `If-Match` and is refused, then with the current one, export, delete, everything gone. | `test/account-api.e2e.test.mjs` runs it with Function URL events through the real front, the real store and a local PostgreSQL, a token signed by a key made in the test and served through an injected key-set fetcher, and a recorded Neon client. It writes `evidence.json` (setup, inputs, exact rerun command, expected and actual results, the front's log lines, the row counts before and after) to `VEGA_ACCOUNT_E2E_EVIDENCE` or, by default, `<tmp>/vega-account-e2e/<run>/`. |

## 10. The deployment wiring (`infra/aws/deploy.sh`, `backend/vega/migrate.py`)

Tests: `backend/tests/test_account_deploy.py` (the real `deploy.sh` and `ci/secrets.sh`, run
offline with a stand-in `aws`, `npm` and `python3` on `PATH`, in every state below),
`backend/tests/test_account_migrations.py` (the real `python -m vega.migrate` on a local
PostgreSQL, `VEGA_V2_ACCOUNT_MIGRATE_TEST_DSN`), `backend/tests/test_account_capacity.py`; the
package checks run in CI (`ci.yml`, job « Read API package »).

The Deploy workflow is run several times a day by two people for other work, and the owner's
manual steps (`DEPLOYMENT.md`, section 3) come in his own time. One switch decides everything:
the SSM parameter **`/vega/v2/account-deploy`** (String), which the owner creates last, with
the value `on`. It is a parameter of its own rather than `/vega/v2/neon-auth-url`: the auth URL is
the first value the owner holds, and once the switch is on a missing prerequisite fails every
Deploy (W5); with a switch of its own the values can be written in any order, checked, and the
account turned on in one last step, or paused (`off`) without losing them.

| # | What can go wrong | Expected outcome |
|---|---|---|
| W1 | The switch is absent (the case until the owner's last step). | The Deploy does exactly what it did before this change: the same stacks with the same parameter overrides, the same task, the same uploads, the same SSM parameters written (none of the account's). One line says so: `account: off (no SSM parameter /vega/v2/account-deploy): the account API is not deployed (backend/account/DEPLOYMENT.md, section 3)`. |
| W2 | The switch is `off`. | As W1, the line saying `off`. Resources an earlier `on` Deploy made stay as they are (W11): the database's security group, the migrate task's password, the account stack (not updated), the base's account tables. Turning off never deletes. |
| W3 | The switch holds another value (`On`, `true`, a typo). | The preflight fails naming the parameter and the two values allowed. Nothing is changed. |
| W4 | The switch is `on` and the stack `vega-v2-deploy-roles` was not updated from the Mac (its output `AccountGrants` is not `2`: absent, or `1`, the grants of 24 Nov that lack W14's). | The preflight fails naming the stack and the command of `DEPLOYMENT.md`, section 3. Nothing is changed. (Without the check: the security group and the migrate task change, then the upload to `releases/v2-account/` is refused to the deploy role, or the account stack's creation is refused to the CloudFormation role and rolls back.) |
| W5 | The switch is `on` and a value the owner writes is missing or malformed: `/vega/v2/neon-auth-url`, `/vega/v2/neon-project-id`, `/vega/v2/neon-branch-id`, `/vega/v2/site-origins` (String each; the patterns are `account.yaml`'s `AllowedPattern`, whole-value). | The preflight fails and names every one that is wrong in the same run. Nothing is changed. |
| W6 | `/vega/v2/neon-api-key` (SecureString) is absent. | Not an error: the stack gets an empty `NeonApiKey` and one line says that `DELETE /account` answers 503 `DELETION_UNAVAILABLE` (X3). Present but not one word of 16 to 512 printable characters: the preflight fails naming it. |
| W7 | The generated secrets are absent: `/vega/v2/password-account`, `/vega/v2/account-database-url`, `/vega/v2/pass-key/k1`. | Created by step 2 (`ci/secrets.sh`) when the switch is `on`, never when it is not; values through mode-0600 files, as the other secrets. The pass key is 32 random bytes in base64url (43 characters). Present but malformed (the URL not of `account.yaml`'s pattern, a pass key that is not 43 or more base64url characters): the preflight fails naming it. |
| W8 | The stack `vega-v2-account` is in a state CloudFormation cannot update: `ROLLBACK_COMPLETE` (a first creation that failed), any `*_FAILED`, any `*_IN_PROGRESS`. | The preflight fails naming the state and the recovery: the deploy role cannot delete a stack, so the owner deletes it from the Mac (`ROLLBACK_COMPLETE`), or runs `continue-update-rollback` (`UPDATE_ROLLBACK_FAILED`). Nothing is changed. |
| W9 | A preflight failure blocks the colleague's Deploy too. | Every preflight message ends with how to deploy without the account: set `/vega/v2/account-deploy` to `off`. |
| W10 | The steps run in the wrong order. | With the switch `on`: the database stack (security group `AccountSG`) at step 1; the secrets at step 2; the worker stack at step 3, whose migrate task then names `/vega/v2/password-account` (it exists since step 2: a task naming a missing parameter does not start); the migrate task at step 5 (the account SQL, then the login); the account stack last, at step 11, after the alerts: it imports the security group and its store connects as the login, and its failure leaves everything else deployed (the run still fails: no `done`). |
| W11 | A shared template's new resource or secret exists before the switch. | `database.yaml` (security group, its two rules, its export), `worker.yaml` (the migrate task's `V2_ACCOUNT_PASSWORD`) and `alerts.yaml` (the connections threshold counts the account's 18) take a parameter `Account`, `false` by default. `deploy.sh` passes `Account=true` when `on`, and nothing otherwise, so a stack keeps its previous value: a later `off` Deploy never removes the security group the account stack imports (the database stack's update would fail: an export in use) nor the migrate task's password. |
| W12 | A secret reaches a log, a command line or CloudFormation's events. | Never printed by `deploy.sh` or `secrets.sh`. The database URL, the pass key and the Neon key reach the stack as `NoEcho` parameters on the command line, as the read API's URL does (`api.yaml`): visible to `ps` on the runner only, masked in the workflow's log with `::add-mask::`, `****` in CloudFormation's events. The password reaches the migrate task as an ECS secret. |
| W13 | A package is built from the wrong entry, or the store's without its CA. | The offline check of each kind fails the build: `account-front` answers a request `503 NOT_CONFIGURED` (not 404: without settings it serves nothing), `account-store` answers a command `{ ok: false, code: 'NOT_CONFIGURED' }` and holds `rds-ca.pem`; `api` and `live` keep their 404 check. |
| W14 | The CloudFormation role may not create the account's security group. EC2 authorizes `ec2:CreateSecurityGroup` on two resources, the group and the VPC, and sets the condition key `ec2:Vpc` for neither: the statement `SecurityGroups` (any resource, `ec2:Vpc` equal to the VPC) allows neither, `SecurityGroupCreate` allowed the group alone. Seen on Deploy 132 (24 Nov 2026), the first with the switch `on`: `AccountSG` `CREATE_FAILED`, « not authorized to perform: ec2:CreateSecurityGroup on resource: …:vpc/vpc-08e400afa07fc1812 », the database stack rolled back to its state (`UPDATE_ROLLBACK_COMPLETE`) and the Deploy stopped at step 1, nothing else changed. | `deploy-roles.yaml`'s `SecurityGroupCreate` names both resources: `security-group/*` and the VPC of `database.yaml`'s groups (one VPC id in both files). The output `AccountGrants` becomes `2` and the preflight asks for `2` (W4): a roles stack that holds the first grants only is refused before step 1, with the owner's command, instead of failing every Deploy at step 1. |
| M1 | The runner of `sql/` runs where it should not (any football suite, today's migrate task). | It runs only when `V2_ACCOUNT_PASSWORD` is set, the only way the login is asked for (it joins the group `vega_account` that `001` creates). Without it nothing of `account` or `account_admin` is read or touched, and the output line is as before (`migrations applied=… total=… logins=…`). |
| M2 | The files are applied partly, twice, or out of order. | After the football `migrate()`, before `ensure_logins()`: the files `NNN_name.sql` of `sql/`, by name; each one not recorded runs in its own transaction with the insert of its record (`account_admin.applied`: name, sha256 of its bytes, instant). The line gains `account applied=N total=M`. |
| M3 | A second run changes something. | `account applied=0`, the records unchanged; the login's password and limit set again (`ALTER ROLE`). |
| M4 | A file applied once is edited. | The run stops with an error naming the file (`ACCOUNT_SQL_CHANGED 001_accounts.sql`); no later file runs; the task exits non-zero, which stops the Deploy at step 5 before the account stack. |
| M5 | A file fails midway. | Its transaction rolls back: nothing of it and no record; the files before it stay recorded; exit non-zero. Once fixed, the next run applies it. |
| M6 | Two migrate tasks run at once. | Each transaction takes `pg_advisory_xact_lock(hashtext('vega-account-migrations'))` before it reads the record: each file is applied once, the other run finds it recorded. |
| M7 | The password is set but the image holds no `account/sql` (or an empty one). | The task fails before any migration, naming the directory. |
| M8 | The record is read or changed by a login. | `account_admin` belongs to the owner, is not in schema `account`, and grants nothing to anyone (`PUBLIC`, `vega_account`, `vega_read`, `vega_collect`, `vega_calc`). |
| M9 | A football suite's rebuild (`DROP SCHEMA … api,ops,agg,core CASCADE`, then the migrations) takes a person's data with it. | `account` and `account_admin` and their rows survive it; no football schema depends on them; no Python suite drops either schema. |
| M10 | The store's copies hold more connections than the login allows, or the logins more than the instance. | `vega_v2_account` has the limit 2 × 8 + 2 = 18 (8 copies of the store, `ReservedConcurrentExecutions` in `account.yaml`, one connection each, `max: 1` in `lambda/store-index.mjs`; two generations during a deploy; a margin of 2), and a copy gives its idle connection back within 2 minutes. The four logins together hold 96, under 200. |

## 11. Not covered yet

- A real Neon token: the claims and header Neon sets (`kid`, the `sub` format) are taken from
  Neon's documentation and Better Auth's source, not from a token (no Neon project exists yet).
- The Lambda Invoke API itself: the production transport is tested with a stand-in for the SDK's
  `send`; the SDK, IAM and throttling are only exercised once deployed.
- PostgreSQL 18 (production): the suites run on 16 locally; CI runs 18.
- A real Deploy with the switch on: section 10 is exercised offline (a stand-in `aws`) and on a
  local PostgreSQL, never against AWS.
- The meaning of the document's keys: the site's (`user-preferences.js`, `validateContract`), on every load.
- The merge at the first sign-in: the site's adapter (section 6).
- Rate limits: a Function URL takes no web ACL; the front's reserved concurrency bounds it.
- Stripe Checkout, the customer portal and the webhook; the CloudFront function that runs the gate.
- Any screen: sign-in, account, locks, offers (a mock-up is validated first).
