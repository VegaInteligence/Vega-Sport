# Comptes, côté site (VI-38)

> Résumé : la connexion (Neon Auth, `@neon/auth`), l'état connecté, la route `/api/account/*` qui relaie
> l'API de compte, l'adaptateur de synchronisation des préférences, les pages `/connexion` et `/compte` et
> l'entrée de l'en-tête. Ce document fixe les modes de défaillance et le résultat attendu de chacun ; les
> tests (`tests/account-*.test.mjs`, `tests/e2e/accounts/`) ont été écrits d'après lui, avant le code.

Contract and seam: [PREFERENCES_UTILISATEUR.md](PREFERENCES_UTILISATEUR.md). Account API:
`backend/account/src/front.mjs`, `backend/account/FAILURE_MODES.md` sections 8 and 9.

## Pieces

| Piece | File | Role |
| --- | --- | --- |
| Switch | `src/services/account-switch.js` | `accountFeatures(env)`: `{ auth, sync }` from the environment; `accountsOn()`, `accountSyncOn()`: the same, frozen into the bundle at build time by `next.config.mjs`. |
| Neon server | `src/server/neon-auth.js` | `createNeonAuth` once, or null when the switch is off. |
| Auth route | `app/api/auth/[...path]/route.js` | Neon's handler (`auth.handler()`); 404 when off. |
| Account route | `app/api/account/[[...path]]/route.js`, `src/server/account-proxy.js` | Same-origin relay of the five account routes, the Neon JWT added server-side. |
| Merge | `src/services/account-merge.js` | First sign-in merge, three-way merge after a 409. |
| Adapter | `src/services/account-sync.js` | `{ load, save, report }` for `setPreferencesSync`, the client of `/api/account`, the first-merge marker. |
| State | `src/services/account-state.js`, `src/hooks/useAccount.js` | The signed-in state, read anywhere (no provider needed), and the sync status. |
| Screens | `src/views/SignInPage.jsx`, `src/views/AccountPage.jsx` (`src/components/AccountLetter.jsx`, `AccountParts.jsx`, `src/services/account-page.js`), `src/components/AccountEntry.jsx`, `src/components/AccountSync.jsx` | `/connexion`, `/compte`, the header entry and its menu, the adapter's mounting point (beside `PreferencesSync`). |

