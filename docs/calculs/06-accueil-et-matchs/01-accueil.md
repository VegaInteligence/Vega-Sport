# Accueil

Calculs dans [home-insights.js](../../../dashboard/frontend/src/services/home-insights.js) ; la version servie par l'API est la requête SQL de [home.mjs](../../../backend/api/src/routes/home.mjs), qui reproduit les mêmes règles.

## Semaine affichée

`matchdayWindow` ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L92)) :
- par défaut, la **semaine du lundi au dimanche** en cours, en heure de Paris (jours calendaires, pour rester juste lors des changements d'heure) ;
- si cette semaine n'a encore **aucun résultat** (lundi matin, trêve internationale) et que le dernier résultat date de **moins de 14 jours**, on garde la dernière semaine jouée (drapeau `latest`) ;
- une saison archivée affiche sa dernière semaine jouée.

Un match compte dans la semaine si son jour (Paris) est dans la fenêtre, n'est pas postérieur à aujourd'hui, et si son coup d'envoi explicite est déjà passé.

## Le bandeau

Le bandeau en haut de l'accueil (`scoreboardTicker`, [home-insights.js](../../../dashboard/frontend/src/services/home-insights.js) ; dessin `HomeTicker`, [HomeMatchday.jsx](../../../dashboard/frontend/src/components/HomeMatchday.jsx)) montre les résultats de la semaine **et les matchs à venir** (demande du propriétaire, 24 nov. 2026 : « je veux aussi les futurs matchs »). Le temps va de gauche à droite et le bandeau s'ouvre sur « maintenant ».

- **Rien à venir ni en cours** (saison archivée, semaine sans match devant, API sans `billboard`) : le bandeau d'avant, à l'identique — les 4 derniers jours de résultats, le plus récent à gauche, 8 par jour, sélections d'abord, puis l'ordre du **fil des résultats** (`weekTicker`, ci-dessous).
- **Sinon**, les jours du plus ancien au plus récent :
  - jours passés : les résultats, même règle (4 derniers jours de résultats, 8 par jour, même ordre dans le jour) ;
  - aujourd'hui : ses résultats (même ordre), puis les matchs en cours, puis les matchs à venir par heure de coup d'envoi ;
  - jours suivants, jusqu'à la fin de `billboardWindow` : 8 matchs au plus par jour, **choisis** par la règle unique (`preferenceOrder` : clubs favoris, puis le pays du visiteur selon `HOME_PRIORITY`, puis l'importance `weight`), puis **affichés** par heure de coup d'envoi, puis importance.
- Candidats : l'affiche (`billboard`), puis les matchs à venir des favoris (lecture personnelle), puis ceux du pays (`localMatches`) ; un seul enregistrement par match (le premier lu). Rien après la fin de `billboardWindow` (le match d'un favori dans 15 jours n'allonge pas le bandeau). Un match présent dans les résultats de la semaine garde son enregistrement de résultat (il a les xG).
- **À venir** : coup d'envoi ≥ maintenant et le flux ne l'a pas commencé (la règle d'« À l'affiche »). **En cours** : le flux dit `in_play`, ou le coup d'envoi est passé depuis moins de 3 h et le flux dit encore « pas commencé » (la fenêtre du direct, `isLiveWindow`). Un match terminé ou au-delà de cette fenêtre qui n'est pas dans les résultats n'est pas montré.
- Une case à venir a la boîte d'un résultat : compétition courte et heure de coup d'envoi (heure de Paris, comme « À l'affiche ») à la place de « Terminé », les deux équipes sans score, pied vide ; elle ouvre le match comme « À l'affiche ». Un match en cours affiche « En direct », et son score seulement si l'enregistrement le porte (`score_home` / `score_away`).
- **Ouverture** : sur la première case non terminée, avec jusqu'à deux cases avant elle en vue (moins si elle ne tiendrait plus, sur téléphone) ; un petit script dans le HTML du serveur, juste après le bandeau, fixe le défilement avant le premier affichage (pas de saut à l'hydratation) ; ensuite, seulement si le match d'ancrage change et que le visiteur n'a pas fait défiler le bandeau.
- Le nom accessible devient « Résultats et matchs à venir … » ; avec les seuls résultats il reste « Résultats … ».

