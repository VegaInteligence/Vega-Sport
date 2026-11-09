# Centiles, rangs et indice Vega club

Code : `centile`, `rankCohort`, `PHASES` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1120).

## La cohorte

Par défaut, un club est comparé aux **clubs de son championnat national**, sur les **matchs de championnat** uniquement (`leagueCohort` lit chaque club de la ligue, puis `buildCohort` ne garde que ses matchs de cette ligue). Le championnat est la première compétition du club dont le pays n'est pas international. D'autres référentiels sont possibles (voir [Référentiels](03-referentiels-et-niveau-europeen.md)).

## Centile d'un indicateur

$$
\text{centile} = \operatorname{arrondi}\left(100 \times \frac{\#\{v < x\} + \tfrac{1}{2}\,\#\{v = x\}}{n}\right)
$$

- `x` : valeur du club ; `v` : valeurs des clubs de la cohorte (le club compris) ; `n` : nombre de clubs ayant une valeur.
- Les égalités comptent pour moitié (« rang moyen »).
- **Pas de centile** si la valeur du club manque ou si moins de **5** clubs ont une valeur.
- Pour un indicateur où plus bas est meilleur (`better = −1`), le centile affiché est `100 − centile` : un centile élevé est toujours favorable.
- Pour un indicateur de style (`better = 0`), le centile est laissé brut : il situe le club, sans jugement.

Exemple : 18 clubs, 11 ont moins de xG / match que le club, aucun autre n'a la même valeur (le club lui-même compte comme l'égalité) → `(11 + 0,5) / 18 = 63,9` → **64**.

## Rang

`rang = 1 + nombre de clubs strictement meilleurs` (strictement plus haut, ou strictement plus bas si `better = −1`). Deux clubs à égalité partagent le rang.

## Repères de distribution

Pour chaque indicateur, la cohorte fournit la médiane, les quantiles 10 / 25 / 50 / 75 / 90 % (interpolation linéaire entre les deux valeurs voisines), le minimum et le maximum. Ils servent aux bandes de distribution et à la colonne « médiane du championnat ».

## Phases de jeu

Une phase = moyenne arrondie des centiles disponibles de ses indicateurs :

| Phase | Indicateurs |
| --- | --- |
| Attaque | xG / match, grosses occasions, ballons dans la surface, xG par tir |
| Défense | xG concédés, grosses occasions concédées, ballons adverses dans la surface, tirs concédés |
| Contrôle | territoire, part des ballons dans les surfaces, passes réussies |
| Pressing et duels | PPDA, duels gagnés, duels aériens gagnés |
| Coups de pied arrêtés | xG sur CPA, xG concédés sur CPA, corners |
| Finition et gardien | finition (buts − xG), buts évités par le gardien |

Les indicateurs « moins = mieux » (xG concédés, PPDA…) entrent avec leur centile inversé.

## Indice Vega club

$$
\text{Indice Vega} = \operatorname{arrondi}\left(\frac{\sum_p w_p \cdot \text{phase}_p}{\sum_p w_p}\right)
$$

la somme portant sur les phases disponibles, avec :

| Phase | Poids |
| --- | --- |
| Attaque | 30 % |
| Défense | 30 % |
| Contrôle | 15 % |
| Pressing et duels | 10 % |
| Finition et gardien | 10 % |
| Coups de pied arrêtés | 5 % |

Si une phase manque, les poids des autres sont renormalisés. L'indice va de 0 à 100 et **se lit relativement à la cohorte** : 70 signifie « au niveau du 70e centile moyen de ce référentiel », pas une note absolue. Le rang Vega (`vegaRank`) trie les clubs par indice décroissant.

Exemple : attaque 80, défense 60, contrôle 70, pressing 50, finition 40, CPA 55 →
`(0,30×80 + 0,30×60 + 0,15×70 + 0,10×50 + 0,10×40 + 0,05×55) / 1 = 64,25` → **64**.

## Forces et faiblesses

`readings` ([ClubScoutTabs.jsx](../../../dashboard/frontend/src/components/ClubScoutTabs.jsx#L199)) trie les centiles du club, hors indicateurs de style et de résultats : les **4 plus hauts** sont les forces, les **3 plus bas** les faiblesses.

## Force d'un adversaire (calendrier)

`opponentStrength` : centile de la **différence de xG par match** (xG − xG concédés) de l'adversaire dans la cohorte du club.
