# Préférences du visiteur — le contrat partagé

Un seul objet, versionné, décrit tout ce que le visiteur a choisi sur le site. Le site le construit depuis ses stockages locaux et le réapplique ; le compte (VI-38) le stocke et le rend tel quel par `GET` / `PUT /account/preferences`. Code : [user-preferences.js](../dashboard/frontend/src/services/user-preferences.js) (l'exemple complet, commenté, est en tête du fichier), tests : `tests/user-preferences.test.mjs`.

## Le contrat (version 1)

| Clé | Valeurs | « Pas choisi » | Stockage local |
| --- | --- | --- | --- |
| `v` | `1` ; toute autre valeur est refusée | — | — |
| `focus` | `"europe"` \| `"all"` | `"europe"` | `orion.preferences.v1` `focus` |
| `theme` | `"light"` \| `"dark"` \| `null` | `null` (sombre affiché) | `statarena.theme` |
| `leagues` | identifiants `l_…`, dans l'ordre, 200 au plus | `[]` | `favoriteLeagueIds` |
| `country` | trois capitales \| `"none"` \| `null` | `null` : la détection s'applique ; `"none"` : « Aucun pays » choisi | `homeCountry` (`""` = `null`) |
| `homePriority` | `"location"` \| `"importance"` \| `null` | `null` : `HOME_PRIORITY` du code | `homePriority` (`""` = `null`) — transporté, pas encore appliqué |
| `defaultSeason` | `"AAAA/AAAA"` \| `null` | `null` (aucun écran ne l'écrit) | `defaultSeason` |
| `onboarded` | `true` \| `false` | `false` | `onboardingComplete` |
| `competition` | identifiant de compétition \| `null` | `null` : règle du pays | `statarena.preferred-competition.v1` |
| `lists` | 1 à 50 listes `{ id, name, entries }`, 5000 entrées chacune | une liste « Ma sélection » vide | `statarena.research.v1` |
| `activeList` | l'id d'une des listes | la première | idem |
| `views` | recherches de joueurs enregistrées, 50 au plus | `[]` | idem |
| `templates` | indices de recrutement, 50 au plus | `[]` | idem |
| `comparison` | joueurs comparés (avec saison), 4 au plus | `[]` | idem |
| `researchSettings` | colonnes, nuage de points, métriques de comparaison, indice | réglages par défaut | idem (`settings`) |

Une entrée de liste a la forme de `cleanEntry` ([research-storage.js](../dashboard/frontend/src/services/research-storage.js)) : `id`, `kind` (`clubs` t_…, `nations` t_…, `players` p_…, `matches` m_…), `name`, `season`, `imageUrl`, et pour un joueur `scope` (son échantillon) et `replaces: true` s'il est le « Remplaçant ». Les listes et tout le bloc recherche passent par `cleanResearch` : le site et le contrat ont les mêmes règles et les mêmes bornes (`LIMITS`).

**Les favoris** ne sont pas une clé : `favouritesOf(contract)` les dérive (clubs et joueurs de **toutes** les listes, une fois chacun, triés, 100 par type, ce que l'accueil envoie à `home-favourites`). Une clé `favourites` reçue est ignorée, comme toute clé inconnue.

Règles : `validateContract` refuse un non-objet et une version inconnue ; une valeur invalide retombe à « pas choisi », le reste est gardé. `toContract` ne lève jamais d'erreur. L'aller-retour stockages → contrat → stockages est sans perte.

## La synchronisation

`setPreferencesSync({ load, save, report? } | null)` branche le compte. Sans adaptateur, rien ne se passe (aucune lecture, aucun minuteur, aucune requête). Avec : `load()` une fois ; le contrat rendu est validé puis écrit une fois par les setters existants (préférences, recherches, thème, compétition) ; `null` n'écrit rien. Rien n'est enregistré avant la réponse de `load` ; un `load` en échec est retenté au changement suivant ; un contrat d'une autre version n'est jamais écrasé. `save` est différé (1 s), jamais concurrent, de l'état le plus récent ; un échec est retenté au changement suivant, sans jamais bloquer l'interface.

**Ce que l'adaptateur peut rendre.** `load()` : le contrat du compte, ou `null` / `undefined` s'il n'en a pas ; un rejet est un chargement en échec. `save(contract)` : `undefined` / `null` (enregistré tel quel), ou un contrat à réappliquer — un autre appareil a écrit avant (409) : l'adaptateur a rechargé, fusionné, réécrit, et rend le résultat. Ce contrat est validé puis écrit exactement comme après `load`, et devient l'état enregistré : l'écrire ne déclenche aucun nouvel enregistrement. Un contrat invalide ou d'une autre version n'est jamais écrit et passe à `report(error)`, la fonction facultative de l'adaptateur (`setPreferencesSync({ load, save, report })`, pour que l'écran du compte dise que la synchronisation s'est arrêtée ; sans elle, rien ne lève d'erreur) : venant de `load`, il arrête la synchronisation (les données du compte ne sont jamais écrasées) ; venant de `save`, il est ignoré (l'enregistrement a réussi) et la synchronisation continue.

**Déconnexion.** `setPreferencesSync(null)` puis `clearPreferences()` : les magasins du navigateur reviennent à « rien choisi » (listes, championnats, pays, vues, comparaison), pour que la personne suivante sur ce navigateur n'hérite pas des données du compte. `clearPreferences({ keep })` laisse en place les clés du contrat nommées dans `keep` (par défaut `["theme"]`, l'apparence de l'appareil). Tant qu'un adaptateur est branché, ou avant le chargement des magasins, la fonction n'écrit rien et rend `false` : un contrat vidé n'est jamais enregistré sur un compte. La mémoire de la visite (filtres pré-sélectionnés puis effacés, clé de session `vega.preselect.v1`, liste `VISIT_KEYS`) est oubliée par le même appel.

**Changement local pendant l'enregistrement.** Règle, clé de premier niveau par clé de premier niveau : une clé dont la valeur locale diffère de la valeur envoyée garde la valeur locale (le changement le plus récent gagne) ; toutes les autres prennent celle du contrat rendu. Le résultat est écrit, puis enregistré au tour suivant (après le délai, une fois les stockages à jour), par-dessus le contrat rendu. Une liste modifiée localement est donc reprise entière depuis le local.

Le seul point de branchement est [PreferencesSync.jsx](../dashboard/frontend/src/components/PreferencesSync.jsx), monté dans `ResearchProvider` ([providers.jsx](../dashboard/frontend/app/providers.jsx)) ; le bouton du thème et la page Compétitions signalent leurs propres écritures. La page Compétitions lit sa compétition à l'ouverture : une valeur venue du compte s'y applique à la visite suivante de la page.

## Quelle préférence agit où

Règle unique, là où deux préférences se rencontrent : **les favoris du visiteur, puis son pays, puis l'importance du match** (entre pays et importance, `HOME_PRIORITY` garde son sens : home-priority.js). Un **paramètre d'adresse** ou un **filtre choisi sur la page** passe toujours avant une préférence. Rien n'est ajouté à l'écran : seulement un ordre, l'onglet d'ouverture, la valeur de départ d'un contrôle existant, ou le surlignage que les classements donnent déjà aux clubs enregistrés. Toutes les règles sont dans [preference-effects.js](../dashboard/frontend/src/services/preference-effects.js) ; les pages l'appellent. Les numéros sont ceux du propriétaire (24 nov. 2026).

« Favoris » : clubs et joueurs de toutes les listes (`favouritesOf`), triés par identifiant ; « le premier club favori » est le premier de cet ordre. « Pays » : `homeCountry` (`country` du contrat), jamais « Aucun pays ».

| N° | Préférence | Page | Effet | Préséance |
| --- | --- | --- | --- | --- |
| 1 | clubs favoris | Accueil, fil des résultats | leurs résultats en tête de chaque jour (après les sélections), avant la coupe à 8 | favoris > pays > poids éditorial, dans les deux priorités |
| 2 | premier club favori | Accueil, « Course au titre » | s'ouvre sur son championnat (tableau, sinon un match, sinon son pays) | favori > pays > Ligue 1 ; un onglet cliqué l'emporte |
| 3 | clubs favoris | Matchs (à venir, résultats) | leurs matchs en tête de leur jour | ordre de la journée gardé pour le reste |
| 4 | premier club favori | Compétitions | sans compétition enregistrée, s'ouvre sur le championnat de son pays (la page n'a pas de lien club → championnat) | enregistrée > favori > pays (11) > pays détecté / langue ; `?id=` l'emporte |
| 5 | joueurs favoris | Accueil, buteurs et « Devant le but » | ligne surlignée | — |
| 6 | joueurs favoris | Ballon d'Or | place du podium et ligne surlignées | — |
| 7 | clubs et joueurs favoris | Recherche | en tête à pertinence égale (rangs de pertinence de /api/search, score des clubs) | pertinence > favori > ordre d'avant |
| 8 | une nation enregistrée | Nations | s'ouvre sur « Mes sélections » | le choix du visiteur dans les onglets l'emporte |
| 9 | compétitions suivies | Matchs | le filtre Compétition part de la première suivie | adresse (`league`, `leagues`) > effacé dans la visite > préférence |
| 10 | une seule compétition suivie | Joueurs | le filtre Compétition part d'elle | idem |
| 11 | `homeCountry` | Compétitions | après 4 : championnat du pays avant le pays détecté / la langue | voir 4 |
| 12 | `homeCountry` | Clubs ; Power Ranking | filtre Pays du répertoire pré-sélectionné ; tableau des clubs ouvert (défilé) sur le premier club du pays | Clubs : effacé dans la visite > préférence ; Power Ranking : jamais après un défilement du visiteur ni avec une ancre |

**Filtres pré-sélectionnés (9, 10, 12 Clubs)** : une fois par ouverture de page, après lecture des préférences, seulement sur une valeur que le contrôle propose ; le contrôle montre la valeur choisie (et l'adresse, pour 9 et 10). Dès que le visiteur change une valeur pré-sélectionnée, elle n'est plus pré-sélectionnée de la visite (`vega.preselect.v1`, sessionStorage).

**Rendu serveur** : seul l'accueil est rendu avec les favoris (cookie `vega.home.v1`) ; 1 et 2 y sont donc déjà dans le HTML servi, sans saut. Ailleurs, l'effet s'applique après `preferencesReady` / la lecture des listes, sans écart d'hydratation (le premier rendu est celui d'avant).

## Partage avec VI-38

- **Ce dépôt, côté site (#69)** : le contrat, sa validation, la synchronisation sans React, le branchement sur les stockages.
- **VI-38 (comptes, `backend/account/**`)** : le stockage serveur, les écrans de connexion, l'adaptateur `{ load, save }` qui appelle `/account/preferences`, et la **fusion à la première connexion** (données locales contre données du compte), qui n'est pas ici.
