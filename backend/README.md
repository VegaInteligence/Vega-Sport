# Vega Sport — backend

Le backend du site : une base PostgreSQL alimentée par un worker et lue par une API qui ne connaît que le schéma `api`. Il implémente le document validé « Vega Sport — schéma v2 » (claude.ai, 8–9 novembre 2026) et sert le site depuis le 10 novembre 2026 ; le backend précédent a été retiré ce jour-là. Les ressources déployées gardent leur nom d'origine (`vega-v2-…`, base `vega_v2`, variables `V2_…`).

Le [compte rendu de validation](VERIFICATION.md) contient les preuves : tests, passages réels en CI, mesures.

## Organisation

| Dossier | Contenu |
|---|---|
| `sql/` | migrations numérotées, appliquées fichier par fichier et suivies dans `ops.schema_migrations` ; `009` et `012`, `015` sont générées depuis le code Python (tests de dérive) |
| `vega/` | adaptateur PitchAPI (`pitchapi`, `normalize`, `store`, `profiles`), règles de saison (`seasons`), file (`jobs`), planificateur (`planner`), worker (`worker`), calculateur des saisons et classements (`calculator`), modèles (`models`), catalogue des métriques (`metric_catalog`), copies d'images (`media`), autres sources (`sources/`), migrations (`migrate`) |
| `api/` | API de lecture Node : les routes que lit le site, lues dans les vues `api` (`src/`), tests de contrat (`test/`) |
| `sources/`, `archives/` | lecteurs Node des sources complémentaires (`sources/bridge.mjs`, projections de coupes) et constructeurs des archives (`archives/builders/`) |
| `tests/` | tests Python avec bases PostgreSQL jetables |
| `Dockerfile` | image du worker (et des tâches de backfill et de migration) |
| `../infra/aws/` | piles CloudFormation base, worker, API, live ; procédure, coûts et historique du passage ([README](../infra/aws/README.md)) |

## Ce qui est fait

**Schéma.** `core` (faits), `agg` (calculs), `ops` (collecte, versions), `api` (vues de lecture). Saison sportive Vega distincte de l'édition du fournisseur ; une partition par saison depuis 2021, une partition d'archives 1850–2020. Les noms ne sont pas des identités (`provider_ids`, homonymes). Couverture par métrique dans les agrégats (`_sum`, `_n`, `_min`), ratios sur les seuls matchs où les deux termes existent. Rôles en base : migration (propriétaire), collecte, calcul, lecture (`017_roles.sql`).

**Collecte.** Le planificateur crée chaque minute les travaux dus :
- le calendrier `/date` de J−1 à J+7, une fois par jour ;
- le score à coup d'envoi +105 min, puis toutes les 2 min jusqu'à +150, toutes les 15 min jusqu'à +4 h, toutes les heures pendant 2 jours et chaque jour jusqu'à +7 jours ; un statut reporté, annulé ou attribué arrête la surveillance, et une nouvelle date la relance ;
- les compositions 48 h avant le match et au coup d'envoi, le h2h une fois avant le match ;
- au statut `finished`, les 12 familles de détail, puis la correction à +24 h, qui refait les détails si le fournisseur a changé le match ;
- le catalogue, les compétitions actives et leurs calendriers chaque semaine, les profils à la première apparition puis chaque mois.

Le worker prend les travaux dans l'ordre score, détails, référentiel (le backfill a sa propre tâche, dont le planificateur ajoute au plus 2 000 travaux par minute et aucun tant que sa file en contient déjà 2 000). Il écrit `core` dans la même transaction que l'acquittement, puis recalcule.

