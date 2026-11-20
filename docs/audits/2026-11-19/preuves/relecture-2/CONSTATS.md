# Relecture indépendante n° 2 — `8587ab6671..1cc4af1200` (code de production)

Lecture seule du worktree `/home/romai/Agents/worktrees/vega-audit-reprise-20261119`, branche `claude/audit-reprise-33`.
Périmètre : `backend/vega`, `backend/sql` (157, 159, 160), `backend/api/src`.

Base jetable `relecture_b_159` sur PostgreSQL 18.6 local (port 55535). Elle est migrée de zéro par `vega.store.migrate`
du worktree, lancé avec `python -B` : aucun `.pyc` n'est écrit dans le worktree (`migrate.py`). Elle est peuplée par
`seed_b.sql` :
- 530 500 matchs, dont 480 000 matchs de clubs répartis sur 2 400 éditions ;
- 30 000 lignes SportScore sur 1 500 éditions, dont 9 en conflit de rang, et 48 000 lignes `agg.standings` ;
- 250 sélections et 50 500 matchs de sélections : 7 500 natifs sur 6 saisons, 3 000 copies Open Cups (`cup_key`,
  `cup_name`, le même jour ou la veille), 38 500 matchs d'archive International Results sur 77 ans et 1 500 copies
  d'archive datées de la veille.

Toutes les requêtes tournent sous `SET ROLE vega_read`, avec les réglages de session de `db.mjs` : `jit=off`, pas de
workers parallèles, `search_path=api`, `statement_timeout` de 8 s. Elles sont préparées (`PREPARE`/`EXECUTE`) avec
paramètres liés ; plans custom, et plans génériques quand c'est indiqué.

## Constats, du plus grave au moins grave

### 1. `api.nation_list` (159) est 3,3 fois plus lente sur un volume proche de la production, et son coût suit tout `core.matches` (moyen, certain : mesuré)

- `backend/sql/159_standings_rank_conflicts.sql`, `nation_list`, CTE `games` (vers les lignes 208-219) : la nouvelle
  version rejoint chaque ligne à `core.matches m ON m.id = g.match`, seulement pour lire `competition_season_id` et les
  scores. Le plan fait une troisième lecture séquentielle de toute la table `core.matches` (530 500 lignes) et un hachage
  de toute la table, qui déborde sur disque en 8 lots. La version 119 en faisait deux.
- La CTE `played` ajoute un `NOT EXISTS` sur `games` joint à lui-même. Le planificateur le traite en Merge Anti Join
  sur (`team`, `a`, `b`), dont le coût est quadratique en nombre de rencontres d'une même paire (6,2 M lignes écartées
  par le filtre de jointure sur la base complète).
- Routes concernées : `GET /api/nations`, et chaque `GET /api/nations/{id}`, qui appelle la liste entière
  (`nations.mjs:179, 187`).
- Mesures, `EXECUTE nlist('2026/2027')` :

  | Base | 119/120 (avant) | 159 |
  |---|---|---|
  | Proche de la production : archive IR retirée, 12 000 matchs de sélections, 480 000 matchs de clubs (`explain_nations_small.out`) | 217 ms | 710 ms |
  | Base complète, 50 500 matchs de sélections (`explain_baseline.out`, `explain_159.out`) | 499 ms | 2 777 ms |

- Preuve de la cause (`explain_variant.sql/.out`) : la même fonction, avec les colonnes lues directement dans les deux
  branches de l'`UNION ALL`, sans la jointure supplémentaire, prend 333 ms au lieu de 710 ms. Le reste de l'écart,
  environ 115 ms, vient de l'anti-jointure.
- Pas de dépassement des 8 s au volume actuel : la production affiche au plus 124 matchs par sélection et 3 328 au
  total. Le coût grossit pourtant avec l'ensemble des matchs de clubs, que le backfill continue d'augmenter, et la
  requête tourne à chaque page de sélection.

