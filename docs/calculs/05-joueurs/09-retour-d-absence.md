# Retour d'absence et forme

Deux questions posées aux données de la base le 12 novembre 2026, et ce que le site en fait ([returns.py](../../../backend/vega/returns.py), `/api/players/{id}/return`).

## Ce qu'est une absence

La base ne connaît pas les blessures : une absence se lit dans les feuilles de match. Deux apparitions d'un joueur **pour le même club**, séparées d'au moins **30 jours**, pendant lesquels le club a joué au moins **4 matchs**. Une trêve sans match n'est donc pas une absence, un transfert non plus. La cause (blessure, suspension, choix de l'entraîneur) n'est pas connue.

Les minutes habituelles du joueur sont la moyenne de ses 8 dernières apparitions avant l'absence (4 au moins).

## Ce que montrent les données

Sur 855 278 apparitions de 41 612 joueurs (800 derniers jours) :

| Absence | Retours | 1er match | 2e | 3e | 4e | 5e |
| --- | --- | --- | --- | --- | --- | --- |
| 30 à 59 jours | 7 714 | 69 % | 88 % | 97 % | 102 % | 105 % |
| 60 à 119 jours | 4 564 | 68 % | 86 % | 94 % | 98 % | 101 % |
| 120 jours et plus | 2 776 | 69 % | 87 % | 95 % | 98 % | 101 % |

Lecture : part des minutes habituelles jouée au n-ième match de retour (37 minutes contre 54 au premier match après une absence de 30 à 59 jours). Les parts au-dessus de 100 % viennent de ce que seuls les joueurs qui enchaînent atteignent le cinquième match.

- **Le temps de jeu revient en trois ou quatre matchs**, quelle que soit la durée de l'absence.
- **Le niveau par 90 minutes ne baisse pas.** La contribution par 90 minutes d'un joueur de retour (celle du classement de puissance) est de +0,02 à +0,07 par rapport à ses matchs d'avant l'absence ; un joueur qui n'a pas été absent, mesuré de la même façon, est à +0,01 à +0,02 (l'écart-type d'un match est de 0,40). Aucune baisse ne se lit donc : un joueur qui revient joue moins, pas moins bien.

### Vérification sur des retours non vus

Courbe apprise sur les retours d'avant le 1ᵉʳ juillet 2026, jugée sur les 25 006 matchs de retour d'après : prévoir les minutes d'un match de retour par `minutes habituelles × part de la courbe` donne une erreur moyenne de 24,6 minutes, contre 25,3 en prévoyant ses minutes habituelles. Le gain est tout entier au premier match de retour (25,4 contre 28,6 minutes) ; dès le deuxième, la courbe ne fait pas mieux. Le temps de jeu d'un match reste très incertain (± 25 minutes) : la courbe dit une tendance, pas une prévision fine.

## La forme n'annonce rien de plus que la saison

Question : les cinq derniers matchs d'un joueur annoncent-ils ses cinq suivants ? Sur 42 553 points de 2025/2026 (joueurs avec dix matchs joués et cinq à venir), la contribution par 90 minutes des cinq matchs suivants se prévoit par `0,62 × moyenne de la saison jusque-là` (R² de 0,27 sur 2026/2027). Ajouter la moyenne des cinq derniers matchs ne change rien : son coefficient est de 0,03 et le R² reste à 0,27 ; les cinq derniers matchs seuls font moins bien (0,19). Un joueur « en forme » revient vers son niveau de saison.

Le site n'affiche donc **pas de prévision fondée sur la forme** : elle n'aurait pas de valeur mesurable. La carte « Forme récente » des fiches reste ce qu'elle est, la liste des notes des derniers matchs.

## Ce que le site affiche

Sur la fiche d'un joueur (onglet Statistiques), la carte « Retour d'absence » apparaît tant qu'il est en train de revenir : sa dernière absence, s'il est revenu depuis moins de 90 jours et a joué 8 matchs ou moins depuis. Elle donne la durée de l'absence et le nombre de matchs manqués, ses minutes depuis son retour à côté de ses minutes habituelles, et la courbe de la base pour une absence de cette durée (`agg.return_curves`, `agg.player_returns`). Un point de la courbe n'est gardé qu'à partir de 30 retours.
