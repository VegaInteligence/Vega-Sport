# Lot « collecte » — preuves (19 nov. 2026)

Branche `claude/audit-collecte`, worktree `/home/romai/Agents/worktrees/vega-audit-collecte-20261119`, partie de
`main` `2088d36e60`. PostgreSQL 18.6 privé `127.0.0.1:55534`. Python 3.12.3 (venv de la passation), Node 24.18.0.
Spécification écrite avant les tests : `docs/calculs/09-audit-2026-11/FAILURE_MODES.md` §37.

## Commits

| SHA | Sujet |
|---|---|
| `c040402eee` | [ADD] Collection wake-up failure modes and end-to-end tests (§37 + tests, rouges sur 2088d36e60) |
| `33e72cc5d2` | [FIX] Wake the Elo when a complementary source changes its matches (E04k) |
| `7a45c89c0c` | [FIX] Read results.csv once for the International Results editions due together (E02b) |
| `7c95c9b7f4` | [FIX] Keep accepted match statistics when a later answer is empty (E02d) |
| `1d3e75b251` | [FIX] Trace a held Open Matchday withdrawal once while it stays the same (§36 m3 a) |

## Entrées

- `temoin/e04k/` : capsule `declenchement-elo.zip` de l'audit, extraite telle quelle (CSV Open Matchday National League
  North « old » et « current », provenance). Les trois fichiers de chaque état sont copiés dans le dépôt sous
  `backend/tests/fixtures/open_matchday/nln-2026/` (build_summary réduit à la seule ligue, comme le faisait la capsule ;
  `provenance.json` joint).
- `scripts/e04k_rejeu.py` : `rejouer.py` de la capsule, modifié seulement pour charger `backend/vega` d'un worktree
  donné, sans les assertions figées ni la vérification d'empreintes (le code testé n'est plus le blob 7ce5d605).
- `scripts/urls-par-edition.mjs` + `scripts/editions.json` : liste l'URL lue par la projection de chacune des 69
  éditions de `cups.EDITIONS` (fetch espionné, réponse 404).

## Rejouer

```sh
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:/home/romai/.nvm/versions/node/v24.18.0/bin:$PATH
E=/home/romai/Agents/scratch/passation-audit-20261119/evidence/collecte
W=/home/romai/Agents/worktrees/vega-audit-collecte-20261119
# 1. Témoin E04k de l'audit, sur un code donné (base temporaire créée puis supprimée)
python -B $E/scripts/e04k_rejeu.py --port 55534 --backend $W/backend --out /tmp/e04k-out
# 2. Tests §37 (base dédiée vega_v2_collection_test, déclarée dans backend/ci/test_databases.py)
cd $W && python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:55534 > /tmp/dsn.env && set -a && . /tmp/dsn.env && set +a
PYTHONPATH=backend CI=true python -m unittest backend/tests/test_collection_wakeups.py -v
PYTHONPATH=backend CI=true python -m unittest backend.tests.test_snapshot_roles -v
# 3. URL par édition
node $E/scripts/urls-par-edition.mjs $E/scripts/editions.json $W
# 4. Toutes les suites
PGPORT_LOCAL=55534 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh $W $E/suites-vert all
```

Pour le rouge : `git -C $W checkout 2088d36e60 -- backend/vega backend/sources` (ou un worktree à `c040402eee`, qui
contient les tests sans les correctifs), relancer 1 et 2.

## Attendu / obtenu

### E04k — témoin de la capsule (`e04k-rouge-2088d36e60/`, `e04k-vert-branche/`)

| Passage | Attendu | 2088d36e60 | branche |
|---|---|---|---|
| référence (CSV précédent + match natif 2019) | 250/250 | 250/250, run 1 | 250/250, run 1 |
| nouveau CSV seul (4 résultats) | 258/258 au même passage | **250/258**, aucun run | **258/258**, run 3 publié |
| passage ordinaire +1 h | rien de plus | 250/258 | 258/258, aucun run |
| même CSV relu +6 h | rien de plus | 250/258 | 258/258, aucun run |
| échéance native 2020 | 260/260 | 260/260 (run 3) | 260/260 (run 4) |
| passage suivant | stable | stable | stable |

### Tests §37 (`rouge-37-tests.txt`, `rouge-37n.txt` puis suites complètes)

Rouge sur le code de 2088d36e60 (tests seuls) :
- 37a–d : `published != pairs`, 8 côtés manquants (les 4 matchs NLN) ;
- 37e–f : `(6, False, 1) != (6, True, 2)`, aucun run Elo après l'import de la coupe ;
- 37g–j : 8 requêtes `results.csv` au lieu d'une ;
- 37k–m : `[] != [(1, 75)]`, la statistique de 75 min effacée par la réponse vide ;
- 37n : 4 lignes `MATCH_HAS_DEPENDENTS` identiques pour 4 lectures au lieu d'une.

Note : la première version de 37g comparait une liste à un tuple (ligne 288) ; corrigé dans le test avant le commit
`c040402eee`. Le rouge enregistré échoue plus tôt (ligne 284, nombre de requêtes), donc pour la bonne raison.

Vert sur la branche : voir `suites-vert/python.txt` (les cinq tests y figurent).

### E02b — URL par édition (`urls-par-edition.json`)

69 éditions, 62 URL ; la seule URL partagée est `results.csv`, par les 8 éditions International Results. OpenFootball
et OpenLigaDB : une URL par édition, donc pas de lecture redondante à supprimer.

## Suites complètes

Voir la section « Décomptes » ajoutée ci-dessous après la fin de `run-suites.sh`.

## Décomptes (suites-vert/, run-suites.sh, 13:35–13:52 UTC)

Exécuté sur l'arbre de travail avant les commits (`context.txt` dit `sha=2088d36e60 dirty=12`) ; son contenu est
identique à `1d3e75b251` (aucune modification entre le lancement et les commits ; `git status` propre après).

- Python : 640 tests, OK, 1 saut (référence 2088d36e60 : 635, OK, 1 saut ; +5 = les tests §37).
- API : 222/222.
- Site : 788/788 (la référence `baseline-2088d36e60/site.txt` montre 760 dont 9 échecs, environnement de la
  référence ; non dû à ce lot, qui ne touche pas le site).
