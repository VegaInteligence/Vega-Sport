# Style, tags et clubs similaires

## Axes de style

`STYLE_AXES` dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1097) place le club sur 7 spectres, à partir de son **centile** dans la cohorte :

| Axe | Gauche (centile bas) | Droite (centile haut) |
| --- | --- | --- |
| Possession | Laisse le ballon | Monopolise le ballon |
| Territoire | Joue dans son camp | Installé chez l'adversaire |
| Jeu long | Jeu court | Jeu long et direct |
| PPDA (axe inversé) | Pressing haut et agressif | Bloc qui attend |
| Centres | Peu de centres | Beaucoup de centres |
| Part des CPA | Peu dépendant des CPA | Dépendant des CPA |
| Actions défensives ajustées | Peu d'actions défensives | Très actif sans ballon |

## Tags de style

`styleTags` ([ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L640)) traduit les centiles en phrases, 6 au maximum :

| Condition | Tag |
| --- | --- |
| possession ≥ 75 | Possession dominante |
| possession ≤ 25 | Accepte de ne pas avoir le ballon |
| territoire ≥ 75 | Installé dans le camp adverse |
| PPDA ≥ 75 | Pressing haut et agressif |
| PPDA ≤ 25 | Bloc qui attend l'adversaire |
| jeu long ≥ 75 / ≤ 25 | Jeu direct, longs ballons / Relance courte |
| centres ≥ 75 | Beaucoup de centres |
| part des CPA ≥ 75 | Dangereux sur coups de pied arrêtés |
| xG par tir ≥ 75 | Tirs de grande qualité |
| xG concédés ≥ 75 | Défense qui concède peu |
| duels ≥ 75 | Gagne ses duels |
| finition ≥ 80 / ≤ 20 | Finition au-dessus / en dessous des xG |

Le centile PPDA est déjà inversé (bas PPDA = centile haut), d'où « ≥ 75 → pressing haut ».

## Clubs similaires

`similarClubs` ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1556)) compare les centiles sur 10 axes : possession, territoire, jeu long, PPDA, centres, part des CPA, actions défensives ajustées, xG, xG concédés, passes réussies.

$$
\text{similarité} = \operatorname{arrondi}\left(100 - \frac{1}{K}\sum_{k} \left|\,c_k^{\text{club}} - c_k^{\text{autre}}\,\right|\right)
$$

- `K` : nombre d'axes où les deux clubs ont un centile.
- Les clubs sont triés par similarité décroissante ; les 6 premiers sont proposés dans le menu « Comparer avec » (voisins du même championnat).
- Les axes les plus proches sont listés en premier pour expliquer la ressemblance.

Exemple : écarts de centile 5, 10, 0, 20, 15, 5, 10, 0, 5, 10 → moyenne 8 → similarité **92**.

### Onglet « Clubs similaires » : toute la base (VI-22, 17 novembre 2026)

L'onglet lit `/api/teams/{id}/similar?season=` ([profiles.mjs](../../../backend/api/src/routes/profiles.mjs), vue `api.team_style_centiles`, migration 123) : les 10 clubs les plus proches parmi **tous les championnats de la saison**, ou parmi un seul avec `&league=`.

