# Indicateurs d'équipe

Le profil club calcule 46 indicateurs, définis dans l'objet `METRICS` de [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L656).

## Matière première : une ligne par match

`teamRows` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L545)) produit une ligne par match **terminé** avec deux scores entiers :
- `gf`, `ga` : buts marqués et encaissés (score final) ;
- `result` (V / N / D) et `points` (3 / 1 / 0) ;
- `own` et `opp` : les statistiques d'équipe du club et de l'adversaire (`STATS`), ou `null` si les statistiques du match ne sont pas fiables ;
- `xpts` : points attendus du match (voir [xPts](../03-resultats-et-points-attendus/01-points-attendus-xpts.md)).

## Deux façons d'agréger

- **Moyenne par match** (`mean`) : moyenne des valeurs observées, les matchs sans valeur sont ignorés.
- **Rapport de sommes** (`ratio`) : `échelle × Σ numérateur / Σ dénominateur`, sur les matchs où les deux termes sont connus. Un taux n'est jamais une moyenne de taux par match.

**Base de calcul** (17 novembre 2026, audit 8). Chaque indicateur lit ses propres termes et se calcule sur les matchs qui les connaissent tous ; il dit sur combien de matchs il repose (`count`, `coverage` de la cohorte). Une valeur absente n'est jamais un 0, et un xG que l'indicateur ne lit pas n'écarte aucun match : la possession, les passes ou les duels ne dépendent plus des xG. Un rapport entre deux statistiques ou deux camps (territoire, duels, PPDA…) additionne ses deux termes sur les mêmes matchs. Jusqu'au 17 novembre, tous les indicateurs sauf les points, les buts et les matchs sans encaisser passaient par le filtre `has` (les deux xG connus). Les moyennes de xG pour et contre en font partie : chacune repose désormais sur les matchs qui connaissent le xG de son camp, et non plus sur ceux qui connaissent les deux. Leur support a changé ; la différence de xG se lit sur les champs appariés (`pairedXgDelta`, `pairedXgDeltaPerMatch`), jamais en soustrayant ces deux moyennes.

**Sens.** `better = 1` : plus haut est meilleur ; `−1` : plus bas est meilleur (le centile est inversé) ; `0` : indicateur de style, sans bon ou mauvais côté.

## Résultats

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Points / match | moyenne des points (tous les matchs) | + |
| xPts / match | moyenne des xPts | + |

## Attaque

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Buts marqués / match | moyenne de `gf` (tous les matchs) | + |
| xG / match | moyenne de xG | + |
| xG hors penalty / match | moyenne de npxG | + |
| xG en jeu ouvert / match | moyenne de `expected_goals_open_play` | + |
| Grosses occasions / match | moyenne de `big_chance` | + |
| Tirs / match | moyenne de `total_shots` | + |
| Tirs cadrés / match | moyenne de `ShotsOnTarget` | + |
| xG par tir (hors penalty) | Σ npxG / Σ (tirs − penalties tentés), sur les matchs dont les penalties sont comptés (ci-dessous) | + |
| Tirs dans la surface | 100 × Σ tirs dans la surface / Σ tirs | + |
| Ballons dans la surface / match | moyenne de `touches_opp_box` | + |

## Finition et gardien

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Finition (buts − xG) / match | moyenne de `gf − contre son camp adverses − xG` | + |
| Buts évités par le gardien / match | moyenne de `xGOT adverse − (ga − contre son camp du club)` | + |
| Conversion des tirs | 100 × Σ (`gf` − contre son camp adverses) / Σ tirs | + |
| xG cadrés (xGOT) / match | moyenne de xGOT | + |
| Qualité de frappe (xGOT − xG) / match | moyenne de `xGOT − xG` du club, sur les matchs qui connaissent ces deux termes (le xG adverse n'est pas lu) | + |

**Penalties et contre son camp.** Ils sont établis, jamais déduits (audit 15e, 15f) :
- les **penalties tentés** d'un match se comptent sur sa liste de tirs complète et réconciliée : chaque tir est de l'une des deux équipes du match ; les tirs de chaque camp (hors contre son camp) sont aussi nombreux que ses statistiques le disent ; chaque but dit s'il est contre son camp ; les buts redonnent le score ; chaque tir du club a une situation reconnue (`penalty` ou `Penalty` est un penalty ; les codes de jeu courant, corner, coup de pied arrêté, contre-attaque, coup franc, touche et action individuelle, dans l'une ou l'autre graphie, n'en sont pas). Sinon, le nombre est inconnu et le match sort de « xG par tir » : un xG égal au npxG ne prouve aucun penalty manqué ;
- les **contre son camp** se lisent sur les buts de la liste (le tir porte l'équipe de son auteur) quand ils redonnent le score et que chaque but est classé ; une liste vide ne classe rien. Finition, gardien et conversion se calculent sur ces matchs.

Un but dont l'indicateur « contre son camp » manque laisse son match non classé : un but ordinaire n'est jamais déduit de `isGoal` seul. **Ce support dépend du résultat** (17 novembre 2026, étape 7) : si les buts ordinaires arrivent sans l'indicateur, seuls les matchs sans but sont classés. Un 0–0 classé et un 1–0 dont le but n'a pas d'indicateur donnent ainsi une finition de −1, un gardien de 0,7, une conversion de 0 % et un xG par tir de 1, chacun sur un seul match, le 0–0. Ces valeurs ne sont pas une estimation de la saison. Le support mesuré de chaque indicateur est conservé : rien n'est déduit, aucun match n'est retiré d'office. Une règle qui rendrait tout l'indicateur indisponible dès qu'un but n'est pas classé demanderait une nouvelle conception commune. Le contrat des deux sources du score (tirs et événements de but) et sa fréquence réelle restent à établir avec VI-21. Si la source ne donne pas cet indicateur pour les buts ordinaires (les exemples de réponse du dépôt ne le portent pas ; aucune feuille réelle des tests n'a de but), ces quatre indicateurs perdent tous les matchs avec un but. Le choix de lire un tir « Goal » du fournisseur comme un but ordinaire relève du contrat de la source, et n'est pas tranché ici ([traçabilité](../09-audit-2026-11/TRACEABILITY.md)).