**Calcul.** Saisons joueur et club, états de jeu, classements, xPts (`agg.xpts_v1`), cohortes (par édition et poste, et Europe : Top 7 et coupes UEFA, par match), centiles et rangs, distributions P10–P90, phases et indice Vega club, positions, niveaux européens (l'Elo du classement de puissance des clubs, ajusté sur tous les résultats : aucun décalage de ligue fixé à la main), rôles et indice Vega joueur, similarité club et joueur, force des championnats, profils d'âge. Les formules sont celles de `docs/calculs`. Les cohortes se recalculent 10 min après le dernier changement ; niveaux, similarités, profils et classements de puissance une fois par jour, et pour une saison dont les matchs ont changé depuis son dernier calcul (un backfill), au plus une fois par heure. Chaque résultat porte son `agg.calc_runs`. Potentiel, projections et valeurs marchandes restent vides : le site les affiche comme fictifs.

**Classements de puissance** ([`power.py`](vega/power.py), méthode de `docs/METHODE_CLASSEMENT_BALLON_D_OR.md`), recalculés chaque jour :
- clubs : la force Elo du § 3, mise à jour match après match sur tous les matchs terminés ; chaque match se lit avec les forces d'avant. Les coupes d'Europe relient les championnats ; clubs et sélections sont classés à part (`agg.team_elo`, `agg.team_power`) ;
- joueurs : le score B par rôle des §§ 4–8. Pour chaque match, on calcule l'écart standardisé à l'attendu pour le rôle, les minutes et l'adversaire, puis la contribution C (blocs pondérés selon le rôle). Sur la saison, T = ΣC et R* = 90 T / (M + 450), et B = 0,75 Pct(T) + 0,25 Pct(R*) dans le rôle principal (`agg.player_power_matches`, `agg.player_power`) ;
- lecture : `/api/rankings/power?kind=players|clubs|nations&season=`. Les lignes joueurs portent les champs qu'attend `ballonDorRanking(season)` du site (rang, joueur, photo, club, logo, poste, score).
- plus qu'un score, une ligne par saison dans des colonnes typées :
  - clubs (`agg.team_power`) : rang, Elo, variation, Elo de début de saison, plus haut et plus bas, victoires, nuls, défaites, somme des résultats (1, ½, 0) et somme des résultats attendus par l'Elo ; l'Elo avant et après chaque match reste dans `agg.team_elo` ;
  - joueurs (`agg.player_power`) : rang, score B, rôle et rang dans le rôle, T, R*, leurs centiles, et pour chaque bloc (finition, création, progression, défense, conservation ; arrêts, jeu aérien, profondeur, relance pour les gardiens) sa part de T et le centile du joueur dans son rôle ; `agg.player_power_roles` garde une ligne par rôle joué (matchs, minutes, T, R*), comme le demande le § 8 ; le détail de chaque match reste dans `agg.player_power_matches` ;
- par club et par joueur : chaque club de l'annuaire (`/api/read/clubs`) et chaque fiche joueur (`/api/read/players`) porte `power`, son classement de la saison lue avec ce détail (`null` s'il n'est pas classé) ;
- course au Ballon d'Or : les 30 premiers joueurs éligibles de la saison, numérotés de 1 à 30, sont écrits dans `agg.player_award_ranking` avec la ligne `agg.calc_runs` qui les a produits (`kind='award'`).

Les points que la méthode laisse ouverts (son § 12) sont tranchés ainsi. Chaque réglage est nommé dans `power.py` et conservé avec chaque calcul (`agg.power_runs`) :

| Point ouvert | Choix v1 |
|---|---|
| Elo | départ 1500, K = 20, avantage du terrain 60 points (aucun en terrain neutre), attendu 1 / (1 + 10^((R_adv − R − h)/400)), résultat après prolongation (tirs au but = nul) |
| Matchs de la force | tous les matchs terminés de l'ère PitchAPI ; archives et coupes complémentaires une fois leurs équipes reliées aux mêmes clubs |
| Période et univers | une saison Vega, matchs de clubs (sélections exclues), joueur entré en jeu |
| Rôles | emplacement de la composition (`core.power_role`) ; un remplaçant prend son rôle le plus joué, sinon le défaut de sa ligne |
| Attendu, volumes | (t/90) · exp(α + β Δ), Δ = (Elo adverse − Elo propre)/400 avant le match, α et β ajustés par maximum de vraisemblance de Poisson par rôle et indicateur (β = 0 sous 200 matchs) |
| Attendu, indicateurs conditionnels | tentatives × taux de réussite du rôle (duels, duels aériens, dribbles, passes, longs ballons) |
| Gardiens | buts évités (xGOT subis − buts encaissés), attendu 0 ; sorties aériennes et poings ; sorties hors de la surface ; relance |
| Dispersion s | écart quadratique moyen de x − x̂ dans le rôle ; indicateur écarté si s = 0 ou sous 30 matchs |
| Blocs | finition (buts hors penalty, xG hors penalty, tirs cadrés, grosses occasions manquées −), création (passes décisives, xA, occasions créées, grosses occasions créées), progression (passes dans le dernier tiers, passes et conduites progressives, dribbles), défense (tacles, interceptions, récupérations, dégagements, tirs contrés, duels, duels aériens, dribblé −, erreurs −), conservation (passes réussies, ballons perdus −, ballons touchés) ; poids égaux dans un bloc |
| Valeurs absentes | jamais zéro : l'indicateur ou le bloc sort du match, les poids des blocs restants sont renormalisés |
| Rôles multiples | les contributions s'additionnent ; le rang se calcule dans le rôle qui a le plus de minutes |
| Éligibilité | 900 minutes |
| Centiles | « rang moyen » du site : (#inférieurs + ½ #égaux) / n, dans le rôle |

**Lecture.** Les corps que lisait le site sur l'API précédente (mêmes validateurs), plus un champ `retry` dans les erreurs. Une route nomme ce qu'elle sert, jamais sa source : ni le chemin ni un paramètre ne nomme un fournisseur, qui peut changer (`030_neutral_reads.sql`). Les clubs, stades et coupes se désignent par leur identifiant Vega ; la table de correspondance avec les routes de l'API précédente est en fin de liste.
- `/api/health`, `/api/status`, `/api/dashboard/manifest` (son `capabilities.compactReads` dit quelles lectures l'API sert) ;
- les lectures compactes `/api/read/home`, `clubs`, `players`, `player`, `club`, `performance`, `discipline`, avec la carte `media` de `media=1` (et, pour l'accueil, la présentation compacte `home-presentation.mjs`), et `presence` (la carte d'activité 16 × 12 d'un joueur, additionnée sur les matchs demandés : `api.player_presence`, migration 053) ;
- l'accueil en deux lectures (section « Accueil et personnalisation » du document) :
  - `/api/read/home`, la lecture commune : elle ne dépend que du périmètre et de l'heure, donc une entrée de cache par périmètre ; servie ancienne pendant qu'elle est recalculée (`stale-while-revalidate=300`, `stale-if-error=86400`), avec une nouvelle clé de cache à chaque publication (`generation`) ;
  - `/api/read/home-favourites`, la lecture personnelle : les favoris et leur force (club suivi, dernier club observé d'un joueur suivi, sa sélection), leurs prochains matchs, et « Vos joueurs cette semaine » ; privée, jamais dans le cache commun ;
  - le site choisit les 5 « Prochains matchs » selon les 6 étapes du document ([`home-upcoming.js`](../dashboard/frontend/src/services/home-upcoming.js)) ;
  - les réglages sont des données : `core.editorial_lists` (29 grands clubs, 18 championnats de la course au titre, Top 7), écrits par la source `vega` (`curated.editorial_lists`) ; les poids dans `api.home_weight_v1` ; la semaine dans `api.home_period` ; les seuils (5 places, 3 pour les favoris, 21 jours, 48 h) dans `api.home_rules_v1` (migration 044) ;
- la génération de publication (clé de cache et garde des pages du site) avance au plus toutes les 5 minutes, et seulement si une ressource a changé (`ops.publication`, publiée par le worker) : les lectures restent en direct, mais une page qui lit tout un championnat n'échoue plus en 409 parce que le worker écrit pendant qu'elle charge ;
- `/api/fixtures` (pages à curseur liées à la génération ; `teams=t_…,t_…` ne garde que les rencontres de deux clubs, toutes saisons), `/api/matches/{id}/summary`, `/api/standings`, `/api/matchdays`, `/api/search` ;
- la fiche match et ses 12 familles : `/api/matches/{id}` et `/api/matches/{id}/{lineups,events,shots,stats,players,players/halves,momentum,advanced,advanced/players,advanced/network,heatmaps,h2h}` (`frame=acting_ltr|home_ltr` pour les cartes d'activité), les profils `/api/players/{id}`, `/api/teams/{id}` et le catalogue `/api/competitions`, dans les corps que le site lit aujourd'hui, reconstruits des lignes typées ; un aller-retour sur un vrai match (`tests/fixtures/match_m_08LEIz`) le vérifie famille par famille ;
- le chargeur de saison `/api/seasons/partition` (25 matchs par page, `format=columns` empaqueté par `packPartition` (`partition-wire.mjs`), relu par le décodeur du site dans les tests) et `/api/scouting/routes` ;
- les archives : `/api/read/archive` (pages, recherche par équipe ou buteur, buts d'un match) et `/api/archives/index` ; le manifeste déclare `boundedArchive` ;
- le pool européen des fiches club et joueur (référentiel « Europe », « niveau comparable ») : `/api/clubs/europe?season=` (clubs du Top 7, coefficient UEFA, niveau Elo, niveau de tout club classé) et `/api/clubs/europe/matches?season=&league=` (matchs terminés d'une des 10 compétitions avec les statistiques d'équipe classées) ; la fiche joueur ne lit que la première (les clubs et leurs niveaux) ;
- le championnat d'un club, pour sa fiche : `/api/read/league?season=&league=&detail=summary`, tous les matchs d'une compétition une seule fois, au détail résumé de `/api/read/club` (la fiche lisait chaque club du championnat, soit vingt lectures des mêmes matchs) ; le manifeste déclare `compactReads.league` ;
- les classements et le support des fiches club : `/api/rankings/{index,edition,associations,club}` (une édition se nomme par sa saison ou sa date), `/api/club-links`, `/api/club-facts?club=`, `/api/coach-portrait`, `/api/stadium?club=`, `/api/player-honours`, `/api/assets` ;
- les coupes : `/api/cups/index`, `/api/cups/edition?competition=&season=` et `/api/cup-snapshot?kind=native|standings|edition`.

| Route de l'API précédente | Route |
|---|---|
| `/api/pitchapi/matches/{id}[/…]` | `/api/matches/{id}[/…]` |
| `/api/pitchapi/date/{d}`, `/api/pitchapi/leagues/{id}/matches` | `/api/fixtures?from=&to=`, `/api/fixtures?league=&season=` |
| `/api/pitchapi/leagues` | `/api/competitions` |
| `/api/pitchapi/players/{id}`, `/api/pitchapi/teams/{id}` | `/api/players/{id}`, `/api/teams/{id}` |
| `/api/club-wikidata?uefa=` ou `?name=&country=` | `/api/club-facts?club=t_…` |
| `/api/stadium?id=Q…` | `/api/stadium?club=t_…` |
| `/api/open-cups`, `/api/openligadb`, `/api/nations-results` | `/api/cups/edition?competition=l_v…&season=` (identifiants dans `/api/cups/index`) |
| `/api/cup-snapshot?kind=open-cups\|openligadb\|nations-results` | `/api/cup-snapshot?kind=edition` |
| `/api/rankings/edition?edition=2026.uefa` | `/api/rankings/edition?edition=2026` |
| `ballonDorRanking(season)` (vide auparavant) | `/api/rankings/power?kind=players&season=` |
| `public/demo/europe-clubs.json` (démo locale) | `/api/clubs/europe?season=` puis `/api/clubs/europe/matches?season=&league=` |

Chaque route liste en tête de fichier ses écarts voulus avec l'API précédente : identifiant d'apparition `<match>:<joueur>`, statuts normalisés, libellés de statistiques laissés au site, classement Vega servi quand aucune source officielle n'en publie.

**Médias.** Le worker copie les images des fournisseurs connus (CDN PitchAPI, Wikimedia Commons, logos TheSports) dans un bucket privé, sous une clé faite de leur SHA-256 ; CloudFront les sert sous `data/*` ([`media.py`](vega/media.py)).

**Archives.** [`archives.py`](vega/archives.py) fait tourner les constructeurs d'archives (`archives/builders/`) et `shared/archive.js` (rapprochement des buts et des matchs) sur les sources épinglées, puis écrit chaque saison en lignes typées : compétitions, éditions, équipes, matchs, tours et buteurs. Jusqu'à 2020/2021 la saison entière est importée, dans la partition d'archives. À partir de 2021/2022 PitchAPI fait foi : une compétition n'est importée que pour les saisons dont PitchAPI n'a pas d'édition (les coupes nationales qu'il n'a jamais, un championnat avant sa première saison PitchAPI), dans la partition de la saison, pour qu'un match n'existe qu'une fois (`PITCHAPI_COMPETITIONS` dit quelle compétition PitchAPI correspond à chaque compétition d'archives ; une compétition absente de la table arrête l'import). Quand PitchAPI obtient l'édition, l'import suivant retire celle des archives. Les lectures de l'ère PitchAPI laissent les archives de côté.

**Sources hors PitchAPI.**
- coefficients UEFA, avec les points par saison et les clubs encore en lice ;
- classement FIFA, toutes les éditions depuis 2021 ;
- classements officiels SportScore, écrits seulement si chaque ligne désigne un club de l'édition ;
- Wikidata et Commons : fondation, stade, entraîneur, portraits. Leurs lecteurs Node tournent via [`sources/bridge.mjs`](sources/bridge.mjs), par lots de vingt par heure.
- palmarès Wikipédia, par le collecteur `archives/builders/player_honours.py`, une centaine de joueurs par jour, Messi en premier ;
- alias de recherche et orthographes UEFA revues ;
- coupes OpenFootball, OpenLigaDB et International Results, par les projections de `sources/projections/`, pour les éditions qu'il actualise ; une source indisponible garde la dernière édition.
- compétitions complémentaires d'open-matchday (la partie européenne que lit le site) : résultats et calendriers en matchs typés, demi-temps et statistiques d'équipe (tirs, tirs cadrés, fautes, corners par période, cartons) dans `core.team_match_stats`, toutes les six heures ; lues à `/api/cup-index?kind=supplemental` et `/api/cup-table` ;
- instantanés SportsAPI (FIFA, associations et clubs UEFA), datés du jour de lecture, jamais officiels, liés comme les sources officielles ; la source dort tant que la clé `/vega/v2/sportsapi-key` n'existe pas ;
- les données écrites dans le code du site deviennent des lignes : zones de montée et de relégation de `shared/league-rules.json` (`core.competition_zones`, édition courante au bon nombre d'équipes), logos de `shared/cup-logos.json`, correspondances SportScore en identifiants fournisseur ;
- une équipe par équipe réelle ([`identity.py`](vega/sources/identity.py)) : une équipe vue d'abord dans une coupe complémentaire est fusionnée dans l'équipe PitchAPI que nomme une règle unique (même nom normalisé, nom connu ou orthographe UEFA revue, même pays). Ses matchs, identifiants et noms passent à l'équipe PitchAPI ; l'orthographe de la source reste un nom `source_spelling`, que montrent les lectures de coupes. Un match de coupe que PitchAPI a aussi est noté `duplicate_match` (et `score_disagreement` si les scores diffèrent) dans `ops.data_warnings`. Les lectures de l'ère PitchAPI laissent les coupes de côté : le site ne le voit qu'une fois. Les équipes d'archives rejoignent de même le club PitchAPI de leur pays (nom français du pays dans `core.countries`), au même nom ou au même nom sans ses mots de forme (« West Ham United FC » et « West Ham United »), quand un seul club répond et que le nom d'archive porte chaque mot de forme du nom PitchAPI : un mot que PitchAPI garde sépare deux clubs (« Wimbledon », 1929-2003, n'est pas « AFC Wimbledon »). Les quelques orthographes d'archive auxquelles il ne manque que ce mot sont revues une à une (`ARCHIVE_SPELLINGS`). Une édition européenne d'archive ne nomme pas de pays : ses équipes sont cherchées de la même façon parmi tous les clubs PitchAPI. Deux équipes d'archives aux mots de forme contradictoires (« Parma AC », « Parma FC ») ne rejoignent pas le même club, et une fusion qui ferait jouer un club contre lui-même est refusée. Les sélections sont les équipes des compétitions de sélections que nomme main (`NATIONAL_COMPETITIONS`, portée `national_teams`) : `core.teams.is_national`, que la collecte PitchAPI ne renseigne pas, vient de là, et une sélection de coupe ne rejoint qu'une sélection. La fusion avance par lots de 100 équipes ; un lot que la base refuse est coupé en deux jusqu'à la paire en cause, qui attend le passage suivant. Chaque match garde les noms que sa source a donnés à ses côtés (`core.matches.home_team_name`, `away_team_name`).

Chaque source a sa période dans `ops.source_runs`. Une erreur de base de données reste confinée à sa portée.

**Live** ([`vega/live`](vega/live), section « Live » du document ; pile `infra/aws/live.yaml`). Le circuit entier est en place, sans fournisseur : le document le laisse à choisir (PitchAPI ne fait pas de live) et c'est la seule pièce qui manque.
- un seul flux par match en direct, jamais un par spectateur : l'ingestor (`python -m vega.live --until-idle`, tâche ECS `vega-v2-live`) est lancé par EventBridge Scheduler toutes les 15 minutes tant qu'un fournisseur est choisi ; sans match dans les 30 minutes il s'arrête aussitôt, sinon il suit les matchs du jour jusqu'au dernier. Il relie avant le coup d'envoi le match du fournisseur au match `core` (date et équipes, joueurs par `core.provider_ids`), l'interroge toutes les 3 s et n'écrit que ce qui change ;
- verrous : un bail pour l'ingestor (un second lancement s'arrête) et un bail par match (écriture conditionnelle DynamoDB) qui expire en 60 s : si l'ingestor tombe, le suivant reprend le match à la dernière révision écrite ;
- révisions : chaque changement est la révision suivante du match, écrite d'un bloc (événements et stats, puis l'état) et poussée en un message qui porte `match` et `revision` ; une correction (but annulé par la VAR, carton modifié) est une nouvelle révision du même événement (`provider_event_id`, `is_cancelled`), jamais un nouvel événement ;
- le live n'entre jamais dans `core` : trois tables DynamoDB à la demande (`vega-v2-live-state`, `vega-v2-live-events`, `vega-v2-live-team-stats` par équipe), colonnes du document (`home_score`, `away_score`, `minute_added`, `period`, `event_type`, `team_id`, `player_id`, `related_player_id`, `player_name`…), `expires_at` sur chaque ligne ;
- diffusion par AppSync Events, canal `/live/match/{id}` : l'ingestor publie avec IAM, les navigateurs s'abonnent avec une clé publique, seulement quand l'onglet est visible ; l'état complet se lit à `GET /live/matches/{id}` (une fonction hors du réseau privé, servie par la distribution de l'API à `live/*`, cache 2 s), lu à une seule révision (relu si un élément est plus récent que l'état) ; le navigateur applique les révisions dans l'ordre et recharge l'état complet s'il en manque une ;
- PitchAPI fait foi : au coup de sifflet du flux, résultat provisoire ; puis le site passe à `core` famille par famille (score, événements, stats) dès que PitchAPI a chacune ; un écart (score, buts, buteur) va dans `ops.live_discrepancies` (vue `ops.live_reliability`), les données live elles-mêmes ne sont pas gardées ;
- les données live expirent 24 h après que `core` est complet, 72 h après le match au plus tard ; les lectures filtrent sur `expires_at` ;
- indépendant du fournisseur : un adaptateur par fournisseur ([`adapters.py`](vega/live/adapters.py)) ; l'adaptateur `replay` rejoue un flux enregistré à travers tout le circuit (tests, essai à blanc). Brancher un fournisseur : une classe dans `adapters.py`, puis `LIVE_PROVIDER=<nom>` au déploiement, qui allume la planification EventBridge de l'ingestor ;
- côté site (`services/live-client.js`, `hooks/useLiveMatch.js`) : la fiche match affiche la minute et le score du direct, puis « Résultat provisoire », puis le score de `core` ; il faut les réglages `NEXT_PUBLIC_LIVE_EVENTS_HTTP`, `_REALTIME` et `_KEY` (sorties de la pile `vega-v2-live`).

## Ce qui reste

- Les routes de l'API précédente qui ne sont pas servies, volontairement : `/api/archives/season` (documents source entiers, inutiles avec `boundedArchive`), `/api/archive/matches/{id}` (l'archive brute d'un match ; le site ne la lisait qu'en repli quand une famille native manquait, et toutes les familles sont servies), `/api/supplemental`, l'index du worker de coupes retiré (`cup-index?kind=worker`, le site lit le catalogue) et `orion-pro`.
- `/api/player-market-values` n'est pas servie : la carte de valeur de la fiche joueur répond « Données indisponibles ».
- football-data, ESPN et fixturedl sont les sources des lignes d'open-matchday ; la colonne `source` de chaque ligne n'est pas gardée.
- L'extrait UEFA écrit à la main pour un joueur (`dashboard/frontend/src/services/uefa-nations-snapshot.js`) reste dans le code du site : la base n'invente pas d'identités d'équipe pour recopier un correctif.
- Le backfill tourne (service `vega-v2-backfill`) : le site montre ce que la base contient pendant ce temps. L'import des archives est terminé (9 novembre 2026, 150 saisons, 489 963 matchs).
- Le fournisseur live, à choisir (question ouverte du document) : le circuit est déployé, l'ingestor attend son adaptateur.

## Exécution locale

Python 3.12, PostgreSQL 16 ou plus avec `pg_trgm` (pgvector en option), Node 22 ou plus.

```sh
pip install -r backend/requirements.txt
export PYTHONPATH=backend
export V2_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/vega_v2_local   # localhost et nom vega_v2_* uniquement
V2_MIGRATION_DATABASE_URL=$V2_DATABASE_URL python -m vega.migrate
# PITCHAPI_API_KEY dans l'environnement, jamais dans le dépôt :
python -m vega.worker --max-jobs 200 --report work/worker.md
```

Hors localhost, une connexion exige TLS (`sslmode=require` ou plus) et une base `vega_v2*`. `V2_CALC_DATABASE_URL` donne au calculateur sa propre connexion (rôle calcul).

API de lecture, avec une base peuplée :

```sh
cd backend/api && npm ci
node --input-type=module -e "import {createReader} from './src/db.mjs'; import {createHandler} from './src/handler.mjs'; const h=createHandler(createReader(process.env.V2_READ_DATABASE_URL)); const r=await h(new Request('http://local/api/read/clubs?season=2025/2026&leagues=all')); console.log(r.status, await r.text())"
```

Le pilote historique de la PR #53 reste disponible : `python -m vega.pilot --max-matches 1 --report work/pilot.md`.

## Tests

Chaque suite a sa base locale jetable (`vega_v2_*_test`) et refuse toute autre base. Variables : `VEGA_V2_TEST_DSN`, `VEGA_V2_JOBS_TEST_DSN`, `VEGA_V2_STORE_TEST_DSN`, `VEGA_V2_PILOT_TEST_DSN`, `VEGA_V2_PROFILES_TEST_DSN`, `VEGA_V2_CONCURRENCY_TEST_DSN`, `VEGA_V2_UNKNOWN_TEST_DSN`, `VEGA_V2_VALIDATED_TEST_DSN`, `VEGA_V2_AGG_TEST_DSN`, `VEGA_V2_API_TEST_DSN`, `VEGA_V2_WORKER_TEST_DSN`, `VEGA_V2_MODELS_TEST_DSN`, `VEGA_V2_ROLES_TEST_DSN`, `VEGA_V2_SOURCES_TEST_DSN`, `VEGA_V2_MEDIA_TEST_DSN`, `VEGA_V2_ARCHIVES_TEST_DSN`, et `VEGA_V2_API_NODE_TEST_DSN` pour l'API.

```sh
python -m unittest discover -s backend/tests -v
npm test --prefix backend/api
```

Le workflow `Isolated pilot` lance les deux suites, le pilote Ligue 1, puis 700 travaux du worker sur les vrais calendriers J−1 à J+7, dans un PostgreSQL éphémère du runner. Il n'a aucun identifiant AWS : seul le secret PitchAPI lui est donné, et il n'exporte qu'un rapport de mesures (comptes, codes, chemins de champs, durées), jamais de données.
