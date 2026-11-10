# Classements calculés

Vega affiche un classement officiel quand il en dispose (fournisseur, UEFA). Sinon, il calcule un **classement dérivé des résultats**, explicitement présenté comme tel. Ce calcul ne connaît ni les pénalités de points, ni les décisions administratives, ni les règles de confrontation directe propres à chaque ligue.

## Points

Victoire 3, nul 1, défaite 0. Seuls les matchs `finished` aux deux scores entiers ≥ 0 comptent.

## Classement d'un championnat

`standingsFromFixtures` dans [competition-standings.js](../../../dashboard/frontend/src/services/competition-standings.js#L59).

1. Un match en double est dédoublonné par identifiant ; la version terminée l'emporte.
2. Un match sans équipe valide, ou d'une équipe contre elle-même, est écarté (`excluded`).
3. Ordre : **points**, puis **différence de buts**, puis **buts marqués**, puis nom (ordre alphabétique français).
4. `complexSchedule` signale qu'une paire d'équipes s'est rencontrée plus de deux fois (phases de play-offs, poules multiples).

Ce classement est affiché ([CompetitionStandings.jsx](../../../dashboard/frontend/src/components/CompetitionStandings.jsx#L497)) :
- pour les ligues de la liste `SIMPLE_LEAGUES` (championnats à phase unique) ;
- ou quand le calendrier est un **aller-retour complet** : au moins 3 équipes, chaque paire jouée exactement deux fois, une fois à domicile chacune (`hasCompleteHomeAwaySchedule`).

## Tableaux de l'accueil

`leagueProgress` dans [home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L341) et son équivalent SQL dans [home.mjs](../../../backend/api/src/routes/home.mjs) suivent le même ordre et ajoutent :
- **points cumulés après chaque match** (ordre chronologique du coup d'envoi) ;
- **forme** : les 5 derniers résultats ;
- **série en cours** : nombre de victoires consécutives en fin de liste ;
- **matchs sans encaisser** ;
- **nombre de journées** d'une saison complète : `2 × (équipes − 1)`.

## Classement d'un club dans son profil

`rankCohort` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1360) : même ordre (points, différence, buts marqués, nom). Dans un référentiel qui mêle plusieurs ligues, chaque valeur est **divisée par le nombre de matchs** avant de comparer, car les clubs n'ont pas joué le même nombre de matchs.

## Ligue des nations (phase de groupes)

`nationsStandings` dans [nations-standings.js](../../../dashboard/frontend/src/services/nations-standings.js#L31) applique des départages successifs :

1. **Points.**
2. À égalité de points : **mini-classement des confrontations directes** entre les équipes à égalité (points, différence, buts marqués dans ces matchs), appliqué de nouveau à tout sous-groupe encore à égalité.
3. Si cela ne départage pas : **différence de buts générale**, **buts marqués**, **buts marqués à l'extérieur**, **victoires**, **victoires à l'extérieur**.
4. Une égalité restante reste affichée comme égalité (`tied`, `unresolved`), sans tirage arbitraire.

## Classements officiels UEFA

Les tableaux UEFA sont repris tels quels, après contrôle ([uefa-standings.js](../../../dashboard/frontend/src/services/uefa-standings.js)) : rangs uniques, `joués = V + N + D`, `différence = buts pour − buts contre`, nombre de groupes et de lignes attendu. Une ligne incohérente rejette tout le tableau plutôt que d'afficher un classement faux.

## Ce que les classements dérivés ne savent pas faire

- retraits de points, matchs sur tapis vert ;
- départages par confrontation directe des championnats qui l'utilisent (LaLiga, Serie A…) ;
- phases finales, poules de relégation, play-offs.

Pour ces compétitions, seule une source de classement dédiée est fiable.
