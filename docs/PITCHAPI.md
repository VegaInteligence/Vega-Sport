# Football Ranking — données PitchAPI

L'archive locale couvre les saisons européennes PitchAPI 2024/25 à 2026/27,
les saisons civiles 2024 à 2026 et la Coupe du monde 2026. Les réponses brutes sont conservées dans
`data/sources/pitchapi/archives/europe_2021_2026/`, `data/sources/pitchapi/archives/europe_2026_2027/` et `data/sources/pitchapi/archives/world_cup_2026/`, par compétition et match.
Les calendriers et scores sont visibles dès l'inventaire ; les détails peuvent
encore être en cours de collecte, avec une couverture indiquée dans le dashboard.
Une saison civile est regroupée dans la saison commençant la même année, tout en
conservant la valeur exacte du fournisseur dans les données.

## Configuration

Créer un fichier `.env` à la racine à partir de `.env.example`, puis renseigner
`PITCHAPI_API_KEY`. Le fichier `.env` est ignoré par Git. La clé peut aussi être
fournie dans la variable d'environnement `PITCHAPI_API_KEY`, qui est prioritaire.

Avec Node.js, collecter le catalogue, les calendriers complets, les 13 familles
de données des matchs terminés, les détails et compositions disponibles des
rencontres à venir, et les profils de compétition, club et joueur :

```powershell
node dashboard/scripts/collect_europe.mjs
node dashboard/scripts/collect_europe.mjs --history
```

Pour récupérer uniquement l'inventaire des calendriers :

```powershell
node dashboard/scripts/collect_europe.mjs --inventory-only
```

Le script reprend les fichiers complets après interruption et réessaie les
réponses transitoires. Les indisponibilités, y compris les 404, restent indiquées
pour chaque route. Les profils renvoyant `PLAN_UPGRADE_REQUIRED` sont conservés
comme indisponibles avec la clé courante. Les fiches de rencontres non terminées sont rafraîchies après
six heures ; leurs compositions peuvent être prévisionnelles. La clé n'est pas
enregistrée dans les données.

Les noms de fichiers de profils ajoutent l'identifiant encodé en hexadécimal :
PitchAPI distingue les majuscules et minuscules, même sur un système de fichiers
Windows qui ne les distingue pas. Le nom conserve aussi l'identifiant d'origine.

Les réponses brutes sont empaquetées dans `data/sources/pitchapi/bundles/` pour GitHub.
Les archives sont découpées par saison et compétition, avec empreintes SHA-256.
Après un clone, `python dashboard/scripts/restore_europe.py` vérifie ces empreintes et
restaure les fichiers absents ; `--overwrite` remplace les fichiers locaux.
Les instantanés compressés du dashboard sont consultables sans restauration.

## Lecture des données

Le catalogue contient 77 compétitions mondiales au moment du premier relevé :
il ne couvre pas toutes les ligues européennes. Les données individuelles
dépendent de la compétition et du match.

La 1. Lig turque est classée `INT` dans le catalogue source. Les vues dérivées
l'affichent sous `TUR` ; le code d'origine reste conservé dans l'inventaire.

Dans les vérifications initiales, plusieurs matchs de 3. Liga allemande ont
renvoyé une liste de tirs vide et des totaux à zéro malgré des buts. Ces zéros
ne doivent pas être interprétés comme des mesures fiables. Les xG manquants ne
doivent pas être remplacés par zéro ; un but contre son camp n'a notamment pas
nécessairement de xG de tir.

## Tableau de bord local

Avec Node.js installé, lancer à la racine du dépôt :

```powershell
bun dashboard/backend/server.js
```

Ouvrir ensuite http://127.0.0.1:3000/. Le tableau de bord lit l’instantané
préparé à partir des fichiers du dépôt. Si `PITCHAPI_API_KEY` est configurée,
le serveur fournit aussi un accès à la demande aux saisons et aux détails
PitchAPI ; la clé reste côté serveur. Après une collecte, régénérer l'index local
et l'instantané du dashboard :

