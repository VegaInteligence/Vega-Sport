# Valeurs absentes et fiabilité

## Absent n'est pas zéro

Une mesure que le fournisseur ne donne pas reste `null`. Elle n'est jamais remplacée par 0 :
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

Deux mesures joueur ne sont **jamais publiées à zéro** par PitchAPI : le xA et les grosses occasions créées. Un joueur sans xA dans un match n'a pas « 0 » mais « rien ». Leur distribution ne contient donc que des joueurs ayant déjà enregistré quelque chose :
- **xA : jamais classé** (pas de centile, pas d'indice) — `UNRANKED` dans [season-player.js](../../../dashboard/frontend/src/services/season-player.js#L80), `rankable: key !== "xa"` dans [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L47), exclu de `RANKED` dans [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L104) ;
- grosses occasions créées : absentes du profil d'une performance ; voir le [point d'attention n° 9](../07-limites/02-points-d-attention.md) pour la saison.

## Le cas « aucun tir »

Quand un joueur n'a tenté aucun tir (`shots === 0`), le fournisseur laisse `xg` et `shotsOnTarget` vides. Le profil d'**une performance** restaure alors 0 (`withoutShots` dans [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L57), même règle dans [performance.mjs](../../../backend/api/src/routes/performance.mjs)).

Cette restauration **n'est pas appliquée à l'agrégation saison** ([season-player.js](../../../dashboard/frontend/src/services/season-player.js#L171)) : un match sans tir y laisse le xG non observé.

## Matchs et scores pris en compte

- Un match compte s'il est `finished` et si les deux scores sont des entiers ≥ 0.
- Un doublon de match est fusionné par identifiant ; la version terminée l'emporte (`clubMatchIndex`, `standingsFromFixtures`).
- Un joueur « joue » un match s'il a des minutes numériques **> 0**. Un remplaçant inscrit qui n'entre pas n'est pas un match joué ; des minutes inconnues sont comptées à part (`unknownMinutes`).
- Un même match n'est compté qu'une fois par joueur (`seen.has(row.matchId)`).

## Couverture affichée

Chaque match porte des drapeaux de couverture (`coverage`) : `players`, `playerStats`, `ratings`, `xg`, `xa`, `shots`, `teamStatsReliable`, nombre de joueurs inscrits, ayant joué, notés. Les pages les utilisent pour afficher « n / m tirs renseignés » ou « matchs dont la chronologie des buts est complète » plutôt que d'extrapoler.