Environment, server side only: `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (32 characters or more),
`ACCOUNT_API_ORIGIN` (the account front's Function URL origin, no path). The browser never sees them; it gets
two booleans at build time.

## 1. The switch (`tests/account-switch.test.mjs`)

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| W1 | The site deploys to production with no Neon settings and shows a broken sign-in. | `NEON_AUTH_BASE_URL` or `NEON_AUTH_COOKIE_SECRET` absent, empty, not a URL, not https (http is accepted for 127.0.0.1 / localhost only), with a query or fragment, or a secret under 32 characters: `auth` is false. No « Se connecter » entry, `/connexion` and `/compte` answer the 404 page (not in `routeExists`, `notFound()`), `/api/auth/*` and `/api/account/*` answer 404, and the client bundle never requests `/api/auth` (the Neon client is imported lazily behind the build-time flag). |
| W2 | Neon is set but the account API is not deployed yet. | `auth` true, `sync` false: sign-in works; `/api/account/*` answers `503 SYNC_UNAVAILABLE` without calling anything; no adapter is set, so preferences stay in the browser exactly as today; `/compte` says « Synchronisation : indisponible ». Signing out does not empty the stores (they were never the account's). |
| W3 | `ACCOUNT_API_ORIGIN` is a URL with a path, a query, credentials, plain http on a public host, or garbage. | `sync` false (the same as absent), never a request to a half-understood address. A trailing slash is accepted (the stack's `FrontUrl` ends with one). |
| W4 | The flags of the bundle and the server disagree (a variable changed without a rebuild). | The server checks again on every request: a page that believes sync is on gets `503 SYNC_UNAVAILABLE` and shows « indisponible »; nothing errors. |
| W5 | A public page becomes dynamic or reads cookies because of accounts. | No session read in a layout or a page; `/connexion` and `/compte` are static; the state is fetched in the browser after hydration. The home page is untouched. |
| W6 | Every visitor, signed in or not, costs a request to `/api/auth` (a server call relayed to Neon) on every page load. | The session is read at page load only when the browser holds the hint `vega.account.hint.v1` (localStorage, the value `1`, nothing about the person). Without it the state is « signed out » at once and no request leaves. The hint is written when a read finds a session and just before leaving for Google; it is removed when a read answers « no session » (kept when Neon is out of reach). `/connexion` always reads (a browser whose storage was emptied but whose cookie lives is recognised there). Storage out of reach: no hint, so the read happens only on `/connexion`. `tests/account-hint.test.mjs`. |

## 2. The account route (`tests/account-proxy.test.mjs`)

Forwarded, exactly: `POST /api/account/session`, `GET|PUT /api/account/preferences`, `GET /api/account/export`,
`DELETE /api/account` → the same path without `/api` on `ACCOUNT_API_ORIGIN`, header `X-Vega-Session: <Neon JWT>`.

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| P1 | Another path is relayed (`/api/account/preferences/x`, `/api/account//session`, `/api/account/SESSION`, `/api/account/merge`). | `404 NOT_FOUND`, nothing forwarded. The catch-all `app/api/[...path]` keeps every other `/api/*` URL. |
| P2 | A known path with another method. | `405 METHOD_NOT_ALLOWED` with `Allow`. |
| P3 | A query string. | `400 INVALID_REQUEST` (no route takes one; never forwarded). |
| P4 | A cross-site page makes the browser write (CSRF: a form or `fetch` with the visitor's cookies). | Every POST, PUT and DELETE needs `Sec-Fetch-Site: same-origin` when the header is present, else an `Origin` equal to the site's own origin (built from `X-Forwarded-Host` or `Host` and `X-Forwarded-Proto`, since `next start` gives the handler a `localhost` URL whatever the address asked), and `Content-Type: application/json` (which a cross-site form cannot send without a preflight the route never answers). Otherwise `403 ORIGIN_REFUSED` or `415 UNSUPPORTED_MEDIA_TYPE`, and the session is not read. GET and its answer stay same-origin (no CORS header is ever set). |
| P5 | No Neon session, or an expired one. | `401 SESSION_REQUIRED` in the API's envelope; nothing forwarded. Neon out of reach: `503 AUTH_UNAVAILABLE`, `retry: true`. |
| P6 | The JWT reaches the browser, a log or a URL. | It is fetched server-side (`auth.token()`), put in `X-Vega-Session` only, never in an answer, a header back, a log line or an error. The browser's `Cookie`, `Origin` and other headers are not forwarded upstream. |
| P7 | A personal answer is cached (Vercel, a browser). | Every answer of the route, errors included, says `Cache-Control: no-store`; `dynamic = "force-dynamic"`. |
| P8 | The account API is down, slow or answers something else than JSON. | `502 ACCOUNT_UNREACHABLE` (`retry: true`) after 8 s at most, or on a non-JSON answer; no upstream text is shown. |
| P9 | The status or body of the API is altered (a 409's `revision`, a 503's code). | Status and JSON body passed through as they are, `If-Match` forwarded when it is a revision, `Content-Disposition` kept for the export. |
| P10 | A huge body. | Over 4 MiB: `413 BODY_TOO_LARGE`, nothing forwarded (the API's own bound). |

## 3. First sign-in merge (`tests/account-merge.test.mjs`)

`mergeFirstSignIn(account, browser)`, both version-1 contracts.

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| M1 | The browser's choices are lost when the account already has some, or the account's are overwritten. | Per key: the account's value at its « not chosen » value takes the browser's; any other value of the account wins (`focus`, `theme`, `leagues`, `country`, `homePriority`, `defaultSeason`, `competition`, `comparison`, `researchSettings`). |
| M2 | Onboarding is asked again. | `onboarded` is true if either is. |
| M3 | Favourites added before signing in are lost, or duplicated. | `lists` united by id, the account's first; inside a list of the same id, entries united by kind + id, the account's first (its version of a shared entry kept). An untouched default list (« Ma sélection », empty) of either side is not a choice: it does not add a list. Bounds kept: 50 lists, 5000 entries. |
| M4 | Saved searches and indices are lost or doubled. | `views` and `templates` united by id, the account's first, 50 each at most. |
| M5 | `activeList` names a list that no longer exists. | The account's when its lists are not the untouched default, else the browser's; always one of the merged lists. |
| M6 | The merge yields something the site's contract would change or refuse. | The result is checked with `validateContract`; if it throws or alters the result, the account's contract is kept unchanged and the problem goes to `report`. |

## 4. Merge after a 409 (`tests/account-merge.test.mjs`)

`mergeThreeWay(base, local, remote)`: `base` is the last contract loaded or saved by this browser.

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| T1 | A change made on the other device is overwritten, or this one is. | Per top-level key: changed here since the base → this browser's value; otherwise the other device's. |
| T2 | Two devices add favourites at the same time and one set is lost. | `lists` per list id, entries by kind + id; `views` and `templates` by id: additions from both sides kept (the remote's order first). |
| T3 | An entry deleted on one device comes back. | An item present in the base and missing on either side is gone from the result. |
| T4 | The same item edited on both sides. | This browser's edit wins when it changed since the base, else the remote's (a list's name the same way). |
| T5 | `activeList` names a deleted list; every list is deleted. | It falls back to the first list; no list at all gives the default list. |

## 5. The adapter (`tests/account-sync.test.mjs`)

`createAccountAdapter({ api, accountId, readLocal, storage, onStatus })` gives `{ load, save, report, flush }`.

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| A1 | First sign-in on a new account loses the browser's data. | `GET` gives `contract: null`: the browser's contract (`readLocal`, i.e. `toContract` of the stores) is `PUT` without `If-Match`, returned by `load`, the marker recorded. |
| A2 | First sign-in on this browser for an account that has data. | Merge (section 3); `PUT` with `If-Match: <revision>` only when the merge differs from the account's; the merged contract returned; the marker recorded only after the account holds it. |
| A3 | Signing in again on a browser that already merged re-adds what another device deleted. | Marker present for that account id: the account's contract is returned as it is, nothing written. The marker is per account id (`vega.account.merged.v1` in localStorage). |
| A4 | The browser's stores are not loaded yet when `load` runs (the merge would see empty stores). | `load` rejects (a failed load, tried again on the next change); nothing is written. `AccountSync` sets the adapter only once both stores are ready. |
| A5 | The account holds a contract of another version (a newer site). | Returned unmerged and unwritten: the seam stops the sync and reports it; the account is never overwritten. |
| A6 | `save` gets `409 STALE`. | Reload, three-way merge against the base (section 4), `PUT` with the new revision; up to 3 rounds, then a failed save (tried on the next change). The merged contract is returned so the seam re-applies it. |
| A7 | Two saves of the adapter overlap (the seam's and the sign-out's last save). | The adapter runs one request at a time; each uses the revision the previous one left. |
| A8 | The session expires mid-session (401) or the account is erased elsewhere (410). | 401: a failed save, the state module re-reads the session and, when it is gone, removes the adapter (stores kept; the marker stays, so the account wins at the next sign-in). 410: `report`, sync stopped. |
| A9 | The account API is unavailable (5xx, network). | A failed load or save; status « en échec, nouvel essai au prochain changement »; the UI never blocks. |
| A10 | `/compte` cannot say what the sync is doing. | `onStatus`: `syncing` (load or save running), `synced`, `failed` (with the reason, retried), `stopped` (with `report`'s reason); `/compte` shows « à jour », « en cours », « en échec », « arrêtée : <raison> », or « indisponible » (W2). |
| A11 | A body the server refuses (413 CONTRACT_LIMIT, 400 CONTRACT_INVALID, 422). | `report` with the API's message (sync stopped for that state); retried only after another change. |

## 6. Sign-out, sign-in, screens (E2E, `tests/e2e/accounts/`)

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| O1 | The last changes are lost at sign-out. | « Se déconnecter » first saves the current contract through the adapter (`flush`); only when it succeeded: `setPreferencesSync(null)`, `clearPreferences()`, the marker of that account removed (the stores no longer hold its data, so the next sign-in merges only what is added meanwhile), Neon's `signOut()`. |
| O2 | That last save fails. | The person is told (« Vos derniers changements n'ont pas pu être enregistrés sur le compte. ») and chooses « Se déconnecter quand même » or « Annuler »; cancelling changes nothing. |
| O3 | The next person on the browser inherits or merges the account's data. | After sign-out the stores hold « nothing chosen » (the theme kept, a device setting). |
| O4 | `?next=` sends the person to another site (open redirect) or to a script URL. | Only a same-origin path: starts with one `/`, not `//` or `/\`, no scheme, no control characters, at most 512 characters, and not `/connexion` itself; anything else gives `/`. |
| O5 | Sign-in errors are cryptic. | Plain French: wrong address or password, account already exists, password too short (8), invalid address, too many attempts, service unreachable. Never the address in a URL or a log. |
| O6 | The header jumps when the state arrives. | The entry has a fixed size from the first paint (an empty slot of the same size while unknown). |
| O7 | Google sign-in breaks. | `signIn.social({ provider: "google", callbackURL, errorCallbackURL })` with same-origin URLs; an error is shown in plain words (the return: section 9). Against the local stand-in Google is not configured: only the error path is exercised here. |
| O8 | Export or deletion fails silently. | « Exporter mes données » downloads `vega-account-export.json` from `GET /account/export`. « Supprimer mon compte » asks to type « SUPPRIMER »; `503 DELETION_UNAVAILABLE` and `409 SUBSCRIPTION_ACTIVE` are told in plain words, nothing is signed out; success signs out and empties the stores. |
| O9 | An address, a token or an account id ends in analytics, logs, URLs or error reports. | None in a URL (`/compte` takes no parameter, `?next=` only a path), no `console` line carries them, the adapter's errors carry the API's code and message only. Vercel Analytics sees URLs only. |
| O10 | The CSP blocks the flow. | Everything is same-origin (`/api/auth`, `/api/account`); Google's sign-in is a top-level navigation, which `connect-src` does not govern. No CSP change. |

## 7. The screens' look (`tests/account-summary.test.mjs`, E2E)

Second design of `/connexion`, `/compte` and the header entry (24 November 2026; the first one was refused as too
bare). `/compte` and the header's menu were redrawn since: section 10. `/connexion` is a screen of its own, without the site's header: the brand's night panel (pitch lines, the
wordmark) beside the form. `/compte` shows who is signed in, what the account keeps and the state of the sync.

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| S1 | The monogram shows a wrong or empty letter. | `accountInitial(user)`: the first letter or digit of the name, else of the address before « @ », as a capital (« é » gives « É »); nothing readable gives `""` and the tile stays empty. Never more than one character of the address. |
| S2 | `/compte` opens before the stores are loaded (`currentContract()` is null) or with a damaged value. | `accountSummary(null)` gives zero counts, no favourite, country `"auto"`; it never throws. |
| S3 | A club saved in two lists is counted twice. | Counts are per kind of distinct ids over every list: clubs, nations, players, matches; an entry of another kind or without an id is ignored. |
| S4 | A long selection floods the page. | `accountSummary(contract, { shown })` still bounds its list (8 by default); `/compte` asks for every favourite and cuts per kind instead (section 10, C4). |
| S5 | The country reads wrong. | `null` → `"auto"` (detection), `"none"` → `"none"`, a code → that code; the screen writes « Automatique », « Aucun » or the country's name. |
| S6 | Changing between « Se connecter » and « Créer un compte » loses the address typed, or keeps a stale error. | The address stays, the password and the error are cleared, the browser's password manager gets `current-password` / `new-password`. |
| S7 | The password cannot be checked before sending. | An eye button shows or hides it (`aria-pressed`), without changing the value. |
| S8 | The drawing costs a request, moves for people who asked for no motion, or is read aloud. | Inline SVG, `aria-hidden`; its slow drift stops under `prefers-reduced-motion`. |
| S9 | The screen without the site's header leaves no way back. | The wordmark links to `/`, and « Fermer » goes back to `?next=` (same rule as O4). |
| S11 | The sync's state reads alone or runs long. | `syncLabel` gives the words (« À jour », « En cours », « En échec » with its reason and « Nouvel essai au prochain changement. », « Arrêtée : <raison> », « Indisponible ») and a short `pill`; `/compte` shows them only when the sync does not work (section 10, C3) (`tests/account-messages.test.mjs`). |
| S10 | The header entry changes width between its states. | 124 px in every state from 1024 px up, the icon size below, as before (O6). |

## 8. Forgotten password and address confirmation (`tests/account-code.test.mjs`, E2E phase `verify`)

Both go through a six-digit code sent by e-mail (Neon Auth's Email OTP; a link would need a sender of our own),
as steps of `/connexion`: « Confirmer l'adresse », « Mot de passe oublié », « Nouveau mot de passe ». Neon's
settings these steps are written for: verification required, by code, a code sent at sign-up, none at sign-in
(the site asks for it), auto sign-in after verification. The site also works with verification off, as before.

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| R1 | Sign-up with verification required leaves the person on the form, with no session and no word. | A sign-up answer without a session token opens « Confirmer l'adresse »: the address (on the screen only, never in a URL) and the code field. With a token (verification off) the person is signed in as before. |
| R2 | Sign-in with an address never confirmed ends on an error with no way on. | `EMAIL_NOT_VERIFIED`: the same step opens and the site asks for one code (`emailOtp.sendVerificationOtp`, type `email-verification`). |
| R3 | The code is pasted with spaces or text around it, or is incomplete. | `cleanCode(text)` keeps the digits, six at most. With fewer than six nothing is sent and the field takes the focus. The field is `inputMode="numeric"`, `autoComplete="one-time-code"`. |
| R4 | A wrong, expired or used-up code. | `INVALID_OTP`: « Code incorrect. » · `OTP_EXPIRED`: « Ce code a expiré. Demandez-en un nouveau. » · `TOO_MANY_ATTEMPTS`: « Trop d'essais. Demandez un nouveau code. » The code field is emptied and focused; the address and the passwords typed are kept. |
| R5 | The e-mail does not arrive, or « Renvoyer le code » is hammered. | « Renvoyer le code » asks for a new code, then is disabled for 30 s; its failure reads as O5. |
| R6 | The address is confirmed but Neon opens no session (auto sign-in off). | After `emailOtp.verifyEmail` the session is read; without one the site signs in with the password still in memory from the previous step. |
| R7 | « Mot de passe oublié ? » tells who has an account. | The answer and the screen are the same whether the address has an account or not: the code step opens. An empty address sends nothing (focus on the field). |
| R8 | Neon's server knows only one of Better Auth's two request routes. | `emailOtp.requestPasswordReset`; a 404 falls back to `forgetPassword.emailOtp` (the route Neon documents). |
| R9 | A wrong code or a short password sends the person back to the start. | « Nouveau mot de passe » holds the code and the new password (8 characters at least, the eye button, `new-password`) on one screen; an error keeps the step, and all but a wrong code. |
| R10 | After the reset the new password must be typed again. | A successful `emailOtp.resetPassword` is followed by `signIn.email` with the address and the new password, then `?next=`. If that sign-in fails: « Connexion », the address filled, « Mot de passe modifié. Connectez-vous. » |
| R11 | A step loses the address, or keeps a password longer than needed. | « Retour » gives « Connexion » with the address kept. The password survives only from sign-up or sign-in to the confirmation that follows (R6); codes and passwords are cleared on every other change of step and after success. |
| R12 | Reloading a step leaves a half state. | Steps live in memory: a reload shows « Connexion ». Only `?mode=creer` and `?mode=oubli` open another step. |
| R13 | A step has no title, no focus, or says nothing to a screen reader. | Each step has its `h1` and focuses its first empty field; errors are `role="alert"`, « Code envoyé » is `role="status"`. Google's button and « ou » show only on « Connexion » and « Créer un compte ». |

## 9. The return from Google (`tests/account-return.test.mjs`, E2E phase `on`)

Google's sign-in leaves the site: the browser goes to Neon, then Google, then Neon's callback, which sends it back
to the site. A refusal on the way (Neon or Google) used to end on Neon's own error page, and a return whose session
could not be opened showed the page signed out without a word (24 November 2026, the owner's report).

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| G1 | Neon or Google refuses the sign-in and the person lands on Neon's error page, off the site. | `signIn.social` gets `errorCallbackURL`: the site's absolute `/connexion` with the same `next` (Neon resolves a relative path against its own host). `callbackURL` is unchanged (the site's origin + `next`). |
| G2 | `/connexion?error=<code>` shows nothing, or shows the raw code alone. | One plain French sentence in the usual error place (`role="alert"`): `account_not_linked` says the address already has an account with a password never confirmed: sign in with it and confirm the address first; `access_denied` says the Google step was cancelled or refused; any other code gets the generic sentence followed by the code in parentheses, so it can be reported. The address and password fields are not marked as wrong: the error is not theirs. |
| G3 | The code in the address carries text meant to be shown (an address, a script, a long string). | Only a code of letters, digits, `_` and `-`, 64 characters at most, is ever shown; anything else reads as the generic sentence alone. `error_description` is never shown. |
| G4 | The error stays in the address: a reload or a shared link shows it again. | Read once on arrival, then `error` and `error_description` are removed from the address; `next` and every other parameter are kept. |
| G5 | The return carries `neon_auth_session_verifier` but the session cannot be opened (Neon answers 400, or no user): the page shows « Se connecter » without a word. | The session read finds no user while the verifier is in the address: the person is sent to `/connexion?error=<the code get-session answered, else session_not_opened>&next=<the page, without the verifier>` (the address replaced, not pushed). |
| G6 | A return with a verifier is never read because this browser holds no hint (W6). | The verifier in the address counts as a reason to read the session, like a forced read; without a verifier the hint rule is unchanged (no read without the hint, nothing more read). |
| G7 | G5 throws, loops or leaves the site. | `refreshSession()` still never throws; `next` follows O4 (a path of this site, never `/connexion`); `/connexion` carries no verifier, so it cannot send itself again. |

What the stand-in cannot show: Neon's real refusals on the way back (its codes are Better Auth's: `account_not_linked`,
`state_mismatch`, `please_restart_the_process`…) and a real verifier. The E2E opens `/connexion?error=…` as Neon would
send it, and returns with a verifier the stand-in does not know (it answers no session, as Neon's 400 does).

## 10. The account page « Lettre » and the header menu (`tests/account-page.test.mjs`, E2E phase `on`)

The owner's choice of 24 November 2026, after two refused passes: `/compte` holds the account and the settings in one
narrow column read down the page. « Mon compte. » in the logo's letters, the address, the plan and « Se déconnecter »;
then Favoris (clubs, players, nations, and the competitions the home page follows, with « Modifier » opening the home
page's picker: they are no longer a setting of their own), Paramètres (`#parametres`: theme, « Français » as a quiet
row, the home country with « Automatique ») and Sécurité (`#securite`). No tab, no frame, no count. The default season
and the home priority stay in the contract and are synced, but have no control: no page reads them yet. The signed-in
header entry opens a menu: who is signed in, « Mon compte » (`/compte`), « Paramètres » (`/compte#parametres`),
« Se déconnecter ». The pure rules are in `src/services/account-page.js`.

| # | What can go wrong | Expected outcome |
| --- | --- | --- |
| C1 | « Paramètres » opens the page at the top, or the anchor is lost on the way. | `/compte#parametres` lands on the settings once the session is read (their top under the header, within 80 px of it), and the address keeps `#parametres`: the season sync (`FootballContext.updateQuery`) rewrites the query, never the hash. « Mon compte » opens `/compte` at the top. Already on `/compte`, both still move the page (Next changes the address without a `hashchange`: the menu tells the page). |
| C2 | A Google-only account is offered « Changer le mot de passe » and fails, or the row flashes. | `hasPassword(answer)` of Better Auth's `listAccounts()`: `true` when its `data` holds an account of provider `credential`, `false` when it holds none, `null` when the answer is an error, not a list, or missing. The row shows only on `true`: hidden while unknown, when `/api/auth/list-accounts` fails or throws. |
| C3 | The page talks about the sync when it works, or says nothing when it does not. | `syncNote(sync, syncOn)`: `null` for `idle`, `syncing`, `synced` and any unknown state; « Synchronisation en échec » (detail: the reason, then « Nouvel essai au prochain changement. »), « Synchronisation arrêtée » (detail: the reason) or « Synchronisation indisponible » otherwise, and always « indisponible » when the switch has no sync (W2). The block `.account-syncblock` is always there with `data-state`, empty when all is well. |
| C4 | A long selection floods the page, or one kind hides the others. | `favouriteGroups(favourites, opened)`: one group per kind in the order Clubs, Joueurs, Nations, each in the lists' order, at most 6 (`FAVOURITES_PER_KIND`) until that kind is opened; `more` counts the rest, « Afficher l’autre » for one, « Afficher les N autres » beyond (`moreLabel`). A kind without favourites has no group; a match is never listed; an entry without an id or of an unknown kind is ignored. |
| C5 | No favourite at all leaves a blank or a broken section. | « Aucun favori. » followed by three links: Clubs, Joueurs, Nations (the pages where a favourite is added). The competitions follow as usual. |
| C6 | The menu cannot be opened or closed without a mouse, or traps the person. | The entry is a `button` with `aria-label="Mon compte"`, `aria-expanded`, `aria-controls` while open. A mouse opens it on hover and closes it 180 ms after leaving; a click on a hovered entry keeps it open; a tap toggles it. Keyboard focus (`:focus-visible`) opens it and Tab goes into its links; Escape closes it and puts the focus back on the button without opening it again; a pointer down outside and a change of page close it. Signed out, the entry stays the link « Se connecter » (no menu, no `aria-expanded`). Its width does not change (S10). |
| C7 | « Se déconnecter » from the page or the menu loses the last changes. | Both go through the same `signOut` (O1 to O3): a failed last save is told (« Vos derniers changements n’ont pas pu être enregistrés sur le compte. ») with « Annuler » and « Se déconnecter quand même ». From `/compte` the person then lands on `/`. |
| C8 | Deletion becomes one click, or export stops working. | Unchanged contracts: « Supprimer mon compte » asks to type « SUPPRIMER » before « Supprimer définitivement » is enabled, and its refusals read as O8; « Exporter mes données » downloads `vega-account-export.json`. Both only with the account API (W2). |

## Not covered here

- A real Neon token, Neon's cookies and Google: the container cannot reach Neon. The E2E runs against a local
  Better Auth server (Neon Auth is managed Better Auth) with the JWT plugin and the account API's real front and
  store on the local PostgreSQL. To be checked on a Vercel preview: sign-up, sign-in, Google, `iss` / `aud` of
  Neon's JWT against the account front's verifier.
- Neon's real e-mails (the shared sender, their wording, their delay): the E2E reads the codes from the stand-in's
  outbox (the same Better Auth Email OTP plugin). To be checked by a person on the public site.
- A session ended in another tab: this tab keeps its stores until its next save answers 401.
