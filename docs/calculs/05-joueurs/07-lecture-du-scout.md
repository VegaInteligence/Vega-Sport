# Carte « Lecture du scout »

`ScoutReading` dans [PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L324), dernière carte de la rangée « Points forts · Points faibles · Lecture du scout » de la vue d'ensemble du profil joueur.

La carte **ne calcule rien de nouveau** : elle met en phrases des chiffres déjà calculés pour les cartes voisines. Elle affiche au plus quatre phrases, et chacune disparaît quand sa donnée manque. S'il n'en reste aucune : « Pas assez de données classées. » Tant que les joueurs du même poste ne sont pas chargés, la carte affiche « Chargement des joueurs du même poste… ».

## Cohorte et période

Toutes les phrases portent sur le même joueur et la même cohorte que le reste de la vue d'ensemble ([PlayerSeasonProfile.jsx](../../../dashboard/frontend/src/components/PlayerSeasonProfile.jsx#L392)) :

| Élément | Valeur |
| --- | --- |
| Joueur | toute la période et toutes les compétitions sélectionnées dans les filtres du profil ; le sélecteur de compétition du bloc « Saison » ne s'applique pas ici |
| Cohorte | joueurs du même groupe de poste (G, D, M, O ou F), 450 minutes ou plus, mêmes compétitions |
| Niveau des clubs | barre « Clubs de niveau comparable / Tous les clubs » au-dessus de l'analyse ; activée par défaut, elle réduit la cohorte aux joueurs des 30 clubs de niveau le plus proche, plus le club du joueur ([Référentiels](../04-clubs/03-referentiels-et-niveau-europeen.md)) |
| Centile | par 90 minutes, règles de [Centiles et cohortes](02-centiles-et-cohortes.md) : 450 minutes pour le joueur, mesure renseignée sur tous ses matchs, 30 pairs au moins |

## Les quatre phrases

### 1. Meilleur rôle

> Meilleur rôle : *rôle*, indice *N* sur 100 face aux *joueurs du poste*.

- **Source** : le premier rôle de la carte « Indice Vega par rôle » (`roleAssessments`, [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L295)), c'est-à-dire l'indice le plus haut parmi les rôles du groupe du joueur.
- **Calcul** : moyenne à poids égaux des centiles des trois indicateurs du rôle (deux pour « Arrêts »), arrondie à l'entier. Table des rôles et formule : [Indices Vega et profils de rôle](03-indices-vega-et-roles.md).
- **Absent** : si aucun rôle n'a d'indice. Un rôle n'a pas d'indice dès qu'un seul de ses indicateurs n'est pas classé.
- Le nom du groupe vient de `role.peers` : « gardiens », « défenseurs », « milieux », « milieux offensifs et attaquants », « joueurs de champ ».

### 2. Points forts

> Points forts : *indicateur* (P*x*) et *indicateur* (P*y*).

