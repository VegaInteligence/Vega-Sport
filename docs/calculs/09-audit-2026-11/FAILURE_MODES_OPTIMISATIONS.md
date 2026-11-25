# Optimisations of 25 Nov 2026: failure modes, edge cases and expected outcomes (written before the tests)

A batch-specific file, beside the shared register [`FAILURE_MODES.md`](FAILURE_MODES.md), so that its sections do not
collide with that register's numbers (its § 62 is the match page's, on `main` since `fb0de18b`). Each section is named
by its GitHub issue and each case by the issue and a letter: GH220-a, GH194-a, GH137-a. Base `492a1361`.

- **GH220** (VI-158): the home's personal read with a followed player, and the check a Deploy makes of it.
- **GH194** (VI-134): the isolated pilot, by hand from `main`, its own provider key, a bounded run.
- **GH137** (VI-77) for `/api/league-history` only, with **GH145** (VI-85): its validator, its reads, an hour at the edge.

A first version of these sections was numbered 62 to 64 in the shared register; the review of 25 Nov 2026 (19:29 Paris)
asked for these names and for the corrections marked « review » below, each written here before its test changed.

## GH220. The home's personal read with a followed player (GH #220, VI-158)

Production, 25 Nov 2026 (15:43 and 16:01 UTC): `GET /api/read/home-favourites?season=2026/2027&leagues=all` answered
200 in 0.7 s with a followed club, 503 `DATA_UNAVAILABLE` after 8.0 s (SQL 57014) with a followed player, alone or with
the club; on 24 Nov, 136 failures of 137. A local base of about 240 000 appearances a season (2023–2026, the order
`backend/README.md` measured for one season) gives the same picture with the base commit's code: the club in 0.15 s; the
player 7.3 s and 14.7 million shared buffers for one followed player; the club and the player past the 8 s limit.

### GH220.1 Rules (what the read keeps)

- **Contract.** The same body: `favourites` (`teamId`, `strength` 1 club / 2 a player's club / 3 a player's national
  team, `reason`, `players`), `upcoming`, `yourPlayers` (`matches`, `next`), `period`, `rules`, the publication's `meta`;
  the same orders; public ids only; at most 100 keys of each kind, a key given twice counted once.
- **The four reads of the followed players' appearances** (`api.player_appearances`, minutes > 0, so a statistics row):
  - the player's club: the season asked only; the team known (the statistics' team, else the line-up's); the date
    known; not a national team; a competition whose country is not `INT`, `INT-2`, `UEFA` or `WORLD`, or one of the three
    UEFA club cups; the latest by date, then match id;
  - his national team: seasons from the read's UTC year − 3; a national team; the date known; the latest;
  - his matches of the displayed week: the season asked; PitchAPI fixtures; opponent and score from the side of the
    appearance's team (the statistics', else the line-up's; with neither, the base's rule: the home side is the
    opponent);
  - his latest club: seasons from year − 2; the team known; the date known; not a national team; any competition; its
    next match not started (seasons from year − 1).
- **Protocol.** `Cache-Control: private`; `media=1` adds the media map; `If-None-Match` answered from the publication
  alone (one statement, 304); a `generation` that is not the publication's: 409; the 8 s statement limit unchanged.
