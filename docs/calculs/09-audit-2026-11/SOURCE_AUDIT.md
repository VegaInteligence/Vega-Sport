# Audit des calculs et modèles — Vega Sport

**Date : 16 novembre 2026.**

**Révision auditée :** `36049afb498b177cc6d92ebd1b7b2346a81b7639`, branche `main`, dépôt `VegaInteligence/Vega-Sport`. Commit daté du 16 novembre à 18 h 13 min 22 s, heure de Paris. Le pointeur distant a été vérifié de nouveau à la fin de la revue : même révision. Copie locale propre, sans modification de fichier suivi, commit, déploiement ou écriture en base.

**Périmètre :** calculs Python, calculs JavaScript réellement appelés, formules SQL, articulation entre modèles, normalisation des entrées et documentation `docs/calculs`. La présentation visuelle n'est pas évaluée.

## Conclusion

Plusieurs défauts peuvent modifier des contributions individuelles, des rangs, des statistiques et des probabilités. Les problèmes les plus importants portent sur la signification des valeurs manquantes, les dénominateurs, les dates de référence et la cohérence entre les moteurs. Le modèle de niveau des championnats ne correspond pas à l'estimation MAP décrite dans sa documentation.

Les briques usuelles — Elo à paramètres fixés, Poisson, correction de Dixon–Coles dans la prévision de match, régression logistique des xG, affectation de l'équipe type — ne justifient pas une réécriture générale. Il faut d'abord réparer les invariants, rendre les entrées comparables et refaire une validation temporelle reproductible.

Ce rapport prouve des défauts de code et leurs conditions d'apparition. **Il ne mesure pas leur fréquence dans la base actuelle, ne fournit pas de classement corrigé de production et ne prétend pas que tous les résultats sont faux.** Aucun instantané de la base de production ni coefficient actuellement déployé n'a été récupéré. Les exemples sont distingués entre données du dépôt, cas synthétiques, constats statiques et coefficients historiques documentés.

## Méthode et couverture

La revue a confronté les pages de `docs/calculs`, la méthode Ballon d'Or et les fonctions effectivement appelées. Les explications les plus anciennes ont parfois été remplacées par les versions récentes : une contradiction documentaire n'a donc pas été comptée automatiquement comme bug de calcul.

| Famille | Calcul inspecté | Fichiers principaux |
|---|---|---|
| Force des clubs et championnats | Elo séquentiel, niveaux initiaux, passages entre ligues, priors, incertitudes | `power.py` |
| Notes des joueurs, Ballon d'Or | Rôles, attentes par rôle et adversaire, résidus, blocs, enjeux, régularisation, niveau du club, prior de saison précédente | `power.py`, `models.py` |
| Prévision de match | Deux intensités de buts issues de l'Elo, Poisson, correction des petits scores, forme récente | `forecast.py` |
| Projection de saison | Simulation Monte-Carlo des matchs restants, incertitude de force, points et positions finales | `forecast.py`, `rounds.py` |
| Compositions et remplacements | Rendements des titulaires, écarts aux compositions habituelles, conversion en Elo et points | `lineup.py`, `lineup.mjs` |
| Probabilités pendant le match | Temps restant, score, expulsions, modification du rythme selon l'avance | `inplay.py`, `shared/inplay.js`, `rankings.mjs` |
| xG Vega | Logistique sur distance, angle, situation et partie du corps ; penalties séparés | `xg.py` |
| Agrégats et comparaisons | Sommes, minutes couvertes, par 90, rapports de sommes, centiles, indices descriptifs | `calculator.py`, `models.py`, SQL, services JS |
| Similarités | Distances entre centiles et projection PCA sur dix dimensions | `club-scout.js`, `embedding.py`, `profiles.mjs` |
| Journées, équipe type, course de saison | Fermeture de journée, affectation exacte de postes, moyenne régularisée | `rounds.py` |
| Retours, révélations, valeurs d'action | Absences déduites des apparitions ; seuils de minutes/âge/rendement ; agrégats fournisseur | `returns.py`, `breakout.py`, `actions.py` |
| Classements dérivés | Points des résultats, égalités, sous-groupes de confrontations directes | Services de classements |

**Priorités :** P1 = correction prioritaire avant de considérer les sorties concernées comme fiables ; P2 = défaut conditionnel ou limité à un sous-modèle. Ces priorités ne sont pas une mesure de fréquence en production.

## 1. Duels : des réussites positives avec zéro tentative — P1

**Preuve : données réelles présentes dans une fixture du dépôt, normalisées par la fonction du projet.**

La requête de puissance calcule `duels_attempted = duels_won + duels_lost`. Si une composante est absente, SQL produit `NULL`. Ensuite, `restore_zeros` traite ce total dérivé comme une statistique brute dont le fournisseur aurait omis un zéro et le remplace par zéro.

Dans `backend/tests/fixtures/match_m_08LEIz/players.json`, le chemin normalisation → expression SQL reproduite → restauration donne :

| Joueur | Minutes | Duels gagnés | Duels perdus source | Tentatives après restauration |
|---|---:|---:|---|---:|
| Maxime Sivis | 90 | 5 | Absents | **0** |
| Maksim Borisko | 90 | 3 | Absents | **0** |
| Bogdan Ovsyannikov | 90 | 2 | Absents | **0** |
| Anton Lukashov | 8 | 4 | Absents | **0** |

L'espérance conditionnelle des réussites devient `tentatives × taux_du_rôle = 0`. Les réussites observées sont donc artificiellement considérées comme entièrement au-dessus de l'attente. Les mêmes lignes contaminent aussi le taux du rôle `Σ réussites / Σ tentatives`.

**Correction :** restaurer les primitives lorsqu'un zéro est justifié, puis calculer le dénominateur. Ajouter un invariant `0 ≤ réussites ≤ tentatives`. Un total dont une composante reste inconnue doit rester inconnu. Recalculer ensuite les références et les scores dépendants.

Sources : [expression et restauration](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L840-L895), [attente conditionnelle](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L1038-L1045).

## 2. Des buts hors penalty inconnus deviennent zéro — P1

**Preuve : exécution déterministe de `restore_zeros` avec la condition explicite du SQL.**

La requête laisse correctement les buts hors penalty à `NULL` quand les événements du match ne sont pas disponibles : connaître les buts totaux ne suffit pas à connaître les penalties. Mais `np_goals` figure ensuite dans les statistiques que la restauration remplace par zéro dès qu'un autre joueur de la compétition a un but hors penalty observé.

Un joueur avec **deux buts totaux connus et une ventilation penalty inconnue** reçoit alors **zéro but hors penalty**. Ce n'est pas une absence d'action, mais une absence d'information sur sa nature.

**Correction :** conserver la raison de l'absence, ou un masque de validité par mesure. Ne jamais restaurer une valeur volontairement mise à `NULL` parce qu'un prérequis manque. La fréquence de ce cas dans la base reste à mesurer.

Source : [condition de couverture et restauration des buts](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L844-L894).

## 3. Niveaux de championnat : l'estimation et son incertitude ne correspondent pas au MAP annoncé — P1

**Preuve : contre-exemple mathématique exécuté avec `level_pass` et `elo_updates`, puis relu indépendamment.**

Les niveaux de départ des ligues alimentent les Elo des clubs. Modifier ces niveaux modifie les probabilités du premier match, puis ses mises à jour Elo, puis les probabilités des matchs suivants. Le vrai gradient de la vraisemblance séquentielle doit propager cette dépendance.

Le code utilise pourtant, à chaque match, une sensibilité constante de +1/−1 au niveau initial. Les termes de gradient et d'information ne tiennent pas compte de la récurrence des Elo.

Exemple : deux équipes de deux ligues, niveaux initiaux 1500/1500, vingt matchs neutres ; A gagne les dix premiers, B les dix suivants.

| Quantité | Résultat |
|---|---:|
| Direction calculée par `level_pass` pour le niveau de A | **−0,009801789** |
| Dérivée numérique de la vraisemblance séquentielle réelle | **+0,002977604** |
| Information du code / information propageant les sensibilités | **2,37** |

