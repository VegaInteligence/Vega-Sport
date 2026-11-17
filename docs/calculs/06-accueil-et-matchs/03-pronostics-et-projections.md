# Pronostics de match et projections de fin de saison

Code : [forecast.py](../../../backend/vega/forecast.py) ; lectures `/api/forecasts/match` et `/api/forecasts/season` ; sur le site, la carte « Probabilités » de l'avant-match et la vue « Projection » d'un championnat ou d'une coupe européenne. Version du modèle : `forecast-v2` (14 novembre 2026 ; la version 1, du 12 novembre, ne lisait que l'Elo).

## Le pronostic d'un match

Le modèle lit la **force des deux équipes avant le match** (leur Elo, voir [Classements joueurs](../05-joueurs/05-classements-joueurs.md)), corrigée de leur forme récente pour les matchs des quatorze prochains jours (plus bas) :

- écart : Δ = (Elo domicile + 60 − Elo extérieur) / 400 ; pas d'avantage du terrain en terrain neutre ;
- buts : buts domicile ~ Poisson(exp(a_d + b_d Δ)), buts extérieur ~ Poisson(exp(a_e − b_e Δ)) ; les quatre coefficients sont ajustés par maximum de vraisemblance sur tous les matchs de clubs terminés de la base (score à la 90ᵉ minute) ;
- petits scores : deux lois de Poisson indépendantes donnent trop peu de nuls ; les probabilités de 0-0, 1-0, 0-1 et 1-1 sont corrigées par le facteur de Dixon et Coles (1997), dont le paramètre ρ est ajusté sur les mêmes matchs ;
- victoire, nul, défaite : sommes sur la grille des scores de 0 à 10 buts ; le score affiché est le plus probable de la grille.

Ce premier pronostic ne connaît ni les compositions, ni les absents, ni aucune cote de bookmaker. Les compositions s'y ajoutent quand les deux clubs ont confirmé leur onze (ci-dessous). Les jours de repos ont été mesurés et n'apportent rien (plus bas).

### Vérification sur des matchs non vus

Modèle ajusté sur les 63 560 matchs de clubs des saisons jusqu'à 2025/2026, jugé sur les 11 552 matchs de 2026/2027 (12 novembre 2026) :

| Matchs | Perte logarithmique, modèle | Taux de base | Brier, modèle | Taux de base |
|---|---:|---:|---:|---:|
| Tous les matchs de clubs (11 552) | 1,0207 | 1,0704 | 0,6119 | 0,6473 |
| Cinq grands championnats (500) | 0,9499 | 1,0612 | 0,5623 | 0,6414 |
| Coupes d'Europe (198) | 0,9087 | 1,0425 | 0,5329 | 0,6294 |

Le « taux de base » est la fréquence des trois résultats dans l'historique, la même pour tous les matchs. Calibration de la victoire à domicile : parmi les matchs annoncés entre 50 et 60 % (2 196 matchs, 54,5 % en moyenne), 54,6 % ont été gagnés ; entre 30 et 40 %, 36,0 % pour 35,3 % annoncés ; entre 70 et 80 %, 75,3 % pour 74,0 %. Les nuls sont un peu sous-estimés (24,6 % annoncés, 25,5 % observés). La correction des petits scores change peu (1,0207 contre 1,0212 sans elle).

Aucune comparaison avec les cotes de clôture n'a été faite : la base n'en contient pas.

## La forme récente (version 2)

L'Elo suit les buts. Un club dont les occasions valent mieux que les résultats est plus fort que son Elo ne le dit, et l'inverse. Pour chaque club, sur ses **dix derniers matchs** qui ont un xG des deux côtés (au moins cinq, toutes compétitions) :

- x : la moyenne de sa différence de xG par match ;
- l : la moyenne de sa différence de buts moins cette différence de xG (ce que ses résultats doivent à autre chose qu'à ses occasions).

L'écart du pronostic devient Δ′ = Δ + F_xG × (x_domicile − x_extérieur) + F_l × (l_domicile − l_extérieur). Les deux coefficients sont ajustés par maximum de vraisemblance sur les matchs terminés où les deux clubs ont une forme, les quatre coefficients du pronostic tenus tels quels. La forme d'un club, en points Elo, est 400 × (F_xG × x + F_l × l) ; elle est écrite à côté de chaque pronostic (`home_form`, `away_form`) et la route `/api/forecasts/match` la rend (`form`). La carte « Probabilités » dit alors que le pronostic lit aussi les dix derniers matchs.

La forme ne compte que pour les matchs qui se jouent **dans les quatorze jours** ; plus loin, et dans la projection d'un championnat, les forces seules (la projection a été vérifiée ainsi, et une forme vieille de dix matchs n'annonce plus rien, voir ci-dessous).

### Vérification (14 novembre 2026)

Ajustement de production : 38 910 matchs où les deux clubs ont une forme, F_xG = 0,0699 et F_l = −0,0549, soit **+28 points Elo par but de xG d'écart par match et −22 par but de « réussite »**. Sur les 1 391 clubs qui ont une forme ce jour-là, elle vaut de −34 points Elo (5ᵉ centile) à +31 (95ᵉ), 0 en médiane.

Coefficients ajustés sur les saisons jusqu'à 2025/2026, jugés sur les 11 562 matchs de clubs de 2026/2027 (perte logarithmique des trois issues) :

