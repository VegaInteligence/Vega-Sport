# Le Deploy en six parts et le Python en trois — preuves (28 nov. 2026)

Worktree `~/Agents/worktrees/Vega-parts-deploy-20261128`, branche `ci/parts-du-deploy`, départ `2f5a2d8fe1`.
Modes d'échec : en-tête de `backend/tests/test_ci_zones.py` ; tests g, i2, i3 et i3b modifiés ou écrits d'abord
(4 échecs avant le changement), 24 sur 24 ensuite. Pour le Python en trois parts : g et i2 modifiés d'abord
(2 échecs), 24 sur 24 ensuite.

Ce document a deux temps : le Deploy en six parts (sections « Constat de départ » à « Obtenu »), puis ce que son
premier run dans GitHub Actions a montré et le passage du Python à trois parts (les trois dernières sections).

## Constat de départ

- Run 46101676263 (PR #280, même arbre que `2f5a2d8fe1`) : parts du Deploy à 442, 375, 369 et 371 s, pour 1 391 s de
  tests ; `test_deploy_flow` 1 099 s en 36 scénarios (27 s en médiane, 102 s au plus), `test_account_deploy` 205 à
  235 s d'un seul bloc (160 à 257 s d'un run à l'autre), `test_panna_deploy` 54 s.
- Un passage de `deploy.sh` dans `test_GH157_a` : 181 appels aux outils simulés en 7,8 s, soit 22 à 68 ms par appel
  (un processus Python chacun) ; aucune attente à supprimer.

## Préparation et entrées

- PostgreSQL 18.6 (`~/Agents/scratch/passation-audit-20261119/pg18/…/native/bin`, deux grappes à soi, ports 54341 et
  54342), Docker 28.3.2 avec buildx (le contexte de BuildKit est réel), Node 24.18.0, venv Python 3.12 avec
  `backend/requirements.txt` et `backend/panna/requirements.txt`, `npm ci` dans `backend/api` et `backend/account`.
- Le commit de production pour `test_deploy_flow` : `git fetch --no-tags --depth=1 origin e40148035927db988d854b0971856f1187fa09b4`.
- Bases créées par `python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:<port>`.

## Rejeu

```
cd <worktree>
export PATH=<venv>/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH PYTHONPATH=backend
set -a; eval "$(python backend/ci/test_databases.py postgresql://postgres@127.0.0.1:<port>)"; set +a
for n in 1 2 3 4 5 6; do python backend/ci/python_suites.py deploy-$n; done        # les six parts
python backend/ci/python_suites.py deploy --list | sort > tout; for n in 1 2 3 4 5 6; do python backend/ci/python_suites.py deploy-$n --list; done | sort > parts; diff tout parts
(cd backend/tests && PYTHONPATH=..:. python -m unittest test_ci_zones)
(cd backend/tests && PYTHONPATH=..:. python -m unittest test_account_deploy.AccountDeployTest.<test>)   # un test seul
```

## Attendu

- Les six parts jouent chaque test du Deploy une fois, et passent.
- Un test de `test_account_deploy` ou de `test_panna_deploy` passe seul et dans n'importe quel ordre : aucun ne dépend
  de ce qu'un autre a laissé.
- Les parts sont proches les unes des autres, et aucune unité ne pèse la part entière d'un job.

## Obtenu

| Part | Tests | Durée locale |
| --- | --- | --- |
| deploy-1 | 9 | 185 s |
| deploy-2 | 9 | 183 s |
| deploy-3 | 12 | 173 s |
| deploy-4 | 11 | 190 s |
| deploy-5 | 23 | 190 s |
| deploy-6 | 12 | 174 s |

- 76 tests dans le groupe entier, 76 dans les six parts, aucun en double, aucun sauté (`six-parts-local.txt`). Les
  parts ont tourné trois par trois, côte à côte, sur les deux grappes.
- Les 22 tests de `test_account_deploy` et les 5 de `test_panna_deploy` passent chacun seul dans son processus, et
  les deux modules passent dans l'ordre inverse (`tests-seuls.txt`).
- `backend/ci/durations.json` refait par `durations.py` sur les six journaux du run 46101676263 : 231 à 232 s par
  part du Deploy (328 à 403 s à quatre parts sur ce run), 181 s par part Python, plus grosse unité 102 s.

## Premier run dans GitHub Actions : le Deploy en six parts, le Python encore en deux

Run 46152209159 de la PR 286 (commit `427ad2018e`), comparé aux autres runs complets du jour, Deploy en quatre parts
(`runs-github.txt`, durées de chaque job du début à la fin) :

| Run | Parts du Deploy | Parts Python | API | Run complet |
| --- | --- | --- | --- | --- |
| PR 286, six parts | 203 à 237 s | 319 et 369 s | 305 s | 384 s |
| main après #285 et #284, PR 287 : quatre parts, mêmes tests | 249 à 396 s | 248 à 357 s | 254 à 365 s | 368 à 426 s |
| main après #289 : quatre parts, neuf tests du Deploy de plus | 349 à 471 s | 290 et 296 s | 384 s | 484 s |

- Le Deploy n'est plus le plafond : sa part la plus lente passe à 237 s. Un seul run mesuré.
- Le run complet n'est pas plus court : `python-2` y dure 369 s. `test_panna_s1` (65 s) est arrivé par #285, et les
  suites Python ont pris 600 s dans ce run pour 436 s de poids. Les clones de base y coûtent 0,17 et 0,39 s l'un,
  contre 0,09 et 0,27 s dans le run 46101676263 ; **cause non établie** (deux migrations de plus, ou la machine).
- Le run est rouge pour une raison étrangère à cette branche : le test du site « R3 »
  (`tests/preference-render-matches.test.mjs`) contient un match du 28 nov. 2026 à 12 h 30 UTC et lit l'heure réelle,
  parce que `tests/support/render-component.mjs` rend toujours le vrai React et ignore l'horloge figée du test. Main
  passe à 12 h 21 UTC (run 46144276646) et échoue sur la même ligne à 12 h 57 et 15 h 43 (runs 46147167497 et
  46161337080) ; reproduit ici. Les PR 287 et 290, ouvertes, portent la correction : non touché dans cette branche.

## Le Python en trois parts

- `changed_suites.PARTS` : Python de 2 à 3 parts. `durations.json` refait par `durations.py` sur les six journaux du
  run 46161337080 de main (après #289, qui ajoute neuf tests au Deploy) : 262 s par part du Deploy, 170 s par part
  Python, aucune unité inconnue.
- Rejeu : une part par PostgreSQL 18.6 créé vide (`initdb`, `shared_preload_libraries=pg_stat_statements`), comme plus
  haut, avec `PGTZ=UTC` (la CI tourne en UTC) et `python backend/ci/python_suites.py python-N` pour N de 1 à 3.
- Attendu : les neuf parts passent et jouent la découverte entière, chaque test une fois.
- Obtenu (`neuf-parts-local.txt`) : les neuf parts passent ; 1 377 tests dans la découverte, 1 377 dans les neuf
  parts, aucun en double. Python 243, 188 et 250 s en local ; Deploy 206 à 269 s.
- `python-2` a d'abord eu 4 échecs, tous dans `test_panna_s1` et tous sur des heures attendues en UTC : le serveur
  local était à l'heure de Paris. Rejouée avec `PGTZ=UTC`, elle passe. Les huit autres parts ont tourné à l'heure de
  Paris.
- Cinq tests sautés en local, par les limites de ce poste (pas de pgvector, pas de conteneur PostgreSQL à lire, pas
  de `VEGA_IMAGE_REFRESH_BUILDKIT`) ; la CI les joue.

## Non vérifié

- Les durées dans GitHub Actions avec le Python en trois parts : à lire au prochain run de la PR. Attendu d'après les
  temps du jour : 3 à 4 min par part Python, la part API (4 min 14 s à 6 min 24 s) devenant le plafond.
- Le commentaire de `.github/workflows/ci.yml` sur les parts n'est pas retouché : le jeton utilisé pour pousser n'a
  pas le droit de modifier un workflow. La matrice vient de `changed_suites.py`, le workflow n'a pas à changer.