### 2. `/api/standings` est 4 fois plus lente : `api.standings_rank_conflicts()` agrège toute la table `core.standings_official` trois fois par requête (faible à moyen, certain : mesuré)

- Dans 159, la vue `api.standings` (CTE `conflicted AS MATERIALIZED`) et `api.standings_withheld()` appellent toutes
  deux la fonction SECURITY DEFINER `standings_rank_conflicts()`. Le planificateur ne peut y pousser aucun filtre
  d'édition, donc la fonction agrège toutes les lignes SportScore de toutes les éditions.
- `standingsBody` (`reference.mjs:51-66`) lit `api.standing_rows` deux fois et `standings_withheld()` une fois, soit
  trois agrégations complètes. Chacune prend environ 45 ms sur 30 000 lignes (`Function Scan on standings_rank_conflicts
  … 47.2 ms`, puis `45.0 ms`).
- Mesures, `EXECUTE standings(...)` :

  | Cas | 150 (avant) | 159 |
  |---|---|---|
  | Plan custom (3 cas) | 41-47 ms | 186-193 ms |
  | Plan générique | 28 ms | 109 ms |

  `/api/cup-snapshot?kind=standings` passe par la même fonction.
- Le coût croît avec tout l'historique des tables officielles, pas avec l'édition demandée. C'est sans danger au volume
  actuel, mais linéaire à chaque appel.
- Le comptage du worker (`worker.py:1085`, `count(*) FROM api.standings`) passe de 3,60 s à 4,03 s.

### 3. `api.nation_matches` (159) : la jointure LATERAL `x` est en O(matchs gardés × copies absorbées × copies) (faible, certain : mesuré)

- `kept` … `LEFT JOIN LATERAL (… FROM absorbed b JOIN copies c … JOIN copies s …)` est réévaluée pour chaque ligne
  gardée, en relisant chaque fois les CTE matérialisées, qui n'ont pas d'index.
- Mesures, `EXECUTE nmatches(100001)` :

  | Base | 120 (avant) | 159 |
  |---|---|---|
  | Proche de la production | 5,8 ms | 34 ms |
  | Sélection de 416 copies, dont 18 absorbées (`nested_nation.out`, 368 boucles à 1,7 ms) | 26 ms | 653 ms |

  En plan générique, 634 ms.
- Sans effet au volume actuel (au plus environ 124 matchs par sélection). La fonction devient coûteuse si une sélection
  accumule des centaines de copies d'archive.

### 4. Recherche Transfermarkt : un club choisi qui n'a jamais de nom refait la recherche complète chaque jour (faible, plausible)

- `backend/vega/transfermarkt.py:987-996` : si `core.provider_clubs` n'a pas de nom pour le club choisi (pas de ligne,
  ou `name` NULL), la recherche est replanifiée à `SEARCH_UNNAMED_AGAIN`, soit 1 jour.
- Deux cas où ce nom n'arrive jamais à temps :
  - La lecture `/clubs` omet le club. `write_club` enregistre alors un 404, sans ligne `provider_clubs`, et l'unité
    `club` attend `NOT_FOUND_AGAIN`, soit 90 jours. `queue` ne la replanifie pas plus tôt, à cause de
    `ON CONFLICT DO NOTHING`.
  - La fiche du club n'a pas de nom. `parse_club` renvoie `name` None, la colonne est nullable, et le club n'est relu que
    tous les 30 à 180 jours, toujours sans nom.
- Dans les deux cas, la même équipe refait chaque jour la recherche, jusqu'à 6 lectures d'effectif et les lots
  `/players`, soit 5 à 8 requêtes à 2,5 s d'intervalle, sans jamais conclure. C'est du budget de requêtes pris sur un
  lecteur qui se met en pause dès un refus.