| Matchs | Elo seul | Avec la forme |
| --- | ---: | ---: |
| Tous (11 562 ; forme nulle quand un club n'en a pas) | 1,02075 | **1,01546** |
| Les deux clubs ont une forme (10 917) | 1,02038 | 1,01478 |
| Forme lue 3 matchs plus tôt (10 607) | 1,02027 | 1,01662 |
| Forme lue 6 matchs plus tôt (10 328) | 1,02030 | 1,01882 |
| Forme lue 10 matchs plus tôt (10 042) | 1,02107 | 1,02100 |

Avec les compositions confirmées (4 268 matchs de 2026/2027 qui ont les deux) : Elo seul 1,00479 ; avec la forme 0,99817 ; avec les compositions 1,00203 ; avec les deux **0,99581**. Les deux corrections sont presque indépendantes (corrélation 0,09) : elles s'ajoutent.

**Mesuré et non retenu : les jours de repos.** Sur 20 238 matchs de 2025/2026, l'écart de jours de repos entre les deux clubs donne un coefficient de 0,7 point Elo par jour (z = 0,6), un repos de moins de quatre jours −4 points (z = −0,6) ; ni l'un ni l'autre n'améliore le pronostic des matchs non vus de 2026/2027 (1,02032 → 1,02035 et 1,02034). Le nombre de matchs joués dans les quatorze jours précédents a un coefficient significatif sur 2025/2026 (z = −2,3) mais dégrade 2026/2027 (1,02051) et change de signe quand on l'ajuste sur cette saison. Aucun des trois n'entre dans le modèle.

## Avec les compositions confirmées

Quand la base détient le onze **confirmé** des deux clubs, le pronostic du match est relu avec eux ([lineup.py](../../../backend/vega/lineup.py), mesures et vérification dans [Et si un joueur en remplaçait un autre ?](../05-joueurs/12-et-si-un-joueur-en-remplacait-un-autre.md)) :

- composition d'un côté : la somme des rendements propres de ses titulaires de champ, tels que le classement les connaît avant le match (l'année du trophée en cours et la précédente) ;
- écart : cette somme moins la moyenne des compositions précédentes du club dans l'année (`agg.lineup_usuals`, réécrite après chaque classement de l'année ; au moins cinq compositions) ;
- la force de chaque équipe (son Elo et sa forme) est déplacée de E × son écart, E étant les points Elo que vaut une unité de rendement (environ 45), puis le pronostic est recalculé comme plus haut.

La carte « Probabilités » affiche alors ce pronostic, dit ce que vaut chaque onze face à l'habituel de son club (proche en dessous de 0,15 d'écart, « nettement » à partir de 0,6) et rappelle les probabilités sans les compositions. La courbe du match part elle aussi de ce pronostic.

**Quand les compositions sont lues.** 48 heures avant le match (une composition probable), **50 puis 25 minutes avant le coup d'envoi**, une fois encore **10 minutes avant** si les deux onze ne sont pas tous deux confirmés (depuis le 14 novembre 2026), et au coup d'envoi. Les deux lectures d'avant-match datent du 13 novembre 2026. Jusque-là la base ne recevait un onze confirmé qu'au coup d'envoi : ce jour-là, sur 54 matchs à jouer dans les 24 heures, 8 avaient une composition des deux côtés, toutes non confirmées (le dernier onze aligné, selon le fournisseur).

**Premières mesures (14 novembre 2026).** Les quatre premiers matchs joués après la mise en service ont tous reçu leur pronostic relu **avant** le coup d'envoi, deux à la lecture de 50 minutes et deux à celle de 25 minutes ; aucun match n'est resté sans.

| Match | Premier calcul | Écarts (domicile / extérieur) | Victoire à domicile | Résultat |
| --- | --- | --- | --- | --- |
| Inter Bogotá – Independiente Santa Fe | 23 min avant | −0,39 / +0,04 | 23,9 % → 21,7 % | 0–2 |
| Gifu – Matsumoto Yamaga | 24 min avant | +0,16 / −0,28 | 56,2 % → 59,2 % | 0–0 |
| Giravanz Kitakyushu – Thespa Gunma | 48 min avant | +0,24 / −0,46 | 52,5 % → 57,4 % | 4–3 |
| Fukushima United – Sagamihara | 48 min avant | +0,19 / −0,33 | 37,8 % → 41,3 % | 1–0 |

**Une journée entière (14 novembre 2026, 30 matchs).** 17 ont eu leur pronostic relu avant le coup d'envoi (la plupart à la lecture de 50 minutes). Pour 2 (Exeter City – Cheltenham Town, Real Sociedad B – Sporting Gijón), la source n'avait pas confirmé les onze 25 minutes avant et ne l'a fait qu'ensuite : le pronostic relu est arrivé deux minutes après le coup d'envoi ; la lecture de 10 minutes a été ajoutée pour eux. Pour 11 (8 de League One, 3 de League Two, tous à 15 h UTC), la source ne donnait toujours qu'un « dernier onze » non confirmé une minute après le coup d'envoi : ces matchs n'ont pas de pronostic relu, et aucune lecture de plus n'y changerait rien.

