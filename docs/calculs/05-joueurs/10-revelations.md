# Révélations

Des joueurs que le classement de puissance ne classe pas encore, faute de minutes, et qui jouent déjà comme ses titulaires ([breakout.py](../../../backend/vega/breakout.py), `/api/rankings/breakouts`).

## La règle

Un joueur est signalé sur une saison quand :

1. il a joué **au moins 270 minutes** mais reste **sous le seuil de minutes du classement** (900 minutes sur une saison entière, la moitié des minutes du joueur le plus utilisé tant que la saison n'en est pas là) ;
2. son championnat est **sur l'échelle commune** ;
3. son **rendement par 90 minutes régularisé** (celui du classement, § 8 de la méthode : il ramène vers la moyenne un joueur qui a peu joué) est **au niveau du meilleur cinquième des titulaires de son rôle** (les joueurs classés du même rôle, au moins 30) ;
4. il n'a **jamais été titulaire** (classé) lors d'une saison antérieure de la base ;
5. sa date de naissance est **connue** et il a **moins de 23 ans** au 1ᵉʳ août de la saison. Elle n'est connue que pour une minorité de joueurs (Wikidata, club par club) : un joueur dont l'âge est inconnu n'est pas signalé.

Les règles 4 et 5 écartent les joueurs établis qui ont peu joué (un titulaire blessé a le rendement d'un titulaire). La première liste, calculée sans exiger l'âge, s'ouvrait sur un international de retour de blessure et deux joueurs de 35 ans et plus : la base ne détient ni leurs saisons d'avant 2025/2026 ni leur âge. La liste est donc courte aujourd'hui (les 119 joueurs que la règle 3 retient en 2026/2027 n'ont pas tous un âge connu) et s'allonge à mesure que les dates de naissance arrivent. Le « centile » affiché est la part des titulaires de son rôle que le joueur dépasse ; les signalés sont rangés par ce centile.

## Vérification : les signalés de 2025/2026, un an après

Sur les 4 355 joueurs de 2025/2026 entre 270 et 899 minutes, dans un championnat de l'échelle commune, la règle 3 en signale 357. Ce qu'ils font en 2026/2027 (au 12 novembre 2026, un tiers de la saison) :

| | Signalés (357) | Non signalés (3 998) |
| --- | --- | --- |
| Jouent en 2026/2027 | 80 % | 60 % |
| Minutes jouées, médiane | 309 | 90 |
| Déjà 600 minutes ou plus | 25 % | 16 % |
| Rendement par 90 minutes | 0,12 (0,31 l'an passé) | −0,04 (−0,07) |
| Passés dans un club plus fort (Elo +25) | 9,9 % | 12,7 % |

Un joueur signalé rejoue plus souvent, plus longtemps, et garde un rendement nettement supérieur, même s'il revient vers la moyenne (0,31 → 0,12). Il ne rejoint **pas** plus souvent un club plus fort : le signal ne dit rien des transferts. Exemples : Rio Ngumoha (Liverpool), 614 minutes en 2025/2026, en compte déjà 488 cette saison ; Charalampos Kostoulas (Brighton), 353 minutes, en compte 731.

Ce que la vérification ne couvre pas : les règles 4 et 5 (2025/2026 est la première saison de la base, et 47 seulement de ces joueurs ont une date de naissance connue et moins de 22 ans) ; elles retirent des joueurs, elles n'en ajoutent pas. La comparaison ci-dessus mesure donc la règle 3, sur tous les âges.

## Où il se lit

- Page « Classement des joueurs » : la liste « Révélations » de la saison, les vingt premiers, avec la part des titulaires de leur poste qu'ils dépassent.
- Fiche d'un joueur signalé : une phrase sous l'Indice Vega (« Révélation : en 610 minutes, son rendement par 90 minutes le place devant 93 % des titulaires à son poste »). Un joueur sous le seuil de minutes n'a pas de score au classement ; cette phrase est tout ce que le classement dit de lui.

Recalculé avec les modèles de la saison, après le classement (`agg.player_breakouts`, `agg.breakout_runs`). L'API ne sert une liste que si la règle en vigueur l'a calculée ; une saison terminée est recalculée une fois quand la règle change. Au 13 novembre 2026, dix joueurs de 2026/2027 sont signalés.
