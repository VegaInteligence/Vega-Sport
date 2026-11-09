# Points attendus (xPts) et victoires attendues

Les points attendus répondent à la question : **combien de points l'équipe aurait-elle pris en moyenne si ce match était rejoué beaucoup de fois avec les mêmes occasions ?**

Code : `poisson`, `outcomeChances` et `teamRows` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L597).

## Le modèle

Pour un match, on prend les xG d'équipe des deux camps (statistique `expected_goals`) :
- λ<sub>A</sub> = max(0,01 ; xG de l'équipe)
- λ<sub>B</sub> = max(0,01 ; xG de l'adversaire)

Chaque équipe marque un nombre de buts qui suit une **loi de Poisson** de moyenne son xG, indépendamment de l'autre :

$$
P(\text{l'équipe marque } k \text{ buts}) = e^{-\lambda}\,\frac{\lambda^k}{k!}, \qquad k = 0, 1, \dots, 10
$$

Le calcul s'arrête à 10 buts par équipe (la probabilité au-delà est négligeable).

## Probabilités victoire / nul / défaite

$$
P(V) = \sum_{i > j} P_A(i)\,P_B(j) \qquad
P(N) = \sum_{i} P_A(i)\,P_B(i) \qquad
P(D) = \max\bigl(0,\; 1 - P(V) - P(N)\bigr)
$$

La défaite est obtenue par complément : elle absorbe aussi la très petite masse au-delà de 10 buts.

## Points attendus

$$
\text{xPts} = 3 \times P(V) + 1 \times P(N)
$$

Le calcul n'est fait que si **les deux xG d'équipe sont connus** et les statistiques du match fiables ; sinon `xpts = null` et le match est exclu de toutes les sommes d'attendus.

## Exemples (valeurs du code)

| xG équipe | xG adversaire | P(V) | P(N) | P(D) | xPts |
| --- | --- | --- | --- | --- | --- |
| 1,8 | 0,9 | 58,6 % | 22,9 % | 18,5 % | **1,99** |
| 1,0 | 1,0 | 34,6 % | 30,9 % | 34,6 % | **1,35** |
| 0,4 | 2,6 | 3,9 % | 11,7 % | 84,5 % | **0,23** |
| 0 | 0 | 1,0 % | 98,0 % | 1,0 % | **1,01** |

Pour 1,8 contre 0,9 : P(0, 1, 2, 3 buts) vaut 0,165 / 0,298 / 0,268 / 0,161 pour l'équipe et 0,407 / 0,366 / 0,165 / 0,049 pour l'adversaire ; on additionne les produits des cases « équipe > adversaire » pour la victoire et de la diagonale pour le nul.

Le plancher de 0,01 fait qu'un match à 0 xG partout vaut presque exactement un nul attendu.

## Victoires attendues

`outcomeChances` renvoie déjà P(V), P(N) et P(D) pour chaque match. Les **victoires attendues** d'une saison s'obtiennent en les additionnant :

$$
\text{Victoires attendues} = \sum_m P_m(V), \quad
\text{Nuls attendus} = \sum_m P_m(N), \quad
\text{Défaites attendues} = \sum_m P_m(D)
$$

Aujourd'hui **le site n'affiche que les xPts** : `teamRows` ne conserve que `.xpts` et aucune page ne lit `win`, `draw` ou `loss`. Afficher des victoires attendues ne demanderait aucun nouveau modèle, seulement de garder ces trois probabilités par match.

## Utilisations sur le site

| Où | Calcul |
| --- | --- |
| Indicateur « xPts / match » | moyenne des xPts des matchs où ils existent |
| Total xPts d'un club (`xptsTotal`) | somme des xPts des matchs de la compétition |
| Rang aux points attendus (`xptsPosition`) | clubs triés par `xptsTotal` décroissant ; par match dans un référentiel mixte |
| Courbe « Points et points attendus » | cumul des points et cumul des xPts, **sur les seuls matchs avec xPts** ; info-bulle : points pris, xPts du match, écart ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L881)) |
| Écart réel − attendu | `points − xptsTotal` (« +3,2 pts vs attendu ») ; par match dans le tableau européen (`ExpectedGapTable`) |
| Classement aux points attendus | même tableau que le championnat, trié par `xptsPosition`, avec flèches ▲ / ▼ quand le rang réel est meilleur / moins bon |

Lecture proposée par le site : un écart positif durable signale une finition ou un gardien au-dessus de la moyenne, ou de la réussite ; ces écarts tendent à se résorber.

## Hypothèses du modèle

- Les buts des deux équipes sont **indépendants** et suivent chacun une loi de Poisson : pas de corrélation, pas d'effet du score sur le jeu.
- Le xG du match résume toutes les occasions ; l'avantage du terrain n'est pas ajouté (il est déjà dans les xG observés).
- Un xG d'équipe agrégé est utilisé, pas la liste des tirs : deux occasions à 0,5 et une occasion à 1,0 donnent le même λ.

## Point d'attention

Les écarts « points − xPts » de la carte d'identité et du tableau de classement soustraient `xptsTotal` (matchs avec xG) aux points de **tous** les matchs. Si des matchs n'ont pas de xG, l'écart est surestimé. Voir [points d'attention](../07-limites/02-points-d-attention.md).
