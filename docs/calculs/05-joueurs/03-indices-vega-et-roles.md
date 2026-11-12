# Indices Vega joueur et profils de rôle

Les indices joueurs sont des **moyennes pondérées de centiles saison** (voir [Centiles et cohortes](02-centiles-et-cohortes.md)). Ils se lisent sur 100, relativement à la cohorte du poste.

## Indice personnalisé

`customIndex` dans [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L249), construit dans l'onglet « Indices » ([PlayerIndices.jsx](../../../dashboard/frontend/src/components/PlayerIndices.jsx)).

Pour chaque indicateur choisi `k`, de poids `w_k > 0` et de sens « max » ou « min » :

$$
s_k = \begin{cases} \text{centile}_k & \text{sens « max »} \\ 100 - \text{centile}_k & \text{sens « min »} \end{cases}
\qquad
\text{indice} = \frac{\sum_k w_k\, s_k}{\sum_k w_k}
$$

- **Tous** les centiles doivent exister ; s'il en manque un, l'indice est `null` (pas de moyenne partielle).
- Un indicateur non classable (xA) avec un poids > 0 rend l'indice impossible.
- Chaque composante affiche sa part (`w_k / Σ w`) et sa contribution (`s_k × w_k / Σ w`).
- Indice par défaut « Mon indice » : passes réussies, occasions créées, récupérations, poids 1 chacun, sens « max », 450 minutes minimum.

Exemple : passes réussies P80 (poids 2), occasions créées P60 (poids 1), récupérations P45 (poids 1) → `(2×80 + 60 + 45) / 4 = 66,25`.

## Profils de rôle

`ROLE_PROFILES` et `roleAssessments` dans [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L108). Chaque rôle est un indice à **poids égaux**, évalué seulement pour les groupes concernés :

| Rôle | Groupes | Indicateurs (par 90) |
| --- | --- | --- |
| Récupération | D, M, O | récupérations, interceptions, tacles |
| Défense de surface | D | dégagements, tirs bloqués, duels gagnés |
| Construction | D, M, G | passes réussies, précision des passes, ballons touchés |
| Création | M, O, F | occasions créées, passes dans le dernier tiers, passes réussies |
| Percussion | M, O, F | dribbles réussis, ballons dans la surface, occasions créées |
| Présence offensive | O, F | xG, tirs, ballons dans la surface |
| Arrêts | G | arrêts, buts évités |

Les rôles sont triés du plus haut au plus bas.

## Indice Vega du joueur (colonne de droite)

`vega` dans [PlayerSeasonProfile.jsx](../../../dashboard/frontend/src/components/PlayerSeasonProfile.jsx) lit le **classement de puissance** de la saison (`/api/rankings/power/player`, voir [Classements joueurs](05-classements-joueurs.md)) :
1. **Niveau actuel** = score du joueur dans le classement, arrondi (0 à 100) ;
2. **Rang** = son rang parmi les joueurs classés de son rôle (`roleRank`) ;
3. **Sur** = nombre de joueurs classés de ce rôle (`roleCount`).

Un joueur qui a un score sans être classé (championnat hors de l'échelle commune) a son niveau, pas de rang.

Pour une saison sans classement de puissance, ou un joueur qui n'y a pas de score (trop peu de minutes), la colonne garde l'ancien calcul :
1. **Niveau actuel** = valeur arrondie du **meilleur rôle** du joueur (le premier rôle dont l'indice existe) ;
2. **Rang** = `1 + nombre de joueurs de la cohorte dont l'indice sur ce même rôle est strictement supérieur` ;
3. **Sur** = nombre de joueurs de la cohorte ayant un indice sur ce rôle, plus le joueur.

Le « Potentiel » affiché à côté est une **donnée fictive** (badge « Données fictives »).

## Version

Les indices et la similarité portent la version `statarena-descriptive-v1` (`SCOUTING_VERSION`) : ce sont des **descriptions** de la saison observée, pas des prédictions.
