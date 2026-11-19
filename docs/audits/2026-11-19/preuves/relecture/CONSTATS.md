# Relecture indépendante — `2088d36e60..8587ab6671` (code de production)

Worktree `/home/romai/Agents/worktrees/vega-audit-reprise-20261119`, branche `claude/audit-reprise-33`. Lecture seule ;
base jetable `relecture_a` (PostgreSQL 18.6 local, migrations jusqu'à 160 par `vega.store.migrate`, rejouées sans erreur).
Scripts et sorties dans ce dossier.

## Constats, du plus grave au moins grave

### 1. `/api/read/performance` balaie toutes les statistiques et compositions à chaque appel (grave, certain)

- `backend/api/src/routes/performance.mjs:133-134` : `SELECT gs.grade_status FROM api.player_grade_status gs JOIN target t ON gs.season_id=t.season_id AND gs.match_id=t.match_id AND gs.player_id=t.player_id`.
- Vue `backend/sql/155_player_grade_status.sql:167-199` : son ensemble de clés `k` est un `UNION ALL` de `core.player_match_stats` et de `core.lineup_players` avec un `NOT EXISTS`. Le planificateur ne peut pas pousser une condition de jointure (valeurs venues de la CTE `target`) dans ce sous-ensemble. Il construit donc la vue entière, puis la joint par hachage.
- Démonstration (`seed.sql`, `explain_grade_status.sql` → `explain_grade_status.out`) : 60 000 matchs, 1,5 M lignes de statistiques et 1,8 M lignes de compositions, partitionnées sur 6 saisons. Le plan fait un Parallel Seq Scan de chaque partition de `player_match_stats` (deux fois) et de `lineup_players`. **14,1 s d'exécution** pour une seule ligne. Même résultat en désactivant hash et merge join (`explain_grade_status_nohash.out`) : aucun plan paramétré n'est possible. Avec des constantes (`WHERE gs.season_id=2024 AND match_id=… AND player_id=…`, `explain_grade_status_const.out`), l'exécution tombe à 1,8 ms.
- En production (plus de 2 M lignes de statistiques), chaque page de performance coûterait plus que dans ce test : délai dépassé ou base saturée sur un chemin chaud. Piste de correction : filtrer avec les valeurs liées, comme le fait déjà `found(values)`, c'est-à-dire `${season}`, `api.internal_id('match',…)` et `api.internal_id('player',…)`, au lieu de joindre `target`. Le gain est démontré avec des littéraux ; il reste à le confirmer avec des paramètres liés.

### 2. `api.player_injury_reads` (160) fait passer un premier 404 pour « aucune blessure » (moyen, certain)

- `backend/sql/160_reads_keep_omitted_observations.sql:40-46` retire `r.error_code IS NULL` (en place depuis 116). Le commentaire de la migration et FAILURE_MODES §44.2 disent pourtant : « the reader sets `read_at` only in `done`, never on a refusal … A first read refused stays unknown (404) ».
- Le lecteur, lui, pose `read_at` sur un 404 : `backend/vega/transfermarkt.py:889-891`. Le chemin `except Missing` appelle `self.done(kind, key, priority, 0, status=404, error="NOT_FOUND", …)`, et `done` (l. 836-839) écrit `read_at = now`. Pour les blessures, `Missing` n'est pas intercepté plus tôt, à la différence des transferts (l. 875-878).
- Scénario : joueur lié à Transfermarkt, jamais lu ; sa première lecture des blessures répond 404. Avant : `GET /api/players/{id}/injuries` répondait 404 « Donnée indisponible ». Après : `{"injuries": []}`, soit « jamais blessé » pour un joueur dont on ne sait rien.
- Démonstration : `injury_reads_404.sql` → `injury_reads_404.out`. La vue 160 retourne 1 ligne ; la règle 116 en retournait 0.

### 3. `identity.correct_sides` peut bloquer le passage d'identité pour de bon après un retour en arrière d'un côté (moyen-faible, plausible)

- `backend/vega/sources/identity.py:597-606` : un côté trouvé sur `wrong` est déplacé, puis enregistré par un `INSERT INTO core.team_side_corrections`. Cet INSERT n'a pas de `ON CONFLICT`, et la clé primaire est `(match_id, side)` (156).
- Scénario : à la première application, un des 15 matchs est « held » (ligne stockée différente de la revue, clé OpenFootball introuvable…). Les matchs trouvés sont déplacés, mais les clés (`openfootball name:FC Barcelona`, `vega archive:europe:fc barcelona`) restent sur Barcelona SC (l. 609-611). Une relecture ultérieure de l'édition Copa del Rey (digest changé) repasse par `snapshot.write`, qui résout le côté par la clé restée sur `wrong` et remet `home/away_team_id` à Barcelona SC. Au passage suivant, `correct_sides` revoit `values[side] == wrong`, retente l'INSERT et prend un 23505. Tout le scope `teams` est annulé (fusions comprises), et l'erreur revient à chaque passage.
- Il faut cumuler un match « held » et une réécriture du côté par un autre writer, d'où le classement plausible. Pour l'éviter : `ON CONFLICT DO NOTHING`, ou considérer la correction déjà enregistrée comme « done/held ».

### 4. `failure_once` balaie `ops.parse_failures` à chaque appel (faible, plausible)

- `backend/vega/sources/__init__.py:166-173` fait un `SELECT EXISTS … WHERE competition_season_id IS NOT DISTINCT FROM … AND error_code = … AND message = …`. `ops.parse_failures` n'a que sa clé primaire `id` (vérifié sur la base migrée), et aucun code ne la purge. `Store.record_failure` y ajoute une ligne par échec PitchAPI, désormais aussi par `EMPTY_AFTER_OBSERVATION` revenu chaque jour.
- Appelants : `player_facts.save` une fois par joueur en conflit de date de naissance, dans la transaction du club (`player_facts.py:189-194`) ; les retenues Open Matchday ; FIFA. Le volume de production n'a pas été mesuré, d'où le classement plausible. Avec une table de plusieurs centaines de milliers de lignes et des centaines de conflits, cela fait des dizaines de secondes par passage. Un index sur `(error_code, competition_season_id)` suffirait.

### 5. Les lignes de statistiques sans équipe (`team_id IS NULL`) perdent leur note (faible, certain sur le mécanisme ; volume inconnu)

- `backend/vega/power.py:1337` et `refresh_players` (l. 1362-1363) : `in_match = s.team_id IN (home, away)` vaut NULL quand `team_id` est NULL. `not r["in_match"]` les exclut alors en `team_not_in_match`.
- Avant le diff, ces lignes étaient notées : delta 0, aucune jointure Elo. Après, la prochaine exécution de chaque année efface leurs notes publiées. La vue 155 traite bien `team_id IS NULL` comme `team_not_in_match`, donc c'est cohérent avec la spécification. Mais §38 ne décrit que « a third team's row » : le retrait des notes déjà publiées pour un `team_id` NULL n'est ni mentionné ni compté. `core.player_match_stats.team_id` est nullable. À compter en production avant de déployer.

### 6. `archives.merge_twins` contre la clé étrangère de 156 (très faible, plausible)

- `core.team_side_corrections` référence `core.matches` sans `ON DELETE` (156:20). `snapshot.remove` et les retraits d'archives passent par `ops.archive_match_dependents`, qui est dynamique, et retiennent donc ces matchs. `merge_twins` (`archives.py:1061`) ne retient que les attestations.
- Si l'un des 9 matchs européens corrigés était un jumeau `g:` à fusionner, son DELETE violerait la clé étrangère et la saison échouerait à chaque passage, avec un message seulement. Peu probable : la détection se fait par noms et ces matchs sont des résultats.

## Zones relues sans constat

- `store.py` EMPTY_AFTER_OBSERVATION : la logique est correcte. Le job échoue puis est relancé une fois par jour (`planner._revive_failed`) : pas de boucle.
- `worker.elo_due` : il ne se déclenche pas après une exécution normale, parce que `refresh_elo` réécrit tout `agg.team_elo` avec le nouveau `run_id` et que (c) recouvre les conditions de `ELO_MATCHES`. Coût négligeable (millisecondes sur 120 000 côtés).
- `power.ADMINISTRATIVE` et `ELO_MATCHES` : sans constat.
- `write_grade_exclusions` : il remplace les lignes de l'année dans la transaction de publication ; une clé vue dans deux années est déplacée sans doublon. Le droit `vega_calc` et le déclencheur d'archive sont cohérents avec `agg.player_match_grades`. `ops.archive_lock_references` le prend en compte, car il est dynamique.
- `sources.run_due`, `prepare_due` (cups) et `bridge.mjs projections` : URL sous forme de chaîne, cache par URL, mêmes exceptions interceptées que pour un scope seul, délai de 120 s large pour 8 éditions.
- Open Matchday (`left_edge`, `retained`, `missing`, `final_score`) : un résultat créé est retenu au passage suivant (clé liée, position réservée, score de la preuve). Les 360 attestations sont toutes de saison 2026, cohérentes avec `int(season[:4])`.
- `curated.club_aliases` : la contrainte `ON CONFLICT (entity_type, entity_id, normalized)` existe bien (`entity_names_pkey`).
- `uefa` (spellings SportScore, `EMPTY_EDITION`, comparaison avant réécriture), `fifa` (relecture hebdomadaire, refus d'une édition plus courte) et `wikidata` (`coalesce` des champs omis) : sans constat.
- Transfermarkt hors blessures (valeurs, effectifs, `link_players` limité aux membres présents) : sans constat.
- `player_facts` : sans constat hors constat 4.
- Migrations 155, 156 et 160 : additives, `lock_timeout` de 3 s, rejouables (une transaction par fichier, checksum). Les droits sont corrects pour les trois rôles : `vega_read` ne voit que les vues `api`, `vega_collect` a SELECT/INSERT sur les corrections, `vega_calc` a SELECT et écrit les exclusions.
- API `match-details` (règle d'affichage), `profiles` (`absentSince` ajouté seulement s'il est renseigné) et `performance` (`gradeStatus`) : contrats additifs, hors constats 1 et 2.
- `open_matchday_restore` (`REVIEWED_SCHEMAS`, `ADDED_DEPENDENCIES`) : sans constat.

## Non relu

- Les tests, jeux d'essai, documents et le contenu détaillé de `open_matchday_published.json` (seulement compté).
- Les projections Node (`open-cups`, `openligadb`) au-delà du fetch de `nations-results`.
- `uefa.link_team` et `crest_club` (hors diff), `identity.pairs` et `merges` (hors diff).
- Aucun writer n'a été exécuté de bout en bout sous les rôles réels. Seuls les constats 1 et 2 ont été démontrés par exécution SQL. Le constat 5 est démontré par lecture du code ; les constats 3, 4 et 6 restent plausibles.