Ces matchs ne jugent rien de la justesse : elle se lira sur `agg.match_lineup_forecasts` (conservé après le match, avec l'heure du premier calcul de chaque pronostic) quand il y en aura quelques centaines.

Seules les compositions confirmées sont lues : le « dernier onze » ou le onze « probable » du fournisseur ne déplace pas le pronostic.

## La projection d'un championnat

Pour chaque championnat national en cours (au moins 8 clubs, tours réguliers seulement) : le classement actuel, puis les matchs restants **rejoués 1 000 fois** avec les lois ci-dessus. Chaque simulation classe les clubs aux points, à la différence de buts puis aux buts marqués ; la projection donne à chaque club ses points moyens en fin de saison et la part des simulations où il finit à chaque place (titre = première place).

La force d'un club n'est pas connue exactement et bougera d'ici la fin de saison : chaque simulation décale chaque force d'un tirage d'une loi normale d'écart-type **90 points Elo × √(part de ses matchs restant à jouer)**. Sans ce décalage, un leader de novembre était champion à 99,9 %.

### Vérification sur des saisons passées

Les 55 saisons de championnat complètes de 2024/2025 et 2025/2026 (12 clubs ou plus), rejouées depuis leur mi-parcours avec un modèle ajusté sur les saisons précédentes ; perte logarithmique de trois événements par club :

| Écart-type des forces | Titre | Quatre premiers | Trois derniers |
|---:|---:|---:|---:|
| 0 | 0,0970 | 0,2507 | 0,2593 |
| 30 | 0,0946 | 0,2478 | 0,2582 |
| 60 | 0,0956 | 0,2449 | 0,2543 |
| **90** | 0,0965 | **0,2406** | **0,2529** |
| 130 | 0,0987 | 0,2479 | 0,2605 |

90 points donnent la plus petite perte au total. À cette valeur, parmi les clubs annoncés champions entre 60 et 80 % (15 clubs, 68 % en moyenne), 73 % l'ont été.

## La projection d'une coupe européenne

Depuis 2024/2025, la Ligue des champions, la Ligue Europa et la Ligue Conférence commencent par une **phase de ligue** : 36 clubs, huit matchs chacun, un seul classement. Les huit premiers vont directement en huitièmes de finale, les 9ᵉ à 24ᵉ jouent des barrages, les 25ᵉ à 36ᵉ sont éliminés. Chacune de ces trois coupes est projetée tant que sa finale n'est pas jouée (code : `simulate_cup` dans [forecast.py](../../../backend/vega/forecast.py), table `agg.cup_stage_odds`, migration 122).

### La phase de ligue

Elle est rejouée comme un championnat (même modèle, mêmes 1 000 simulations, même décalage des forces), avec deux règles propres :

- **huit matchs par club** : un match à élimination directe peut apparaître dans la base avant que son tour soit nommé ; une fois qu'un club a ses huit matchs (joués, puis à jouer par date), tout match suivant n'est pas de la phase de ligue ;
- **classement** aux points, puis à la différence de buts, puis aux buts marqués, puis au hasard (les critères suivants du règlement, buts à l'extérieur, victoires, coefficient, ne sont pas lus).

Une coupe dont un club n'a pas d'Elo n'est pas projetée : ses matchs seraient rejoués avec une force nulle.

### Le tableau

Chaque simulation joue ensuite le tableau, selon le règlement UEFA :

| Tour | Qui rencontre qui |
|---|---|
| Barrages | 9ᵉ/10ᵉ contre 23ᵉ/24ᵉ, 11ᵉ/12ᵉ contre 21ᵉ/22ᵉ, 13ᵉ/14ᵉ contre 19ᵉ/20ᵉ, 15ᵉ/16ᵉ contre 17ᵉ/18ᵉ ; dans chaque paire, l'adversaire est tiré au sort ; le club le mieux classé reçoit au retour |
| Huitièmes | 1ᵉʳ/2ᵉ contre les vainqueurs des barrages 15ᵉ/16ᵉ – 17ᵉ/18ᵉ, 3ᵉ/4ᵉ contre ceux de 13ᵉ/14ᵉ – 19ᵉ/20ᵉ, 5ᵉ/6ᵉ contre ceux de 11ᵉ/12ᵉ – 21ᵉ/22ᵉ, 7ᵉ/8ᵉ contre ceux de 9ᵉ/10ᵉ – 23ᵉ/24ᵉ, tirés au sort |
| Quarts, demies | Tableau fixe selon la place en phase de ligue du club le mieux classé de chaque huitième : ordre 1, 8, 4, 5, 2, 7, 3, 6 ; le 1ᵉʳ et le 2ᵉ sont dans deux moitiés opposées |
| Finale | Un seul match, terrain neutre |

- **Matchs aller-retour** : le club le mieux classé en phase de ligue reçoit au retour ; l'avantage du terrain (60 points d'Elo) vaut pour chaque match.
- **Prolongation** : si les deux matchs (ou la finale) laissent les clubs à égalité, une prolongation est jouée avec **un tiers** des buts attendus d'un match.
- **Tirs au but** : à égalité après la prolongation, chaque club passe **une fois sur deux** (50/50). Ces deux règles ont été choisies le 16 novembre 2026.
- **Tours déjà tirés ou joués** : un tirage connu remplace le tirage au sort ; un match déjà joué compte avec son score réel (tirs au but compris) et seuls les matchs restants sont rejoués. Un tirage partiel des barrages garde les rencontres tirées et tire les clubs restants dans leurs paires.

Chaque club reçoit la part des simulations où il finit dans les huit premiers, de la 9ᵉ à la 24ᵉ place, au-delà de la 24ᵉ, puis où il joue les huitièmes, les quarts, les demies, la finale, et où il gagne. Sur 1 000 simulations, les parts d'un tour font toujours le nombre de clubs du tour : 16 en huitièmes, 8 en quarts, 4 en demies, 2 en finale, 1 vainqueur.

La route `/api/forecasts/season` rend alors `format: "league-phase"` et, pour chaque club, `stages` (`top8`, `playoff`, `out`, `r16`, `qf`, `sf`, `final`, `win`) ; sur le site, la vue « Projection » de la coupe en fait une colonne chacune, ombrée selon la part, et colore les huit premières places et les places 9 à 24 du classement projeté.

### Pas encore vérifié

Cette projection n'a pas encore été rejouée sur des saisons passées (2024/2025 et 2025/2026, les deux premières du format). La vérification prévue : rejouer chaque coupe depuis le milieu de sa phase de ligue avec un modèle ajusté avant, puis mesurer la perte logarithmique et le score de Brier des parts « huit premiers », « barrages », « huitièmes » et « vainqueur ».

## Les coupes nationales et les clubs sans Elo

Il n'y a qu'**un seul Elo de club** : tous les matchs d'un club, coupes comprises, le corrigent (§ 1 et 3 des [formules](../08-notes-vega/01-formules-et-raisons.md)). Il n'y a pas d'Elo à part pour les coupes ; la décision du 16 novembre 2026 a écarté la proposition d'un « Elo de coupe » rangé à part.

### Ce qui a été fait le 17 novembre 2026 (VI-21)

1. **Sources.** open-matchday ne lit plus ses 35 copies des championnats que PitchAPI tient : elles doublaient ses matchs sous d'autres noms (« Man City », « Paris »…). Les copies déjà lues (9 539 matchs de 2026/2027) sont supprimées avec l'accord de l'utilisateur. Restent lus : les 11 coupes nationales et les 19 championnats que PitchAPI n'a pas.
2. **Clubs professionnels des coupes.** 73 orthographes ont été revues une à une (« SC Freiburg », « Hamburg SV », « Sheffield Wed »…) et rattachées à leur club. Les noms proches d'autres clubs sont écartés exprès (« A. Salzburg », « C.F. Benfica », « Excelsior '31 »…). L'Irlande est écrite IRL des deux côtés.
3. **Elo unique.** Tous les matchs des championnats et coupes d'open-matchday et de la Coupe d'Allemagne entrent dans l'Elo. Un club que PitchAPI ne tient pas part :
   - du niveau de son championnat (pays et division lus dans le nom du dossier),
   - sinon du niveau des « clubs de coupe » de son pays, une division sous le plus bas championnat connu.
   
   Ensuite, chaque résultat corrige sa force comme pour tout club ([formules § 3](../08-notes-vega/01-formules-et-raisons.md)).

