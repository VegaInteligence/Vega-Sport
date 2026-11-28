# Le Deploy en six parts, ses tests répartis un par un — preuves (28 nov. 2026)

Worktree `~/Agents/worktrees/Vega-parts-deploy-20261128`, branche `ci/parts-du-deploy`, départ `2f5a2d8fe1`.
Modes d'échec : en-tête de `backend/tests/test_ci_zones.py` ; tests g, i2, i3 et i3b modifiés ou écrits d'abord
(4 échecs avant le changement), 24 sur 24 ensuite.

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

## Non vérifié

- Les durées dans GitHub Actions : à lire au premier run de la PR. Attendu : environ 4 min 30 s par part du Deploy sur
  un run lent, la part API (5 à 6 min 15 s) devenant le plafond d'un run complet.
