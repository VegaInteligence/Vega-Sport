# Note du match

## Origine

La note sur 10 d'un joueur dans un match est **la note PitchAPI** (`rating_title`). Ce n'est pas une note Vega et elle n'est pas validée comme telle ([DASHBOARD_DATA.md](../../DASHBOARD_DATA.md)). Aucune désignation « homme du match » n'est fournie : la meilleure note est affichée séparément, sans être présentée comme une désignation officielle ([PLAYER_HONOURS.md](../../PLAYER_HONOURS.md)).

## Calculs à partir de la note

| Où | Calcul | Code |
| --- | --- | --- |
| Rang dans le match | `1 + nombre de joueurs du match ayant une note strictement supérieure`, sur le nombre de joueurs notés | `matchRatingRank` ([player-profile.js](../../../dashboard/frontend/src/services/player-profile.js#L119)), même calcul en SQL ([relational-performance.js](../../../dashboard/backend/services/relational-performance.js)) |
| Note saison (fiche, annuaire) | **moyenne simple** des notes des matchs notés : `Σ note / nombre de matchs notés` | `finish()` ([season-player.js](../../../dashboard/frontend/src/services/season-player.js#L227)) |
| Note saison (accueil, meneurs) | **moyenne pondérée par les minutes** : `Σ (note × minutes) / Σ minutes des matchs notés` | `seasonTotals` ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L564)), même calcul en SQL ([relational-home.js](../../../dashboard/backend/services/relational-home.js)) |
| Forme récente | les 10 derniers matchs notés, dans l'ordre ; ligne de référence = moyenne simple de ces 10 notes | `RecentForm` ([PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L354)) |
| Évolution par saison | une note par saison et par équipe, échelle bornée à [0, 10] | [PlayerSeasonTrend.jsx](../../../dashboard/frontend/src/components/PlayerSeasonTrend.jsx) |

## Seuils pour classer une note

- **Liste « Meilleures notes » de l'annuaire** : au moins **5 matchs notés** (`MIN_RATED_MATCHES`).
- **Meneurs de l'accueil** : au moins `max(450, arrondi(0,4 × minutes du joueur le plus utilisé))` minutes. Avec un joueur à 2 000 minutes, le seuil est 800 minutes.
- **Joueur de la semaine** : meilleure note de la semaine avec **au moins 60 minutes** jouées (voir [Accueil](../06-accueil-et-matchs/01-accueil.md)).

## Couleur d'une note

`ratingTone` dans [PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L610) colore la note par paliers fixes, réutilisant l'échelle de couleurs des centiles : ≥ 9 → très bon, ≥ 8 → bon, ≥ 7 → moyen, ≥ 6 → faible, < 6 → très faible. Ce n'est pas un centile, seulement un repère visuel.

## Différence entre les deux notes saison

La moyenne simple donne le même poids à 10 minutes et à 90 minutes ; la moyenne pondérée donne plus de poids aux matchs complets. Un même joueur peut donc avoir deux notes saison légèrement différentes selon la page (voir [points d'attention](../07-limites/02-points-d-attention.md)).
