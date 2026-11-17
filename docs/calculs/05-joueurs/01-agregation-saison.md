# Agrégation d'une saison joueur

Code : `addAppearance`, `finish`, `seasonMetric` dans [season-player.js](../../../dashboard/frontend/src/services/season-player.js#L171). La base fait le même calcul par saison et compétition dans `refresh_player_season_rollups` (025_player_season_rollups.sql (ancien backend, supprimé le 10 novembre 2026)).

## Quels matchs comptent

Une ligne de composition devient un **match joué** si :
- elle a un identifiant de match, pas encore vu pour ce joueur ;
- ses minutes sont un nombre **> 0**.

Minutes non numériques → match compté dans `unknownMinutes`, pas dans les matchs joués. Remplaçant inscrit sans entrer (0 minute) → ignoré.

Seuls les matchs **terminés** (statut `finished`) comptent. Un match annulé, reporté, suspendu, en cours ou à venir n'entre ni dans les agrégats saison de la base (`agg.player_season_stats`, `calculator.py`), ni dans la liste des joueurs (`agg.player_list_editions`), ni dans les pairs d'une performance (`agg.refresh_performance_distribution`), ni dans les apparitions lues par l'API ([players.mjs](../../../backend/api/src/routes/players.mjs)) ; seule une lecture explicite d'un match (`match=`) le montre. Corrigé le 17 novembre 2026 (audit 15b, N2, N3 ; migration 125, [contrat](../09-audit-2026-11/FAILURE_MODES.md)).

Le site applique la même règle à ses résumés de saison (17 novembre 2026, étape 5) : la fiche du joueur, sa cohorte locale, la saison courante, l'historique (frais ou en cache, réduit à une compétition ou à des dates) et la carrière lisent `finishedAppearances` ([season-player.js](../../../dashboard/frontend/src/services/season-player.js)). Une apparition ne porte pas de statut : il se lit sur la fiche du match, sinon sur son calendrier (un match terminé peut avoir des apparitions sans fiche). Un statut inconnu ou autre que `finished` (en cours, annulé, reporté, à venir, suspendu, attribué sur tapis vert, ou un état du direct comme la mi-temps) écarte l'apparition. Le match d'un temps de jeu inconnu reste compté dans `unknownMinutes`. Les lectures brutes, le cache et les listes de matchs du joueur gardent toutes les observations : la liste montre aussi un match en cours ou annulé, que le résumé ne compte pas.

Sur la fiche affichée (17 novembre 2026, étape 6), les chiffres de la saison, le bandeau, les cohortes, les comparaisons, les tirs et l'analyse lisent ce résumé terminé. Dans l'onglet Matchs, « Par compétition » compte les matchs terminés, tandis que le tableau des matchs de la période et la courbe des notes listent toutes les observations. La présence et le temps de jeu lisent aussi toutes les observations (le temps de jeu ne retient lui-même que les matchs terminés du calendrier). Un joueur observé sans aucun match terminé garde ses onglets et sa liste, avec un résumé de 0 match ; son nom, sa photo et son club viennent de ses observations.

## Ce qui est accumulé

Pour chaque mesure de comptage (buts, xG, tirs, tacles…), trois nombres :
- `sum` : somme des valeurs observées ;
- `count` : nombre de matchs où la valeur est observée ;
- `minutes` : minutes de ces matchs.

Pour chaque taux, numérateur et dénominateur séparés, sur les matchs où les deux sont observés :
- **Précision des passes** : `100 × Σ passes réussies / Σ passes tentées` (matchs avec tentatives > 0) ;
- **Duels gagnés %** : `100 × Σ duels gagnés / Σ (duels gagnés + perdus)`.

Également : matchs, minutes totales, titularisations (`starts` sur `knownStarts`, les matchs où l'information est connue), équipes, compétitions, poste dominant (voir [Postes](../01-sources-et-conventions/03-postes-et-groupes.md)).

## Temps de jeu de la fiche

Le **temps de jeu** de la fiche rapporte les minutes du joueur pour l’équipe indiquée aux minutes de ses matchs terminés, à raison de 90 minutes par match. Le calcul utilise la saison, la compétition et la période sélectionnées. Il inclut les matchs où l’absence du joueur est établie par une composition confirmée et des données joueurs exploitables. Quand la durée d’une apparition manque, le calcul peut additionner les deux mi-temps si chacune est renseignée pour ce même joueur, cette équipe et ce match. Une durée encore inconnue, une observation supérieure à 90 minutes ou un calendrier incomplet empêche d’afficher un pourcentage pour ce périmètre.

## Écart de finition (buts − xG)

L'écart se lit sur les matchs où **les buts et le xG sont tous deux connus** (minutes > 0) : la base garde `finishing_sum = Σ (buts − xG)` et, sur ces mêmes matchs, `finishing_count`, `finishing_minutes`, `finishing_goals`, `finishing_xg` (migration 125, `players.mjs` ; `stats.finishing` dans [season-player.js](../../../dashboard/frontend/src/services/season-player.js)). Total : Σ (buts − xG) ; par match : Σ / matchs appariés ; par 90 : 90 × Σ / minutes appariées. Jusqu'au 17 novembre 2026, les buts de tous les matchs étaient comparés au xG des seuls matchs qui en avaient (audit 9).

Exemple : 3 matchs, 2 buts dans le premier (xG 0,8), 1 but dans le deuxième (xG inconnu), 0 dans le troisième (xG 0,3) → écart **+0,9** sur 2 matchs (et non 3 − 1,1 = +1,9).

## Par mi-temps

La vue `api.player_half_totals` (migration 126) ne garde que les **mi-temps complètes** : match terminé, minutes > 0, et chaque statistique que lit la route connue (ballons touchés, buts, tirs, xG, passes réussies, ballons dans la surface, dribbles, duels gagnés, tacles, récupérations). Un xG absent ne vaut 0 que si la mi-temps n'a aucun tir ; un xG publié et fini reste tel quel. Un xG NaN, +∞ ou −∞ rend la mi-temps incomplète, qu'elle ait un tir ou non : une seule de ces valeurs rendait NaN le xG de toutes les mi-temps du joueur (étape 5). Toutes les sommes, les matchs et les minutes portent sur ces mi-temps : les valeurs par 90 d'une mi-temps ont un seul dénominateur. Sans mi-temps complète, la route répond « Donnée indisponible », jamais 0. La vue compte aussi les mi-temps écartées (`excluded_matches`, `excluded_minutes`) ; la route, qui appartient au chantier des profils (VI-22), ne les publie pas encore.

**Perte de couverture.** Sur la feuille réelle des tests (`match_m_08LEIz`), 46 mi-temps sur 50 restent (1 800 minutes) et 4 sont écartées (180 minutes, ballons touchés absents) : une mesure sur une feuille, pas sur la production (audit 15c).

## Minutes par but ou passe décisive

Le chiffre « Min. par but ou PD » du bloc Saison, et la colonne « Min / B+PD » du tableau par compétition, divisent les minutes par la somme des buts et des passes décisives (`contributionRate`, [season-player.js](../../../dashboard/frontend/src/services/season-player.js)). Ils n'existent que si buts **et** passes décisives sont connus sur **chacun** des matchs joués dont les minutes comptent, et si cette somme est positive ; sinon « — », sans le nombre de contributions. Un but ou une passe inconnus ne valent jamais 0, et aucune partie des matchs ne remplace leur ensemble (relevé N9, 17 novembre 2026). Exemple : 2 buts en 260 minutes, passes décisives jamais renseignées → « — » (et non « 130′ ») ; passes décisives connues et nulles partout → « 130′ », 2 contributions.

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

## Zones de présence

La lecture AWS additionne les actions localisées dans les cellules des cartes PitchAPI du joueur sur les matchs terminés du périmètre. La grille de 16 × 12 est orientée pour que l’équipe du joueur attaque vers la droite. La fiche indique le nombre de cartes exploitables sur les matchs examinés. La couleur représente le volume d’actions par cellule parmi les matchs couverts.

## Note saison

La note Vega de la saison : la note du z moyen des matchs de 20 minutes ou plus, pondéré par leurs minutes (`gradeZm / gradeMinutes`, [season-player.js](../../../dashboard/frontend/src/services/season-player.js)), la même partout sur le site (voir [Note du match](../02-metriques-attendues/04-note-du-match.md)). Cette page décrivait encore la moyenne simple des notes du fournisseur, retirée le 15 novembre 2026 (audit 17).

## Annuaire des joueurs

`playerAverage` ([player-directory.js](../../../dashboard/frontend/src/services/player-directory.js#L51)) expose chaque mesure dans la base choisie, et la colonne **minutes** en minutes **par match** (`minutes / matchs`). Les filtres « minutes min. », « note min. » et les conditions (« xG ≥ 0,3 ») s'appliquent à ces valeurs affichées. Le tri place les valeurs absentes en dernier.

## Côté base : agrégats par partition

`player_season_rollups` stocke, par saison × compétition × joueur, les mêmes `sum`, `count`, `minutes` (et numérateur / dénominateur pour les taux). Les totaux de plusieurs compétitions s'additionnent tant qu'un joueur et un match n'appartiennent qu'à une compétition ; si la même performance apparaît dans deux compétitions (`player_rollup_ambiguous`), le serveur revient au calcul exact sur les observations plutôt que de doubler les totaux.
