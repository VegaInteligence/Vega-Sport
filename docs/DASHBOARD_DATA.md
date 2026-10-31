# Contrat de données du dashboard

Le dashboard lit `dashboard/data/football.json`, un instantané dérivé exclusivement
des deux réponses PitchAPI enregistrées dans `data/`. Le générateur ne contacte
aucun service, ne lit aucune clé et ne calcule pas de classement Orion.

## Actualisation

Après avoir actualisé les réponses brutes avec le collecteur existant :

```bash
python scripts/build_dashboard_data.py
python -m unittest discover -s tests -v
```

Le générateur utilise uniquement la bibliothèque standard Python. `--output`
permet de choisir un autre fichier de sortie. L’ordre des matchs et des
apparitions est stable ; aucun horodatage de génération variable n’est ajouté.
`meta.retrievedAt` conserve l’horodatage du relevé et `meta.sourceSha256` permet
d’identifier exactement les fichiers sources.

## Collections

| Collection | Contenu |
| --- | --- |
| `meta` | Périmètre, date du relevé, compteurs, source, réserves et empreintes des sources. |
| `competitions` | Catalogue complet du fournisseur ; `sampleMatches` distingue les compétitions réellement présentes dans l’échantillon. |
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

Le match de 3. Liga comporte un score de 1–2, aucun événement de tir et des
statistiques de tirs et de passes entièrement nulles au sens sportif. Ces zéros
sont suspects. Le générateur les remplace par `null` dans les mesures d’action,
signale `SUSPICIOUS_ZERO_STATS` et conserve les minutes, buts et passes décisives
enregistrés indépendamment. Les scores restent ceux du fournisseur. Les champs
`coverage` doivent être consultés avant d’interpréter un tableau de tirs vide.

## Événements de tir

`shots[].x` et `y` sont les coordonnées brutes du fournisseur. `type` conserve
`event_type`. `isGoal` désigne `Goal` ; `isOwnGoal` désigne séparément `OwnGoal`.
Un but contre son camp peut ne pas avoir de xG et conserve alors `xg: null`.
`meta.shotCount` compte tous les événements de cette réponse, y compris le but
contre son camp : ce compteur peut donc différer du nombre de tentatives dans
les statistiques d’équipe.

Dans le relevé du 31 octobre 2026, l’échantillon comprend 9 matchs, 18 équipes,
320 joueurs inscrits, 274 apparitions avec des minutes jouées, 109 notes,
234 événements de tir et 233 xG de tir renseignés. Le catalogue de 77
compétitions ne signifie pas que des statistiques ont été collectées pour
chacune. Il s’agit d’un échantillon exploratoire et non d’une saison complète.
