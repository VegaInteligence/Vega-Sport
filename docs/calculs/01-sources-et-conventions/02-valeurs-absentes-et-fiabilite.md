# Valeurs absentes et fiabilité

## Absent n'est pas zéro

Une mesure que le fournisseur ne donne pas reste `null`. Elle n'est remplacée par 0 que dans un cas, décrit plus bas (« Zéros omis par le fournisseur ») : quand la base sait que le fournisseur publie cette mesure pour le match. Partout ailleurs :
- `number()` dans build_dashboard_data.py (ancien backend, supprimé le 10 novembre 2026) refuse `null`, les booléens et les nombres non finis ;
- les agrégats ne comptent une valeur que si elle est un nombre fini (`isNumber`, `finiteSql` côté SQL) ;
- un total « saison » conserve, pour chaque mesure, le **nombre de matchs observés** (`count`) et les **minutes de ces matchs** (`minutes`).

Conséquence : pour un joueur de 10 matchs dont le xG n'est renseigné que sur 8, le xG total est la somme des 8, le « par 90 » divise par les minutes de ces 8 matchs, et le joueur n'est pas classé sur cette mesure au niveau saison (couverture incomplète, voir [Centiles et cohortes](../05-joueurs/02-centiles-et-cohortes.md)).

## Zéros suspects (`SUSPICIOUS_ZERO_STATS`)

Certains matchs arrivent avec des tirs et des passes tous à zéro alors que le match a eu lieu. Un match est déclaré suspect (build_dashboard_data.py (ancien backend, supprimé le 10 novembre 2026)) quand les trois conditions sont réunies :

1. aucun tir dans la liste des tirs ;
2. les périodes de tirs sont absentes **ou** le score total est supérieur à 0 ;
3. `total_shots` **et** `accurate_passes` valent 0 pour les deux équipes.

Effets :
- statistiques individuelles d'action → `null`, sauf `minutes`, `goals`, `assists` (enregistrés indépendamment) ;
- statistiques d'équipe → `null`, sauf cartons jaunes et rouges ;
- `coverage.teamStatsReliable = false` et `coverage.playerStats = false` ;
- avertissement affiché sur le match.

Tous les calculs d'équipe ignorent un match dont `teamStatsReliable === false` (`teamRows` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L564), `clubSummary` dans [club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js#L162), `s.reliable IS DISTINCT FROM false` côté SQL).

## Zéros omis par le fournisseur

PitchAPI n'écrit pas toujours ses zéros. Relevé du 12 novembre 2026 sur les saisons 2025/2026 et 2026/2027 (24 768 matchs dont les joueurs sont mesurés, 151 éditions) :
- le xG, le npxG, le xGOT, le xA et les grosses occasions créées ne sont **jamais** écrits à zéro : un joueur qui n'a pas tiré n'a pas « 0 xG » mais « rien » ;
- les tirs, les duels, les passes dans le dernier tiers et les fautes subies sont écrits à zéro dans quatre matchs sur dix, laissés vides dans les autres ;
- les buts, les passes décisives, les dribbles, les centres, les longs ballons, les ballons touchés dans la surface ont les deux formes dans un même match ;
- les passes, les tacles, les interceptions, les dégagements, les récupérations et les fautes sont toujours écrits.

Lu comme une valeur inconnue, un zéro omis retirait la mesure à tout joueur ayant un match sans (règle de couverture ci-dessus) : un attaquant resté un match sans tirer n'avait plus de xG « complet », donc ni centile ni indice de rôle sur cette mesure.

**La règle** (migration `068_blank_zeros.sql`, table `agg.match_zeros` : une ligne par match, une colonne par mesure). Un vide vaut zéro quand :
1. la ligne du joueur est **mesurée** (ses ballons touchés sont renseignés) ;
2. et le match **montre la mesure** pour au moins un de ses joueurs mesurés ;
3. ou l'édition la montre quelque part et le match est **complet** : il montre chacune des mesures témoins que l'édition montre (xG, xA, tirs cadrés, duels gagnés, occasions créées). Ces témoins ne manquent à aucun match quand le fournisseur les publie ; une mesure assez rare pour manquer à un match entier (une grosse occasion, un hors-jeu, une erreur menant à un but) reçoit ses zéros par cette voie.

Ce qui reste vide :
- une mesure que l'édition ne publie pas : npxG, xGOT et xA dans 68 éditions sur 151, tirs cadrés dans 65, grosses occasions créées dans 66, xG dans 3 ;
- les matchs joués avant que le fournisseur ne commence à publier une mesure (une édition des 151 a commencé en cours de saison) ;
- une ligne non mesurée ;
- les statistiques de gardien et les mesures physiques, lues comme avant.

Les 43 mesures concernées sont listées dans `ZERO_STATS` ([metric_catalog.py](../../../backend/vega/metric_catalog.py)). Les lignes du fournisseur (`core.player_match_stats`) ne sont pas modifiées : le zéro est rendu à la lecture, par `api.player_appearances` (fiche joueur, matchs), `api.home_player_matches` (accueil), `agg.refresh_player_list` (listes et cohortes) et le calculateur des lignes saison (`agg.player_season_stats`). Le classement de puissance applique la même idée dans son propre calcul (`restore_zeros` dans [power.py](../../../backend/vega/power.py)).

Conséquences :
- **xA** : classé comme les autres mesures, là où il est observé sur tous les matchs du joueur. Le profil d'**une performance** le laisse toujours de côté (`RANKED` dans [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L104)) ;
- **grosses occasions créées** : même règle ; l'ancien [point d'attention n° 9](../07-limites/02-points-d-attention.md) est levé pour les éditions qui les publient.

## Le cas « aucun tir »

Quand un joueur n'a tenté aucun tir (`shots === 0`), le fournisseur laisse `xg` et `shotsOnTarget` vides. Le profil d'**une performance** restaure alors 0 (`withoutShots` dans [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L57), même règle dans [performance.mjs](../../../backend/api/src/routes/performance.mjs)).

L'agrégation saison reçoit ces zéros de l'API depuis la migration 068 (section précédente) : un match sans tir d'une édition qui publie le xG compte pour 0.

## Matchs et scores pris en compte

- Un match compte s'il est `finished` et si les deux scores sont des entiers ≥ 0.
- Un doublon de match est fusionné par identifiant ; la version terminée l'emporte (`clubMatchIndex`, `standingsFromFixtures`).
- Un joueur « joue » un match s'il a des minutes numériques **> 0**. Un remplaçant inscrit qui n'entre pas n'est pas un match joué ; des minutes inconnues sont comptées à part (`unknownMinutes`).
- Un même match n'est compté qu'une fois par joueur (`seen.has(row.matchId)`).

## Couverture affichée

Chaque match porte des drapeaux de couverture (`coverage`) : `players`, `playerStats`, `ratings`, `xg`, `xa`, `shots`, `teamStatsReliable`, nombre de joueurs inscrits, ayant joué, notés. Les pages les utilisent pour afficher « n / m tirs renseignés » ou « matchs dont la chronologie des buts est complète » plutôt que d'extrapoler.
