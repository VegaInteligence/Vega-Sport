# Vega Sport — v2

Implémentation du document validé « Vega Sport — schéma v2 » (claude.ai, 8–9 novembre 2026), sur la base du prototype de la PR #53. Une base neuve, alimentée par un worker et lue par une API qui ne connaît que le schéma `api`. Le RDS, les fichiers S3, l'API et les workflows qui servent aujourd'hui le site ne sont ni lus ni modifiés par ce code.

Le [compte rendu de validation](VERIFICATION.md) contient les preuves : tests, passages réels en CI, mesures.

## Organisation

| Dossier | Contenu |
|---|---|
| `sql/` | migrations numérotées, appliquées fichier par fichier et suivies dans `ops.schema_migrations` ; `009` et `012`, `015` sont générées depuis le code Python (tests de dérive) |
| `vega_v2/` | adaptateur PitchAPI (`pitchapi`, `normalize`, `store`, `profiles`), règles de saison (`seasons`), file (`jobs`), planificateur (`planner`), worker (`worker`), calculateur des saisons et classements (`calculator`), modèles (`models`), catalogue des métriques (`metric_catalog`), copies d'images (`media`), autres sources (`sources/`), migrations (`migrate`) |
| `api/` | API de lecture Node : mêmes routes et même format que l'API actuelle, lues dans les vues `api` (`src/`), tests de contrat (`test/`), script de parité (`parity.mjs`) |
| `tests/` | tests Python avec bases PostgreSQL jetables |
| `Dockerfile` | image du worker (et des tâches de backfill et de migration) |
| `../infra/aws-v2/` | piles CloudFormation base, worker, API ; procédure, coûts et bascule ([README](../infra/aws-v2/README.md)) |

## Ce qui est fait

**Schéma.** `core` (faits), `agg` (calculs), `ops` (collecte, versions), `api` (vues de lecture). Saison sportive Vega distincte de l'édition du fournisseur ; une partition par saison depuis 2021, une partition d'archives 1850–2020. Les noms ne sont pas des identités (`provider_ids`, homonymes). Couverture par métrique dans les agrégats (`_sum`, `_n`, `_min`), ratios sur les seuls matchs où les deux termes existent. Rôles en base : migration (propriétaire), collecte, calcul, lecture (`017_roles.sql`).

**Collecte.** Le planificateur crée chaque minute les travaux dus :
- le calendrier `/date` de J−1 à J+7, une fois par jour ;
- le score à coup d'envoi +105 min, puis toutes les 2 min jusqu'à +150, toutes les 15 min jusqu'à +4 h, toutes les heures pendant 2 jours et chaque jour jusqu'à +7 jours ; un statut reporté, annulé ou attribué arrête la surveillance, et une nouvelle date la relance ;
- les compositions 48 h avant le match et au coup d'envoi, le h2h une fois avant le match ;
- au statut `finished`, les 12 familles de détail, puis la correction à +24 h, qui refait les détails si le fournisseur a changé le match ;
- le catalogue, les compétitions actives et leurs calendriers chaque semaine, les profils à la première apparition puis chaque mois.

Le worker prend les travaux dans l'ordre score, détails, référentiel (le backfill a sa propre tâche). Il écrit `core` dans la même transaction que l'acquittement, puis recalcule.

**Calcul.** Saisons joueur et club, états de jeu, classements, xPts (`agg.xpts_v1`), cohortes (par édition et poste, et Europe : Top 7 et coupes UEFA, par match), centiles et rangs, distributions P10–P90, phases et indice Vega club, positions, niveaux européens, rôles et indice Vega joueur, similarité club et joueur, force des championnats, profils d'âge. Les formules sont celles de `docs/calculs` (main). Les cohortes se recalculent 10 min après le dernier changement ; niveaux, similarités et profils une fois par jour. Chaque résultat porte son `agg.calc_runs`. Potentiel, projections, Ballon d'Or et valeurs marchandes restent vides : le site les affiche comme fictifs.

