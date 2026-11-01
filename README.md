# Football Ranking

Football Ranking est un projet de recherche consacré à la création d’un classement personnel du Ballon d’Or à partir des performances individuelles, match par match.

L’approche vise à comparer attaquants, milieux, défenseurs et gardiens en tenant compte de leur rôle, de leur temps de jeu et du niveau des équipes rencontrées.

## Approche

La méthode proposée évalue les performances par rapport à une référence adaptée à chaque rôle. Elle combine finition, création, progression, défense et conservation du ballon, avec une évaluation spécifique aux gardiens.

Les contributions sont ensuite agrégées sur la saison pour associer volume et niveau moyen de performance. Le classement cherche ainsi à mesurer l’excellence relative dans chaque rôle.

Les formules, pondérations et limites sont détaillées dans la [documentation mathématique](docs/METHODE_CLASSEMENT_BALLON_D_OR.md).

## Explorer les données

Le stockage est une [base JSON](docs/JSON_DATABASE.md) dans `data/raw/`, organisée par saison et par entité : joueurs, équipes, matchs, performances et tirs. Le dashboard lit ces tables ; `data/computed/` est réservé aux futurs résultats des modèles.

Le [dashboard Orion](docs/DASHBOARD.md) propose une interface sombre pour parcourir les compétitions et les clubs, comparer les joueurs et explorer les données complètes des matchs. La connexion à PitchAPI ouvre les saisons et les analyses à la demande. Les notes affichées proviennent de PitchAPI ; le classement Orion reste à calibrer et à valider.

L'archive locale couvre les compétitions européennes PitchAPI disponibles de
2021/22 à 2026/27, ainsi que les saisons civiles 2021 à 2026. Des résultats et calendriers complémentaires
proviennent d'[open-matchday](https://github.com/oladeeayo/open-matchday), sous
conditions d'usage non commercial et avec attribution. Les deux sources peuvent
contenir les mêmes matchs et restent séparées.

```sh
cd dashboard
bun install
bun run build
bun start
```

Ouvrir http://127.0.0.1:3000/. Le site utilise Next.js App Router pour les pages et la navigation ; le backend de données utilise Bun. La [structure de l’application](docs/ARCHITECTURE.md) décrit les dossiers et les commandes de développement.

Les clés facultatives se configurent dans `dashboard/.env`, à partir de `dashboard/.env.example`. Les données locales restent consultables sans clé.

## Licence

[MIT](LICENSE). Les données de fournisseurs tiers restent soumises à leurs propres conditions d’utilisation.
