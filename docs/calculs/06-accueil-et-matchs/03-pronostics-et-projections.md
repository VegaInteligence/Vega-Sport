# Pronostics de match et projections de fin de saison

Code : [forecast.py](../../../backend/vega/forecast.py) ; lectures `/api/forecasts/match` et `/api/forecasts/season` ; sur le site, la carte « Probabilités » de l'avant-match et la vue « Projection » d'un championnat. Version du modèle : `forecast-v2` (14 novembre 2026 ; la version 1, du 12 novembre, ne lisait que l'Elo).

## Le pronostic d'un match

Le modèle lit la **force des deux équipes avant le match** (leur Elo, voir [Classements joueurs](../05-joueurs/05-classements-joueurs.md)), corrigée de leur forme récente pour les matchs des quatorze prochains jours (plus bas) :

- écart : Δ = (Elo domicile + 60 − Elo extérieur) / 400 ; pas d'avantage du terrain en terrain neutre ;
- buts : buts domicile ~ Poisson(exp(a_d + b_d Δ)), buts extérieur ~ Poisson(exp(a_e − b_e Δ)) ; les quatre coefficients sont ajustés par maximum de vraisemblance sur tous les matchs de clubs terminés de la base (score à la 90ᵉ minute) ;
- petits scores : deux lois de Poisson indépendantes donnent trop peu de nuls ; les probabilités de 0-0, 1-0, 0-1 et 1-1 sont corrigées par le facteur de Dixon et Coles (1997), dont le paramètre ρ est ajusté sur les mêmes matchs ;
- victoire, nul, défaite : sommes sur la grille des scores de 0 à 10 buts ; le score affiché est le plus probable de la grille.

Ce premier pronostic ne connaît ni les compositions, ni les absents, ni aucune cote de bookmaker. Les compositions s'y ajoutent quand les deux clubs ont confirmé leur onze (ci-dessous). Les jours de repos ont été mesurés et n'apportent rien (plus bas).

### Vérification sur des matchs non vus

Modèle ajusté sur les 63 560 matchs de clubs des saisons jusqu'à 2025/2026, jugé sur les 11 552 matchs de 2026/2027 (12 novembre 2026) :

| Matchs | Perte logarithmique, modèle | Taux de base | Brier, modèle | Taux de base |
|---|---:|---:|---:|---:|
| Tous les matchs de clubs (11 552) | 1,0207 | 1,0704 | 0,6119 | 0,6473 |
| Cinq grands championnats (500) | 0,9499 | 1,0612 | 0,5623 | 0,6414 |
| Coupes d'Europe (198) | 0,9087 | 1,0425 | 0,5329 | 0,6294 |

Le « taux de base » est la fréquence des trois résultats dans l'historique, la même pour tous les matchs. Calibration de la victoire à domicile : parmi les matchs annoncés entre 50 et 60 % (2 196 matchs, 54,5 % en moyenne), 54,6 % ont été gagnés ; entre 30 et 40 %, 36,0 % pour 35,3 % annoncés ; entre 70 et 80 %, 75,3 % pour 74,0 %. Les nuls sont un peu sous-estimés (24,6 % annoncés, 25,5 % observés). La correction des petits scores change peu (1,0207 contre 1,0212 sans elle).

Aucune comparaison avec les cotes de clôture n'a été faite : la base n'en contient pas.

## La forme récente (version 2)

L'Elo suit les buts. Un club dont les occasions valent mieux que les résultats est plus fort que son Elo ne le dit, et l'inverse. Pour chaque club, sur ses **dix derniers matchs** qui ont un xG des deux côtés (au moins cinq, toutes compétitions) :

- x : la moyenne de sa différence de xG par match ;
- l : la moyenne de sa différence de buts moins cette différence de xG (ce que ses résultats doivent à autre chose qu'à ses occasions).

L'écart du pronostic devient Δ′ = Δ + F_xG × (x_domicile − x_extérieur) + F_l × (l_domicile − l_extérieur). Les deux coefficients sont ajustés par maximum de vraisemblance sur les matchs terminés où les deux clubs ont une forme, les quatre coefficients du pronostic tenus tels quels. La forme d'un club, en points Elo, est 400 × (F_xG × x + F_l × l) ; elle est écrite à côté de chaque pronostic (`home_form`, `away_form`) et la route `/api/forecasts/match` la rend (`form`). La carte « Probabilités » dit alors que le pronostic lit aussi les dix derniers matchs.

La forme ne compte que pour les matchs qui se jouent **dans les quatorze jours** ; plus loin, et dans la projection d'un championnat, les forces seules (la projection a été vérifiée ainsi, et une forme vieille de dix matchs n'annonce plus rien, voir ci-dessous).

### Vérification (14 novembre 2026)

Ajustement de production : 38 910 matchs où les deux clubs ont une forme, F_xG = 0,0699 et F_l = −0,0549, soit **+28 points Elo par but de xG d'écart par match et −22 par but de « réussite »**. Sur les 1 391 clubs qui ont une forme ce jour-là, elle vaut de −34 points Elo (5ᵉ centile) à +31 (95ᵉ), 0 en médiane.

Coefficients ajustés sur les saisons jusqu'à 2025/2026, jugés sur les 11 562 matchs de clubs de 2026/2027 (perte logarithmique des trois issues) :

| Matchs | Elo seul | Avec la forme |
| --- | ---: | ---: |
| Tous (11 562 ; forme nulle quand un club n'en a pas) | 1,02075 | **1,01546** |
| Les deux clubs ont une forme (10 917) | 1,02038 | 1,01478 |
| Forme lue 3 matchs plus tôt (10 607) | 1,02027 | 1,01662 |
| Forme lue 6 matchs plus tôt (10 328) | 1,02030 | 1,01882 |
| Forme lue 10 matchs plus tôt (10 042) | 1,02107 | 1,02100 |

Avec les compositions confirmées (4 268 matchs de 2026/2027 qui ont les deux) : Elo seul 1,00479 ; avec la forme 0,99817 ; avec les compositions 1,00203 ; avec les deux **0,99581**. Les deux corrections sont presque indépendantes (corrélation 0,09) : elles s'ajoutent.

**Mesuré et non retenu : les jours de repos.** Sur 20 238 matchs de 2025/2026, l'écart de jours de repos entre les deux clubs donne un coefficient de 0,7 point Elo par jour (z = 0,6), un repos de moins de quatre jours −4 points (z = −0,6) ; ni l'un ni l'autre n'améliore le pronostic des matchs non vus de 2026/2027 (1,02032 → 1,02035 et 1,02034). Le nombre de matchs joués dans les quatorze jours précédents a un coefficient significatif sur 2025/2026 (z = −2,3) mais dégrade 2026/2027 (1,02051) et change de signe quand on l'ajuste sur cette saison. Aucun des trois n'entre dans le modèle.

## Avec les compositions confirmées

Quand la base détient le onze **confirmé** des deux clubs, le pronostic du match est relu avec eux ([lineup.py](../../../backend/vega/lineup.py), mesures et vérification dans [Et si un joueur en remplaçait un autre ?](../05-joueurs/12-et-si-un-joueur-en-remplacait-un-autre.md)) :

- composition d'un côté : la somme des rendements propres de ses titulaires de champ, tels que le classement les connaît avant le match (l'année du trophée en cours et la précédente) ;
- écart : cette somme moins la moyenne des compositions précédentes du club dans l'année (`agg.lineup_usuals`, réécrite après chaque classement de l'année ; au moins cinq compositions) ;
- la force de chaque équipe (son Elo et sa forme) est déplacée de E × son écart, E étant les points Elo que vaut une unité de rendement (environ 45), puis le pronostic est recalculé comme plus haut.

