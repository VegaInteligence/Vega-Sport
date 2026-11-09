# Indicateurs d'équipe

Le profil club calcule 46 indicateurs, définis dans l'objet `METRICS` de [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L656).

## Matière première : une ligne par match

`teamRows` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L545)) produit une ligne par match **terminé** avec deux scores entiers :
- `gf`, `ga` : buts marqués et encaissés (score final) ;
- `result` (V / N / D) et `points` (3 / 1 / 0) ;
- `own` et `opp` : les statistiques d'équipe du club et de l'adversaire (`STATS`), ou `null` si les statistiques du match ne sont pas fiables ;
- `xpts` : points attendus du match (voir [xPts](../03-resultats-et-points-attendus/01-points-attendus-xpts.md)).

## Deux façons d'agréger

- **Moyenne par match** (`mean`) : moyenne des valeurs observées, les matchs sans valeur sont ignorés.
- **Rapport de sommes** (`ratio`) : `échelle × Σ numérateur / Σ dénominateur`, sur les matchs où les deux termes sont connus. Un taux n'est jamais une moyenne de taux par match.

**Base de calcul.** Les points, buts et matchs sans encaisser utilisent **tous** les matchs. Tous les autres indicateurs utilisent **uniquement les matchs où les deux xG d'équipe sont connus** (filtre `has`), y compris ceux qui ne dépendent pas du xG (possession, passes, duels…).

**Sens.** `better = 1` : plus haut est meilleur ; `−1` : plus bas est meilleur (le centile est inversé) ; `0` : indicateur de style, sans bon ou mauvais côté.

## Résultats

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Points / match | moyenne des points (tous les matchs) | + |
| xPts / match | moyenne des xPts | + |

## Attaque

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Buts marqués / match | moyenne de `gf` (tous les matchs) | + |
| xG / match | moyenne de xG | + |
| xG hors penalty / match | moyenne de npxG | + |
| xG en jeu ouvert / match | moyenne de `expected_goals_open_play` | + |
| Grosses occasions / match | moyenne de `big_chance` | + |
| Tirs / match | moyenne de `total_shots` | + |
| Tirs cadrés / match | moyenne de `ShotsOnTarget` | + |
| xG par tir (hors penalty) | Σ npxG / Σ tirs | + |
| Tirs dans la surface | 100 × Σ tirs dans la surface / Σ tirs | + |
| Ballons dans la surface / match | moyenne de `touches_opp_box` | + |

## Finition et gardien

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Finition (buts − xG) / match | moyenne de `gf − xG` | + |
| Buts évités par le gardien / match | moyenne de `xGOT adverse − ga` | + |
| Conversion des tirs | 100 × Σ `gf` / Σ tirs | + |
| xG cadrés (xGOT) / match | moyenne de xGOT | + |
| Qualité de frappe (xGOT − xG) / match | moyenne de `xGOT − xG` (matchs avec xGOT) | + |

## Défense

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Buts encaissés / match | moyenne de `ga` (tous les matchs) | − |
| xG concédés / match | moyenne du xG adverse | − |
| xG concédés hors penalty / match | moyenne du npxG adverse | − |
| Tirs concédés / match | moyenne des tirs adverses | − |
| Grosses occasions concédées / match | moyenne des grosses occasions adverses | − |
| Ballons adverses dans la surface / match | moyenne de `touches_opp_box` adverse | − |
| Tirs cadrés concédés / match | moyenne des tirs cadrés adverses | − |
| xG concédés en jeu ouvert / match | moyenne du xG adverse en jeu ouvert | − |
| Matchs sans encaisser | 100 × matchs avec `ga = 0` / matchs (tous les matchs) | + |

## Contrôle et territoire

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Possession | moyenne de `BallPossesion` (%) | style |
| Passes / match | moyenne de `passes` | style |
| Passes adverses / match | moyenne des passes adverses | style |
| Passes réussies | 100 × Σ passes réussies / Σ passes | + |
| Territoire (field tilt) | 100 × Σ passes du club dans le camp adverse / Σ (passes du club + de l'adversaire dans le camp adverse) | + |
| Part des ballons dans les surfaces | 100 × Σ ballons du club dans la surface adverse / Σ (ceux du club + ceux de l'adversaire) | + |
| Jeu long | 100 × Σ longs ballons réussis / Σ passes réussies | style |
| Centres réussis / match | moyenne de `accurate_crosses` | style |

## Pressing et duels

| Indicateur | Formule | Sens |
| --- | --- | --- |
| PPDA (approx.) | Σ passes adverses dans leur propre moitié / Σ (tacles + interceptions + fautes du club) | − |
| Tacles + interceptions (ajusté poss.) | moyenne par match de `(tacles + interceptions) × 50 / (100 − possession)` | style |
| Duels gagnés | 100 × Σ duels gagnés du club / Σ (duels gagnés du club + de l'adversaire) | + |
| Duels aériens gagnés | 100 × Σ aériens gagnés du club / Σ (aériens gagnés du club + de l'adversaire) | + |
| Fautes / match | moyenne de `fouls` | style |

Le **PPDA** (*passes allowed per defensive action*) mesure combien de passes l'adversaire peut jouer avant une action défensive. Bas = pressing agressif. C'est une **approximation** : le fournisseur ne donne pas la zone des actions défensives, donc toutes les actions défensives du match comptent, pas seulement celles dans la moitié adverse.

L'**ajustement à la possession** ramène le volume défensif à une possession adverse de 50 % : avec 60 % de possession (40 % pour l'adversaire), 20 actions deviennent 20 × 50 / 40 = 25.

## Coups de pied arrêtés

| Indicateur | Formule | Sens |
| --- | --- | --- |
| xG sur CPA / match | moyenne de `expected_goals_set_play` | + |
| xG concédés sur CPA / match | moyenne du xG adverse sur CPA | − |
| Part des CPA dans les xG | 100 × Σ xG sur CPA / Σ xG | style |
| Corners / match | moyenne de `corners` | + |
| Corners concédés / match | moyenne des corners adverses | − |

## Discipline

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Cartons jaunes / match | moyenne de `yellow_cards` | − |
| Cartons rouges | **total** de la saison (pas une moyenne) | − |

## Moyenne glissante

La tendance xG pour / contre ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L838)) utilise `rolling` : moyenne des 5 derniers matchs (moins au début de saison), valeurs absentes ignorées.

## Résumé club des autres pages

La fiche match (« Forme avant le match ») et l'effectif utilisent `clubSummary` ([club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js#L162)), plus simple : bilan V / N / D, points, buts, matchs sans encaisser (domicile, extérieur, total), puis moyennes par match de 15 statistiques (xG pour et contre, différence de xG, tirs pour et contre, possession, passes, ballons dans la surface, corners, duels, aériens, tacles, interceptions, dégagements, arrêts). Ici, une statistique est moyennée sur les seuls matchs où elle est observée, indépendamment du xG. Le même calcul existe en SQL pour l'annuaire des clubs ([relational-clubs.js](../../../dashboard/backend/services/relational-clubs.js#L195)).
