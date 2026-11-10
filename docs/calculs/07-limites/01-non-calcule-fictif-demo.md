# Non calculé ou fictif

Tout chiffre du site n'est pas un calcul sur données réelles. Cette page liste ce qui ne l'est pas, pour ne pas le confondre avec le reste.

## Fourni tel quel par une source

| Valeur | Source | Note |
| --- | --- | --- |
| xG, npxG, xG en jeu / CPA, xGOT, xA, buts évités | PitchAPI | aucun modèle Vega |
| Note du match | PitchAPI | pas une note Vega validée |
| Classement FIFA, coefficients UEFA clubs et associations | FIFA, UEFA, SportsAPI | collectés par le worker (`backend/vega/sources/fifa.py`, `uefa.py`) |
| Classements officiels (fournisseur, UEFA) | fournisseurs | contrôlés, jamais recalculés |
| Palmarès | Wikipédia / Wikidata | voir [PLAYER_HONOURS.md](../../PLAYER_HONOURS.md) |
| Archives de buts historiques | schochastics/football-data | voir [HISTORICAL_GOALS.md](../../HISTORICAL_GOALS.md) |

## Pas encore calculé

- **Victoires attendues** : le modèle les produit (`outcomeChances`), mais elles ne sont ni conservées ni affichées (voir [xPts](../03-resultats-et-points-attendus/01-points-attendus-xpts.md)).
- **Projection entre championnats** (indice ajusté au niveau d'un autre championnat) : pas de modèle. L'onglet Projection compare les indices tels quels ([Compatibilité par niveau](../05-joueurs/06-compatibilite-par-niveau.md)).
- **Compatibilité athlétique** : aucune source de suivi physique, non affichée.

## Données fictives (badge « Données fictives » / « Fictif »)

Ces blocs affichent des valeurs d'exemple de la maquette, sans aucun calcul sur les données réelles :

**Profil joueur** ([PlayerScoutDemo.jsx](../../../dashboard/frontend/src/components/PlayerScoutDemo.jsx))
- âge, taille, poids, pied fort, fin de contrat et clause ;
- valeur marchande, tendance, fourchette, historique de valeur, zone « revente, clause, intérêts » ;
- **potentiel** (à côté de l'indice Vega réel) et historique de l'indice Vega par saison ;
- blessures, suspensions, disponibilité ;
- profil de jeu et contexte d'équipe ;
- lignes « sécurité de balle » (fautes subies, pertes de balle, fautes) ;
- données physiques ;
- **saison précédente** dans les comparaisons : centiles fabriqués à partir des centiles actuels par `fakePreviousSeason` (`centile − 6 + ((rang de l'axe × 7) mod 11)`, borné à [1, 99]) — ce ne sont pas des données de la saison précédente.

**Profil club** ([ClubScoutTabs.jsx](../../../dashboard/frontend/src/components/ClubScoutTabs.jsx))
- valeur estimée de l'effectif et bloc « Effectif » de la colonne d'identité ;
- profil d'âge de l'effectif (part des minutes par tranche d'âge).

## Ancien code non utilisé

[club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js) exporte encore `clubStyleCohort`, `clubCentile`, `orientedCentile`, `cohortMedian`, `similarClubs` et `headToHead`, qui ne sont appelés par aucune page. Les centiles et la similarité club en vigueur sont ceux de [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js).
