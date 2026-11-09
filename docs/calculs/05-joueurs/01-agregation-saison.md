# Agrégation d'une saison joueur

Code : `addAppearance`, `finish`, `seasonMetric` dans [season-player.js](../../../dashboard/frontend/src/services/season-player.js#L171). La base fait le même calcul par saison et compétition dans `refresh_player_season_rollups` ([025_player_season_rollups.sql](../../../dashboard/backend/migrations/025_player_season_rollups.sql)).

## Quels matchs comptent

Une ligne de composition devient un **match joué** si :
- elle a un identifiant de match, pas encore vu pour ce joueur ;
- ses minutes sont un nombre **> 0**.

Minutes non numériques → match compté dans `unknownMinutes`, pas dans les matchs joués. Remplaçant inscrit sans entrer (0 minute) → ignoré.

## Ce qui est accumulé

Pour chaque mesure de comptage (buts, xG, tirs, tacles…), trois nombres :
- `sum` : somme des valeurs observées ;
- `count` : nombre de matchs où la valeur est observée ;
- `minutes` : minutes de ces matchs.

Pour chaque taux, numérateur et dénominateur séparés, sur les matchs où les deux sont observés :
- **Précision des passes** : `100 × Σ passes réussies / Σ passes tentées` (matchs avec tentatives > 0) ;
- **Duels gagnés %** : `100 × Σ duels gagnés / Σ (duels gagnés + perdus)`.

Également : matchs, minutes totales, titularisations (`starts` sur `knownStarts`, les matchs où l'information est connue), équipes, compétitions, poste dominant (voir [Postes](../01-sources-et-conventions/03-postes-et-groupes.md)).

## Trois bases d'affichage

`seasonMetric(profil, mesure, base)` :

| Base | Formule |
| --- | --- |
| Total | `sum` |
| Par match | `sum / count` |
| Par 90 min | `90 × sum / minutes` |

Le **par 90 divise par les minutes des matchs où la mesure est observée**, pas par toutes les minutes du joueur. Un taux (précision, duels %) est le même dans les trois bases.

Exemple : 3 matchs de 90, 45 et 90 minutes ; xG observé 0,4 et 0,3 sur les deux premiers, absent sur le troisième.
- Total = 0,7 ; par match = 0,7 / 2 = **0,35** ;
- par 90 = 90 × 0,7 / 135 = **0,47** (et non 90 × 0,7 / 225 = 0,28).

## Note saison

Moyenne simple des notes observées (`ratingSum / ratingCount`). L'accueil utilise une moyenne pondérée par les minutes (voir [Note du match](../02-metriques-attendues/04-note-du-match.md)).

## Annuaire des joueurs

`playerAverage` ([player-directory.js](../../../dashboard/frontend/src/services/player-directory.js#L51)) expose chaque mesure dans la base choisie, et la colonne **minutes** en minutes **par match** (`minutes / matchs`). Les filtres « minutes min. », « note min. » et les conditions (« xG ≥ 0,3 ») s'appliquent à ces valeurs affichées. Le tri place les valeurs absentes en dernier.

## Côté base : agrégats par partition

`player_season_rollups` stocke, par saison × compétition × joueur, les mêmes `sum`, `count`, `minutes` (et numérateur / dénominateur pour les taux). Les totaux de plusieurs compétitions s'additionnent tant qu'un joueur et un match n'appartiennent qu'à une compétition ; si la même performance apparaît dans deux compétitions (`player_rollup_ambiguous`), le serveur revient au calcul exact sur les observations plutôt que de doubler les totaux.