```powershell
node dashboard/scripts/index_europe.mjs
node dashboard/scripts/index_europe.mjs --history
python dashboard/scripts/build_multiseason_dashboard.py
```

Pour reprendre la collecte et régénérer automatiquement les deux fichiers du
dashboard en une commande :

```powershell
node dashboard/scripts/refresh_europe.mjs
```

Si Python n'est pas accessible sous le nom `python`, `PITCH_PYTHON` peut
contenir le chemin de son exécutable. Un chemin de rapport Markdown peut être
fourni comme premier argument à cette commande.

Une reprise normale garde les réponses déjà collectées. Pour réessayer les 404
si le fournisseur a ajouté des données, ou redemander tous les détails des
matchs, utiliser respectivement :

```powershell
node dashboard/scripts/refresh_europe.mjs --retry-unavailable
node dashboard/scripts/refresh_europe.mjs --refresh-details
```

Pour une collecte historique longue avec publication progressive sur GitHub,
`bun dashboard/scripts/publish_history.mjs` lance une seule collecte puis crée et pousse
des checkpoints des données toutes les 30 minutes et à la fin. À la fin, elle
actualise aussi la saison courante avant la dernière publication. La commande
n'ajoute que les instantanés et archives générés ; elle reporte la publication si
`main` local et distant diffèrent ou si d'autres changements sont déjà indexés. La clé reste
dans `dashboard/.env`. La durée dépend du débit et de la couverture du fournisseur.

Pour limiter cette collecte à 2024/2025 et aux saisons civiles 2024, sans
réactualiser la saison courante lors du dernier checkpoint :

```powershell
node dashboard/scripts/publish_history.mjs --years=2024 --skip-current
```

Le manifeste indique séparément si ce périmètre demandé est complet et si les
saisons plus anciennes de l'inventaire sont complètes.

Le serveur affiche aussi bien `/` que les anciennes URLs `/dashboard/`.
Les filtres, graphiques et exports sont présentés dans la
[documentation du dashboard](DASHBOARD.md).

