# Note du match

## Origine

Depuis le 15 novembre 2026, la note d'un joueur dans un match est **la note Vega**, calculée par Vega à partir de ce que le joueur a fait dans ce match seul. La note du fournisseur n'est plus lue nulle part. Elle a été retirée de la base le même jour (migration 108), une fois la note Vega vérifiée en production : 354 893 matchs joués notés sur 354 951 en 2026/2027, et 671 351 sur 672 536 en 2025/2026, quand le fournisseur en notait 369 157. Les relevés bruts gardés dans les archives de la source la contiennent toujours ; l'ingestion l'ignore.

La formule complète et ses raisons sont dans [les notes Vega](../08-notes-vega/01-formules-et-raisons.md) (§ 5.7). En bref :

- **Ce qu'elle mesure** : la contribution C du match (§ 5.3), ce que le joueur a fait au-delà de l'attendu de son rôle face à cet adversaire. Elle ne dépend ni du niveau de son club ni de son classement : un joueur faible qui fait un très grand match a une très bonne note ce jour-là.
- **Échelle** : z est le score normal de C parmi les matchs complets (60 minutes ou plus) de son rôle dans la dernière année terminée ; la note vaut 100 / (1 + 10^(−z/4)). **50 est un match ordinaire du poste.** Un gardien et un avant-centre sont ainsi notés sur la même échelle : la même part des matchs de leur rôle se trouve au-dessus d'une note donnée.
- **Quand elle s'affiche** : à partir de 20 minutes jouées, ou en dessous quand le match s'écarte d'au moins un écart-type de l'ordinaire (|z| ≥ 1). Une courte entrée ordinaire n'a pas de note affichée.
- **Quand elle arrive** : la saison en cours est recalculée chaque heure ; une note apparaît une à deux heures après les statistiques du match. Un match dont la source ne donne pas les minutes jouées n'a pas de note.

Où elle est gardée : `agg.player_match_grades`, une ligne par joueur et par match, à la même clé que les statistiques du match. On y garde z, l'année terminée qui a servi de référence, la première valeur calculée et la date du dernier changement. Seule une note qui bouge est réécrite, ce qui permet de mesurer sa dérive d'un calcul à l'autre.

## Calculs à partir de la note

| Où | Calcul | Code |
| --- | --- | --- |
| Rang dans le match | `1 + nombre de notes affichées du match dont le z est strictement supérieur`, sur le nombre de notes affichées | `matchGradeRank` ([player-profile.js](../../../dashboard/frontend/src/services/player-profile.js)), même calcul en SQL ([performance.mjs](../../../backend/api/src/routes/performance.mjs)) et dans la route des notes d'un match ([rankings.mjs](../../../backend/api/src/routes/rankings.mjs)) |
| Note de saison (fiche, annuaire, accueil, meneurs) | **la note du z moyen pondéré par les minutes**, sur les matchs de 20 minutes ou plus : note = 100 / (1 + 10^(−z̄/4)), z̄ = Σ (minutes × z) / Σ minutes | `seasonGrade` ([grades.js](../../../dashboard/frontend/src/services/grades.js)), `aggregateSeason` ([season-player.js](../../../dashboard/frontend/src/services/season-player.js)), `seasonTotals` ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js)) ; en SQL ([players.mjs](../../../backend/api/src/routes/players.mjs), [home.mjs](../../../backend/api/src/routes/home.mjs)) à partir des sommes de chaque édition (`agg.player_grade_editions`) |
| Forme récente | les 10 derniers matchs notés, dans l'ordre ; ligne de référence = note du z moyen de ces matchs. Dans l'infobulle de cette courbe comme dans celle de « Note par match », un but ou une passe décisive inconnus s'écrivent « — », un zéro observé « 0 » (17 novembre 2026, étape 7) | `RecentForm` ([PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx)) |

**Pourquoi la moyenne des z et pas celle des notes.** La courbe 0–100 écrase ses extrémités : elle monte d'environ 14 points par unité de z autour de 50, et de 10 seulement vers z = 2. La moyenne des notes sous-estimerait un joueur aux grands matchs. On fait donc la moyenne des z, qui est la quantité additive, puis on la ramène sur la courbe : c'est « la note de son match moyen ».

**Pourquoi pondérer par les minutes.** L'attendu de C croît avec les minutes, si bien que le z d'une courte entrée est tiré vers 0. Sans pondération, les entrées de 20 à 30 minutes ramèneraient la moyenne d'un joueur vers 50.

**Pourquoi exclure les entrées de moins de 20 minutes**, même affichées pour un match extrême : elles ne sont affichées qu'en raison de leur résultat, et les compter fausserait la moyenne.

La note de saison **décrit** les matchs joués ; elle n'estime pas le niveau du joueur, qui est le score du classement Vega. Les deux sont sur 100 et sont nommés différemment sur le site.

## Seuils pour classer une note

- **Meilleurs joueurs d'un match, joueur de la semaine, meilleur match de vos joueurs** : au moins **60 minutes** jouées, les matchs complets de la référence. Une courte entrée est montrée, jamais classée.
- **Liste « Meilleures notes » de l'annuaire** : au moins **5 matchs notés** de 20 minutes ou plus (`MIN_GRADED_MATCHES`).
- **Meneurs de l'accueil** : au moins `max(450, arrondi(0,4 × minutes du joueur le plus utilisé))` minutes notées. Avec un joueur à 2 000 minutes, le seuil est de 800 minutes.

## Couleur d'une note

Les paliers suivent la part des matchs complets de la référence au-dessus ou en dessous, et non des seuils arbitraires (`gradeTone`, [grades.js](../../../dashboard/frontend/src/services/grades.js)) :

| Note | z | Part des matchs complets |
| --- | --- | --- |
| 70 ou plus | 1,47 ou plus | les 7 % meilleurs environ |
| 60 à 70 | | environ 17 % |
| 40 à 60 | | le match ordinaire |
| 30 à 40 | | environ 17 % |
| moins de 30 | | les 7 % moins bons environ |

Ce n'est pas un centile du joueur, seulement un repère visuel sur son match.

## Le filtre « Note Vega minimale »

Il porte sur la note de saison, bien plus resserrée que celle d'un match : la plupart des joueurs ont entre 40 et 65. Un seuil de 60 ne garde donc que les saisons nettement au-dessus de l'ordinaire.