### Niveaux mesurés (Elo ± erreur, 17 novembre 2026, en mémoire)

| Groupe | Niveau |
|---|---:|
| National League (5ᵉ division anglaise) | 1237 ± 30 |
| National League North / South (6ᵉ) | 1158 ± 44 / 1084 ± 50 |
| Northern Premier League (7ᵉ) | 1133 ± 53 |
| Clubs de la FA Cup hors de ces divisions | 1094 ± 48 |
| Championship / League One / League Two écossaises | 1209 ± 48 / 1033 ± 61 / 896 ± 80 |
| Clubs de la Coupe d'Écosse hors championnats | 761 ± 91 |
| Championnat d'Ukraine | 1573 ± 44 |
| Championnat de Chypre | 1486 ± 61 |
| 2ᵉ division polonaise | 1416 ± 51 |
| Championnat du Kazakhstan | 1312 ± 65 |
| Championnat du pays de Galles | 1363 ± 98 |
| Clubs de coupe du Portugal, d'Allemagne, d'Espagne, d'Autriche, des Pays-Bas, de Suisse | 1360, 1382, 1295, 1237, 1189, 1058 |

### Deuxième étape (17 novembre 2026, après-midi)

170 orthographes des archives des coupes nationales d'OpenFootball (2024/2025) ont été revues et rattachées à leur club. Les noms proches d'autres clubs sont écartés exprès : « CF Benfica », « ASK Klagenfurt », « Austria Salzburg », « AC Paris 15 »… Une fois ces clubs reliés, l'Elo lit ces archives, la Coupe de France et les coupes américaines et mondiale des clubs.

L'Elo applique lui-même les fusions avant le passage quotidien d'identification. Mesuré avant la mise en service : 3 060 équipes classées ; les clubs de coupe allemands passent de 1379 à 1179, puisque le Bayern et Fribourg n'y comptent plus comme amateurs. Niveaux des groupes :

| Groupe | Niveau (± erreur) |
|---|---:|
| Clubs de coupe portugais | 1321 ± 37 |
| Clubs de coupe français | 1302 ± 38 |
| Clubs de coupe espagnols | 1298 ± 33 |
| Clubs de coupe néerlandais | 1208 ± 43 |
| Clubs de coupe allemands | 1179 ± 44 |
| Clubs de coupe autrichiens | 1153 ± 43 |
| Clubs de coupe anglais | 1132 ± 41 |
| Clubs de coupe suisses | 1044 ± 47 |
| Clubs de coupe écossais | 766 ± 90 |
| Championnat d'Uruguay | 1506 ± 34 |

