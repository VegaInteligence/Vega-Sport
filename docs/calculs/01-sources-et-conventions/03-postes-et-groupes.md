# Postes et groupes de comparaison

Les centiles joueurs comparent un joueur à ceux du **même groupe de poste**. Le poste vient du numéro d'emplacement dans la composition (`positionId`), pas d'une étiquette éditoriale.

Code : `positionOf` et `peerGroup` dans [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L26) ; même table en SQL dans [031_indexed_performance_cohorts.sql](../../../dashboard/backend/migrations/031_indexed_performance_cohorts.sql) et [025_player_season_rollups.sql](../../../dashboard/backend/migrations/025_player_season_rollups.sql).

## Du `positionId` à la ligne

Les titulaires ont un emplacement de formation ; les remplaçants ont leur ligne habituelle (0 à 3).

| `positionId` | Ligne | Groupe |
| --- | --- | --- |
| 0, 11 | Gardien | **G** |
| 1, 30–39, 51, 59 | Défenseur | **D** |
| 2, 50–79 (sauf 51 et 59) | Milieu | **M** |
| 80–89 | Milieu offensif | **O** |
| 3, 90–119 | Attaquant | **O** |
| autre ou absent | — | voir ci-dessous |

Milieux offensifs et attaquants forment **un seul groupe O** (« milieux offensifs et attaquants »).

## Sans poste connu

- Pour **une performance** (`peerGroup`) : arrêts > 0 → G ; sinon **F**, « joueurs de champ ».
- Le groupe F se compare à **tous les joueurs de champ** : la distribution F reçoit aussi les performances D, M et O (`outfield` dans [player-profile.js](../../../dashboard/frontend/src/services/player-profile.js#L50) ; `ARRAY['D','M','O','F']` côté SQL).
- Pour **une saison**, un joueur sans aucun poste connu n'a pas de groupe et n'entre dans aucune cohorte saison.

## Poste d'une saison

Une saison peut mêler plusieurs postes. `finish()` dans [season-player.js](../../../dashboard/frontend/src/services/season-player.js#L227) :
1. additionne les minutes par groupe ;
2. retient le groupe qui a le plus de minutes ;
3. dans ce groupe, retient la ligne qui a le plus de minutes (par exemple « Milieu offensif » plutôt qu'« Attaquant »).

## Ce que le groupe change

Le groupe décide :
- de la cohorte de comparaison (centiles) ;
- de l'ordre des sections du profil (G : gardien, passe, défense ; D : défense, passe, création, finition ; M : passe, création, défense, finition ; O et F : finition, création, passe, défense) ;
- des chiffres clés affichés (`FIGURES`) et des axes du radar et de la pizza ;
- des profils de rôle évalués (voir [Indices Vega](../05-joueurs/03-indices-vega-et-roles.md)).
