# Fiche de match

## Statistiques d'équipe

Valeurs PitchAPI, ordonnées en sections (possession, tirs, buts attendus, duels, passes, défense, discipline) par [match-data.js](../../../dashboard/frontend/src/services/match-data.js). Aucun calcul, sauf :
- les décimales : 2 pour les clés `expected_goals*`, 0 sinon ;
- le pourcentage affiché entre parenthèses, repris du texte fournisseur (`"508 (87%)"` → 87 %).

## Courbe des xG cumulés

`xgTimeline` ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L220)) et le graphique de [Charts.jsx](../../../dashboard/frontend/src/components/Charts.jsx#L280) :
- les tirs sont triés par minute ; chaque tir avec un xG ajoute un palier à la courbe de son équipe ;
- un **contre son camp n'ajoute aucun xG** mais compte comme but pour l'autre équipe ;
- chaque but est placé sur la courbe à la hauteur du xG cumulé de l'équipe qui marque ;
- la courbe se prolonge jusqu'à `max(90, minute du dernier tir)` ;
- **contrôle de cohérence** : si la somme des xG des tirs d'une équipe s'écarte de plus de **0,02** de sa statistique d'équipe `expected_goals`, la page le signale (tirs manquants ou arrondis différents).

## Carte des tirs

`shotMapPoints` ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L293)) place les deux équipes sur un même terrain 105 × 68 :
- l'équipe à domicile attaque vers la gauche : `(x, y) → (105 − x, 68 − y)` ; l'extérieur garde ses coordonnées ;
- la fin de trajectoire est le point du contre (`blockedX`, `blockedY`) pour un tir contré, sinon le point de passage de la ligne de but (`goalCrossedY`) ;
- la hauteur du tir à la ligne de but (`goalCrossedZ`) est donnée pour les tirs non contrés ;
- un tir sans xG est dessiné avec xG 0 ; les contre son camp ne sont pas dessinés.

Résultat d'un tir (`shotOutcome`) : contre son camp, but, poteau, contré, arrêté (cadré ou `AttemptSaved`), non cadré.

Sur la carte de saison d'un joueur ([season-shots.js](../../../dashboard/frontend/src/services/season-shots.js#L13)), la **distance au but** `√((longueur − x)² + (largeur / 2 − y)²)` n'est calculée que si le repère est vérifié (`coordinateFrame = acting_ltr`, l'équipe attaque de gauche à droite) ; sinon la position est marquée approximative.

## Contexte avant le match

[MatchContext.jsx](../../../dashboard/frontend/src/components/MatchContext.jsx) compare les deux équipes **uniquement sur les matchs joués avant le coup d'envoi** (`clubSummary` avec `before = match`, comparaison au coup d'envoi UTC, sinon à la date) :
- forme et bilan ;
- par match : points, buts marqués, buts encaissés, xG pour, xG contre, tirs, possession moyenne (deux moyennes de saison ne forment pas une barre partagée) ;
- confrontations directes de la saison antérieures au match : victoires de chaque club et nuls ;
- les 5 joueurs les plus utilisés de chaque club.

### La phrase des confrontations

Sous le bilan des confrontations, une phrase dit la série en cours quand elle compte au moins trois matchs de suite, du plus récent au plus ancien (`services/head-to-head.js`) : une série de victoires d'un club (« reste sur 3 victoires de suite »), une série de nuls, sinon la plus longue série sans victoire d'un des deux clubs (« n'a plus battu … depuis 4 confrontations », ou « dans aucune des N confrontations collectées » quand la série couvre tout ce que la base détient). Deux résultats ne font pas une phrase.

## Temps forts du momentum

Sous le graphique du momentum (la pression minute par minute que publie la source, positive pour le club à domicile), la fiche nomme les trois périodes de cinq minutes de suite où un club a le plus pressé (`services/momentum.js`) : la somme de la pression sur cinq minutes consécutives toutes mesurées, la plus forte d'abord en valeur absolue, sans chevauchement entre deux périodes. Un match de moins de trente minutes mesurées n'en a pas.

## Profil d'un joueur dans le match

Centiles de la performance par rapport aux performances du même poste dans la saison, et rang de sa note parmi les joueurs du match : voir [Centiles et cohortes](../05-joueurs/02-centiles-et-cohortes.md) et [Note du match](../02-metriques-attendues/04-note-du-match.md).

## Discipline d'un joueur

`summarizeDiscipline` ([shared/player-discipline.js](../../../dashboard/shared/player-discipline.js)) lit les feuilles d'événements :
- **jaunes** : événements `YellowCard` ;
- **deuxièmes jaunes** : `SecondYellow` ;
- **rouges directs** : `RedCard` **sans** `SecondYellow` à la même minute, même minute ajoutée et même période (un rouge sur deux jaunes n'est pas compté deux fois) ;
- un événement de même identifiant n'est compté qu'une fois ;
- `covered / total` indique sur combien de matchs la feuille d'événements était disponible.