Les tirs d'une **séance de tirs au but** (`period` « penalties » dans les fiches intégrées, « Penalties » dans la forme du fournisseur) ne sont pas des tirs du match : leurs buts ne sont pas dans le score et aucune statistique d'équipe ne les compte. Ils sont écartés de la classification des buts, du comptage des penalties, des catégories de tirs et des cartes, comme le fait le serveur ; un penalty tiré pendant le match reste un penalty (17 novembre 2026, étape 5).

**Cohortes lues en résumé.** La lecture d'un championnat entier (`detail=summary`), comme celle du référentiel européen, ne porte pas les listes de tirs (`shots: []`). Pour les autres clubs de la référence, xG par tir, finition, gardien et conversion sont donc inconnus (non mesurés, jamais 0), et la phase « finition » manque à leurs centiles. Le club du dossier, lui, est mesuré sur sa propre lecture complète, sur les matchs de la référence (17 novembre 2026, étape 5) :
- dans son championnat, ou dans une référence où il figure (Europe, une coupe), sur les matchs de sa ligne dans cette référence, jamais ceux d'une autre compétition ;
- inséré dans une référence où il ne figure pas, avec ses valeurs de championnat ;
- sur une copie : la cohorte en cache, partagée par les dossiers du championnat, n'est pas modifiée.

Tant que moins de 5 clubs de la référence sont mesurés, ces quatre indicateurs n'ont ni rang, ni centile, ni médiane de référence : jamais « 1er sur 1 », ni la valeur du club présentée comme la médiane du championnat. Les totaux de saison de l'onglet avancé (chantier VI-22) multiplient encore la moyenne par tous les matchs et lisent une valeur absente comme 0 ; ils ne sont pas corrigés ici. Recommandation : une future lecture résumée devra fournir, pour chaque camp, la classification des contre son camp **et** le nombre de penalties tentés, avec leur couverture.

## Défense

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Buts encaissés / match | moyenne de `ga` (tous les matchs) | − |
| xG concédés / match | moyenne du xG adverse | − |
| xG concédés hors penalty / match | moyenne du npxG adverse | − |
| Tirs concédés / match | moyenne des tirs adverses | − |
| Grosses occasions concédées / match | moyenne des grosses occasions adverses | − |
| Ballons adverses dans la surface / match | moyenne de `touches_opp_box` adverse | − |
| Tirs cadrés concédés / match | moyenne des tirs cadrés adverses | − |
| xG concédés en jeu ouvert / match | moyenne du xG adverse en jeu ouvert | − |
| Matchs sans encaisser | 100 × matchs avec `ga = 0` / matchs (tous les matchs) | + |

