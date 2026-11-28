# Bases de test clonées d'un modèle — preuves (28 nov. 2026)

Worktree `~/Agents/worktrees/Vega-base-modele-20261128`, branche `ci/base-modele-par-job`, départ `3149041d0a`.
Modes d'échec : en-tête de `backend/tests/test_template_base.py` (C1 à C7, K1, F1, F2), écrits avant les tests, eux-mêmes
écrits avant `backend/tests/template_base.py`. Règle de CI : `test_ci_zones.py` c2, rouge avant la règle (3 échecs).

## Préparation et entrées

- Venv Python 3.12 avec `backend/requirements.txt` (psycopg 3.3.9, boto3 1.44.4) ; `npm ci` dans `backend/api` et `backend/account`.
- PostgreSQL 18.6 (`~/Agents/scratch/passation-audit-20261119/pg18/node_modules/@embedded-postgres/linux-x64/native/bin`,
  grappes à soi, `shared_preload_libraries=pg_stat_statements`, ports 54331 et 54332) et Node 24.18.0 : la branche telle quelle.
- PostgreSQL 16.10 du système (ports 54329 et 54330) et Node 22.20.0, pour la comparaison avant/après. Les migrations
  s'y arrêtent à `056` (`ANALYZE ONLY`) : une copie jetable (`Vega-base-modele-pg16shim-20261128`, détachée sur
  `3149041d0a`) y remplace `ANALYZE ONLY %s` par `ANALYZE %s`, avant comme après. Rien de cette copie n'est dans la branche.
- Bases créées par `python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:<port>` ; données synthétiques des suites.
- Sans Docker : les suites du Deploy (`python_suites.py deploy`) et 8 tests qui lisent le journal du serveur ou
  construisent l'image ne tournent pas ici ; pgvector absent (1 test). Ils tournent dans la CI.

## Rejeu

```
cd <worktree>
export PATH=<venv>/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH PYTHONPATH=backend
set -a; eval "$(python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:<port>)"; set +a
python backend/ci/python_suites.py python            # le groupe Python entier
npm test --prefix backend/api && npm test --prefix backend/account
(cd backend/tests && python -m unittest -v test_template_base test_ci_zones)
python docs/audits/2026-11-28/preuves/ci-base-modele/compare.py avant.log apres.log   # journaux `unittest -v` horodatés
```

## Attendu

- Chaque test garde son issue : le clonage donne la base que `store.migrate` laisse sur une base neuve (F1).
- Le temps passé à rejouer les 189 fichiers disparaît : une construction du modèle par serveur, puis un clonage par base.

## Obtenu

| Passage | Avant (`3149041d0a`) | Après (branche) |
| --- | --- | --- |
| Python, PostgreSQL 16 | 1 209 tests, 1 371 s, 1 échec, 6 erreurs, 9 sautés | 1 221 tests, 455 s, 1 échec, 6 erreurs, 9 sautés |
| API Node, PostgreSQL 16 | 436 tests, 618 s, 1 échec | 436 tests, 305 s, 1 échec |
| Python, PostgreSQL 18 | non passé | 1 223 tests, 421 s, OK, 9 sautés |
| API Node, PostgreSQL 18 | non passé | 436 sur 436, 316 s |
| Comptes, PostgreSQL 18 | non passé | 110 sur 110 |

- PostgreSQL 16 : aucun test ne change d'issue (`python-pg16-avant-apres.txt`, `api-pg16-avant-apres.txt`). Les échecs
  sont ceux de main sur ce moteur : `pg_stat_statements_reset` à quatre arguments (PostgreSQL 17), Node 22, un plan
  d'exécution, « preimage schema mismatch » de `RestoreTest` (cause non cherchée).
- Les 12 tests en plus : 11 de `test_template_base.py`, 1 de `test_ci_zones.py`.
- 191 bases clonées en 44,6 s (PostgreSQL 16) et 57,8 s (PostgreSQL 18), les deux suites tournant côte à côte.
- Classes qui paient encore une préparation de plus d'une seconde : 44 pour 115 s, contre 101 pour 554 s. Celles qui
  restent rejouent la vraie tâche de migration ou sèment leurs données.
- Mutations de `template_base.py` (sept, une par protection) : chacune fait échouer le test prévu (C7, C3, C4, C1+C2+C7,
  C5, C6, K1).
- `pg18-resultats.txt` : les résumés des passages sur PostgreSQL 18.

## Dans GitHub Actions (PR #280, run 46096786041, commit `f36c61935d`)

Tout vert, les suites du Deploy et les 9 tests sautés en local compris. Durée des jobs, en secondes :

| Run | Entier | python-1 | python-2 | api | deploy-1 à 4 |
| --- | --- | --- | --- | --- | --- |
| main, 27 nov. 20 h 39 UTC (46065080082) | 811 | 689 | 437 | 635 | 300, 378, 264, 294 |
| main, 27 nov. 21 h 01 UTC (46067469884) | 656 | 572 | 643 | 390 | 364, 322, 370, 396 |
| main, 27 nov. 21 h 22 UTC (46069900164) | 681 | 477 | 670 | 359 | 382, 355, 323, 376 |
| PR #280 (46096786041) | 401 | 191 | 280 | 297 | 259, 290, 365, 386 |

- Étape « Python suites » : 155 s et 242 s (447 s et 643 s sur le run 46069900164). Journaux : 88 bases clonées en 8,2 s
  (python-1) et 103 en 17,6 s (python-2), modèle construit en 3,0 s et 4,6 s.
- Le plafond du run est maintenant une part du Deploy (386 s), que ce changement ne touche pas.
- `backend/ci/durations.json` refait par `backend/ci/durations.py` sur les six journaux Python et Deploy de ce run
  (`gh api repos/VegaInteligence/Vega-Sport/actions/jobs/<id>/logs`). Avec ces poids, les secondes de ce run se
  répartissent en 194 et 193 pour les parts Python (149 et 238 avec les anciens) et 287 à 288 pour les quatre parts du
  Deploy (218 à 350 avec les anciens).

## Non vérifié

- L'effet des nouveaux poids : à lire au run qui suit ce commit (attendu : parts du Deploy autour de 5 min 20 s).
