# Le xG de Vega

Un second calcul des buts attendus, fait par Vega à partir de ce que la base sait de chaque tir ([xg.py](../../../backend/vega/xg.py)). Il ne remplace pas le xG de la source, que le site continue d'afficher partout : il le double, et servirait de secours si la source changeait.

## Ce que le modèle lit

Pour chaque tir placé sur le terrain (105 × 68 m, l'équipe attaquant vers x = 105), hors buts contre son camp :

- la **distance** au centre du but : `d = √((105 − x)² + (34 − y)²)` ;
- l'**angle** que le but occupe vu du tir : `θ = atan2(7,32 × (105 − x), (105 − x)² + (34 − y)² − 3,66²)`, ramené à 0 s'il est négatif ;
- la **partie du corps** : tête, pied, autre ;
- la **situation** : jeu courant, corner, coup de pied arrêté, contre-attaque, coup franc, touche, action individuelle.

Il ne connaît ni la position des défenseurs, ni celle du gardien, ni le type de la passe : la source, elle, les connaît.

## Le modèle

Une régression logistique : `xG = 1 / (1 + e^(−z))`, avec

`z = a + b₁·θ + b₂·d + b₃·d²/100 + b₄·θ·d/10 + tête·(b₅ + b₆·d/10) + autre partie du corps·b₇ + poids de la situation`

Les coefficients sont ajustés sur les tirs de la base regroupés par cases (même situation, même partie du corps, même mètre de distance, même vingtième de radian d'angle), par la méthode de Newton ; un pas n'est gardé que s'il améliore l'ajustement. Ils sont écrits dans `agg.xg_models`, un par colonne. Un **penalty** vaut la part des penalties de la base qui ont été marqués.

Le modèle est ajusté une fois, puis de nouveau quand la base détient un quart de tirs de plus qu'à l'ajustement précédent (le rattrapage de l'historique) : tous les tirs de toutes les saisons sont alors recalculés par le nouveau modèle, pour qu'un seul modèle lise tous les tirs. Chaque jour, les tirs de la saison en cours sont recalculés avec les modèles de la saison (`agg.shot_xg`).

## Vérification sur des tirs non vus (12 novembre 2026)

Modèle ajusté sur les 387 486 tirs hors penalty de 2025/2026, jugé sur les 302 051 tirs hors penalty de 2026/2027, qu'il n'a pas vus. La perte logarithmique moyenne mesure l'erreur d'une probabilité (plus bas est mieux).

| Modèle | Perte logarithmique | Somme des xG | Buts |
| --- | --- | --- | --- |
| La même probabilité pour tous les tirs | 0,3148 | | |
| **xG de Vega** | **0,2694** | 27 887 | 28 804 |
| xG de la source | 0,2530 | 29 082 | 28 804 |

Le xG de Vega fait les trois quarts du chemin entre l'absence de modèle et le xG de la source. Par dixième de tirs rangés selon le xG de Vega, la moyenne prévue suit la part de buts observée (de 0,015 prévu pour 0,020 observé dans le dixième le plus faible à 0,339 pour 0,336 dans le plus fort), avec une légère sous-estimation entre 0,08 et 0,18. Tir par tir, sa corrélation avec le xG de la source est de 0,83 ; sur le total d'une équipe dans un match, de 0,92.

Coefficients de cet ajustement : constante −1,375 ; angle +1,027 ; distance −0,167 ; distance² / 100 +0,155 ; angle × distance / 10 +1,467 ; tête +0,114 et tête × distance / 10 −1,374 ; autre partie du corps −0,177 ; corner −0,706 ; coup de pied arrêté −0,414 ; contre-attaque +0,510 ; coup franc +0,608 ; touche −0,478 ; action individuelle −0,377. En service, le modèle est ajusté sur toutes les saisons détenues : ses coefficients (dans `agg.xg_models`) diffèrent un peu de ceux-ci.

## Où il se lit

Sur la fiche d'un match, onglet « Tirs & xG » : la colonne « xG Vega » du tableau des tirs, à côté du xG de la source (`expected_goals_vega` dans la lecture des tirs du match). Les totaux, les cartes et les classements du site restent calculés avec le xG de la source.

## Limites

- Deux saisons de tirs seulement sont dans la base aujourd'hui ; l'ajustement sera refait à mesure que l'historique arrive.
- Sans la position des défenseurs et du gardien, le modèle ne distingue pas une occasion nette d'un tir contré depuis le même endroit.
- Un tir sans coordonnées, ou placé hors du terrain, n'a pas de xG de Vega.
