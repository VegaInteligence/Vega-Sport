# Non calculé ou fictif

Tout chiffre du site n'est pas un calcul de Vega. Cette page liste ce qui est fourni tel quel ou pas encore calculé, pour ne pas le confondre avec le reste.

## Fourni tel quel par une source

| Valeur | Source | Note |
| --- | --- | --- |
| xG, npxG, xG en jeu / CPA, xGOT, xA, buts évités | PitchAPI | aucun modèle Vega |
| Classement FIFA, coefficients UEFA clubs et associations | FIFA, UEFA, SportsAPI | collectés par le worker (`backend/vega/sources/fifa.py`, `uefa.py`) |
| Classements officiels (fournisseur, UEFA) | fournisseurs | contrôlés, jamais recalculés |
| Palmarès | Wikipédia / Wikidata | voir [PLAYER_HONOURS.md](../../PLAYER_HONOURS.md) |
| Archives de buts historiques | schochastics/football-data | voir [HISTORICAL_GOALS.md](../../HISTORICAL_GOALS.md) |

La note de match du joueur est calculée par Vega sur 100. [Formule et provenance](../02-metriques-attendues/04-note-du-match.md)

## Pas encore calculé

- **Victoires attendues** : le modèle les produit (`outcomeChances`), mais elles ne sont ni conservées ni affichées (voir [xPts](../03-resultats-et-points-attendus/01-points-attendus-xpts.md)).
- **Projection entre championnats** (indice ajusté au niveau d'un autre championnat) : pas de modèle. L'onglet Projection compare les indices tels quels ([Compatibilité par niveau](../05-joueurs/06-compatibilite-par-niveau.md)).
- **Compatibilité athlétique** : le suivi physique ne couvre que certaines compétitions (§ 8.2 des formules) ; pas de compatibilité calculée.

## Données fictives

Plus aucune depuis le 16 novembre 2026. Les derniers blocs de maquette (effectif du club, physique, profil de jeu, contexte d'équipe, saison précédente des comparaisons) sont calculés sur les données collectées : voir [Formules et raisons, § 8](../08-notes-vega/01-formules-et-raisons.md). Les pages de maquettes (`/maquettes`) ont été retirées du site.

## Ancien code non utilisé

[club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js) exporte encore `clubStyleCohort`, `clubCentile`, `orientedCentile`, `cohortMedian`, `similarClubs` et `headToHead`, qui ne sont appelés par aucune page. Les centiles club en vigueur sont ceux de [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js) ; la similarité club, celle de la route `/api/teams/{id}/similar` ([04-style-et-similarite](../04-clubs/04-style-et-similarite.md)).
