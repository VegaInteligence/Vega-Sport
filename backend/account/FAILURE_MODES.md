# Accounts, stage 1: failure modes, edge cases and expected outcomes

> Résumé : pour le socle des comptes (VI-38), ce document fixe, **avant les tests et avant le
> code**, ce qui peut se tromper, les cas limites et le résultat attendu. Les tests cités en
> découlent. Rien ici ne crée de ressource Neon, AWS ou Stripe.

- **Status:** written on 23 Nov 2026, before the tests it names and before the code they cover.
  S12 to S14 were added on 24 Nov 2026, before their tests and before the change of the SQL file, when the
  preference contract was agreed with the home page work (VI-48).
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

## 4. Not covered by stage 1

- Applying `sql/001_accounts.sql` in a deployment: the account files are kept out of
  `backend/sql` (whose suites drop and rebuild the football schemas), so they need their own
  run and their own record of what was applied. Nothing is applied anywhere yet.

- Verifying a Neon Auth session and exchanging it for a pass.
- The account API's routes, their bounds and their rate limits.
- Stripe Checkout, the customer portal and the webhook.
- The CloudFront function that runs the gate, its key store and its deployment.
- Any screen: sign-in, account, locks, offers (a mock-up is validated first).
