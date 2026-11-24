# Score Vega v9 : le niveau calculé à côté du v8 (étape 1)

**Statut : étape 1 fusionnée (PR #83, `035ba32d`) et déployée le 24 novembre 2026 (déploiement 125) ; les six saisons de 2021/2022 à 2026/2027 sont calculées.** Ticket [#82](https://github.com/VegaInteligence/Vega-Sport/issues/82) ([VI-53](https://linear.app/vegainteligence/issue/VI-53)). Le classement public reste `power-ranking-v8` : cette étape calcule le niveau v9 de chaque joueur à côté, dans ses propres tables, et l'ouvre en lecture. La bascule du site est une autre étape, avec maquette. La première lecture en production (§ 7) a conduit au **v9.1** : [03-v9-1-gardiens-lateraux.md](03-v9-1-gardiens-lateraux.md).

La méthode est celle de la [proposition](01-proposition.md) (§§ 4, 11 et 12), avec les choix de l'utilisateur des 23 et 24 novembre. Les règles et les cas d'échec sont dans [FAILURE_MODES § 49](../09-audit-2026-11/FAILURE_MODES.md).

## 1. Les choix de l'utilisateur

| Sujet | Choix |
| --- | --- |
| Poids du club ψ | 10 points Elo pour 400 points d'Elo de club (les transferts mesurent 8,6 ± 0,4) |
| Conservation | gardée dans le score : cinq blocs, avec les poids annoncés du v8 |
| Attaquant de soutien | case retirée : une seule liste de prix pour l'attaque |
| Bloc défense | attendus en contexte, échelle stabilisée, talent borné à ± 2,0 écarts-types (§ 12.3) |
| Versions | pas de v8.1 : le v9 complet, puis toutes les saisons depuis 2021 recalculées avec lui |
| Course au Ballon d'Or | gardée ; elle partira du score v9 ajusté par trois critères (60 % individuel, 30 % collectif et trophées, 10 % classe et fair-play), ticket à part |

## 2. Ce qui est construit

- [`backend/vega/level.py`](../../../backend/vega/level.py) : le calcul, porté de `study17.py` (candidat K3), la conservation ajoutée comme cinquième bloc.
- [`power.refresh_players`](../../../backend/vega/power.py) : la passe du classement calcule le niveau avec les lignes joueur-match qu'elle tient déjà, puis l'écrit dans la même transaction que le classement v8. Les sorties du v8 (classement, notes, course) ne changent pas ; `METHOD_VERSION` non plus. Le niveau a sa version, `score-vega-v9`.
- Migration [`167_player_level.sql`](../../../backend/sql/167_player_level.sql), des relations nouvelles seulement :

| Table | Contenu |
| --- | --- |
| `agg.level_runs` | un calcul par année : version, réglages, mesures de référence (`measured`), année de référence |
| `agg.player_level_cells` | les sommes d'un joueur par poste et par club sur l'année : ce que lisent le niveau de l'année et la moitié de celui de l'année suivante |
| `agg.player_level` | le niveau : `level = own + club`, `own = blocks + starts`, le score sur 100, le rang dans l'univers et dans le poste |
| `agg.player_level_positions` | par poste du joueur : jugé (part, valeur, niveau à ce poste, talents par bloc) ou non jugé (minutes) |

- Lecture, sans rien changer aux routes du classement ni au site : `GET /api/rankings/level?season=&universe=&position=&limit=&page=` et `GET /api/rankings/level/player?season=&player=` (vues `api.player_levels`, `api.player_level_positions`).

## 3. Le calcul, en court

1. **Poste d'un match.** Huit postes de champ et le gardien. L'ailier du v8 devient milieu offensif, milieu excentré ou ailier selon son emplacement. Ne sont pas jugés : le match d'un joueur de champ dans les buts, et celui d'un joueur de champ qui a gardé les buts sur un tir.
2. **Blocs d'un match.** Finition, création, progression, conservation comme le v8, contre le groupe de référence du poste (les quatre postes d'attaque partagent un groupe, puis chaque poste est recentré sur sa moyenne de l'année). Défense : attendus par régression de Poisson sur l'écart d'Elo, les passes de l'adversaire et la défense à trois, effet de la compétition rétréci sur 50 évènements, écart lu sur l'échelle `2√(x + 3/8)`.
3. **Mesures de référence**, prises sur une année terminée et gardées avec son calcul : λ (minutes qui divisent le bruit par deux) et σ (dispersion du talent) par poste et par bloc, la liste de prix de l'attaque, ρ et δ entre deux postes d'un joueur. Une année en cours lit celles de l'année d'avant. Depuis le v9.1 la référence du gardien n'est plus mesurée : c'est un réglage, 13 291 minutes pour toutes les années ([note v9.1](03-v9-1-gardiens-lateraux.md)).
4. **Deux saisons.** Le niveau lit les sommes de l'année et la moitié de celles de l'année d'avant. Un deuxième poste est acquis à 450 minutes sur les deux saisons ; les matchs à un poste non acquis n'entrent dans aucun niveau.
5. **Talent** par bloc sur les postes acquis (rétrécissement joint, corrélation ρ), le talent de défense borné à ± 2,0.
6. **Niveau.** Valeur d'un poste = Σ prix × talent ; gardien = 163 × buts évités par 90 minutes, rétrécis par 13 291 minutes. `own` = moyenne des postes pondérée par les minutes, centrée (depuis le v9.1, le centre des latéraux est 1,05 point au-dessus de leur moyenne), plus 13,4 points entre ne jamais débuter et toujours débuter. `level = own + 10 × (Elo du club − moyenne) / 400`.
7. **Score** = `100 / (1 + 10^(−(level − médiane) / 36))`, médiane de la population de référence de l'univers.

## 4. Écarts avec l'étude, à connaître

| Sujet | Étude (`study17.py`) | Service |
| --- | --- | --- |
| Duels | réparés dans le script | déjà réparés en service (#71) |
| Titularisations | lues dans les compositions | lues dans les lignes du classement : part des matchs du club à onze titulaires listés, clubs de cinq matchs ou plus |
| Niveau du club | lié à la contribution du v8 | moyenne par les minutes de (Elo du club − moyenne) / 400 sur ses matchs de club |
| Population de référence | éligibles des championnats mesurés | pareil ; à défaut (les championnats féminins ne sont pas mesurés par le v8), les éligibles de l'univers ; à défaut tous |
| Coefficient E | 9,1 pour quatre blocs | 9,1 repris tel quel pour cinq blocs : **provisoire**. Le niveau propre à cinq blocs est 2,5 à 3,5 % plus resserré qu'à quatre (§ 6) ; E se remesure par la régression sur les résultats de match de l'étude, pas encore refaite à cinq blocs |
| Année partielle (§ 47) | hors étude | pas de niveau : calcul publié à 0 joueur, sans mesure |
| Référence du gardien | mesurée sur l'année : 13 291 minutes en 2025, 5 395 en 2024 | v9 : mesurée sur l'année ; v9.1 : réglage fixe, 13 291 minutes pour toutes les années |
| Écart entre postes | non mesuré | v9.1 : latéraux à − 1,05 point (univers masculin) |

## 5. Ordre de calcul des saisons

Le niveau d'une année lit celui de l'année d'avant. `power.stale_rankings` liste donc, après les années que le v8 doit refaire, celles dont le niveau manque ou est plus ancien que celui de l'année précédente, la plus ancienne d'abord. Au premier déploiement la passe quotidienne calcule ainsi 2021, 2022, …, puis l'année en cours (calculée une première fois sans l'année d'avant, puis refaite), en quelques passes, vingt années au plus par passe. Calculer le niveau d'une année refait aussi son classement v8, avec les mêmes valeurs.

Une année dont le niveau est d'une autre version que `LEVEL_VERSION`, ou calculé avec d'autres réglages que ceux du code (`agg.level_runs.settings`, clé manquante comprise), est listée aussi : après le déploiement du v9.1, toutes les années sont refaites, la plus ancienne d'abord.

## 6. Vérifié, et ce qui reste

- Formules sans base : `backend/tests/test_level.py` (cas 49a à 49o). De bout en bout sur PostgreSQL 18 jetable : `test_models.py` (49p à 49r), `test_award_year_2020_order.py` (49s), `backend/api/test/rankings.test.mjs` (49t). Tests écrits avant le code et vus en échec. Les cas du v9.1 sont au § 54 (54a à 54n).
- **Le portage, sur la base de production** (24 novembre, tâche de diagnostic en lecture seule, rien d'écrit ; années 2024 à 2026, image en service `e7f826b4`, `level.py` du commit `2143b9cb`). Réglé comme l'étude (quatre blocs, conservation sans prix), le calcul rend les chiffres de `study17_run1.txt` :

| Mesure | Étude | Service réglé comme l'étude |
| --- | --- | --- |
| Lignes joueur-match de club par poste, 2024 et 2025 | DC 77 030 … MEX 11 273 ; DC 89 259 … MEX 14 128 | identiques, les neuf postes |
| λ et σ 2025, huit postes, quatre blocs | étude § 0 | σ identiques à trois décimales sauf une (0,415 contre 0,414) ; λ à 0,2 % près |
| Gardien 2025 | 13 291 ; 0,062 | 13 291 ; 0,062 |
| Liste de prix à quatre blocs | AC 3,6 2,3 1,7 1,2 … DC 0,6 0,6 1,7 6,3 | identique, les huit postes |
| Dispersion du niveau propre | 5,5 (2025) ; 4,5 (2026) | 5,5 ; 4,5 |
| Vingt premiers, 2025 et 2026, ψ 24 et ψ 10 | listes K3 | les vingt mêmes joueurs dans les quatre listes ; plus grand écart de rang 5 places (2025, ψ 24), 2, 1 et 1 ailleurs |
| Massiré Sylla 2026 | talent de défense + 3,01 gardé à + 2,00 ; 31ᵉ à ψ 24, 18ᵉ à ψ 10 | + 3,01 gardé à + 2,00 ; 31ᵉ ; 18ᵉ |
| Hommes éligibles des championnats mesurés | 12 737 (2025) ; 4 486 (2026) | **12 436 ; 4 437** |

- **Écart non expliqué : la population de référence**, 2,4 % plus petite en 2025 et 1,1 % en 2026. L'étude lisait `eligible` et `linked` dans le classement stocké ; le service les prend dans le classement que la même passe vient de calculer (le niveau n'a pas de drapeau à lui). L'écart est donc entre deux passes du v8, pas dans le portage ; quel changement de code ou de données retire 301 joueurs de 2025 n'est pas établi. À lire dans la comparaison v8 / v9 une fois les deux stockés par la même passe.
- **Avec les réglages du service** (cinq blocs, ψ = 10), sur la même base : 2026 donne Yamal 87,5, Olise 86,9, Rúben Neves 83,8, Kimmich 81,7, Güler 81,7 ; Sylla est 38ᵉ (74,1). 2025 donne Messi 92,2, Olise 90,3, Dembélé 87,3, Yamal 87,2, Cherki 86,5. Cinq blocs contre quatre à ψ = 10 : corrélation des niveaux 0,979 (2025) et 0,973 (2026), 23 et 22 joueurs communs dans les trente premiers, 84 et 81 dans les cent premiers.
- **Pas vérifié : le coefficient E à cinq blocs.** Ce passage n'a pas la régression sur les résultats de match ; il montre seulement que le niveau propre se resserre de 5,54 à 5,40 (2025) et de 4,54 à 4,38 (2026) quand la conservation entre avec E inchangé.
- Restent, chacun avec son ticket : la bascule du classement public et du site (maquette, neuf postes au lieu de sept rôles), les trois critères de la course au Ballon d'Or, E remesuré à cinq blocs.

## 7. Première lecture en production (24 novembre)

Les six saisons ont été lues sur l'API de production juste après leur calcul (v9 par `/api/rankings/level`, v8 par `/api/rankings/power`, 1 600 premiers de chaque méthode, joueurs provisoires écartés).

| Saison | Communs dans les 20 / 50 / 100 premiers | Spearman, 500 premiers | Gardiens dans les 100 premiers du v9 | Écart-type du niveau propre, gardiens | Défenseurs centraux |
| --- | --- | --- | --- | --- | --- |
| 2021/2022 | 12 / 29 / 64 | 0,66 | 0 | 3,3 | 5,4 |
| 2022/2023 | 14 / 31 / 61 | 0,64 | 0 | 3,5 | 5,3 |
| 2023/2024 | 10 / 34 / 67 | 0,63 | 0 | 3,6 | 5,5 |
| 2024/2025 | 5 / 20 / 46 | 0,41 | 36 | 8,5 | 5,7 |
| 2025/2026 | 10 / 34 / 56 | 0,59 | 9 | 5,7 | 5,5 |
| 2026/2027, en cours | 12 / 33 / 67 | 0,67 | 11 | 3,3 | 4,7 |

- **Cinq saisons sur six se tiennent** : le premier du v9 est celui du v8 (Alexander-Arnold, Messi, Rodri, Messi, Yamal).
- **2024/2025 est faussée par les gardiens** : sept des dix premiers, Yéhvann Diouf (Reims) en tête avec + 28,0 points pour ses arrêts.
- **Aucun gardien dans les 100 premiers de 2021/2022 à 2023/2024.**
- Le site n'affichait pas le niveau v9 : rien de cela n'a été visible du public.

L'utilisateur a demandé une mesure avant toute correction. Elle explique les deux constats sur les gardiens, établit un écart pour les latéraux et fonde le v9.1 : [03-v9-1-gardiens-lateraux.md](03-v9-1-gardiens-lateraux.md).
