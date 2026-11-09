# Similarité, radar, pizza et traits

Tout repose sur les centiles saison par 90 de la cohorte du poste ([Centiles et cohortes](02-centiles-et-cohortes.md)).

## Joueurs similaires

`similarPlayers` dans [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L325).

**Axes de style** (15) : tirs, ballons dans la surface, occasions créées, passes dans le dernier tiers, dribbles, ballons touchés, passes réussies, précision des passes, duels gagnés, duels %, tacles, interceptions, récupérations, dégagements, arrêts.

Pour chaque pair du même groupe :
1. on garde les axes où **les deux** joueurs ont un centile ;
2. il faut au moins `max(5, ⌈0,75 × nombre d'axes classés du joueur cible⌉)` axes communs, sinon le pair est écarté (« quelques indicateurs partagés ne font pas un profil complet ») ;
3. distance = moyenne des écarts absolus de centile ;

$$
\text{similarité} = 100 - \frac{1}{K}\sum_k \left|\,p_k^{\text{joueur}} - p_k^{\text{pair}}\,\right|
$$

4. tri par similarité décroissante, 8 joueurs proposés ; les axes les plus proches sont listés en premier.

Exemple : 12 axes classés pour le joueur → il faut 9 axes communs. Sur 10 axes communs, écarts moyens de 7 centiles → similarité **93**.

## Traits marquants

`cohortTraits` : parmi les 15 axes de style classés, les **3 centiles les plus hauts** (points forts) et les **3 plus bas** (points faibles).

La carte « Lecture du scout » reprend les deux premiers points forts et le premier point faible (voir [Carte « Lecture du scout »](07-lecture-du-scout.md)).

## Radar de la vue d'ensemble

`overviewRadarValues` dans [player-overview-radar.js](../../../dashboard/frontend/src/services/player-overview-radar.js#L20).

| Joueur de champ | Gardien |
| --- | --- |
| buts, passes décisives, occasions créées, tirs cadrés, duels gagnés, récupérations | arrêts, buts évités, passes réussies, récupérations, dégagements, ballons touchés |

Pour chaque axe :
- **valeur du joueur** : par 90, seulement si ses minutes atteignent le seuil et que la mesure couvre tous ses matchs ;
- **moyenne de la cohorte** : moyenne arithmétique des valeurs par 90 des pairs ;
- **centile du joueur** et **centile de cette moyenne** dans la cohorte (s'il y a au moins 30 pairs) ;
- **échelle** de l'axe : de `min(0, plus petite valeur, valeur du joueur)` à `max(0, plus grande valeur, valeur du joueur)`.

Buts et passes décisives figurent sur le radar avec leur centile saison : à la différence du profil d'une performance, ils sont classables au niveau saison.

## Pizza des centiles

`PIZZA_KEYS` dans [PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L100) : une part par indicateur, de longueur égale au centile, ordonnée par phase de jeu.

| Groupe | Axes |
| --- | --- |
| G | arrêts, buts évités, passes réussies, précision, ballons touchés, récupérations, dégagements |
| D | occasions créées, dernier tiers, passes réussies, précision, ballons touchés, duels gagnés, duels %, tacles, interceptions, récupérations, dégagements, tirs bloqués |
| M | buts, xG, occasions créées, dernier tiers, dribbles, passes réussies, précision, ballons touchés, duels gagnés, tacles, interceptions, récupérations |
| O et F | buts, xG, tirs, tirs cadrés, ballons dans la surface, passes décisives, occasions créées, grosses occasions créées, dernier tiers, dribbles, duels gagnés, récupérations |

## Familles de l'onglet statistiques

`scoutFamilies` : finition (buts, xG, npxG, xGOT, tirs, cadrés, surface), création (passes décisives, xA, occasions, grosses occasions), progression (dribbles, dernier tiers, ballons touchés), passe (réussies, tentées, précision), défense (actions défensives, tacles, interceptions, récupérations, duels, duels %, dégagements, tirs bloqués), sécurité de balle (duels perdus + lignes fictives), gardien pour le groupe G. Chaque ligne montre total, par 90 ou par match, centile et rang quand ils existent.

## Comparaison de joueurs

[PlayerComparison.jsx](../../../dashboard/frontend/src/components/PlayerComparison.jsx) met côte à côte les valeurs (total, par match ou par 90) et les centiles saison de plusieurs joueurs, chacun dans **sa propre cohorte**, avec en option la médiane de la cohorte (`median`).
