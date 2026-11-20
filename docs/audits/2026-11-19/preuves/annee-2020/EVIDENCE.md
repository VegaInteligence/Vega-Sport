# Année de notation 2020 : notée contre 2021, jamais classée (E04f, E04k ; FAILURE_MODES §47)

Décision de l’utilisateur, 20 novembre 2026 : les participations de l’année de notation 2020 (1er août 2020 – 31 juillet 2021) sont notées contre les références de l’année 2021, et aucun classement ni prix 2020 n’est publié.

## 1. Constat en production (API publique, 20 nov. 2026)

```sh
curl -sSL "https://vegasport.vercel.app/api/rankings/power?kind=players&season=2020/2021&limit=10" -o prod-ranking-2020-2021.json
```

Résultat (`prod-ranking-2020-2021.json`, en-têtes dans `prod-ranking-2020-2021.headers`) : un classement 2020/21 est servi, `power-ranking-v8`, calculé le 18 nov. 2026 à 23:39:58 UTC, sept secondes après celui de 2021/22. Ses dix premiers sont des joueurs de MLS (1. Carles Gil, New England Revolution, 93,4). Le chemin quotidien n’atteint pas 2020 (§38) ; l’étape des classements périmés l’a fait, parce qu’un calcul 2020 d’une méthode antérieure était publié. L’année a donc été classée et notée contre ses propres références. Les « 14 418 non notées » du registre datent du relevé de 18 h 37, avant ce calcul. Leur état actuel en base n’est pas lu : pas d’accès à la base.

## 2. Spécification avant les tests

`docs/calculs/09-audit-2026-11/FAILURE_MODES.md` §47 : règles 47.1, cas 47a–47f.

## 3. Tests (rouge, puis vert)

`backend/tests/test_player_grade_reasons.py`, base `vega_v2_grades_test`. La base de §38 est reprise telle quelle : une ligue à année civile 2021, dont 31 journées tombent avant le 1er août 2021, soit 682 participations de l’année 2020 ; une ligue août–mai 2021/22. Le déroulé reproduit celui de la production :
1. l’Elo ;
2. un premier calcul de 2020 selon l’ancienne règle (son classement et ses références propres), comme le 18 novembre ;
3. le chemin quotidien ;
4. l’étape des classements périmés ;
5. un second passage.

Le test 38a, jusqu’ici marqué « échec attendu », est remplacé par 47a.

Rejeu :

```sh
S=/home/romai/Agents/scratch/passation-audit-20261119
cd /home/romai/Agents/worktrees/vega-audit-reprise-20261119
export PATH=$S/venv/bin:$PATH
PGPORT_LOCAL=55533 $S/work/run-suites.sh "$PWD" $S/evidence/annee-2020/suites py   # crée les bases et dsn.env
set -a; . $S/evidence/annee-2020/suites/dsn.env; set +a
PYTHONPATH=backend CI=true python -m unittest backend/tests/test_player_grade_reasons.py -v
```

- **Rouge** sur `79ef8bbb45`, avec les nouveaux tests (`red-47.txt`), 4 échecs :
  - 47a : `[(2020, 2020, 682)] != [(2020, 2021, 682)]`, les notes de 2020 sont calculées contre 2020 ;
  - 47b : `88 != 0`, le classement 2020 est gardé ;
  - 47c et 47f : `[] != [2020]`, l’étape des classements périmés ne reprend jamais 2020.
- **Vert** après la correction (`green-47.txt`) : 12/12.

## 4. Correction

`backend/vega/power.py` :
- `partial_year` : une année dont la saison propre n’a aucune statistique de joueur, alors que la première moitié de la saison suivante en a ;
- `partial_years` ;
- `refresh_players` : une année partielle est notée contre les références de l’année suivante, si celle-ci est terminée. Son classement, ses rôles et son prix sont vidés, ses références propres supprimées, et le calcul est publié avec `players` = 0 ;
- `stale_rankings` : ajoute une année partielle quand elle n’a pas de calcul de la méthode en cours, ou quand son calcul est plus ancien que le dernier de l’année suivante.

`METHOD_VERSION` est inchangé ; aucune migration.

## 5. Suites complètes

Sur l’arbre de travail dont le code est commité tel quel en `b2bedf115f` (`suites/context.txt`) : Python 747 OK (1 sauté : pgvector absent en local), API 226/226, site 788/788 (`suites/python.txt`, `api.txt`, `site.txt`). Référence `79ef8bbb45` : Python 743 OK, 1 échec attendu (38a).

## 6. Ce que le déploiement changerait, et qui n’est pas vérifié

- Le classement 2020/21 et sa course au prix disparaissent de la production à la première étape des classements périmés suivant le déploiement. Les notes des matchs de janvier à juillet 2021 des ligues à année civile changent de valeur, puisqu’elles passent des références 2020 à celles de 2021.
- Le classement 2021/22 lit le classement 2020 comme a priori pour les joueurs de ces ligues. Il le garde jusqu’à son prochain calcul, qui n’en trouvera plus.
- Non vérifié : l’état actuel des notes 2020 en base, et la durée du calcul sur la base de production.