### Pas encore fait

- La Ligue des champions africaine. Elle reste lue entre clubs connus : elle fixait des championnats africains sans autre lien (Égypte +104). Il faudrait d'abord une loi a priori propre à l'Afrique.
- Les clubs des seules archives historiques (7 520), que l'Elo ne lit pas.

## La projection des coupes nationales (17 novembre 2026)

Code : `knockout_projections` et `simulate_knockout` dans [forecast.py](../../../backend/vega/forecast.py), table `agg.cup_stage_odds` (migration 124), route `/api/forecasts/season` (`format: "knockout"`).

**Quelles coupes.** Une coupe est projetée quand son prochain tour est tiré et pas commencé, et que tous ses clubs sont entrés. Concrètement :

- **Le tour en jeu** est fait des matchs encore à jouer de l'édition : chaque club une fois, leur nombre une puissance de deux. Le match aller déjà joué d'une double confrontation en fait partie.
- **Un tour commencé attend le tirage suivant.** C'est le cas quand un autre match de l'édition a été joué 7 jours ou moins avant le premier match du tour.
- **Tous les clubs sont entrés** quand le tour n'en compte pas plus que celui où entrent les derniers :

  | Coupe | Derniers entrants | Seuil (clubs) |
  |---|---|---:|
  | FA Cup | 3ᵉ tour | 64 |
  | Coupe de la Ligue anglaise | 3ᵉ tour | 32 |
  | Coupe d'Italie | 8es de finale | 16 |
  | Coupe du Roi | 16es de finale | 32 |
  | Coupe des Pays-Bas | — | 32 |
  | Coupe de Suisse | — | 32 |
  | Coupe d'Écosse | — | 32 |
  | Coupe de la Ligue écossaise | — | 16 |
  | Coupes d'Allemagne, d'Autriche et du Portugal | — | 64 |

- **Tous les clubs ont un Elo.** Sinon la coupe attend, comme une coupe européenne.
- **La Coupe d'Allemagne** est lue chez OpenLigaDB, qui donne ses tours et ses tirs au but. La copie d'open-matchday n'est pas projetée.

**Le calcul.** Les tours restants sont rejoués 1 000 fois :

- les rencontres déjà tirées sont jouées telles quelles, et les matchs déjà joués comptent avec leur score ;
- chaque tour suivant est tiré au hasard, en un match, chez le premier tiré ;
- les demi-finales se jouent en deux matchs là où la coupe le prévoit (Coupe de la Ligue anglaise, Coupe d'Italie, Coupe du Roi, Coupe du Portugal) ;
- la finale se joue sur terrain neutre.

Comme pour les coupes européennes, une prolongation vaut un tiers de match et les tirs au but se jouent à 50/50 ; les deux codes partagent les mêmes règles de match (`_knockout_play`). La force d'un club peut bouger jusqu'au 30 juin : 90 points Elo × √(part de l'année qui reste), comme pour un championnat.

**Ce qui n'est pas modélisé :**

- le tableau fixe de la Coupe d'Italie : chaque tour y est tiré au hasard ;
- la règle qui fait recevoir le club de division inférieure (Allemagne, Autriche, Suisse) : seuls les tours déjà tirés la respectent ;
- les tirs au but d'open-matchday, que la source ne donne pas. Un tour où un match nul n'a pas de vainqueur connu n'est projeté qu'une fois le tour suivant tiré.

**Premier calcul.** Fait en lecture seule sur la base, avec les fusions de clubs du soir appliquées :

| Coupe | Tour en jeu | Favori |
|---|---|---|
| Coupe d'Allemagne | 8es | Bayern 56 % |
| Coupe de la Ligue anglaise | quarts | Manchester City 41 % |
| Coupe du Portugal | 16es | Sporting 33 %, Benfica 29 %, Porto 27 % |
| Coupe des Pays-Bas | 16es | PSV 31 % |
| Coupe d'Autriche | quarts | LASK 29 % |
| Coupe de Suisse | 8es | Lugano 19 % |
| Coupe de la Ligue écossaise | finale | Rangers 76 % |

La Coupe d'Italie attend la fusion de trois de ses clubs.

## Toutes les compétitions (17 novembre 2026, VI-19)

« Chaque compétition doit avoir ses prédictions » : depuis ce jour, le calcul des pronostics lit toutes les compétitions, quelle que soit leur source (PitchAPI, open-matchday, OpenLigaDB, OpenFootball, International Results).

- **Chaque match à jouer** entre deux équipes classées par l'Elo a son pronostic, même modèle que pour un match de championnat.
- **Un championnat d'une source complémentaire** (les 19 championnats d'open-matchday que PitchAPI n'a pas : National League, divisions écossaises et galloises, Ukraine, Chypre…) est rejoué jusqu'à son terme comme un championnat.
- **Une coupe** n'est jamais rejouée comme un championnat : ses tours le sont (coupes nationales, Ligue des nations).
- **Une source arrêtée.** Un match d'une source complémentaire encore « à jouer » plus de trois jours après sa date n'a pas de pronostic : sa source a cessé de suivre la compétition. C'est le cas de la Copa Libertadores 2026 d'OpenFootball, arrêtée aux barrages d'août.

Sur le site (maquette validée le 17 novembre) :

- Chaque match à venir de la liste d'une coupe montre son pronostic : une barre en trois parts (domicile, nul, extérieur), puis les trois parts. L'API le donne avec le match (`forecast`), lu par l'identifiant du match (migration 127 pour les tables d'open-matchday).
- Les 19 championnats d'open-matchday ont leur page depuis le 17 novembre (décision de l'utilisateur, sans maquette) :
  - leur classement, calculé à partir des résultats que donne la source (points, différence de buts, buts marqués, puis le nom ; aucune pénalité ni confrontation directe ne se lit dans les scores) ;
  - leurs matchs, chacun à venir avec son pronostic ;
  - leur projection, comme celle d'un championnat de la source principale.
  Un championnat que la source principale tient déjà (même nom, même pays) n'est jamais listé deux fois.

