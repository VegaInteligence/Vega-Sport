# Score Vega v9.1 : gardiens et latéraux

**Statut : choix de l'utilisateur du 24 novembre 2026, ticket [#90](https://github.com/VegaInteligence/Vega-Sport/issues/90).** Version `score-vega-v9.1`, en production depuis le 24 novembre 2026 (PR #91, Deploy 128 ; chiffres réels au § 4.1). Le classement public reste `power-ranking-v8` et le site n'affiche pas le niveau : rien ne change pour le visiteur. Les règles et les cas d'échec sont dans [FAILURE_MODES § 54](../09-audit-2026-11/FAILURE_MODES.md).

## 1. Pourquoi

La première lecture des six saisons en production ([02 § 7](02-mise-en-service.md)) montrait 36 gardiens dans les 100 premiers de 2024/2025, aucun de 2021/2022 à 2023/2024, et beaucoup de latéraux en haut. L'utilisateur a demandé une mesure avant toute correction, et a nommé la méthode corrigée v9.1.

## 2. La mesure

Une tâche en lecture seule sur la base de production, le 24 novembre : le module du niveau de `main` (`0302d456`) relit chaque saison comme le worker, dans une session qui refuse les écritures, et s'arrête avant d'écrire. Son script et sa sortie sont gardés hors du dépôt.

### 2.1 Gardiens : deux défauts

| Saison | Minutes de gardien avec buts évités | Gardiens à 900 minutes | Sans aucun but évité | Avec des buts évités sur moins de la moitié de leurs minutes | Référence mesurée sur la saison (5ᵉ au 95ᵉ centile) |
| --- | --- | --- | --- | --- | --- |
| 2021/2022 | 1 % | 396 | 299 | 97 | pas de mesure possible |
| 2022/2023 | 5 % | 523 | 162 | 359 | pas de mesure possible |
| 2023/2024 | 6 % | 657 | 237 | 419 | pas de mesure possible |
| 2024/2025 | 55 % | 995 | 379 | 37 | 5 395 minutes (3 786 à 8 051) |
| 2025/2026 | 65 % | 1 146 | 370 | 48 | 13 291 minutes (8 058 à 33 843) |
| 2026/2027, en cours | 63 % | 650 | 215 | 9 | 4 137 minutes (2 706 à 9 657) |

- **Les buts évités manquent avant 2024/2025.** Le niveau d'un gardien y est celui de son club et de ses titularisations, pas de ses arrêts. Depuis, un gardien sur trois à 900 minutes n'en a toujours aucun.
- **La référence mesurée par saison est instable.** C'est le nombre de minutes pour lequel les buts évités d'un gardien comptent pour moitié. Un gardien par équipe et un compte très variable d'un match à l'autre : la mesure passe de 5 395 à 13 291 minutes d'une saison à la suivante. Avec 5 395, les arrêts d'une saison pèsent trop et 36 gardiens entrent dans les 100 premiers.
- Mesurée sur plusieurs saisons réunies : 8 179 minutes sur les saisons de gardien de 2024/2025 et 2025/2026 (6 626 à 12 042), 10 639 en prenant toutes les saisons d'un gardien comme un seul groupe (8 198 à 14 871).

| Référence du gardien | Gardiens dans les 100 premiers, 2024/2025 | 2025/2026 | 2026/2027 |
| --- | --- | --- | --- |
| Mesurée par saison (v9) | 36 | 9 | 11 |
| 8 324 minutes (saisons réunies) | 24 | 23 | 21 |
| 13 291 minutes (v9.1) | 10 | 9 | 11 |

Les gardiens sont 8 % des joueurs classés.

### 2.2 Postes de champ : une échelle entre les postes

