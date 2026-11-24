# Score Vega v9 : le niveau calculé à côté du v8 (étape 1)

**Statut : construit sur la branche `claude/project-thread-314siw`, ni fusionné ni déployé.** 24 novembre 2026, ticket [#82](https://github.com/VegaInteligence/Vega-Sport/issues/82) ([VI-53](https://linear.app/vegainteligence/issue/VI-53)). Le classement public reste `power-ranking-v8` : cette étape calcule le niveau v9 de chaque joueur à côté, dans ses propres tables, et l'ouvre en lecture. La bascule du site est une autre étape, avec maquette.

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
3. **Mesures de référence**, prises sur une année terminée et gardées avec son calcul : λ (minutes qui divisent le bruit par deux) et σ (dispersion du talent) par poste et par bloc, la liste de prix de l'attaque, ρ et δ entre deux postes d'un joueur. Une année en cours lit celles de l'année d'avant.
4. **Deux saisons.** Le niveau lit les sommes de l'année et la moitié de celles de l'année d'avant. Un deuxième poste est acquis à 450 minutes sur les deux saisons ; les matchs à un poste non acquis n'entrent dans aucun niveau.
5. **Talent** par bloc sur les postes acquis (rétrécissement joint, corrélation ρ), le talent de défense borné à ± 2,0.
6. **Niveau.** Valeur d'un poste = Σ prix × talent ; gardien = 163 × buts évités par 90 minutes rétrécis par λ. `own` = moyenne des postes pondérée par les minutes, centrée, plus 13,4 points entre ne jamais débuter et toujours débuter. `level = own + 10 × (Elo du club − moyenne) / 400`.
7. **Score** = `100 / (1 + 10^(−(level − médiane) / 36))`, médiane de la population de référence de l'univers.

## 4. Écarts avec l'étude, à connaître

| Sujet | Étude (`study17.py`) | Service |
| --- | --- | --- |
| Duels | réparés dans le script | déjà réparés en service (#71) |
| Titularisations | lues dans les compositions | lues dans les lignes du classement : part des matchs du club à onze titulaires listés, clubs de cinq matchs ou plus |
| Niveau du club | lié à la contribution du v8 | moyenne par les minutes de (Elo du club − moyenne) / 400 sur ses matchs de club |
| Population de référence | éligibles des championnats mesurés | pareil ; à défaut (les championnats féminins ne sont pas mesurés par le v8), les éligibles de l'univers ; à défaut tous |
| Coefficient E | 9,1 pour quatre blocs | 9,1 repris tel quel pour cinq blocs : **provisoire**, à relire sur la base de production |
| Année partielle (§ 47) | hors étude | pas de niveau : calcul publié à 0 joueur, sans mesure |

## 5. Ordre de calcul des saisons

Le niveau d'une année lit celui de l'année d'avant. `power.stale_rankings` liste donc, après les années que le v8 doit refaire, celles dont le niveau manque ou est plus ancien que celui de l'année précédente, la plus ancienne d'abord. Au premier déploiement la passe quotidienne calcule ainsi 2021, 2022, …, puis l'année en cours (calculée une première fois sans l'année d'avant, puis refaite), en quelques passes, vingt années au plus par passe. Calculer le niveau d'une année refait aussi son classement v8, avec les mêmes valeurs.

## 6. Vérifié, et ce qui reste

- Formules sans base : `backend/tests/test_level.py` (cas 49a à 49o). De bout en bout sur PostgreSQL 18 jetable : `test_models.py` (49p à 49r), `test_award_year_2020_order.py` (49s), `backend/api/test/rankings.test.mjs` (49t). Tests écrits avant le code et vus en échec.
- **Pas encore vérifié : le portage sur la base de production.** Le calcul réglé comme l'étude (quatre blocs, sans conservation) doit rendre les chiffres de `study17_run1.txt` ; le coefficient E à cinq blocs est à lire dans le même passage. Il faut une tâche de diagnostic en lecture seule sur AWS.
- Restent, chacun avec son ticket : la bascule du classement public et du site (maquette, neuf postes au lieu de sept rôles), les trois critères de la course au Ballon d'Or, la comparaison v8 / v9 saison par saison une fois le calcul déployé.
