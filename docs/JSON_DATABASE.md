# Base de données JSON

Le dossier `data/` est le stockage du projet. Le dashboard est un client de cette base : son interface et son serveur restent dans `dashboard/`, ses observations sont lues dans `data/raw/` et les futurs résultats de modèle dans `data/computed/`.

## Analyse des données existantes

PitchAPI fournit des identifiants stables de compétition, équipe, joueur et match, des statistiques individuelles, des tirs et treize familles de réponses détaillées. Le corpus couvre six saisons affichées, avec des saisons civiles conservées dans leurs valeurs sources et regroupées selon leur année de début.

Open Matchday ajoute des calendriers, résultats et buts en CSV. Ses noms et identifiants ne suffisent pas à établir une identité commune avec PitchAPI. Les observations de cette source restent donc distinctes et conservent leur provenance. Une fusion sur le seul nom n’est pas effectuée.

Les anciennes vues du dashboard comportaient déjà des normalisations : valeurs absentes à `null`, statistiques suspectes masquées, rôle inconnu conservé. Ces vues sont séparées en tables sans modifier leurs valeurs. Les réponses fournisseurs intégrales sont également conservées dans les tables d’observations pour retrouver les valeurs originales.

## Organisation

```text
data/
├── raw/
│   ├── index.json
│   ├── match-observations.json
│   ├── observation-shards.json
│   ├── profile-index.json
│   ├── profiles/
│   └── seasons/
│       └── 2025-2026/
│           ├── competitions/
│           ├── teams/
│           ├── players/
│           ├── fixtures/
│           ├── matches/
│           ├── performances/
│           ├── shots/
│           ├── team_statistics/
│           └── observations/
├── computed/
├── sources/                # Archives d’import originales et conditions des fournisseurs
└── staging/                # Intermédiaires de génération, ignorés par Git
```

Les fichiers `.json.gz` sont des tableaux JSON compressés pour limiter leur taille. Les tables sont partitionnées par saison et compétition ; les observations détaillées sont réparties en fragments indexés. Ce découpage évite un fichier géant et respecte la sensibilité à la casse des identifiants, même sur macOS/Windows.

## Relations

| Table | Identifiant et relations |
|---|---|
| Compétitions | `id`, présent dans `leagueId` des matchs et performances |
| Équipes | `id`, référencé par `teamId` et les équipes du match |
| Joueurs | `id` de version d’identité ; `playerId` conserve l’identifiant fournisseur |
| Matchs | `id`, saison et compétition ; tirs et statistiques stockés séparément |
| Performances | `id` joueur-match ; `matchId`, `teamId`, `playerId` et `playerRef` |
| Tirs | `id` et `matchId`, avec joueur/équipe si disponibles |
| Statistiques d’équipe | `matchId`, valeurs des groupes statistiques |
| Observations détaillées | `documentId`, `matchId`, source et réponse fournisseur ; une table par famille |
| Profils | Observation versionnée du joueur, club ou compétition avec source et statut |

Une même personne peut changer de nom d’affichage ou d’image. `playerRef` permet de reconstituer exactement chaque observation sans écraser cette différence. Les saisons natives, champs manquants et états de couverture restent explicites.

## Lecture du dashboard

Le serveur associe `/data/football-manifest.json` à `data/raw/index.json`. Le chargeur lit les tables de la saison demandée et joint les joueurs aux performances, ainsi que les tirs et statistiques aux matchs. Il reconstitue ensuite le format attendu par l’interface. Aucun instantané métier n’est stocké dans `dashboard/`.

`/api/archive/matches/:id` reconstitue une observation détaillée à partir des index et des tables JSON. Les différentes versions restent présentes ; la version dont la date de collecte est la plus récente est privilégiée. Les profils passent par leur propre index. `data/sources/` ne sert pas de stockage de lecture au dashboard.

Le build publie les tables nécessaires aux vues principales et au complément Open Matchday. Les routes d’archives locales exigent le backend Node ; le Worker hébergé conserve sa passerelle PitchAPI pour les détails à la demande. Le build n’embarque pas les archives sources ni toutes les observations détaillées.

## Génération

```bash
python3 scripts/build_json_database.py
node dashboard/server.js
```

L’import reconstruit les tables depuis les vues locales existantes dans `data/staging/dashboard/` et les archives dans `data/sources/`. Chaque partition est reconstruite depuis les nouvelles tables puis comparée à l’ancienne vue : toute perte de valeur bloque la génération. `--tables-only` limite la génération aux tables principales ; `--indexes-only` reconstruit les index d’observations.

Les collecteurs et générateurs historiques alimentent la zone d’import. Après actualisation des sources et des vues intermédiaires, relancer le générateur de base JSON. Les fichiers originaux restent conservés pour la provenance et la reproductibilité.
