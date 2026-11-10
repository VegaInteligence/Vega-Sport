# États de match, tirs et effectif

## États de match

`gameStates` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1253), affiché par `GameState` ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L969)).

**Matchs retenus** : seulement ceux dont la chronologie des buts (tirs `isGoal` + contre son camp) **reproduit exactement le score final**. Un contre son camp compte pour l'équipe adverse du tireur. Les autres matchs sont ignorés, et la page indique combien de matchs ont une chronologie complète.

Minute d'un but : `minute + minute ajoutée / 100` (90+3 → 90,03), ce qui ordonne correctement les buts du temps additionnel.

| Mesure | Calcul |
| --- | --- |
| Temps en tête / à égalité / mené | somme des durées entre buts selon l'écart au score ; fin du match = `max(93, dernière minute de but + 1)` ; affiché en % du total |
| Ouvre le score | matchs où le premier but est pour le club : V / N / D et points par match |
| Encaisse le premier | idem quand le premier but est adverse |
| Points pris après avoir été mené | somme des points des matchs où le club a été mené à un moment et a pris au moins 1 point |
| Points perdus après avoir mené | somme de `3 − points` des matchs où le club a mené à un moment sans gagner |

Exemple : mené 0-1 puis vainqueur 2-1 → 3 points « pris après avoir été mené ». Mené 1-0 puis 1-1 → 2 points « perdus après avoir mené ».

## Buts par tranche de 15 minutes

Calculé en SQL par l'annuaire ([clubs.mjs](../../../backend/api/src/routes/clubs.mjs)) et dans `clubSummary` ([club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js#L242)) :

$$
\text{tranche} = \min\!\left(5,\; \max\!\left(0,\; \left\lfloor \frac{\text{minute} - 0{,}01}{15} \right\rfloor\right)\right)
$$

Tranches : 0–15′, 16–30′, 31–45′, 46–60′, 61–75′, 76–90′+. La minute ajoutée n'est pas utilisée : un but à 45+2 tombe dans 31–45′, un but à 90+4 dans 76–90′+. Les contre son camp sont exclus.

## Tirs par situation

`shotProfile` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1206)) répartit tirs, xG et buts, pour et contre, entre :

| Situation PitchAPI | Catégorie |
| --- | --- |
| `RegularPlay`, `IndividualPlay`, autre | Jeu placé |
| `FastBreak` | Contre-attaque |
| `FromCorner` | Corner |
| `SetPiece` | Autre CPA |
| `FreeKick` | Coup franc direct |
| `Penalty` | Penalty |

Contre son camp exclus ; un tir sans xG compte pour 0. Sur la carte des tirs du club, l'abscisse est retournée (`105 − x`) pour que le club attaque toujours du même côté. La carte « Coups de pied arrêtés » additionne corner + autre CPA + coup franc direct (penalties exclus).

## Effectif

`clubSquad` ([club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js#L359)) et `SquadTable` ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L1274)) :

| Mesure | Calcul |
| --- | --- |
| Profil de chaque joueur | agrégation saison sur les matchs terminés du club (voir [Agrégation](../05-joueurs/01-agregation-saison.md)) |
| Part du temps de jeu | `100 × minutes du joueur / (matchs du club × 90)`, matchs du club toutes compétitions |
| xG + xA | somme saison du xG + somme saison du xA |
| Joueurs utilisés | joueurs avec au moins un match joué |
| Continuité | nombre moyen de titulaires conservés d'un match au suivant, sur les matchs consécutifs dont les **11 titulaires** sont connus |
| Part des 11 plus utilisés | `100 × minutes des 11 joueurs les plus utilisés / minutes totales de l'effectif` |

## Bilan par système

`formationRecords` : V / N / D et buts pour / contre par système de jeu (4-3-3, 4-2-3-1…), sur les seuls matchs dont la formation est fournie.