- Correctif possible : borner les reprises à un jour (compteur, ou échéance de l'unité `club`), puis revenir à
  `PERIODS["search"]`.

### 5. La migration 160 a été modifiée sur place : une base déjà migrée sur `8587ab6671` ne migre plus (faible, certain : démontré)

- `checksum_on_8587_base.out` : une copie de `relecture_a`, migrée sur `8587ab6671`, applique 157 et 159, puis s'arrête
  sur `StoreError: MIGRATION_CHECKSUM_CHANGED` en arrivant à 160.
- La production est sur `2088d36e60`, qui s'arrête à 153 : elle n'est pas touchée. En revanche, toute base de recette,
  de développement ou de test persistante, migrée sur le candidat `8587ab6671` ou `b4e24bfdec`, doit être recréée.
  À vérifier avant de rejouer une base existante.

## Mesures des vues et fonctions de 159

Volumes et réglages : voir l'en-tête. Fichiers `explain_159.out` (159), `explain_baseline.out` (définitions 150, 119 et
120 recréées dans une transaction annulée, mêmes requêtes) et `explain_nations_small.out` (volume proche de la
production).

| Requête de route | Avant | 159 | Plan, points clés |
|---|---|---|---|
| `standingsBody`, édition courante en conflit, sans saison (`l_000100`) | 47 ms | 193 ms | 2 × Function Scan `standings_rank_conflicts` (≈ 45 ms chacun), Function Scan `standings_withheld` |
| `standingsBody`, `l_000150`, saison 2025 | 41 ms | 188 ms | idem |
| `standingsBody`, `l_000200`, sans saison | 41 ms | 186 ms (générique : 28 → 109 ms) | idem |
| `standings_withheld()` seule | — | 39 ms | agrégation de 30 000 lignes |
| `nation_list('2026/2027')`, base complète | 499 ms | 2 777 ms | 3 Seq Scan `matches` + hachage de 530 000 lignes sur disque ; Merge Anti Join, 6,2 M lignes écartées |
| `nation_list`, proche de la production | 217 ms | 710 ms | variante sans re-jointure : 333 ms |
| `nation_matches(100001)`, 416 copies | 26 ms | 653 ms | LATERAL 368 × 1,7 ms |
| `nation_matches(100001)`, proche de la production | 5,8 ms | 34 ms | — |
| `count(*) FROM api.standings` (worker) | 3 598 ms | 4 030 ms | — |

Aucune requête ne dépasse 8 s sur ces volumes, et toutes passent sous `vega_read`, donc les droits suffisent.

Sémantique vérifiée (`withheld_404.out`) :
- une édition courante en conflit, sans table Vega, ne renvoie aucune ligne, donc un 404, et jamais la saison
  précédente ;
- la saison 2025 de la même ligue est servie par SportScore ;
- une édition en conflit qui a une table Vega est servie par Vega ;
- le nombre de matchs de `nation_list` est égal au nombre de lignes de `nation_matches` (368 et 368).

## Corrections de la première relecture : elles tiennent

- **Constat 1** (`performance.mjs`, statut de note lu par clé) : la sous-requête envoyée par la route, rejouée sur
  `relecture_a` avec paramètres liés, prend 2,2 ms en plan custom et 1,7 ms en plan générique. Seule la partition
  `player_match_stats_s2024` est lue, par sa clé primaire, sans lecture séquentielle (`grade_status_bound.out`).
- **Constat 2** (`done(accepted=…)`, `NOT_FOUND_REFUSED`) : un 404 sur les blessures ne pose plus `read_at` et ne
  modifie pas `rows_written`. Le nettoyage de 160 est ciblé (unités de blessures refusées dont le joueur n'a aucun
  épisode Transfermarkt) et indexé (PK `provider_ids`, index `player_injuries (player_id, source)`). `read_at` ne sert
  ailleurs qu'à la priorité des profils : aucun effet sur l'ordonnancement.
