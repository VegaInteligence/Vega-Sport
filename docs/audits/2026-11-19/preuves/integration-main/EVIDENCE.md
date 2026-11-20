# Finalisation de la PR 58 : fusion de main `c4a3cacd77`, année 2020 dans l’ordre de la production, internationaux hors du réveil de l’Elo (FAILURE_MODES §48)

Le 20 novembre 2026, Opus 5.5 a travaillé seul, en local, sur le worktree `delivery/revue-opus-fable-20nov-e82992/candidat`, branche `claude/audit-reprise-33`. Le plan suivi est celui de Fable (`finalisation-brief-valide-fable.md`, PLAN READY), qui fait suite aux deux revues de `e82992a37d` (`avis-fable.md` : CHANGES_REQUESTED ; `avis-opus.md` : BLOCKED).

Rien n’a été poussé, déployé ni lu en base de production. Aucun autre agent n’a été lancé.

## 0. Références vérifiées avant d’intégrer

`git ls-remote origin` (lecture), 20 nov. :
- `refs/heads/main` = `c4a3cacd777c632bf4a96b8724eb2b6e2f85ca4b` ;
- `refs/heads/claude/audit-reprise-33` = `refs/pull/58/head` = `e82992a37d6b372d27d916a1f3ad8982b2d87661`, immobile.

L’objet `c4a3cacd77` était déjà local : aucun fetch n’a été nécessaire.

Inventaire `e82992a37d..c4a3cacd77` : huit commits de main, de `f5a9308ed1` à `c4a3cacd77`. Entre `797ddf6d32`, relu par les revues, et `c4a3cacd77`, seuls des fichiers du site changent (le graphique de dynamique du match). Le diff backend de main depuis la base commune `2088d36e60` est identique, ligne à ligne, à `dernier-main.patch` (diff vide, hors lignes `index`) :
- `home.mjs` et ses deux tests ;
- `nations-results.mjs` ;
- `154_home_internationals.sql` ;
- `test_source_identity.py` (E1) ;
- `power.py` (`ELO_MATCHES`) ;
- `cups.py` (neuvième édition).

Aucune condition d’arrêt du plan n’est remplie :
- main n’a aucune migration ≥ 155 ;
- main ne touche pas `power.py`, `worker.py`, `cups.py` ni `backend/sql` au-delà du patch relu ;
- le seul conflit est dans `power.py`.

## 1. Fusion M0 = `1594b63731`

```sh
git merge --no-ff --no-commit c4a3cacd777c632bf4a96b8724eb2b6e2f85ca4b
```

Un seul conflit textuel, le commentaire de `ELO_MATCHES` dans `backend/vega/power.py`. Les deux mentions sont gardées : `ADMINISTRATIVE` côté candidat, « the season’s other internationals » côté main.

Git a fusionné seul le reste :
- la ligne SQL `left(coalesce(cs.cup_key, ''), 31) <> 'nations-results:internationals:'` et le `NOT EXISTS` d’`ADMINISTRATIVE` sont tous deux présents ;
- les entrées de main dans `WORKLOG.md` sont sous « Travail publié », avec sa section « Nation page ».

`git grep` ne trouve aucun marqueur de conflit. Les parents de M0 sont `e82992a37d` et `c4a3cacd77`.

Contrôle S2 : `git diff c4a3cacd77..HEAD` est vide sur `dashboard/`, `infra/aws/`, `backend/vega/migrate.py` et `backend/api/src/db.mjs`. `store.migrate` est identique entre `bfab25d4ef` et HEAD. Sous `backend/sql`, HEAD n’ajoute que 155, 156, 157, 159 et 160.

## 2. Spécification, puis tests, puis code

| Commit | Contenu |
| --- | --- |
| `048700c7a8` | §48 de `docs/calculs/09-audit-2026-11/FAILURE_MODES.md` (règles 48.1, cas 48a–48l), avant tout test |
| `f133ab8c85` | tests : `test_award_year_2020_order.py` (48a–48e), `test_collection_wakeups.py` (48f–48h, et 37g–37j adaptés à neuf éditions = 48i), `test_deploy_migrations.py` (48j–48l), base `vega_v2_deploy_test` |
| `16a782abb6` | code : `power.stale_rankings` et `worker._COMPLEMENTARY` |