**Lecture.** À l'identique de l'API actuelle (mêmes paramètres, mêmes corps, mêmes validateurs), plus un champ `retry` dans les erreurs :
- `/api/health`, `/api/status`, `/api/dashboard/manifest` (son `capabilities.compactReads` dit quelles lectures la v2 sert) ;
- les lectures compactes `/api/read/home`, `clubs`, `players`, `player`, `club`, `performance`, `discipline`, avec la carte `media` de `media=1` (et, pour l'accueil, la présentation compacte de main, importée telle quelle) ;
- `/api/fixtures` (pages à curseur liées à la génération), `/api/matches/{id}/summary`, `/api/standings`, `/api/matchdays`, `/api/search` ;
- les archives : `/api/read/archive` (pages, recherche par équipe ou buteur, buts d'un match) et `/api/archives/index` ; le manifeste déclare `boundedArchive` ;
- les classements et le support des fiches club : `/api/rankings/{index,edition,associations,club}`, `/api/club-links`, `/api/club-wikidata`, `/api/coach-portrait`, `/api/stadium`, `/api/player-honours`, `/api/assets` ;
- les coupes : `/api/open-cups`, `/api/openligadb`, `/api/nations-results` et `/api/cup-snapshot` (éditions des sources, coupes PitchAPI et classements).

Chaque route liste en tête de fichier ses écarts voulus avec l'API actuelle, pour la parité : identifiant d'apparition `<match>:<joueur>`, statuts normalisés, libellés de statistiques laissés au site, classement Vega servi quand aucune source officielle n'en publie.

**Médias.** Le worker copie les images des fournisseurs connus (CDN PitchAPI, Wikimedia Commons, logos TheSports) dans un bucket privé, sous une clé faite de leur SHA-256 ; CloudFront les sert sous `data/*` ([`media.py`](vega_v2/media.py)).

**Archives.** [`archives.py`](vega_v2/archives.py) fait tourner sans modification les constructeurs d'archives de main et `shared/archive.js` (rapprochement des buts et des matchs) sur les sources épinglées, puis écrit chaque saison jusqu'à 2020/2021 en lignes typées : compétitions, éditions, équipes, matchs, tours et buteurs, dans la partition d'archives. Les lectures de l'ère PitchAPI les laissent de côté.

**Sources hors PitchAPI.**
- coefficients UEFA, avec les points par saison et les clubs encore en lice ;
- classement FIFA, toutes les éditions depuis 2021 ;
- classements officiels SportScore, écrits seulement si chaque ligne désigne un club de l'édition ;
- Wikidata et Commons : fondation, stade, entraîneur, portraits. Les lecteurs de main tournent tels quels via [`sources/bridge.mjs`](sources/bridge.mjs), par lots de vingt par heure.
- palmarès Wikipédia, par le collecteur de main (`player_honours.py`), une centaine de joueurs par jour, Messi en premier ;
- alias de recherche et orthographes UEFA revues de main ;
- coupes OpenFootball, OpenLigaDB et International Results, par les projections de main, pour les éditions qu'il actualise ; une source indisponible garde la dernière édition.

Chaque source a sa période dans `ops.source_runs`. Une erreur de base de données reste confinée à sa portée.

## Ce qui reste

- Les routes encore servies par l'API actuelle : `/api/seasons/partition` (chargeur de saison complet, inutile une fois toutes les lectures compactes servies), `/api/archives/season` (documents source entiers, inutiles avec `boundedArchive`), `/api/archive/matches/{id}`, le catalogue figé des coupes open-matchday (`cup-index`, `cup-table`, `supplemental` : le worker de coupes de main est retiré, ces routes peuvent rester sur main), le proxy `/api/pitchapi/*` et `orion-pro`.
- Les autres adaptateurs : SportsAPI, OpenFootball, OpenLigaDB, International Results, coupes (football-data, ESPN, fixturedl). L'import réel des archives attend la copie en lecture seule des sources de main (`data/sources/`).
- Le déploiement des piles AWS, le backfill, la parité réelle et la bascule route par route : voir `infra/aws-v2/README.md`. Rien n'est déployé.

## Exécution locale

Python 3.12, PostgreSQL 16 ou plus avec `pg_trgm` (pgvector en option), Node 22 ou plus.

```sh
pip install -r v2/requirements.txt
export PYTHONPATH=v2
export V2_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/vega_v2_local   # localhost et nom vega_v2_* uniquement
V2_MIGRATION_DATABASE_URL=$V2_DATABASE_URL python -m vega_v2.migrate
# PITCHAPI_API_KEY dans l'environnement, jamais dans le dépôt :
python -m vega_v2.worker --max-jobs 200 --report work/vega-v2-worker.md
```

Hors localhost, une connexion exige TLS (`sslmode=require` ou plus) et une base `vega_v2*`. `V2_CALC_DATABASE_URL` donne au calculateur sa propre connexion (rôle calcul).

API de lecture, avec une base peuplée :

```sh
cd v2/api && npm ci
node --input-type=module -e "import {createReader} from './src/db.mjs'; import {createHandler} from './src/handler.mjs'; const h=createHandler(createReader(process.env.V2_READ_DATABASE_URL)); const r=await h(new Request('http://local/api/read/clubs?season=2025/2026&leagues=all')); console.log(r.status, await r.text())"
```

Le pilote historique de la PR #53 reste disponible : `python -m vega_v2.pilot --max-matches 1 --report work/vega-v2-pilot.md`.

## Tests

Chaque suite a sa base locale jetable (`vega_v2_*_test`) et refuse toute autre base. Variables : `VEGA_V2_TEST_DSN`, `VEGA_V2_JOBS_TEST_DSN`, `VEGA_V2_STORE_TEST_DSN`, `VEGA_V2_PILOT_TEST_DSN`, `VEGA_V2_PROFILES_TEST_DSN`, `VEGA_V2_CONCURRENCY_TEST_DSN`, `VEGA_V2_UNKNOWN_TEST_DSN`, `VEGA_V2_VALIDATED_TEST_DSN`, `VEGA_V2_AGG_TEST_DSN`, `VEGA_V2_API_TEST_DSN`, `VEGA_V2_WORKER_TEST_DSN`, `VEGA_V2_MODELS_TEST_DSN`, `VEGA_V2_ROLES_TEST_DSN`, `VEGA_V2_SOURCES_TEST_DSN`, `VEGA_V2_MEDIA_TEST_DSN`, `VEGA_V2_ARCHIVES_TEST_DSN`, et `VEGA_V2_API_NODE_TEST_DSN` pour l'API.

```sh
python -m unittest discover -s v2/tests -v
npm test --prefix v2/api
```

Le workflow `Vega v2 isolated pilot` lance les deux suites, le pilote Ligue 1, puis 700 travaux du worker sur les vrais calendriers J−1 à J+7, dans un PostgreSQL éphémère du runner. Il n'a aucun identifiant AWS : seul le secret PitchAPI lui est donné, et il n'exporte qu'un rapport de mesures (comptes, codes, chemins de champs, durées), jamais de données.
