# Lot « coupes » — E04b, E04c (19 nov. 2026)

- Worktree `/home/romai/Agents/worktrees/vega-audit-coupes-20261119`, branche `claude/audit-coupes`, base `claude/audit-base2`
  `74970d7fe3`. Commits : `f0450f8391` (§42, tests, fixtures — rouge), `056ded6774` (code — vert). Aucune migration.
- PostgreSQL 18.6 privé `127.0.0.1:55539`. Bases : `vega_v2_cup_editions_test` (suite), `vega_v2_coupes_mesure` (mesure).
- Sources : OpenFootball (CC0), fichiers bruts à des commits épinglés, chacun vérifié par son hash de blob Git contre l'arbre
  du dépôt à ce commit (`dl/commits/*.json`, arbres du lot calendriers) : austria `627ba1b3`, deutschland `c34532ab`,
  england `9ee7a0c3`, espana `80035a93`, italy `48954d16`, europe `63df627f`, champions-league `abfaeddc`. Copies :
  `dl/files/`, et dans le dépôt `backend/tests/fixtures/openfootball/cups/<dépôt>/<commit>/<chemin>`.
- Production (GET anonymes, ≤ 1/s, 19 nov. 17 h 30–18 h 45 UTC) : `prod/MANIFEST.txt` (`/api/cups/edition` des neuf
  archives 2024/25 et des éditions Open Matchday 2026/27 lues), `prod/clubs/MANIFEST.txt` (`/api/read/clubs`, toutes
  pages, saisons 2021/22 à 2026/27 : 1 136 clubs PitchAPI), `prod/search/` (34 recherches `/api/search`, interrompues :
  `/api/read/clubs` donne la liste complète).

## Rejeu

```bash
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:/home/romai/.nvm/versions/node/v24.18.0/bin:$PATH
W=/home/romai/Agents/worktrees/vega-audit-coupes-20261119; E=/home/romai/Agents/scratch/passation-audit-20261119/evidence/coupes
# Tests (base vega_v2_cup_editions_test, créée par backend/ci/test_databases.py) :
cd $W && VEGA_V2_CUP_EDITIONS_TEST_DSN=postgresql://postgres@127.0.0.1:55539/vega_v2_cup_editions_test PYTHONPATH=backend CI=true \
  python -m unittest backend/tests/test_cup_editions.py -v
# Rouge : la même commande sur f0450f8391 (le code de 74970d7fe3). Suites complètes :
PGPORT_LOCAL=55539 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh $W $E/suites-fin all
# Inventaire et décisions (données seulement, Python -I) :
cd $E/scripts && node parse_all.mjs $W $E/dl/files > $E/parse-all.json && python -I names_mid.py $E && python -I inventory.py $E
node parse_q.mjs $W $E/dl/files > $E/parse-q.json
python -I decide.py $E $W > $E/decide.txt; python -I decide_q.py $E $W > $E/decide-q.txt; python -I decisions.py $E $W
python -I gen_spellings.py $E $W   # les lignes de curated.CUP_SPELLINGS
# Mesure (point 4) :
psql -h 127.0.0.1 -p 55539 -U postgres -c 'CREATE DATABASE vega_v2_coupes_mesure'
NODE_OPTIONS=--import=$W/backend/tests/fake_openfootball_cups_fetch.mjs PYTHONPATH=$W/backend \
  python mesure.py postgresql://postgres@127.0.0.1:55539/vega_v2_coupes_mesure $E > $E/mesure.txt
```

## Défaut reproduit sur 74970d7fe3 (= main 2088d36e60 pour ces fichiers)

- `cup-archives.js` ne connaît que 2024/25, lu sur `master`, année de départ fixée à 2024 : aucune autre saison nommable
  (`_query` refuse la portée : `INVALID_SOURCE_RESPONSE`, rouge de 42a).
- Les douze fichiers Coppa Italia, Copa del Rey, DFB-Pokal et ÖFB-Cup 2021/22–2023/24 écrivent le score entre les équipes :
  l'analyseur du dépôt les refuse tous (`Incomplete cup archive`, `parse-all.json` avant correction, 0 match lu).
- Marqueurs non lus : `Harrogate Town v Rochdale AFC [cancelled]` devient une équipe « Rochdale AFC             [cancelled] »
  (EFL Cup 2021/22) ; `SK Dnipro-1 (UKR) v Puskás FC (HUN) 0-3 [awarded]` (×2) et Tottenham–Rennes 2021/22 deviennent des
  matchs joués 0–3 (`parse-q.json`).
- Production : « Everton FC » des FA Cup et EFL Cup 2024/25 est `t_v0001626`, équipe source seule, pas Everton `t_21IR9d`
  (`prod/edition-fa.json`, `edition-efl.json`) ; 14 clubs non professionnels de la FA Cup 2024/25 ont deux équipes, l'une
  OpenFootball, l'autre Open Matchday (Aldershot Town `t_v0001563` / `t_v0003377`, Boreham Wood, Brackley, Curzon Ashton,
  Guiseley, Horsham, Solihull Moors, Southend, Tamworth, Wealdstone, Weston-super-Mare, Woking, Worthing) ; « Dyn. Kyiv »
  d'Open Matchday est `t_v0003755`, pas Dynamo Kyiv `t_2YGh1d`. Aucun n'est corrigé ici (voir « Ouvert »).