Les tests existants ne sont pas modifiés, sauf 37g–37j. Leur attendu de huit éditions devient neuf : main ajoute la neuvième, qui lit le même `results.csv`. Pour cela, un amical 2026/27 est ajouté au CSV de test, et les huit en dur sont remplacés par `len(NATIONS_SCOPES)`. Ce test non adapté est rouge sur M0 (`m0-existing.txt` : la neuvième édition est inattendue). Adapté, il est vert sur M0 : le code de lecture partagée couvrait déjà la neuvième édition.

## 3. Environnement

- PostgreSQL 18.6, conteneur neuf `vega-opus-finalisation-20nov-pg18` (`pgvector/pgvector:pg18`), `127.0.0.1:55561`, `trust`, runtime colima `default`. Aucune base existante n’est touchée.
- Python 3.14.6 (`ci-clean`), Node 24.15.0 pour l’API et 26.4.0 pour le site, bun.
- Bases créées par `python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:55561 > dsn.env`.
- `npm ci --prefix backend/api` passe avant Python.

## 4. Rouge sur M0, vert sur le code

Commande (`run-48.sh`, copie ; l’exécutable est sous `validation-opus/`) :

```sh
set -a; . dsn.env; set +a; export PYTHONPATH=backend CI=true
python -m unittest backend/tests/test_award_year_2020_order.py backend/tests/test_collection_wakeups.py \
  backend/tests/test_deploy_migrations.py backend/tests/test_player_grade_reasons.py backend/tests/test_source_identity.py -v
```

### Rouge, `red-48.txt`

Sur `f133ab8c85` (tests commités, code = M0) : 46 tests, 6 échecs.

| Cas | Obtenu sur M0 |
| --- | --- |
| 48a | `stale_rankings` = `[]` alors que 2020/21 est classé (calcul publié avec `players` > 0) |
| 48b | aucune ligne `player ranking season=2020` : 2020 n’est pas recalculée par `Worker.daily` |
| 48d | les notes de 2020 ne changent qu’après un nouveau calcul de 2021 (références 2020 → 2021) |
| 48e | après le passage, `/api/rankings/power?kind=players&season=2020/2021` répond toujours 200, avec et sans `scope=all` |
| 48f | un amical des internationaux déclenche un second calcul Elo (`[(1, 'superseded', 1), (3, 'published', 1)]`) |
| 48h | sans calcul Elo, des internationaux seuls déclenchent un calcul Elo (`1 != 0`) |

Les 40 autres tests passent sur M0. On y trouve :
- 48c, trivialement : rien ne bouge sur M0 ;
- 48i, adapté ;
- 48j–48l : la migration ne demande pas de code, ce sont des preuves d’intégration ;
- les tests §47 existants, qui reproduisaient l’ordre inverse.

### Vert, `green-48.txt`

Sur `16a782abb6` : 46/46.

## 5. Ce que les tests établissent

**48a–48e** : les deux ligues de §38, sous les rôles réels.
- **Mise en place.** On reproduit l’historique de la production avec le code d’avant : l’Elo, puis 2020 classée par l’ancienne règle, puis le calcul quotidien de 2021 (qui lit ce classement comme a priori), puis 2020 classée à nouveau par l’ancienne règle, après 2021.
- **48a.** Deux calculs v8 de 2020, le dernier avec `players` > 0 ; classement et références propres présents ; 682 notes contre 2020 ; le calcul 2020 démarre après celui de 2021. `stale_rankings` = `[2020]`.
- **48b.** Le vrai `Worker.daily` écrit `player ranking season=2020 method=power-ranking-v8 players=0`. Résultat :
  - 682 notes avec `ref_season` 2021 ;
  - aucune ligne 2020 dans `agg.player_power`, `agg.player_power_roles` ni la course au prix ;
  - un seul calcul publié de 2020, avec `players` = 0 ;
  - aucune référence de `ref_season` 2020 ;
  - pour 2021, les empreintes du classement, des rôles, du prix, des calculs, des notes et des références sont inchangées.
