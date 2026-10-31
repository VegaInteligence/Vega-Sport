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

Source : [documentation PitchAPI](https://pitchapi.dev/). Respecter les
conditions d'utilisation du fournisseur avant toute redistribution des données.