Pas encore couvert : l'Euro 2028 (les équipes ne sont pas encore qualifiées), les phases finales de la MLS et de la Liga MX (la source nomme encore « 2nd ranked » et « 3rd ranked » à la place des clubs).

## La projection de la Ligue des nations (17 novembre 2026)

Code : `nations_projections`, `simulate_nations` et `uefa_order` dans [forecast.py](../../../backend/vega/forecast.py), places de groupe dans `agg.cup_stage_odds` et vue `api.cup_team_groups` (migration 125), route `/api/forecasts/season` (`format: "nations"`). Sur le site : l'onglet « Projection » de la Ligue des nations, ligue par ligue.

**Quelles éditions.** La Ligue A (lue chez OpenLigaDB) et les Ligues B à D (lues chez International Results), à partir de 2026/2027. Chaque groupe se joue en aller-retour : une manche ni jouée ni annoncée est un match qui reste à jouer (International Results ne donne pas les matchs à venir). Une édition dont une sélection n'a pas d'Elo attend, comme une coupe.

**Le calcul.** Les matchs restants sont rejoués 1 000 fois d'après l'Elo de chaque sélection ; sa force peut bouger jusqu'au 30 juin (90 points × √(part de l'année qui reste)). Chaque groupe est classé comme l'UEFA le fait, et comme le classement du site :

1. les points ;
2. entre sélections à égalité : points, différence de buts et buts de leurs matchs entre elles, repris entre celles qui restent à égalité ;
3. puis différence de buts, buts, buts à l'extérieur, victoires et victoires à l'extérieur sur tout le groupe ;
4. une égalité qui reste est tirée au sort.

**Ligue A.** Les deux premiers de chaque groupe jouent les quarts : chaque premier contre un deuxième d'un autre groupe tiré au hasard, en aller-retour, le premier recevant au retour. Le Final Four se joue en un match sur terrain neutre. Comme pour les coupes, une prolongation vaut un tiers de match et les tirs au but se jouent à 50/50. Le site montre, par sélection : quarts (1ᵉʳ ou 2ᵉ), barrage (3ᵉ), relégation (4ᵉ), Final Four, finale et victoire.

**Ligues B à D.** Le site montre la chance de chaque place du groupe. Les groupes de la Ligue D comptent trois sélections : pas de 4ᵉ place.

**La saison de transition (2026–27), depuis le 17 novembre après-midi.** Dès 2028–29, la Ligue des nations compte trois ligues de 18 sélections ; les règles de montée et de descente de 2026–27 sont donc particulières. Les quatre ligues sont rejouées ensemble, parce que les barrages les relient :

| Ligue | 1ᵉʳ | 2ᵉ | 3ᵉ | 4ᵉ |
|---|---|---|---|---|
| A | quarts | quarts | les deux meilleurs restent, les deux moins bons jouent le barrage A/B | les deux meilleurs jouent le barrage A/B, les deux moins bons descendent |
| B | montent | barrage A/B | restent | barrage B/C |
| C | montent | barrage B/C | restent | restent |
| D | toutes les sélections montent en Ligue C (la Ligue D disparaît) | | | |

- Les troisièmes et quatrièmes de la Ligue A sont classés d'un groupe à l'autre : points, différence de buts, buts, buts à l'extérieur, victoires, victoires à l'extérieur, puis la liste d'accès (sans confrontation directe).
- Barrages en aller-retour, l'équipe de la ligue supérieure à domicile au retour. Le tirage du 20 novembre 2026 n'annonce ni têtes de série ni restrictions : tant qu'il n'est pas fait, les barrages sont tirés au hasard.
- **Le tirage réel.** Une fois les quarts et les barrages tirés, leurs rencontres sont celles du tirage, leurs matchs joués comptent tels quels.
- **Départage.** Le dernier critère est la liste d'accès 2026–27 (le classement final de 2024–25), jamais un tirage au sort. Les points disciplinaires viennent juste avant, mais les sources ne donnent pas les cartons : ce critère est sauté.
- Chaque sélection reçoit aussi la part de ses ligues en 2028–29 (A, B ou C) ; 18 sélections par ligue au total.
- Sur le site (maquette validée le 17 novembre), Ligue A : Quarts, Maintien, Barrage A/B, Relégation directe, « En A 2028–29 », puis Final Four, Finale, Vainqueur. Ligues B à D : chaque place avec son issue (« 1er · monte », « 2e · barrage A/B »…), puis la ligue en 2028–29.