- **48c.** Un second passage n’ajoute aucun calcul et ne réécrit aucune note.
- **48d.** Après `refresh_players(2021)`, 2020 est listée une fois puis plus ; ses notes ne sont pas réécrites.
- **48e.** API réelle sous `vega_read` (`read_http.mjs`).
  - Avant le passage, 2020/21 répond 200 avec des lignes. Après, 404 avec ou sans `scope`.
  - 2021/22 rend le même corps avant et après.
  - Sur un match 2020, `/api/rankings/match` lit la note de chaque méthode depuis sa ligne : références 2020 avant, 2021 après, les valeurs diffèrent.
  - 682 statuts `graded` ou `below_display_threshold`.

**48f–48h** : le vrai worker, le pont et la projection, `results.csv` lu par le préchargement de test.
- **48f.** Brazil–Japan, amical 2026/27 : `elo_due` faux, aucun calcul Elo, aucun côté de ce match.
- **48g.** Scotland–Switzerland, Ligue des nations : un calcul, ses côtés publiés ; le passage suivant n’en fait aucun.
- **48h.** Sans calcul Elo, des internationaux seuls ne déclenchent rien.

**48j–48l** : le vrai `python -m vega.migrate`, d’abord sur une copie du backend réduite aux fichiers jusqu’à 154, puis sur l’arbre fusionné, deux fois.
- **48j.** Les compteurs successifs :
  - `migrations applied=160 total=160 logins=unchanged`, le décompte de la production (160 fichiers hors `vector_optional`, `V2_VECTOR` absent de l’infrastructure) ;
  - puis `applied=5 total=165` pour 155, 156, 157, 159 et 160 ;
  - puis `applied=0 total=165`.

  Les lignes ≤ 154 et leurs sommes sont inchangées. `vega_read` lit `api.home_internationals`, `api.standings`, `api.nation_matches` et `api.player_grade_status`.
- **48k.** 159 fait passer la version de l’édition A de 4 à 5 et crée celle de B (1) ; C reste à 2, et seule C est servie. 160 vide `read_at` du premier 404 et de la liste vide acceptée puis refusée : les deux cas sont indiscernables en base. `read_at` est gardé pour l’unité acceptée, l’unité avec épisode et l’autre type.
- **48l.** L’amical figure une fois dans `api.nation_matches`, au nom de l’édition « Matchs internationaux 2026/2027 », tour `Friendly`. Constat seulement, l’écran n’est pas modifié :
  - `matchCarousel` de main, appliqué à ce match avec les dépendances du site de la répétition, donne le groupe « Matchs internationaux 2026/2027 2026/27 » (saison en double), pas « Matchs amicaux » ;
  - le libellé est le même sans 159 : `cups.save` nomme la compétition d’après la projection de main.

## 6. Suites complètes

Harnais : `run-ci.py`, copie du harnais du 19 nov. (`reprise-claude-19nov/preuves-opus-retours-fable/run-ci/run-ci.py`). Seuls changent la base jetable, le dossier de sortie et la liste des classes E2E contrôlées (§47, §48 ajoutés). L’ordre est celui de `ci.yml` : `npm ci` avant Python.

Résultats : section 7.

## 7. Résultats des passes complètes

Commandes, lancées depuis `validation-opus/run-ci/` :

```sh
ci-clean/bin/python run-ci.py rehearsal-16a782abb6 <candidat> --rehearsal 16a782abb6
ci-clean/bin/python run-ci-main-reference.py main-c4a3cacd77 <candidat> --rehearsal c4a3cacd777c632bf4a96b8724eb2b6e2f85ca4b
```

`--rehearsal` extrait l’arbre par `git archive` dans un dossier neuf. La référence de main a tourné sur un second conteneur jetable, `vega-opus-finalisation-20nov-main-pg18` sur le port 55562, avec le même harnais. Reçus : `suites-16a782abb6.json` et `suites-main-c4a3cacd77.json`. Les journaux complets sont sous `validation-opus/run-ci/` ; leur SHA-256 figure dans chaque reçu.