## Tests (rouge puis vert)

`rouge/test_cup_editions.txt` (f0450f8391) : 9 tests, 4 échecs et 9 erreurs pour la bonne raison (éditions inconnues,
`INVALID_SOURCE_RESPONSE`), 42g vert à l'arrivée comme prévu. Trois corrections du harnais après ce rouge, sans changer
une attente : pays des clubs semés (clé étrangère `core.countries`), un instant de lecture par sous-test de 42f, et
« SpVgg Unterhaching » lu dans l'édition 2023/24 où il figure. `vert/test_cup_editions.txt` (056ded6774) : 9/9 OK.

## Mesure locale (`mesure.txt`, `mesure.json`)

Base : 1 082 clubs PitchAPI de production (hors sélections) avec clé et pays, 683 équipes Open Matchday 2026/27 par leur
clé, « Everton FC » lié à une équipe source seule ; les neuf archives 2024/25 importées puis passage d'identité ; puis les
23 éditions, puis passage d'identité.

| Édition | Matchs | Joués | Sans jeu | Côtés sur un club déjà tenu | Côtés Elo |
|---|---:|---:|---:|---:|---:|
| ÖFB-Cup 2021/22, 22/23, 23/24 | 63, 63, 63 | 189 | 0 | 109, 108, 112 | 378 |
| DFB-Pokal 2021/22, 22/23, 23/24 | 63, 63, 63 | 188 | 1 décidé (Münster–Wolfsburg) | 115, 110, 109 | 376 |
| FA Cup 2021/22, 22/23, 23/24 | 136, 144, 149 | 429 | 0 | 262, 277, 289 | 858 |
| EFL Cup 2021/22, 22/23, 23/24 | 93, 93, 93 | 278 | 1 annulé (Harrogate–Rochdale) | 186, 186, 186 | 556 |
| Copa del Rey 2021/22, 22/23 | 127, 126 | 253 | 0 | 175, 175 | 506 |
| Coppa Italia 2021/22, 22/23, 23/24 | 45, 45, 45 | 135 | 0 | 78, 83, 85 | 270 |
| UCL qualif. 2024/25, 2025/26 | 90, 92 | 182 | 0 | 160, 170 | 364 |
| UEL qualif. 2024/25, 2025/26 | 80, 82 | 162 | 0 | 142, 158 | 324 |
| UECL qualif. 2024/25, 2025/26 | 256, 256 | 510 | 2 décidés (Dnipro-1–Puskás) | 322, 314 | 1 020 |
| **Total** | **2 330** | **2 326** | **3 + 1** | **3 911 / 4 660** | **4 652** |

372 équipes créées à l'import, dont 90 fusionnées ensuite par le passage d'identité du dépôt dans un club PitchAPI de même
nom et même pays (qualifications) ; restent 282 équipes nouvelles (clubs absents de la base). `noms.csv` contre la base :
2 013 lignes conformes, 0 écart. `Worker.daily` : un calcul Elo publié (3 120 matchs), le second passage n'en lance aucun.

## Noms (`noms.csv`)

2 119 lignes (nom × fichier, éditions non ajoutées comprises), 960 noms distincts : 1 196 « résolu (clé OpenFootball de
2024/25) », 178 « résolu (règle du dépôt : même nom, même pays) », 279 « graphie ajoutée » (140 graphies de
`curated.CUP_SPELLINGS` : 14 clubs PitchAPI des coupes nationales, 46 équipes Open Matchday, 80 clubs PitchAPI des
qualifications), 463 « club réellement nouveau », 3 « à relire » (CD Quintanar, UD Melilla, AC Malcantone).

## Non vérifié

- Les clubs PitchAPI sans match dans les saisons 2021/22–2026/27 n'apparaissent pas dans `/api/read/clubs` : un tel club
  homonyme pourrait exister dans `core.teams` de production et rendre ambigu un nom « résolu par la règle du dépôt ».
- Les décisions administratives (Münster–Wolfsburg, Dnipro-1–Puskás) reposent sur le marqueur de la source et le tour
  suivant du fichier ; les décisions du DFB et de l'UEFA n'ont pas été relues chez l'organisateur (sources non permises).
- Aucune exécution en production ; l'effet sur l'Elo de production n'est pas mesuré (seulement sa population).

## Suites complètes (`suites-fin/`, SHA 056ded6774, propre)

- Python : 712 tests, 1 erreur, 1 saut (pgvector), 1 échec attendu. L'erreur, `test_41n` (`test_open_matchday_window`,
  « unreviewed destination schema version »), se reproduit à l'identique sur `74970d7fe3` propre
  (`suites-fin/41n-sur-74970d7fe3.txt`) : `open_matchday_restore.REVIEWED_SCHEMAS` épingle 156, alors que la base2 porte
  la migration 160. Ce n'est pas une régression de ce lot (le fichier est épinglé et je n'y ai pas touché). La suite base2
  « 703 OK » était un checkout modifié (`dirty=1`).
- API : 224/224. Site : 788/788.
