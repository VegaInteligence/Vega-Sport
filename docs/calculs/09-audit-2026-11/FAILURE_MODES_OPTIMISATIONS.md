# Optimisations of 25 Nov 2026: failure modes, edge cases and expected outcomes (written before the tests)

A batch-specific file, beside the shared register [`FAILURE_MODES.md`](FAILURE_MODES.md), so that its sections do not
collide with that register's numbers (its § 62 is the match page's, on `main` since `fb0de18b`). Each section is named
by its GitHub issue and each case by the issue and a letter: GH220-a, GH194-a, GH137-a. Base `492a1361`.

- **GH220** (VI-158): the home's personal read with a followed player, and the check a Deploy makes of it.
- **GH194** (VI-134): the isolated pilot, by hand from `main`, its own provider key, a bounded run.
- **GH137** (VI-77) for `/api/league-history` only, with **GH145** (VI-85): its validator, its reads, an hour at the edge.

The batch of 26 Nov 2026 (branch `codex/audit-suite-2611`, base `e4014803`) adds, each written before its tests:

- **GH171** (VI-111): the statements' statistics of `vega_v2`, Performance Insights and the PostgreSQL log, without a
  password, a bound value or a row's value leaving the base.
- **GH149** (VI-89): the distribution's access logs (standard logging v2, us-east-1), a finite family per request, and
  the cache's hits, misses and refreshes by family.
- **GH157** (VI-97) and **GH158** (VI-98): a Deploy builds or reuses the worker's image before anything stops, migrates
  while the collection runs when it may, names the image by what goes into it, and keeps its own state.
- **GH202** (VI-142) and **GH204** (VI-144): the checks at the end of a Deploy, and the alarms and the dashboard.
- **GH129** (VI-69): the match page's season read once, the player page's reads started at once.
- **GH137M** (VI-77, with GH145, VI-85): `/api/matchdays`, the route production's counts of revalidations name first,
  read from the editions asked instead of `api.fixtures`; the same answers and validators, no longer edge time.

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

## GH137M. `/api/matchdays`: the rounds of the season asked, read from its own editions (GH #137, VI-77; GH #145, VI-85)

