# OpenFootball editions (frozen)

`editions.json` holds the 23 men's World Cups and the three EUROs the cups adapter reads
(`vega/sources/cups.py` `EDITIONS`), as `open-cups.mjs` fetches them:

- World Cups: [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) at
  `516d3825c3bd23fdc298c4014e84bde78f2d4965`, `<year>/worldcup.json`;
- EUROs: [openfootball/euro.json](https://github.com/openfootball/euro.json) at
  `7bbf6309bdda6896d6bb9ca218c1e15eaf418ce3`, `<year>/euro.json`.

Retrieved on 17 Nov 2026 for VI-27. `sources` gives each file's immutable URL and the SHA-256 of
its original bytes. Each match keeps only the fields the projection reads (`round`, `group`, `num`,
`date`, `team1`, `team2`, `score`, `status`), in source order. Scorers, grounds and kick-off
times are left out. License: CC0-1.0 (public domain dedication), © the OpenFootball authors.

Read by `backend/tests/test_source_snapshots.py` (FAILURE_MODES.md §19).