- **Source** : les **deux premiers** éléments de la carte « Points forts » (`cohortTraits`, [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L372)). La carte en montre trois.
- **Calcul** : les 15 axes de style ([scouting.js](../../../dashboard/frontend/src/services/scouting.js#L308)) sont classés ; on garde ceux qui ont un centile, triés du plus haut au plus bas. Axes : tirs, ballons dans la surface, occasions créées, passes dans le dernier tiers, dribbles réussis, ballons touchés, passes réussies, précision des passes, duels gagnés, duels gagnés %, tacles, interceptions, récupérations, dégagements, arrêts.
- **Absent** : si aucun axe n'est classé. Avec un seul axe classé, la phrase n'en cite qu'un.

### 3. Production

> Production : *a* but et *b* passe décisive par 90 min, note moyenne *n*.

- **Buts et passes décisives par 90** : `90 × total ÷ minutes des matchs où la mesure est renseignée` (`seasonMetric`, [season-player.js](../../../dashboard/frontend/src/services/season-player.js#L301)), deux décimales. Pas de centile ici, donc pas de règle de couverture complète ni de seuil de minutes.
- **Note moyenne** : moyenne **simple** des notes de match, sans pondération par les minutes (voir [Note du match](../02-metriques-attendues/04-note-du-match.md)). Le morceau disparaît si aucun match n'est noté.
- **Absent** : si ni les buts ni les passes décisives ne sont renseignés sur aucun match.

### 4. Point de vigilance

> Point de vigilance : *indicateur* (P*z*).

- **Source** : le **premier** élément de la carte « Points faibles », c'est-à-dire le centile le plus bas parmi les mêmes 15 axes de style.
- **Absent** : si aucun axe n'est classé.

## Exemple

Un milieu joue 1 800 minutes sur la période, avec 2 buts, 3 passes décisives et une note moyenne de 7,05. Dans sa cohorte :

- Construction : passes réussies P84, précision des passes P78, ballons touchés P81 → `(84 + 78 + 81) / 3 = 81` ; Récupération : récupérations P88, interceptions P70, tacles P62 → 73 ; Création et Percussion plus bas ;
- parmi les axes de style, les plus hauts sont récupérations P88 et passes réussies P84, le plus bas dribbles réussis P12.

La carte affiche :

- Meilleur rôle : construction, indice 81 sur 100 face aux milieux.
- Points forts : récupérations (P88) et passes réussies (P84).
- Production : 0,10 but et 0,15 passe décisive par 90 min, note moyenne 7,05.
- Point de vigilance : dribbles réussis (P12).

`90 × 2 / 1 800 = 0,10` et `90 × 3 / 1 800 = 0,15`.

## À savoir pour lire la carte

- **Le point de vigilance est relatif.** C'est le centile le plus bas du joueur, quelle que soit sa valeur : un joueur dont tous les axes dépassent P60 aura quand même un point de vigilance à P60 ou plus.
- **Les points forts et le point de vigilance ne regardent que les 15 axes de style.** Buts, xG, passes décisives et grosses occasions n'y figurent pas : la finition d'un attaquant n'apparaît qu'à travers les tirs et les ballons dans la surface.
- **La liste des 15 axes est la même pour tous les postes.** Pour un gardien, comparé aux seuls gardiens, des axes de joueur de champ (tirs, dribbles, ballons dans la surface) peuvent ressortir en point fort ou en vigilance s'ils sont classés.
- **Un même axe peut être point fort et point de vigilance** quand deux axes au plus sont classés : les deux listes sont tirées des mêmes valeurs.
- **« Face aux milieux » sous-entend la cohorte de la page.** Avec l'option « Clubs de niveau comparable » activée (par défaut), ce sont les milieux de clubs de niveau proche, pas tous les milieux des compétitions sélectionnées.
- **La phrase de production affiche 0 pour une mesure absente.** Si les buts sont renseignés mais jamais les passes décisives (ou l'inverse), la valeur manquante s'écrit « 0,00 » au lieu d'être omise (`goals.value ?? 0`), contrairement à la règle « absent ≠ zéro » ([Points d'attention](../07-limites/02-points-d-attention.md), point 12).

## Partenaires de passe

Sous la carte des tirs, la fiche nomme les trois coéquipiers avec qui le joueur a échangé le plus de passes sur la saison (`/api/players/{id}/partners`, vue `api.player_pass_partners`) : pour chaque match du joueur, les passes qu'il a données à un coéquipier et celles qu'il en a reçues dans le réseau de passes, additionnées sur la saison ; les partenaires sont rangés par passes échangées (données + reçues). Le réseau de passes de la source couvre un match jusqu'à son premier changement (la deuxième période n'y est le plus souvent pas) : ces nombres comparent les partenaires entre eux, ils ne sont pas le total des passes de la saison. Un coéquipier de sélection y figure au même titre qu'un coéquipier de club.