## Contrôle et territoire

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Possession | moyenne de `BallPossesion` (%) | style |
| Passes / match | moyenne de `passes` | style |
| Passes adverses / match | moyenne des passes adverses | style |
| Passes réussies | 100 × Σ passes réussies / Σ passes | + |
| Territoire (field tilt) | 100 × Σ passes du club dans le camp adverse / Σ (passes du club + de l'adversaire dans le camp adverse) | + |
| Part des ballons dans les surfaces | 100 × Σ ballons du club dans la surface adverse / Σ (ceux du club + ceux de l'adversaire) | + |
| Jeu long | 100 × Σ longs ballons réussis / Σ passes réussies | style |
| Centres réussis / match | moyenne de `accurate_crosses` | style |

## Pressing et duels

| Indicateur | Formule | Sens |
| --- | --- | --- |
| PPDA (approx.) | Σ passes adverses dans leur propre moitié / Σ (tacles + interceptions + fautes du club) | − |
| Tacles + interceptions (ajusté poss.) | moyenne par match de `(tacles + interceptions) × 50 / (100 − possession)` | style |
| Duels gagnés | 100 × Σ duels gagnés du club / Σ (duels gagnés du club + de l'adversaire) | + |
| Duels aériens gagnés | 100 × Σ aériens gagnés du club / Σ (aériens gagnés du club + de l'adversaire) | + |
| Fautes / match | moyenne de `fouls` | style |

Le **PPDA** (*passes allowed per defensive action*) mesure combien de passes l'adversaire peut jouer avant une action défensive. Bas = pressing agressif. C'est une **approximation** : le fournisseur ne donne pas la zone des actions défensives, donc toutes les actions défensives du match comptent, pas seulement celles dans la moitié adverse.

L'**ajustement à la possession** ramène le volume défensif à une possession adverse de 50 % : avec 60 % de possession (40 % pour l'adversaire), 20 actions deviennent 20 × 50 / 40 = 25.

## Coups de pied arrêtés

| Indicateur | Formule | Sens |
| --- | --- | --- |
| xG sur CPA / match | moyenne de `expected_goals_set_play` | + |
| xG concédés sur CPA / match | moyenne du xG adverse sur CPA | − |
| Part des CPA dans les xG | 100 × Σ xG sur CPA / Σ xG | style |
| Corners / match | moyenne de `corners` | + |
| Corners concédés / match | moyenne des corners adverses | − |

## Discipline

| Indicateur | Formule | Sens |
| --- | --- | --- |
| Cartons jaunes / match | moyenne de `yellow_cards` | − |
| Cartons rouges | **total** de la saison (pas une moyenne) ; inconnu si aucun match ne le renseigne, 0 s'il est renseigné à 0 (N6) | − |

## Côté serveur

Les centiles des clubs de la base (`agg.team_percentiles`, que lit la similarité des clubs) et la saison publiée (`api.team_season`) suivent les mêmes règles depuis le 17 novembre 2026 ([club_indicators.py](../../../backend/vega/club_indicators.py), version `club-indicators-v2` ; migration 127 ; nouveau relevé N1) :
- chaque indicateur compte les matchs sur lesquels il repose (`covered_matches`), au lieu de tous les matchs du club : un axe connu sur 3 matchs sur 8 ne passe plus un seuil de 5 ;
- 13 indicateurs lisent un support apparié, rempli par le calcul des saisons (`pair_*` de `agg.team_season_stats`) : xG par tir, tirs dans la surface, finition, gardien, conversion, territoire, part des ballons dans les surfaces, jeu long, PPDA, actions défensives ajustées, duels, duels aériens, part des CPA. Les 33 autres gardent leur formule ;
- les penalties se comptent sur la liste `core.shots` complète et réconciliée du match (couverture des tirs `ok`, séance de tirs au but exclue) ; les contre son camp, sur ses événements de but (couverture `ok`) lus dans l'ordre du score, chacun montant le score d'un camp d'un but jusqu'au score final, chaque but portant son indicateur de contre son camp ;
- la qualité de frappe (`placement_sum`, `placement_matches`) repose sur les matchs qui connaissent le xG et le xGOT du club, sans le xG adverse, qu'elle ne lit pas (17 novembre 2026, étape 5) ;
- `api.team_season` garde ses 783 colonnes, leurs noms, leur ordre et leurs types ; les 37 colonnes `pair_*` s'ajoutent à la fin.

Le site et le serveur ne lisent pas les contre son camp à la même source (la liste des tirs pour l'un, les événements pour l'autre) : leurs couvertures peuvent différer. L'indicateur « actions défensives ajustées » garde aussi deux définitions déjà distinctes avant l'audit : moyenne par match côté site, moyenne de saison ajustée par la possession de la saison côté serveur.

## Moyenne glissante

La tendance xG pour / contre ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L838)) utilise `rolling` : moyenne des 5 derniers matchs (moins au début de saison), valeurs absentes ignorées.

## Résumé club des autres pages

La fiche match (« Forme avant le match ») et l'effectif utilisent `clubSummary` ([club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js#L162)), plus simple : bilan V / N / D, points, buts, matchs sans encaisser (domicile, extérieur, total), puis moyennes par match de 15 statistiques (xG pour et contre, différence de xG, tirs pour et contre, possession, passes, ballons dans la surface, corners, duels, aériens, tacles, interceptions, dégagements, arrêts). Ici, une statistique est moyennée sur les seuls matchs où elle est observée, indépendamment du xG. Le même calcul existe en SQL pour l'annuaire des clubs ([clubs.mjs](../../../backend/api/src/routes/clubs.mjs)).