- **Where the fix lives.** The read API's statement (`homeFavouritesQuery`), no migration, no change to the view: each
  of the four reads takes the followed players' ids as an array (`a.player_id = ANY(ARRAY(SELECT … FROM
  followed_players))`), so that both branches of the view, its statistics rows and its line-up rows, find them at their
  tables. The keys are turned into ids inside that statement: the mapping and the appearances are read in one snapshot,
  and the route runs two statements, as before (the editions, then the read).
- **Decision (review: one snapshot or a bound list).** A first version read the ids in a statement of their own and
  bound them as constants (three statements). On the local base both forms return the base commit's 16 bodies, byte for
  byte; the array form took 167.5 ms for one player, 158.9 ms for a club and a player and 299.1 ms for 100 players, the
  bound form 149.3 ms, 145.3 ms and 328.5 ms (`favourites/candidate-initplan.log`, `favourites/candidate.log`); for 100
  players both hash the view's line-up anti-join over the partitions' keys. The bound form changed one thing: on the API
  seed's 18 000 rows of other players, the planner, seeing the array of one id, kept a nested loop where it hashed the
  array form's anti-join over the season's 8 000 statistics rows (16 000 rows examined, harmless at that size). That
  plan measured the fixture's size, not the bug. Kept: the array form (one snapshot, one statement fewer); the regression
  check's fixture is made to the order of production's (GH220-m).

### GH220.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH220-a | One followed player on the local base (about 240 000 appearances in each of 2023–2026) | 200 well under 8 s; rows and buffers read in the appearance tables bounded by the followed players' appearances, not by the seasons |
| GH220-b | Club; player; club and player; three clubs and five players; the 20 clubs of a league and a player; 100 players; and each scenario player below | the same body, byte for byte (sha256 at the seed's pinned clock), as the base commit's code on the same base |
| GH220-c | A statistics row without its team, the line-up's team known | the line-up's team: his club, and the side his opponent and score are read from |
| GH220-d | His latest statistics row with neither team, an earlier one with his club | the earlier row's club for both club reads; the match kept in the week with the base's opponent rule |
| GH220-e | Only line-up rows (the bench, minutes 0) | no favourite, no entry in « Vos joueurs » |
| GH220-f | A key with no appearance; a malformed key; 101 keys | nothing for that key; 400; 400 |
| GH220-g | National-team appearances in the season of year − 3; only before it | his national team, strength 3; none |
| GH220-h | Club appearances in the season of year − 2 only; only before it | listed with that club and its next match, no match of the week; not listed |
| GH220-i | His latest appearance for another club in a competition of country `WORLD` | his club (strength 2) stays the league club; his latest club (« Vos joueurs ») is the other one |
| GH220-j | A player who changed club this season | this season's club |
| GH220-k | Two followed clubs that play each other | one upcoming match, the strongest strength, both favourites (existing `home.test.mjs`) |
| GH220-l | `media=1`; `If-None-Match` of the answer; a stale `generation` | the media map, private; 304 in one statement; 409 |
| GH220-m | The statement the route runs, on the API seed with 100 000 line-up rows and 80 000 statistics rows of other players in the season, the order at which the planner takes production's plan (review: 10 000 rows let it hash the anti-join, a plan of the fixture's size) | each of the four reads finds the followed player's rows through `player_id` and the season at the tables; the appearance scans look at a few dozen rows (200 at most), never the season's |

GH220-c–j, l, m: `backend/api/test/home-favourites.test.mjs` (m red on the base commit, the others green on both: they
pin what the fix keeps); a, b: the local base and the comparison with the base commit's code, outside the repository.
Not verified here: production's own plan and time (the local base is synthetic; its machine is faster than the base's
`db.t4g.medium`).

### GH220.3 The check after a Deploy (`infra/aws/smoke-favourites.mjs`, the last step of `deploy.sh`)

Review: the first version passed when the manifest or the home answered 503 (it said « skipped »), and when the three
answers held empty lists for a club and a player it knew to exist; it also skipped every week without a player of the
week. Now:

- **Bootstrap.** The manifest and the home must each answer 200 with JSON of their form (the manifest: a `seasons`
  list and its `defaultSeason`, one of them; the home: its `data` object). Any other status, a body that is not JSON,
  another form, a network error after one more try (20 s each): a failure naming the read and the reason (the API's
  error code at most), never a body.
- **Empty base, the only skip.** A manifest of the right form naming no season (a base created and not filled, a first
  Deploy: the migrations write the publication row, the worker has not yet written an edition), confirmed by
  `/api/health`, never kept by the edge, answering 503 `pending` (no edition): `skipped (the base holds no season)`,
  exit 0. The same manifest with `/api/health` answering anything else is a failure. A base that holds a season but no
  player the probe can follow is a failure: the three reads were not covered.
- **Whom it follows.** A pair given by the operator first (`--team t_… --player p_…`, both or neither; through
  `deploy.sh`, `SMOKE_TEAM` and `SMOKE_PLAYER`); else the home's player of the week and the team of his match of the
  week; else the top scorer (then assister) of the home's leaders and his club; else the same in the season the
  manifest lists after the default. The source is printed, not the names or the ids.
- **What each answer must show.** 200, `private`, the three lists and the publication's generation; the club: among the
  favourites with strength 1 and reason `club`; the player of the week: a favourite naming him (his club or his national
  team: the reads of his clubs and nations) and, when the base knows a club of his, his entry in « Vos joueurs » holding
  his match of the week (the reads of his matches and of his latest club). The answer for the player alone tells whether
  it knows one: a favourite naming him for his club (`player_club`) or his entry in « Vos joueurs »; the answer for both
  reuses it (there his club may be the followed one, reason `club`). Known by his national team only (review of 20:02:
  « Vos joueurs » starts from his non-national clubs, GH220-g, and a week of national-team matches can make him the
  player of the week), or his match dated outside the answer's week (the week changed between the two reads, or the
  edge kept the home of the week before): said on the line, not judged. Another player (the leaders', the operator's):
  named by the answer, a favourite or « Vos joueurs » (his club's next match is not required). Both: the two checks.

| # | Situation | Expected |
|---|---|---|
| GH220-n | The real handler on the API seed (its player of the week) | the source, three lines, each 200 with what it checked, exit 0; the ids the home gave asked, in the manifest's season; no name, key or body printed |
| GH220-o | The manifest answers 503, or 200 with a body that is not JSON, or JSON of another form, or a default season it does not list; the home 503, not JSON, another form; the origin closed | exit 1, the read and the reason named, the favourites not asked, never « skipped » |
| GH220-p | The three answers 200 with empty lists for a club and a player the probe found; the club missing from the club's answer; the player of the week missing from « Vos joueurs », or listed without his match; one answer 503; not `private`; without its generation; without two lists; not JSON | exit 1, the case and what is missing named |
| GH220-q | A week without a player of the week; a season with neither, the season before with them; his match dated outside the answer's week; a player of the week known by his national team only (a favourite `player_nation`, « Vos joueurs » empty, as the read answers him: GH220-g), alone and with the followed team; a pair given by the operator (the home holding no player); a pair given half, malformed, or with another option | the leaders' player and club, three answers checked; the season before's player, asked in that season; « not checked (another week than the answer's) », exit 0; « not checked (no club of his in the base) » on the player's and both lines, exit 0 (his club known and « Vos joueurs » empty stays exit 1, GH220-p); the operator's pair; exit 2 |
| GH220-r | A manifest of the right form naming no season, `/api/health` 503 `pending`; the same, `/api/health` 200 or 503 `DATA_UNAVAILABLE`; a base with seasons and no player anywhere | `skipped (the base holds no season)`, exit 0; exit 1; exit 1, `no player to follow`, the favourites not asked |
| GH220-s | The real `deploy.sh`, its last step run for real (`node`) against a local origin: well answered; the home answering 503; the favourites missing the club; `SMOKE_TEAM` and `SMOKE_PLAYER` set | `done`, exit 0; the run stopped there, exit 1, no `done`, every stack above deployed; the pair passed to the probe |

GH220-n–r: `backend/api/test/smoke-favourites.test.mjs` (the probe against the real handler on the API seed, and against
answers made for each case); GH220-s: `backend/tests/test_account_deploy.py` (the real `deploy.sh`, offline: AWS and the
packaging are stand-ins, the probe and its origin are real).

## GH194. The isolated pilot: by hand from `main`, its own provider key, a bounded run (GH #194, VI-134)

Seen before this change (audit D1, re-read on `main` 407c4c1 and 492a136): `.github/workflows/pilot.yml` started on every
push touching `backend/**` (fifteen runs on pushes to `main`), read the production PitchAPI key (`/vega/v2/pitchapi-key`,
the worker's) through the `vega-v2-pilot` role, whose trust also took every `claude/v2-*` branch, called the provider
every 0.25 s (production: 0.5 s; after a 429 the worker and the backfill slow to 1 s for 10 min), and ran the pilot a
second time when the first failed; one observed run made 748 provider attempts in its worker step alone.

### GH194.1 Rules

- **Trigger.** `workflow_dispatch` only; the job runs only for `refs/heads/main` (a run asked from another branch does
  nothing). No push, schedule or pull-request trigger.
- **Key.** Its own SSM SecureString, `/vega/v2/pitchapi-pilot-key`, read with `vega-v2-pilot`; never the worker's
  `/vega/v2/pitchapi-key`, never a GitHub secret, no fallback. The role's trust: this repository, the workflow
  `Isolated pilot`, `refs/heads/main` exactly; its policy: `ssm:GetParameter` on the pilot parameter alone (and
  `kms:Decrypt` through SSM). A missing or malformed key stops the run before any provider call.
- **Inputs** (review: the first version offered 1, 2, 4, 10 or 20 matches; the base took any integer from 1 to 306).
  `max_matches`: any whole number of finished Ligue 1 matches from 1 to 306, default 1, as the base; the four regression
  fixtures on request; worker jobs 0, 100, 300 or 700. The values reach the shell through the step's environment only,
  and are checked there before any arithmetic: digits only, no sign, no leading zero, no space, at most three digits and
  306 at most. The checked values are the step's outputs; the commands read them from their environment, quoted.
- **Pace and work.** Every provider call at 0.5 s or more. Every provider command has a budget counting each attempt,
  retries included (`--max-requests`, `PitchClient(max_requests=…)`): spent, the client refuses the next attempt
  without sending it. The pilot's budget is `pilot.default_budget(matches)` = 20 × matches + 20; its cap is that
  budget for 306 matches, 6 140 (review: the cap was 5 000, below the default budget of 306 matches); the workflow's
  formula and the CLI's are checked equal. The worker's: 2 per job (1 400 at most); the regressions': 100. The pilot runs
  once (no automatic second run).
- **Time** (review: the full season needs the base's time or more). 120 minutes: the largest run is at most 7 640
  attempts at 0.5 s (6 140 + 100 + 1 400), about 64 minutes at that pace, more after a 429 (1 s between calls for ten
  minutes), plus the worker's own work; the base allowed 100 minutes at 0.25 s.
- **Kept.** The deterministic `backend/tests/test_pilot.py` (in-memory transport) runs in `ci.yml` as before; the
  measurements-only report and its artifact. No test makes a provider call.

### GH194.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH194-a | A push to `main` or a branch touching `backend/**` | no pilot run (no push trigger) |
| GH194-b | The workflow asked by hand from a branch other than `main` | the job is skipped |
| GH194-c | The workflow's steps | no read of `/vega/v2/pitchapi-key`, no `secrets.`; the key is `/vega/v2/pitchapi-pilot-key` |
| GH194-d | The pilot parameter absent, empty or not a PitchAPI key | the run fails at the key step, before any provider command |
| GH194-e | Any `--interval` of the workflow; `python -m vega.pilot --interval 0.25` | 0.5 or more; refused |
| GH194-f | `max_matches` 1, 3, 20, 306; with regressions or not; worker jobs 0, 100, 300, 700; every count from 1 to 306 | accepted, the checked values as outputs; the budgets `20 × n + 20`, 100 or 0, `2 × jobs`; for every count the workflow's budget is `pilot.default_budget(n)`, within the CLI's cap |
| GH194-g | `max_matches` empty, 0, 307, 1000, `1.5`, `abc`, `+5`, `-1`, `05`, ` 5`, `5 `, `5` and a newline, `3 4`, `1e2`, `99999999999999999999`, `$(echo 5)`; worker jobs 701, empty, `1e2`; regressions `yes`, empty | the bounds step fails, naming the input; no output written, nothing computed from it (macOS bash 3.2 in the tests; the same cases under GNU bash 5.2, the runner's, in the evidence) |
| GH194-h | The commands of the provider steps | the inputs through their environment, quoted, never interpolated in the script; each with its budget |
| GH194-i | A failed pilot command | not run again by the workflow |
| GH194-j | `PitchClient(max_requests=3)` answered 429 three times; two answers then a third fetch; `max_requests` 0, negative, `True`, 1.5 | three attempts, then `REQUEST_BUDGET_EXHAUSTED` without a fourth send; the third refused unsent; refused at construction |
| GH194-k | `python -m vega.pilot` without `PITCHAPI_API_KEY`, or with a malformed one | exit 1 with `pilot_error=MISSING_API_KEY`; no database connection, no provider call |
| GH194-l | `python -m vega.pilot --max-matches 306` without `--max-requests`; `--max-matches 4`; `--max-requests 6140`; `--max-requests 6141`; `--max-matches 307`; `python -m vega.worker --max-requests 5` | the client's budget 6 140; 100; 6 140; refused; refused; the worker's client budget 5 (none without the option, as the deployed worker) |
| GH194-m | The job's time limit | 120 minutes or more |
| GH194-n | The role (`deploy-roles.yaml`) | trust: `refs/heads/main` exactly (no `claude/v2-*`, no `StringLike`), workflow `Isolated pilot`, this repository; policy: the pilot parameter only |
| GH194-o | `test_pilot.py` | unchanged, green: 17 synthetic calls, no budget |

Tests: `backend/tests/test_pilot_bounds.py` (GH194-a–n), `backend/tests/test_pilot.py` (GH194-o). Not verifiable here: that
the pilot key is another PitchAPI key with a quota of its own (configuration is checked, the quota is the provider's);
the role's new trust and policy take effect only when the owner deploys `vega-v2-deploy-roles` from the Mac (the Deploy
workflow cannot change that stack): until then the deployed role still trusts `claude/v2-*` and reads the production
key, though no workflow of this repository asks for it.

## GH137. `/api/league-history`: one statement for a validator and its answer, the reads made cheaper, an hour at the edge (GH #137 for this route, VI-77; with GH #145 for this route, VI-85)

Seen before this change: the route ran its four reads (`api.league_history_edition`, `_matches`, `_next`, `_players` or
`_scorers`), each in its own statement, built the whole answer, then hashed it for its ETag; a revalidation did all of
it (on 25 Nov 2026 in production, Ligue 1 2019/20: 494 ms, "4 queries", 331 818 bytes; 1 028 answers 304 in a day,
four reads each). CloudFront's cache policy caps every answer at 60 s (`MaxTTL: 60`), though this one says
`s-maxage=3600`. On a local archive of 157 000 matches, `api.league_history_next` alone took 65 % of the read: it read
the whole `core.matches` table twice (sequential scans) to keep the matches of three editions.

### GH137.1 Rules

- **One statement per request, one snapshot.** Every request the route answers runs one statement: the four reads,
  once; their `digest`, the SHA-256 of a JSON array holding the edition's key and, for each read, its rows as PostgreSQL
  writes them (record text), in an order they alone decide (the matches in the function's order, the archive's; the
  other reads sorted), JSON's escaping making two different reads two different texts; and, only when an answer is to
  be built, the rows as JSON in that order. The reads always run: the validator spares their transfer, the building of
  the answer and its hash, not the reads themselves.
- **The validator.** `W/"league-history-v2-<resource>-<digest>"`: `<resource>`, 16 hexadecimal characters of the SHA-256
  of the representation's version (the read API's release, `VEGA_RELEASE`, the package's own SHA-256, else a value drawn
  once per process; the Node.js version), the league and the season; `<digest>`, the statement's. `If-None-Match` is
  read by `http.mjs`'s parser, the grammar `matchesEtag` checks (weak or strong, lists, `*`; a malformed header holds no
  tag). The digests of the tags of this resource and release, and whether `*` was sent, go to the statement as
  parameters (review: a first version ran a statement for the digest, then, when it differed, the whole statement again:
  a stale tag cost the four reads and their digest twice). The statement builds the rows only when the answer will be
  sent: a GET whose tags do not hold the digest. Equal or `*`: 304; a HEAD: never the rows, 200 or 304.
- **Kept.** 400 for an unknown or repeated parameter and 404 for a league, season or edition not held come before any
  304, `*` included; weak comparison, lists and `*` as `matchesEtag`; the body of the base commit, byte for byte, from
  the same rows; `public, max-age=0, s-maxage=3600` (`stale-if-error` added by the transport).
- **The reads.** Migration 177 keeps the four reads' rows: `api.league_history_next` reads the kept editions' matches
  through `matches_competition_kickoff`, never the whole table; `api.league_history_team` (never inlined) runs once
  per club a read meets, not once per match side, player row or goal (760 calls for a season of 380 matches).
- **The edge (GH145).** A cache behaviour for exactly `api/league-history`, its own cache policy: `MinTTL` 0,
  `DefaultTTL` 0, `MaxTTL` 3600, the same cache key as the default (no cookie, no header, every query string; gzip and
  brotli); the default behaviour's origin, methods, compression, origin request policy (the validators) and response
  headers. Every other route keeps `MaxTTL` 60. A correction may stay an hour at a point of presence; an invalidation of
  `/api/league-history*` removes it sooner (owner's operation).

### GH137.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH137-a | Nothing changed, `If-None-Match` of the answer | 304, one statement, no row returned by it |
| GH137-b | `HEAD`; `HEAD` with the answer's tag | 200 with the tag, no body, one statement, no row; 304 |
| GH137-c | A correction of: a score; a round's name; an archived spelling; the name or crest of the club it is merged into; a merge set or removed; the club's PitchAPI id; a player's name, photo or PitchAPI id; a player season's goals, the row deleted; a match taken out of the season; the next season's Champions League (a club added); the next season's league (relegation); an archived goal (pre-2012), its own-goal flag; a second archive key of the season holding more matches; for 2020/21, the PitchAPI 2021/22 league | when the answer changes: another tag, and 200 with the corrected answer for whoever holds the old one (never a 304 for an answer that changed); when it does not (the relegation rule falling back to the last clubs either way): 304, or 200 with the same answer (refined after the first run of the tests, before the change: the base commit's hash rightly answered 304 to a correction that left the answer as it was) |
| GH137-d | Writes that do not touch the season: a match of another season or competition, a club the season never meets, a publication | the same tag, 304 |
| GH137-e | A correction rolled back; a correction then its reversal; two corrections applied in either order | the same tag; the original tag again, and 200 for whoever holds the corrected answer; one tag |
| GH137-f | A plain `GET`; a `GET` whose tag is stale (review) | one statement each: the answer and its tag of one snapshot; for the stale tag, 200 with the corrected answer and the new tag, in one statement |
| GH137-g | The base commit's tag (`league-history-v1-…`); another season's tag; a tag of this form with another digest; a malformed tag or header; the tag without `W/`; a list holding it; `*` | 200; 200; 200; 200; 304; 304; 304 |
| GH137-h | `*` or a valid tag with an unknown or repeated parameter; with a season not held, before 2010/11, after 2020/21, an unknown league | 400; 404 |
| GH137-i | Another release of the read API (`VEGA_RELEASE`) | another tag for the same rows; the same release, the same tag |
| GH137-j | 2015/16 (players), 2011/12 (scorers), 2020/21 (next season from PitchAPI 2021/22), Ligue 1 2019/20 (stopped) | the base commit's body |
| GH137-k | The four reads on the local archive, every league and season | the same rows (the matches in the same order); buffers and time a fraction of before, no sequential scan of `core.matches` |
| GH137-l | `infra/aws/api.yaml` | the behaviour and policy of GH137.1; the default policy unchanged (`MaxTTL` 60); no other behaviour on the new policy; the route's `s-maxage` within `MaxTTL` |
| GH137-m | The route's 400, 404, 503 | `no-store`: never kept by the edge |
| GH137-n | The local archive, each of six seasons: the plain GET, the conditional hit, the stale conditional GET, HEAD | one statement each; the hit and HEAD without rows; the stale GET's cost the plain GET's, not twice; the bodies the base commit's |

GH137-a–j, m: `backend/api/test/league-history-validator.test.mjs` (with the existing `league-history.test.mjs`); k, n:
the local archive and the base commit's code, outside the repository; l: `backend/tests/test_api_cache_behaviors.py` and
`cfn-lint`. Not verified here: production's plan and time; CloudFront's own behaviour (the template is checked, not
deployed).

What #137 asks beyond this route stays open: the other routes whose validator is a hash of the whole answer
(rankings, profiles, cups, standings, archives, World Cup, player form…). Here a revalidation still runs the four reads
in SQL (cheaper since 177); it spares the transfer of their rows, the building of the answer and its hash. A validator
that skips the reads entirely would need a version kept by every writer of the tables they read (matches, teams,
assets, provider ids, players, events, rounds, editions, player seasons): not done.
