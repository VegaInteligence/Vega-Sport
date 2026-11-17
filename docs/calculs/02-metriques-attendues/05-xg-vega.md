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

Les coefficients sont ajustés sur les tirs de la base regroupés par cases (même situation, même partie du corps, même mètre de distance, même vingtième de radian d'angle). Ils sont écrits dans `agg.xg_models`, un par colonne. Un **penalty** vaut la part des penalties de la base qui ont été marqués.

**Contraintes** (version `xg-v2`, 17 novembre 2026, audit 16a). `b₂ ≤ 0`, `b₃ ≤ 0`, `b₆ ≤ 0`, `b₁ ≥ 0` et `b₄ = 0` : à angle fixé, la pente de `z` en distance (`b₂ + b₃·d/50 + b₆/10` pour une tête) n'est jamais positive, et `z` ne baisse jamais quand l'angle s'ouvre. Le xG ne peut donc plus remonter loin du but : les coefficients de la version 1 (ci-dessous) donnaient 0,97 % à 50 mètres et 19,4 % à 100 mètres dans l'axe. L'ajustement est une méthode de Newton à ensemble actif : les coefficients posés sur une borne y restent pendant que des pas de Newton, réduits de moitié jusqu'à baisser assez l'objectif, déplacent les autres ; un pas qui franchirait une borne s'y arrête ; le coefficient bloqué que son gradient pousse le plus vers l'intérieur est relâché quand les autres sont optimaux. Il s'arrête quand plus aucun gradient ne le demande (les conditions d'optimalité), et dit comment il a fini (`converged`, `iterations`, `objective`, `max_violation`). Un ajustement qui n'a pas convergé, ou dont les coefficients ou l'objectif ne sont pas finis, ou qui sort des contraintes, n'est jamais publié : `refresh` lève `FitFailed` avant toute écriture, et le modèle publié comme tous les xG déjà calculés restent tels quels (17 novembre 2026). Dans le calcul quotidien, ce refus est journalisé (la saison et la classe de l'erreur, jamais son texte), les autres modèles de la saison, qui ne lisent pas le xG, s'exécutent jusqu'au bout, puis l'étape de la saison est signalée en échec et réessayée une heure plus tard. Toute autre erreur du xG arrête l'étape aussitôt (17 novembre 2026, stade 4). Les mêmes cases donnent les mêmes coefficients. Quand l'optimum libre respecte les contraintes, c'est lui. Python et SQL lisent le même `z`, borné à ±30 avant la sigmoïde ; un modèle d'une autre version n'est plus lu : il est réajusté et tous les tirs sont recalculés.

Le modèle est ajusté une fois, puis de nouveau quand la base détient un quart de tirs de plus qu'à l'ajustement précédent (le rattrapage de l'historique) : tous les tirs de toutes les saisons sont alors recalculés par le nouveau modèle, pour qu'un seul modèle lise tous les tirs. Chaque jour, les tirs de la saison en cours sont recalculés avec les modèles de la saison (`agg.shot_xg`).

**Un réajustement refusé** (17 novembre 2026, étape 7). Quand ce seuil est franchi, le modèle courant n'est plus lu ; si le nouvel ajustement est refusé, rien n'est écrit, comme convenu (ni modèle ni score). Jusqu'au prochain ajustement réussi :
- les xG déjà calculés restent ;
- les tirs arrivés depuis restent sans xG de Vega ;
- un tir modifié à la source garde son score précédent ;
- pendant un changement de version, les scores restent ceux de la version précédente, qui n'est plus lue.

L'étape quotidienne est signalée en échec et réessayée après son délai. Aucun ancien modèle ne sert de solution de repli dans l'intervalle : une telle politique demanderait sa propre conception et ses tests.

## Vérification sur des tirs non vus (12 novembre 2026, version 1)

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

## Évaluation datée et prudence (version 2)

[evaluate_xg.py](../../../backend/tools/evaluate_xg.py) ajuste les deux modèles, libre (version 1) et contraint (version 2), sur les tirs datés d'avant une date de coupure et les lit sur ceux d'après, à partir d'un fichier d'entrée versionné et immuable (`vega-xg-evaluation-input/1`, son empreinte sha256 dans le rapport) ; le rapport donne la perte logarithmique, le score de Brier, la calibration par distance et par situation, et les contraintes que viole chaque modèle. Sans heure de disponibilité des tirs, c'est une évaluation rétrospective au temps de l'événement, pas une rejouée de ce qui était connu. Le rapport dit si la comparaison est complète (`complete`, `status`, `failed_fits`) : si l'un des deux ajustements n'a pas convergé, ses chiffres restent comme diagnostics de la dernière itération, jamais comme ceux d'un optimum, et l'outil sort avec le code 3 après avoir écrit le rapport (`--iterations N` règle le plafond des pas de Newton).

Aucune amélioration prédictive n'est revendiquée : les contraintes sont une propriété du modèle. Elles réduisent sa souplesse. Sur une entrée synthétique tirée d'un modèle qui remonte loin du but (graine 7, coupure au 1ᵉʳ janvier 2025), la perte du modèle contraint sur les tirs d'après est 0,31192 contre 0,31113 pour le modèle libre. La version 2 n'a pas été évaluée sur les tirs réels (validation sur données réelles indisponible).

## Limites

- Deux saisons de tirs seulement sont dans la base aujourd'hui ; l'ajustement sera refait à mesure que l'historique arrive.
- Sans la position des défenseurs et du gardien, le modèle ne distingue pas une occasion nette d'un tir contré depuis le même endroit.
- Un tir sans coordonnées, ou placé hors du terrain, n'a pas de xG de Vega.
