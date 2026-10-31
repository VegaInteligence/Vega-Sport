# Football Ranking — données PitchAPI

Ce dépôt contient un premier relevé du catalogue PitchAPI et des données brutes
de neuf matchs européens. Les fichiers sont dans `data/` :

- `pitchapi_championnats.json` : catalogue des compétitions et saisons renvoyées par l'API ;
- `pitchapi_premiers_matchs.json` : compositions, statistiques de joueurs et d'équipes, et tirs pour les matchs testés.

## Configuration

Créer un fichier `.env` à la racine à partir de `.env.example`, puis renseigner
`PITCHAPI_API_KEY`. Le fichier `.env` est ignoré par Git. La clé peut aussi être
fournie dans la variable d'environnement `PITCHAPI_API_KEY`, qui est prioritaire.

Avec PowerShell, récupérer un nouveau catalogue et les derniers matchs terminés
des championnats de l'échantillon :

```powershell
./scripts/collect_pitchapi.ps1
```

Pour actualiser uniquement le catalogue :

```powershell
./scripts/collect_pitchapi.ps1 -CatalogOnly
```

Le script enregistre les réponses dans `data/` et les erreurs HTTP éventuelles
dans l'échantillon. Il n'inscrit pas la clé dans les fichiers de données.

## Lecture des données

Le catalogue contient 77 compétitions mondiales au moment du premier relevé :
il ne couvre pas toutes les ligues européennes. Les données individuelles
dépendent de la compétition et du match.

Dans les vérifications initiales, plusieurs matchs de 3. Liga allemande ont
renvoyé une liste de tirs vide et des totaux à zéro malgré des buts. Ces zéros
ne doivent pas être interprétés comme des mesures fiables. Les xG manquants ne
doivent pas être remplacés par zéro ; un but contre son camp n'a notamment pas
nécessairement de xG de tir.

## Tableau de bord local

Avec Node.js installé, lancer à la racine du dépôt :

```powershell
node dashboard/server.js
```

Ouvrir ensuite http://127.0.0.1:8765/. Le tableau de bord lit l’instantané
préparé à partir des fichiers du dépôt. Si `PITCHAPI_API_KEY` est configurée,
le serveur fournit aussi un accès à la demande aux saisons et aux détails
PitchAPI ; la clé reste côté serveur. Après une nouvelle collecte de
l’échantillon, régénérer cet instantané :

```powershell
python scripts/build_dashboard_data.py
```

Le serveur affiche aussi bien `/` que les anciennes URLs `/dashboard/`.
Les filtres, graphiques et exports sont présentés dans la
[documentation du dashboard](DASHBOARD.md).

Source : [documentation PitchAPI](https://pitchapi.dev/). Respecter les
conditions d'utilisation du fournisseur avant toute redistribution des données.

## Collecte exhaustive et reprise

`scripts/collect_pitchapi_all.py` collecte le périmètre annoncé par le catalogue,
avec Python et sa bibliothèque standard. Le relevé local contient **77
compétitions et 303 couples compétition–saison**. Ce nombre décrit le catalogue,
pas des données déjà téléchargées. Pour vérifier ce périmètre sans clé ni accès
réseau :

```powershell
python scripts/collect_pitchapi_all.py --plan
```

La commande par défaut récupère d’abord le catalogue puis **tous les index de
matchs, pour toutes les saisons disponibles**, avec `status=all` afin de conserver
les rencontres futures et leurs scores absents :

```powershell
python scripts/collect_pitchapi_all.py
```

Pour poursuivre avec toutes les données détaillées des matchs terminés et les
profils uniques des compétitions, équipes et joueurs :

```powershell
python scripts/collect_pitchapi_all.py --all
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

Le dossier de sortie par défaut est `data/pitchapi_full/`. `--output` permet de
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
python scripts/collect_pitchapi_all.py --all --refresh-indexes
python scripts/collect_pitchapi_all.py --all --retry-errors
python scripts/collect_pitchapi_all.py --all --refresh-details
```

Le débit par défaut est séquentiel, avec au moins 0,5 seconde entre requêtes.
Les réponses 429 et 5xx sont réessayées jusqu’à quatre fois ; `Retry-After` est
respecté, y compris après un redémarrage. `--interval`, `--max-retries` et
`--timeout` permettent d’adapter ces paramètres.

La clé reste dans `PITCHAPI_API_KEY` ou dans le `.env` existant. Elle n’est pas
acceptée comme argument de commande, ni écrite dans les réponses, les erreurs ou
le manifeste. Le client utilise HTTPS et refuse les redirections. Les archives
exhaustives ne sont pas incorporées automatiquement au dashboard publié.

### Données intégrales déjà présentes dans le dashboard

La génération de `dashboard/data/football.json` crée aussi
`dashboard/data/matches/<match_id>.json`. Ces neuf fichiers rendent accessibles
tous les champs bruts déjà collectés : statistiques individuelles et d’équipe,
compositions et tirs. Leur champ `availability` distingue les réponses collectées,
les routes non collectées et les erreurs. Le résumé disponible provient de
l’index des rencontres et est signalé `fixture_only` ; il ne se présente pas
comme une réponse complète d’une route qui n’a pas été appelée.

La collection exhaustive reste séparée de cet échantillon. La commande
`--plan` et les tests hors réseau ne constituent pas une collecte réelle.
