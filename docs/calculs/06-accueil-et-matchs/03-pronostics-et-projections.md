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

## Pendant le match

La fiche d'un match joué ou en cours trace « Probabilité de victoire » : les chances de victoire, de nul et de défaite minute par minute ([inplay.py](../../../backend/vega/inplay.py), `/api/forecasts/live`).

À une minute donnée, avec le score et les expulsions du moment :

- les buts encore à venir de chaque équipe suivent une loi de Poisson de moyenne `λ × R(minute) × facteur d'expulsion`, où `λ` est le nombre de buts attendus du pronostic d'avant-match (les deux Elo d'avant le match) ;
- `R(minute)` est la part des buts d'un match marqués après cette minute, lue sur les buts de la base par quart d'heure, les buts d'après la 90e minute comptés à part et étalés sur 8 minutes de temps additionnel ;
- une équipe réduite à dix marque `down` fois son rythme et son adversaire `up` fois, les deux mesurés sur ce que les équipes marquent après un carton rouge, rapportés à ce qu'elles marquent à onze contre onze ;
- le score final est le score du moment plus ces buts ; les petits scores finaux gardent la correction du pronostic, si bien qu'au coup d'envoi les trois probabilités sont celles du pronostic.

Les buts sont comptés pour l'équipe à qui la source les attribue. Le score que la source écrit sur un événement de but n'est pas lu : c'est celui d'avant le but dans certains matchs, d'après dans d'autres. Un match n'entre dans l'ajustement, et n'a de courbe, que si ses événements de but donnent son score final. Le dernier point d'un match terminé est son résultat. À côté du graphique, chaque but est suivi de ce qu'il a changé : les chances de victoire de l'équipe qui marque, la minute d'avant et à la minute du but. Pour un match en cours, l'heure est la dernière minute que la source a mesurée (momentum ou événement).

### Vérification sur des matchs non vus (12 novembre 2026)

Ajusté sur 16 326 matchs de clubs de 2025/2026 (43 877 buts, 3 040 matchs avec expulsion) : parts des buts par quart d'heure 12,8 % · 13,7 % · 18,0 % (temps additionnel de la première période compris) · 16,2 % · 15,8 % · 16,0 %, et 7,5 % après la 90e minute ; à dix, une équipe marque 0,59 fois son rythme et son adversaire 1,73 fois. Jugé sur les 11 420 matchs de 2026/2027 :

| Minute | 0 | 15 | 30 | 45 | 60 | 75 | 85 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Perte logarithmique (trois issues) | 1,021 | 0,973 | 0,917 | 0,835 | 0,738 | 0,584 | 0,426 |

À la 60e minute, par dixième de probabilité de victoire à domicile (annoncé → observé) : 0,04 → 0,06 ; 0,14 → 0,16 ; 0,26 → 0,26 ; 0,34 → 0,36 ; 0,44 → 0,47 ; 0,55 → 0,54 ; 0,66 → 0,62 ; 0,75 → 0,71 ; 0,84 → 0,80 ; 0,97 → 0,96. Juste après une première expulsion (1 349 matchs), l'équipe réduite à dix est annoncée gagnante, à égalité ou perdante dans 18,7 % / 21,0 % / 60,3 % des cas ; elle l'est dans 18,0 % / 23,0 % / 59,0 %.

Limite mesurée : passé l'heure de jeu, une équipe qui mène l'emporte 3 à 5 points moins souvent qu'annoncé (une équipe menée marque un peu plus que son rythme, ce que le modèle ne lit pas). Il ne connaît que le score, l'heure et les expulsions : ni la pression, ni les occasions, ni les changements.

## Le calendrier à venir

La colonne « Adv. à venir » de la projection lit les pronostics des matchs restant à jouer de l'édition (`api.schedule_forecasts`, la route `/api/forecasts/season` rend `next` pour chaque club) :

- les cinq prochains matchs de championnat du club, par date ;
- `opponentLevel` : la moyenne des forces (Elo avant le match) de ces adversaires ;
- `expectedPoints` : la somme, sur ces matchs, de 3 × P(victoire) + P(nul) du pronostic, qui tient compte du terrain ;
- `home` : le nombre de ces matchs joués à domicile ;
- `rank` : le rang de ce calendrier parmi les clubs qui ont encore cinq matchs, 1 pour la moyenne d'adversaires la plus haute. Un club à qui il en reste moins n'est pas classé.

Le niveau des adversaires ne dit rien du club lui-même : deux clubs au même calendrier n'en attendent pas les mêmes points.

## Limites

- Les colonnes « 4 premiers » et « 3 derniers » sont des places, pas les zones du règlement de chaque championnat (qualifications européennes, barrages, nombre de relégués).
- Un championnat à phases (tournois d'ouverture et de clôture, play-offs) est projeté sur ses seuls tours réguliers.
- Les forces de deux championnats hors de l'échelle commune ne se comparent pas ; cela ne gêne pas un championnat national, dont tous les clubs sont sur la même échelle.
- Calculé avec les modèles quotidiens de la saison (après l'Elo) : au plus tard une fois par jour, et dans l'heure qui suit un match terminé.
