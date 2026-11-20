# Lot « résiduels » — preuves (19 nov. 2026)

Worktree `/home/romai/Agents/worktrees/vega-audit-residuels-20261119`, branche `claude/audit-residuels`, départ
`8587ab6671` (candidate `claude/audit-reprise-33`). PostgreSQL 18.6 privé `127.0.0.1:55534`. Spécification :
`docs/calculs/09-audit-2026-11/FAILURE_MODES.md` §45 (commit `201ccbbe04`, écrit avant les tests).

Commits : `201ccbbe04` (§45), `e46f5cc3fb` (E02b), `88d6016391` (m4 / 35ad), `9373aa32e7` (E03c/E03g).

## Préparation

```
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:/home/romai/.nvm/versions/node/v24.18.0/bin:$PATH
cd /home/romai/Agents/worktrees/vega-audit-residuels-20261119
python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:55534 > /home/romai/Agents/scratch/passation-audit-20261119/evidence/residuels/dsn.env
set -a; . /home/romai/Agents/scratch/passation-audit-20261119/evidence/residuels/dsn.env; set +a
```

## 1. E02b — copie Open Matchday retirée sur édition native vide

- Reproduction par le vrai chemin (`open_matchday.run` sous `vega_collect`) :
  `PYTHONPATH=backend python repro/e02b_repro.py` (depuis le worktree).
  - Sur `8587ab6671` : `repro/e02b_repro_8587ab6671.txt` — copie 5 terminés + 3 à venir, édition native vide, second
    passage : 0 match, 0 édition, `ops.parse_failures` vide.
  - Sur la tête de branche : `repro/e02b_repro_head.txt` (attendu : 8 matchs gardés, une trace `COPY_NOT_COVERED`).
- Tests 45a–45e (`backend/tests/test_open_matchday.py`) :
  `PYTHONPATH=backend CI=true python -m unittest backend/tests/test_open_matchday.py -v`
  - rouge (code de départ, tests écrits) : `rouge/e02b-open-matchday.txt` — 45a, 45c (×2 sous-cas), 45e échouent : la
    copie a disparu (`[] != [...]`) ; 45b vert (le retrait couvert était déjà fait).
  - vert : `vert/e02b-open-matchday.txt` (avec `test_open_matchday_window.py`, dont 41n : 27 tests OK).

## 2. m4 / 35ad — un appariement football-data retient le retrait d'une copie d'archive

- Test 35ad réécrit (45f) et 45g (`backend/tests/test_archive_deletions.py`, classe `RemovalTest`) :
  `PYTHONPATH=backend CI=true python -m unittest backend.tests.test_archive_deletions.RemovalTest -v`
  - rouge : `rouge/m4-archive-deletions.txt` — `'r:2019-20/ru.2:0' not found in {...}` : la copie appariée n'est pas
    retirée (ancienne règle).
  - vert : `vert/m4-archives.txt` (deletions + removal_guards + twins : 37 tests, un seul échec = 35g, prérequis
    `backend/api/node_modules` absent du worktree à ce moment ; la suite complète l'installe).
- Le plan retire la copie, l'application tourne sous `vega_collect`, les gardes de 141 ne s'y opposent pas (pierre
  tombale écrite, `SET NULL` passé), la ligne football-data reste sans appariement, `footballdata._link` sous
  `vega_collect` la donne au jumeau, un second passage ne change rien, un nouveau plan ne retire plus rien.
  Substitution de test : `footballdata.DIVISIONS["P1"] = ("Russie", 1)` et `MIN_VOTES = 1` (comme 35af), la saison
  d'essai étant russe.

## 3. E03c/E03g — Estudiantes de Río Cuarto lié à sa réserve

- Tests 45h–45j (`backend/tests/test_transfermarkt.py`, classe `ReserveSearchTest`, vrai `Reader.read` sous
  `vega_collect`, faux fournisseur `CuartoApi`) :
  `PYTHONPATH=backend CI=true python -m unittest backend.tests.test_transfermarkt.ReserveSearchTest -v`
  - rouge (code de départ) : `rouge/e03c-transfermarkt.txt` — 45h et 45i : `[('75142', 604)] != []`, le lien de la
    réserve est écrit (défaut de production reproduit) ; 45j vert.
  - vert : `vert/e03c-transfermarkt.txt` (fichier complet : 13 tests OK).
- Production lue par l'API publique le 19 nov. (GET anonymes, ≤ 1/s) : `production/` —
  `GET /api/teams/t_1dhmUh/squad?season=2026/2027` → 200 `{"value":125000,"readOn":"2026-11-16","top18Value":125000,
  "averageAge":20.6,"size":27,"league":{"rank":30,"valued":30,"clubs":30}}` : la fiche de la réserve 75142 servie
  comme effectif de l'équipe première. Les valeurs et transferts par joueur n'ont pas été lus par HTTP (identifiants
  publics des joueurs inconnus ; `p_v00104xx` → 404, ils ont une clé PitchAPI).
- Préimage du dépôt : `integrite-cas/` (extraction de `docs/audits/2026-11-17/controles/verification-integree/integrite-cas.zip`).

## Suites complètes

`PGPORT_LOCAL=55534 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh /home/romai/Agents/worktrees/vega-audit-residuels-20261119 /home/romai/Agents/scratch/passation-audit-20261119/evidence/residuels/suites-9373aa32e7 all`

Résultats : voir `suites-9373aa32e7/` (python.txt, api.txt, site.txt, context.txt) et le résumé ci-dessous.