- **Centiles** : ceux de `agg.team_percentiles` sur les 10 mêmes axes (`TEAM_SIMILARITY_AXES`), chaque club classé parmi les clubs de **son** championnat (cohorte `league` de l'édition ; ni le pool Europe, ni les coupes). Un championnat compte à partir de 10 clubs ; un axe compte s'il repose sur 5 matchs ou plus ; deux clubs se comparent sur au moins max(5, ⌈0,75 × axes du club⌉) axes communs. Un club présent dans deux championnats de la saison est pris dans celui où il a le plus de matchs.
- **Contexte du championnat** : un centile dit comment un club joue face aux adversaires de sa ligue. Le leader d'un championnat faible a les centiles d'un grand club sans jouer comme lui. La similarité perd donc des points selon l'écart de niveau entre les **deux championnats** (échelle de la force des championnats, `agg.league_levels`, en points Elo), au-delà d'une marge :

$$
\text{similarité} = 100 - \frac{1}{K}\sum_{k} \left|\,c_k^{\text{club}} - c_k^{\text{autre}}\,\right| - 0{,}15 \times \max\left(0,\ \left|N^{\text{ligue du club}} - N^{\text{ligue de l'autre}}\right| - 50\right)
$$

- Le niveau **du club** (son Elo) n'entre jamais : Côme, milieu de tableau en Serie A, reste un voisin possible de Paris. Pas de seuil : un écart de 100 coûte 7,5 points, un écart de 200 en coûte 22,5.
- Un championnat sans niveau est écarté de la vue « Tous les championnats », sauf si le championnat du club n'en a pas (aucune pénalité alors). Les championnats féminins ne se comparent qu'entre eux.
- Restreinte à un championnat, la liste garde **les mêmes chiffres** (même formule ; un championnat sans niveau ne paie rien).
- Chaque club vient avec son championnat, sa place (points, puis différence de buts, puis buts marqués, `api.team_season`), son bilan et ses 3 axes les plus proches.

Mesure du 17 novembre 2026 (2026/2027, 71 championnats, 1 209 clubs ; 220 ms pour Paris) :

| Club | Plus proches |
| --- | --- |
| Paris SG | Barcelone, Inter, Toluca, Villarreal, América, Bayern, River Plate, Argentinos Juniors, Monterrey, Middlesbrough |
| Arsenal | Fulham, Manchester City, Leverkusen, Bayern, Villarreal, Leipzig, Liverpool, Brighton, Dortmund, Tottenham |
| Côme | Leverkusen, Vasco da Gama, Inter, Middlesbrough, Bayern, AEK Athènes, Argentinos Juniors, Panathinaïkos, Villarreal, Cruzeiro |

Sans cette pénalité, le champion d'Équateur (Universidad Católica) arrivait premier pour Paris. Une fenêtre stricte de ±125 l'écartait, puis l'a laissé entrer quand les niveaux ont bougé de 3 points : la pénalité continue n'a pas cet effet de seuil.

## Écarts entre deux clubs

`Gaps` ([ClubScoutProfile.jsx](../../../dashboard/frontend/src/components/ClubScoutProfile.jsx#L520)) compare les centiles des 12 axes de performance de la pizza (`PERFORMANCE_KEYS` : xG, grosses occasions, xG par tir, ballons dans la surface, finition, xG concédés, grosses occasions concédées, gardien, territoire, passes réussies, duels, xG sur CPA) et affiche, pour chaque club, les **3 axes où il devance l'autre du plus grand nombre de centiles**. Un centile manquant compte pour 0.

## Ancienne implémentation

[club-analysis.js](../../../dashboard/frontend/src/services/club-analysis.js#L294) contient une autre version (`clubStyleCohort`, `clubCentile`, `similarClubs`) avec des seuils plus stricts : au moins 3 matchs, 80 % de couverture de la mesure, 10 clubs dans la cohorte, et au moins `max(5, ⌈0,75 × axes disponibles⌉)` axes communs. Elle n'est plus appelée par les pages actuelles.

## Circuits de passes

En bas de l'onglet « Style de jeu », la carte « Circuits de passes » lit `/api/teams/{id}/passing` (vue `api.team_pass_edges`) : les passes de chaque paire de joueurs du club, dans les deux sens, additionnées sur les réseaux de passes de la saison.

- **Duo le plus lié** : la paire au plus grand total.
- **Triangle le plus utilisé** : parmi les trios dont les trois paires ont échangé au moins une passe, celui dont la somme des trois paires est la plus grande. Deux joueurs très liés à un troisième mais qui ne se trouvent jamais ne forment pas un triangle.

Le réseau de passes de la source couvre un match jusqu'à son premier changement : ces totaux comparent les circuits entre eux, ils ne sont pas le nombre de passes de la saison.
