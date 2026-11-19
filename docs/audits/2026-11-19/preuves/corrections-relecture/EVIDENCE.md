# Corrections de relecture (FAILURE_MODES §46) — preuves

- Worktree : `/home/romai/Agents/worktrees/vega-audit-relecture-20261119`, branche `claude/audit-relecture`, partie de
  `8587ab6671` (candidate `claude/audit-reprise-33`). Base de comparaison pour le constat 5 : `2088d36e60` (extrait par
  `git archive` dans `c5/base/`).
- PostgreSQL 18.6 privé `127.0.0.1:55542` (suites, reproductions, `relecture_c4`). Base du relecteur
  `127.0.0.1:55535/relecture_a` : lue seulement (EXPLAIN ANALYZE en transaction lecture seule).
- Environnement : `export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:/home/romai/.nvm/versions/node/v24.18.0/bin:$PATH`,
  bases de test : `python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:55542 > dsn.env` puis
  `set -a; . dsn.env; set +a` (fait une fois ; `dsn.env` est dans ce dossier).
- Un test isolé : depuis la racine du worktree, `PYTHONPATH=backend CI=true python -m unittest -v backend/tests/<fichier>.py -k <id>` ;
  API : `cd backend/api && node --test --test-concurrency=1 test/<fichier>.test.mjs`.

