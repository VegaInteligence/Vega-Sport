# Lot « classements » — preuves (19 nov. 2026)

Branche `claude/audit-classements` (worktree `/home/romai/Agents/worktrees/vega-audit-classements-20261119`), base
`74970d7fe3`. Spécification : `docs/calculs/09-audit-2026-11/FAILURE_MODES.md` §43 (écrite avant les tests, commit
`5271ca4a77`). Migration ajoutée : **159** (`backend/sql/159_standings_rank_conflicts.sql`).

## Entrées

- `raw/sportscore-veikkausliiga.json` (+ `.headers`, `.fetched-at`) : la réponse du widget SportScore lue une fois,
  2026-11-19T17:26:09Z, `https://sportscore.com/api/widget/standings/?sport=football&slug=finnish-veikkausliiga`
  (trois tables, `"group": ""`, 12/6/6 lignes). Copie sans logos : `backend/tests/fixtures/sportscore/veikkausliiga-widget-2026-11-19.json`.
- `backend/tests/fixtures/sportscore/production-standings-2026-11-19.json` : les 47 réponses SportScore de
  `/api/standings` du lot production (`evidence/prod/raw/standings-*-1.body`), réduites aux champs sportifs.
- `raw/lanus/` : GET publics de `m_0Feldm` et `m_1bi3Az` (match, summary, lineups, events, stats, players,
  rankings/match, forecasts/match), 17:30:53–17:31:21Z, `index.txt` donne heure UTC, statut et taille.
- `raw/nations/` + `nation-copies-prod.json` : `/api/nations?season=2026/2027` et les 153 pages nation,
  17:42:42–17:47:38Z, script `scripts/nation_copies_prod.py` (lecture seule, 1 GET / 1,1 s).

## Rejeu

```
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:/home/romai/.nvm/versions/node/v24.18.0/bin:$PATH
cd /home/romai/Agents/worktrees/vega-audit-classements-20261119
createdb -h 127.0.0.1 -p 55540 -U postgres vega_v2_classements_test   # ou backend/ci/test_databases.py
export VEGA_V2_CLASSEMENTS_TEST_DSN=postgresql://postgres@127.0.0.1:55540/vega_v2_classements_test
PYTHONPATH=backend CI=true python -m unittest backend/tests/test_standings_phases.py backend/tests/test_nation_match_copies.py -v
python3 -I /home/romai/Agents/scratch/passation-audit-20261119/evidence/classements/scripts/nation_copies_prod.py <dossier>   # production, lecture seule
PGPORT_LOCAL=55540 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh <worktree> <sortie> all
```

Rouge (avant correctif, tests écrits sur le code de `74970d7fe3` + §43) : `logs/43-1-red.txt` (10 tests : 5 échecs, 5
erreurs « api.standings_rank_conflicts() does not exist » ; 43b sert la table mêlée exacte de la production, 200),
`logs/43-2-red.txt` (8 échecs sur 9 : 11 matchs au lieu de 8, « World Cup 1930 », pénalités perdues).
Vert : `logs/43-1-green.txt` (10/10), `logs/43-2-green.txt` (9/9).

## Résultats

- E02c : le writer de la branche refuse déjà la réponse réelle (`DUPLICATE_GROUP`, avant : « two tables named None »,
  maintenant « 3 tables without a name »). La table servie en production vient de l'ancien writer (`dc65d69`,
  `ON CONFLICT DO NOTHING` après tri par club puis rang : chaque club garde sa ligne de rang le plus bas). Rejouée,
  la route la servait encore sur la branche (200) ; après 159 : 404 sans table Vega, table Vega sinon, jamais 2025.
  Règle rejouée sur les 47 réponses : 46 admises (writer et lecteur), Veikkausliiga seule refusée/retenue.
- E03f/E04d nations : Argentine 8 matchs CdM 2026 (11 avant), parcours « Finaliste » sur 8 matchs ; libellé de
  l'édition. Production 19 nov. 17:47Z : 39 sélections touchées, 72 copies (toutes `open-cups:world-cup-history:2026`) ;
  133 sélections ont au moins un match d'archive mal libellé (2 624 matchs).
- E03f/E04i Lanús : spécification et préimage seulement (§43.3), canonique `m_0Feldm`.

## Suites complètes

`suites-final/` (python.txt, api.txt, site.txt, context.txt) — décomptes dans le rapport final.

Sur `89817ee82a` (dirty=0), 17:42–18:00Z : Python 722 tests, 1 erreur, 1 sauté (pgvector), 1 échec attendu ; API
224/224 ; site 788/788. L'erreur est `test_41n` (`open_matchday_restore.guard_schema` : « unreviewed destination
schema version ») : elle se produit aussi sans 159 (`logs/41n-without-159.txt`, 159 retirée le temps du test) ; la
dernière migration appliquée est 160 (lot « garanties »), absente de `REVIEWED_SCHEMAS` (153, 156). Ce n'est pas une
régression de ce lot ; l'épingle est au coordinateur.

## Seconde relecture : lenteurs de 159 (perf/)

Mesures sur `classements_perf` (copie de `relecture_b_159`, port 55535), sous `vega_read`, réglages de `db.mjs`,
paramètres liés, médiane de 5 exécutions : `perf/scripts/run.sh before-full first159-full new159-full before-small
first159-small new159-small` → `perf/summary.md` (journaux `perf/*.out`). Forme des plans sur cette base :
`perf/shape-relecture.txt` (24/24 lectures de `core.standings_official` avec condition d'édition, plan custom et
générique). Tests de forme : `perf/plans-red.txt` (sur le premier 159 : 43s, 43t, 43u en échec), `perf/plans-green.txt`
(22/22 avec 43a–43r). Suites sur `4f0b76e442` : `suites-perf/` — Python 725, 1 erreur (`test_41n`, épingle de schéma,
préexistante), API 224/224, site 788/788.