Source : [documentation PitchAPI](https://pitchapi.dev/). Respecter les
conditions d'utilisation du fournisseur avant toute redistribution des données.

## Collecte exhaustive et reprise

`dashboard/scripts/collect_pitchapi_all.py` collecte le périmètre annoncé par le catalogue,
avec Python et sa bibliothèque standard. Il s'agit d'un outil distinct du
collecteur européen ci-dessus : il vise toutes les saisons et toutes les régions
du catalogue. Pour vérifier ce périmètre sans clé ni accès
réseau :

```powershell
python dashboard/scripts/collect_pitchapi_all.py --plan
```

La commande par défaut récupère d’abord le catalogue puis **tous les index de
matchs, pour toutes les saisons disponibles**, avec `status=all` afin de conserver
les rencontres futures et leurs scores absents :

```powershell
python dashboard/scripts/collect_pitchapi_all.py
```

Pour poursuivre avec toutes les données détaillées des matchs terminés et les
profils uniques des compétitions, équipes et joueurs :

```powershell
python dashboard/scripts/collect_pitchapi_all.py --all
```

`--details` est un alias de `--all`. Les détails commencent uniquement après la
réussite des index. Un même match ou profil n’est demandé qu’une fois par
périmètre, même s’il apparaît dans plusieurs réponses. Le volume de matchs et la
durée totale ne sont connus qu’après l’indexation.

Les 13 réponses par match sont conservées séparément : résumé, tirs, momentum,
événements, joueurs, joueurs par mi-temps, compositions, confrontations, statistiques
d’équipe, analyse avancée, analyse avancée des joueurs, réseau de passes et cartes
de chaleur. Les routes unitaires par tir ou par joueur ne sont pas rappelées
lorsqu’elles répètent ces réponses collectives. Les cartes de chaleur conservent
le repère par défaut du fournisseur.

### Fichiers et états

Le dossier de sortie par défaut est `data/sources/pitchapi/full/`. `--output` permet de
choisir un autre emplacement. Les sous-dossiers sont organisés ainsi :

- `catalog.json` : réponse du catalogue ;
- `manifest.json` : progression, compteurs, état et problèmes d’indexation ;
- `seasons/<league_id>/<season>/matches.json` : un index par saison ; le `/`
  d’une saison est encodé `%2F` dans le nom du dossier ;
- `matches/<match_id>/*.json` : une réponse par route détaillée ;
- `leagues/`, `teams/`, `players/` : profils uniques, un fichier par identifiant.

Chaque fichier constitue un point de reprise écrit atomiquement. Son enveloppe
contient la route, les paramètres, le statut HTTP, l’horodatage et la réponse
complète du fournisseur dans `response`. Les champs inconnus, `null`, tableaux
vides et erreurs sont conservés. Il n’y a pas de JSON unique regroupant tout
l’historique. Les tentatives échouées restent dans `attempts`, avec leurs erreurs
et délais, sans clé API.

Relancer la même commande reprend les réponses manquantes ou les échecs
transitoires. Les réponses réussies et les erreurs 4xx stables restent en cache.
Un statut 404 d’analyse indisponible est comptabilisé comme une indisponibilité,
pas comme une statistique nulle. Une clé refusée arrête immédiatement la collecte.
`Ctrl+C` conserve les points de reprise déjà terminés.

Pour actualiser les index, réessayer les erreurs stables, ou redemander les
détails existants :

```powershell
python dashboard/scripts/collect_pitchapi_all.py --all --refresh-indexes
python dashboard/scripts/collect_pitchapi_all.py --all --retry-errors
python dashboard/scripts/collect_pitchapi_all.py --all --refresh-details
```

Le débit par défaut est séquentiel, avec au moins 0,5 seconde entre requêtes.
Les réponses 429 et 5xx sont réessayées jusqu’à quatre fois ; `Retry-After` est
respecté, y compris après un redémarrage. `--interval`, `--max-retries` et
`--timeout` permettent d’adapter ces paramètres.

La clé reste dans `PITCHAPI_API_KEY` ou dans le `.env` existant. Elle n’est pas
acceptée comme argument de commande, ni écrite dans les réponses, les erreurs ou
le manifeste. Le client utilise HTTPS et refuse les redirections. Les archives
exhaustives ne sont pas incorporées automatiquement au dashboard publié.

### Données intégrales dans le dashboard local

Le serveur local lit les réponses détaillées directement dans l'archive, une
rencontre à la fois. Le fichier `collection.json` résume les endpoints et les
profils ; `index.json` indique les matchs disponibles et les zéros suspects.
Les archives locales ne sont pas automatiquement publiées sur le site hébergé.

## Source complémentaire : open-matchday

`data/sources/open_matchday/2026-2027/` contient les CSV de compétitions européennes
publiés par [open-matchday](https://github.com/oladeeayo/open-matchday), dont
plusieurs coupes et divisions absentes du catalogue PitchAPI. Ces données
peuvent recouvrir des matchs PitchAPI : ne pas additionner les deux sources sans
rapprochement. Elles portent principalement sur les résultats, calendriers et
certaines statistiques d'équipe, sans xG ou statistiques individuelles.
Dans le dashboard, ouvrir « Compétitions » puis « Autres ligues et coupes »
pour consulter cette source séparément et exporter ses CSV complets.

La source autorise l'usage informatif non commercial avec attribution ; ses
[conditions et crédits](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md)
sont également conservés localement. Certaines saisons civiles sont partielles et
les données peuvent être en retard sur les résultats les plus récents.
`cross_source_audit.json` compare les scores uniquement lorsque compétition,
date et noms d'équipes normalisés correspondent exactement ; il ne conclut rien
sur les rencontres non rapprochées ni sur les statistiques individuelles.

Pour actualiser uniquement cette source :

```powershell
python dashboard/scripts/collect_open_matchday.py
python dashboard/scripts/build_open_matchday_dashboard.py
```

`bun dashboard/scripts/refresh_europe.mjs` actualise les deux sources, reconstruit l'index
et le dashboard PitchAPI, puis peut régénérer le rapport de couverture.
