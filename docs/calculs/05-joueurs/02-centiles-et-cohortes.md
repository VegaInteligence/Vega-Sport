# Centiles joueurs et cohortes

Il y a deux comparaisons distinctes : celle d'**une performance** (un match) et celle d'**une saison**.

## Formule du centile (les deux cas)

`percentile` dans [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L199), centile « rang moyen » :

$$
\text{centile} = \operatorname{arrondi}\left(100 \times \frac{\#\{v < x\} + \tfrac{1}{2}\,\#\{v = x\}}{n}\right)
$$

`n` : nombre de valeurs connues dans la cohorte. Les égalités comptent pour moitié. Côté serveur, la base renvoie directement les compteurs `below`, `equal`, `known` et le même calcul est appliqué (`performanceProfileFromCounts`).

Couleur d'un centile (`tone`, [PlayerScoutCharts.jsx](../../../dashboard/frontend/src/components/PlayerScoutCharts.jsx#L23)) : ≥ 80 très bon, ≥ 60 bon, ≥ 40 moyen, ≥ 20 faible, < 20 très faible.

## 1. Profil d'une performance (un match)

Code : `performanceProfile` ([player-profile.js](../../../dashboard/frontend/src/services/player-profile.js#L109)) et la route `/api/read/performance` ([performance.mjs](../../../backend/api/src/routes/performance.mjs)).

| Règle | Valeur |
| --- | --- |
| Cohorte | toutes les **performances** de la saison et des compétitions sélectionnées, du même groupe de poste |
| Minutes minimum d'une performance pour entrer dans la cohorte | **30** (`MIN_PEER_MINUTES`) |
| Taille minimum de la cohorte | **30** performances (`MIN_PEERS`) |
| Valeurs comparées | valeurs **brutes du match** (pas par 90) |
| Groupe F (poste inconnu) | comparé à toutes les performances de joueurs de champ (D, M, O et F) |
| Mesures non classées | buts, passes décisives, xA |

La cohorte compte des **performances**, pas des joueurs : un joueur régulier y figure autant de fois qu'il a joué au moins 30 minutes.

Valeurs dérivées :
- **Précision des passes** : seulement si au moins **10** passes tentées dans le match ;
- **Duels gagnés %** : seulement si au moins **4** duels ;
- **xG et tirs cadrés** : 0 si le joueur n'a pas tiré.

Une valeur absente apparaît dans la liste « non renseigné », sauf un taux écarté pour petit échantillon (ce n'est pas un manque de la source).

Sections par groupe : finition (xG, tirs, tirs cadrés, ballons dans la surface), création (occasions créées, passes dans le dernier tiers, dribbles), passe (ballons touchés, passes réussies, précision), défense (duels gagnés, duels %, tacles, interceptions, récupérations, dégagements, tirs bloqués), gardien (arrêts, buts évités).

## 2. Saison

Code : `buildCohorts`, `rankMetric` dans [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L181).

| Règle | Valeur |
| --- | --- |
| Cohorte | joueurs de la saison et des compétitions sélectionnées, du même groupe (G, D, M, O) |
| Minutes minimum | **450** par défaut ; 900, 1 350 ou 1 800 au choix dans l'analyse avancée (la vue d'ensemble reste à 450) |
| Taille minimum | **30** joueurs ayant une valeur (`MIN_SEASON_PEERS`) |
| Valeurs comparées | **par 90 minutes** (taux en %) |
| Couverture exigée | la mesure doit être observée sur **tous les matchs joués** (`count = matches` et `minutes = minutes totales`), pour le joueur comme pour chaque pair |
| Mesure non classée | xA |
| Option « niveau comparable » | la cohorte est réduite aux joueurs des 30 clubs de niveau le plus proche (voir [Référentiels](../04-clubs/03-referentiels-et-niveau-europeen.md)) |

La règle de couverture évite de comparer un par 90 calculé sur 3 matchs avec un par 90 calculé sur 30.

Mesure « moins = mieux » (duels perdus) : centile affiché = `100 − centile` (`advancedMetric`, [PlayerAdvancedStats.jsx](../../../dashboard/frontend/src/components/PlayerAdvancedStats.jsx#L50)).

### Rang et distribution

- **Rang** = `1 + nombre de pairs strictement meilleurs`, sur le nombre de pairs classés.
- **Médiane** de la cohorte, et quantiles 10 / 25 / 50 / 75 / 90 % par interpolation linéaire.
- La fenêtre « classement complet » d'un indicateur liste tous les pairs éligibles par 90.

### Exemple

Un milieu joue 1 600 minutes avec 6,1 récupérations par 90. Dans sa cohorte, 210 milieux à 450 minutes ou plus ont une valeur de récupérations couvrant tous leurs matchs ; 150 ont une valeur strictement plus basse, 4 la même (lui compris), 56 une valeur plus haute → `(150 + 4/2) / 210 = 72,4` → **P72**, rang `1 + 56 = 57e` sur 210.

## Pourquoi un centile peut manquer

- moins de 450 minutes (ou du seuil choisi) ;
- une mesure absente sur au moins un match joué ;
- moins de 30 pairs comparables ;
- mesure non classable (xA) ;
- joueur sans poste connu (aucun groupe saison).
