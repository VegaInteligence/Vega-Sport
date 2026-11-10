# Provenance des données

Toutes les statistiques de match viennent de **PitchAPI**. Vega les lit à trois niveaux : le tir, l'équipe dans un match, le joueur dans un match. Aucune valeur « attendue » (xG, xA, xGOT, buts évités) n'est recalculée : Vega n'a pas de modèle de tir.

Code de lecture : build_dashboard_data.py (ancien backend, supprimé le 10 novembre 2026) (`PLAYER_METRICS`, `build_snapshot`). Les mêmes colonnes sont typées en base par relational_metric_ddl.py (ancien backend, supprimé le 10 novembre 2026).

## Niveau tir

Chaque tir conserve ses champs source, dont :

| Champ Vega | Champ PitchAPI | Sens |
| --- | --- | --- |
| `xg` | `expected_goals` | Probabilité que ce tir devienne un but, estimée par PitchAPI avant la frappe |
| `xgot` | `expected_goals_on_target` | Valeur du tir après placement, pour les tirs cadrés |
| `isGoal` | `event_type == "Goal"` et pas `is_own_goal` | But, contre son camp exclu |
| `isOwnGoal` | `is_own_goal` ou `event_type == "OwnGoal"` | But contre son camp ; souvent sans xG |
| `situation` | `situation` | `RegularPlay`, `FastBreak`, `FromCorner`, `SetPiece`, `FreeKick`, `Penalty`… |
| `x`, `y` | `x`, `y` | Coordonnées brutes (terrain 105 × 68 par défaut) |
| `goalCrossedY`, `goalCrossedZ`, `blockedX`, `blockedY` | idem | Fin de trajectoire : ligne de but franchie ou point du contre |

## Niveau équipe dans un match

Les statistiques d'équipe sont celles de la période `All` de `team_stats`. Une valeur du type `"508 (87%)"` est lue par son premier nombre (`first_number`) ; le texte d'origine reste dans `homeRaw` / `awayRaw`.

Clés utilisées par les calculs du profil club ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L507), objet `STATS`) :

| Nom | Clé PitchAPI |
| --- | --- |
| xG | `expected_goals` |
| xG hors penalty | `expected_goals_non_penalty` |
| xG en jeu ouvert | `expected_goals_open_play` |
| xG sur phase arrêtée | `expected_goals_set_play` |
| xGOT | `expected_goals_on_target` |
| Tirs, cadrés, dans / hors surface | `total_shots`, `ShotsOnTarget`, `shots_inside_box`, `shots_outside_box` |
| Grosses occasions, manquées | `big_chance`, `big_chance_missed_title` |
| Possession | `BallPossesion` |
| Passes, réussies, camp adverse, propre camp | `passes`, `accurate_passes`, `opposition_half_passes`, `own_half_passes` |
| Longs ballons réussis, centres réussis | `long_balls_accurate`, `accurate_crosses` |
| Ballons dans la surface adverse | `touches_opp_box` |
| Duels gagnés, au sol, aériens | `duel_won`, `ground_duels_won`, `aerials_won` |
| Tacles, interceptions, dégagements, tirs bloqués | `matchstats.headers.tackles`, `interceptions`, `clearances`, `shot_blocks` |
| Fautes, jaunes, rouges, corners, hors-jeu, arrêts | `fouls`, `yellow_cards`, `red_cards`, `corners`, `Offsides`, `keeper_saves` |

**Le xG d'une équipe dans un match est la statistique d'équipe `expected_goals`**, pas une somme recalculée des tirs. La courbe des xG d'un match, elle, additionne les tirs ; un écart de plus de 0,02 avec la statistique d'équipe est signalé (voir [fiche de match](../06-accueil-et-matchs/02-fiche-match.md)).

## Niveau joueur dans un match

| Champ Vega | Champ PitchAPI |
| --- | --- |
| `minutes` | `minutes_played` |
| `rating` | `rating_title` (note /10) |
| `goals`, `assists` | `goals`, `assists` |
| `xg` | `expected_goals` |
| `npxg` | `expected_goals_non_penalty` |
| `xa` | `expected_assists` |
| `xgot` | `expected_goals_on_target_variant` |
| `goalsPrevented` | `goals_prevented` |
| `shots`, `shotsOnTarget` | `total_shots`, `ShotsOnTarget` |
| `chancesCreated`, `bigChancesCreated` | `chances_created`, `big_chance_created_team_title` |
| `passesAccurate` / `passesAttempted` | `accurate_passes` (valeur / total) |
| `passesFinalThird` | `passes_into_final_third` |
| `touches`, `touchesBox` | `touches`, `touches_opp_box` |
| `dribbles` | `dribbles_succeeded` |
| `duelsWon`, `duelsLost` | `duel_won`, `duel_lost` |
| `tackles`, `interceptions`, `recoveries`, `clearances`, `blocks` | `matchstats.headers.tackles`, `interceptions`, `recoveries`, `clearances`, `shot_blocks` |
| `defensiveActions` | `defensive_actions` |
| `saves` | `saves` |

D'autres mesures sont conservées sans entrer dans les calculs actuels (`EXTRA_PLAYER_METRICS`) : `xgotFaced` (`expected_goals_on_target_faced`), `xgPlusXa` (`xg_and_xa`), métriques physiques, `fantasyPoints`, etc.

Règles de lecture :
- Une statistique répétée dans plusieurs rubriques du fournisseur est **une seule observation**, jamais additionnée (`flatten_player_stats`).
- Pour une fraction (passes, longs ballons, centres, duels au sol / aériens, dribbles), le numérateur vient de `value` et les tentatives de `total` (`ATTEMPTED_METRICS`).
- Le poste n'est pas un champ statistique : il vient de la composition (`position_id`), voir [Postes et groupes](03-postes-et-groupes.md).

## Voie « Pro » (expérimentale, hors production)

Le lecteur Pro (`STATARENA_PRO_API`) n'est pas utilisé en production (README racine). Ses agrégats (orion_pro_season_aggregates.py (ancien backend, supprimé le 10 novembre 2026)) diffèrent sur deux points :
- le xG d'équipe d'un match y est **la somme des xG des joueurs** de l'équipe (`match_xg`) ;
- la note saison y est **pondérée par les minutes** (`provider_rating_weighted`).

Le reste de cette documentation décrit la voie de production.
