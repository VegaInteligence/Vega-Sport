# Lot « notes » — preuves (19 nov. 2026)

Worktree `/home/romai/Agents/worktrees/vega-audit-notes-20261119`, branche `claude/audit-notes`, départ `2088d36e60`.
PostgreSQL 18.6 privé `127.0.0.1:55535` (utilisateur `postgres`, sans mot de passe). Section `FAILURE_MODES.md` §38,
migration 155.

## 1. Reproduction sur 2088d36e60 (avant tout changement)

Base synthétique (`repro/seed.py`) : une ligue à année civile dont l'édition 2021 (saison Vega 2021/22) contient
56 matchs tous les 4 jours depuis le 1er avril 2021 (31 avant le 1er août 2021 = millésime 2020, 25 après), et une
ligue août–mai 2021/22 (56 matchs depuis le 14 août 2021). Calculs sous `vega_calc`, dans l'ordre de `Worker.daily`
(`worker.due_seasons`, `power.refresh_elo` une fois, `models.refresh_daily(season, elo=False)`).

Rejeu :

```
cd /home/romai/Agents/worktrees/vega-audit-notes-20261119 && git checkout 2088d36e60   # (ou un worktree détaché)
PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:$PATH PYTHONPATH=backend \
  python repro/repro.py postgresql://postgres@127.0.0.1:55535/vega_v2_notes_repro 2088d36e60
```

Résultat (`repro/repro-2088d36e60.json`) :
- `due_seasons` = `[2021]` ; 2020 n'est jamais dû ; `previous_year_changed(2021)` = false ; `stale_rankings` = `[]`.
- 682 participations à minutes positives du millésime 2020, **0 notée** ; 1 782 du millésime 2021, toutes notées.
- `refresh_players(2020)` appelé directement : 682 notes, `ref_season` 2020 (références propres de l'année partielle),
  plus un classement 2020 et une course au prix — hors chemin ordinaire.
- Ligne de « troisième équipe » (équipe 99, poste 62, les deux côtés Elo présents) : `refresh_players(2021)` lève
  `UniqueViolation 23505 player_power_matches_pkey` ; `player_power_matches` reste à 1 782 lignes du run 2.

## 2. Tests écrits avant le code (rouge), puis code (vert)

- Python : `backend/tests/test_player_grade_reasons.py` (base `vega_v2_grades_test`, déclarée dans
  `backend/ci/test_databases.py`).
  Rouge sur 2088d36e60 + tests : `red-python-38.txt` (23505 en 38b ; `agg.player_grade_exclusions` /
  `api.player_grade_status` absents en 38a-statut, 38b-second passage, 38c, 38d). 38g (statuts `unrecorded` /
  `pending`) : `red-python-38g.txt` (migration 155 du commit dca03831b3, sans ces deux statuts).
  Vert : `green-python-38.txt`.
  Deux constantes du test corrigées après le premier rouge (31 et non 30 matchs avant le 1er août : 1er avril + 4 n
  jours, n = 0..30) : erreur d'arithmétique du test, pas du code.
- API : `backend/api/test/grade-readers.test.mjs` (HTTP par le vrai gestionnaire sous `vega_read`).
  Rouge : `red-api-38.txt` (le tableau du match donne 54,3066 au caméo de 7 minutes, z = 0,3 ; pas de `gradeStatus`).
  Vert : `green-api-38.txt`. L'accès `ranking.body.data` du test a été corrigé en `ranking.body` (enveloppe réelle de
  `/api/rankings/match`) après le premier passage vert du tableau.

Rejeu d'un test isolé :

```
S=/home/romai/Agents/scratch/passation-audit-20261119
export PATH=$S/venv/bin:/home/romai/.nvm/versions/node/v24.18.0/bin:$PATH
cd /home/romai/Agents/worktrees/vega-audit-notes-20261119
python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:55535 > /tmp/dsn.env; set -a; . /tmp/dsn.env; set +a
PYTHONPATH=backend CI=true python -m unittest backend/tests/test_player_grade_reasons.py -v
(cd backend/api && node --test test/grade-readers.test.mjs)
```

## 3. Suites complètes

`PGPORT_LOCAL=55535 $S/work/run-suites.sh <worktree> <dossier> all` → voir `suites-<sha>/` (python.txt, api.txt,
site.txt, context.txt). Résultats : voir la fin de ce fichier.

## 4. Forme récente (VI-32)

`node recent-form-zero.mjs <worktree>` → `recent-form-zero.json` : `seasonGrade([]).grade` = null, la carte écrit
`?? 50` (`PlayerScoutOverview.jsx:501`, lignes dans `recent-form-source-lines.txt`) → « 0 derniers matchs · moy. 50 ».
Non corrigé (changement de texte à l'écran : maquette requise).

## 5. Commits (branche claude/audit-notes)

- `ae8d76ee0c` [ADD] FAILURE_MODES §38 (avant les tests)
- `dca03831b3` [FIX] ligne de troisième équipe écartée, motifs enregistrés, migration 155, test Python
- `7b9ca5023e` [FIX] règle unique du tableau du match, `gradeStatus`, test HTTP
- `3f31a0d8b4` [FIX] statuts `unrecorded`/`pending`, garde 141 sur la nouvelle table, compte des vues

Suites complètes sur `7b9ca5023e` (`suites-7b9ca5023e/`) : Python 641 tests, 2 échecs propres au lot
(`test_24h_every_unprotected_reference_has_the_guard` : nouvelle table sans garde 141 ; `test_every_view_answers` :
compte des vues 167 → 168), tous deux corrigés dans `3f31a0d8b4` ; API 224/224 ; site 788/788. Ce passage a lu
155 en cours d'édition (vue modifiée pendant l'exécution) : il ne vaut que pour repérer ces deux échecs.
Suites complètes sur `3f31a0d8b4` : `suites-3f31a0d8b4/` (voir ci-dessous).

Résultat sur `3f31a0d8b4` (arbre propre, 13:48–14:04 UTC) : Python 642 tests OK (1 skip pgvector identique à la
référence, 1 échec attendu = 38a, millésime 2020 en attente de décision) ; API 224/224 ; site 788/788.

## 6. Après déploiement (production, à faire par l'opérateur ; rien n'a été exécuté en production)

1. La migration 155 s'applique avec les autres. Le prochain passage de chaque millésime recalculé par le worker
   (2026 chaque jour ; un millésime passé quand ses matchs changent ou qu'il est périmé) remplit
   `agg.player_grade_exclusions` pour ce millésime. Les autres millésimes affichent `unrecorded` pour leurs lignes
   non notées sans motif enregistré, jusqu'à leur prochain passage.
2. Contrôle : `SELECT y, grade_status, count(*) FROM (SELECT award_season y, grade_status FROM api.player_grade_status) s
   GROUP BY 1,2 ORDER BY 1,2;` — attendu : millésime 2020 en `award_year_not_computed` (≈ 14 427 à minutes positives,
   hors lignes non jouées), aucune publication 2026 en échec 23505 dans les journaux (`ranking season=` / `season=2026`).
3. Tableau du match : `GET /api/matches/<id>/players` des deux matchs des caméos Mățan (7 min) et Moutoussamy (1 min)
   → `vega_grade` absent pour eux ; `GET /api/read/performance?...` → `gradeStatus` `below_display_threshold`.
