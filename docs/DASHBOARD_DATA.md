# Contrat de données du dashboard

Le dashboard lit désormais la [base JSON du projet](JSON_DATABASE.md) : `data/raw/index.json`, puis les tables par saison et compétition. Les joueurs, performances, matchs, tirs et statistiques sont joints par leurs identifiants dans le chargeur du frontend. Les routes d’archives du backend reconstruisent les réponses détaillées à partir des tables d’observations.

Les collections décrites ci-dessous constituent le format de lecture de l’interface, assemblé depuis ces tables. Les anciens instantanés de compétition sont uniquement des intermédiaires de génération dans `data/staging/`.

## Actualisation

Après avoir actualisé les réponses brutes avec le collecteur existant :

```bash
node dashboard/scripts/index_europe.mjs
node dashboard/scripts/index_europe.mjs --history
python dashboard/scripts/build_multiseason_dashboard.py
python dashboard/scripts/build_json_database.py
python -m unittest discover -s tests -v
```

Le générateur utilise uniquement la bibliothèque standard Python. L’ordre des
matchs et des apparitions est stable. `meta.retrievedAt` conserve l’horodatage
du catalogue de rencontres et `meta.sourceSha256` identifie cet inventaire.

## Collections

| Collection | Contenu |
| --- | --- |
| `meta` | Périmètre, date du relevé, compteurs, source, réserves et empreintes des sources. |
| `competitions` | Compétitions européennes retenues ; `sampleMatches` compte leurs matchs affichés. |
| `fixtures` | Calendriers et résultats disponibles dans l'inventaire, y compris les matchs à venir. |
| `matches` | Scores, équipes, statistiques, événements de tir, couverture et réserves par rencontre. |
| `appearances` | Une ligne par joueur inscrit et par match, y compris les joueurs sans minute jouée. |
| `metrics` | Libellés français et précision d’affichage des principaux indicateurs. |

`appearances.id` vaut `matchId:playerId`. `matches.players` contient ces identifiants,
et non des objets dupliqués. `playerId`, `teamId`, `matchId` et `leagueId` conservent
les identifiants du fournisseur. Une duplication exacte d’un match, joueur ou
événement est ignorée ; une duplication avec des contenus contradictoires bloque
la génération.

Les statistiques individuelles sont aplaties à partir de leurs clés techniques.
Une statistique répétée dans plusieurs rubriques reste une seule observation.
`passesAccurate` désigne le numérateur et `passesAttempted` le dénominateur de
la fraction renvoyée. `matches.stats[].home` et `away` contiennent des nombres
utilisables par les graphiques ; `homeRaw` et `awayRaw` conservent le texte du
fournisseur, notamment les pourcentages entre parenthèses.

## Valeurs absentes et qualité

- Une mesure absente reste `null`. Elle ne devient jamais zéro par défaut.
- Les remplaçants inscrits sans minute jouée restent dans `appearances`.
  `meta.appearanceCount` compte uniquement les lignes avec `minutes > 0`,
  tandis que `listedAppearanceCount` compte toutes les lignes.
- `meta.playerCount` compte tous les joueurs distincts inscrits ;
  `activePlayerCount` compte ceux qui ont joué.
- Une note `rating` est une note du fournisseur PitchAPI, sans validation comme
  score Orion. `meta.rankingAvailable` reste `false`.
- `role` reste `null` : les codes de poste des titulaires et des remplaçants ne
  sont pas interchangeables, et leur correspondance n’est pas validée.
  `starter`, `positionId`, `rawPitchX` et `rawPitchY` conservent l’information
  observée sans inventer un rôle.
- Une réponse HTTP en échec est indisponible même si elle contient une charge
  utile résiduelle.

Certains matchs comportent des statistiques de tirs et de passes toutes à zéro
alors que leurs tirs sont absents ou incompatibles avec le score. Ces zéros
sont suspects. Le générateur les remplace par `null` dans les mesures d’action,
signale `SUSPICIOUS_ZERO_STATS` et conserve les minutes, buts et passes décisives
enregistrés indépendamment. Les scores restent ceux du fournisseur. Les champs
`coverage` doivent être consultés avant d’interpréter un tableau de tirs vide.

## Événements de tir

`shots[].x` et `y` sont les coordonnées brutes du fournisseur. `type` conserve
`event_type`. `isOwnGoal` reconnaît `OwnGoal` ainsi que le drapeau
`is_own_goal` du fournisseur ; `isGoal` exclut les buts contre son camp.
Un but contre son camp peut ne pas avoir de xG et conserve alors `xg: null`.
`meta.shotCount` compte tous les événements de cette réponse, y compris le but
contre son camp : ce compteur peut donc différer du nombre de tentatives dans
les statistiques d’équipe.

Le nombre de matchs avec détails effectivement téléchargés figure dans
`meta.collectedMatches`, à comparer à `meta.expectedFinishedMatches`.
Les matchs dont seuls les scores sont connus restent visibles, avec les
statistiques absentes signalées. Les saisons civiles sont regroupées dans la
saison commençant la même année ; la saison source reste inchangée dans les données.
