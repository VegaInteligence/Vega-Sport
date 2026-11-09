# Calculs de Vega — comment chaque chiffre est obtenu

Ce dossier explique, formule par formule, comment le site calcule ce qu'il affiche : xG, xA, xGOT, points attendus (xPts), probabilités de victoire, centiles, indices Vega, similarités, classements, sélections éditoriales de l'accueil.

Il décrit le code tel qu'il est au 9 novembre 2026. Chaque page renvoie aux fichiers et aux fonctions concernés ; si le code change, le code fait foi.

## Ce que Vega calcule, et ce qu'il ne calcule pas

| Valeur | Origine |
| --- | --- |
| xG, xG hors penalty, xG en jeu / sur CPA, xGOT, xA, buts évités, note du match | **Fournies par PitchAPI**. Vega n'a pas de modèle de tir : il lit, additionne et compare ces valeurs. |
| Points attendus (xPts), probabilités victoire / nul / défaite | **Calculés par Vega** à partir des xG d'équipe (loi de Poisson). |
| Écarts « réel − attendu » (finition, gardien, qualité de frappe, points) | **Calculés par Vega**. |
| Totaux, moyennes par match, valeurs par 90 minutes, taux | **Calculés par Vega** à partir des observations par match. |
| Centiles, rangs, indice Vega club et joueur, similarités, tags de style | **Calculés par Vega**, toujours relativement à un groupe de comparaison. |
| Classements dérivés des résultats, zones européennes | **Calculés par Vega** quand aucun classement officiel n'est utilisé. |
| Classements FIFA, coefficients UEFA | **Collectés** (voir [RANKINGS.md](../RANKINGS.md)), jamais recalculés. |
| Classement Ballon d'Or Vega | **Pas encore calculé** (la méthode proposée est dans [METHODE_CLASSEMENT_BALLON_D_OR.md](../METHODE_CLASSEMENT_BALLON_D_OR.md)). |

## Sections

### 1. Sources et conventions
- [Provenance des données](01-sources-et-conventions/01-provenance-des-donnees.md) — champs PitchAPI lus, correspondance des noms, voie Pro expérimentale.
- [Valeurs absentes et fiabilité](01-sources-et-conventions/02-valeurs-absentes-et-fiabilite.md) — absent ≠ zéro, zéros suspects, couverture.
- [Postes et groupes de comparaison](01-sources-et-conventions/03-postes-et-groupes.md) — du `positionId` au groupe G / D / M / O / F.

### 2. Métriques « attendues »
- [xG, xG hors penalty, xGOT](02-metriques-attendues/01-xg-npxg-xgot.md)
- [xA — passes décisives attendues](02-metriques-attendues/02-xa.md)
- [Buts évités (gardien)](02-metriques-attendues/03-buts-evites.md)
- [Note du match](02-metriques-attendues/04-note-du-match.md)

### 3. Résultats et points attendus
- [Points attendus (xPts) et victoires attendues](03-resultats-et-points-attendus/01-points-attendus-xpts.md)
- [Classements calculés](03-resultats-et-points-attendus/02-classements.md)
- [Zones européennes, montée et relégation](03-resultats-et-points-attendus/03-zones-europeennes-et-relegation.md)

### 4. Clubs
- [Indicateurs d'équipe](04-clubs/01-indicateurs-club.md) — les 46 indicateurs du profil club et leur formule.
- [Centiles, rangs et indice Vega club](04-clubs/02-centiles-rangs-et-indice-vega.md)
- [Référentiels et niveau européen](04-clubs/03-referentiels-et-niveau-europeen.md)
- [Style, tags et clubs similaires](04-clubs/04-style-et-similarite.md)
- [États de match, tirs et effectif](04-clubs/05-etats-de-match-tirs-et-effectif.md)

### 5. Joueurs
- [Agrégation d'une saison](05-joueurs/01-agregation-saison.md) — totaux, par match, par 90, taux.
- [Centiles et cohortes](05-joueurs/02-centiles-et-cohortes.md) — par match et par saison.
- [Indices Vega et profils de rôle](05-joueurs/03-indices-vega-et-roles.md)
- [Similarité, radar, pizza et traits](05-joueurs/04-similarite-radar-et-traits.md)
- [Classements joueurs](05-joueurs/05-classements-joueurs.md) — meilleures notes, buteurs, efficaces, maladroits.

### 6. Accueil et fiches de match
- [Accueil](06-accueil-et-matchs/01-accueil.md) — semaine affichée, match de la semaine, joueur de la semaine, séries.
- [Fiche de match](06-accueil-et-matchs/02-fiche-match.md) — courbe des xG, carte des tirs, contexte avant match, discipline.

### 7. Limites
- [Non calculé, fictif ou démo](07-limites/01-non-calcule-fictif-demo.md)
- [Points d'attention relevés dans le code](07-limites/02-points-d-attention.md)

## Trois règles qui reviennent partout

1. **Une valeur absente n'est jamais un zéro.** Une moyenne ou un total ne prend que les matchs où la valeur est observée, et le « par 90 » divise par les minutes de ces matchs seulement.
2. **Un centile n'existe que si la comparaison est sérieuse** : assez de minutes pour le joueur, assez de pairs (30 pour les joueurs, 5 pour les clubs), et pour la saison une mesure renseignée sur tous les matchs joués.
3. **Un taux est un rapport de sommes, pas une moyenne de taux** : précision des passes = 100 × Σ passes réussies / Σ passes tentées sur les mêmes matchs.

## Fichiers de code principaux

| Domaine | Fichier |
| --- | --- |
| Profil club, xPts, indicateurs, centiles, indice Vega, niveau européen | [club-scout.js](../../dashboard/frontend/src/services/club-scout.js) |
| Résumé club (fiche match, effectif) | [club-analysis.js](../../dashboard/frontend/src/services/club-analysis.js) |
| Agrégation saison joueur | [season-player.js](../../dashboard/frontend/src/services/season-player.js) |
| Cohortes, indices, similarité joueur | [scouting.js](../../dashboard/frontend/src/services/scouting.js) |
| Profil d'une performance, postes, centile | [shared/player-profile.js](../../dashboard/shared/player-profile.js) |
| Accueil (semaine, sélections, meneurs) | [home-insights.js](../../dashboard/frontend/src/services/home-insights.js), [relational-home.js](../../dashboard/backend/services/relational-home.js) |
| Classements dérivés et zones | [competition-standings.js](../../dashboard/frontend/src/services/competition-standings.js), [standings-zones.js](../../dashboard/frontend/src/services/standings-zones.js), [nations-standings.js](../../dashboard/frontend/src/services/nations-standings.js) |
| Lecture des données fournisseur | [build_dashboard_data.py](../../dashboard/scripts/build_dashboard_data.py) |
| Agrégats saison côté base | [025_player_season_rollups.sql](../../dashboard/backend/migrations/025_player_season_rollups.sql), [relational-performance.js](../../dashboard/backend/services/relational-performance.js) |
