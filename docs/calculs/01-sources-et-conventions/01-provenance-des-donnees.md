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

## Transfermarkt : valeurs, transferts, blessures, contrats

Code : [transfermarkt.py](../../../backend/vega/transfermarkt.py). Un processus du worker lit l’API JSON de Transfermarkt en continu. Une requête à la fois, environ toutes les 2,5 secondes.

**Ce qu’on en garde.** Pour un joueur relié à l’un des nôtres :
- l’historique de ses valeurs, avec le club de chaque estimation ;
- ses transferts (date, clubs, montant, prêt ou non) ;
- ses blessures (dates, jours, matchs manqués) ;
- son contrat avec un de nos clubs.

Les blessures sont remplacées en entier à chaque lecture, parce qu’une blessure n’a pas de clé chez Transfermarkt.

**Les transferts et les contrats ne sont jamais effacés** (migration 139, [modes d’échec §20](../09-audit-2026-11/FAILURE_MODES.md)) :
- un transfert est mis à jour par sa clé Transfermarkt et garde sa ligne. Un champ donné remplace l’ancien, un champ absent ou vide le laisse. Un transfert libre a un montant de 0 ;
- un transfert que Transfermarkt ne liste plus garde ses faits et la date du premier jour où il manquait (`absent_since`). Une liste plus courte ne prouve aucune annulation ;
- une réponse qui ne peut pas être un historique complet n’écrit rien : un 404 après un historique, l’absence d’historique, deux listes vides après un transfert terminé, un élément illisible, une même clé avec deux faits. La file garde le vrai statut HTTP et un code (`HISTORY_MISSING`, `HISTORY_EMPTY`, `HISTORY_INVALID`, `HISTORY_CONFLICT`), puis relit plus tard. Un premier 404 est une réponse ordinaire ;
- un contrat est un fait daté. Quand Transfermarkt nomme un autre contrat (transfert, renouvellement, retour de prêt, club hors de notre base), l’ancien est écarté à la date du changement (`superseded_on`). Sa date de fin reste celle observée. Un départ futur laisse le contrat d’aujourd’hui en place jusqu’à ce jour.

**Comment un joueur est relié.** Jamais par le nom seul.
- **Le jeu du 6 juillet 2026** : ses liens sont repris tels quels.
- **Un club** est relié par les valeurs de nos joueurs déjà reliés. Une estimation compte si elle tombe pendant la période où le joueur était sur nos feuilles de match pour ce club, à 30 jours près. Il faut au moins 3 joueurs, et au moins 60 % des votes du club comme de notre équipe. Une équipe réserve (B, II, U19…) n’est jamais reliée à une équipe première. Deux prétendants font un conflit qu’une personne tranche ; aucun lien n’est écrit.
- **Un club qu’aucun vote n’atteint** (ses joueurs ne sont pas dans le jeu de juillet) est cherché par son nom sur Transfermarkt. On lit l’effectif des 3 premiers clubs trouvés pour la dernière saison où nous l’avons, ou l’année d’avant. Il est relié si un seul de ces clubs compte au moins 5 joueurs dont le nom exact est celui d’un de nos joueurs de cette saison, chaque nom unique des deux côtés.
- **Un joueur** est relié dans un club relié :
  - la même date de naissance et le même nom (complet ou court), chacun le seul de son espèce dans le club ;
  - à défaut, la même date de naissance et un mot du nom en commun, s’ils sont la seule paire de ce jour ;
  - sans date de naissance chez nous (91 % de nos joueurs le 16 novembre 2026) : le même nom exact, le seul des deux côtés dans le club, que Transfermarkt place dans une saison où il a joué pour nous dans ce club (ou l’année d’avant). Quand Transfermarkt donne sa date de naissance, il doit avoir de 15 à 45 ans lors de ses matchs pour nous. C’est la règle du lecteur Wikidata.
- Transfermarkt ne remplit jamais nos dates de naissance : elles restent celles de nos sources.

**Quarantaine.** Si Transfermarkt donne une autre date de naissance que la nôtre, le lien est mis en doute. Rien de ce joueur n’est alors montré, ni valeur ni contrat, jusqu’à ce qu’une personne regarde. Cela vaut aussi pour un contrat écrit avant le doute, et quand la quarantaine désigne l’ancien joueur d’une clé que nous avons fusionnée.

**Ordre de lecture.** Les joueurs de la saison en cours d’abord, puis les saisons précédentes. Ensuite, chaque élément est relu à son rythme :
- un joueur de la saison en cours : profil et blessures chaque semaine, valeurs et transferts quand le profil dit qu’ils ont changé, au plus tard tous les mois ;
- un joueur plus ancien : de tous les 3 mois à une fois par an ;
- l’effectif d’un club : chaque semaine pour la saison en cours, une fois par an pour les saisons passées.

**Refus.** Transfermarkt peut refuser (contrôle anti-robot, 403, 429). Le lecteur fait alors une pause d’une heure, doublée à chaque refus jusqu’à un jour. Après une semaine de refus, ou 8 refus de suite, il s’arrête jusqu’à ce qu’une personne le relance. Il ne contourne jamais un contrôle.

**Ce qui est choisi, pas mesuré.** Les seuils des liens (3 joueurs, 60 %, 30 jours), les rythmes de relecture et l’intervalle entre deux requêtes.

**Conditions d’usage.** Les conditions d’utilisation de Transfermarkt n’ont pas pu être lues. Les valeurs sont ses propres estimations : le site cite la source.

## Voie « Pro » (expérimentale, hors production)

Le lecteur Pro (`STATARENA_PRO_API`) n'est pas utilisé en production (README racine). Ses agrégats (orion_pro_season_aggregates.py (ancien backend, supprimé le 10 novembre 2026)) diffèrent sur deux points :
- le xG d'équipe d'un match y est **la somme des xG des joueurs** de l'équipe (`match_xg`) ;
- la note saison y est **pondérée par les minutes** (`provider_rating_weighted`).

Le reste de cette documentation décrit la voie de production.
