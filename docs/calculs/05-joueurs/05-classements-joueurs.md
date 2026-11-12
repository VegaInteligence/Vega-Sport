# Classements joueurs

## Listes de l'annuaire

`PLAYER_RANKINGS` dans [player-leaderboard.js](../../../dashboard/frontend/src/services/player-leaderboard.js#L5), sur la saison et les compétitions sélectionnées.

| Liste | Éligibilité | Tri |
| --- | --- | --- |
| Meilleures notes | note saison connue et **au moins 5 matchs notés** | note ↓, puis nombre de matchs notés ↓, puis nom |
| Buteurs | buts > 0 | buts ↓, puis xG ↓ |
| Passeurs | passes décisives > 0 | passes décisives ↓, puis xA ↓ |
| Efficaces | **buts ≥ 4** et xG connu | `buts − xG` ↓ |
| Maladroits | **xG ≥ 3** et buts connus | `buts − xG` ↑ |

« Efficaces » et « Maladroits » mesurent la finition : un joueur qui marque 9 buts pour 5,2 xG a `+3,8` ; un joueur à 3 buts pour 6,1 xG a `−3,1`. Les seuils (4 buts, 3 xG) évitent qu'un seul but chanceux place un joueur en tête.

## Meneurs de l'accueil

`seasonTotals` et `seasonLeaders` dans [home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L564), même calcul en SQL dans [home.mjs](../../../backend/api/src/routes/home.mjs).

Totaux saison par joueur (matchs avec minutes > 0) : matchs, minutes, buts, passes décisives, xG et xA (**seulement s'ils couvrent tous les matchs**, sinon `null`), note pondérée par les minutes. Le club affiché est le dernier club national : un match européen ne change pas de club.

| Liste | Taille | Règle |
| --- | --- | --- |
| Buteurs | 10 | comme l'annuaire |
| Passeurs | 10 | comme l'annuaire |
| Efficaces | 8 | comme l'annuaire |
| Maladroits | 8 | comme l'annuaire |
| Notes | 10 | note pondérée, minutes ≥ `max(450, arrondi(0,4 × minutes max))` |

## Joueur de la semaine

`weekPerformances` et `playerOfTheWeek` ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L506)) :
1. performances des matchs terminés de la semaine affichée, avec **au moins 60 minutes** et une note ;
2. pour chaque joueur, sa meilleure note de la semaine ;
3. tri par note ↓, puis buts ↓, puis nom ;
4. le joueur de la semaine est le premier issu d'un **championnat du Top 5 ou d'une coupe UEFA** ; à défaut, le premier tout court.

## Classement Ballon d'Or

`useBallonDorRanking` ([ballon-dor.js](../../../dashboard/frontend/src/services/ballon-dor.js)) lit les 30 premiers de la **course** sur `/api/rankings/power?kind=players` : les joueurs classés d'un club de première division, dans l'ordre du **classement de puissance** de l'année du trophée (1ᵉʳ août au 31 juillet). Il est calculé chaque jour par le worker (`backend/vega/power.py`) selon [METHODE_CLASSEMENT_BALLON_D_OR.md](../../METHODE_CLASSEMENT_BALLON_D_OR.md), version 2 : contribution par match relative au rôle (lu avec la formation), niveau du club sur une échelle commune aux championnats, indice standardisé entre rôles ; le score affiché est `100 / (1 + 10^(−indice / 4))`. Le détail et les mesures sont dans [l'audit du 12 novembre 2026](08-audit-classement-puissance.md). Une saison sans classement publié n'en affiche pas. L'ouverture de la « course » sur l'accueil est décrite dans [Accueil](../06-accueil-et-matchs/01-accueil.md).
