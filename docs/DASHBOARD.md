# Dashboard Orion

Le dashboard présente le projet dans une interface noire, avec les logos des clubs et les portraits fournis par PitchAPI. Ses six vues permettent d’explorer les performances, les compétitions, les clubs, les joueurs, les matchs et la méthode du futur classement.

![Vue d’ensemble du dashboard Orion](assets/orion-dashboard-dark-20261031.jpg)

## Utilisation

- Filtrer par compétition, saison, joueur ou club, et temps de jeu.
- Trier les apparitions par note fournisseur, buts, passes décisives, xG, xA, création ou défense.
- Passer des volumes du match aux volumes par 90 minutes ; la note fournisseur et les minutes restent inchangées.
- Sélectionner jusqu’à trois apparitions pour les comparer.
- Ouvrir un joueur depuis le tableau ou les graphiques ; ouvrir un match pour consulter les statistiques d’équipe, les tirs et le cumul des xG.
- Consulter les arrêts et buts évités du fournisseur dans les fiches, la comparaison et les exports ; rechercher une compétition ou un pays dans le catalogue.
- Exporter les apparitions filtrées dans un CSV UTF-8. Les données manquantes restent vides.
- Parcourir les 77 compétitions et 303 couples compétition–saison du catalogue initial ; ouvrir une saison ou un calendrier par date.
- Ouvrir une fiche club avec ses rencontres et joueurs référencés.
- Explorer 13 familles de données par match : compositions, statistiques des équipes et joueurs, mi-temps, tirs, événements, momentum, analyses avancées, réseaux de passes, cartes d’activité, confrontations et résumé.
- Consulter tous les champs du fournisseur et télécharger chaque réponse en JSON. Les neuf matchs déjà collectés incluent leurs compositions et statistiques brutes complètes.

Les filtres principaux et la page active sont conservés dans l’URL. Le raccourci `/` place le curseur dans la recherche. Les cartes de joueur et la comparaison utilisent une boîte de dialogue native, fermable avec Échap.

## Développement

Le frontend est en HTML, CSS et JavaScript natifs, sans dépendance à installer. Il nécessite un serveur HTTP ; ouvrir directement `index.html` avec `file://` ne permet pas le chargement fiable du fichier JSON.

La commande locale du dashboard initial reste disponible, avec Node.js :

```bash
node dashboard/server.js
```

Ouvrir `http://127.0.0.1:8765/`. `npm run serve` est un raccourci équivalent. L’instantané préparé est inclus dans le dépôt ; aucune installation Python n’est nécessaire pour simplement le consulter avec ce serveur.

Depuis la racine du dépôt :

```bash
python scripts/build_dashboard_data.py
python -m http.server 3000 --directory dashboard
```

Cette alternative utilise Python 3 et sert le dashboard à `http://localhost:3000`. Elle permet de consulter l’instantané ; utiliser le serveur Node pour les routes API.

## Vérification et construction

```bash
python -m unittest discover -s tests -v
node --test tests/*.test.mjs
python scripts/build_dashboard.py
```

Les raccourcis `npm test` et `npm run build` sont également disponibles. La construction régénère l’instantané compact et les neuf fichiers détaillés, copie les fichiers publics dans `dist/`, puis produit le Worker autonome `dist/server/index.js`. Seuls les assets explicitement autorisés sont embarqués. Aucune clé API ni configuration privée locale n’est incluse.

## Connexion PitchAPI et actualisation

La connexion utilise la variable serveur `PITCHAPI_API_KEY`. En local, elle est lue dans le processus ou le fichier `.env` ignoré par Git. Sur le site hébergé, elle doit être enregistrée comme secret de l’environnement Sites, puis appliquée par un déploiement. Le navigateur ne reçoit jamais la clé.

`GET /api/status` indique si une clé est configurée. Les ressources sont disponibles via `/api/pitchapi/…`, avec une liste fermée des 24 formes de routes documentées et des paramètres acceptés. Le serveur conserve les réponses dans un cache court, déduplique les requêtes et transmet les erreurs de disponibilité sans les transformer en zéros.

Sans clé, l’interface reste utilisable avec les neuf matchs de l’instantané et indique les rubriques non collectées. Une fois la clé activée, les saisons et détails sont chargés à la demande. Cela ne signifie pas qu’un historique complet est déjà importé ni qu’un classement de saison a été calculé.

Pour reconstruire l’instantané du projet :

1. Mettre à jour les fichiers bruts avec le script de collecte existant.
2. Relancer la préparation des données et les tests.
3. Reconstruire et republier le dashboard.

Pour archiver tout le périmètre disponible, `python scripts/collect_pitchapi_all.py --all` collecte les index de toutes les saisons avant les détails des matchs terminés et les profils, avec points de reprise. `--plan` décrit ce périmètre sans clé ni réseau. La [documentation PitchAPI](PITCHAPI.md) précise les options et la structure des archives. Ces archives volumineuses ne sont pas embarquées dans le site ; l’explorateur utilise les mêmes ressources à la demande.

## Contrats de lecture

Le [contrat de données](DASHBOARD_DATA.md) documente les agrégats, les champs et les valeurs manquantes. Les principes visibles dans l’interface sont les suivants :

- Une ligne représente une apparition. Le banc est exclu par défaut.
- Les notes sur 10 sont celles de PitchAPI ; aucun score Orion n’est calculé.
- Les xG/xA absents ne deviennent pas zéro. Les valeurs suspectes de 3. Liga sont masquées.
- Les vues de réponses brutes conservent les valeurs originales de 3. Liga avec un avertissement explicite ; elles ne sont pas des mesures validées.
- La carte conserve les coordonnées du fournisseur et n’inverse pas arbitrairement les équipes.
- Le fil des xG cumule les valeurs de tir connues. Les buts contre son camp et événements sans mesure exploitable sont distingués.
- Les statistiques d’équipe utilisent la période `All` ; les blocs de statistiques joueur sont dédupliqués par clé.
- La méthode de classement reste à calibrer et à valider sur un historique adapté.

## Organisation

| Fichier | Rôle |
| --- | --- |
| `dashboard/index.html` | Structure accessible et navigation |
| `dashboard/styles.css` | Système visuel, adaptation mobile et états interactifs |
| `dashboard/app.js` | Vues, événements, filtres, comparaison et exports |
| `dashboard/explorer.js` | Compétitions, clubs, vues détaillées et chargement progressif |
| `dashboard/model.js` | Fonctions pures de filtrage, tri et formatage |
| `dashboard/charts.js` | Graphiques SVG sans dépendance |
| `dashboard/data/football.json` | Instantané compact reproductible |
| `dashboard/data/matches/` | Réponses complètes déjà collectées, une par match |
| `worker/pitchapi.js` | Connexion sécurisée aux ressources du fournisseur |
| `worker/index.js` | Routage du site et assets publics autorisés |
| `scripts/build_dashboard_data.py` | Normalisation des fichiers bruts |
| `scripts/build_dashboard.py` | Préparation des assets et du Worker |
| `scripts/collect_pitchapi_all.py` | Collecte exhaustive, progressive et reprenable |

Les fichiers de données tiers restent soumis aux conditions de leur fournisseur, comme indiqué dans la documentation principale.