Chaque poste est centré sur la moyenne de ses propres joueurs. Si les joueurs d'un poste sont en moyenne moins forts que ceux d'un autre, ce centre est trop bas et le poste est surévalué. Un joueur jugé à deux postes le mesure : sa valeur face aux joueurs d'un poste, moins sa valeur face à ceux de l'autre. Sur les joueurs de référence masculins de 2021/2022 à 2026/2027 (450 minutes sur deux saisons à l'autre poste, 18 614 observations, 21 paires de postes vues dans les deux sens), on ajuste une force par poste, de moyenne nulle (χ² de 18,3 pour 14).

| Poste | Force mesurée | Par saison, 2022/2023 à 2026/2027 | 900 minutes aux deux postes | Valeur marchande à niveau et club égaux, contre un milieu central |
| --- | --- | --- | --- | --- |
| Avant-centre | − 2,83 ± 0,17 | − 3,06 · − 3,22 · − 3,33 · − 2,49 · − 1,91 | − 2,37 | + 0,6 point (+ 3,1 à âge égal) |
| Milieu offensif | + 2,40 ± 0,14 | + 1,79 · + 1,77 · + 2,42 · + 2,81 · + 2,79 | + 2,33 | + 2,9 (+ 2,6) |
| Ailier | + 0,43 ± 0,12 | − 0,94 · − 0,33 · + 1,10 · + 1,10 · + 0,95 | + 0,39 | + 2,8 (+ 0,6) |
| Milieu excentré | − 0,62 ± 0,21 | − 1,37 · − 1,23 · + 0,56 · − 0,11 · − 0,42 | − 0,85 | − 0,5 (− 2,1) |
| Milieu central | + 0,69 ± 0,10 | + 0,45 · + 0,73 · + 0,59 · + 0,68 · + 0,81 | + 0,84 | référence |
| Milieu défensif | + 0,81 ± 0,11 | + 0,66 · + 1,27 · + 0,79 · + 0,49 · + 0,51 | + 0,90 | − 0,8 (− 2,0) |
| **Latéral** | **− 1,05 ± 0,11** | − 0,59 · − 1,08 · − 0,91 · − 1,23 · − 0,90 | − 1,10 | − 6,3 (− 5,8) |
| Défenseur central | + 1,00 ± 0,15 | + 1,91 · + 1,67 · + 0,78 · + 0,59 · + 0,01 | + 0,72 | − 5,1 (− 3,3) |

Une force négative dit que le poste est surévalué d'autant. La valeur marchande (Transfermarkt, janvier à juillet 2026, 10 891 joueurs, 2 813 avec l'âge) sert de contrôle de sens, pas de mesure : un point de niveau du club y pèse huit fois un point de niveau propre.

### 2.3 Quatre contrôles avant d'appliquer une force

1. Stable d'une saison à l'autre.
2. Tient quand on exige 900 minutes aux deux postes.
3. Égale à la première estimation de l'étude.
4. Du même sens que la valeur marchande.