La carte « Probabilités » affiche alors ce pronostic, dit ce que vaut chaque onze face à l'habituel de son club (proche en dessous de 0,15 d'écart, « nettement » à partir de 0,6) et rappelle les probabilités sans les compositions. La courbe du match part elle aussi de ce pronostic.

**Quand les compositions sont lues.** 48 heures avant le match (une composition probable), **50 puis 25 minutes avant le coup d'envoi**, et au coup d'envoi. Les deux lectures d'avant-match datent du 13 novembre 2026. Jusque-là la base ne recevait un onze confirmé qu'au coup d'envoi : ce jour-là, sur 54 matchs à jouer dans les 24 heures, 8 avaient une composition des deux côtés, toutes non confirmées (le dernier onze aligné, selon le fournisseur).

**Premières mesures (14 novembre 2026).** Les quatre premiers matchs joués après la mise en service ont tous reçu leur pronostic relu **avant** le coup d'envoi, deux à la lecture de 50 minutes et deux à celle de 25 minutes ; aucun match n'est resté sans.

| Match | Premier calcul | Écarts (domicile / extérieur) | Victoire à domicile | Résultat |
| --- | --- | --- | --- | --- |
| Inter Bogotá – Independiente Santa Fe | 23 min avant | −0,39 / +0,04 | 23,9 % → 21,7 % | 0–2 |
| Gifu – Matsumoto Yamaga | 24 min avant | +0,16 / −0,28 | 56,2 % → 59,2 % | 0–0 |
| Giravanz Kitakyushu – Thespa Gunma | 48 min avant | +0,24 / −0,46 | 52,5 % → 57,4 % | 4–3 |
| Fukushima United – Sagamihara | 48 min avant | +0,19 / −0,33 | 37,8 % → 41,3 % | 1–0 |

