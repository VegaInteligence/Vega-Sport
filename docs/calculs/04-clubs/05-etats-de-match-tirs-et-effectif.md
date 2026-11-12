# États de match, tirs et effectif

## États de match

`gameStates` dans [club-game-states.js](../../../dashboard/frontend/src/services/club-game-states.js), affiché par `GameState` ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L969)).

**Matchs retenus** : seulement ceux dont la chronologie des buts (tirs `isGoal` + contre son camp) **reproduit exactement le score final**. Un contre son camp compte pour l'équipe adverse du tireur. Les autres matchs sont ignorés, et la page indique combien de matchs ont une chronologie complète.

Minute d'un but : `minute + minute ajoutée / 100` (90+3 → 90,03), ce qui ordonne correctement les buts du temps additionnel.

| Mesure | Calcul |
| --- | --- |
| Temps en tête / à égalité / mené | somme des durées entre buts selon l'écart au score ; fin du match = `max(93, dernière minute de but + 1)` ; affiché en % du total |
| Ouvre le score | matchs où le premier but est pour le club : V / N / D et points par match |
| Encaisse le premier | idem quand le premier but est adverse |
| Points pris après avoir été mené | somme des points des matchs où le club a été mené à un moment et a pris au moins 1 point |
| Points perdus après avoir mené | somme de `3 − points` des matchs où le club a mené à un moment sans gagner |

| 1re et 2e mi-temps | buts marqués et encaissés dans chaque mi-temps sur ces mêmes matchs, et leur différence ; la mi-temps est celle que donne la source pour le tir, sinon la minute (jusqu'à 45, temps additionnel compris, puis jusqu'à 90) ; un but en prolongation n'appartient à aucune des deux |
| Points à la pause | 3, 1 ou 0 point par match selon le score à la mi-temps, à côté des points réellement pris sur ces matchs |

Un club dont la différence chute en seconde période, ou qui prend moins de points à la fin qu'à la pause, finit moins bien qu'il ne commence ; l'inverse dit un club qui finit fort.

Exemple : mené 0-1 puis vainqueur 2-1 → 3 points « pris après avoir été mené ». Mené 1-0 puis 1-1 → 2 points « perdus après avoir mené ».

## Après les changements

Sous les états de match, la carte « Après les changements » lit `/api/teams/{id}/substitutions` (vues `api.team_change_matches` et `api.team_substitute_matches`), toutes compétitions de la saison :

- pour chaque match terminé du club où la source a noté un remplacement, le **score au premier remplacement du club** : le nombre d'événements de but qui le précèdent, comptés pour l'équipe à qui la source attribue le but (le score que la source écrit sur un but est celui d'avant le but dans certains matchs, d'après dans d'autres : il n'est pas lu) ;
- **points au premier changement** : 3, 1 ou 0 selon ce score, additionnés ; **points à la fin** : ceux réellement pris sur ces matchs ; la différence est ce qui a été gagné ou perdu ensuite ;
- les mêmes comptes selon que le club **menait**, était à **égalité** ou était **mené** à ce moment ;
- la minute moyenne du premier changement ;
- les **remplaçants décisifs** : les trois joueurs entrés en jeu (non titulaires de la composition, avec des minutes) qui comptent le plus de buts et de passes décisives sur ces entrées.

Un match n'est retenu que si les événements de but de chaque équipe donnent son score final (98,9 % des matchs de la saison 2026/2027 qui ont des événements). La carte dit ce qui a suivi les changements, pas ce qu'ils ont causé : un score évolue aussi sans eux.

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