**Ce qui n'est pas modélisé :** les points disciplinaires (pas de cartons dans les sources).

**Premier calcul.** Fait en local avec le code du worker sur les données lues le 17 novembre (lecture seule), 4 000 tirages :

| Ligue | Ce qui ressort |
|---|---|
| A | Vainqueur : Espagne 26 %, Angleterre 23 %, France 18 %. Dernière place qualificative : Danemark 68 %, Norvège 32 %. |
| B | 1ᵉʳ de groupe : Suisse 96 %, Autriche 73 %, Suède 69 %, Irlande du Nord 58 %. |

Contrôle : sur la Ligue A, les parts somment à 8 quarts de finaliste, 4 demi-finalistes, 2 finalistes et 1 vainqueur ; sur les Ligues B à D, à une sélection par place et par groupe.

## Minute par minute

La fiche d'un match joué trace « Probabilité de victoire » : les chances de victoire, de nul et de défaite minute par minute ([inplay.py](../../../backend/vega/inplay.py), `/api/forecasts/live`).

**Ce n'est pas un suivi en direct.** La base ne reçoit rien d'un match pendant qu'il se joue : la source n'a pas de direct, et le score est lu pour la première fois 105 minutes après le coup d'envoi. Le 14 novembre 2026, les 24 matchs en cours à 15 h 37 UTC étaient tous encore « à jouer » dans la base, sans score ni événement, et la route répondait 404 pour chacun. La courbe paraît donc quand le match est lu, en pratique à son coup de sifflet final. Le jour où un fournisseur de direct alimentera le circuit (il existe, sans fournisseur, voir `backend/README.md`, « Live »), la courbe se tracera pendant le match : la route rend pour un match que la base n'a pas encore lu son point du coup d'envoi et le modèle, et le site le prolonge avec les buts et les expulsions du direct, par le même calcul (`dashboard/shared/inplay.js`), jusqu'à ce que la base ait les événements du match. Si les buts du direct ne donnent pas son score, rien n'est tracé.

À une minute donnée, avec le score et les expulsions du moment :

- les buts encore à venir de chaque équipe suivent une loi de Poisson de moyenne `λ × R(minute) × facteur d'expulsion`, où `λ` est le nombre de buts attendus du pronostic d'avant-match (les deux Elo d'avant le match) ;
- `R(minute)` est la part des buts d'un match marqués après cette minute, lue sur les buts de la base par quart d'heure, les buts d'après la 90e minute comptés à part et étalés sur 8 minutes de temps additionnel ;
- une équipe réduite à dix marque `down` fois son rythme et son adversaire `up` fois, les deux mesurés sur ce que les équipes marquent après un carton rouge, rapportés à ce qu'elles marquent à onze contre onze ;
- **à partir de la 60ᵉ minute** (version 2, 14 novembre 2026), une équipe qui mène marque `ahead` = 1 − t fois son rythme et une équipe menée `behind` = 1 + t fois ; t est le nombre, de 0 à 0,4 par pas de 0,025, qui rend les résultats des matchs de la base les plus probables, lus aux 60ᵉ, 75ᵉ et 85ᵉ minutes sur 5 000 matchs. Un score à égalité ne change aucun rythme ;
- le score final est le score du moment plus ces buts ; les petits scores finaux gardent la correction du pronostic, si bien qu'au coup d'envoi les trois probabilités sont celles du pronostic.

Les forces de départ sont les deux Elo d'avant le match ; quand le match a un pronostic relu avec ses compositions confirmées, ce sont celles de ce pronostic (Elo, forme et écart du onze).

Les buts sont comptés pour l'équipe à qui la source les attribue. Le score que la source écrit sur un événement de but n'est pas lu : c'est celui d'avant le but dans certains matchs, d'après dans d'autres. Un match n'entre dans l'ajustement, et n'a de courbe, que si ses événements de but donnent son score final. Le dernier point d'un match terminé est son résultat. À côté du graphique, chaque but est suivi de ce qu'il a changé : les chances de victoire de l'équipe qui marque, la minute d'avant et à la minute du but. Pour un match lu avant sa fin (une lecture à la 105ᵉ minute d'un match qui joue encore), l'heure est la dernière minute que la source a mesurée (momentum ou événement).

### Vérification sur des matchs non vus (12 novembre 2026)

Ajusté sur 16 326 matchs de clubs de 2025/2026 (43 877 buts, 3 040 matchs avec expulsion) : parts des buts par quart d'heure 12,8 % · 13,7 % · 18,0 % (temps additionnel de la première période compris) · 16,2 % · 15,8 % · 16,0 %, et 7,5 % après la 90e minute ; à dix, une équipe marque 0,59 fois son rythme et son adversaire 1,73 fois. Jugé sur les 11 420 matchs de 2026/2027 :

| Minute | 0 | 15 | 30 | 45 | 60 | 75 | 85 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Perte logarithmique (trois issues) | 1,021 | 0,973 | 0,917 | 0,835 | 0,738 | 0,584 | 0,426 |

