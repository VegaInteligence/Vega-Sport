# Lot « garanties » — preuves (19 nov. 2026)

Worktree `/home/romai/Agents/worktrees/vega-audit-garanties-20261119`, branche `claude/audit-garanties`, départ `4fb0082d51`.
Spécification : `docs/calculs/09-audit-2026-11/FAILURE_MODES.md` §44 (écrite avant tout test ou code, commit `d13b1db0ef`).
Tests : `backend/tests/test_writer_replays.py` (base `vega_v2_writer_replays_test`), complétés au commit `c859f9e43b`.

## Préparation et entrées

- PostgreSQL 18.6 local `127.0.0.1:55541`, bases créées par `backend/ci/test_databases.py` (`dsn.env` ici).
- Entrées synthétiques seulement (réponses Transfermarkt, UEFA, FIFA, Wikidata fabriquées dans le test) ; rien n'est téléchargé.
- Écrivains réels par leurs points d'entrée (`transfermarkt.Reader.read`, `sources.run_due`) sous `vega_collect` ;
  routes réelles `GET /api/player-market-values` et `GET /api/players/{id}/injuries` sous `vega_read` (`backend/tests/read_http.mjs`).

## Rejeu

```
cd /home/romai/Agents/worktrees/vega-audit-garanties-20261119
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:/home/romai/.nvm/versions/node/v24.18.0/bin:$PATH
set -a; . /home/romai/Agents/scratch/passation-audit-20261119/evidence/garanties/dsn.env; set +a
WRITER_REPLAY_STRICT=1 WRITER_REPLAY_EVIDENCE=<dir> PYTHONPATH=backend CI=true python -m unittest backend/tests/test_writer_replays.py -v
```
Suites complètes : `PGPORT_LOCAL=55541 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh <worktree> <out> all`.

## Résultat attendu

§44.3 (44a–44t) : rien n'est supprimé, une réponse vide est refusée et tracée, un élément omis est marqué
`absent_since` puis démarqué, un second passage identique n'écrit rien, une correction s'applique, les routes servent
la dernière lecture acceptée.

## Rouge

`red/red.txt` (+ `red/json/`) : tests complétés, migration 160 présente, **code des writers de `4fb0082d51`**
(fichiers `transfermarkt.py`, `wikidata.py`, `player_facts.py`, `fifa.py`, `uefa.py` de HEAD) :
`Ran 31 tests … FAILED (failures=16)` — 40b, 40c, 40e, 40f, 40g, 40j, 40k, 44h, 44l, 44e, 40n, 40o, 40x, 40s, 40t, 40w,
chacun pour la règle visée (point supprimé, ids renouvelés, liste effacée, version incrémentée, NULL écrit, date remplacée).
40h et 44i passaient déjà dans ce rouge : leur correctif est la vue de la migration 160, présente pendant ce rejeu ;
leur rouge sans la migration est celui du lot « writers » (`evidence/writers/red.txt`).
UEFA 44o passe sur l'ancien code (garde de non-régression).

## Vert

`green/green.txt` (+ `green/json/`) : même commande sur `5873ab4142` → `Ran 31 tests … OK`.
Suites complètes sur `76a97fc365` : `suites-final/` — Python `Ran 678 … OK (skipped=1 pgvector, expected failures=1 :
test_38a du lot « notes », pas de ce lot)`, site 788/788, API 223/224 : l'échec était
`player-injuries.test.mjs` « once read… », qui affirmait le défaut 40h (un rafraîchissement échoué → 404).
Le test est corrigé au commit `5873ab4142` (la liste acceptée reste servie ; `absentSince` ; première lecture refusée → 404) ;
API relancée sur `5873ab4142` : `suites-api-5873ab4142/` 224/224. Python et site non relancés après `5873ab4142`
(ce commit ne touche qu'un test de l'API).

## SHA

d13b1db0ef (spéc), c859f9e43b (tests), 39655edfbd (Transfermarkt + migration 160 + route), 1aca897c63 (Wikidata, faits
joueur), 97ef0abc12 (FIFA), 76a97fc365 (UEFA), 5873ab4142 (test API des blessures).

`start-aborted-polluted/` : une première exécution des suites interrompue (les fichiers changeaient pendant qu'elle
tournait) ; à ignorer.