**Seul le latéral passe les quatre** (− 1,04 dans l'étude). L'avant-centre et le défenseur central sont contredits par le marché. L'ailier et le défenseur central changent entre 2021–2023 et 2024–2026. Le milieu offensif en passe trois, mais tombe à + 0,66 ± 0,61 quand on exige 1 800 minutes aux deux postes. Chez les latéraux, ceux d'une défense à quatre sont à − 1,52 et les pistons à − 0,51 : le v9.1 applique la valeur d'ensemble.

## 3. Ce que le v9.1 change

1. **Référence du gardien fixe** : `KEEPER_LAMBDA` = 13 291 minutes pour toutes les saisons. Elle n'est plus mesurée ni gardée avec le calcul. C'est une convention, le choix de l'utilisateur : la mesure de 2025/2026, la plus haute de celles du § 2.1 (8 179 sur deux saisons réunies, 10 639 par gardien) ; 10 600 était l'autre valeur défendable, avec une quinzaine de gardiens dans les 100 premiers.
2. **Gardien non mesuré** : un gardien dont moins de la moitié des minutes dans les buts de la saison ont des buts évités (`KEEPER_MEASURED_SHARE` = 0,5) est marqué `measured = false`. Ses chiffres sont calculés comme avant ; l'API donne son rang comme provisoire, raison `keeper_data`. De 2021/2022 à 2023/2024, c'est le cas de presque tous les gardiens.
3. **Latéraux à − 1,05** : dans l'univers masculin, le centre des latéraux est leur moyenne plus 1,05 point (`POSITION_OFFSETS`). Un joueur perd 1,05 point multiplié par sa part de minutes au poste de latéral. Le décalage est dans `blocks` : `own = blocks + starts` et `level = own + club` tiennent toujours.
4. **Version `score-vega-v9.1`** : au déploiement, `stale_rankings` liste toutes les saisons depuis 2021 et le worker les recalcule, la plus ancienne d'abord, en quelques passes. Migration 169 : colonne `agg.player_level.measured`, servie par `api.player_levels`.

## 4. Effet attendu

Dans les 100 premiers des joueurs de référence masculins (lignes de la mesure, sauf la dernière) :

| | 2021/22 | 2022/23 | 2023/24 | 2024/25 | 2025/26 | 2026/27 |
| --- | --- | --- | --- | --- | --- | --- |
| Gardiens, v9 | 0 | 0 | 0 | 36 | 9 | 11 |
| Gardiens, référence fixe | 0 | 0 | 0 | 10 | 9 | 11 |
| Latéraux, v9 | 18 | 15 | 12 | 8 | 9 | 16 |
| Latéraux, référence fixe | 18 | 15 | 12 | 13 | 9 | 16 |
| Latéraux, référence fixe et − 1,05 (simulation, à un ou deux près) | 14 | 10 | 10 | 10 | 8 | 12 |

45 à 66 joueurs sont à moins d'un point de la 100ᵉ place selon la saison : ces comptes bougent de quelques unités pour peu de chose. Les chiffres réels se liront après le recalcul. Ils incluront aussi le nouvel Elo des sélections (#89), que le recalcul de chaque saison relit : une partie de l'écart entre v9 et v9.1 viendra de là.

### 4.1 Chiffres réels en production

Lus sur l'API de production le 24 novembre, après le recalcul des six saisons (de 10:18 à 10:47 UTC), parmi les 100 premiers joueurs de référence :

| | 2021/22 | 2022/23 | 2023/24 | 2024/25 | 2025/26 | 2026/27 |
| --- | --- | --- | --- | --- | --- | --- |
| Gardiens, v9 | 0 | 0 | 0 | 36 | 9 | 11 |
| Gardiens, v9.1 | 0 | 0 | 0 | 10 | 10 | 13 |
| Latéraux, v9 | 18 | 15 | 12 | 8 | 9 | 16 |
| Latéraux, v9.1 | 14 | 11 | 10 | 11 | 8 | 12 |

- Les latéraux sont à un près de la simulation. Les gardiens de 2025/2026 et de 2026/2027 sont un et deux de plus que la ligne « référence fixe » : leur valeur ne change pas (0 à + 0,1 point), la baisse des latéraux libère des places.
- En 2024/2025, les gardiens des 200 premières lignes perdent 8,6 points en moyenne (2,6 à 13,9). Le premier, Yéhvann Diouf, passe de la 1ʳᵉ place (35,9) à la 35ᵉ (22,0).
- De 2021/2022 à 2023/2024, les gardiens sortent avec un rang provisoire, raison `keeper_data` ; le premier de 2021/2022 est 200ᵉ.
- Les latéraux des 200 premières lignes perdent 0,91 à 1,01 point en moyenne selon la saison.
- Hors gardiens et latéraux, aucun joueur des 200 premières lignes ne bouge de plus de 0,1 point, sauf 26 joueurs qui ont une part de leurs minutes au poste de latéral, à hauteur de cette part. Le changement d'Elo des sélections entre les deux calculs pèse donc 0,1 point au plus sur le niveau de ces joueurs.

Ce recalcul a lu l'Elo des sélections de 10:15 UTC, où l'Italie et la Grèce manquaient (FAILURE_MODES § 55). Depuis le § 56 (ticket #93), une année dont le classement a lu un autre Elo des sélections que celui en service est reclassée. C'est fait : après la fusion de la PR #95 (squash, `main` `5615aad5`) et le Deploy 131 réussi à 11:44 UTC, la première passe quotidienne du worker a reclassé les six saisons 2021/2022 à 2026/2027, la plus ancienne d'abord, de 11:44 à 12:13 UTC (classement v8 et niveau), sur l'Elo des sélections de 11:06 UTC (211 sélections, Italie et Grèce comprises ; cet Elo n'a pas été refait). Relu en production le 24 novembre : parmi les 100 premiers joueurs de référence, les comptes du tableau ne changent pas (gardiens 0 / 0 / 0 / 10 / 10 / 13, latéraux 14 / 11 / 10 / 11 / 8 / 12) ; dans les 200 premières lignes de chaque saison, 28 niveaux sur 1 200 changent, tous de 0,1 point. Non mesurés : l'effet sur le classement public v8 des années passées et les joueurs au-delà des 200 premières lignes. Les relevés sont gardés hors du dépôt (`/mnt/project-files/vega-score-v9/reclassement-elo/prod_2026-11-24.md`).

## 5. Ce qui reste ouvert

- Les buts évités d'avant 2024/2025 : à demander au fournisseur ; sans eux, les gardiens de ces saisons restent non mesurés.
- Le calibrage des buts évités par championnat : quatre gardiens du championnat belge sont dans les vingt premiers de 2024/2025 avec la référence par saison.
- Le milieu offensif (+ 2,40), à remesurer avec une saison de plus.
- Le poids du club (ψ = 10), très en dessous de ce que le marché lui donne.
- Les gardiens classés avec les joueurs de champ ou à part : à trancher avec la bascule du site.
- L'univers féminin : aucun décalage, faute de mesure.
