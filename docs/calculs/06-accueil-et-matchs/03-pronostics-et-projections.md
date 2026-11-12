# Pronostics de match et projections de fin de saison

Code : [forecast.py](../../../backend/vega/forecast.py) ; lectures `/api/forecasts/match` et `/api/forecasts/season` ; sur le site, la carte « Probabilités » de l'avant-match et la vue « Projection » d'un championnat. Version du modèle : `forecast-v1` (12 novembre 2026).

## Le pronostic d'un match

Le modèle ne lit que la **force des deux équipes avant le match** (leur Elo, voir [Classements joueurs](../05-joueurs/05-classements-joueurs.md)) :

- écart : Δ = (Elo domicile + 60 − Elo extérieur) / 400 ; pas d'avantage du terrain en terrain neutre ;
- buts : buts domicile ~ Poisson(exp(a_d + b_d Δ)), buts extérieur ~ Poisson(exp(a_e − b_e Δ)) ; les quatre coefficients sont ajustés par maximum de vraisemblance sur tous les matchs de clubs terminés de la base (score à la 90ᵉ minute) ;
- petits scores : deux lois de Poisson indépendantes donnent trop peu de nuls ; les probabilités de 0-0, 1-0, 0-1 et 1-1 sont corrigées par le facteur de Dixon et Coles (1997), dont le paramètre ρ est ajusté sur les mêmes matchs ;
- victoire, nul, défaite : sommes sur la grille des scores de 0 à 10 buts ; le score affiché est le plus probable de la grille.

Le modèle ne connaît ni les compositions, ni les absents, ni les jours de repos, ni aucune cote de bookmaker.

### Vérification sur des matchs non vus

Modèle ajusté sur les 63 560 matchs de clubs des saisons jusqu'à 2025/2026, jugé sur les 11 552 matchs de 2026/2027 (12 novembre 2026) :

| Matchs | Perte logarithmique, modèle | Taux de base | Brier, modèle | Taux de base |
|---|---:|---:|---:|---:|
| Tous les matchs de clubs (11 552) | 1,0207 | 1,0704 | 0,6119 | 0,6473 |
| Cinq grands championnats (500) | 0,9499 | 1,0612 | 0,5623 | 0,6414 |
| Coupes d'Europe (198) | 0,9087 | 1,0425 | 0,5329 | 0,6294 |

Le « taux de base » est la fréquence des trois résultats dans l'historique, la même pour tous les matchs. Calibration de la victoire à domicile : parmi les matchs annoncés entre 50 et 60 % (2 196 matchs, 54,5 % en moyenne), 54,6 % ont été gagnés ; entre 30 et 40 %, 36,0 % pour 35,3 % annoncés ; entre 70 et 80 %, 75,3 % pour 74,0 %. Les nuls sont un peu sous-estimés (24,6 % annoncés, 25,5 % observés). La correction des petits scores change peu (1,0207 contre 1,0212 sans elle).

Aucune comparaison avec les cotes de clôture n'a été faite : la base n'en contient pas.

## La projection d'un championnat

Pour chaque championnat national en cours (au moins 8 clubs, tours réguliers seulement) : le classement actuel, puis les matchs restants **rejoués 1 000 fois** avec les lois ci-dessus. Chaque simulation classe les clubs aux points, à la différence de buts puis aux buts marqués ; la projection donne à chaque club ses points moyens en fin de saison et la part des simulations où il finit à chaque place (titre = première place).

La force d'un club n'est pas connue exactement et bougera d'ici la fin de saison : chaque simulation décale chaque force d'un tirage d'une loi normale d'écart-type **90 points Elo × √(part de ses matchs restant à jouer)**. Sans ce décalage, un leader de novembre était champion à 99,9 %.

### Vérification sur des saisons passées

Les 55 saisons de championnat complètes de 2024/2025 et 2025/2026 (12 clubs ou plus), rejouées depuis leur mi-parcours avec un modèle ajusté sur les saisons précédentes ; perte logarithmique de trois événements par club :

| Écart-type des forces | Titre | Quatre premiers | Trois derniers |
|---:|---:|---:|---:|
| 0 | 0,0970 | 0,2507 | 0,2593 |
| 30 | 0,0946 | 0,2478 | 0,2582 |
| 60 | 0,0956 | 0,2449 | 0,2543 |
| **90** | 0,0965 | **0,2406** | **0,2529** |
| 130 | 0,0987 | 0,2479 | 0,2605 |

90 points donnent la plus petite perte au total. À cette valeur, parmi les clubs annoncés champions entre 60 et 80 % (15 clubs, 68 % en moyenne), 73 % l'ont été.

## Limites

- Les colonnes « 4 premiers » et « 3 derniers » sont des places, pas les zones du règlement de chaque championnat (qualifications européennes, barrages, nombre de relégués).
- Un championnat à phases (tournois d'ouverture et de clôture, play-offs) est projeté sur ses seuls tours réguliers.
- Les forces de deux championnats hors de l'échelle commune ne se comparent pas ; cela ne gêne pas un championnat national, dont tous les clubs sont sur la même échelle.
- Calculé avec les modèles quotidiens de la saison (après l'Elo) : au plus tard une fois par jour, et dans l'heure qui suit un match terminé.
