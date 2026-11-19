# Lot « identités » — preuves (19 nov. 2026)

Branche `claude/audit-identites` (worktree `/home/romai/Agents/worktrees/vega-audit-identites-20261119`), partie de `main` 2088d36e60.
Commits : 92de59554a (§39 + tests), 16f789abe8 (Barcelona + alias + 156), b6afa7057e (Elo administratif), 336fc684a9 (UEFA / graphies SportScore).

## Lectures de production (GET publics, CloudFront, heure UTC dans `prod/*.time`)

| Fichier | Constat |
|---|---|
| `prod/cup-copa-del-rey-2024.json` (13:22) | les 6 rencontres de Copa del Rey 2024/25 de « FC Barcelona » ont `sides.*.id = t_2fucJi` (Barcelona SC, 707) |
| `prod/power-clubs-2024-2025.json` (13:21) | 707 : 44 matchs, `lastMatchAt` 2025-04-26 (finale de Copa), Elo 1659,9 ; run calculé 05:31 UTC |
| `prod/cup-france-2024.json` | Tours–Lorient servi `score.ft [0,3]` sans `status: awarded` : stocké `finished`, donc admis à l'Elo par `main` |
| `prod/archive-2008-2009*.json` | « Ligue des champions » `g:champions-league` (Europe) 2008/09 : 33 rencontres CONCACAF (Cruz Azul, Atlante, Saprissa…) |
| `prod/cup-l_v000010{2,3,4}.json`, `prod/e04g-35-presence.txt` | aucune des 35 rencontres anglaises (ids 8049–8060, 8290–8301, 8534–8544) n'est dans les tables publiques ; 0/35 par date + équipes + score, et aucune ligne aux dates 31/08, 01/09 (332, 334) et 05/09 (333) |
| `prod/search-*.json` | la recherche publique ne renvoie plus de club d'Incheon / Suwon (K League retirée) |

## Tests (rouge puis vert)

Préparation : PostgreSQL 18.6 `127.0.0.1:55536`, base `vega_v2_identity_test`.

Rejeu :
```
cd /home/romai/Agents/worktrees/vega-audit-identites-20261119
VEGA_V2_IDENTITY_TEST_DSN=postgresql://postgres@127.0.0.1:55536/vega_v2_identity_test PYTHONPATH=backend CI=true \
  /home/romai/Agents/scratch/passation-audit-20261119/venv/bin/python -m unittest backend/tests/test_identity_corrections.py -v
```

- Rouge (code de 2088d36e60, tests de 92de59554a) : `rouge/test_identity_corrections.txt` — 8 échecs (39a, 39b, 39c/d, 39e, 39f, 39g, 39h/i, 39j) pour les raisons attendues (alias sur 707, fusion dans 707, côtés sur 707, Tours–Lorient et 13507 admis à l'Elo, UEFA lié à 845). 39k passe déjà (aucun changement côté SportScore).
- Vert : `vert/test_identity_corrections.txt` — 9 tests OK.

Attendus : FAILURE_MODES.md §39.2.

## Suites complètes

- Départ 2088d36e60 : `suites-depart/` — Python 635 OK (1 skip pgvector).
- Après correctifs (avant le dernier ajustement de `open_matchday_restore`) : `suites-fin-1/` — Python 644 OK (skip pgvector), API 222/222, site 788/788.
- HEAD 336fc684a9 (propre) : `suites-fin/` — Python 644 OK (1 skip pgvector), API 222/222, site 788/788.

## Outil de restauration Open Matchday (E04g)

`e04g-dry-run-empty-copy.txt` : sur une base locale vierge migrée jusqu'à 156, le dry-run avec les deux captures du capsule
(`rds/avant.zlib` ed7496ec…, `rds/apres.zlib` e850dd9e…) franchit le contrôle de schéma et l'inventaire des dépendances puis
refuse comme attendu sur `referenced parent drift: core.seasons` (base vide). Sans le changement de `REVIEWED_SCHEMAS`, il refusait sur
`unreviewed destination schema version` dès que 156 est appliquée.
