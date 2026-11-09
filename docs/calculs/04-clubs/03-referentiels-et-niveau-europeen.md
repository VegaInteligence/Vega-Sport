# Référentiels et niveau européen

Un club peut être comparé à autre chose que son championnat : une ou plusieurs compétitions choisies, l'Europe entière, ou les clubs de niveau proche.

## Changer de référentiel (`rebase`)

`rebase` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1451) réunit les clubs de plusieurs cohortes, puis recalcule positions, centiles, rangs, phases et indice Vega sur ce nouvel ensemble.

- Si le club joue dans le référentiel (par exemple la Ligue des champions), **ses valeurs dans cette compétition** sont utilisées.
- Sinon, ses **valeurs de championnat** sont insérées parmi les clubs du référentiel (`inserted: true`).
- Dès que le référentiel mêle plusieurs compétitions, ou que le club y est inséré, le classement se fait **par match** (points / match, différence / match…) : les clubs n'ont pas joué le même nombre de matchs. Le tableau des points attendus montre alors l'**écart aux xPts par match** plutôt qu'un classement commun.

## Pool européen

Contenu : tous les clubs des 7 championnats du Top 7 (Angleterre, Espagne, Italie, Allemagne, France, Portugal, Pays-Bas), leurs matchs terminés de championnat et de coupes UEFA avec les statistiques d'équipe classées, et le **coefficient UEFA club sur cinq ans** de la dernière édition.

- **Sur l'API v2** (site construit avec `NEXT_PUBLIC_API_SCHEMA=v2`), le pool est lu depuis la base : `/api/clubs/europe` (clubs, coefficients, niveaux), puis `/api/clubs/europe/matches` pour chacune des 10 compétitions ([europe.mjs](../../../v2/api/src/routes/europe.mjs), `readEuropePool` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js)).
- **Sur l'API actuelle**, qui n'a pas cet agrégat, il est lu jusqu'à la bascule depuis `public/demo/europe-clubs.json`, produit par [demo-europe-clubs.mjs](../../../dashboard/frontend/scripts/demo-europe-clubs.mjs).
- Le **classement européen** porte sur les matchs de championnat + UEFA de chaque club, par match.

## Niveau d'un club

**Sur l'API v2**, le niveau d'un club est son **Elo du classement de puissance** après son dernier match de la saison (méthode `docs/METHODE_CLASSEMENT_BALLON_D_OR.md`, § 3 ; `agg.team_power`, portée clubs). L'Elo est ajusté sur tous les résultats, championnats et coupes d'Europe, qui relient les championnats entre eux : aucun décalage de ligue ni plancher n'est fixé à la main. `agg.team_levels` le conserve en deux parts : l'Elo hérité des saisons précédentes et ce que la saison a ajouté. Tout club classé dans la saison a un niveau, y compris hors du pool : un joueur d'un club belge ou suisse a donc lui aussi des clubs de niveau comparable.

**Sur l'API actuelle** (démo, jusqu'à la bascule), `levelScore` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js)) donne un niveau en différence de xG par match, moyenne de Premier League = 0, avec des calibrations fixées à la main :

$$
\text{niveau} = 0{,}5 \times \underbrace{\bigl(\text{décalage}_{\text{ligue}} + 0{,}8 \times \text{xGD}\bigr)}_{\text{saison}} \;+\; 0{,}5 \times \underbrace{0{,}6 \times \ln\!\left(\frac{\text{coef. UEFA}}{15}\right)}_{\text{long terme}}
$$

- `xGD` = xG / match − xG concédés / match **en championnat**.
- **Décalage de ligue** : Angleterre 0 ; Espagne −0,20 ; Italie −0,25 ; Allemagne −0,25 ; France −0,45 ; Portugal −0,85 ; Pays-Bas −0,90 ; autre −1,20.
- **Coefficient UEFA** : un club non classé prend **70 % du plancher de son association** (20 % du coefficient de l'association) : Angleterre 23 ; Italie 19,6 ; Espagne 18,4 ; Allemagne 17,6 ; France 14,5 ; Pays-Bas 12,8 ; Portugal 12,4 ; autre 7.
- Hors du pool, le niveau est calculé sans coefficient (plancher appliqué) à partir des valeurs de championnat du club.

## Clubs de niveau comparable

`nearestClubs` / `levelPeerClubs` : les **30 clubs** du pool dont le niveau est le plus proche (écart absolu d'Elo sur la v2), le club lui-même exclu puis ajouté.

Usages :
- **Profil club**, référentiel « Europe · niveau comparable » : le club est classé parmi ces 30 + lui-même.
- **Profil joueur**, option « Clubs de niveau comparable » (activée par défaut) : la cohorte de comparaison est réduite aux joueurs ayant joué pour l'un de ces clubs ou pour le club du joueur ([PlayerSeasonProfile.jsx](../../../dashboard/frontend/src/components/PlayerSeasonProfile.jsx#L327)). Si le club n'a pas de niveau (hors du pool en démo, ou sans Elo sur la v2), la comparaison se fait avec tous les clubs, et la page le signale.