Exemple (rejeu du 24 nov. 2026, 8 h à Paris, sans pays) : Levante – Elche et Monza – Fiorentina (lundi) à gauche, puis mardi Galatasaray – Aston Villa 18:45 (ouverture), Bodø/Glimt – LASK 18:45, Arsenal – Dortmund 21:00…, puis mercredi à vendredi. À 21 h 30 le même jour, les matchs de mardi sont « En direct » (coup d'envoi passé, flux encore « pas commencé »).

## Poids éditorial d'un match

`matchWeight` sert à ordonner le fil des résultats et les matchs à venir :

$$
\text{poids} = 2 \times (\text{gros clubs}) + \begin{cases}3 & \text{Ligue des champions}\\ 1 & \text{Europa / Conférence}\\ 0 & \text{sinon}\end{cases} + [\text{Top 5}] + [\text{rang domicile} \le 3] + [\text{rang extérieur} \le 3]
$$

« Gros clubs » : nombre d'équipes du match (0, 1 ou 2) dans la liste `FEATURED_CLUB_IDS` de [home.js](../../../dashboard/frontend/src/services/home.js#L33) (29 clubs : Arsenal, PSG, Real Madrid, Bayern, Inter, Benfica, Ajax…). Les rangs viennent des tableaux de l'accueil.

C'est `api.home_weight_v1` ([044_home_settings.sql](../../../backend/sql/044_home_settings.sql)). Il ordonne toujours le fil des résultats, le choc de la semaine et `highlights` ; seul « À l'affiche » lit l'importance v2 ci-dessous (VI-48).

## Importance d'un match (v2)

`api.home_importance_v2` ([171_home_importance_v2.sql](../../../backend/sql/171_home_importance_v2.sql), VI-48 / #69) remplace la liste de clubs par un score général :

$$
\text{importance} = \text{enjeu} \times \text{niveau} + \text{équilibre}
$$

- **enjeu** = prestige de la compétition × multiplicateur du tour, les valeurs de l'Elo ([power.py](../../../backend/vega/power.py), `PRESTIGE`, `STAGE`, `round_of`) : Coupe du monde 1,30, Ligue des champions 1,15, Ligue Europa 1,08, Ligue Conférence 1,04, sinon 1 ; ×1,05 dès le premier tour à élimination directe, ×1,10 en demi-finale, ×1,15 en finale (un tour de phase « regular » est ordinaire quel que soit son nom). Les valeurs sont des lignes de `core.home_stakes` ; un test les compare à power.py ([test_home_importance.py](../../../backend/tests/test_home_importance.py)) et la classification des tours à `round_of`. Le prestige des coupes complémentaires (`CUP_PRESTIGE`) n'y est pas : `api.fixtures` ne contient aucune de leurs éditions ;
- **niveau** = (moyenne des deux notes − centre) / diviseur. La note d'une équipe : son Elo de la saison (`agg.team_power`), sinon le niveau de son championnat cette saison (`agg.league_levels`, le plus haut s'il y en a plusieurs), sinon celui de la compétition du match, sinon le centre (terme nul, jamais NULL). Centre et diviseur sont une ligne de `core.home_level_scales` par périmètre : `clubs` 1400 et 100 ; `nations` (les deux équipes sont des sélections) **provisoirement** les mêmes valeurs, en attendant le changement d'échelle de l'Elo des sélections, qui se fera par une migration de données sur cette ligne ;
- **équilibre** = 1 − |p_dom − p_ext| : les probabilités du pronostic du match (`agg.match_forecasts`) s'il existe ; sinon le score attendu de l'Elo, $E = 1/(1 + 10^{(R_\text{ext} − R_\text{dom} − h)/400})$ avec l'avantage du terrain du calcul Elo (`agg.power_runs.elo_home_advantage`, 60 ; 0 sur terrain neutre), si les deux équipes ont une note ; sinon 0,5.

Exemples (graine des tests) : finale de Ligue des champions entre deux clubs à 1900 et 1800 : 1,3225 × 4,5 + 0,57 = **6,52** ; deux clubs sans Elo d'un championnat de niveau 1500 : 1 + 0,83 = **1,83** ; rien de connu : **0,5**. Ordres de grandeur mesurés sur la production (23 nov. 2026, API publique) : Arsenal–Dortmund (LdC) 6,93, Liverpool–Manchester United 5,27, un match de Ligue 2 1,6 à 1,9.

L'API arrondit l'importance à 2 décimales (`weight`, `weight2`) ; les tris lisent la valeur exacte.

## À l'affiche

Clé `billboard` de `/api/read/home` : les matchs du périmètre du visiteur (mêmes `leagues` et même saison que le reste de la lecture) dont le **jour à Paris** va d'hier à aujourd'hui + 3 (5 jours), terminés, en cours ou à venir (un match reporté ou annulé n'y est pas). Chaque jour garde ses **8** matchs les plus importants. Ordre : jour ↑, importance ↓, coup d'envoi ↑, identifiant. Chaque match a ses champs habituels (`fixture`), `time`, `day` (jour à Paris), `weight` (importance v2) et `forecast` (domicile / nul / extérieur) quand il y a un pronostic. Les bornes et le plafond sont des données : `api.home_rules_v2` ; les bornes utilisées sont dans la réponse, `billboardWindow` (`start`, `end`, jours de Paris), même quand `billboard` est vide.

Les matchs à venir (`highlights`) gardent l'ordre du poids éditorial v1 et portent aussi `weight2`, leur importance v2.

Sur la page, le bloc « À l'affiche » (titre « Les matchs du moment ») remplace « À ne pas manquer », même place et même dessin, et reste la carte des **matchs à venir** : `chooseBillboard` ([home-upcoming.js](../../../dashboard/frontend/src/services/home-upcoming.js)) ne retient que les matchs qui n'ont pas commencé (ni terminés, ni en cours, coup d'envoi à venir) ; un match quitte la carte au coup d'envoi, comme avant VI-48. Les résultats d'hier que sert `billboard` n'y apparaissent donc jamais (décision du propriétaire, 24 nov. 2026). Il garde les règles des favoris (3 places au plus, la grande carte au match d'un favori dans les 48 h) ; sinon la grande carte est le match le plus important (`weight` servi), et les 4 autres places vont aux plus importants suivants, rangés par coup d'envoi. Sans `billboard` servi (ancienne publication), ou si la fenêtre n'a plus rien à jouer, le choix d'avant (`highlights`, titre « Les 7 prochains jours ») reste. Le pays du visiteur y entre selon la section suivante.

## Le pays du visiteur

Le pays ne crée ni carte ni bande : il change ce que montrent les cartes existantes (décision du 24 novembre 2026, la bande « Chez vous » ayant été refusée). Aucun drapeau, aucune étiquette ne le signale.

**Le pays** ([home-country.js](../../../dashboard/frontend/src/services/home-country.js)) : le choix du visiteur (`homeCountry` dans `orion.preferences.v1`, recopié dans le cookie `vega.home.v1`), sinon le pays détecté par l'hébergeur (`x-vercel-ip-country`, lu par le serveur de la page, sinon `/api/visitor-country`, code ISO à deux lettres traduit par une table : GB → ENG, DE → GER…), sinon aucun. Le seul réglage est la ligne « Votre pays » du panneau des préférences de l'accueil (bouton des compétitions) : les pays des compétitions du manifeste, puis « Aucun pays » (`none`, les cartes choisissent comme sans pays) ; le choix s'applique tout de suite, sans recharger. Les codes INT, INT-2, UEFA ne sont jamais un pays.

**Un match local** : sa compétition est du pays du visiteur (code à trois lettres de la base). Une coupe d'Europe n'est jamais locale, quels que soient ses clubs.

**La priorité** ([home-priority.js](../../../dashboard/frontend/src/services/home-priority.js)) : `HOME_PRIORITY`, « localisation » (`location`) ou « importance du match » (`importance`). Elle deviendra un réglage du visiteur (« Privilégier : localisation ou importance du match », préférences / compte, VI-38) ; d'ici là elle est fixée dans le code à **`location`**, et les fonctions qui ordonnent les matchs la reçoivent en paramètre. Les deux valeurs sont implémentées et testées. La valeur du visiteur est déjà stockée (`homePriority` de `orion.preferences.v1`) et synchronisée avec le compte ([PREFERENCES_UTILISATEUR.md](../../PREFERENCES_UTILISATEUR.md)), mais rien ne la lit encore.

**« À l'affiche »** (`localMatches`, puis `chooseBillboard` de [home-upcoming.js](../../../dashboard/frontend/src/services/home-upcoming.js)) :
- candidats locaux : les matchs locaux de `billboard`, plus les `matches` de `/api/read/home-local` dont le jour est dans `billboardWindow` et dont la compétition est dans les championnats **choisis** par le visiteur (filtre de compétition ou compétitions suivies ; le périmètre par défaut Top 7 Europe n'est pas un choix et ne les écarte pas ; « toutes les compétitions » non plus). Un match servi par les deux lectures compte une fois ;
- `location` : les favoris gardent leurs places (3 au plus) ; puis jusqu'à **2** places (`localPlaces`) vont aux matchs locaux **à venir** les plus importants (importance ↓, coup d'envoi ↑, identifiant), en laissant toujours au moins **1** place (`bigPlacesKept`) aux grands matchs quand il y en a ; une place locale qu'aucun match local à venir ne peut prendre va aux grands matchs ; le reste aux grands matchs par importance ; un côté trop court est complété par l'autre ;
- `importance` : aucune place réservée, l'importance seule ; à importance égale un match local passe devant ;
- dans les deux priorités, seuls les matchs à venir comptent : un match local terminé ou en cours, comme un grand match ou celui d'un favori, n'est jamais retenu ; la grande carte : le match d'un favori dans les 48 h, sinon le plus important des matchs choisis ;
- sans pays, avec « Aucun pays », sans réponse de home-local (pas encore chargée, saison archivée, lecture non annoncée par le manifeste) : le choix d'avant, à l'identique. Pendant le chargement d'un pays nouvellement choisi, la carte garde le choix du pays précédent.

Exemple (24 nov. 2026, 8 h à Paris, sans favori ; importances du double de test sur un rejeu de la production). France : Arsenal – Dortmund (LdC, 6,93) en grande carte ; Brest – Paris FC (L1, 3,89), le seul match français à venir de la fenêtre (les résultats de Ligue 2 de lundi n'entrent pas) ; PSG – Roma (6,39), Bruges – Liverpool (6,30) et Galatasaray – Aston Villa (5,87) pour les grands matchs. Brésil : Arsenal – Dortmund, Chapecoense – Palmeiras (2,07) et Atlético-MG – Corinthians (1,89), PSG – Roma, Bruges – Liverpool. Sans pays, comme en `importance` pour la France : 6,93 / 6,39 / 6,30 / 5,87 / 5,84 (Real Madrid – PSV).

**Fil des résultats** (`weekTicker`, les résultats du [bandeau](#le-bandeau)) : chaque jour les sélections nationales d'abord, comme avant ; puis les résultats d'un **club favori** du visiteur (effet 1, ci-dessous) ; puis, en `location`, les résultats locaux devant les autres (puis le poids éditorial), avant la coupe à 8 par jour ; en `importance`, le poids éditorial d'abord, le local seulement à égalité. Le fil ne montre que les résultats des championnats du visiteur : rien n'y est ajouté.

**« Course au titre »** s'ouvre sur le championnat du premier club favori qui y figure (effet 2, ci-dessous), sinon sur le championnat du pays quand il est parmi ses onglets (`initialTitleRace`), sinon sur la Ligue 1 comme avant, quelle que soit la priorité.

## Les favoris du visiteur

Règle commune ([preference-effects.js](../../../dashboard/frontend/src/services/preference-effects.js), [PREFERENCES_UTILISATEUR.md](../../PREFERENCES_UTILISATEUR.md)) : les favoris d'abord, puis le pays, puis l'importance du match ; un choix du visiteur sur la page (filtre, onglet) ou un paramètre d'adresse passe avant. Les favoris sont les clubs et joueurs de **toutes** les listes, triés par identifiant (`favouritesOf`) ; « le premier club favori » est le premier de cet ordre, celui que porte aussi le cookie de l'accueil : la page servie et la page hydratée choisissent le même (pas de saut). Aucun élément ajouté.

- **Effet 1, fil des résultats** : chaque jour, après les sélections nationales, les résultats où joue un club favori passent devant ceux du pays, puis l'ordre d'avant (`preferenceOrder`), avant la coupe à 8 ; dans les deux priorités.
- **Effet 2, « Course au titre »** : s'ouvre sur le championnat du premier club favori présent parmi les onglets : le tableau qui le contient, sinon un résultat ou un match à venir de lui dans un de ces championnats (un match de coupe ne compte pas), sinon le championnat de son pays (`clubCountries` du manifeste). Un favori introuvable laisse la place au suivant, puis au pays, puis à la Ligue 1.
- **Effet 5, encarts de saison** : dans « Buteurs de la saison » et « Devant le but », la ligne d'un joueur favori prend le surlignage des clubs enregistrés dans les classements (`data-followed`, même fond, même graisse).

Exemple (rejeu du 24 nov. 2026, visiteur en France, favoris Monza et Donyell Malen) : le 23 nov., le match de Monza passe du troisième au premier rang du fil ; la course au titre s'ouvre sur la Serie A au lieu de la Ligue 1, y compris dans le HTML servi ; la ligne de Malen, troisième buteur, est surlignée.

Rendu serveur : le serveur de la page lit home-local avec l'accueil, sous la clé du navigateur ; le HTML et le premier rendu du navigateur montrent les mêmes cinq matchs.

### Lecture home-local

`/api/read/home-local?season=AAAA/AAAA&country=XXX` (code à trois lettres majuscules, sinon 400 ; aucun paramètre personnel ni `leagues`) : lecture commune, mise en cache comme l'accueil (une copie par pays) :
- `competitions` : les compétitions de ce pays présentes dans la saison (`api.editions`), avec leur niveau quand il est connu, la plus haute d'abord ;
- `window` : les bornes utilisées, d'hier à aujourd'hui + **7** jours à Paris (`api.home_rules_v2`) ; « À l'affiche » n'en garde que les jours de `billboardWindow` ;
- `matches` : leurs matchs de cette fenêtre, mêmes champs et même ordre qu'« À l'affiche », au plus 16 par jour ;
- `table` : les 6 premiers du classement (`api.standing_rows`, sans phase ni groupe) du championnat le plus haut du pays qui a un niveau ; `null` sinon. Non affichée.

Un code bien formé sans compétition répond 200 avec des listes vides. La sélection nationale du pays n'y est pas : l'API n'a pas de lien fiable entre un pays et sa sélection.

La saison lue est celle de la page (`season=2026/2027` par défaut) : pour un pays à saison civile comme le Brésil, elle désigne l'édition 2026 (vérifié en production le 24 novembre 2026).

## Match de la semaine

`selectMatchOfTheWeek` (SQL : `showcase_weight`) :

$$
\text{score} = 4 \times (\text{gros clubs}) + 2[\text{rang dom.} \le 4] + 2[\text{rang ext.} \le 4] + 2[\text{les deux} \le 3] + 3[\text{LdC}] + [\text{Top 5}] + [\text{tirs disponibles}]
$$

Le plus haut score l'emporte ; à égalité, le match le plus récent.

Exemple : Arsenal (2e) – Liverpool (3e) en Premier League avec tirs : 4×2 + 2 + 2 + 2 + 0 + 1 + 1 = **16**.

## Autres encarts de la semaine

| Encart | Règle |
| --- | --- |
| Plus large victoire | écart ≥ 3 buts ; le plus grand écart, puis le plus de buts, puis le plus récent |
| Totaux de la semaine | matchs, buts, somme des xG des deux équipes (xG absent compté 0) |
| Joueur de la semaine | voir [Classements joueurs](../05-joueurs/05-classements-joueurs.md) |

## Encarts de saison

À partir des tableaux dérivés des résultats (`leagueProgress`, voir [Classements](../03-resultats-et-points-attendus/02-classements.md)) :

| Encart | Règle |
| --- | --- |
| Meilleure série | série de victoires en cours ≥ 3 ; la plus longue, puis le meilleur rang |
| Meilleures défenses | au moins 5 matchs ; buts encaissés par match ↑, puis matchs sans encaisser ↓ ; 3 clubs |
| Avancement de la saison | moyenne, sur les 5 grands championnats, de `min(1, journées jouées / (2 × (équipes − 1)))` |
| Meneurs (buteurs, passeurs, efficaces, notes) | voir [Classements joueurs](../05-joueurs/05-classements-joueurs.md) |

## Ouverture de la course au Ballon d'Or

`ballonDorRaceOpen` : la course s'affiche quand **les 8 matchs des quarts de finale** de Ligue des champions sont terminés, ou dès qu'une demi-finale ou la finale a été jouée. Le tour d'un match vient du nom de la journée (`knockoutStage`).

## Matchs à venir

`upcomingHighlights` : matchs non commencés des 7 prochains jours, dans les compétitions suivies. Ordre :
1. matchs de vos clubs (clubs enregistrés + dernier club national de vos joueurs enregistrés) ; le même jour, les matchs européens passent avant (Ligue des champions, puis Europa, puis Conférence) ;
2. puis poids éditorial ↓ ;
3. puis coup d'envoi ↑.
