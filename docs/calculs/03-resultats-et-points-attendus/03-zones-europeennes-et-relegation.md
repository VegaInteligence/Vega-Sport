# Zones européennes, montée et relégation

Code : [standings-zones.js](../../../dashboard/frontend/src/services/standings-zones.js), appelé par `useEuropeanPlaces` dans [CompetitionStandings.jsx](../../../dashboard/frontend/src/components/CompetitionStandings.jsx#L64).

Les places européennes ne sont jamais écrites pays par pays : elles se **déduisent du rang de l'association** au coefficient UEFA, selon la liste d'accès du cycle 2024–2027.

## Quel coefficient décide

Pour le classement de la saison Y/Y+1 (qui qualifie pour la saison européenne Y+1/Y+2) :
- **rang de l'association** : édition UEFA `Y` (publiée à la fin de Y−1/Y) ;
- **places de performance européenne (EPS)** : les **deux associations** au meilleur coefficient **de la saison Y/Y+1 elle-même** (`nationalAssociationPoints` ou `totalPoints` de cette saison) gagnent une place de Ligue des champions supplémentaire.

Si l'édition Y+1 contient encore des clubs en lice, les places sont marquées provisoires.

## Places par rang d'association

`europeanPlaces(rang, { eps })`, de la 1re place du championnat vers le bas :

| Rang de l'association | LdC directe | LdC qualif. | Ensuite |
| --- | --- | --- | --- |
| 1–4 | 4 | 0 | (+1 LdC si EPS), Europa, Conférence |
| 5 | 3 | 1 | (+1 LdC si EPS), Europa, Conférence |
| 6 | 2 | 1 | (+1 LdC si EPS), Europa qualif., Conférence |
| 7–10 | 1 | 1 | (+1 LdC si EPS), Europa qualif., Conférence |
| 11–12 | 0 | 2 | (+1 LdC si EPS), Europa qualif., Conférence |
| 13–15 | 0 | 2 | (+1 LdC si EPS), Conférence, Conférence |
| 16–50 | 0 | 1 | (+1 LdC si EPS), Conférence, Conférence |
| 51–55 | 0 | 1 | (+1 LdC si EPS), Conférence |
| > 55 | 0 | 0 | — |

La place EPS va au club le mieux classé qui n'est pas déjà qualifié, c'est-à-dire juste après les places de Ligue des champions. Les places attribuées aux vainqueurs de coupe ne sont **pas** montrées : elles dépendent de la coupe, pas du classement.

## Montée et relégation

`leagueZones` lit le nombre de places dans [shared/league-rules.json](../../../dashboard/shared/league-rules.json) (rafraîchi par `refresh_league_rules.mjs`) :
- `relegation` dernières places → Relégation ;
- `relegationPlayoff` places au-dessus → Barrage de relégation ;
- `promotion` premières places → Montée ;
- `promotionPlayoff` places suivantes → Barrage de montée.

Les règles ne s'appliquent que si le tableau a **le nombre d'équipes enregistré**. Une saison plus ancienne à un autre format, ou un championnat sans règles enregistrées, prend les destins observés (ci-dessous).

## Destins observés d'une saison terminée

Vue `api.league_team_fates` ([112_league_team_fates.sql](../../../backend/sql/112_league_team_fates.sql)), route `/api/rankings/fates`. Pour chaque club d'une édition terminée, on lit **ce qu'il a joué la saison suivante** dans la base :

1. **Une coupe d'Europe** : Ligue des champions, Ligue Europa ou Ligue Conférence, dans cet ordre. « Qualifications » quand le club n'en a joué que les tours préliminaires.
2. **Sinon, un championnat de son pays d'un autre niveau** : plus haut, c'est une montée ; plus bas, une relégation.
3. **Sinon, en première division seulement** : un club absent de l'édition suivante a quitté la division, c'est une relégation. Cette règle ne joue que si l'édition suivante compte au moins les trois quarts des clubs de celle-ci, pour ne pas lire une saison dont seuls les premiers matchs sont chargés.

Ce sont des faits, pas des règles : un vainqueur de coupe est coloré par la coupe d'Europe qu'il a jouée, à sa place au classement. Un barrage gagné ne se voit pas, puisque le club est resté.

**Quand on s'en sert.** Seulement là où les règles enregistrées ne s'appliquent pas. Des règles qui correspondent au tableau gardent la priorité, avec leurs barrages. La légende dit alors : « la compétition que chaque club a jouée la saison suivante ».

**Ce qui reste sans couleur.**
- Une saison dont la suivante n'est pas dans la base.
- Une coupe continentale hors Europe (Libertadores, Ligue des champions de la CONCACAF ou de l'AFC) : elle n'est pas lue.
- Un championnat sans montée ni relégation, comme la MLS.

Mesuré le 15 novembre 2026 : 211 éditions ont des destins, 830 clubs en portent un. Exemples : Ligue 1 2022/23 a ses 4 relégués ; Bundesliga 2021/22 a 5 clubs en Ligue des champions, dont Francfort, vainqueur de la Ligue Europa ; Argentine 2024 n'a aucun relégué, comme dans la réalité.

## Combinaison

`tableZones` pose d'abord les zones européennes, puis les zones de montée / relégation ; une zone de relégation remplace toujours une zone européenne en cas de conflit.