Counted in production (read only, by the coordinator, 26 Nov 2026; `optimisations-suite-2611/aws-revalidations-cibles-avant.json`,
`aws-cache-public-avant.json`). Over 24 hours, the answers 304 the read API gave for the support routes, with the base's
time they cost: `/api/matchdays` 56 (14.2 s in all, p95 477 ms), `/api/standings` 30 (24.2 s, p95 1 719 ms),
`/api/cup-snapshot` 8 (10.1 s), `/api/rankings/associations` 18 (1.1 s). Two plain GETs from Paris of Premier League
2026/27: `/api/matchdays` a `RefreshHit` of 748 ms (the origin's base 293 ms, one statement) then a `Hit` of 54 ms;
`/api/standings` a `Miss` of 1 046 ms then a `Hit`. These counts say what a revalidation costs at the origin, route by
route; two requests from one point of presence say nothing of the edge's hit ratio across visitors (GH149 measures
that). `/api/matchdays` is the most revalidated of them and its refresh was seen directly: it comes first. Read in the
code (`e4014803`): the route reads `api.match_rounds`, a view over `api.fixtures` (every match of the base with its
teams, crests, venue, referee and keys), filtered on the computed league id and on the season label or native label;
its validator is the SHA-256 of the answer, so a 304 costs the whole read. `/api/standings` (its withheld editions, the
match page's « Classement » relying on its 404) is left as it is.

### GH137M.1 Rules

- **The same answer, the same validator.** For every `competition` and `season`, the rows of `api.match_rounds` (each
  match's public id, its round's name, `playoff`), in the same order (the id), so the same body and the same ETag
  (`W/"catalog-v1-<sha256 of the body>"`): an edge or a browser holding a tag of before the change gets its 304 after
  it. No contract change: parameters, statuses, headers, body.
- **The exact editions first.** One statement, through a function of the `api` schema (`api.matchday_rounds(league,
  season)`, migration 180, `SECURITY DEFINER`, executable by `vega_read` alone): the league's editions (its current
  PitchAPI key, else `l_v` and its id, as `api.fixtures` names it; never an archive's or a cup's edition) whose
  season's label or native label is the one asked; then their matches through `matches_competition_kickoff` (the
  editions' ids given as an array), each with its round (`core.rounds`), its current PitchAPI key (else `m_v` and its
  id) and `playoff` (`has_playoff`, or a round of stage `playoff`), the round and the key looked up by index for each
  match (review of the first plan: estimating ten times the matches it took, the planner hashed every round and every
  match key of the base). Never `api.fixtures`, never another edition's match, round or key.
  `api.match_rounds` stays (the tests' oracle).
- **One snapshot.** The rows and the validator come from that one statement: the ETag is the hash of the answer built
  from its rows (every field of every match), so a 304 holds exactly when the answer would be the same.
- **Kept.** 400 for a missing, unknown, repeated or malformed parameter; 404 when no match of the selection has a
  round; HEAD and `If-None-Match` as before; `public, max-age=0, s-maxage=60`. The migration is marked `-- vega:online`
  (a function added: the worker's code is unaffected). What a revalidation still costs: the edition's matches read by
  index and the hash, not the base.
- **GH145 (the edge's time).** Not lengthened here: a longer time needs a perimeter of freshness for the route (which
  writes change a round or a play-off flag, how soon the site must show them), which these counts do not give. The
  access logs (GH149) can measure how often an answer changes, over a week for example, without that being a condition.
  The private and dynamic routes keep their policies, `/api/league-history` its hour.

### GH137M.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH137M-a | Every selection of the test base: a league by its PitchAPI key, by `l_v…` (no key), by a former key; a season by its label, by its native label (`2026` for a calendar-year league), not held; an archive's and a cup's edition; matches without a round, with a former key and a current one, without a key; a round of stage `playoff`; `has_playoff` | the base commit's status, body and ETag for each |
| GH137M-b | HEAD; GET with the answer's tag; with a stale tag; `*`; HEAD with the tag | 200 without a body and the tag; 304; 200 with the answer; 304; 304 |
| GH137M-c | A round renamed; a match moved to another round; `has_playoff` set; a round's stage set to `playoff`; a match's PitchAPI key changed; a match added to the edition, one taken out of it | another body and tag each, the base commit's; never 304 for the old tag |
| GH137M-d | Writes outside the selection: another edition's round, another league's match, a match of another season of the same league | the same tag, 304 |
| GH137M-e | An unknown league; a season not held; a league whose matches have no round; a malformed or missing parameter; a repeated or unknown one | 404; 404; 404; 400; 400 |
| GH137M-f | One request whose selection holds 126 matches in a base of 20 000 more (other editions, archives) | one statement; `core.matches`, `core.rounds` and `core.provider_ids` read without a sequential scan, at most twice the selection's rows fetched from each (the base commit's statement reads `core.matches` through; the first version of the function every match key and round) |
| GH137M-g | A local PostgreSQL 18 base sized on production (about 16 000 matches a season over six seasons, 150 000 archived): every league and season, the base commit's code and this one | identical status, body and ETag for each; their times and plans (`EXPLAIN ANALYZE`, buffers) |

GH137M-a–f: `backend/api/test/matchdays-lean.test.mjs` (with `reference.test.mjs`); g: outside the repository (the
evidence's `gh137/`). Not verifiable here: production's plan and time after the change (a Deploy, then the same
24-hour count).

## GH171. The statements' statistics, Performance Insights and the PostgreSQL log (GH #171, VI-111)

Seen before this change (re-read on `e4014803`): `shared_preload_libraries: pg_stat_statements` is set
(`database.yaml`) but no migration creates the extension, so no view reads what the module records; Performance
Insights is off; the PostgreSQL log is not exported (the statements over 2 s are only in RDS's files). Measured on the
local PostgreSQL 18.6 (the module preloaded, every setting at its default, as RDS's group leaves them), before any code:

- `CREATE ROLE … PASSWORD '<clear>'` and `ALTER ROLE … PASSWORD '<clear>'` are recorded **verbatim** in
  `pg_stat_statements.query` (`pg_stat_statements.track_utility` is `on`): the migrate task sets the three logins'
  passwords that way on every Deploy (`vega/migrate.py`, `ensure_logins`). The module records them whether or not the
  extension exists: a view created later shows what is already in shared memory.
- The same statement with a verifier computed by libpq (`PQencryptPasswordConn`, psycopg's
  `pgconn.encrypt_password`) records `PASSWORD 'SCRAM-SHA-256$4096:…'`: no clear password; with `track_utility` off it
  is not recorded at all.
- A bound value is never in `pg_stat_statements` (`SELECT $1::text`), but a statement slower than
  `log_min_duration_statement` is logged with `DETAIL: Parameters: $1 = '<value>'` (`log_parameter_max_length` is
  `-1`, every value in full); with `log_parameter_max_length = 0` the line has no value.
- A unique violation logs `DETAIL: Key (email)=(<value>) already exists.`; with `log_error_verbosity = terse` the
  DETAIL line is gone, the statement keeps its `$1`. The error's own message keeps the input it rejected (`invalid input
  syntax for type integer: "<input>"`) whatever the verbosity: only `log_min_messages` would hide it, and with it
  every error.

### GH171.1 Rules

- **Migration 179** (`179_statement_statistics.sql`, the next number on `main` at `e4014803`; marked `-- vega:online`,
  GH157): `CREATE EXTENSION IF NOT EXISTS pg_stat_statements` in `vega_v2` (in `public`, or where it already is);
  of the module's entries, only those the old rotation left (clear passwords): in this database, recorded for the login
  that runs 179 (the admin identity that ran every earlier rotation), whose text is exactly that statement
  (`ALTER ROLE "vega_v2_<collect|calc|read|account>" LOGIN PASSWORD '…'` or `CREATE ROLE …`, as `vega/migrate.py`
  wrote it until 179), reset one by one (`pg_stat_statements_reset(userid, dbid, queryid)`); nothing when the module
  is not loaded. Every other entry keeps its history and counters: an innocent read naming a `role`, `user` or
  `password` column or alias, another login's statements, another role's password statement, the other databases of
  the server; `pg_stat_statements_info` keeps its date of reset (reviews of 26 Nov 2026: a first version reset the
  whole server's statistics; a second reset every entry of this database mentioning a role and a password, innocent
  reads included, and again at every rotation); the extension's views and functions revoked
  from `PUBLIC`; one view `ops.statement_stats`: per normalized statement of this database (`queryid`), the login that
  ran it, its command (the first keyword: `SELECT`, `WITH`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY`, `CALL`, else
  `OTHER`), top level or nested, calls, rows, total, mean and largest time, shared blocks hit and read, temporary blocks
  written; never the statement's text. (A first version labelled the read API's statements by their leading
  `/*vega:v2:<read>*/`: the module records a statement from its first token, without that comment, so every row read
  `unlabelled`; found by GH171-d's first run.) No grant: `ops`'s default privileges would give it to `vega_collect`, they are revoked; the owner
  reads it.
- **Logins.** `ensure_logins` sends a verifier computed by libpq for the server's `password_encryption`, never the
  password; the verifier is as sensitive as the password here (review of 26 Nov 2026: an MD5 verifier logs in by
  itself, a SCRAM one opens an offline search). Nothing is cleaned afterwards (a transaction rolled back, a client gone,
  a cancel would leave the cleaning undone): recording and logging are prevented before anything is sent.
  - **The secure mode, checked first.** In the rotation's transaction, before any verifier leaves the process, the
    session's effective settings must keep a nested statement's text out of every channel: `log_error_verbosity`
    `terse` (no `CONTEXT` line: an error, a cancel, a termination or a lock wait during the nested statement would
    print it), `pg_stat_statements` not recording a nested utility statement (not loaded, or `track` `top`/`none`, or
    `track_utility` off), the `debug_print_*` dumps off. Each setting not yet so is set for the transaction when the
    role may (a superuser: CI's, a local server); RDS's administrator is not one: there the group's values
    (`database.yaml`: `terse`, `track_utility` 0) must be in effect. Otherwise the rotation refuses before sending
    anything (`LOGINS_REFUSED`, naming each setting and its value; exit 1): the passwords stay as they were.
  - **The path.** The verifiers reach the server as `COPY` data into a temporary table dropped at commit (in no
    statement's text and in no bound value); a `DO` block whose text holds no secret sets each password with a nested
    statement; `lock_timeout` below `deadlock_timeout`; a failure, a cancel (`query_canceled`, which `WHEN OTHERS`
    does not catch) or a `statement_timeout` is raised again as `the password of <login> could not be set
    (<SQLSTATE>)`. The top-level texts (`CREATE TEMPORARY TABLE`, `COPY … FROM STDIN`, the `DO` block) are the only
    ones a statement, slow-statement, error or lock-wait line, Performance Insights or `pg_stat_activity` can show.
  - **Guaranteed:** under the secure mode, neither `pg_stat_statements` nor the server's log holds a login's password
    or verifier, whether the rotation succeeds, fails on any login, is cancelled, times out or loses its client.
    `auto_explain` (not loaded, GH171.1 « Not assumed ») does not explain utility statements.
- **Parameter group** (all dynamic: applied without a restart; `shared_preload_libraries` unchanged, no
  `auto_explain`): `pg_stat_statements.track = all` (the statements inside the SQL and PL/pgSQL functions, normalized),
  `pg_stat_statements.track_utility = 0`, `track_io_timing = 1`, `log_parameter_max_length = 0`,
  `log_parameter_max_length_on_error = 0`, `log_error_verbosity = terse`, `log_lock_waits = 1`, `log_temp_files`
  10 MB; `log_min_duration_statement` stays at 2 s.
- **Instance.** Performance Insights on, 7 days (the free retention), Database Insights `standard`, on the classes that
  take it (not `db.t4g.micro`/`small`, the template's default); the `postgresql` log exported to
  `/aws/rds/instance/vega-football-db-postgres/postgresql`, created by the stack before the export with 14 days'
  retention (an export creates its group without a retention otherwise).
- **Not assumed.** No restart, no `auto_explain` (its plans would carry the values of `EXPLAIN`'d parameters), no
  grant of `pg_read_all_stats`. The deploy role's CloudFormation role gets the RDS log group only.

### GH171.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH171-a | A fresh base migrated to 179 (the module preloaded) | the extension in `vega_v2`; `ops.statement_stats` answers; its columns as GH171.1, no `query` column |
| GH171-b | The same files applied again; a base where the extension already exists (created by hand, before 179) | nothing applied again; 179 applies, the view reads the existing extension |
| GH171-c | A base without the preload (a local server; CI's preloads it, as the base) | 179 applies (no reset, no error); the view exists; reading it fails as the module says (not a silent empty view) |
| GH171-d | Statements run after 179: the read API's search (real handler, twice), a worker login's read | the search's statement under `vega_read` with its two calls, its command `WITH`; the worker's under `vega_v2_collect`; every command one of the list |
| GH171-e | `PUBLIC`, `vega_collect`, `vega_calc`, `vega_read` | no `SELECT` on `ops.statement_stats`, no `SELECT` on the extension's views, no `EXECUTE` on its functions |
| GH171-f | Production before 179: the base commit's rotation (clear passwords) as the admin, beside innocent reads of the admin naming `role`, `user` and `password` aliases, another login's statements and another role's password statement; then 179 | the old rotation's statements gone; every other entry kept with its counts; never a text in the view |
| GH171-g | `python -m vega.migrate` with the logins' passwords, the extension present | the logins log in with their passwords; no password in `pg_stat_statements` (track_utility on, the default), nor in the server's log |
| GH171-h | A slow statement with a bound value, an error with a row's value, under the group's settings (set in the session as the group sets them) | no value in the log; under the defaults the same lines hold them (the settings are what removes them) |
| GH171-i | `database.yaml` | the group's settings and the instance's properties of GH171.1; the log group before the instance; `shared_preload_libraries` unchanged; no `auto_explain`; `cfn-lint` clean |
| GH171-j | `deploy-roles.yaml` | the CloudFormation role may create, tag and set the retention of the RDS log group, nothing wider |
| GH171-k | One server, two bases with their own activity (statements run 2 and 3 times, a password statement in each), then 179 on `vega_v2` alone | every entry of the other base with its counts; this base's innocent entry with its counts; `pg_stat_statements_info.stats_reset` unchanged |
| GH171-l | A rotation by an administrator who is not a superuser (as RDS's), under the worst settings a server can have before its group applies (`track` all, `track_utility` on, verbose errors, `log_statement` all, `log_min_duration_statement` 0, lock waits logged, bound values in full, `deadlock_timeout` 200 ms), another session holding the last login's row | refused before anything is sent: exit 1, `LOGINS_REFUSED` naming `log_error_verbosity` and `pg_stat_statements.track_utility`; checked at once, before any retry: no password or verifier (`SCRAM-SHA-256$`, `md5…`) in `pg_stat_statements` or in the server's log of the window; the old passwords still log in |
| GH171-m | The same administrator under the group's settings (`database.yaml`'s values in effect): the rotation failing on the last login (its row held); cancelled by `pg_cancel_backend` during its nested statement; stopped by its own `statement_timeout`; its client killed mid-rotation; two rotations at once; then a retry, and a second rotation | each failure exits 1 with `the password of <login> could not be set (<SQLSTATE>)` (55P03, 57014), the client's death leaves the old passwords; checked at once after each, before any retry: no secret in `pg_stat_statements` or the log; the retry sets the new passwords (they log in); innocent entries keep their counts across the rotations (no purge) |
| GH171-n | A superuser's rotation (CI's, a local server) under the worst settings, failing on the last login, then succeeding | the secure mode set for the transaction, nothing refused; checked at once after the failure and after the success: no secret in `pg_stat_statements` or the log |
| GH171-o | The calculator's inventory of the views (`test_calculator.ApiViewTest.test_every_view_answers`), which counted four `ops` views before 179: CI's run of PR #241 (707f5e03) failed on `5 != 4` | the `ops` views named one by one: the three of 012 (`v_backlog`, `v_coverage_gaps`, `v_freshness`), live reliability (042), `statement_stats` (179); every view still read, `ops.statement_stats` included on the preloaded server (CI's); on a server without the preload its read refuses as GH171-c says (55000), the others are read |

GH171-o: `backend/tests/test_calculator.py` (`VEGA_V2_AGG_TEST_DSN`). GH171-a–h, k–n: `backend/tests/test_statement_statistics.py` on the local PostgreSQL 18 (`VEGA_V2_STATEMENTS_TEST_DSN`);
the server's log for GH171-l–n is read from its container (`VEGA_V2_PG_CONTAINER`, CI's service container: `ci.yml`
passes `job.services.postgres.id`), for GH171-h outside the repository (evidence). RDS's administrator is played by a
local login without `SUPERUSER` (`CREATEROLE`, `ADMIN` on the logins and roles it rotates, as RDS's master holds them);
RDS itself is not verified here. GH171-i, j:
`backend/tests/test_statement_statistics.py` (template) and `cfn-lint`. Not verifiable here: RDS's own application of
the group (dynamic parameters apply at once; checked after a Deploy with the commands of `infra/aws/README.md`),
Performance Insights' screens, the export's first lines.

## GH149. The distribution's access logs and the cache by family (GH #149, VI-89)

Seen before this change (`e4014803`): the distribution has no log (`api.yaml`, no `Logging`, no delivery); the function's
request lines (`/aws/lambda/vega-v2-api`) are the calls that reached it, so the share of each route the edge answers
(hits), revalidates (refresh hits) or passes on (misses) is unknown, and #137 / #145 cannot choose their next route from
counts. AWS's documentation (read on 26 Nov 2026, `standard-logging.html`, `general-helper-methods.html`): standard
logging v2 is set up with CloudWatch Logs' delivery API in us-east-1 (`DeliverySource` of the distribution, log type
`ACCESS_LOGS`, `DeliveryDestination`, `Delivery` naming its `RecordFields`); a CloudWatch Logs destination is a log
group whose name matches `[\w-]`; a viewer-request function of the `cloudfront-js-2.0` runtime writes the field
`viewer-request-log-data` with `cf.logCustomData(<string>)` (the `cloudfront` module; URL-encoded, 800 bytes at most,
the last call kept; `-` without a function or without a call).

### GH149.1 Rules

- **What a record holds, and nothing else.** `timestamp(ms)`, `cache-behavior-path-pattern`,
  `viewer-request-log-data`, `cs-method`, `sc-status`, `x-edge-result-type`, `x-edge-response-result-type`,
  `x-edge-detailed-result-type`, `time-taken`, `time-to-first-byte`, `origin-fbl`, `origin-lbl`, `sc-bytes`. Never the
  viewer's address (`c-ip`, `x-forwarded-for`), the path or the query (`cs-uri-stem`, `cs-uri-query`), a cookie, the
  user agent, the referer, the request's id, the country, the ASN or the host.
- **The family** (`viewer-request-log-data`): the function `vega-v2-api-family` (`cloudfront-js-2.0`, viewer request)
  names the request by its route, the path after `/api/` (or `live/`) with each identifier (`m_…`, `p_…`, `t_…`,
  `l_…`, a World Cup match's key) written `id` and the segments joined by dots (`read.player`, `matches.id.summary`,
  `players.id.injuries`, `live.matches.id`); a path that is not one of the read API's or the live function's routes is
  `other`. The set is finite and closed: the function holds the list, and a test fails when a route of the read API
  has no family or a family no route. The function returns the request as it came: no header, path, query, cache key or
  origin changes.
- **Where.** On the default behaviour and on `api/league-history`, `api/ops/*` and `live/*`; not on `data/*` (the image
  copies: their records say `-` and the behaviour `data/*`, and the report names them `media`).
- **Delivery.** Stack `vega-v2-edge-logs` (`edge-logs.yaml`, us-east-1, deployed after the read API stack): the log
  group `vega-v2-api-access`, 14 days; the delivery source of the distribution, the destination (JSON), the delivery
  with the fields above; the saved queries `vega-v2/api-cache-by-family`, `vega-v2/api-latency-by-family` (every
  behaviour but `data/*`, the values of the function's form but `other`, by value), `vega-v2/api-latency-other` (every
  behaviour but `data/*`: `other` and the values outside the form, pooled) and `vega-v2/api-latency-media` (`data/*` alone). The CloudFormation role may create these and set
  the log group's resource policy for `delivery.logs.amazonaws.com`, in us-east-1, under `vega-v2-*` names only; the
  deploy role may deploy that stack only.
- **The aggregate.** Per family, over a window given with both ends: requests; `Hit`, `RefreshHit`, `Miss`, errors
  (`Error`, or a status of 400 or more), others; the hit share `Hit / (Hit + RefreshHit + Miss)` and the refresh share,
  over GET and HEAD answers below 400 only; bytes sent; the median and 95th percentile of `time-taken`. The probe
  (`health`), the status page (`ops.status`), the image copies (`media`), `other` and `unlogged` are reported on their
  own lines, never in a family's shares. Two ways, one fold: `infra/aws/edge-cache-report.mjs --records <file> --from
  --to` on records as delivered, or `--live` (the saved queries through `aws logs start-query`, us-east-1).
- **One family per record, the same in both ways** (review of 26 Nov 2026: the delivery writes `-` for a field the
  function did not set, `data/*` among them, and the latency query grouped by that field alone, so `media`'s times
  were filed under `-`): `data/*` is `media`; a record without a family (`-`, the delivery's mark of no value:
  CloudFront answered before the function ran; a field absent from a record is read so) is `unlogged`; a value not of
  the function's form (`[a-z0-9.-]{1,40}`, read as delivered, never decoded) is `other`. The volumes, the shares'
  denominator and the percentiles use that family in `--records` and in `--live`; `--live`'s percentiles come from
  groups that are each exactly one family — the latency query groups the values of the form outside `data/*` by value
  (`-` is `unlogged`), `other` (the function's name for an unknown route) left out; `other`'s query pools `other` and
  the values outside the form; `media`'s takes `data/*` alone — never percentiles merged after the fact. The queries
  read the family as `coalesce(<field>, "-")` (counter-review of 26 Nov 2026, 05 h 21: a record without the field was in
  `unlogged`'s volumes but in no latency group, its p95 0.9 s live against 0.02 s locally).
- **One window, both ways** (counter-review of 26 Nov 2026, 05 h 23: `--records` compared milliseconds, Logs Insights
  rounds its range to the second). The window is `[from, to)` in milliseconds, its end excluded: `--records` compares
  each record's `timestamp(ms)`; `--live` asks Logs Insights for the whole seconds that cover it (start rounded down,
  end rounded up) and filters every query on `toMillis(@timestamp)` to the same bounds. Two adjacent windows share no
  record; a bound may fall inside a second. `--live`'s percentiles are Logs
  Insights' `pct()`; `--records`' the nearest rank.
- **#137 / #145.** No TTL and no validator changes here. The next route is chosen from real counts: the 24-hour count
  of revalidations at the origin already named `/api/matchdays` (GH137M); the report's counts by family can name the
  next ones (a week of logs is one possible window of analysis, not a condition); none is invented here.

### GH149.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH149-a | Every route of the read API and of the live function (the paths of `backend/api/src`, the site's reads of the reference session) | a family that is not `other`, each family one route; the read API's handler claims every family's route |
| GH149-b | A path with identifiers, a query, a cookie, an unknown route (`/api/read/<anything>`, `/api/x/../../etc`), a long path, a path of the image copies' shape, `/` | the family by route with `id`, never an identifier, a query value or a segment outside the list; `other` for the rest; at most 40 bytes |
| GH149-c | The function's result | the event's request object, unchanged (headers, uri, querystring, cookies, method) |
| GH149-d | Representative requests (the reference session's match and player pages, the probe, the status page, an image copy, an unknown path) run through the function, then delivered records built with the template's fields, outcomes hit, refresh hit, miss, error | the report's table: each family's counts, shares and volumes as computed by hand; the probe, the status page, `media` and `other` apart; no record holds a field outside the list |
| GH149-e | The report without `--from` or `--to`, an inverted window, records outside the window, a record with an unknown field, a malformed line | exit 2 on the arguments; records outside left out; the unknown field refused (exit 1, named), the malformed line counted as malformed, not guessed |
| GH149-f | `edge-logs.yaml` | us-east-1 asserted; the log group's name matches `[\w-]+`, 14 days; the delivery's fields exactly the list; the source's log type `ACCESS_LOGS` on this distribution; the saved query reads that group; `cfn-lint` clean for us-east-1 |
| GH149-g | `api.yaml` | the function on the four behaviours, viewer request, not on `data/*`; no cache policy, origin or path pattern changed |
| GH149-h | `deploy.sh`, `deploy-roles.yaml` | the edge logs stack after the read API stack, in us-east-1, with the distribution's id; the deploy role may deploy `vega-v2-edge-logs` only; the CloudFormation role's delivery and log rights in us-east-1, named resources |
| GH149-i | The same delivered records (hits, refresh hits, misses, errors; `read.player`, `ops.status`, `other`, `media` on `data/*` with `-`, `-` on the default behaviour, a slow record without the field at all) folded locally, and answered by the four saved queries as Logs Insights would (their groups, `-` included; two values outside the form pooled in `other`'s query) folded live | one table both ways: `media`, `unlogged` and `other` with their requests, bytes and percentiles, apart; no `-` family; each share over the same denominator |
| GH149-j | Records at a window's start, one millisecond before its end, at its end, and inside one second split by a bound at .500; two adjacent windows `[t0, t1)` and `[t1, t2)`, each folded locally and through the saved queries (Logs Insights given whole seconds that cover it, as AWS takes them) | each record in one window only, the one at `t1` in the second; the same counts both ways for each window; the two windows' sums those of `[t0, t2)` |

GH149-a–e, i, j: `backend/api/test/edge-logs.test.mjs` (the function's code read from `api.yaml`, run as CloudFront runs it:
the `cloudfront` module's `logCustomData`; the real handler for a); f–h: `backend/tests/test_edge_logs.py` and
`cfn-lint`. Not verifiable here: CloudFront's own delivery and its field values (checked once deployed: README), real
hit shares.

## GH157 and GH158. A Deploy builds or reuses the worker's image before anything stops, migrates while the collection runs when it may, and keeps its own state (GH #157, VI-97; GH #158, VI-98)

Seen before this change (`deploy.sh` of `e4014803`): step 3 sets the worker and the backfill to 0, then the image is
built and pushed, the migrations run, and step 6 starts both again: every Deploy stops the collection for the build,
the push, the migrate task and two stack updates, even when only the site or the read API changed (the image is tagged
with the commit, so every commit is a new image and a restart). Also seen: a failure reading the backfill's count
(`describe-stacks … 2>/dev/null || true`) reads as 0, and a Deploy that failed after step 3 leaves the backfill at 0,
which the next Deploy then keeps; `describe-images` failing for any reason (a refusal, expired credentials) reads as
« no image » and builds; the first Deploy needs the worker stack before the image (the repository is in it).

### GH157/158.1 Rules

- **Two identities.** The commit (`IMAGE_TAG`, `HEAD` by default) names the clean export the Deploy reads, and
  nothing else. The worker's image is named by what it is made of: `infra/aws/image_identity.py` asks BuildKit for the
  build context as it sends it (`docker build -f backend/Dockerfile --target context --output type=local`: the
  Dockerfile's own `.dockerignore`, no parser of ours), then hashes, in a fixed order, the identity's version, the
  platform (`linux/arm64`), the Dockerfile's and the ignore file's bytes, and each file of the context (path, type,
  mode, contents or link target): 64 hexadecimal characters, the tag of `vega-v2-worker`. The base image is pinned by
  digest in the Dockerfile. What a build resolves by itself (Debian's `nodejs`, pip's unpinned dependencies of
  `boto3`) is not in the identity: an image keeps them until one of its inputs changes; to take newer ones, change the
  Dockerfile's `VEGA_DEPS_REFRESH` (or its base digest): a new identity, one rebuild, one restart (GH158-g: the
  apt and pip layers read it, so a warm builder runs them again; a comment would not).
- **The image before anything stops.** The repository answered: its image is reused when `describe-images` finds the
  identity's tag (no build, no push), built and pushed when it answers `ImageNotFoundException`; any other answer (a
  refusal, an expired session, a network error) stops the Deploy there, nothing stopped. The repository missing
  (`RepositoryNotFoundException`) with the worker stack missing too: a first install, the worker stack created with
  both services at 0, then the image; the repository missing while the stack exists: stop (named). The registry
  login failing: stop before anything stops.
- **Migrations while collecting.** A migration file whose header holds the line `-- vega:online` keeps the code of
  the previous Deploy working while and after it applies (additive only: new objects, functions or views redefined
  with the same columns). The migrate task of the candidate image runs first as `python -m vega.migrate --online`:
  - the base holds a migration the image does not know: exit 4, nothing applied (an older image never runs on a newer
    base); a file applied with other bytes: exit 1, nothing applied;
  - every pending file marked: applied, the account's files and the logins too, while the old worker runs; exit 0;
  - a pending file not marked (every file before 179): nothing applied, exit 3; the Deploy then stops the services and
    runs `python -m vega.migrate` (the same checks, then everything). A file is applied in its own transaction: a
    failing one leaves the earlier ones applied, and stops the run.
- **The candidate's migrations, without touching the services.** Before the online run the worker stack's tasks
  (migrate, archives) take the candidate's image by `TaskImageTag`, with `update-stack --use-previous-template` and
  every other parameter's previous value: the services' task definitions do not change. This requires the template
  that stack was last deployed with to be the candidate's (`TemplateDigest`, the SHA-256 of `worker.yaml`, recorded
  by each Deploy in the stack); another or unknown (the first Deploy after this change): the services are stopped
  first (below), then the candidate's template applied.
- **Stopping.** Only for a pending unmarked file, another template, or a previous Deploy that left the services
  stopped. Before any count changes, the Deploy writes in its state the counts and image the services have; it stops
  them with `update-stack --use-previous-template` (the counts alone change), then applies the candidate's template
  and image with both counts at 0, marks the state « unsafe » and runs the full migrate task. One final update gives
  the services the candidate's image, template, secrets' revision and counts: one replacement of each task at most.
- **Counts.** The worker: `WORKER_DESIRED_COUNT` 0 or 1 when given; `keep` or unset (the workflow's default since the
  review of 26 Nov 2026): the count a previous Deploy saved when it stopped them and could not restore, else the
  stack's own, else 1 (a first install). The backfill: `BACKFILL_DESIRED_COUNT`; without it, the count a previous
  Deploy saved; without that, the stack's own (a stack that does not exist: 0; any other error reading it: stop).
- **Same image.** No build, no push; the final update changes nothing of a service whose image, template, secrets'
  revision (`SecretsRevision`: the versions of the SSM parameters the services read, no value: a rotation replaces the
  tasks once) and odds parameter are unchanged: counts are reconciled without a replacement. The migrate task runs on
  every Deploy, online: the account switched on, a login's password rotated, a migration a failed Deploy left pending
  are applied without stopping anything.
- **The Deploy's state** (`s3://vega-v2-deploy-state-…/state.json` since GH157.3, read and written with S3's conditional
  requests only: created if absent, replaced if unchanged since read). It holds the owner (the run), its last sign of life,
  the phase (`idle`, `running`, `stopped`), the counts and image saved, whether the template or image of the stopped
  services changed (`changed`), and whether a full migration started and has not succeeded (`unsafe`).
  - Held by another run: the Deploy stops before changing anything (`another Deploy …`), unless that run is known
    finished (its GitHub run `completed`) or `DEPLOY_TAKEOVER` names it (GH157.3: a lease's age proves nothing). Taken
    over: its saved counts and flags kept, said. A write that finds the state changed since read (another run): stop.
  - **Held before each change** (review of 26 Nov 2026: a run whose lease expired while it was busy — a slow build or
    push, a long wait — kept changing stacks after another run took the state over, and its exit restored counts on a
    stack no longer its own). Before each step that changes the worker, the backfill, the base or a stack (the online
    path's task image and migrate, the stop, the candidate's template, the full migrate, the final update, the stacks
    after it), the run writes its state again (a conditional write, which also renews its lease). Refused because
    another run holds it: the state is lost to this run, which stops at once: no further change, no restore, no
    release; it names the run now holding it. The workflow runs one Deploy at a time (`concurrency: vega-v2-deploy`);
    a workstation's run, or a run whose job died, is what this guards against.
  - On failure (any error, a signal): the services stopped, their template and image unchanged (`changed` false,
    `unsafe` false): restored at once to the saved counts, by `--use-previous-template` (exactly what ran before:
    known compatible). Otherwise they stay stopped and the Deploy says why and what the next one does: it restores the
    saved counts on the candidate's image once its own migrations succeed. Never a restart of an older image on a base
    a migration may have changed. The owner is released in both cases (the next Deploy needs no takeover). The restore
    comes after the state is written again (still this run's) and goes through the fence (GH157.3).
- **Order.** Preflight (account, the roles' grants: `DeployGrants` of `vega-v2-deploy-roles`), the state taken, the
  database, the secrets, the image, the tasks' image, the online migrate, [stop, the candidate's template, the full
  migrate], the services, live, the read API, the edge logs, archives, alerts, account, the checks; the state released.

### GH157/158.3 Review of 26 Nov 2026 (independent review of `8bf6f48a`)

- **One authority, before any creation** (review of the tree `27068a52`, 05 h 26 – 05 h 30: an SSM lock relayed to an
  object of the release bucket, which the worker stack creates, left windows where two runs each held one; an SSM
  fence written after the state could be written again by a run that woke up, and a change set keeps the SSM values it
  was created with; a fence parameter in every template broke the README's manual commands before the first Deploy).
  The Deploy's state is one object, `s3://vega-v2-deploy-state-<account>-<region>/state.json`, in a private bucket the
  roles stack creates (`vega-v2-deploy-roles`, the owner's and already a prerequisite of any Deploy; versioned,
  encrypted, no public access); the deploy role may read and write that object alone. Every run, a first install
  included, takes it with a conditional write before its first change; it says who deploys, the counts and image to
  restore, the migrate task asked for. No SSM lock, no fence, no template parameter for it.
- **Another run's state** (P1). Taken over only from a run known dead, never for its age: a GitHub run
  (`gh-<run>-<attempt>`) once GitHub answers that attempt `completed` (a hosted runner's job is over and its machine
  gone; the workflow's token, `actions: read`); a workstation's run (`host:<host>:<pid>:<token>`, a host being its short
  name and a digest of its machine identity, `<token>` 32 random hex digits of its own) once its lock is found in this
  machine's lock directory and free: the run holds, from its start, a lock its children inherit (descriptor 9 on
  `<DEPLOY_LOCK_DIR, /tmp>/vega-deploy-<token>.lock`, `infra/aws/run_lock.py`), so that an `aws cloudformation deploy`
  its shell left behind (CreateChangeSet, its wait and ExecuteChangeSet are separate requests) keeps it held
  (counter-review of 06 h 07: a shell's PID alone was taken for the run). Held, the run lives; absent or unreadable
  here, or a name without a run token (an earlier Deploy's), nothing is proved (counter-review of 06 h 48): another
  machine's run — of any name and identity, a clone, each with its own /tmp — or this one's before a restart or a
  cleaning of /tmp; only the owner's attestation with the maintenance entry `python3 infra/aws/deploy_state.py abandon
  --holder <name> --reason <why>` lets the next Deploy take it over, and that entry is refused for a GitHub run and for
  a run whose lock is here (held, or free: the Deploy takes it over itself). A machine without an identity of its own,
  or with a placeholder (`uninitialized`, 32 zeros, a null or malformed `IOPlatformUUID`), names no host: a
  workstation's Deploy stops there before anything (GH157-af). `DEPLOY_TAKEOVER` no longer exists: a flag
  cannot tell a live process. Otherwise the run stops before any change, saying what would prove the other dead.
- **What a dead run left**, reconciled before the first change (taken over or not). Each stack's operation in
  progress (`*_IN_PROGRESS`) is awaited to its end, within bounds; `REVIEW_IN_PROGRESS` — a stack whose creating
  change set was never executed — is no operation (the next `deploy` creates its own change set on it); then each
  status is read again. No change set is deleted: executing one makes CloudFormation delete a stack's others, and a
  manual one is the owner's. The migrate task the state names is settled (below), and no migrate task of the family
  may run when this run starts its own (a missing cluster is accepted only on a first install).
- **Durable migrate tasks** (05 h 25, 05 h 28). The intent, written before RunTask, holds the task's immutable
  identity: its token (`startedBy` and `clientToken`, at most 36 characters), the exact task definition revision (the
  worker stack's `MigrationTaskDefinition`), the command, the security group, the time asked. RunTask's answer: a task,
  whose ARN is written; `tasks` empty with `failures`, or a client error that rejects the request
  (`InvalidParameterException`, `ClientException`, `AccessDeniedException`, `ClusterNotFoundException`,
  `PlatformUnknownException`), to the intent's very first attempt: no task, the intent cleared, the run stops; any other
  end (a timeout, a throttling, an answer lost): unknown, the same request replayed with the same token and parameters,
  so that ECS returns the task it created or creates it now, once, up to three times; still unknown, the intent stays
  and the run stops. A refusal is final for the request it answers (the tries end), but after an answer lost, or for a
  later run's replay, it proves nothing of the first request, which may have started a task (counter-review of 06 h 08,
  an IAM refusal included): the intent stays, as unknown; only a task returned settles it. The CLI sends each RunTask
  once (`AWS_MAX_ATTEMPTS=1` on that call alone, counter-review of 06 h 28): its own retries (three requests in its
  standard mode) answer only the last, which would hide a first request whose answer was lost behind the refusal of
  the next; the run's loop does the retrying. Settling an intent (the next
  run, or before any migrate task): with its ARN, waited for until `STOPPED` and its exit read. ECS keeps a stopped
  task an hour at least and a task stops after its ARN is answered, so `MISSING` within an hour of that answer (the
  state's `migrate.seen`; a task just listed counts as just answered) is a task not visible yet (DescribeTasks lagging
  behind RunTask): waited for, as a running one; `MISSING` later (ECS no longer knows a task stopped beyond its
  retention) with no migrate task running: its outcome is unknown, and the run's own migrations reconcile the base's
  journal (the candidate image's checks: exit 4 for a base newer than it) before any service starts. Without ARN, a
  task running under its token is waited for, else the request is replayed within an hour of its asking
  (`MIGRATE_REPLAY_WINDOW`, well inside what ECS keeps); later, it is suspended: the run stops, naming what to check —
  the family's stopped tasks (`list-tasks --family vega-v2-migrate --desired-status STOPPED`, since ListTasks takes
  `startedBy` only as its sole filter), those of them under that token (`describe-tasks`, filtered by `startedBy`),
  else the migrate log once ECS has forgotten it — and the maintenance entry `python3 infra/aws/deploy_state.py
  resolve-migrate --token <token> (--arn <arn> | --none) --reason <what was checked>`. Never a second migrate task on
  an empty list, never a service started on an unknown outcome.
- **The intent before the stack's change** (05 h 29). Before the candidate's template and image are submitted to the
  worker stack, the state says `changed`; before the full migrate's RunTask, `unsafe`. On failure the stopped services
  are restored only when the stack has no operation in progress and its `ImageTag` and `TemplateDigest` are still
  those saved when they were stopped (an update rolled back); otherwise they stay stopped with their saved counts,
  whatever the CLI answered.
- **A first install** (05 h 27). Its target counts (the worker's `WORKER_DESIRED_COUNT`, 1 for `keep`; the backfill's
  `BACKFILL_DESIRED_COUNT`, else 0) are saved in the state as a stop's are, before the worker stack is created at 0 and
  before the image is built: a failure afterwards leaves them, and the next run (`keep`) starts the services with them
  once its migrations succeed. A stack at 0 by an existing install's choice (nothing saved) keeps 0. The release
  bucket missing beside the worker stack or the repository: stop before any change (the owner restores it).
- **The README's manual entries** (05 h 20, 05 h 29 P2): the base's first sizing (`database.yaml`), the web ACL's keys
  and mode (`waf.yaml`), the read API's web ACL detached in an emergency (`update-stack --use-previous-template`) run
  as before the review: no parameter they do not give, no SSM parameter, before the first Deploy as after; the roles
  stack comes first (it creates the state's bucket).
- **Counts kept** (P2: `COUNT=1` by default lost a worker stopped on purpose). « Counts » above; the workflow's input
  `worker_desired_count` is `keep`, `1` or `0`, `keep` by default, passed as given.
- **A first install, alone and consistent** (P1: the release bucket missing while the repository and the worker stack
  existed left the run without state nor lock). The release bucket missing is a first install only when the worker
  stack and the repository are missing too; otherwise the Deploy stops before any change, naming what is missing and
  what exists. A first install takes, before any change (the database, the secrets), a lock that exists before any
  bucket: SSM `/vega/v2/deploy-bootstrap`, created without `--overwrite` (one run succeeds; another stops, naming it;
  `DEPLOY_TAKEOVER` naming a dead one replaces it, then reads it back as its own). Once the worker stack has created
  the bucket, the state is taken there and the bootstrap parameter deleted.
- **The grants, call by call** (P1: `ecr:DescribeRepositories`, called at step 3 since GH157, was not granted to
  `vega-v2-deploy`). Every AWS call the Deploy makes itself (`deploy.sh`, `deploy_state.py`, `ci/secrets.sh`,
  `verify-deploy.mjs`) is in one table of `backend/tests/test_deploy_grants.py` with its IAM action(s), resource and
  region: the test fails for a call missing from the table, and for an entry `vega-v2-deploy` does not grant on that
  resource. What CloudFormation does to the stacks' resources is `vega-v2-cloudformation`'s. The state's object is the deploy role's only
  grant on the state's bucket; the release bucket's existence is read with `s3:ListBucket` on it alone (`head-bucket`).
- **The CloudFormation role and the two buckets** (P1: AWS's handler for `AWS::S3::Bucket` reads every configuration
  back after creating a bucket — `s3:ListBucket`, `s3:GetLifecycleConfiguration`, … — which `s3:GetBucket*` does not
  match). The role's `Buckets` statement names, on the media and release buckets only, the actions AWS's handlers
  document (CloudFormation's registry schemas of `AWS::S3::Bucket` and `AWS::S3::BucketPolicy`, vendored with their
  source and digests in `backend/tests/fixtures/cfn-handlers.json`): the whole read handler; of create and update,
  the actions of the properties the templates set (name, public access block, ownership, encryption, tags) and the
  handler's own checks (`s3:GetBucketAcl`, `s3:ListBucket`); delete; the media bucket's policy. No wildcard action.
  A first install's prerequisites, all the owner's: the stack `vega-v2-deploy-roles` (these grants), GitHub's OIDC
  provider, the PitchAPI key; the Deploy creates everything else. Not verifiable here: AWS's evaluation of these
  policies (checked against what AWS documents, not by AWS).

### GH157/158.2 Failure modes and expected outcomes

| # | Situation (the real `deploy.sh`, entered as the workflow enters it: no export variable, a git commit exported by `git archive`) | Expected |
|---|---|---|
| GH157-a | The stacks as production has them (state absent, the worker stack without `TemplateDigest`), the same commit deployed twice | first run: image built before any count changes, the services stopped (the template unknown), the full migrate, one start; the second: no build, the online migrate, no stop, no task replaced, `done` |
| GH157-b | A first install (no repository, no stack, no bucket) | the worker stack created at 0, the image built and pushed, the full migrate, the services started; the state written once the bucket exists |
| GH157-c | `describe-repositories` or `describe-images` refused (AccessDenied), the registry login failing, the session expired | stop before any count changes and before any stack is deployed after the database and the secrets; no build when refused |
| GH157-d | The repository missing, the worker stack present | stop, named, nothing stopped |
| GH157-e | A candidate with a new marked migration (179), the template unchanged | the tasks' image updated by the previous template, the online migrate applies it while the worker runs (desired 1 throughout), one final update: one replacement |
| GH157-f | A candidate with a new unmarked migration | the online migrate exits 3, nothing applied; the counts saved, then the services stopped, the candidate's template, the full migrate, the services started with the saved backfill |
| GH157-g | The base holds a migration the candidate does not know (an older commit after a newer Deploy) | the online migrate exits 4; the Deploy stops, nothing stopped, nothing applied |
| GH157-h | The full migrate fails (a file errors after earlier ones applied), or its waiter times out, or its task gives no exit code | the services stay stopped, the state `unsafe` with the saved counts; no restart of the old image; the log says what the next Deploy does |
| GH157-i | The same, then a retry of the corrected (or the same) candidate | the saved counts restored exactly (the backfill 1 though the stack says 0), after the retry's own migrations |
| GH157-j | A failure after the services stopped and before their template or image changed (the candidate's template update rolled back) | restored at once to the saved counts by the previous template; the state idle |
| GH157-k | `BACKFILL_DESIRED_COUNT=0` (history collected), then a Deploy without it; a stack whose count cannot be read (AccessDenied) | 0, then 0 again; stop before any change |
| GH157-l | Another run holds the state (seen 5 minutes ago); a run killed 2 hours ago (its GitHub run `completed`) left it `stopped` with saved counts; two Deploys write it between one's read and write | refused, nothing changed; taken over with its saved counts kept and restored; the second write fails (412) and that Deploy stops |
| GH157-m | The Deploy killed (SIGKILL) after the services stopped (its GitHub run then `completed`), then a new Deploy | the state still holds the saved counts; the new Deploy takes it over and restores them |
| GH157-n | A failure in the online path (the online migrate fails, or a later stack) | the services never stopped; the state released; `unsafe` not set |
| GH157-o | Another run takes the state over while this one pushes its image (its lease expired), then this one resumes | it stops at its next change: no stack, task or service changed after the push, the other run's state untouched (not released) |
| GH157-p | Another run takes the state over right after this one stopped the services (saved counts, `changed` and `unsafe` false); then a third Deploy run with `DEPLOY_TAKEOVER` naming the second | the first stops before the candidate's template: no template, no migrate, no restore by its exit, the state the second's; the third takes it over and restores the saved counts once its migrations succeed |
| GH157-q | Every AWS call the Deploy makes itself, against the role `vega-v2-deploy` | each in the table (a call missing from it fails), each granted on its resource and region; before: `ecr:DescribeRepositories` not granted |
| GH157-r | The CloudFormation role's grants on the two buckets, against AWS's handler permissions (vendored) | the whole read handler, create and update of the properties set, delete, the media bucket's policy; on those two buckets only; no wildcard action; before: `s3:ListBucket`, `s3:Get…Configuration` missing |
| GH157-s | The release bucket missing while the worker stack exists; while the repository alone exists | stop before any change (no database stack, no secret, no state written), naming what is missing and what exists |
| GH157-t | Two first installs at once; the second started once the first's worker stack has created the release bucket | the first installs; the second stops at the state, before any change, naming the first (no lock to relay, the state exists before) |
| GH157-u | The state held by another run 2 hours old: its GitHub attempt `in_progress`, `completed`, not answered; a workstation's run (`host:<host>:<pid>:<token>`) whose lock is in this machine's lock directory and held (a process of it alive), then here and free; whose lock is not here (another machine of any name, a clone, this one restarted); an earlier Deploy's name without a run token; one named by this host's short name alone; one the owner attested dead (`abandon`) | refused (no takeover for age); taken over; refused; refused, then taken over; refused (nothing proves it dead: the owner's attestation); refused; refused; taken over |
| GH157-v | Run A (a workstation's) suspended inside a stack call; run B on that host; A resumes; then A killed while its live stack update runs (left `UPDATE_IN_PROGRESS`), a stack in `REVIEW_IN_PROGRESS` left by a dead first install and a manual change set on another stack | B refused (A's run lock held), A completes, B changed nothing; then B takes over, waits for the update's end, does not wait on `REVIEW_IN_PROGRESS`, reads each status again, keeps the manual change set |
| GH157-w | The full migrate still running after the waiter's rounds (ECS keeps it `RUNNING`); the job returns; then a new Deploy | the first stops, token, ARN and revision in its state, the services stopped; the second waits until `STOPPED`, reads its exit, then runs its own migrate and starts the services: never two migrate tasks at once |
| GH157-ad | A workstation's run whose shell alone is killed (SIGKILL) while its `aws cloudformation deploy` lives on; another run of that machine; then that command ends | refused while the command lives (its run's lock held), whatever the shell's PID; once it ends, its lock here and free: taken over |
| GH157-ae | RunTask's first answer lost (the task created), its replays refused by IAM (`AccessDeniedException`), `ListTasks` empty — with the CLI's own retries modelled (three requests per invocation unless `AWS_MAX_ATTEMPTS` says otherwise); a run on a task's ARN that DescribeTasks answers `MISSING` for a while after its answer | each RunTask sent once per invocation (`AWS_MAX_ATTEMPTS=1` on that call alone); the intent stays (unknown), the run stops, the services stopped stay so; the next run with the rights finds the one task and waits for it; `MISSING` waited through until the task shows and stops: one task, its exit read. Before (06 h 28): the CLI's retry turned "lost, then denied" into a first refusal, and the intent was cleared |
| GH157-af | A machine with no identity of its own — no `/etc/machine-id` nor `IOPlatformUUID`, or a placeholder: Linux's `uninitialized` or 32 zeros, a malformed one, a null or malformed `IOPlatformUUID` (counter-reviews of 06 h 40, 06 h 48): a workstation's Deploy there; a GitHub run there, the state held by a workstation's run under that machine's short name, then the state free | `run_lock.py host` names no host (exit 3, nothing printed): the workstation's Deploy stops before anything (no state written or tried), saying to deploy from GitHub Actions or give the machine an identity; the GitHub run refuses that holder (its lock is not here), then deploys |
| GH157-ag | Two machines of one name and one machine identity (a clone), each its own lock directory: run A suspended on machine one; a Deploy on machine two, one on machine one, the owner's attestation from machine one; A killed (shell and command); a Deploy on machine two, then on machine one; a run of machine one before a restart (its lock gone), the owner's attestation, a Deploy | refused (A's lock is not in machine two's directory: nothing proves it dead); refused (held: A lives); the attestation refused (A's lock held); refused again on machine two; taken over on machine one (A's lock here and free); refused, the attestation accepted, taken over ("the owner attested it dead") |
| GH157-x | RunTask refused (`tasks` empty, `failures`); RunTask's answer lost after ECS created the task, then a first `ListTasks` empty; the request lost before ECS saw it; an ARN that ECS answers `MISSING`; an intent past the replay window and not found, then `resolve-migrate --none` | no task, the intent cleared, the run stops, the next one migrates; the next run replays the same token and parameters and gets that task (one task in all, waited for; no service started before); the replay creates it once; no migrate task running: the intent cleared, its outcome unknown, the run's own migrations before any service; suspended (exit 1, the entry named, nothing changed), then the run proceeds |
| GH157-y | Saved counts worker 0 / backfill 1, then 1 / 0, resumed without an override; `WORKER_DESIRED_COUNT` 0 and 1; `keep` with the stack at 0; the workflow's input | 0 / 1 and 1 / 0 restored; 0 and 1; 0 kept; `keep` by default, `0` passed as `0` |
| GH157-z | A first install whose image build fails after its worker stack was created at 0; then a run with `keep` | the target (worker 1, backfill 0) saved before the stack and the build; the second run starts the worker at 1 once its migrations succeed |
| GH157-aa | The candidate's template applied to the worker stack, the CLI's answer lost (exit 255); the candidate's update rolled back instead | the services stay stopped (the stack holds the candidate's image), the next run migrates, then starts them; restored at once by the previous template (GH157-j) |
| GH157-ab | The README's manual CloudFormation commands against their templates | each template parameter without a default given by `deploy`; every parameter named by `update-stack --use-previous-template`; no SSM-typed parameter, no fence |
| GH157-ac | The maintenance entries: `abandon` of a GitHub run; of a run whose lock is in this machine's lock directory, held (whatever its host's name), then free; of a run whose lock is not here (this machine's name: a restart, a cleaned /tmp), of an earlier Deploy's name without a run token, of another host's run; `resolve-migrate` with another token | refused; refused (it lives), refused (the Deploy takes it over itself); written (the next Deploy takes it over), for each; refused |
| GH158-a | Commits that change only the site's files the image does not copy (`MatchNav.jsx`), only the read API, only a template other than the worker's | the same image identity: no build, no push, no replacement of the worker or the backfill |
| GH158-b | A commit changing a site file the image copies (`services/format.js`), a shared file (`dashboard/shared/archive.js`), an account SQL file, `requirements.txt`, the Dockerfile's `VEGA_DEPS_REFRESH`, a file's mode (executable), a copied file deleted, a file added under `backend/vega` | a new identity each: built, pushed, one replacement |
| GH158-c | The identity of one tree computed twice, from two clean exports of one commit (different mtimes), on two checkouts | the same 64 characters |
| GH158-d | The account switched on with the same image; a login's password parameter rotated; `WORKER_DESIRED_COUNT` 1 → 0 → 1 | the migrate task runs (account, logins) without a stop; the rotation replaces the tasks once (`SecretsRevision`); counts change without a replacement |
| GH158-e | A retry after a failure that came after the push | the image found: no second build or push |
| GH158-f | `live.yaml`'s ingestor | the worker's image identity (`ImageTag`), never the commit |
| GH158-g | A warm BuildKit builder (the real Docker): the Dockerfile unchanged; a comment changed; `VEGA_DEPS_REFRESH` changed | every step `CACHED`; a new identity but the apt and pip steps still `CACHED` (what the review found); the apt and pip steps run again (not `CACHED`), the steps before them cached |

GH157-q, r, ab: `backend/tests/test_deploy_grants.py`. GH157-ac, af (the machine's identity): `backend/tests/test_deploy_state.py`. GH157-a–p, s–ag, GH158-a, b, d–f: `backend/tests/test_deploy_flow.py`, the real `deploy.sh` and its export (`git archive` of a
commit of a temporary repository holding this tree), the real `image_identity.py` and `deploy_state.py`, the real
Docker for the context only (BuildKit), stateful stand-ins of `aws` (CloudFormation stacks and their parameters and
templates, ECS services, ECR, S3 with conditional requests, SSM versions) and of `docker build`/`push`; the migrate
task runs the real `python -m vega.migrate` of the image's tree on a disposable PostgreSQL 18
(`VEGA_V2_DEPLOY_FLOW_TEST_DSN`). GH158-c: `backend/tests/test_image_identity.py`. GH158-g: `backend/tests/test_image_refresh.py` (the real Docker's
BuildKit, skipped without it). Not verifiable here: AWS's own
answers (CloudFormation's change sets, ECS's replacements, S3's conditional requests on the real bucket), the real
build and push.

## GH202 and GH204. The checks at the end of a Deploy; the alarms and the dashboard (GH #202, VI-142; GH #204, VI-144)

Seen before this change (`e4014803`): a Deploy ends with `done` once its stacks are deployed and the home's personal read
answered for one club and one player (GH220.3); nothing checks that the distribution serves the read API just
uploaded, that `/api/health` answers, or that the worker and the backfill run the task definitions just deployed. In
production on 25 Nov 2026 (GH #220's comment): the route `/api/read/home-favourites` failed 133 of 168 calls with real
visitors' favourites while the Deploy's check (one club, one player) passed; the function-wide 5xx alarm rang once. Not
watched: a slowing of the function below its 20 s alarm, a worker or backfill restarting in a loop (their CPU samples
continue), a backfill meant to run that does not; no dashboard (#204).

### GH202/204.1 Rules

- **The release served.** `/api/health` answers `release`: the SHA-256 of the read API's package (`VEGA_RELEASE`,
  `releases/v2-api/<sha256>.zip`), `null` without it. The last steps (`infra/aws/verify-deploy.mjs`, step 11b) ask it
  through the distribution (never kept there) until it answers 200, `status: ok` and the release the Deploy uploaded,
  at most 24 times 5 s apart; then a failure naming the last status and release seen.
- **The services.** `describe-services` of both, until each has the desired count the Deploy set (the worker's input,
  the backfill's), as many running, one deployment, primary, `COMPLETED`, whose task definition is the stack's
  (`WorkerTaskDefinition`, `BackfillTaskDefinition`, with its revision): at most 30 times 10 s apart; then a failure
  naming what differs. A refusal of the call is a failure, never a pass.
- **No favourites read of its own.** The home's personal read is checked once a Deploy, by GH220.3's probe in step 12
  (`smoke-favourites.mjs`, unchanged here; a visitor's list of several clubs and players and the base's time budget
  are GH #220's, PR #240, GH220.4). Step 11b asks the distribution `/api/health` only (and ECS its services), never a
  `/api/read/*` route: no second favourites read and no setting of its own (an earlier draft's `--mix`, `--teams`,
  `--players` and `SMOKE_MIX_*` are gone; given, they are refused).
- **Order and outcome.** Step 11b runs its two checks whatever each answers, then step 12 runs as before; a failed
  check ends the Deploy without `done` after step 12 (everything deployed).
- **Alarms** (`alerts.yaml`; each notifies the topic of ALARM and OK; none duplicates another):
  - `vega-v2-api-p95`: the function's 95th percentile duration at 3 s or more in each of 6 five-minute periods (a
    slowing long before `vega-v2-api-slow`'s 20 s of p90).
  - `vega-v2-api-route-5xx`: a Contributor Insights rule over the function's request lines (one rule for every route:
    the lines carry `route`, the read API's route with each identifier written `id`, `other` for a path no route
    serves) counting answers of 500 or more by route; the alarm when the route with the most has 2 or more in each of 3
    five-minute periods (a route failing for its visitors, as GH #220, rings even when the function's total stays
    under `vega-v2-api-5xx`'s 10). The request line is written as a JSON line of its own (no Lambda text prefix), the
    form the rule reads; the two metric filters read it as before.
  - `vega-v2-worker-restarts`, `vega-v2-backfill-restarts`: an EventBridge rule per service matching its tasks
    stopped by their container (`EssentialContainerExited`) or failing to start (`TaskFailedToStart`); a deploy, a
    count lowered (`ServiceSchedulerInitiated`), a hand stop (`UserInitiated`) and AWS's maintenance are not; the alarm
    on 3 or more in 30 minutes; each only while its service is meant to run (`WatchWorker`, `WatchBackfill`).
  - `vega-v2-backfill-down`: no task of the backfill for 15 minutes, only while the Deploy set it to 1.
- **Dashboard** `vega-v2` (free, the first three): the function's requests, errors, throttles, durations (p50, p95,
  p99) and copies; its 5xx and the base's refusals; the routes in 5xx (the rule) and each route's p95 (Logs Insights);
  the two services' tasks and abnormal stops; the base's CPU, connections and memory; the distribution's requests and
  5xx rate (us-east-1); the alarms.
- **Rights.** The CloudFormation role: the dashboard, the rule and the EventBridge rules under `vega-v2-*` names; the
  deploy role: what it already has (`ecs:DescribeServices`), the read API through the distribution needs none.

### GH202/204.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH202-a | `/api/health` with and without `VEGA_RELEASE` | `release` the package's SHA-256; `null` |
| GH202-b | The distribution answering the previous release twice, then the new one; answering it never; `/api/health` 503 | passed at the third try; failed after its tries, naming the release seen; failed naming the status |
| GH202-c | The services as the Deploy left them; the worker running 0 of 1; two deployments; a primary on another task definition; `IN_PROGRESS`; the call refused | passed; each a failure naming the service and what differs, after the tries; refused: failed |
| GH202-d | The verifier's requests to the origin, its checks passing and its release check failing; `--mix 2x2`, `--teams t_… --players p_…` given | `/api/health` only (as many as its tries), no `/api/read/*` and no manifest; refused, exit 2, nothing asked |
| GH202-e | The real `deploy.sh`: everything well; the services check failing; GH220.3's probe failing; `SMOKE_MIX_TEAMS` and `SMOKE_MIX_PLAYERS` set; the real verifier and the real probe against one origin | `done`, the probe called once (step 12); no `done`, exit 1, step 12 still run; exit 1 as before; nothing of them reaches step 11b; every `/api/read/home-favourites` the origin sees is one the probe printed (none of step 11b's) |
| GH204-a | `alerts.yaml` | the alarms and rules of GH202/204.1, each with its topic, none treating missing data as breaching but the backfill's (like the worker's); the rule's log group, keys and filter; the EventBridge patterns' stop codes; conditions on the services' watch |
| GH204-b | The handler's request lines (the real handler, a route answering 503, an unknown path) | a JSON line of its own each, holding `route` (`read.home-favourites`, `matches.id.summary`, `other`); the 5xx filter and the rule's filter match the 503s only; the route the edge function names (GH149) |
| GH204-c | `deploy.sh` | `WatchBackfill` true with a backfill of 1, false at 0 |
| GH204-d | `deploy-roles.yaml` | the CloudFormation role's dashboard, insight rule and EventBridge rights on `vega-v2-*` names; `DeployGrants` 1 |
| GH204-e | The CloudFormation role against AWS's handlers (CloudFormation's registry schemas, us-east-2, vendored in `backend/tests/fixtures/cfn-handlers.json`) of the dashboard, the alarms (both regions), the insight rule and the EventBridge rules the alert stacks create (review of 26 Nov 2026, 05 h 29: the dashboard's tags were granted on the alarms and rules only) | each create, read, update and delete permission granted on that resource's own ARN (`dashboard/vega-v2`, `alarm:vega-v2-…`, `insight-rule/vega-v2-…`, `rule/vega-v2-…`); before: `cloudwatch:TagResource`, `UntagResource`, `ListTagsForResource` missing on the dashboard, `events:PutTargets`, `RemoveTargets` on the rules; `iam:PassRole` of the rules' handler only for a target with a role, which none has |

GH202-a: `backend/api/test/read-api.test.mjs`; GH202-b–d: `backend/api/test/verify-deploy.test.mjs` (a local origin,
answers made for each failure); GH202-e: `backend/tests/test_account_deploy.py` and `backend/tests/test_deploy_flow.py`
(the real `deploy.sh`; the latter with the real verifier and probe, also run with PR #240's probe); GH204-e: `backend/tests/test_deploy_grants.py`; GH204-a–d:
`backend/tests/test_alerts.py`. Not verifiable
here: CloudWatch's own evaluation (Contributor Insights, the EventBridge metrics, the dashboard's widgets), real
production answers.

## GH129. The match page's season read once; the player page's reads without waste (GH #129, VI-69)

Seen in production on 25 Nov 2026 (`optimisations-suite-2611/reference/lectures.log`): Brentford–Everton opened at
1365 × 900 and 390 × 844 read the API 19 times each, eight of them `/api/fixtures` (one page of 50, then seven cursors,
one after the other) and one `/api/matchdays`; Christos Tzolis's page 21 and 19 times, among them seven
`/api/read/player`, a 404 of `/api/matches/{id}/players/halves` and a 404 of `/api/archive/matches/{id}`. Read in the
code (`e4014803`): the match page's head (`MatchNav.jsx`, `services/match-nav.js`) pages the competition season's
fixtures by 50 (`completeFixtures`, `season_data.js` `readPages`) and then asks `/api/matchdays` when a fixture has no
round, though `api.match_rounds` is made of the fixtures that have one (022): it can name no round a fixture lacks; the
match's « Classement » reads the same season again through the football client when the table is missing
(`MatchStandings.jsx`). On the player page, a family a match does not have (404) is followed by the legacy archive
shard (`football-client.js` `endpointResponse`), a route this API has never served; and the rail's history
(`PlayerScoutRail.jsx`) reads the current season again though the page has just read it.

### GH129.1 Rules

- **The season in one read.** `GET /api/fixtures/season?league=l_…&season=…`: every fixture of one competition's season,
  the rows of `/api/fixtures` (same columns and forecast, same order: day, then id), with the publication's
  `generation`; 1 000 fixtures at most, more is a 413 (`SEASON_TOO_LARGE`) and the site reads the pages as before:
  never a silently shorter season. The validator and the 30 s edge time of `/api/fixtures`. The manifest advertises it
  (`capabilities.seasonFixtures`); `/api/fixtures`' paging is unchanged (its limit 100, its cursors). A `HEAD` and the
  conditional GETs (`If-None-Match`, `*` included) answer as the GET (review of 26 Nov 2026, 04 h 05: they gave 200
  cacheable, and 304 for `*`, on the 1 001-fixture season the GET refuses): a selection of more than 1 000 fixtures is
  the same 413 `no-store`, never a 200 nor a 304. The same for the answer's bytes (counter-review of 26 Nov 2026,
  04 h 25): a season within 1 000 fixtures whose answer passes 4 MiB is the GET's 413 (`PAGE_TOO_LARGE`, `no-store`)
  for a HEAD and every conditional GET too (`*`, its own validator). Its bytes are known only from the answer, so a
  HEAD or a conditional GET reads the season as the GET does, rows included, and is answered from it: the shortcut that
  read the publication alone (then counted the selection) is gone, and a revalidation costs the GET's statement.
- **Pinned to the manifest's publication** (review of 26 Nov 2026: an answer of another generation was kept under the
  manifest's). The site asks `&generation=<the manifest's publicationVersion>` (the publication's generation, as
  `/api/fixtures` and the manifest name it: one value, `api.publication`): the edge keeps each generation's answer
  apart, and the API answers 409 (`PUBLICATION_CHANGED`) for any other than its current one. An answer is kept only
  under the generation it carries and the URL asked; a 409, or an answer of another generation, keeps nothing: the
  site re-reads its manifest (`publication-change.js`) and reads the pages.
- **The pages pinned too** (review of 26 Nov 2026, 04 h 04: after a 409 or a 413 the pages could be of N+1, and their
  callers kept them under N, `match-nav:…:N` and the football client's fixtures). Whenever `completeFixtures` is given
  the read API's manifest N (`storage` `aws-relational`, its `publicationVersion`), its pages are all of N, whatever
  led to them (a 409, a 413, an answer of another generation, an older API without the season's read, a day's
  fixtures): a page of another publication, at the first page or between two (a cursor refused, the first page read
  again of N+1), fails the read as `PUBLICATION_CHANGED` and nothing of it is returned, so that no caller keeps it
  under N. A current visitor's site is told to re-read its manifest; its reads then name N+1. A publication asked for
  by the link (`?v=N`, `publication-change.js`) is shown or fails: never read again at another, nor any re-read of the
  manifest asked. Without a manifest (the cup snapshot's worker), the pages are read as before. Limits: a page's URL
  names no publication, so an edge's copy of a first page older than the manifest (at most its 30 s after a
  publication) fails the read the same way, with no newer manifest to move to (the base commit failed there too for a
  season of more than one page, its cursor refused twice, and returned the older rows for a single page); and a re-read
  of the manifest that still gives N (its own 15 s at the edge) leaves N's failed reads as they are until the site's next
  check (four minutes) or the next page. The season's read names its publication and has neither.
- **One read shared.** `completeFixtures` of a league's season reads it once when the manifest advertises it, through
  one cache of the site keyed by the publication, the league and the season: the head's thread and picker, the
  « Classement »'s table when the API has none, the competition pages share it (one request in flight, the last reader
  leaving cancels it); otherwise, and on a 413, the pages as before. A day's fixtures (`from`/`to`) stay paged.
- **No round from `/api/matchdays` for the native API's rows** in the head: a row that carries `round_name` (null for a
  fixture without a round) stays out of the thread when it has none, as it does today (the rounds the read cannot name
  are the ones `/api/matchdays` cannot name either). A row without the field (the snapshot of `FootballDataClient`'s
  `localFixtures()`, an older server's pages) takes its round from `/api/matchdays` as before (review of 26 Nov 2026,
  04 h 05: a first version dropped it for every row, and the thread, its neighbours and the search with it).
- **Kept.** Previous and next across a round's boundary, the thread of six before and six after, the current match, a
  match to come with its time, the picker's every round and its search over the whole season, the « Classement » built
  from the fixtures when the API has no table, a publication change (409) restarting the read, cancellation, the
  approved views (desktop and mobile) unchanged.
- **Player page.** A family the API answers 404 is absent: no archive shard asked when the manifest says so
  (`capabilities.matchFamilyRoutes`, the read API's since this change: every family has its route, no
  `/api/archive/matches`); a server that does not say it keeps the archive's fallback after a 404, 405 or 501, its
  sharing and its cancellation, as before (review of 26 Nov 2026: a first version skipped it for every native client,
  `remote-match.test.mjs`); the rail's history takes the season the page already read instead of reading it again; the reads that
  need only the player's id (identity, injuries, market values, ranking, the seasons' routes) start with the page, not
  after another answer. The same tabs, states, blocks and privacy; the same requests' bounds (three seasons at a time).
- **A read started early is read once.** One of them failing (a 404 of the market values) before the blocks that show
  it mount stands for them as the failure of their own read would: the same error shown, no second request; for 10 s
  (the page's first readers), after which a block mounting reads again as before. « Réessayer » (a forced read) always
  reads again; a block's own read keeps today's rule (a failure is read again by the next block that asks).
- **Held by the navigation** (review of 26 Nov 2026: the reads started early were retained beyond the page). The
  player's page (`FootballContext`, for that player and the default view) holds each read it started as a
  subscription, and releases them when it leaves (another player, another view, another page): a read no block holds
  then is cancelled (the cache's last leaver); one a block holds goes on for it.

### GH129.2 Failure modes and expected outcomes

| # | Situation | Expected |
|---|---|---|
| GH129-a | `/api/fixtures/season` for the base's Ligue 1 2025/2026 (386 fixtures), against `/api/fixtures`' eight pages | the same rows in the same order, the same generation; one statement for the fixtures and the publication |
| GH129-b | A season of more than 1 000 fixtures; a league or season malformed, unknown; `If-None-Match` of its answer; a parameter of `/api/fixtures` it does not take | 413 `SEASON_TOO_LARGE`; 400, empty list; 304; 400 |
| GH129-c | The site with the capability, a season of 386 fixtures | one request; the 386 matches in the order of the pages; without the capability, or on a 413: the pages as before |
| GH129-d | The head and the « Classement » of one match (no table served), together | one request between them; the last leaving cancels it |
| GH129-e | Browser, the match page (desktop, mobile; each answer 120 ms later) | no `/api/fixtures` page and no `/api/matchdays` (M1, against eight and one before); the thread with the current match, previous and next (M2); the picker's 38 rounds and a club's 38 matches found (M3) |
| GH129-f | Browser, the player page (desktop, mobile; the identity 600 ms later) | no `/api/archive/matches` (P1); no player season read twice (P2); the identity, injuries, market values, ranking and routes started with the first read (P3); the heading and blocks as before (P4) |
| GH129-g | A family that answers 404 with the manifest's `matchFamilyRoutes`; without it (an older server), a 404, 405 or 501 | « not available for this match », no archive read; the archive read as before, shared and cancelled as before (`remote-match.test.mjs`) |
| GH129-h | A read started early failing before its two blocks mount, then both asking; a forced read; a block asking 10 s later; an abort; a block's own read failing, then another block asking | one request, both get its error; read again; read again; nothing kept; read again (as before) |
| GH129-i | Manifest N: the API at N; an edge answering N−1 for the season, the API's pages at N; the API at N+1 (a 409, its pages at N+1); then a manifest N+1 | one request pinned `generation=N`, kept under N; N−1: nothing kept, the manifest re-read, N's pages; 409: the manifest re-read, the read fails (`PUBLICATION_CHANGED`), nothing kept under N; then a request pinned N+1, kept under N+1, never N's data |
| GH129-j | Player A's page starts its reads (each slow); before they answer, player B's page; a block of A's still holding one; B's reads | A's reads no block holds are cancelled, the held one goes on; B's each asked once and answered; in the browser (A→B through the search), A's reads aborted and B's answered once each |
| GH129-k | `/api/fixtures/season` with `generation` the current one, another, malformed; the manifest | 200; 409 `PUBLICATION_CHANGED`; 400; `capabilities.matchFamilyRoutes: true` |
| GH129-l | The 1 001-fixture season: `HEAD`, `If-None-Match` with the ETag a smaller season's answer carries, `If-None-Match: *`, each also pinned to the current generation; Ligue 1 (126) the same | each 413 `SEASON_TOO_LARGE`, `no-store`, no ETag, as its GET; Ligue 1: `HEAD` 200 with the GET's ETag, 304, 304 |
| GH129-o | A season of 900 fixtures (within 1 000) whose answer passes 4 MiB (two clubs' names of 2 600 characters, local and synthetic): GET, `HEAD`, `If-None-Match` with its URL's validator, `If-None-Match: *`, each also pinned to the current generation | each the GET's 413 `PAGE_TOO_LARGE`, `no-store`, no ETag; Ligue 1 as GH129-l |
| GH129-m | Manifest N, the API at N+1: the season's read refused (409), too long (413), not served (an older API), each followed by pages of N+1; pages of N then N+1 (a cursor refused); a day's fixtures at N+1; the same under a link's `?v=N`; the real callers: the head's resource `match-nav:<league>:<season>:N`, the football client's fixtures (`loadFixtures`) and its `request` | each read fails `PUBLICATION_CHANGED`, no row of N+1 returned; the site told to re-read its manifest, but not for `?v=N`; read again, asked again (nothing kept); the head's resource keeps nothing under N; the client's fixtures hold N's own snapshot, no row of N+1; pages all of N: returned and kept; a manifest N+1 then: read and kept |
| GH129-n | The head on rows without `round_name` (an older server's pages; a client's snapshot, `localFixtures()`), two matches, `/api/matchdays` naming their rounds; the native API's rows (the field present, null for one fixture) | `/api/matchdays` asked once, both matches in the thread with their neighbours, in the picker and found by the search; native rows: no `/api/matchdays`, the one season read |

GH129-a, b: `backend/api/test/fixtures-season.test.mjs` (the real handler on the API seed and a base of 1 001 fixtures);
c, d, g, i, m, n: `tests/season-fixtures.test.mjs`; h: `tests/resource-cache.test.mjs`; j: `tests/player-prefetch.test.mjs` and
`tests/e2e/page-reads.e2e.mjs` (A→B); k: `backend/api/test/fixtures-season.test.mjs` (the manifest's capabilities also in
`backend/api/test/partition.test.mjs`' inventory); l, o: `backend/api/test/fixtures-season.test.mjs`; e, f: `tests/e2e/page-reads.e2e.mjs` (the real read API on
`tests/e2e/support/reads-dataset.py`'s base, a production build of the site; before and after). Not verifiable here: the
production timings (the local base and its delays are ours); Vercel's and CloudFront's caching of the new read.