- **Constat 3** (`correct_sides`, `ON CONFLICT (match_id, side) DO NOTHING`) : la clé primaire existe et
  `vega_collect` garde le droit INSERT. Un côté remis sur le mauvais club est de nouveau déplacé sans faire échouer le
  passage.
- **Constat 4** (157) : `Index Scan using parse_failures_once` avec les trois conditions, avec ou sans édition, en plan
  custom comme générique : 0,03 ms sur 300 000 lignes (`failure_once_plan.out`, insertion annulée).
- **Constat 5** : la non-reproduction est confirmée par lecture. `PLAYER_MATCHES` fait `JOIN core.teams t ON t.id =
  s.team_id` (`power.py:1055`).
- **Constat 6** (`merge_twins`, `side_corrected`) : la paire est retenue avant toute écriture. Une suppression revue
  reste retenue par `core.team_side_corrections.match_id`, qui ne fait pas partie de `RELEASED_ON_REMOVAL`.

## Zones relues sans constat

- **`archives.py`** (lots 45 et 46) : `holding()` est appliqué de la même façon au plan (`removals`) et à l'exécution
  (`_delete`). `released` n'apparaît que lorsqu'il est non vide. La clé étrangère de football-data est bien
  `ON DELETE SET NULL`, et aucun déclencheur `archive_removed_*` n'est posé sur cette table. Les deux lots sont
  cohérents entre eux.
- **`transfermarkt.py`** (lots 44, 45 et 46), hors constat 4 : `done(accepted=…)` et `write_search` ne se gênent pas.
  `write_search` appelle `done` avec `accepted=True`, et le conflit `reserve_side` est idempotent.
- **`open_matchday.uncovered` / `drop_copy`** : la copie est gardée entière, et la trace `COPY_NOT_COVERED` est écrite
  une fois, dans la transaction. La requête utilise les index d'édition et coûte quelques millisecondes par passage. La
  fenêtre de ±1 jour couvre l'écart entre la date UTC de PitchAPI (`normalize.py:316`) et la date locale de la copie.
- **`sportscore.check`** (plusieurs tables sans nom) : sans constat.
- **`sources.failure_once`** : sans constat.
- **Migration 159** : sans constat hors performance.
  - `lock_timeout` de 3 s.
  - Les nouvelles fonctions reçoivent EXECUTE pour `vega_read` par les privilèges par défaut de 017, comme
    `j1_standings_exclusion`. Les `CREATE OR REPLACE` gardent les droits de 119 et 120.
  - L'`INSERT … ON CONFLICT DO UPDATE` des versions de ressource ne voit qu'une ligne par édition, puisque la fonction
    groupe par édition.
- **Migration 157** : `CREATE INDEX` non concurrent, acceptable puisque le worker est arrêté pendant les migrations.
- **`open_matchday_restore.REVIEWED_SCHEMAS`** : 160 reste la dernière migration appliquée.
- **Contrats d'API** : aucun champ retiré. Les changements de `/api/standings` (404 ou source Vega pour une édition en
  conflit) et de `/api/nations` (libellé de l'édition, copies absorbées) sont ceux de la spécification.

## Non relu ou non exécuté

- Les tests, jeux d'essai et documents, hors §43, §45 et §46 lus pour l'intention.
- Aucun writer n'a été exécuté de bout en bout : Transfermarkt, Open Matchday, archives, identité et
  `footballdata._link` ont été relus seulement. Le constat 4 reste donc plausible.
- Le volume réel de production de `core.standings_official`, des matchs de sélections et de `ops.transfermarkt_reads`
  n'a pas été mesuré. Les ordres de grandeur viennent des pages publiques lues par le lot « classements ».
- Le frontend (`tournamentRuns`, libellés) a été relu seulement dans `nations.mjs`.
- La base `relecture_b_159` est conservée pour rejouer les mesures. La copie temporaire `relecture_b_ck` a été
  supprimée après la démonstration du constat 5.