À la 60e minute, par dixième de probabilité de victoire à domicile (annoncé → observé) : 0,04 → 0,06 ; 0,14 → 0,16 ; 0,26 → 0,26 ; 0,34 → 0,36 ; 0,44 → 0,47 ; 0,55 → 0,54 ; 0,66 → 0,62 ; 0,75 → 0,71 ; 0,84 → 0,80 ; 0,97 → 0,96. Juste après une première expulsion (1 349 matchs), l'équipe réduite à dix est annoncée gagnante, à égalité ou perdante dans 18,7 % / 21,0 % / 60,3 % des cas ; elle l'est dans 18,0 % / 23,0 % / 59,0 %.

Ces chiffres sont ceux de la version 1, qui ne lisait pas le score : passé l'heure de jeu, une équipe qui menait l'emportait 3 à 5 points moins souvent qu'annoncé.

### Version 2 : l'équipe qui mène (14 novembre 2026)

Facteurs ajustés sur 21 626 matchs de 2025/2026 (t = 0,15 : 0,85 et 1,15), jugés sur les 11 430 matchs de 2026/2027. « Annoncé » est la probabilité moyenne de victoire de l'équipe qui mène à cette minute, « joué » la part de ces matchs qu'elle a gagnés :

| Minute | 15 | 30 | 45 | 60 | 75 | 85 |
| --- | --- | --- | --- | --- | --- | --- |
| Perte logarithmique, version 1 | 0,9736 | 0,9171 | 0,8348 | 0,7379 | 0,5840 | 0,4258 |
| Perte logarithmique, version 2 | 0,9731 | 0,9161 | 0,8323 | 0,7345 | 0,5822 | 0,4251 |
| Annoncé, version 1 | 0,681 | 0,713 | 0,764 | 0,815 | 0,875 | 0,923 |
| Annoncé, version 2 | 0,646 | 0,678 | 0,728 | 0,777 | 0,852 | 0,910 |
| Joué | 0,654 | 0,686 | 0,730 | 0,780 | 0,853 | 0,910 |

L'écart de 3 à 5 points est ramené à moins d'un point à chaque minute. Ajustés sur les deux saisons, comme en production, les facteurs sont 0,90 et 1,10. Ils sont gardés jusqu'à ce que la base ait 10 % de matchs en plus (leur recherche prend une dizaine de secondes).

Deux essais écartés. Deux facteurs libres au lieu d'un : les résultats ne les distinguent pas (0,85 et 1,10, 0,95 et 1,10 ou 1,15 et 1,20 donnent presque la même vraisemblance). Les facteurs appliqués dès le coup d'envoi : les minutes 15 à 30 étaient moins bien annoncées qu'avec la version 1.

Le modèle ne connaît que le score, l'heure et les expulsions : ni la pression, ni les occasions, ni les changements.

## Le calendrier à venir

La colonne « Adv. à venir » de la projection lit les pronostics des matchs restant à jouer de l'édition (`api.schedule_forecasts`, la route `/api/forecasts/season` rend `next` pour chaque club) :

- les cinq prochains matchs de championnat du club, par date ;
- `opponentLevel` : la moyenne des forces (Elo avant le match) de ces adversaires ;
- `expectedPoints` : la somme, sur ces matchs, de 3 × P(victoire) + P(nul) du pronostic, qui tient compte du terrain ;
- `home` : le nombre de ces matchs joués à domicile ;
- `rank` : le rang de ce calendrier parmi les clubs qui ont encore cinq matchs, 1 pour la moyenne d'adversaires la plus haute. Un club à qui il en reste moins n'est pas classé.

Le niveau des adversaires ne dit rien du club lui-même : deux clubs au même calendrier n'en attendent pas les mêmes points.

## Limites

- Les colonnes « 4 premiers » et « 3 derniers » sont des places, pas les zones du règlement de chaque championnat (qualifications européennes, barrages, nombre de relégués).
- Un championnat à phases (tournois d'ouverture et de clôture, play-offs) est projeté sur ses seuls tours réguliers.
- Les coupes nationales et les compétitions internationales autres que les trois coupes européennes ne sont pas projetées (voir « Les coupes nationales et les clubs sans Elo »).
- Les forces de deux championnats hors de l'échelle commune ne se comparent pas ; cela ne gêne pas un championnat national, dont tous les clubs sont sur la même échelle.
- La forme récente et les compositions ne déplacent que le pronostic d'un match ; la projection d'un championnat et les points attendus de la colonne « Adv. à venir » au-delà de quatorze jours lisent les forces seules.
- Calculé avec les modèles quotidiens de la saison (après l'Elo) : au plus tard une fois par jour, et dans l'heure qui suit un match terminé.

## Les cotes des bookmakers

Pour un match à venir, la fiche montre les cotes « résultat final » des bookmakers agréés en France (1, N, 2), lues une fois par jour ([odds.py](../../../backend/vega/sources/odds.py)).

- **Chances implicites d'un bookmaker** : $p_i = \dfrac{1/c_i}{\sum_j 1/c_j}$ pour chaque issue $i$ de cote $c_i$. La somme $\sum_j 1/c_j - 1$ est sa **marge** ; la diviser l'enlève.
- **Chances du marché** : la moyenne de ces chances sur les bookmakers.
- **Cote juste de Vega** : $1 / p$, la cote sans marge que donnerait le pronostic Vega (§ ci-dessus). Elle se lit à côté des cotes des bookmakers ; le site ne recommande aucun pari.
- **Ouverture** : la première cote lue de chaque bookmaker reste en mémoire, pour voir comment elle a bougé.
- Le message de prévention exigé en France accompagne chaque affichage de cotes.

