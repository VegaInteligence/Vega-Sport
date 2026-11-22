# États de match, tirs et effectif

## États de match

`gameStates` dans [club-game-states.js](../../../dashboard/frontend/src/services/club-game-states.js), affiché par `GameState` ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L969)).

**Matchs retenus** : seulement ceux dont la chronologie des buts (tirs `isGoal` + contre son camp) **reproduit exactement le score final** et donne **la minute de chaque but**. Un contre son camp compte pour l'équipe adverse du tireur. Un but sans minute n'est pas un but à la minute 0 : son match n'a pas de chronologie connue (17 novembre 2026, VI-22). Les autres matchs sont ignorés, et la page indique combien de matchs ont une chronologie complète. Sans aucun match retenu, le temps en tête, à égalité et mené est inconnu (« — »), pas 0 %.

Minute d'un but : `minute + minute ajoutée / 100` (90+3 → 90,03), ce qui ordonne correctement les buts du temps additionnel.

**Non corrigé (audit 14, durées).** Ces minutes ordonnent les buts mais ne sont pas des durées : une minute du temps additionnel ou de la prolongation compte comme une fraction de minute, et une durée inconnue devient 0 dans l'affichage. La correction (une horloge réglementaire déclarée : les minutes 0 à 90, le temps additionnel ramené à la fin de sa mi-temps, la prolongation et les tirs au but sans durée) n'est pas livrée : l'affichage appartient au chantier des profils (VI-22). Contrat, cas et tests (en échec sur le code actuel) : [traçabilité](../09-audit-2026-11/TRACEABILITY.md) et section 8 des [modes de défaillance](../09-audit-2026-11/FAILURE_MODES.md). Une saison calculée avec l'une ou l'autre définition ne se compare pas à l'autre avant recalcul. Relevé aussi le 17 novembre : côté base, un but dont le score manque dans les événements fait échouer le recalcul de toute l'édition (`_match_states`).

| Mesure | Calcul |
| --- | --- |
| Temps en tête / à égalité / mené | somme des durées entre buts selon l'écart au score ; fin du match = `max(93, dernière minute de but + 1)` ; affiché en % du total |
| Ouvre le score | matchs où le premier but est pour le club : V / N / D et points par match |
| Encaisse le premier | idem quand le premier but est adverse |
| Points pris après avoir été mené | somme des points des matchs où le club a été mené à un moment et a pris au moins 1 point |
| Points perdus après avoir mené | somme de `3 − points` des matchs où le club a mené à un moment sans gagner |

| 1re et 2e mi-temps | buts marqués et encaissés dans chaque mi-temps, et leur différence ; la mi-temps est celle que donne la source pour le tir, sinon la minute (jusqu'à 45, temps additionnel compris, puis jusqu'à 90) ; un but en prolongation n'appartient à aucune des deux. Un but après la 90e sans période de la source peut être du temps additionnel ou de la prolongation : son match sort des mi-temps (`halfMatches` compte ceux qui restent, et la note le dit quand ils sont moins nombreux) |
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

## Dynamique des xG

`XgTrend` ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx)) place chaque match où les deux xG sont connus à sa date, toutes compétitions, et trace les moyennes des xG créés et concédés sur les 5 derniers matchs.

Depuis le 22 novembre 2026, les moyennes partent du premier match de la saison :
- **Saison précédente lue** (`usePreviousSeasonRows`, [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js), une lecture `detail=summary` de plus) : la fenêtre des 4 premiers matchs est complétée par les derniers matchs de la saison d'avant, toutes compétitions, joués avant le premier match de la saison et avec leurs deux xG. Pour un promu, ce sont donc des matchs de la division inférieure.
- **Pas de saison précédente** (absente de la publication, aucun match du club ou lecture en échec) : la moyenne est partielle, sur 1, 2, 3 puis 4 matchs.
- **Affichage :** jusqu'au premier match dont les 5 matchs de la fenêtre sont tous de la saison, la courbe est en pointillés et la bande plus pâle. La légende l'indique (« Avec la fin de 25/26 » ou « Moins de 5 matchs ») et la carte de survol le précise (« Moyenne 5 matchs · dont 3 de 2025/2026 », « Moyenne sur 2 matchs »). Pendant la lecture de la saison précédente, la courbe commence au 5e match, comme avant.

## Tirs par situation

`shotProfile` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js)) répartit tirs, xG et buts, pour et contre, entre six catégories. Une seule lecture des situations sert aussi au comptage des penalties ; elle reconnaît les codes normalisés des fiches de match intégrées et la graphie du fournisseur (17 novembre 2026) :

| Situation (code normalisé / fournisseur) | Catégorie |
| --- | --- |
| `regular_play` / `RegularPlay`, `individual_play` / `IndividualPlay` | Jeu placé |
| `fast_break` / `FastBreak` | Contre-attaque |
| `from_corner` / `FromCorner` | Corner |
| `set_piece` / `SetPiece`, `throw_in_set_piece` / `ThrowInSetPiece` | Autre CPA |
| `free_kick` / `FreeKick` | Coup franc direct |
| `penalty` / `Penalty` | Penalty |

Auparavant, seule la graphie du fournisseur était lue : un code normalisé, un penalty compris, tombait dans « Jeu placé », comme `ThrowInSetPiece` et toute situation inconnue.

- **Situation inconnue ou absente :** le tir n'est dans aucune catégorie (jamais « Jeu placé ») ; il est compté à part (`unclassified`, pour et contre) et garde son point sur la carte, avec la situation « — ». Le tableau ne montre pas encore cet écart (présentation du chantier VI-22).
- **Équipe :** un tir est du club ou de son adversaire selon les deux équipes réelles du match ; un tir d'une autre équipe, ou sans équipe, n'est d'aucun côté.
- **Séance de tirs au but :** ses tirs (`period` « penalties » ou « Penalties ») ne sont ni dans les catégories ni sur la carte ; un penalty du match reste dans « Penalty » (17 novembre 2026, étape 5).
- **xG :** le xG d'une catégorie est la somme des xG connus, inconnu (« — ») dès qu'un de ses tirs n'en a pas ; un xG nul connu reste 0, sur le tableau comme sur la carte. Sur la carte, un xG **absent** vaut encore 0,01 : l'en-tête de la carte (`ShotPair`, chantier VI-22) additionne les xG des points et lirait une valeur absente comme 0. Ce xG fabriqué reste ouvert, transmis au chantier VI-22 (un xG absent devrait rendre l'en-tête « — » tout en gardant le point).

Contre son camp exclus. Sur la carte des tirs du club, l'abscisse est retournée (`105 − x`) pour que le club attaque toujours du même côté. La carte « Coups de pied arrêtés » additionne corner + autre CPA + coup franc direct (penalties exclus). **Non corrigé, chantier VI-22** : cette addition (`setXg`, et la phrase « Contre-attaques et CPA réunis ») lit un xG de catégorie inconnu comme 0. Une contre-attaque à 0,4 avec un tir sans xG, à côté de corners à 1,2, s'affiche 1,2 ; des catégories toutes inconnues s'affichent 0. Le total devrait être indisponible dès qu'une catégorie l'est, et un 0 observé rester 0.

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
