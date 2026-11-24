# Accueil

Calculs dans [home-insights.js](../../../dashboard/frontend/src/services/home-insights.js) ; la version servie par l'API est la requête SQL de [home.mjs](../../../backend/api/src/routes/home.mjs), qui reproduit les mêmes règles.

## Semaine affichée

`matchdayWindow` ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L92)) :
- par défaut, la **semaine du lundi au dimanche** en cours, en heure de Paris (jours calendaires, pour rester juste lors des changements d'heure) ;
- si cette semaine n'a encore **aucun résultat** (lundi matin, trêve internationale) et que le dernier résultat date de **moins de 14 jours**, on garde la dernière semaine jouée (drapeau `latest`) ;
- une saison archivée affiche sa dernière semaine jouée.

Un match compte dans la semaine si son jour (Paris) est dans la fenêtre, n'est pas postérieur à aujourd'hui, et si son coup d'envoi explicite est déjà passé.

## Poids éditorial d'un match

`matchWeight` sert à ordonner le fil des résultats et les matchs à venir :

$$
\text{poids} = 2 \times (\text{gros clubs}) + \begin{cases}3 & \text{Ligue des champions}\\ 1 & \text{Europa / Conférence}\\ 0 & \text{sinon}\end{cases} + [\text{Top 5}] + [\text{rang domicile} \le 3] + [\text{rang extérieur} \le 3]
$$

« Gros clubs » : nombre d'équipes du match (0, 1 ou 2) dans la liste `FEATURED_CLUB_IDS` de [home.js](../../../dashboard/frontend/src/services/home.js#L33) (29 clubs : Arsenal, PSG, Real Madrid, Bayern, Inter, Benfica, Ajax…). Les rangs viennent des tableaux de l'accueil.

C'est `api.home_weight_v1` ([044_home_settings.sql](../../../backend/sql/044_home_settings.sql)). Il ordonne toujours le fil des résultats, le choc de la semaine et `highlights` ; seul « À l'affiche » lit l'importance v2 ci-dessous (VI-48).

## Importance d'un match (v2)

`api.home_importance_v2` ([168_home_importance_v2.sql](../../../backend/sql/168_home_importance_v2.sql), VI-48 / #69) remplace la liste de clubs par un score général :

$$
\text{importance} = \text{enjeu} \times \text{niveau} + \text{équilibre}
$$

- **enjeu** = prestige de la compétition × multiplicateur du tour, les valeurs de l'Elo ([power.py](../../../backend/vega/power.py), `PRESTIGE`, `STAGE`, `round_of`) : Coupe du monde 1,30, Ligue des champions 1,15, Ligue Europa 1,08, Ligue Conférence 1,04, sinon 1 ; ×1,05 dès le premier tour à élimination directe, ×1,10 en demi-finale, ×1,15 en finale (un tour de phase « regular » est ordinaire quel que soit son nom). Les valeurs sont des lignes de `core.home_stakes` ; un test les compare à power.py ([test_home_importance.py](../../../backend/tests/test_home_importance.py)) et la classification des tours à `round_of`. Le prestige des coupes complémentaires (`CUP_PRESTIGE`) n'y est pas : `api.fixtures` ne contient aucune de leurs éditions ;
- **niveau** = (moyenne des deux notes − centre) / diviseur. La note d'une équipe : son Elo de la saison (`agg.team_power`), sinon le niveau de son championnat cette saison (`agg.league_levels`, le plus haut s'il y en a plusieurs), sinon celui de la compétition du match, sinon le centre (terme nul, jamais NULL). Centre et diviseur sont une ligne de `core.home_level_scales` par périmètre : `clubs` 1400 et 100 ; `nations` (les deux équipes sont des sélections) **provisoirement** les mêmes valeurs, en attendant le changement d'échelle de l'Elo des sélections, qui se fera par une migration de données sur cette ligne ;
- **équilibre** = 1 − |p_dom − p_ext| : les probabilités du pronostic du match (`agg.match_forecasts`) s'il existe ; sinon le score attendu de l'Elo, $E = 1/(1 + 10^{(R_\text{ext} − R_\text{dom} − h)/400})$ avec l'avantage du terrain du calcul Elo (`agg.power_runs.elo_home_advantage`, 60 ; 0 sur terrain neutre), si les deux équipes ont une note ; sinon 0,5.

Exemples (graine des tests) : finale de Ligue des champions entre deux clubs à 1900 et 1800 : 1,3225 × 4,5 + 0,57 = **6,52** ; deux clubs sans Elo d'un championnat de niveau 1500 : 1 + 0,83 = **1,83** ; rien de connu : **0,5**. Ordres de grandeur mesurés sur la production (23 nov. 2026, API publique) : Arsenal–Dortmund (LdC) 6,93, Liverpool–Manchester United 5,27, un match de Ligue 2 1,6 à 1,9.

L'API arrondit l'importance à 2 décimales (`weight`, `weight2`) ; les tris lisent la valeur exacte.

## À l'affiche

Clé `billboard` de `/api/read/home` : les matchs du périmètre du visiteur (mêmes `leagues` et même saison que le reste de la lecture) dont le **jour à Paris** va d'hier à aujourd'hui + 3 (5 jours), terminés, en cours ou à venir (un match reporté ou annulé n'y est pas). Chaque jour garde ses **8** matchs les plus importants. Ordre : jour ↑, importance ↓, coup d'envoi ↑, identifiant. Chaque match a ses champs habituels (`fixture`), `time`, `day` (jour à Paris), `weight` (importance v2) et `forecast` (domicile / nul / extérieur) quand il y a un pronostic. Les bornes et le plafond sont des données : `api.home_rules_v2`.

Les matchs à venir (`highlights`) gardent l'ordre du poids éditorial v1 et portent aussi `weight2`, leur importance v2.

Sur la page, le bloc « À l'affiche » (titre « Les matchs du moment ») remplace « À ne pas manquer », même place et même dessin : `chooseBillboard` ([home-upcoming.js](../../../dashboard/frontend/src/services/home-upcoming.js)) garde les règles des favoris (3 places au plus, la grande carte au match d'un favori dans les 48 h) ; sinon la grande carte est le match **non terminé** le plus important (`weight` servi), et les 4 autres places vont aux plus importants suivants, terminés ou non, rangés par coup d'envoi ; un match terminé montre son score à la place de l'heure. Sans `billboard` servi (ancienne publication), ou si la fenêtre n'a plus rien à jouer, le choix d'avant (`highlights`, titre « Les 7 prochains jours ») reste.

## Coin d'un pays

`/api/read/home-local?season=AAAA/AAAA&country=XXX` (code à trois lettres majuscules, sinon 400 ; aucun paramètre personnel ni `leagues`) : lecture commune, mise en cache comme l'accueil (une copie par pays) :
- `competitions` : les compétitions de ce pays présentes dans la saison (`api.editions`), avec leur niveau quand il est connu, la plus haute d'abord ;
- `window` : les bornes utilisées, d'hier à aujourd'hui + **7** jours à Paris (`api.home_rules_v2` ; plus large qu'« À l'affiche » : un lundi, la première division d'un pays ne joue souvent pas avant le vendredi) ;
- `matches` : leurs matchs de cette fenêtre, mêmes champs et même ordre qu'« À l'affiche », au plus 16 par jour ;
- `table` : les 6 premiers du classement (`api.standing_rows`, sans phase ni groupe) du championnat le plus haut du pays qui a un niveau ; `null` sinon.

Un code bien formé sans compétition répond 200 avec des listes vides. La sélection nationale du pays n'y est pas : l'API n'a pas de lien fiable entre un pays et sa sélection.

Sur la page, c'est la bande « Chez vous », sous celle des résultats, dessinée comme elle ([HomeMatchday.jsx](../../../dashboard/frontend/src/components/HomeMatchday.jsx), `HomeLocal`) : les `matches` servis (la sélection de l'API reste), groupés par jour et, dans un jour, rangés par coup d'envoi (puis identifiant du match), le score une fois joué, l'heure de Paris avant. `table` n'est pas affichée pour l'instant. Le pays ([home-country.js](../../../dashboard/frontend/src/services/home-country.js)) : le choix du visiteur (`homeCountry` dans `orion.preferences.v1`, recopié dans le cookie `vega.home.v1`), sinon le pays détecté par l'hébergeur (`x-vercel-ip-country`, lu par le serveur de la page, sinon `/api/visitor-country`, code ISO à deux lettres traduit par une table : GB → ENG, DE → GER…), sinon rien. « Ne rien afficher » (`none`) cache la bande. Le menu liste les pays des compétitions du manifeste ; les codes INT, INT-2, UEFA ne sont jamais un pays. Le même menu est toujours dans le panneau des préférences de l'accueil (bouton des compétitions, ligne « Chez vous »), appliqué tout de suite : c'est le chemin de retour quand la bande est cachée. Un pays choisi à la main sans match dans la fenêtre garde la tête de la bande (« Chez vous » et son bouton) avec une ligne « Aucun match d’ici 7 jours » ; un pays seulement détecté sans match ne montre rien. La bande n'apparaît pas sans pays, sur une saison archivée, ou si le manifeste n'annonce pas `compactReads["home-local"]`. Les favoris n'y entrent jamais.

La saison lue est celle de la page (`season=2026/2027` par défaut) : pour un pays à saison civile comme le Brésil, elle désigne l'édition 2026 (vérifié en production le 24 novembre 2026).

« Course au titre » s'ouvre sur le championnat du pays du visiteur quand il est parmi ses onglets (`initialTitleRace`), sinon sur la Ligue 1 comme avant.

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