Le signe est opposé. Le ratio 2,37 appartient à cet exemple seulement, avant ajustement commun de dispersion ; il ne mesure pas les erreurs de production.

**Portée exacte :** cette méthode pourrait être assumée comme une équation d'estimation ou un point fixe. Le contre-exemple ne prouve pas que tout classement obtenu serait inutile. Il réfute son interprétation comme gradient MAP/Newton et ne justifie pas les erreurs-types obtenues en inversant la matrice actuelle. Ces erreurs-types participent pourtant au statut « championnat mesuré » et au choix des références des joueurs.

**Correction :** expliciter l'objectif, propager les sensibilités des Elo ou utiliser une différentiation automatique, vérifier les dérivées par différences finies et calculer une covariance adaptée. Si l'heuristique est conservée, la nommer comme telle et valider son incertitude par une méthode appropriée.

Sources : [gradient et information](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L495-L518), [itérations et covariance](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L545-L641), [description MAP/Newton](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/docs/calculs/08-notes-vega/01-formules-et-raisons.md#L94-L113).

## 4. Les contributions historiques utilisées par le modèle de composition contiennent de l'information future — P1 pour la validation prédictive

**Preuve : références recalculées sur toute l'année et ancien match réévalué par les fonctions réelles.**

`refresh_players` apprend les attentes et dispersions sur l'ensemble de l'année du trophée puis recalcule les contributions de tous les anciens matchs. `lineup` lit ces contributions réécrites et les accumule chronologiquement. Ne pas ajouter la ligne du match courant avant sa prévision n'enlève pas l'information future déjà intégrée dans les contributions passées.

Dans le test, le match ancien reste identique : 90 minutes, 0,8 npxG et même écart de niveau adverse. L'ajout de rencontres ultérieures fait passer sa contribution de **1,78885 à 0,26726** et sa note de **61,49 à 51,51**, avec la **même référence finale de notation figée**.

Un recalcul rétrospectif est acceptable pour un classement descriptif. Ces valeurs ne peuvent cependant pas être utilisées comme si elles avaient été connues avant le match dans un backtest. Les niveaux initiaux des ligues, réestimés avec tout l'historique, demandent la même attention.

**Ce qui n'est pas établi :** les chiffres précis des validations publiées dans la documentation ne sont pas démontrés faux. Les scripts de ces expériences ne sont pas disponibles dans le checkout ; un autre protocole a pu être employé. La chaîne actuelle ne suffit toutefois pas à les reproduire sans fuite temporelle.

**Correction :** stocker des versions datées des caractéristiques et des modèles, ou refaire toute la chaîne d'apprentissage à chaque date de coupure. Réévaluer ensuite les compositions et leurs remplacements sur des matchs réellement ultérieurs.

Sources : [références et réévaluation](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L1321-L1366), [caractéristiques de composition](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/lineup.py#L59-L103), [lecture des contributions](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/lineup.py#L178-L202).

## 5. Des matchs peuvent disparaître de la saison simulée — P1/P2

**Preuves : fonctions `league_state` et `simulate` exécutées sur des calendriers contrôlés.**

La projection conserve les résultats `finished`, les rencontres `not_started`, et les matchs des journées encore ouvertes. Une fois la journée fermée :

- une rencontre toujours `postponed` ou `suspended` n'est plus ni un résultat ni une rencontre à jouer ;
- une rencontre `awarded`, même avec un score valide de 3–0, rapporte zéro point ;
- indépendamment du statut, le simulateur retire une rencontre si l'un des clubs n'a pas d'Elo.

Dans un test à deux clubs et un seul match restant, l'absence d'un Elo laisse **zéro point projeté aux deux équipes**, et leurs positions finales sont départagées aléatoirement. Le résultat continue à ressembler à une distribution valide de probabilités.

**Correction :** distinguer annulation définitive, résultat attribué et obligation de jouer ultérieurement. Ne pas supprimer un match pour manque de force estimée : utiliser un prior explicite avec incertitude, ou ne pas publier une projection complète. Vérifier que chaque match prévu est représenté exactement une fois.

Sources : [statuts](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L320-L341), [filtre de force](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L220-L235), [journées ouvertes](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/rounds.py#L372-L379).

## 6. La simulation de saison ne suit pas la même loi que la prévision de match — P2

Le pronostic de match corrige les petits scores par Dixon–Coles, via le paramètre `rho`. Le simulateur tire deux Poisson indépendantes et ne lit jamais ce paramètre.

Avec des intensités de 1,3 de chaque côté, `rho = −0,2` et aucune incertitude de force :

| Calcul | Probabilité de nul |
|---|---:|
| Pronostic de match corrigé | **31,412 %** |
| Loi sans correction | **26,391 %** |
| 100 000 simulations de saison | **26,484 %** |

Changer `rho` de −0,2 à zéro, à graine aléatoire identique, donne **exactement les mêmes simulations**. L'exemple amplifie le défaut ; il ne représente pas une estimation du biais actuellement déployé. Avec −0,03, valeur d'un modèle de test, l'écart théorique sur le nul est de 0,753 point.

**Correction :** tirer les scores depuis la même distribution jointe que celle du pronostic, puis vérifier que fréquences et espérances simulées convergent vers les quantités analytiques.

Sources : [pronostic](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L203-L208), [tirage des scores](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L236-L264).

## 7. Une projection censée attendre la fin de journée continue à changer avec ses résultats — P2

La passe quotidienne réajuste le modèle sur tous les matchs terminés et utilise les Elo les plus récents. Ensuite, les matchs terminés de la journée ouverte sont retirés du tableau de points et remis parmi les rencontres à simuler.

Le calcul utilise donc l'effet d'un résultat sur les forces tout en traitant le match correspondant comme non joué. Ce n'est ni une projection cohérente à la dernière journée close, ni une projection utilisant intégralement les résultats actuels.

**Correction :** conserver la projection publiée jusqu'à la fermeture de la journée, ou figer tous ses inputs à la même coupure. Mettre à jour les probabilités des matchs à venir peut rester un traitement distinct.

Sources : [appel quotidien](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/models.py#L794-L800), [réajustement et simulation](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L344-L373), [engagement documentaire](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/docs/calculs/06-accueil-et-matchs/05-journees.md).

## 8. Des données club inconnues fabriquent des statistiques extrêmes — P1

**Preuve : exécution du fichier `club-scout.js` complet, inchangé ; seuls les imports d'interface et réseau sont neutralisés.**

Le contrôle des valeurs manquantes arrive après certaines additions/soustractions. JavaScript a alors déjà converti `null` en zéro.

| Entrée manquante | Résultat calculé |
|---|---:|
| xGOT adverses inconnus, deux buts encaissés | **−2 buts évités** |
| Passes territoriales adverses inconnues | **100 % de field tilt** |
| Touches adverses dans la surface inconnues | **100 % de part des touches** |
| Duels adverses inconnus | **100 % de duels gagnés** |
| Duels aériens adverses inconnus | **100 % de part aérienne** |

Tacles présents mais interceptions/fautes absentes : le PPDA peut également être calculé malgré un dénominateur incomplet. Ces valeurs alimentent les centiles, phases et **indice descriptif du club**. Ce constat ne signifie pas que l'Elo de `power.py` lit ces indicateurs : les moteurs sont distincts.

**Correction :** contrôler chaque primitive avant l'arithmétique et garder la couverture de chaque indicateur dérivé. Ne pas déduire la couverture des duels, de la possession ou du gardien de la seule présence des xG.

Sources : [gardien](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-scout.js#L990-L997), [territoire et défense](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-scout.js#L1124-L1224), [propagation](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-scout.js#L1532-L1581).

## 9. Les écarts « réel − attendu » comparent des échantillons différents — P1

### Joueurs

Deux matchs de 90 minutes : premier match, 1 but et 1 xG ; deuxième, 4 buts et xG absent. Le calcul obtient **+4 buts par rapport aux xG**, ou **+1,5 par 90**, et le joueur reste éligible au classement « Efficaces ». Pourtant, sur l'unique match où les deux termes sont connus, l'écart vaut zéro.

Les buts et les xG utilisent leurs propres couvertures puis sont soustraits. La soustraction de deux taux sur des expositions différentes ne mesure pas le taux de finition sur un échantillon commun. Le problème est confirmé dans l'annuaire ; la route de l'accueil possède un filtre plus strict et ne doit pas être incluse dans ce constat.

### Clubs

Deux victoires, une seule avec xG : **6 points − 1,3457 xPts = +4,6543**. Sur l'échantillon comparable, le calcul correct est **3 − 1,3457 = +1,6543**. Une victoire dont les xG manquent ajoute artificiellement trois points de surperformance.

**Correction :** calculer chaque différence match par match sur l'intersection des observations, puis agréger ; utiliser les minutes correspondantes pour un par 90 et publier la couverture. Ce défaut club est déjà signalé dans `07-limites`, mais toujours présent.

Sources : [annuaire joueurs](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/api/src/routes/players.mjs#L310-L375), [cohortes clubs](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-scout.js#L1493-L1506).

## 10. Les xPts rétrospectifs violent la symétrie et peuvent baisser quand l'attaque s'améliore — P2

Le calcul JS des xPts arrête les Poisson à dix buts et affecte la masse manquante à la défaite par complément. Pour **6 xG contre 6 xG**, il renvoie **40,04 % de victoire contre 48,38 % de défaite**, alors que les distributions sont identiques. Les xPts valent **1,31698**, contre environ **1,44179** pour la loi complète.

Autre symptôme : face à 1 xG adverse, passer de 6 à 8 xG fait baisser les xPts calculés de **2,793 à 2,428**. L'impact est petit aux intensités usuelles modestes, mais la violation mathématique est nette à forte intensité.

Le plancher à 0,01 donne aussi 1,00985 xPts au lieu de 1 pour un match à 0 xG de chaque côté. C'est un choix annoncé, à distinguer du traitement incorrect de la queue de distribution.

**Correction :** calcul complet ou troncature adaptative avec traitement symétrique de la masse restante ; tests de symétrie et de monotonie. Ce défaut concerne **les xPts descriptifs club**, pas le moteur Python de prévision avant match.

Source : [Poisson et xPts JS](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-scout.js#L816-L835).

## 11. Les différentes routes n'utilisent pas toujours le même pronostic — P2

**Preuve : exécution des routes API réelles avec des réponses de lecture contrôlées, sans base.**

- Sans snapshot de composition, le point initial de la courbe de probabilités oublie la correction de forme conservée dans le pronostic avant match. Exemple : **67,54 % avant match contre 58,72 % à la minute zéro**.
- La courbe utilise les derniers coefficients, pas ceux du pronostic émis. Dans le même exemple, un réajustement des coefficients change la probabilité historique de **58,72 % à 67,21 %**, sans changement du match ni des Elo.
- Le pronostic corrigé des compositions est lu par la fiche match, mais les « cotes justes Vega » utilisent seulement le pronostic de base. Exemple contrôlé : **71,69 %** avec compositions contre **67,54 %** dans les cotes ; cote juste **1,48** au lieu d'environ **1,395**.

`1/p` est correct ; c'est le choix de `p` qui diverge. Le graphique historique est une reconstruction avec le modèle courant, pas un journal immuable des probabilités effectivement émises.

**Correction :** un même objet de pronostic versionné, avec date d'émission, modèle, forme, composition et intensités. Les routes et les validations doivent indiquer quelle version elles lisent ; conserver les pronostics antérieurs au coup d'envoi.

Sources : [match et cotes](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/api/src/routes/rankings.mjs#L280-L329), [courbe reconstruite](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/api/src/routes/rankings.mjs#L341-L380), [suppression des anciens pronostics/modèles](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L374-L407).

## 12. Compositions : la variable apprise diffère de celle utilisée en service — P2

Le rejeu d'entraînement exclut les matchs des sélections nationales. Les contributions courantes n'augmentent donc qu'avec les matchs des clubs. En service, les titulaires sont évalués avec les totaux `player_power`, qui comprennent aussi leurs performances internationales.

Le test garde le même onze et toutes les contributions club à zéro. Des contributions internationales présentes dans les totaux publiés donnent une déviation de **+0,8333** en service, contre **zéro dans la définition du rejeu**. Les fonctions d'agrégation de puissance confirment les totaux utilisés.

Il est légitime qu'une performance internationale renseigne le niveau d'un joueur. Le défaut est que **la variable d'entraînement, la référence habituelle et la variable de service n'ont pas la même définition**.

**Correction :** une seule construction des rendements, avec mêmes compétitions, mêmes minutes, même date de disponibilité et mêmes règles de rôle, utilisée dans l'apprentissage et en service.

Sources : [rejeu](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/lineup.py#L164-L202), [service](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/lineup.py#L267-L274), [sommes et écarts](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/lineup.py#L306-L346).

## 13. Des comparaisons sont produites sans observations suffisantes — P2

### Similarité des clubs

Zéro axe commun produit `100 − 0 / max(1, 0) = 100`. Dans le test, le club sans aucune donnée comparable est classé **100**, devant un club réellement comparable à **99** sur trois axes.

### Blocs des joueurs

`season_details` remplace un bloc absent par un total zéro avant de calculer les centiles. Deux ailiers, l'un avec une finition mesurée à −1, l'autre sans mesure de finition : le second obtient le **75e centile en finition**. Ce constat touche les blocs explicatifs, pas directement l'indice principal.

### Centile d'une performance

Le seuil de trente observations porte sur la cohorte globale. Une métrique connue chez un seul de ces pairs peut tout de même recevoir un centile : exemple exécuté, cent pairs mais un seul xG connu → **50e centile**.

### Embedding PCA

Deux profils entièrement inconnus, parmi 198 profils mesurés, sont imputés à la moyenne et deviennent identiques. Leur distance est zéro, la distance médiane aux autres positive, et la similarité vaut **100**. Le seuil de 450 minutes ne garantit pas une couverture statistique individuelle. Ce dernier point est un **défaut de contrôle de couverture**, pas une erreur arithmétique de PCA ; la présence de tels profils entièrement vides en production n'a pas été établie.

**Correction :** seuil de couverture individuelle et de support commun, taille minimale par métrique, propagation de l'inconnu. Une similarité doit décrire des observations suffisamment comparables.

Sources : [clubs](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-scout.js#L1715-L1747), [blocs](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L1090-L1107), [centiles par métrique](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/shared/player-profile.js#L208-L248), [imputation](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/embedding.py#L39-L60), [distance servie](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/api/src/routes/profiles.mjs#L524-L546).

## 14. Temps additionnel et prolongation : l'horloge de calcul est incohérente — P2

`remaining` sait distinguer 90 de 90+7, mais la trajectoire appelle toujours cette fonction avec un temps additionnel nul. Un événement à 45+3 entre au point 45 ; un but à 105 entre au point 90. Le modèle d'apprentissage accepte aussi les scores finaux et les buts de prolongation dans sa catégorie « après 90 ».

Exemple à 1–0, intensités initiales 1,6/1,1 et profil temporel des tests : à **90+7**, la probabilité de victoire calculée avec l'horloge utilisée par la trajectoire vaut **92,98 %**, contre **99,00 %** avec le temps restant correspondant à 90+7 dans le même modèle.

Le dernier point d'un match terminé est bien forcé au résultat certain par l'API : ce mécanisme n'est pas oublié dans ce constat. Le défaut concerne les probabilités avant la fin et l'attribution temporelle des événements.

Autre calcul, les minutes en tête, à égalité et mené au score utilisent `minute + minuteAdded / 100`, qui est une clé de tri et non une durée. Un but à 90+10 devient **90,1** minutes ; la durée de match est ensuite supposée au moins égale à 93.

**Correction :** une représentation du temps avec période, minute et temps additionnel ; séparer 90 minutes réglementaires, temps additionnel et prolongations ; ne pas transformer une clé d'ordre en durée.

Sources : [trajectoire Python](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/inplay.py#L112-L126), [trajectoire partagée](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/shared/inplay.js#L84-L98), [durées des états](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-game-states.js#L30-L77).

## 15. Autres défauts à corriger ou à mesurer

| Défaut | Effet et niveau de preuve | Correction proposée |
|---|---|---|
| Terrain neutre non symétrique | Avec les coefficients du test, deux Elo égaux donnent **34,81 % contre 38,52 %** selon l'étiquette. La même équipe forte gagne à **64,66 % ou 68,17 %** suivant le côté nominal. Exécution réelle, coefficients de production inconnus. | Paramétrisation symétrique en terrain neutre ; invariant d'échange des équipes. |
| Agrégats joueurs sans filtre de match terminé | Le SQL accepte encore des statistiques d'un match annulé/non final ; les agrégats équipes et la puissance l'excluent. Les compositions futures peuvent aussi augmenter les titularisations. **Constat statique**, non exécuté en PostgreSQL. | Même règle d'éligibilité dans agrégation, suppression des agrégats obsolètes et cohortes. |
| Mi-temps : `sum(coalesce(metric,0))` | Valeurs inconnues transformées sans condition en zéro et division par toutes les minutes. **Constat statique** ; certains vides sont effectivement des zéros, mais la couverture n'est pas vérifiée. | Couverture et minutes observées par mesure, comme pour les agrégats saison principaux. |
| Journée non amendée après un report | Huit matchs à l'heure, neuvième joué vingt jours plus tard : compteur toujours **8**, condition d'amendement fausse. Exécution de `round_state`. Cela ne prouve pas l'exclusion définitive de ce match des lectures cumulées. | Séparer les matchs utilisés pour fermer la journée de tous ceux utilisés pour compter ses résultats. |
| Qualité des tirs hors penalty | Le numérateur enlève les penalties, mais le dénominateur compte tous les tirs. Ajouter un penalty fait passer **1/10 à 1/11**, sans changer les tirs hors penalty. | Retirer les penalties des deux termes sur les mêmes observations. |
| Contre son camp dans les écarts club | Le score final attribue le bénéfice à la finition de l'adversaire ou la pénalité au gardien, sans xG/xGOT correspondant. Défaut déjà documenté, chemin toujours présent. | Harmoniser la convention des buts avec celle des xG et du fournisseur de buts évités. |
| Retour d'absence interrompu par une sélection | Après un vrai retour au club, une apparition en équipe nationale fait disparaître l'état : **3 matchs de retour, 60 min de moyenne → aucun retour**. La courbe s'interrompt aussi. | Distinguer club et sélection ; ne pas traiter une sélection comme un transfert. |

Sources : [terrain neutre](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L56-L86), [agrégats joueurs](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/calculator.py#L124-L174), [mi-temps](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/sql/084_half_totals_published.sql#L4-L15), [compteur des journées](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/rounds.py#L93-L109), [amendement](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/rounds.py#L302-L313), [tirs et écarts](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/dashboard/frontend/src/services/club-scout.js#L947-L1009), [retours](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/returns.py#L38-L100).

## 16. Risques de modèle et limites de validation

### xG Vega : extrapolation des tirs très lointains

Avec les coefficients de validation publiés dans la documentation, le modèle réel donne, pour un tir du pied dans l'axe : **0,968 % à 50 m, 6,337 % à 90 m, 19,365 % à 100 m et 33,709 % à 105 m**. Le terme quadratique positif de distance reprend le dessus. Le domaine de scoring accepte tout le terrain sans contrainte de monotonie.

**Ce sont les coefficients documentés, pas les coefficients actuellement déployés.** Le xG Vega est en outre un calcul parallèle : les agrégats principaux continuent de lire les xG fournisseur. Il faut vérifier la calibration par distance et situation, et contraindre l'extrapolation, par exemple par une transformation ou une spline monotone appropriée.

Sources : [modèle et domaine](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/xg.py#L25-L69), [coefficients documentés](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/docs/calculs/02-metriques-attendues/05-xg-vega.md).

### Cible réglementaire de 90 minutes non garantie

Le modèle choisit `coalesce(score_90, score_final)`. L'ingestion native ne remplit pas les colonnes de score à 90 minutes ; le writer explicite identifié se trouve dans les coupes supplémentaires, exclues du jeu d'apprentissage. Un match natif terminé après prolongation sans score réglementaire peut donc transformer un nul à 90 minutes en victoire d'entraînement. Le problème concerne aussi la cible du modèle de composition.

**Protection absente confirmée par le code ; incidence non mesurée.** Aucun vrai match de production répondant à cette condition n'a été interrogé. Il faut reconstruire le score réglementaire à partir de périodes fiables, ou exclure de l'apprentissage les cas non résolus.

Sources : [cible du modèle](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/forecast.py#L289-L304), [normalisation des scores](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/normalize.py#L225-L288).

### Choix normatifs du score joueur

Le poids du club, les enjeux des matchs, la combinaison du volume et du rendement, ainsi que les seuils de minutes sont des choix de définition. Aucun calcul ne rend universellement « vrai » un classement Ballon d'Or. Ils doivent être jugés par rapport à l'objectif explicite : récompense d'une saison, performance intrinsèque, projection future ou comparaison de rôles.

La formule de poids du club égalise des variances marginales. Elle n'attribue pas nécessairement exactement la moitié de la variance du score final au club, car `Var(C + κL) = Var(C) + κ²Var(L) + 2κCov(C,L)`. C'est une réserve d'interprétation et un besoin d'analyse de sensibilité, pas une preuve que le poids choisi serait incorrect.

Renormaliser sur les seuls blocs observés fait aussi varier les critères effectifs entre joueurs. Une comparaison doit qualifier cette couverture. Enfin, une transformation logistique d'un indice en note sur 100 n'est pas, à elle seule, une probabilité calibrée de performance future ; l'espérance Elo incluant un demi-nul n'est pas une probabilité pure de victoire.

Source : [poids, score et agrégation](https://github.com/VegaInteligence/Vega-Sport/blob/36049afb498b177cc6d92ebd1b7b2346a81b7639/backend/vega/power.py#L1128-L1251).

## 17. Vérifications satisfaisantes et documentation à actualiser

Dans les chemins inspectés, les éléments suivants suivent leur définition et passent les tests ciblés : Elo à niveaux de départ fixés et conservation des points ; récurrence de Poisson ; formule de Dixon–Coles et normalisation du pronostic de match ; log-loss et Brier ; mise à jour de la forme après la lecture du match ; logistique xG avec régularisation et recherche de pas ; principaux par 90 sur minutes couvertes ; précision des passes comme rapport de sommes ; centiles à égalités comptées pour moitié ; affectation exacte de l'équipe type ; réapplication des confrontations directes dans les sous-groupes de Nations League.

Les révélations sont essentiellement une règle de seuils sur le classement existant. Les valeurs VAEP/PV/xT sont collectées et agrégées, pas des valeurs d'action apprises par Vega. La compatibilité avec un club est une comparaison descriptive de profils ; elle ne démontre pas une prédiction de réussite après transfert.

La documentation est utile mais doit être synchronisée : certaines pages décrivent encore la note fournisseur et une moyenne simple, alors que le code actuel utilise un `gradeZ` pondéré par les minutes ; d'autres disent encore que les joueuses ou les ligues provisoires n'ont pas de rang, ou que le xA ne se classe pas. Ces passages périmés n'ont pas été comptés comme bugs supplémentaires.

Les tableaux de validation réelle décrits dans les documents n'ont pas été reproduits. Le dépôt contient des fonctions d'évaluation, mais pas le protocole complet et les instantanés nécessaires pour refaire ces tableaux à l'identique. Des tests fonctionnels sur données synthétiques, même nombreux, ne remplacent pas cette validation.

### Résultat des tests exécutés

| Suite | Réussis | Ignorés | Échecs finaux |
|---|---:|---:|---:|
| Suite Python complète, `unittest discover` | **175** | **135** | **0** |
| Suites JS ciblées et calculs API inplay/lineup | **33** | **2** | **0** |
| Total des tests existants distincts de ces deux exécutions | **208** | **137** | **0** |

Les 137 tests ignorés nécessitent des bases PostgreSQL locales dédiées, non provisionnées pour cet audit. Les constats SQL sont donc explicitement statiques. Une première tentative de la suite API a rencontré l'absence de la dépendance `pg` ; après `npm ci` dans `backend/api`, la même commande a abouti aux résultats ci-dessus. Ce n'était pas un échec de calcul.

Les reproductions adversariales annexées s'ajoutent à ces suites ; elles ne sont pas comptées comme nouveaux tests du dépôt. Les fonctions du projet sont appelées sans correction de leur implémentation. Aucun service réel n'est interrogé par les scripts.

## 18. Ordre de correction recommandé

1. **Sécuriser les observations et les agrégats.** Distinguer inconnu, zéro observé et zéro omis justifié ; réparer les dénominateurs de duels et les buts hors penalty ; harmoniser les statuts ; aligner les échantillons réel/attendu et les minutes couvertes. Mesurer les lignes affectées avant recalcul.
2. **Rendre les prévisions cohérentes.** Un même moteur de probabilités pour match, saison, composition et cotes ; aucun match supprimé silencieusement ; neutralité et traitement du temps ; snapshot complet à la fermeture d'une journée.
3. **Corriger l'estimation et rendre la validation temporelle reproductible.** Objectif de niveau des ligues explicite, gradient vérifié, covariance justifiée ; caractéristiques et modèles datés ; cibles à 90 minutes ; tests sur de vrais matchs futurs après une coupure stricte.
4. **Recalculer dans une copie et mesurer l'effet.** Comparer notes/rangs avant-après, plus gros déplacements et top 100, par poste, ligue, volume de minutes et couverture. Pour les probabilités : log-loss, Brier, calibration par compétition et tranche de probabilité, comparaison avec des baselines simples. Publier une nouvelle version seulement après ces mesures.

Le chantier prioritaire est la fiabilité des entrées et des définitions. Ajouter un modèle plus complexe maintenant conserverait ou amplifierait plusieurs de ces erreurs.

---

## Annexes — preuves reproductibles

Les scripts ci-dessous correspondent aux reproductions de cet audit. Ils sont indépendants de la base de production. Les valeurs calculées sont synthétiques sauf la fixture de duels, et les coefficients de xG explicitement repris de la documentation.

Pour rejouer les exemples, cloner le dépôt au commit indiqué, définir `VEGA_REPO` vers ce checkout et `PYTHONPATH` vers son dossier `backend`, puis enregistrer et lancer les scripts. Python 3.12 et Node 24 ont été utilisés ; les dépendances Python du dépôt ont été installées dans un environnement isolé. Le script JS des agrégats nécessite `--experimental-vm-modules` et neutralise uniquement les imports d'interface/réseau. Les routes API nécessitent les dépendances de `backend/api` (`npm ci --ignore-scripts`).

### A. Notes, niveaux et journées

Fichier : `reproduce_scores.py`. Exécution après configuration de `VEGA_REPO` et `PYTHONPATH` : `python reproduce_scores.py`.

```python
"""Read-only, deterministic reproductions against pinned Vega code.

Run: PYTHONPATH="$VEGA_REPO/backend" python reproduce_scores.py
No credentials, network, database writes, or tracked file edits.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from math import log
from pathlib import Path

from vega import power, rounds
from vega.normalize import normalize_family

REPO = Path(os.environ["VEGA_REPO"]).resolve()
result = {}

# Real checked-in input -> actual normalizer -> exactly the SQL duel expression
# from power.PLAYER_MATCHES -> actual zero-restoration function.
fixture = json.loads((REPO / 'backend/tests/fixtures/match_m_08LEIz/players.json').read_text())['data']
raw = normalize_family('players', fixture).rows['core.player_match_stats']
rows = []
for r in raw:
    if (r.get('minutes_played') or 0) <= 0:
        continue
    won, lost = r.get('duels_won'), r.get('duels_lost')
    rows.append(dict(r, match_id=1, competition_season_id=1,
                     measured=r.get('touches') is not None,
                     duels_attempted=None if won is None or lost is None else won + lost))
before = deepcopy(rows)
power.restore_zeros(rows)
names = {p['player']['id']: p['player']['name'] for p in fixture}
bad = [dict(player=names[r['player_id']], player_id=r['player_id'], minutes=r['minutes_played'],
            wins=r['duels_won'], attempts=r['duels_attempted'],
            lost_before=old.get('duels_lost'))
       for r, old in zip(rows, before)
       if (r.get('duels_won') or 0) > (r.get('duels_attempted') or 0)]
assert any(b['player'] == 'Maxime Sivis' and b['wins'] == 5 and b['attempts'] == 0 for b in bad)
result['duel_attempts_real_fixture'] = bad

# NULL here is an explicit UNKNOWN (events not available), not an omitted zero.
# The SQL CASE in PLAYER_MATCHES creates this NULL even if s.goals=2.
goal_rows = [dict(match_id=1, competition_season_id=1, measured=True, np_goals=1.0),
             dict(match_id=2, competition_season_id=1, measured=True, np_goals=None)]
power.restore_zeros(goal_rows)
assert goal_rows[1]['np_goals'] == 0
result['nonpenalty_goals_when_events_missing'] = {
    'source_total_goals': 2, 'event_coverage': 'unavailable',
    'np_goals_sql_before_restore': None, 'np_goals_after_restore': goal_rows[1]['np_goals'],
    'required_result': 'unknown until penalty attribution is known; not zero',
}

# The code describes level_pass's g as the likelihood gradient with respect to
# league entry seeds. Compare with the actual likelihood of elo_updates.
matches = [(i, 2025, None, 'A', 'B', int(i < 10), int(i >= 10), True) for i in range(20)]
leagues, index, seeds = {'A': 1, 'B': 2}, {1: 0, 2: 1}, {1: 1500, 2: 1500}
def loglik(seed_a):
    rows = list(power.elo_updates(matches, seeds={1: seed_a, 2: 1500}, leagues=leagues))[::2]
    return sum(r[7] * log(r[6]) + (1-r[7]) * log(1-r[6]) for r in rows)
lam, grad, phi = power.level_pass(matches, leagues, index, seeds, {})
numerical = (loglik(1500.001) - loglik(1499.999)) / 0.002
c, sensitivity, true_info = log(10)/400, 1.0, 0.0
for r in list(power.elo_updates(matches, seeds=seeds, leagues=leagues))[::2]:
    p = r[6]
    true_info += c*c*p*(1-p)*sensitivity*sensitivity
    sensitivity *= 1 - 2*power.ELO_K*c*p*(1-p)
assert grad[0] < 0 < numerical
result['league_seed_likelihood_gradient'] = dict(
    setting='20 neutral matches, A wins first 10 then B wins 10, entry seeds 1500/1500',
    code_gradient=grad[0], finite_difference_gradient=numerical,
    code_information=lam[0][0], chain_rule_information=true_info,
    information_overstatement_factor=lam[0][0]/true_info,
    note='Unscaled score/information before dividing by common dispersion phi.',
)

# Holding a match and its Elo context fixed does not hold its contribution or
# grade fixed: references() uses all rows of the season, including later matches.
def scoring_row(x):
    r = {spec[0]: None for specs in power.OUTFIELD_BLOCKS.values() for spec in specs}
    for specs in power.OUTFIELD_BLOCKS.values():
        for spec in specs:
            if spec[1] == 'conditional':
                r[spec[3]] = None
    return dict(r, role='centre_forward', minutes_played=90, delta=0, npxg=x)
past = [scoring_row(x) for x in [0.1, 0.3, 0.5, 0.7]*10]
future = [scoring_row(x) for x in [0.7, 0.9, 1.1, 1.3]*10]
target = scoring_row(0.8)
before_c = power.match_contribution(target, power.references(past))[1]
after_c = power.match_contribution(target, power.references(past + future))[1]
frozen_grade_refs = power.grade_references([('centre_forward', 1, 90, x/10)
                                         for x in range(-30,31)])
before_grade = power.score_of(power.match_index('centre_forward', 1, before_c, frozen_grade_refs))
after_grade = power.score_of(power.match_index('centre_forward', 1, after_c, frozen_grade_refs))
assert before_c > after_c and before_grade > after_grade
result['past_contribution_changes_with_future_rows'] = dict(
    fixed_match_npxg=0.8, fixed_minutes=90, fixed_opponent_delta=0,
    contribution_before=before_c, contribution_after_future_rows=after_c,
    grade_before=before_grade, grade_after_future_rows=after_grade,
    same_frozen_grade_reference=True,
    qualification='Retrospective descriptive refitting is permitted; do not treat the rewritten history as point-in-time prediction input.',
)

# Missing block observations are turned into 0 totals when taking percentiles.
detailed = {1: [('winger', 900, -1.0, 9, {'finishing': -1.0})],
            2: [('winger', 900, 1.0, 8, {'creation': 1.0})]}
scored = {i: {'role': 'winger', 'eligible': True} for i in detailed}
blocks, _ = power.season_details(detailed, scored)
assert 'finishing' not in blocks[2]['totals']
assert blocks[2]['percentiles']['finishing'] == 75
result['missing_block_percentile'] = dict(player=2, finishing_observed=False,
                                         finishing_percentile=blocks[2]['percentiles']['finishing'])

# A postponed match outside the +4-day window never changes the returned played
# count; refresh's 'played > before[1]' cannot mark this round amended.
t = datetime(2026, 10, 1, tzinfo=timezone.utc)
initial = [('finished', t + timedelta(hours=i)) for i in range(8)] + [('postponed', t + timedelta(days=20))]
late = [(('finished' if s == 'postponed' else s), k) for s, k in initial]
initial_state = rounds.round_state(initial, t + timedelta(days=8), t + timedelta(days=1))
late_state = rounds.round_state(late, t + timedelta(days=22), t + timedelta(days=21))
assert initial_state[1] == late_state[1] == 8
result['late_round_amendment'] = dict(initial_played=initial_state[1], actual_finished_later=9,
                                    returned_played_later=late_state[1],
                                    refresh_amendment_condition=late_state[1] > initial_state[1])

print(json.dumps(result, indent=2, ensure_ascii=False))
```

### B. Prévisions, calendrier et xG

Fichier : `reproduce_forecasts.py`. Exécution après configuration de `VEGA_REPO` et `PYTHONPATH` : `python reproduce_forecasts.py`.

```python
"""Read-only calculation audit of Vega-Sport 36049afb; no DB/network needed."""
import json
import os
import math
from pathlib import Path
import sys

REPO = Path(os.environ["VEGA_REPO"]).resolve()
sys.path.insert(0, str(REPO / 'backend'))
from vega import forecast, normalize, xg

out = {}
model = {'home': (math.log(1.3), 0.0), 'away': (math.log(1.3), 0.0), 'rho': -0.2, 'matches': 1000}
plain = dict(model, rho=0.0)
table = {1: (0, 0, 0, 0), 2: (0, 0, 0, 0)}
strengths = {1: 1500, 2: 1500}
projected = forecast.simulate(table, [(1, 2)], model, strengths, spread=0, simulations=100000, seed=53)
projected_plain = forecast.simulate(table, [(1, 2)], plain, strengths, spread=0, simulations=100000, seed=53)
f = forecast.forecast(model, 1500, 1500)
fp = forecast.forecast(plain, 1500, 1500)
out['rho_ignored_by_season_simulator'] = {
    'rho': model['rho'],
    'match_forecast': f,
    'plain_forecast': fp,
    'exactly_identical_season_outputs_with_rho_0_and_minus_0_2': projected == projected_plain,
    'simulated_mean_points_home': projected[1]['points'],
    'expected_points_from_corrected_match_forecast': 3*f['home']+f['draw'],
    'implied_simulated_draw_probability': 3-sum(v['points'] for v in projected.values()),
}
typical = dict(model, rho=-0.03)
out['rho_minus_0_03_draw_probability'] = forecast.forecast(typical,1500,1500)['draw']
test_model={'home':(.26,.93),'away':(.32,.91),'rho':-.03,'matches':1000}
out['neutral_side_label_asymmetry']={
    'equal_strengths':forecast.forecast(test_model,1700,1700,True),
    'stronger_nominal_home':forecast.forecast(test_model,1800,1600,True),
    'stronger_nominal_away':forecast.forecast(test_model,1600,1800,True),
    'note':'Model coefficients are from backend/tests/test_forecast.py, not fetched production weights.'
}

def row(match, home, away, status='not_started', hs=None, aws=None, neutral=False):
    return (match, 10, home, away, neutral, status, hs, aws, True, True)

rows = [row(i+1, 2*i+1, 2*i+2) for i in range(4)]
postponed = row(20, 1, 3, 'postponed')
awarded = row(21, 2, 4, 'awarded', 3, 0)
closed_table, closed_games = forecast.league_state(rows + [postponed, awarded])[10]
open_table, open_games = forecast.league_state(rows + [postponed, awarded], held={20, 21})[10]
out['non_finished_statuses_disappear_after_round_closure'] = {
    'all_rows': len(rows)+2,
    'closed_round_remaining_fixtures': closed_games,
    'closed_round_awarded_winner_table': closed_table[2],
    'open_round_remaining_fixtures': open_games,
    'postponed_fixture_is_lost_when_round_closes': (1, 3) in open_games and (1, 3) not in closed_games,
    'awarded_fixture_has_neither_points_nor_pending_game': closed_table[2][0] == 0 and (2, 4) not in closed_games,
}

missing = forecast.simulate(table, [(1, 2)], model, {1:1500}, spread=0, simulations=1000, seed=53)
out['fixture_without_elo_silently_omitted'] = missing

raw = {'id':'m_000001', 'home_team': {'id':'t_000001', 'name':'Home'},
       'away_team':{'id':'t_000002','name':'Away'}, 'status':'finished',
       'score_home':2, 'score_away':1, 'score_home_90':1, 'score_away_90':1}
normalized = normalize.NormalizedFamily()
normalize._match(normalized, raw)
match = normalized.rows['core.matches'][0]
out['no_regular_time_score_ingested_from_pitchapi'] = {
    'synthetic_input_final_score': [2,1],
    'synthetic_input_optional_90_min_score': [1,1],
    'stored_score': [match['home_score'],match['away_score']],
    'stored_home_score_90': match.get('home_score_90'),
    'unknown_paths': sorted(normalized.unknown_paths),
    'note': 'score_home_90 is a synthetic hypothetical field, not a claim about provider schema; no such field is recognized by the ingestion code.',
}

# Exactly the validation-model coefficients documented in docs/calculs/.../05-xg-vega.md.
# These are not claimed to be the current production DB coefficients.
coef = [-1.375,1.027,-0.167,0.155,1.467,0.114,-0.177,-0.706,-0.414,0.510,0.608,-0.478,-0.377,-1.374]
probabilities = {}
for d in [11,20,30,40,50,60,70,80,90,100,105]:
    angle = math.atan2(xg.GOAL_WIDTH*d,d*d-(xg.GOAL_WIDTH/2)**2)
    probabilities[d] = xg.probability(coef,xg.features('regular_play','right_foot',d,angle))
out['documented_xg_quadratic_distance_extrapolation'] = probabilities

path=Path(__file__).with_name('reproduction.json')
path.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(out,indent=2,ensure_ascii=False))
```

### C. Horloge, compositions, retours et similarités

Fichier : `reproduce_models.py`. Exécution après configuration de `VEGA_REPO` et `PYTHONPATH` : `python reproduce_models.py`.

```python
"""Read-only counterexamples against Vega-Sport commit 36049afb.

Run: PYTHONPATH="$VEGA_REPO/backend" python reproduce_models.py
No database access, no monkey-patching, no repository modifications.
"""
import json
import math
import statistics
from datetime import date, timedelta

from vega import embedding, inplay, lineup, returns

out = {}
model = {"profile": [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], "down": 0.6, "up": 1.7}
wrong = inplay.outcome(1.6, 1.1, inplay.remaining(model["profile"], 90, 0), 1, 0, 0, 0, model, -0.03)
right = inplay.outcome(1.6, 1.1, inplay.remaining(model["profile"], 90, 7), 1, 0, 0, 0, model, -0.03)
extra = inplay.match_events([(105, 0, "goal", 1)], 1, 1, 0)
out["inplay_clock"] = {
    "at_90_plus_7_using_active_timeline": wrong,
    "at_90_plus_7_using_actual_remaining": right,
    "extra_time_goal_accepted_as_match_timeline": extra,
    "score_shown_at_90_for_goal_at_105": inplay.timeline(1.6, 1.1, extra, model)[90][-2:],
    "score_at_45_for_goal_at_45_plus_3": inplay.timeline(1.6, 1.1, [(45, 3, "goal", "home")], model)[45][-2:],
}

# Six club fixtures; one international appearance belongs to the same published
# player totals but is not among lineup.MATCHES (which excludes national teams).
matches = [(f"club{i}", 1, 2, 0.0, 0, 0) for i in range(6)]
appearances, starters = {}, {}
for mid, *_ in matches:
    appearances[mid] = []
    for team in (1, 2):
        ids = [team * 100 + k for k in range(11)]
        starters[(mid, team)] = ids
        appearances[mid] += [(p, "goalkeeper" if k == 10 else "centre_forward", 90, 0.0) for k, p in enumerate(ids)]
appearances["national"] = [(100 + k, "centre_forward", 90, 1.0) for k in range(10)]
rows, training_totals, usuals = lineup.deviations(matches, appearances, starters, {})
serving_starters = [(1, "centre_forward", 1.0, 630) for _ in range(10)] + [(1, "goalkeeper", 0.0, 540)]
serving = lineup.side_sums(serving_starters)[1]
out["lineup_international_scope"] = {
    "replay_kept_deviation": rows[-1][1],
    "replay_own_total_for_player_100": training_totals[100][0],
    "serving_own_total_for_same_player_including_international": 1.0,
    "usual_club_lineup_rate": usuals[1][1] / usuals[1][0],
    "serving_lineup_rate": serving,
    "serving_deviation_same_eleven": serving - usuals[1][1] / usuals[1][0],
}

start = date(2026, 1, 3)
weeks = [start + timedelta(days=7 * k) for k in range(40)]
team_dates = {1: weeks}
club_only = [(weeks[k], 1, 90) for k in range(8)] + [(weeks[14], 1, 30), (weeks[15], 1, 60)]
with_national = sorted(club_only + [(weeks[10], 999, 90)])
out["returns_national_break"] = {
    "club_absences_without_international_row": returns.returns_of(club_only, team_dates),
    "club_absences_with_intervening_international_row": returns.returns_of(with_national, team_dates),
}
after_return = club_only + [(weeks[17], 1, 90)]
national_after_return = sorted(after_return + [(weeks[16], 999, 90)])
out["returns_national_break"]["current_without_national_after_return"] = returns.current(after_return, team_dates, weeks[18])
out["returns_national_break"]["current_with_national_after_return"] = returns.current(national_after_return, team_dates, weeks[18])

# Both unknown profiles satisfy the outer SQL's minutes requirement; minutes
# are an eligibility field, not one of the profile variables below.
known = [[math.sin(i * (j + 1) * 0.271) + 0.25 * math.cos(i * 0.713 + j) for j in range(12)] for i in range(198)]
vectors, variance, kept = embedding.embed(known + [[None] * 12, [None] * 12])
unknown_distance = embedding.distance(vectors[-1], vectors[-2])
median = statistics.median(embedding.distance(vectors[-1], p) for p in vectors[:-1])
out["embedding_missing_profiles"] = {
    "players": len(vectors), "dimensions": len(vectors[0]), "variance_kept": variance,
    "observed_metrics_for_each_of_last_two_players": 0,
    "distance_between_unknown_profiles": unknown_distance,
    "median_distance_from_unknown_player": median,
    "api_similarity": max(0, round(100 * (1 - unknown_distance / median))) if median > 0 else 0,
}

print(json.dumps(out, indent=2, default=str))
```

### D. Cohérence des routes de prévision

Fichier : `reproduce_routes.mjs`. Exécution après configuration de `VEGA_REPO` et `PYTHONPATH` : `node reproduce_routes.mjs`.

```javascript
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT=path.resolve(process.env.VEGA_REPO);
const {createRankingRoute}=await import(pathToFileURL(path.join(ROOT,'backend/api/src/routes/rankings.mjs')));
const {rates,outcome}=await import(pathToFileURL(path.join(ROOT,'dashboard/shared/inplay.js')));

// Exercise the actual API routes with a read-only in-memory row provider.
// This verifies route arithmetic/version selection, not PostgreSQL execution.
const coefficients={id:1,home_base:.26,home_slope:.93,away_base:.32,away_slope:.91,rho:-.03};
const initial={...coefficients};
const whole={down:1,up:1};
function stored(eh,ea) {
  const [hg,ag]=rates(initial,eh,ea);
  const [home_win,draw,away_win]=outcome(hg,ag,1,0,0,0,0,whole,initial.rho);
  return {home_win,draw,away_win,home_goals:hg,away_goals:ag,likely_home:1,likely_away:1};
}
const plain={...stored(1660,1500),home_elo:1600,away_elo:1500,home_form:60,away_form:0,model_id:1};
const adjusted={...stored(1690,1500),home_strength:1660,away_strength:1500,home_shift:30,away_shift:0,home_deviation:0.6,away_deviation:0};
let withLineups=false;
const read=async (sql)=>{
  if(sql.includes('FROM api.match_lineup_forecasts')) return withLineups?[adjusted]:[];
  if(sql.includes('FROM api.match_forecasts')) return [plain];
  if(sql.includes('FROM api.forecast_models')) return [coefficients];
  if(sql.includes('FROM api.match_strengths')) return [{match_key:1,season_id:2026,status:'not_started',neutral:false,home_elo:1600,away_elo:1500,home_score:null,away_score:null}];
  if(sql.includes('FROM api.inplay_models')) return [{version:'fixture',q1:.13,q2:.14,q3:.18,q4:.16,q5:.16,q6:.16,after_90:.07,down:.6,up:1.7,ahead:1,behind:1}];
  if(sql.includes('FROM api.match_inplay_events')||sql.includes('FROM api.match_clocks')) return [];
  if(sql.includes('FROM api.match_odds')) return [{bookmaker:'test',title:'Fixture only',home:2,draw:3,away:4,first_home:2,first_draw:3,first_away:4,overround:13/12,home_chance:6/13,draw_chance:4/13,away_chance:3/13}];
  throw new Error('Unexpected read: '+sql);
};
const route=createRankingRoute(read);
async function get(path){
  const params=new URLSearchParams({match:'m_000001'});
  return (await route(new Request('http://audit'+path+'?'+params),path,params)).json();
}
const before=await get('/api/forecasts/match');
const live=await get('/api/forecasts/live');
assert.notEqual(before.forecast.home,live.points[0].home);
coefficients.home_base+=.2; coefficients.id=2;
const later=await get('/api/forecasts/live');
assert.notEqual(live.points[0].home,later.points[0].home);
Object.assign(coefficients,initial);
withLineups=true;
const match=await get('/api/forecasts/match');
const odds=await get('/api/forecasts/odds');
assert.notEqual(match.lineups.forecast.home,odds.vega.home);
console.log(JSON.stringify({
  live_omits_persisted_form:{before_match_home:before.forecast.home,live_minute_zero_home:live.points[0].home,stored_form_elo:60},
  history_changes_when_latest_coefficients_change:{original_minute_zero_home:live.points[0].home,after_refit_minute_zero_home:later.points[0].home,unchanged_match_strengths:true},
  odds_ignore_confirmed_lineups:{match_lineup_home:match.lineups.forecast.home,vega_odds_home:odds.vega.home,returned_fair_home:odds.vega.fair.home,consistent_fair_home:1/match.lineups.forecast.home}
},null,2));
```

### E. Agrégats, xPts et comparaisons

Fichier : `reproduce_aggregation.mjs`. Exécution après configuration de `VEGA_REPO` et `PYTHONPATH` : `node --experimental-vm-modules reproduce_aggregation.mjs`.

```javascript
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const ROOT=path.resolve(process.env.VEGA_REPO);
const dir=path.join(ROOT,'dashboard/frontend/src/services');
// Execute the complete, unchanged source. Only UI/network imports are inert stubs.
const stubs={
 'react':{useEffect:()=>{},useMemo:()=>{},useState:()=>{}},
 '../hooks/FootballContext.jsx':{useFootball:()=>{}},
 './compact-reads.js':{compactGeneration:()=>{},compactScope:()=>{},readCompact:()=>{},readCompactPages:()=>{},supportsCompactRead:()=>{}},
 './public-api-fetch.js':{publicApiFetch:()=>{}},
};
const scout=new vm.SourceTextModule(fs.readFileSync(path.join(dir,'club-scout.js'),'utf8'),{identifier:path.join(dir,'club-scout.js')});
await scout.link(async(specifier)=>{
 const values=stubs[specifier]??await import(pathToFileURL(path.resolve(dir,specifier)));
 return new vm.SyntheticModule(Object.keys(values),function(){for(const k of Object.keys(values))this.setExport(k,values[k]);});
});
await scout.evaluate();
const {METRICS,outcomeChances,teamRows,rebase,similarClubs}=scout.namespace;
const result={commit:'36049afb498b177cc6d92ebd1b7b2346a81b7639'};

const row={gf:1,ga:2,points:0,own:{xg:1,xgot:1,oppHalfPasses:100,touchesBox:10,tackles:10,interceptions:null,fouls:null,possession:50,duels:20,aerials:8},opp:{xg:1,xgot:null,oppHalfPasses:null,touchesBox:null,ownHalfPasses:200,duels:null,aerials:null}};
result.missingMetrics=Object.fromEntries(['keeper','fieldTilt','boxShare','ppda','defActions','duels','aerials'].map(k=>[k,METRICS[k].get([row])]));
assert.equal(result.missingMetrics.keeper,-2);
assert.equal(result.missingMetrics.fieldTilt,100);
assert.equal(result.missingMetrics.boxShare,100);
assert.equal(result.missingMetrics.ppda,20);
assert.equal(result.missingMetrics.defActions,10);
assert.equal(result.missingMetrics.duels,100);
assert.equal(result.missingMetrics.aerials,100);

result.poisson=Object.fromEntries([0,2,4,5,6,8,10,15,20].map(x=>[x,outcomeChances(x,x)]));
assert.ok(result.poisson[6].loss-result.poisson[6].win>0.08);
result.poissonDominant=Object.fromEntries([5,6,8].map(x=>[x,outcomeChances(x,1)]));
const ownClub={id:'a',centiles:{xg:80,xga:80,passAccuracy:80}};
const emptyClub={id:'b',centiles:{}};
const measuredClub={id:'c',centiles:{xg:79,xga:79,passAccuracy:79}};
result.clubSimilarity=similarClubs({self:ownClub,clubs:[ownClub,emptyClub,measuredClub]}).map(r=>({id:r.club.id,similarity:r.similarity,commonAxes:r.parts.length}));
assert.equal(result.clubSimilarity[0].id,'b');
assert.equal(result.clubSimilarity[0].similarity,100);
assert.equal(result.clubSimilarity[0].commonAxes,0);
result.penaltyQuality={before:METRICS.xgPerShot.get([{...row,own:{xg:1,npxg:1,shots:10}}]),afterAddingPenalty:METRICS.xgPerShot.get([{...row,own:{xg:1.78,npxg:1,shots:11}}])};
assert.ok(result.penaltyQuality.before>result.penaltyQuality.afterAddingPenalty);

const mk=(id,gf,ga,xg,passes=100)=>({id,status:'finished',home:{id:'a',name:'A',score:gf},away:{id:'b',name:'B',score:ga},date:'2026-01-01',stats:[{key:'expected_goals',home:xg,away:xg},{key:'accurate_passes',home:passes,away:passes},{key:'total_passes',home:passes,away:passes}]});
const samples=teamRows([mk('m1',1,0,1),mk('m2',4,0,null)],'a');
result.coverage={matches:samples.length,totalPoints:samples.reduce((s,r)=>s+r.points,0),xpts:samples.reduce((s,r)=>s+(r.xpts??0),0),pairedPoints:samples.filter(r=>r.xpts!==null).reduce((s,r)=>s+r.points,0)};
result.coverage.unpairedGap=result.coverage.totalPoints-result.coverage.xpts;
result.coverage.pairedGap=result.coverage.pairedPoints-result.coverage.xpts;

const {aggregateSeason,seasonMetric}=await import(pathToFileURL(path.join(dir,'season-player.js')));
const {rankSeasonPlayers}=await import(pathToFileURL(path.join(dir,'player-leaderboard.js')));
const appear=(matchId,goals,xg)=>({matchId,playerId:'p1',name:'P1',minutes:90,goals,xg});
const p=aggregateSeason([appear('m1',1,1),appear('m2',4,null)],'p1');
result.finishing={totalGoals:seasonMetric(p,'goals').value,totalXg:seasonMetric(p,'xg').value,deltaTotal:seasonMetric(p,'goals').value-seasonMetric(p,'xg').value,deltaPer90:seasonMetric(p,'goals','per90').value-seasonMetric(p,'xg','per90').value,pairedDelta:0};
result.finishing.eligible=rankSeasonPlayers([{name:'P1',playerId:'p1',goals:result.finishing.totalGoals,xg:result.finishing.totalXg,profile:p}],'clinical').length===1;
assert.equal(result.finishing.deltaTotal,4);
assert.equal(result.finishing.deltaPer90,1.5);
assert.equal(result.finishing.eligible,true);

const {performanceProfileFromCounts}=await import(pathToFileURL(path.join(ROOT,'dashboard/shared/player-profile.js')));
const prof=performanceProfileFromCounts({positionId:91,minutes:90,xg:2,shots:3},{peers:100,metrics:{xg:{known:1,below:0,equal:1},shots:{known:100,below:50,equal:1}}});
result.sparsePercentile=prof.sections.flatMap(s=>s.metrics).find(m=>m.key==='xg');
assert.equal(result.sparsePercentile.percentile,50);

const {gameStates}=await import(pathToFileURL(path.join(dir,'club-game-states.js')));
const game=(extra)=>({gf:1,ga:0,points:3,result:'V',match:{shots:[{isGoal:true,teamId:'a',minute:90,minuteAdded:extra,period:'second_half'}]}});
result.addedTime={goal90:gameStates([game(0)],'a').minutes,goal90plus10:gameStates([game(10)],'a').minutes};
assert.ok(result.addedTime.goal90plus10.lead>2.89);
console.log(JSON.stringify(result,null,2));
```

### F. Commandes des suites existantes

Depuis la racine du checkout :

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
node --test tests/season_player.test.mjs tests/season-shots.test.mjs tests/club-halves.test.mjs tests/player-overview-radar.test.mjs tests/competition-standings.test.mjs tests/halves-and-passing.test.mjs backend/api/test/inplay.test.mjs backend/api/test/lineup.test.mjs
```

L'environnement de l'audit ne provisionne pas les bases de test : les ignorés signalés plus haut sont attendus. Les annexes reproduisent les défauts sur le commit audité ; plusieurs assertions vérifient volontairement le comportement incorrect actuel. Elles devront donc être inversées ou remplacées par les invariants corrigés après réparation.
