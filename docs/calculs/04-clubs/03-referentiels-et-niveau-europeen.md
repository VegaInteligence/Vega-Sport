# Référentiels et niveau européen

Un club peut être comparé à autre chose que son championnat : une ou plusieurs compétitions choisies, l'Europe entière, ou les clubs de niveau proche.

## Changer de référentiel (`rebase`)

`rebase` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1451) réunit les clubs de plusieurs cohortes, puis recalcule positions, centiles, rangs, phases et indice Vega sur ce nouvel ensemble.

- Si le club joue dans le référentiel (par exemple la Ligue des champions), **ses valeurs dans cette compétition** sont utilisées.
- Sinon, ses **valeurs de championnat** sont insérées parmi les clubs du référentiel (`inserted: true`).
- Dès que le référentiel mêle plusieurs compétitions, ou que le club y est inséré, le classement se fait **par match** (points / match, différence / match…) : les clubs n'ont pas joué le même nombre de matchs. Le tableau des points attendus montre alors l'**écart aux xPts par match** plutôt qu'un classement commun.

## Pool européen

Contenu : tous les clubs des 7 championnats du Top 7 (Angleterre, Espagne, Italie, Allemagne, France, Portugal, Pays-Bas), leurs matchs terminés de championnat et de coupes UEFA avec les statistiques d'équipe classées, et le **coefficient UEFA club sur cinq ans** de la dernière édition.

- Le pool est lu depuis la base : `/api/clubs/europe` (clubs, coefficients, niveaux), puis `/api/clubs/europe/matches` pour chacune des 10 compétitions ([europe.mjs](../../../backend/api/src/routes/europe.mjs), `readEuropePool` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js)).
- Le **classement européen** porte sur les matchs de championnat + UEFA de chaque club, par match.

## Niveau d'un club

Le niveau d'un club est son **Elo du classement de puissance** après son dernier match de la saison (méthode `docs/METHODE_CLASSEMENT_BALLON_D_OR.md`, § 3 ; `agg.team_power`, portée clubs). L'Elo est ajusté sur tous les résultats, championnats et coupes d'Europe, qui relient les championnats entre eux : aucun décalage de ligue ni plancher n'est fixé à la main. `agg.team_levels` le conserve en deux parts : l'Elo hérité des saisons précédentes et ce que la saison a ajouté. Tout club classé dans la saison a un niveau, y compris hors du pool : un joueur d'un club belge ou suisse a donc lui aussi des clubs de niveau comparable.

Jusqu'au 10 novembre 2026, le site calculait ce niveau lui-même à partir de décalages de ligue et de planchers fixés à la main (`levelScore`) sur un fichier de démonstration : cette formule et ce fichier ont été retirés avec l'ancien backend.

## Clubs de niveau comparable

`nearestClubs` / `levelPeerClubs` : les **30 clubs** du pool dont le niveau est le plus proche (écart absolu d'Elo), le club lui-même exclu puis ajouté.

Usages :
- **Profil club**, référentiel « Europe · niveau comparable » : le club est classé parmi ces 30 + lui-même.
- **Profil joueur**, option « Clubs de niveau comparable » (activée par défaut) : la cohorte de comparaison est réduite aux joueurs ayant joué pour l'un de ces clubs ou pour le club du joueur ([PlayerSeasonProfile.jsx](../../../dashboard/frontend/src/components/PlayerSeasonProfile.jsx#L371)). Si le club n'a pas de niveau (aucun Elo dans la saison), la comparaison se fait avec tous les clubs, et la page le signale.
