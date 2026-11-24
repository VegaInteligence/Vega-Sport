# Course au Ballon d'Or sur le Score Vega v9.1 : les trois critères

**Statut : étape 1 codée le 24 novembre 2026, ticket [#105](https://github.com/VegaInteligence/Vega-Sport/issues/105), pas encore déployée.** Version `vega-award-v1`. La course est calculée et rangée à côté de la course v8, qui ne change pas : `/api/rankings/power?kind=players`, `agg.player_award_ranking` et le site restent ce qu'ils sont. La nouvelle course se lit par ses propres routes. L'étape 2, la bascule du site (maquette d'abord), viendra après la lecture des vrais classements par le propriétaire. Les règles et les cas d'échec sont dans [FAILURE_MODES § 60](../09-audit-2026-11/FAILURE_MODES.md), le code dans [`award.py`](../../../backend/vega/award.py).

## 1. Ce qu'est la course

La consigne du propriétaire (24 novembre) : « le classement BO est le score v9 + une fine tuning sur les 3 façons de juger un joueur au ballon d'or ». Les trois critères et leurs poids sont les siens, à ne pas redemander :

| Critère | Poids | Partie |
| --- | --- | --- |
| Performances individuelles | 60 % | I, le niveau v9.1 de l'année |
| Performances collectives et trophées | 30 % | C, les titres et les tours atteints |
| Classe et fair-play | 10 % | F, les cartons |

La proposition validée (`/mnt/project-files/vega-ballon-dor/01-etat-des-lieux-et-proposition.md`) a été suivie avec ses trois valeurs par défaut, devenues des réglages nommés : les matchs des sélections comptent dans I, une sélection sans feuille de match donne une part de 0,5, un gardien non mesuré est calculé mais pas classé.

## 2. Les trois parties

### 2.1 Individuel, I

I est le niveau v9.1 de l'année de prix seule, en points Elo, calculé par la même passe que le niveau (`power.refresh_players`), sur les mêmes lignes, postes, blocs et références :
- sans l'année d'avant (le niveau publié la compte pour moitié) ;
- la valeur de chaque bloc d'un match est multipliée par son enjeu (`power.match_stakes` : prestige de la compétition × tour, 1 sans enjeu), les minutes ne le sont pas ;
- les matchs des sélections entrent, avec leur enjeu (`NATIONAL_MATCHES = True`) ; la part des titularisations et le niveau du club restent ceux du niveau ;
- le niveau v9.1, ses cellules, `LEVEL_VERSION` et `level.SETTINGS` ne changent pas (`level.read(..., stakes=)` rend `award_cells` à côté de `cells`).

Le niveau du club reste dans I, comme le dit le § 60.1 : le propriétaire l'a confirmé sur une carte de décision.

### 2.2 Collectif, C

C = Σ part × valeur, sur les honneurs de l'année, un par joueur, équipe et édition. Une édition appartient à l'année de son dernier match, joué ou à jouer.

| Honneur | Valeur |
| --- | --- |
| Championnat (première division masculine) | 0,5 × facteur × rang (1ᵉʳ 1, 2ᵉ 0,4, 3ᵉ 0,2, 4ᵉ 0,1, sinon 0) × avancement |
| Coupe nationale | 0,15 × facteur × tour |
| Compétition internationale | (prestige − 1) / (1,30 − 1) × tour |

- Tour : vainqueur 1, finale 0,6, demi-finale 0,4, quart 0,25, huitième 0,15. Une équipe atteint un tour quand elle a un match de ce tour, joué ou à jouer ; aucun tour n'est projeté. Le vainqueur d'une finale : le score, puis la prolongation, puis les tirs au but ; une finale jouée sans vainqueur lisible donne `final` aux deux, raison `no_winner`. Une finale en deux matchs (les deux derniers matchs de la finale, les mêmes équipes, chacune une fois à domicile) se gagne au cumul des buts (le score après prolongation quand il y en a une), puis aux tirs au but du match retour ; tant qu'une manche reste à jouer, les deux équipes ont `final`, sans vainqueur.
- Une compétition tenue par deux sources la même année donne un seul honneur par équipe, celui de l'édition lue d'abord (`award.SAME_COMPETITION`) : PitchAPI, puis OpenLigaDB, puis l'autre source. La Coupe du monde d'OpenFootball (2022 et 2026) est celle de PitchAPI ; une copie open-matchday d'un championnat ou d'une coupe UEFA que PitchAPI tient est celle de PitchAPI ; la Coupe d'Allemagne d'open-matchday est celle d'OpenLigaDB.
- Rang : lu dans les tables de base, pour les seules éditions de l'année : le tableau officiel (sportscore, championnat entier) quand ses places ne se contredisent pas (la règle de `api.standings`) et qu'il compte, club par club, les matchs que compte le tableau de Vega quand Vega en a un ; sinon celui de Vega (`agg.standings`). La course ne lit rien du schéma api : `api.standings` relit tous les tableaux officiels pour sa vérification des places, quelle que soit l'édition demandée. Avancement : matchs joués de l'édition sur ses matchs.
- Facteur : 2 / (1 + 10^((L_max − L) / 400)), L le niveau du championnat (`agg.league_levels`), L_max celui de la plus forte première division masculine ; pour une coupe nationale, le championnat du club dans l'année (celui où il a joué le plus de matchs) ; un club sans championnat mesuré a un facteur 0, raison `no_league`. Exemple : 200 points sous L_max, facteur 0,48.
- Prestige : `power.PRESTIGE` et `CUP_PRESTIGE` (Coupe du monde 1,30 → 1 ; Euro 1,20 → 0,67 ; Ligue des champions 1,15 → 0,5).
- Part : minutes du joueur pour l'équipe dans l'édition / (90 × matchs joués de l'équipe), au plus 1. Une édition sans feuilles de match (les éditions complémentaires) : ses minutes pour le club dans ses matchs PitchAPI entre le premier et le dernier match du club dans l'édition, sur ces matchs. Une sélection sans feuilles de match : 0,5 (`NATIONAL_PROXY_SHARE`) pour un joueur vu avec elle (un match PitchAPI, ou buteur relié du tournoi, § 57). Un joueur de deux clubs a les honneurs de chacun, à ses minutes avec chacun.

### 2.3 Fair-play, F

- Points de carton par joueur et match couvert (`core.match_coverage.events = 'ok'`), barème FIFA de la conduite d'équipe : jaune 1, deuxième jaune (son rouge n'est pas recompté) 3, rouge direct 4, jaune puis rouge direct 5.
- Taux tiré vers la moyenne de son poste principal : t = 90 × (points + μ × 900 / 90) / (minutes couvertes + 900), μ en points par 90 (`CARD_PRIOR_MINUTES` = 900) ; F = − t. Sans minute couverte, F est la moyenne du poste.
- **Barème non confirmé à la source.** Il a été lu dans deux comptes rendus de presse du règlement FIFA (NBC, « FIFA's fair play rule », Coupe du monde 2022 ; FourFourTwo, « What is the FIFA Team Conduct Score », Coupe du monde 2026). Le texte du règlement lui-même n'a pas été lu.

### 2.4 Échelle et score

- z sur les joueurs de référence masculins de l'année (au-dessus du seuil de minutes, championnat mesuré) : z_I et z_C sur tous, z_F au sein du poste principal ; z_C et z_F bornés à ± 4 (`Z_CAP`), z_I non borné.
- B = 0,6 z_I + 0,3 z_C + 0,1 z_F ; A = μ_I + σ_I × B / 0,6, en points Elo ; score = 100 / (1 + 10^(− (A − A₀) / 36)), A₀ la médiane de I des joueurs de référence de l'année, la courbe du niveau.
- Les moyennes et écarts sont ceux de l'année de référence (la dernière année terminée, l'année elle-même une fois finie), gardés avec son calcul (`agg.award_runs.spreads`, avec la moyenne de cartons de chaque poste) ; une année en cours sans année terminée avant elle prend les siens.
- Un joueur dans la moyenne en C et en F garde son score v9.1 de l'année seule.

### 2.5 La course

Une ligne pour chaque joueur masculin qui a une ligne de niveau de l'année et une cellule de la course ; aucune pour un joueur qui n'a joué que pour sa sélection (pas de cellule de club, donc pas de niveau), une joueuse, ou un joueur sans rôle dans le classement.

Un joueur masculin au-dessus du seuil de minutes, d'un championnat mesuré, d'un club de première division, et mesuré s'il est gardien, est classé 1, 2, 3… par A. Les autres joueurs masculins ont leurs parties et leur score, sans rang, avec la première raison qui tient : `minutes`, `league`, `not_top_division`, `keeper_data` (`KEEPER_IN_RACE = False`).

## 3. Ce qui est rangé

Migration 175 (`175_player_award.sql`, revue dans `open_matchday_restore.REVIEWED_SCHEMAS`) :
- `agg.award_runs` : un calcul publié par année, sa version, ses réglages, ses écarts, le calcul du niveau lu ; un calcul dont la course a échoué y reste avec le statut `failed`, sans joueur ;
- `agg.player_award` : I, C, F bruts, points de carton et minutes couvertes, les trois z, A, score, rang ou raison ;
- `agg.player_award_honours` : chaque honneur avec ce dont sa valeur se calcule (type, tour, rang, avancement, facteur, prestige, part), en double précision ; chaque honneur de championnat est gardé, quel que soit son rang ;
- les lectures `api.award_race` et `api.award_honours` ; le rôle de calcul n'a aucun droit sur le schéma api.

Quand :
- la passe du classement écrit la course dans sa transaction d'écriture (`award.write`), sans toucher la course v8 ;
- `award.refresh(conn, saison)` refait C, F, les z et la course à partir des lignes rangées, sans lire un match : les tables de valeurs changent, la course se recalcule ;
- `award.reread(conn, saison)` relit les honneurs et les cartons (résultats, tours, tableaux, événements ; pas les statistiques de joueurs), puis range. Le worker passe environ toutes les 60 s mais ne demande `award.due` qu'une fois par jour UTC, après les classements à refaire ; il relit une fois chaque année listée : un match daté de l'année du prix (1ᵉʳ août au 31 juillet) ou un événement d'un tel match a changé après le début de sa course. Une relecture qui échoue attend une heure, comme toute étape, et est retentée le jour même ;
- `power.stale_rankings` liste aussi les années dont le niveau publié a des joueurs et dont la course manque, est d'une autre version ou d'autres réglages, ou a commencé avant ce niveau (`award.stale`), sauf si son dernier calcul a échoué avec cette version et ces réglages après le début de ce niveau : pas de boucle. Au déploiement, les six saisons sont donc recalculées une fois.
- Un échec de la course ne bloque jamais le classement ni le niveau : sa lecture et son écriture tournent dans un point de sauvegarde, son calcul est surveillé ; le classement, les notes, le niveau et la course v8 sont publiés comme sans elle, une ligne `award race failed season=… step=read|compute|write error=<code>` est écrite (le code, jamais le message), un calcul `failed` est gardé, et la course publiée avant reste servie. Une `MemoryError` n'est pas rattrapée.

Lecture :
- `GET /api/rankings/award?season=&limit=&page=` (30 par défaut, 200 au plus) : les joueurs classés dans leur ordre, chacun avec `rank, playerId, name, imageUrl, teamId, team, teamImageUrl, position, score` (les neuf champs que le site lit aujourd'hui, mêmes noms et types) et les parties brutes `individual, collective, fairPlay, level` ;
- `GET /api/rankings/award/player?season=&player=` : ses parties et leurs z, ses points de carton et minutes couvertes, son rang ou sa raison, ses honneurs ;
- 404 sans course, 400 pour tout autre paramètre.

## 4. Ce qui n'est pas vérifié

- Rien n'a tourné sur la base de production : les tests sont sur une ligue synthétique de 8 clubs et 88 joueurs, sur PostgreSQL 18 jetable. Les vrais classements des six saisons se liront après un Deploy.
- La durée sur les volumes réels (environ 20 000 joueurs et 15 000 matchs par saison) n'est pas mesurée ; les lectures des honneurs et des cartons sont ensemblistes (une douzaine de requêtes par année), mais la fenêtre des éditions complémentaires est la plus coûteuse.
- Les poids des honneurs (0,5, 0,15, les tours) sont une première proposition, réglable sans relire un match.
- Le barème FIFA (§ 2.3).

## 5. Trous de données connus

- Coupes nationales avant 2025/2026 : la plupart n'ont pas de feuilles de match ni toujours leurs tours ; leurs honneurs reposent sur la part par fenêtre, ou manquent.
- Supercoupes : un seul match, souvent un jour sans autre match PitchAPI du club, donc une fenêtre vide : pas de part, pas d'honneur.
- Tournois des sélections sans tours ni feuilles de match (International Results) : pas de tour lisible, donc pas d'honneur ; la part de 0,5 ne s'applique qu'aux éditions qui ont des tours.
- Une coupe présente à la fois en édition PitchAPI et en édition complémentaire compte une fois quand la paire est nommée (§ 2.2) ; la Coupe du monde l'est. D'autres paires (Coupe du monde des clubs, Euro) ne sont pas vérifiées : la base de production n'a pas été lue.
- Un match daté hors de l'année du prix mais d'une édition qui s'y termine (les matchs de groupe d'une coupe jouée sur l'année civile) ne relance pas la relecture : la saison en cours est recalculée chaque jour de toute façon.
- Les cartons ne comptent que sur les matchs dont les événements sont couverts ; avant leur couverture, F est la moyenne du poste.