Quatre matchs ne jugent rien de la justesse : elle se lira sur `agg.match_lineup_forecasts` (conservé après le match, avec l'heure du premier calcul de chaque pronostic) quand il y en aura quelques centaines.

Seules les compositions confirmées sont lues : le « dernier onze » ou le onze « probable » du fournisseur ne déplace pas le pronostic.

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
- **à partir de la 60ᵉ minute** (version 2, 14 novembre 2026), une équipe qui mène marque `ahead` = 1 − t fois son rythme et une équipe menée `behind` = 1 + t fois ; t est le nombre, de 0 à 0,4 par pas de 0,025, qui rend les résultats des matchs de la base les plus probables, lus aux 60ᵉ, 75ᵉ et 85ᵉ minutes sur 5 000 matchs. Un score à égalité ne change aucun rythme ;
- le score final est le score du moment plus ces buts ; les petits scores finaux gardent la correction du pronostic, si bien qu'au coup d'envoi les trois probabilités sont celles du pronostic.

Les forces de départ sont les deux Elo d'avant le match ; quand le match a un pronostic relu avec ses compositions confirmées, ce sont celles de ce pronostic (Elo, forme et écart du onze).

Les buts sont comptés pour l'équipe à qui la source les attribue. Le score que la source écrit sur un événement de but n'est pas lu : c'est celui d'avant le but dans certains matchs, d'après dans d'autres. Un match n'entre dans l'ajustement, et n'a de courbe, que si ses événements de but donnent son score final. Le dernier point d'un match terminé est son résultat. À côté du graphique, chaque but est suivi de ce qu'il a changé : les chances de victoire de l'équipe qui marque, la minute d'avant et à la minute du but. Pour un match en cours, l'heure est la dernière minute que la source a mesurée (momentum ou événement).

### Vérification sur des matchs non vus (12 novembre 2026)

Ajusté sur 16 326 matchs de clubs de 2025/2026 (43 877 buts, 3 040 matchs avec expulsion) : parts des buts par quart d'heure 12,8 % · 13,7 % · 18,0 % (temps additionnel de la première période compris) · 16,2 % · 15,8 % · 16,0 %, et 7,5 % après la 90e minute ; à dix, une équipe marque 0,59 fois son rythme et son adversaire 1,73 fois. Jugé sur les 11 420 matchs de 2026/2027 :

| Minute | 0 | 15 | 30 | 45 | 60 | 75 | 85 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Perte logarithmique (trois issues) | 1,021 | 0,973 | 0,917 | 0,835 | 0,738 | 0,584 | 0,426 |

À la 60e minute, par dixième de probabilité de victoire à domicile (annoncé → observé) : 0,04 → 0,06 ; 0,14 → 0,16 ; 0,26 → 0,26 ; 0,34 → 0,36 ; 0,44 → 0,47 ; 0,55 → 0,54 ; 0,66 → 0,62 ; 0,75 → 0,71 ; 0,84 → 0,80 ; 0,97 → 0,96. Juste après une première expulsion (1 349 matchs), l'équipe réduite à dix est annoncée gagnante, à égalité ou perdante dans 18,7 % / 21,0 % / 60,3 % des cas ; elle l'est dans 18,0 % / 23,0 % / 59,0 %.

Ces chiffres sont ceux de la version 1, qui ne lisait pas le score : passé l'heure de jeu, une équipe qui menait l'emportait 3 à 5 points moins souvent qu'annoncé.

### Version 2 : l'équipe qui mène (14 novembre 2026)

Facteurs ajustés sur 21 626 matchs de 2025/2026 (t = 0,15 : 0,85 et 1,15), jugés sur les 11 430 matchs de 2026/2027. « Annoncé » est la probabilité moyenne de victoire de l'équipe qui mène à cette minute, « joué » la part de ces matchs qu'elle a gagnés :

| Minute | 15 | 30 | 45 | 60 | 75 | 85 |
| --- | --- | --- | --- | --- | --- | --- |
| Perte logarithmique, version 1 | 0,9736 | 0,9171 | 0,8348 | 0,7379 | 0,5840 | 0,4258 |
| Perte logarithmique, version 2 | 0,9731 | 0,9161 | 0,8323 | 0,7345 | 0,5822 | 0,4251 |
| Annoncé, version 1 | 0,681 | 0,713 | 0,764 | 0,815 | 0,875 | 0,923 |
| Annoncé, version 2 | 0,646 | 0,678 | 0,728 | 0,777 | 0,852 | 0,910 |
| Joué | 0,654 | 0,686 | 0,730 | 0,780 | 0,853 | 0,910 |

L'écart de 3 à 5 points est ramené à moins d'un point à chaque minute. Ajustés sur les deux saisons, comme en production, les facteurs sont 0,90 et 1,10. Ils sont gardés jusqu'à ce que la base ait 10 % de matchs en plus (leur recherche prend une dizaine de secondes).

Deux essais écartés. Deux facteurs libres au lieu d'un : les résultats ne les distinguent pas (0,85 et 1,10, 0,95 et 1,10 ou 1,15 et 1,20 donnent presque la même vraisemblance). Les facteurs appliqués dès le coup d'envoi : les minutes 15 à 30 étaient moins bien annoncées qu'avec la version 1.

Le modèle ne connaît que le score, l'heure et les expulsions : ni la pression, ni les occasions, ni les changements.

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
- La forme récente et les compositions ne déplacent que le pronostic d'un match ; la projection d'un championnat et les points attendus de la colonne « Adv. à venir » au-delà de quatorze jours lisent les forces seules.
- Calculé avec les modèles quotidiens de la saison (après l'Elo) : au plus tard une fois par jour, et dans l'heure qui suit un match terminé.