| Arbre | Python | API | Site | Autres tâches |
| --- | --- | --- | --- | --- |
| code `16a782abb6` (arbre `c82f3a0585`) | 758/758 OK, aucun sauté, aucun échec attendu ; les 12 classes E2E contrôlées toutes `ok` | 227/227 | 803/803 | build du site, image du worker et ses 4 contrôles de `ci.yml`, `cfn-lint`, `bash -n` sur `deploy.sh` et `secrets.sh`, paquets API et live : tous à 0 |
| main `c4a3cacd77` seul (référence) | 636/636 OK, aucun sauté | 223/223 | 803/803 | tous à 0 ; verdict E2E faux, les classes §47 et §48 n’existant pas sur main |

Les totaux sont exactement la somme attendue :
- **Python** : 747 du candidat `e82992a37d`, plus 1 de main (E1), plus 10 nouveaux, soit 758.
- **API** : 226, plus 1 de main, soit 227.
- **Site** : 803, ceux de main ; le candidat ne touche pas au site.

Ces passes ne lancent jamais `infra/aws/deploy.sh` : seul `bash -n` le lit.

Le SHA final du rapport ne change aucun code (`git diff 16a782abb6 <final> -- backend dashboard infra .github` vide). La passe complète, hors répétition, sur ce SHA final propre est enregistrée hors du dépôt, sous `validation-opus/run-ci/final-<sha>/` : la consigner ici changerait le SHA.

## 8. Ce qui reste hors de cette preuve

- Aucune CI GitHub sur ce SHA : le push demande l’accord de Hugo.
- Aucune lecture SQL de la production : que 2020 soit la seule année partielle, l’heure exacte des calculs, les volumes visés par 159 et 160, la durée du calcul 2020 sur RDS.
- Le gate AWS des erreurs 53300 (`REPRISE.md`, « État AWS ») n’est pas traité ici.
- E04l reste partiel : l’écran « moy. 50 » n’est pas modifié sans maquette validée.
- Linear n’est pas vérifié.

## 9. Seconde intégration : main `61d0ab3573` (après le CODE PASS Fable sur `25834c73b9`)

`git ls-remote origin` au début de la phase : `main` = `61d0ab3573051e5a1cc493558ddbb1f3871b2e30` ; la PR et la branche distante restent à `e82992a37d`. Main a ajouté sept commits depuis `c4a3cacd77` :
- l’interface de la page club et de la journée, de `f2b200bdcb` à `bb0ac6ab16` ;
- le correctif de capacité de l’API de lecture, `41a8e75a7d` (tests) puis `61d0ab3573` (code) ;
- la règle d’`AGENTS.md` sur les issues GitHub.

`git merge --no-ff 61d0ab3573` donne `a97bc68cf5`, sans conflit. Les parents sont `25834c73b9` et `61d0ab3573`, et aucun marqueur ne reste. Contrôles en lecture :
- **Ce qui ne bouge pas.** L’écart avec ce main sur `backend/`, `infra/`, `dashboard/`, `tests/` et `.github/` concerne les mêmes fichiers que l’écart `c4a3cacd77..25834c73b9`. Sur `backend/` et `infra/`, son contenu est identique ligne à ligne (diff des deux diffs vide, hors lignes `index`). Le code relu CODE PASS n’a donc pas bougé.
- **Ce qui vient de main.** `git diff 61d0ab3573 a97bc68cf5` est vide sur `infra/`, `backend/vega/migrate.py`, `backend/api/src/db.mjs`, `backend/api/src/handler.mjs` et `dashboard/`. Le correctif et le site sont ceux de main.
- **154 identique à la production.** Blob `b6ac3564cb` sur `bfab25d4ef`, `61d0ab3573` et `a97bc68cf5` ; SHA-256 `1267453c…`.
- **Seuls nouveaux SQL.** `git diff --name-status bfab25d4ef a97bc68cf5 -- backend/sql` ne montre que l’ajout de 155, 156, 157, 159 et 160, comme contre `61d0ab3573`. Les fichiers ≤ 154 que 48j applique sont donc bien ceux de la production, ce qui répond au point 2 de Fable.

La passe complète sur le SHA intégré, rapport compris, est consignée hors du dépôt, sous `validation-opus/run-ci/integre-<sha>/` et `validation-opus/RECAP-integre.md`. Elle inclut les tests de capacité de main : `test_api_capacity.py`, `edge.test.mjs`, `db.test.mjs`.
