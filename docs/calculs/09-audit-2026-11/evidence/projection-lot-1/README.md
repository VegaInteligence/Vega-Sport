# Projection de saison, lot 1 — preuve (issue #217, 25 novembre 2026)

Ce dossier permet de rejouer les vérifications du lot 1 et de comparer leurs résultats. Les règles et les résultats attendus sont dans `../../FAILURE_MODES.md`, § 62.

## Ce qu'il faut

- Python 3.12 ou plus, sans dépendance : les tests de `backend/tests/test_forecast.py` et `measure.py` ne lisent aucune base.
- Pour 62r et 62s (`backend/tests/test_models.py`) : une base PostgreSQL 18 jetable nommée `vega_v2_models_test`, `psycopg`, et `VEGA_V2_MODELS_TEST_DSN` (voir `backend/README.md`). La CI les lance.

## Commandes

Depuis la racine du dépôt :

```bash
python3 -m unittest backend.tests.test_forecast -v
```

```bash
python3 -I docs/calculs/09-audit-2026-11/evidence/projection-lot-1/measure.py "$PWD/backend"
```

Pour la mesure sur main, donner à `measure.py` le dossier `backend` d'une copie de main (`git worktree add --detach <dossier> main`).

## Attendu et obtenu

| Vérification | Attendu | Obtenu | Fichier |
|---|---|---|---|
| Les 16 tests du § 62.2 sur le code de main `de4d5cd32e` | tous en échec, chacun sur le défaut qu'il vise | 16 en échec (11 échecs, 5 erreurs de fonction absente) | `red-before-the-code.txt` |
| `test_forecast.py` après le code | 41 tests verts | 41 verts | `green-after-the-code.txt` |
| Parts déplacées par +1 point Elo au dernier, 1 000 rejeux, 30 graines | au plus 0,5 point | −0,1 à +0,3 (main : −5,4 à +4,4) | `measure-branch.txt`, `measure-main.txt` |
| Parts déplacées par un match joué entre le 10ᵉ et le 11ᵉ | au plus 1 point | −0,2 à +0,3 (main : −5,0 à +6,0) | les mêmes |
| Durée d'un championnat de 190 matchs restants, 1 000 rejeux | mesurée avant et après | 0,161 s puis 0,202 s (un quart de plus) | les mêmes |
| 62r, 62s sur la base des modèles | 8 lignes justes pour l'édition 9300, aucune pour 9301 | **non lancé** : pas de PostgreSQL dans cette session | — |

## Limites

- Aucune lecture de la base de production : le nombre de matchs reportés, attribués ou sans Elo que ces règles concernent n'est pas mesuré.
- `measure.py` lit un championnat fictif construit avec le modèle des tests, pas un championnat réel.
- La suite complète du backend (`python3 -m unittest discover -s backend/tests`) rend ici 50 erreurs d'import, les mêmes que sur main `de4d5cd32e` : `psycopg` et `botocore` ne sont pas installés dans cette session.
