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

## Profils les plus proches (plongement du profil)

En tête de l'onglet « Profils similaires », une seconde lecture, apprise des données au lieu d'une liste d'axes choisis ([embedding.py](../../../backend/vega/embedding.py), `/api/players/{id}/similar`).

**Ce qui est lu.** Pour chaque joueur d'au moins 450 minutes sur la saison, toutes compétitions réunies : chaque statistique qui s'additionne d'un match à l'autre (tirs, passes, duels, conduites, actions défensives, valeurs d'action…), ramenée à 90 minutes du temps où elle est mesurée. La discipline, les buts contre son camp, les penalties et le score « fantasy » de la source sont laissés de côté ; une statistique mesurée pour moins de 60 % des joueurs aussi (celles des gardiens, les données physiques).

**Le calcul.**

1. Chaque statistique est centrée et réduite sur les joueurs de la saison, puis bornée à ±3 écarts-types ; une valeur non mesurée prend la moyenne.
2. Les axes principaux de ce tableau (les directions le long desquelles les joueurs diffèrent le plus) sont calculés ; chaque joueur est placé sur les 10 premiers (`agg.player_embeddings`).
3. Les joueurs les plus proches d'un joueur sont ceux à la plus petite distance dans cet espace. La **proximité** affichée vaut `100 × (1 − distance / distance médiane du joueur aux autres)`, bornée à 0 : 100 pour le même profil, 0 pour un joueur aussi loin que la moitié des joueurs de la saison.

Le poste n'entre pas dans le calcul, ni le niveau du championnat : deux joueurs proches ont le même genre de saison, pas forcément le même niveau (qui se lit à l'Indice Vega). Les joueuses de la compétition féminine de la base sont comparées entre elles.

**Vérification (12 novembre 2026, saison 2025/2026, 20 614 joueurs, 93 statistiques retenues).** Les 10 axes gardent 78 % de la variance. Sans connaître le poste, les 10 plus proches voisins d'un joueur ont le même rôle que lui (parmi les sept rôles du classement) dans 68 % des cas, contre 16 % au hasard, et jouent sur la même ligne dans 84 % des cas, contre 31 %. Exemples : Lamine Yamal a pour voisins Michael Olise, Désiré Doué et Khvicha Kvaratskhelia ; Virgil van Dijk, des défenseurs centraux ; Thibaut Courtois, des gardiens. La liste ci-dessous (centiles sur 15 axes, dans la cohorte du poste) reste affichée : elle répond à une autre question, « qui lui ressemble parmi les joueurs de son poste ».

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
