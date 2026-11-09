# Style, tags et clubs similaires

## Axes de style

`STYLE_AXES` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1097) place le club sur 7 spectres, à partir de son **centile** dans la cohorte :

| Axe | Gauche (centile bas) | Droite (centile haut) |
| --- | --- | --- |
| Possession | Laisse le ballon | Monopolise le ballon |
| Territoire | Joue dans son camp | Installé chez l'adversaire |
| Jeu long | Jeu court | Jeu long et direct |
| PPDA (axe inversé) | Pressing haut et agressif | Bloc qui attend |
| Centres | Peu de centres | Beaucoup de centres |
| Part des CPA | Peu dépendant des CPA | Dépendant des CPA |
| Actions défensives ajustées | Peu d'actions défensives | Très actif sans ballon |

## Tags de style

`styleTags` ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L640)) traduit les centiles en phrases, 6 au maximum :

| Condition | Tag |
| --- | --- |
| possession ≥ 75 | Possession dominante |
| possession ≤ 25 | Accepte de ne pas avoir le ballon |
| territoire ≥ 75 | Installé dans le camp adverse |
| PPDA ≥ 75 | Pressing haut et agressif |
| PPDA ≤ 25 | Bloc qui attend l'adversaire |
| jeu long ≥ 75 / ≤ 25 | Jeu direct, longs ballons / Relance courte |
| centres ≥ 75 | Beaucoup de centres |
| part des CPA ≥ 75 | Dangereux sur coups de pied arrêtés |
| xG par tir ≥ 75 | Tirs de grande qualité |
| xG concédés ≥ 75 | Défense qui concède peu |
| duels ≥ 75 | Gagne ses duels |
| finition ≥ 80 / ≤ 20 | Finition au-dessus / en dessous des xG |

Le centile PPDA est déjà inversé (bas PPDA = centile haut), d'où « ≥ 75 → pressing haut ».

## Clubs similaires

`similarClubs` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1556)) compare les centiles sur 10 axes : possession, territoire, jeu long, PPDA, centres, part des CPA, actions défensives ajustées, xG, xG concédés, passes réussies.

$$
\text{similarité} = \operatorname{arrondi}\left(100 - \frac{1}{K}\sum_{k} \left|\,c_k^{\text{club}} - c_k^{\text{autre}}\,\right|\right)
$$

- `K` : nombre d'axes où les deux clubs ont un centile.
- Les clubs sont triés par similarité décroissante ; les 6 premiers sont proposés (9 dans l'onglet « Similaires »).
- Les axes les plus proches sont listés en premier pour expliquer la ressemblance.
- La recherche peut se faire dans une autre ligue : les centiles sont alors ceux de cette ligue.

Exemple : écarts de centile 5, 10, 0, 20, 15, 5, 10, 0, 5, 10 → moyenne 8 → similarité **92**.

## Écarts entre deux clubs

`Gaps` ([ClubScoutProfile.jsx](../../../dashboard/frontend/src/components/ClubScoutProfile.jsx#L520)) compare les centiles des 12 axes de performance de la pizza (`PERFORMANCE_KEYS` : xG, grosses occasions, xG par tir, ballons dans la surface, finition, xG concédés, grosses occasions concédées, gardien, territoire, passes réussies, duels, xG sur CPA) et affiche, pour chaque club, les **3 axes où il devance l'autre du plus grand nombre de centiles**. Un centile manquant compte pour 0.

## Ancienne implémentation

[club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js#L294) contient une autre version (`clubStyleCohort`, `clubCentile`, `similarClubs`) avec des seuils plus stricts : au moins 3 matchs, 80 % de couverture de la mesure, 10 clubs dans la cohorte, et au moins `max(5, ⌈0,75 × axes disponibles⌉)` axes communs. Elle n'est plus appelée par les pages actuelles.
