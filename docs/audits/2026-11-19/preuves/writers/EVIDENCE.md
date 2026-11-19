# Preuves — lot « writers » (E02c, E02d, E03h), 19 nov. 2026

## Point de départ et commits

- Départ : `main` 2088d36e60 (branche `claude/audit-writers`, worktree `/home/romai/Agents/worktrees/vega-audit-writers-20261119`).
- `e19321b90c` [ADD] Specify the replays of the writers still active (FAILURE_MODES §40) — spécification écrite avant les tests.
- `82ca335b40` [ADD] Replay the active writers end to end under the collection role — 24 rejeux + base `vega_v2_writer_replays_test` dans `backend/ci/test_databases.py`.
- `a0489be2fe` [ADD] Replay the native PitchAPI writer under the collection role — §40 40y/40z (écrits avant), puis 2 rejeux natifs.
- Aucun module de `backend/vega` modifié, aucune migration.

## Préparation et entrées

- PostgreSQL 18.6 privé `127.0.0.1:55537`, utilisateur `postgres` ; Python 3.12.3 (CI : 3.14), Node 24.18.0.
- Entrées : réponses fournisseur synthétiques écrites dans le test (Transfermarkt, UEFA, FIFA, collecteur honours, pont Wikidata, SPARQL joueurs, payloads PitchAPI normalisés par `normalize_family`). Rien n'est téléchargé.
- Chaque rejeu : base migrée (`migrate`), même fixture (Ligue 1 2026/27, PSG/OL, 4 joueurs ayant joué 2 matchs), une transaction annulée par test, le writer sous `SET LOCAL ROLE vega_collect` (vérifié par `current_user`), lecture `vega_read` pour 40h.
- Empreinte : lignes des tables écrites en JSON trié, sans `updated_at` (sans `id` pour `core.player_injuries`).

## Commandes de rejeu

```sh
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:$PATH
cd /home/romai/Agents/worktrees/vega-audit-writers-20261119
python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:55537 > /tmp/dsn.env
set -a; . /tmp/dsn.env; set +a
# Rouge : les défauts comme tests ordinaires, avec états observés en JSON
PYTHONPATH=backend CI=true WRITER_REPLAY_STRICT=1 WRITER_REPLAY_EVIDENCE=<dir>/red python -m unittest backend/tests/test_writer_replays.py -v
# Vert (comme la CI) : défauts en expected failure
PYTHONPATH=backend CI=true WRITER_REPLAY_EVIDENCE=<dir>/green python -m unittest backend/tests/test_writer_replays.py -v
# Toutes les suites
PGPORT_LOCAL=55537 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh /home/romai/Agents/worktrees/vega-audit-writers-20261119 <dir> all
```

## Résultats attendus et obtenus

Attendus : `docs/calculs/09-audit-2026-11/FAILURE_MODES.md` §40.2 (40a–40z, 40x).

- `red.txt` (STRICT, sur a0489be2fe) : `Ran 26 tests … FAILED (failures=12)` — échecs : 40c, 40f, 40g, 40h, 40j, 40k, 40n, 40o, 40x, 40s, 40t, 40w ; chacun échoue sur son assertion de défaut (pas d'erreur d'exécution).
- `green.txt` : `Ran 26 tests … OK (expected failures=12)`.
- États observés par rejeu : `red/*.json`, `green/*.json`. Extraits :
  - 40a valeurs répétées : contenu identique, mais `rows_written` = 2 (réécriture physique, `updated_at` renouvelé).
  - 40c : `outcome ok`, `error_code` NULL, `rows_written` 1 — point retiré.
  - 40e : contenu identique, ids des blessures 1,2 → 3,4.
  - 40f / 40g / 40j / 40k : lecture `ok`, `error_code` NULL, lignes supprimées.
  - 40h : `SCHEMA_CHANGED`, dû sous un jour, 2 épisodes dans `api.player_injuries`, 0 ligne dans `api.player_injury_reads`.
  - 40m/40x : lignes UEFA identiques, version `ranking` 1 → 2.
  - 40n : scope `ok`, `rows_written` 0, 0 ligne restante.
  - 40o : 1 ligne après relecture de la source complète (édition non relue).
  - 40s : `founded_year` NULL, 0 mandat ouvert. 40t : capacité et coordonnées NULL.
  - 40w : `birth_date` 1998-11-05 avec `birth_date_source_url` Transfermarkt.
  - 40y : révision 2 → 2 ; 40z : révisions [2, 3, 3, 4], score 2–0, 2 buts.

## Suites complètes

| Exécution | SHA | Python | API | Site | Journaux |
|---|---|---|---|---|---|
| Référence coordinateur | 2088d36e60 | 635, OK (skipped=1) | — | — | `evidence/baseline-2088d36e60/` |
| Intermédiaire | 82ca335b40 | 659, OK (skipped=1, expected failures=12) | 222/222 | 788/788 | `suites/` |
| Finale | a0489be2fe (dirty=0) | 661, OK (skipped=1, expected failures=12), 619 s | 222/222 | 788/788 | `suites-final/` |

Limites : Python 3.12 local (CI 3.14) ; aucune exécution en production ; les fréquences réelles des réponses vides ou tronquées en production ne sont pas mesurées.
