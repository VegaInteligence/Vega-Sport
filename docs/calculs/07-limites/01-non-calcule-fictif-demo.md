# Non calculé, fictif ou démo

Tout chiffre du site n'est pas un calcul sur données réelles. Cette page liste ce qui ne l'est pas, pour ne pas le confondre avec le reste.

## Fourni tel quel par une source

| Valeur | Source | Note |
| --- | --- | --- |
| xG, npxG, xG en jeu / CPA, xGOT, xA, buts évités | PitchAPI | aucun modèle Vega |
| Note du match | PitchAPI | pas une note Vega validée |
| Classement FIFA, coefficients UEFA clubs et associations | FIFA, UEFA, SportsAPI | voir [RANKINGS.md](../../RANKINGS.md) |
| Classements officiels (fournisseur, UEFA) | fournisseurs | contrôlés, jamais recalculés |
| Palmarès | Wikipédia / Wikidata | voir [PLAYER_HONOURS.md](../../PLAYER_HONOURS.md) |
| Archives de buts historiques | schochastics/football-data | voir [HISTORICAL_GOALS.md](../../HISTORICAL_GOALS.md) |

## Pas encore calculé

- **Classement Ballon d'Or Vega** : `ballonDorRanking` renvoie `null`. La méthode (excellence relative par rôle, Elo des équipes, percentiles 75 / 25) est une proposition non implémentée et non calibrée : [METHODE_CLASSEMENT_BALLON_D_OR.md](../../METHODE_CLASSEMENT_BALLON_D_OR.md).
- **Victoires attendues** : le modèle les produit (`outcomeChances`), mais elles ne sont ni conservées ni affichées (voir [xPts](../03-resultats-et-points-attendus/01-points-attendus-xpts.md)).
- **Force des équipes de type Elo** : aucune. Le seul « niveau » de club est le score de démo ci-dessous.
- **Projection entre championnats** : bloc d'exemple de la maquette.

## Démonstration locale (calibrations non ajustées)

- **Pool européen et niveau des clubs** : lus depuis `public/demo/europe-clubs.json`, généré par [demo-europe-clubs.mjs](../../../dashboard/frontend/scripts/demo-europe-clubs.mjs). Les décalages par ligue (0 à −1,20), le coefficient 0,8, le 0,6 × ln(coef / 15), le partage 50 / 50 et les planchers d'association sont des **calibrations de démo** « à ajuster sur des résultats » ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L299)). Ils servent au référentiel « Europe » du profil club et à l'option « Clubs de niveau comparable » du profil joueur.

## Données fictives (badge « Données fictives » / « Fictif »)

Ces blocs affichent des valeurs d'exemple de la maquette, sans aucun calcul sur les données réelles :

**Profil joueur** ([PlayerScoutDemo.jsx](../../../dashboard/frontend/src/components/PlayerScoutDemo.jsx))
- âge, taille, poids, pied fort, fin de contrat, clause, part du temps de jeu de la fiche ;
- valeur marchande, tendance, fourchette, historique de valeur, zone « revente, clause, intérêts » ;
- **potentiel** (à côté de l'indice Vega réel) et historique de l'indice Vega par saison ;
- blessures, suspensions, disponibilité ;
- profil de jeu, contexte d'équipe, carte de chaleur ;
- lignes « sécurité de balle » (fautes subies, pertes de balle, fautes) ;
- données physiques, projection entre championnats ;
- **saison précédente** dans les comparaisons : centiles fabriqués à partir des centiles actuels par `fakePreviousSeason` (`centile − 6 + ((rang de l'axe × 7) mod 11)`, borné à [1, 99]) — ce ne sont pas des données de la saison précédente.

**Profil club** ([ClubScoutTabs.jsx](../../../dashboard/frontend/src/components/ClubScoutTabs.jsx))
- valeur estimée de l'effectif et bloc « Effectif » de la colonne d'identité ;
- profil d'âge de l'effectif (part des minutes par tranche d'âge).

## Ancien code non utilisé

[club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js) exporte encore `clubStyleCohort`, `clubCentile`, `orientedCentile`, `cohortMedian`, `similarClubs` et `headToHead`, qui ne sont appelés par aucune page. Les centiles et la similarité club en vigueur sont ceux de [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js).