Commits (dans l'ordre) :

| SHA | Objet |
|---|---|
| `3307686cfe` | §46 écrite avant les tests |
| `40f4b3680a` | §46 : états « avant » de 46e et 46g |
| `527ae41dde` | Constat 1 : statut de note lu par clé |
| `fb36ae40ac` | Constat 2 : un premier 404 de blessures reste inconnu ; 160 corrigée en place |
| `724d04fd84` | Constat 5 : test 46j (le constat ne se reproduit pas) |
| `dbbbed1fd0` | Constat 3 : journal des côtés sans échec |
| `3fc10d0e30` | Constat 6 : merge_twins retient une paire corrigée |
| `b0fe0e7238` | Constat 4 : migration 157, recherche par index |
| `c297a913b0` | §46 : résultats observés (doc) |

Chaque `test_red.txt` a été produit avec les tests ajoutés et le code d'avant le correctif (SHA en tête de fichier) ;
chaque `test_green.txt` avec le correctif.

## Constat 1 — `/api/read/performance` (dossier `c1/`)

- Reproduit (sur la candidate, la vue n'existe pas sur `2088d36e60`) : `c1/measure_relecture_a.out`, forme « before »
  (jointure à une CTE `target` matérialisée, comme la route l'envoyait) : **27,8 à 31,8 s par appel** au pilote `pg`
  avec les réglages de session de la lecture (`jit=off`, `max_parallel_workers_per_gather=0`, `enable_seqscan` par
  défaut `on`) ; EXPLAIN ANALYZE 32,7 s (plan sur mesure), 40,1 s (plan générique) ; lectures séquentielles de toutes
  les partitions de `player_match_stats` (deux fois) et de `match_coverage`. Le `statement_timeout` de l'API est de 8 s :
  la route échouerait.
- Après (`performance.mjs` : `gs.season_id=$saison AND gs.match_id=api.internal_id('match',$m) AND gs.player_id=api.internal_id('player',$p)`) :
  **4,4 à 6,8 ms par appel** (pilote, valeurs liées), exécution 1,07 ms (sur mesure) et 1,30 ms (générique) ; lectures
  séquentielles restantes : `competition_seasons` (6 lignes), `player_grade_exclusions` (vide), `power_runs` (6 lignes).
  Toutes les lectures de statistiques et de compositions sont des Index Scan sur la clé primaire avec les trois colonnes.
- Rejeu : `node c1/measure_relecture_a.mjs /home/romai/Agents/worktrees/vega-audit-relecture-20261119 > c1/measure_relecture_a.out`
  (lecture seule ; « before » prend ~3 min). Sonde préalable avec `PREPARE` : `c1/explain_bound.sql` → `c1/explain_bound_probe.out`.
- Test : `backend/api/test/grade-status-plan.test.mjs` (46a : `gradeStatus` par la route sous `vega_read` ; 46b : le SQL
  réellement envoyé par la route, réduit à ses CTE et à la colonne du statut, planifié avec ses valeurs et en
  `GENERIC_PLAN`, `enable_seqscan=off` sur la petite base : chaque lecture d'une partition de statistiques ou de
  compositions est un parcours d'index avec une condition sur `player_id`). Rouge : `c1/test_red.txt`
  (« Index Scan on player_match_stats_s2023 without a condition on the player », condition vide) ; vert :
  `c1/test_green.txt` (avec `grade-readers` et `performance`, 7/7).
- Aucun autre lecteur : `grep -rn player_grade_status backend/api/src` ne trouve que `performance.mjs`.

## Constat 2 — premier 404 des blessures (dossier `c2/`)

- Reproduit : `c2/repro_first_404.py` (vrai `Reader` sous `vega_collect`, route réelle sous `vega_read` via
  `backend/tests/read_http.mjs`) → `c2/repro_before.out` : `read_at` posé, route **200 `{"injuries": []}`** ;
  après : `c2/repro_after.out` → `read_at` NULL, route **404**.
- Rejeu : depuis le worktree, `PYTHONPATH=backend:backend/tests python <évidence>/c2/repro_first_404.py`.
- Tests (`backend/tests/test_writer_replays.py`) : 46d (premier 404 → 404 ; unité `NOT_FOUND`, 404, relue dans 90 j),
  46e (liste acceptée puis 404 → 200, mêmes épisodes, `read_at`/`rows_written` de la lecture acceptée), 46f (liste vide
  acceptée puis 404 → 200 `[]`), 46g (160 rejouée sur des unités laissées par l'ancien lecteur : inconnues {10, 12},
  connues {11, 13}). Rouge : `c2/test_red.txt` (4 échecs) ; vert : `c2/test_green.txt` (35/35).
- Valeurs et effectifs : aucune vue `*_reads` ne les filtre ; 160 n'a changé que des colonnes de leurs vues. Rien à aligner.

## Constat 3 — journal des côtés (dossier `c3/`)

- Reproduit par les vrais writers (`c3/repro_side_conflict.py` → `c3/repro_before.out`) : un match tenu, passage
  (14 déplacés, clés restées sur 707), relecture Copa par `cups.save` (les 6 côtés de coupe repassent sur 707), puis
  passages 2 et 3 : **UniqueViolation 23505** sur `team_side_corrections_pkey`. Après (`c3/repro_after.out`) : passage 2
  « moved again=6 (journal: first move kept) », passage 3 `done=14`, journal toujours 14 lignes, celle de 2276 inchangée.
- Test : `test_identity_corrections.py` 46h. Rouge : `c3/test_red.txt` (UniqueViolation) ; vert : `c3/test_green.txt` (11/11).

## Constat 4 — `failure_once` (dossier `c4/`)

- Reproduit : `c4/seed.py` (base `relecture_c4`, 300 000 lignes) + `c4/explain.sql` → `c4/explain_before.out` :
  Parallel Seq Scan, 26,6 et 26,9 ms par recherche.
- Après (157 + requête) : `c4/explain_after.sql` → `c4/explain_after.out` : Index Scan `parse_failures_once`, conditions
  sur les trois colonnes, 0,03 à 0,05 ms, plans sur mesure et générique. Construction de l'index sur 300 000 lignes :
  0,89 s (`c4/index_build_300k.out`).
- Test : `test_writer_replays.py` 46i (50 000 lignes, sous `vega_collect`). Rouge : `c4/test_red.txt` (« Seq Scan ») ;
  vert : `c4/test_green.txt`.

## Constat 5 — lignes sans équipe (dossier `c5/`)

- **Ne se reproduit pas** : `c5/grade_null_team.py` exécuté avec le code de `2088d36e60` (`c5/base/`) et celui de la
  candidate → `c5/before.out` : aucune note, aucune ligne `player_power_matches`, sur les deux commits. `PLAYER_MATCHES`
  fait `JOIN core.teams t ON t.id = s.team_id` sur les deux commits : une ligne sans équipe n'est jamais lue.
- Test de garde : `test_player_grade_reasons.py` 46j, vert dès l'arrivée (`c5/test_green_on_arrival.txt`).

## Constat 6 — `merge_twins` et la clé étrangère de 156 (dossier `c6/`)

- Reproduit par le test 46k (`c6/test_red.txt`) : jumeau `g:` nommé par le journal → `merged {}`, `held []` (la saison
  échoue sur la clé étrangère et est annulée) ; résultat nommé → la paire est fusionnée sans revue (`{'2015/2016': 1}`).
- Après : la paire est retenue `side_corrected`, état et journal inchangés, deux passages ; `Loader.dependents` nomme
  `core.team_side_corrections.match_id` (retrait relu : `removal_has_dependents`). Vert : `c6/test_green.txt`.
- Purge de périmètre : `test_scope_purge.py` 46l, vert dès l'arrivée (la clé étrangère suffit à la retenue).

## Suites complètes

`PGPORT_LOCAL=55542 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh /home/romai/Agents/worktrees/vega-audit-relecture-20261119 <évidence>/suites all`
→ `suites/python.txt`, `suites/api.txt`, `suites/site.txt`, `suites/context.txt` (SHA et codes de retour).

Résultat sur `b0fe0e7238` (arbre propre ; le dernier commit `c297a913b0` ne touche que FAILURE_MODES.md) :
Python 713 tests OK (1 sauté : pgvector absent ; 1 échec attendu : 38a, décision de méthode ouverte), dont 41n vert ;
API 226/226 ; site 788/788. Codes de retour 0 (`suites/context.txt`). Référence `2088d36e60` : Python 635 OK (1 sauté).
