# Points attendus (xPts) et victoires attendues

Les points attendus répondent à la question : **combien de points l'équipe aurait-elle pris en moyenne si ce match était rejoué beaucoup de fois avec les mêmes occasions ?**

Code : `poisson`, `outcomeChances` et `teamRows` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L597).

## Le modèle

Pour un match, on prend les xG d'équipe des deux camps (statistique `expected_goals`) :
- λ<sub>A</sub> = max(0,01 ; xG de l'équipe)
- λ<sub>B</sub> = max(0,01 ; xG de l'adversaire)

Chaque équipe marque un nombre de buts qui suit une **loi de Poisson** de moyenne son xG, indépendamment de l'autre :

$$
P(\text{l'équipe marque } k \text{ buts}) = e^{-\lambda}\,\frac{\lambda^k}{k!}, \qquad k = 0, 1, \dots, n, \quad n = \lceil \lambda + 12\sqrt{\lambda} + 12 \rceil
$$

Le support s'adapte au xG : la masse laissée au-delà de *n* buts est inférieure à 10⁻¹² (version 2, 17 novembre 2026, audit 10). La version 1 s'arrêtait à 10 buts par équipe : à 6 xG contre 6 xG, elle donnait 40,04 % de victoires pour 48,38 % de défaites, et un xG pour plus haut pouvait baisser les xPts.

**Domaine.** Un xG négatif, `NaN` ou infini n'a pas de loi (`null`), ni un xG au-dessus de **100** pour l'un des deux camps : une garde technique, pas une limite sportive (aucun match n'en approche), qui évite qu'un taux énorme épuise le calcul ou que `exp(−750)` échoue en SQL. Un grand xG n'est jamais ramené en silence à 100.

## Probabilités victoire / nul / défaite

$$
P(V) = \sum_{i > j} P_A(i)\,P_B(j) \qquad
P(N) = \sum_{i} P_A(i)\,P_B(i) \qquad
P(D) = \sum_{i < j} P_A(i)\,P_B(j)
$$

Les trois sont additionnées séparément, puis divisées par leur somme (qui vaut 1 à 10⁻¹² près) : la loi est symétrique (P(V) d'un camp est P(D) de l'autre) et les xPts ne baissent jamais quand le xG pour monte. C'est une approximation numérique des sommes infinies, pas une valeur exacte. La même loi est calculée en SQL par `agg.xpts_v2` (migration 126), que lisent `api.match_xpts` et le calcul des saisons ([calculator.py](../../../backend/vega/calculator.py)) ; `agg.xpts_v1` reste pour ce qui a été calculé avec lui.

## Points attendus

$$
\text{xPts} = 3 \times P(V) + 1 \times P(N)
$$

Le calcul n'est fait que si **les deux xG d'équipe sont connus** et les statistiques du match fiables ; sinon `xpts = null` et le match est exclu de toutes les sommes d'attendus.

**Points réels et attendus sur les mêmes matchs.** `record.points` (tous les matchs) et `xptsTotal` (les matchs avec xPts) gardent leur sens ; leur écart ne se lit plus par soustraction. La cohorte d'un club porte `pairedMatches`, `pairedActualPoints`, `pairedExpectedPoints` et `pairedPointsDelta`, sur les seuls matchs dont les xPts sont connus, et de même `pairedXgMatches`, `pairedXgFor`, `pairedXgAgainst`, `pairedXgDelta`, `pairedXgDeltaPerMatch` pour la différence de xG (audit 9, N5). Le classement aux points attendus range sur les totaux seulement dans une cohorte d'un championnat où tous les clubs sont couverts, sinon par match couvert, les clubs sans xPts en dernier (N7). Les écrans du chantier des profils (VI-22) soustraient encore `record.points − xptsTotal` : ce branchement leur est transmis ([traçabilité](../09-audit-2026-11/TRACEABILITY.md)).

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
| Rang aux points attendus (`xptsPosition`) | sur les totaux (`pairedExpectedPoints`) seulement dans une cohorte d'un championnat dont chaque club est couvert sur tous ses matchs ; sinon, et dans un référentiel mixte, par match couvert (`pairedExpectedPoints / pairedMatches`) ; les clubs sans xPts en dernier (N7) |
| Courbe « Points et points attendus » | cumul des points et cumul des xPts, **sur les seuls matchs avec xPts** ; info-bulle : points pris, xPts du match, écart ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L881)) |
| Écart réel − attendu | points et xPts **des mêmes matchs**, ceux dont les xPts sont connus (`pairedPoints`, [club-supported.js](../../../dashboard/frontend/src/services/club-supported.js), qui lit `pairedPointsDelta` et `pairedMatches` de la cohorte) : « +3,2 pts vs attendu », suivi de « sur 9 matchs » quand ils sont moins nombreux que le bilan ; par match dans le tableau européen (`ExpectedGapTable`) ; « — » sans aucun match avec xPts |
| Classement aux points attendus | même tableau que le championnat, trié par `xptsPosition`, avec flèches ▲ / ▼ quand le rang réel est meilleur / moins bon |

Lecture proposée par le site : un écart positif durable signale une finition ou un gardien au-dessus de la moyenne, ou de la réussite ; ces écarts tendent à se résorber.

## Hypothèses du modèle

- Les buts des deux équipes sont **indépendants** et suivent chacun une loi de Poisson : pas de corrélation, pas d'effet du score sur le jeu.
- Le xG du match résume toutes les occasions ; l'avantage du terrain n'est pas ajouté (il est déjà dans les xG observés).
- Un xG d'équipe agrégé est utilisé, pas la liste des tirs : deux occasions à 0,5 et une occasion à 1,0 donnent le même λ.

## Point d'attention

Depuis le 17 novembre 2026 (VI-22), les écarts « points − xPts » de la carte d'identité, de la carte « Résultats et attendus », du classement aux points attendus et du tableau européen comparent les points et les xPts des mêmes matchs. Avant, ils soustrayaient `xptsTotal` (matchs avec xG) aux points de **tous** les matchs. Le classement garde les points de tous les matchs ; la cellule xPts et l'écart disent, en info-bulle, sur combien de matchs ils reposent.

Côté base, l'index des clubs (`models._team_index`, colonne `agg.team_index.xpts_position`) range encore les xPts sur les totaux même quand la couverture est inégale. Aucune route ne lit cette position stockée : N7 n'est corrigé que sur le site. C'est une limite du producteur, consignée ici, pas une correction du serveur. `api.match_xpts` appelle la loi une fois par ligne (une seule fonction lue dans le plan ; étape 5, sans changement des valeurs, ni gain de vitesse revendiqué).
