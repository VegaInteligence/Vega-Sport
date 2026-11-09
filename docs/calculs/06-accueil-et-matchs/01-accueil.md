# Accueil

Calculs dans [home-insights.js](../../../dashboard/frontend/src/services/home-insights.js) ; la version servie par l'API est la requête SQL de [relational-home.js](../../../dashboard/backend/services/relational-home.js), qui reproduit les mêmes règles.

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
