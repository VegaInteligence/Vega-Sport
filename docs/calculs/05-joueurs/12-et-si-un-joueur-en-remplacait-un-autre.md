# Et si un joueur en remplaçait un autre ?

Une **estimation** de ce que deviendraient les résultats d'un club en championnat si un joueur jouait à la place d'un autre ([lineup.py](../../../backend/vega/lineup.py), `/api/forecasts/swap`). Sur le site : onglet « Comparaison » de la fiche d'un joueur, bloc « Et s'il jouait à sa place ? », une ligne par joueur comparé. Version du modèle : `lineup-v1` (13 novembre 2026).

## Le principe

L'Elo d'un club est sa force avec les joueurs qu'il aligne d'habitude. Pour savoir ce que vaut un joueur de plus ou de moins, on mesure ce que les **compositions de départ** changent aux résultats, au-delà de cet Elo.

1. **Rendement propre d'un joueur.** Ce que le classement mesure de lui par 90 minutes, sans le niveau de son club : r = 90 × somme de ses contributions propres / (minutes + 450) (§ 8 de la [méthode](../../METHODE_CLASSEMENT_BALLON_D_OR.md) ; les 450 minutes ramènent vers 0 un joueur qui a peu joué). Avant un match, il est lu sur l'année précédente du trophée et sur l'année en cours **jusqu'à ce match, exclu**.
2. **Composition.** La somme des rendements des titulaires de champ (onze titulaires connus, gardien exclu).
3. **Écart à l'habitude.** Cette somme moins la moyenne des compositions précédentes du club dans l'année (au moins cinq).
4. **Pronostic corrigé.** Le [pronostic](../06-accueil-et-matchs/03-pronostics-et-projections.md) lit l'écart de force Δ ; on lui ajoute E × (écart domicile − écart extérieur) / 400, où E, les **points Elo que vaut une unité de rendement**, est ajusté par maximum de vraisemblance sur les matchs de clubs terminés, les coefficients du pronostic restant ceux de la base.

## Ce que la base montre

Sur les 28 524 matchs des années 2024/2025 à 2026/2027 dont les deux compositions sont comparables : **E = 44,8 points Elo par unité de rendement** (erreur type 3,2).

Jugement sur des matchs non vus : E ajusté sur les années avant 2026/2027 (24 252 matchs : 44,9 ± 3,4), appliqué aux 4 272 matchs de 2026/2027.

| | Elo seul | Avec les compositions | Joué |
| --- | --- | --- | --- |
| Perte logarithmique des trois résultats | 1,00472 | 1,00223 | |
| Points par match à domicile, dixième des compositions les plus faibles face à l'habitude (427 matchs, écart moyen −0,74) | 1,539 | 1,407 | 1,372 |
| Les huit dixièmes du milieu (3 418 matchs) | 1,567 | 1,568 | 1,570 |
| Dixième des compositions les plus fortes (427 matchs, écart moyen +0,77) | 1,596 | 1,733 | 1,766 |

L'année 2026/2027, ajustée seule, donne 43,5 ± 9,4 : la même valeur. Une équipe très remaniée gagne nettement moins que son Elo ne l'annonce, et la correction le retrouve.

### Par poste

Un coefficient par rôle, sur les 18 269 matchs de 2025/2026 (en points Elo par unité de rendement) :

| Gardien | Défenseur central | Latéral / piston | Milieu défensif | Milieu central | Ailier / milieu offensif | Avant-centre |
| --- | --- | --- | --- | --- | --- | --- |
| 1 ± 12 | 70 ± 14 | 63 ± 11 | 31 ± 12 | 54 ± 9 | 44 ± 8 | 29 ± 10 |

- **Gardiens : aucun effet mesuré.** Leur rendement ne change rien au résultat d'un match dans ces données : ils sont exclus de la composition, et il n'y a pas d'estimation pour un gardien.
- **Joueurs de champ : un seul coefficient.** Tous sont positifs ; leurs écarts tiennent en partie au bruit, et sur les matchs non vus un coefficient par rôle ne fait presque pas mieux qu'un seul (perte 1,01719 contre 1,01736).

### Le rendement suit-il le joueur quand il change de club ?

C'est ce qu'un « et si » suppose. Mesuré sur 26 575 matchs, en séparant les titulaires selon leur saison précédente :

| Saison précédente du titulaire | Points Elo par unité |
| --- | --- |
| Dans le même club | 43 ± 4 |
| Dans un autre club, championnat de niveau comparable ou supérieur | 34 ± 8 |
| Dans un autre club, championnat plus faible de plus de 50 points Elo | 43 ± 19 |
| Aucune saison précédente dans la base | 60 ± 9 |

Les quatre valeurs sont compatibles : le rendement d'un joueur compte autant quand il vient d'ailleurs. La mesure est imprécise pour ceux qui viennent d'un championnat plus faible.

## L'estimation

Pour un joueur B à la place d'un joueur A, au club de A :

- écart de rendement : r(B) − r(A), chacun lu sur la saison et la précédente (au moins 450 minutes sur les deux) ;
- en points Elo : E × cet écart, ajouté à la force du club ;
- en points : ce que le pronostic donne en plus par match contre un adversaire du niveau moyen des autres clubs de son championnat, moitié à domicile, moitié à l'extérieur ; puis sur le nombre de matchs du club dans ce championnat.

Ordres de grandeur, pour un club au niveau de son championnat :

| Écart de rendement | Points Elo | Points par match | Sur 38 matchs |
| --- | --- | --- | --- |
| +0,1 | +4,5 | +0,019 | +0,7 |
| +0,3 | +13,4 | +0,056 | +2,1 |
| +0,6 | +26,9 | +0,113 | +4,3 |

Pour situer un écart : parmi les joueurs à 900 minutes sur deux saisons, le rendement d'un ailier va de −0,19 (dixième le plus faible) à +0,27 (dixième le plus fort), +0,54 pour le premier centième ; celui d'un défenseur central de −0,15 à +0,15, +0,29 pour le premier centième.

Pas d'estimation quand les deux joueurs n'ont pas le même rôle au classement, quand l'un est gardien, ou quand l'un a trop peu joué.

## Limites

- **C'est une estimation**, tirée de la relation entre compositions et résultats. Elle ne sait rien de l'adaptation d'un joueur à un autre club, à un autre championnat ou à un autre système, ni de ce que son arrivée change au jeu des autres.
- **Les remaniements ne sont pas tirés au sort** : un entraîneur fait tourner quand l'enjeu ou l'adversaire le permet. Sur les seules compétitions nationales le coefficient est le même (40 ± 4 contre 42 ± 4 tous matchs confondus, mesure sur 2025/2026).
- **Le rendement est une mesure bruitée**, ce qui tire le coefficient vers le bas : l'effet réel d'un très grand joueur est sans doute plus fort que l'estimation.
- **Piège évité.** Un premier essai lisait le rendement d'un joueur sur ses *autres* matchs de la saison, y compris les suivants. Il donnait un effet négatif (−34 points Elo par unité) : un bon match fait baisser, par construction, le rendement calculé sur les autres. Seuls les matchs **antérieurs** sont lus.

## Calcul

Le modèle est regardé une fois par jour et réajusté quand il n'existe pas ou quand la base compte 1,25 fois plus de matchs qu'au dernier ajustement (`agg.lineup_models`, une dizaine de secondes). L'estimation elle-même est calculée à la demande à partir du classement (`agg.player_power`), de l'Elo du club et du niveau de son championnat.
