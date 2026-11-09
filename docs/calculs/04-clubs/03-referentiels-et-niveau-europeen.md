# Référentiels et niveau européen

Un club peut être comparé à autre chose que son championnat : une ou plusieurs compétitions choisies, l'Europe entière, ou les clubs de niveau proche.

## Changer de référentiel (`rebase`)

`rebase` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1451) réunit les clubs de plusieurs cohortes, puis recalcule positions, centiles, rangs, phases et indice Vega sur ce nouvel ensemble.

- Si le club joue dans le référentiel (par exemple la Ligue des champions), **ses valeurs dans cette compétition** sont utilisées.
- Sinon, ses **valeurs de championnat** sont insérées parmi les clubs du référentiel (`inserted: true`).
- Dès que le référentiel mêle plusieurs compétitions, ou que le club y est inséré, le classement se fait **par match** (points / match, différence / match…) : les clubs n'ont pas joué le même nombre de matchs. Le tableau des points attendus montre alors l'**écart aux xPts par match** plutôt qu'un classement commun.

## Pool européen (démo locale)

> Ce pool est une **démonstration locale** : il est lu depuis `public/demo/europe-clubs.json`, produit par [demo-europe-clubs.mjs](../../../dashboard/frontend/scripts/demo-europe-clubs.mjs). Il remplace un agrégat serveur qui n'existe pas encore. Ses calibrations ne sont pas ajustées sur des résultats.

Contenu : tous les clubs des 7 championnats du Top 7 (Angleterre, Espagne, Italie, Allemagne, France, Portugal, Pays-Bas), leurs matchs terminés de championnat et de coupes UEFA, et le **coefficient UEFA club sur cinq ans** de l'édition courante.

- Le **niveau** d'un club se calcule sur ses matchs de championnat.
- Le **classement européen** porte sur ses matchs de championnat + UEFA, par match.

## Score de niveau d'un club

`levelScore` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L330)). Unité : différence de xG par match, moyenne de Premier League = 0.

$$
\text{niveau} = 0{,}5 \times \underbrace{\bigl(\text{décalage}_{\text{ligue}} + 0{,}8 \times \text{xGD}\bigr)}_{\text{saison}} \;+\; 0{,}5 \times \underbrace{0{,}6 \times \ln\!\left(\frac{\text{coef. UEFA}}{15}\right)}_{\text{long terme}}
$$

- `xGD` = xG / match − xG concédés / match **en championnat**.
- **Décalage de ligue** : Angleterre 0 ; Espagne −0,20 ; Italie −0,25 ; Allemagne −0,25 ; France −0,45 ; Portugal −0,85 ; Pays-Bas −0,90 ; autre −1,20.
- **Coefficient UEFA** : coefficient club sur cinq ans. Un club non classé prend **70 % du plancher de son association** (20 % du coefficient de l'association) : Angleterre 23 ; Italie 19,6 ; Espagne 18,4 ; Allemagne 17,6 ; France 14,5 ; Pays-Bas 12,8 ; Portugal 12,4 ; autre 7.
- Hors du pool, le niveau est calculé sans coefficient (plancher appliqué) à partir des valeurs de championnat du club.

Exemples :

| Club | Ligue | xGD / match | Coefficient | Niveau |
| --- | --- | --- | --- | --- |
| A | France | +1,0 | 100 | 0,5 × 0,35 + 0,5 × 1,138 = **0,74** |
| B | Angleterre | +0,2 | 15 | 0,5 × 0,16 + 0 = **0,08** |
| C | France, non classé | −0,3 | 14,5 × 0,7 = 10,15 | 0,5 × (−0,69) + 0,5 × (−0,234) = **−0,46** |

## Clubs de niveau comparable

`nearestClubs` / `levelPeerClubs` : les **30 clubs** du pool dont le niveau est le plus proche (écart absolu), le club lui-même exclu puis ajouté.

Usages :
- **Profil club**, référentiel « Europe · niveau comparable » : le club est classé parmi ces 30 + lui-même.
- **Profil joueur**, option « Clubs de niveau comparable » (activée par défaut) : la cohorte de comparaison est réduite aux joueurs ayant joué pour l'un de ces clubs ou pour le club du joueur ([PlayerSeasonProfile.jsx](../../../dashboard/frontend/src/components/PlayerSeasonProfile.jsx#L371)). Si le club n'est pas dans le pool, la comparaison se fait avec tous les clubs, et la page le signale.
