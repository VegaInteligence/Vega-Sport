# Football Ranking

Football Ranking est un projet de recherche consacré à la création d’un classement personnel du Ballon d’Or à partir des performances individuelles, match par match.

L’approche vise à comparer attaquants, milieux, défenseurs et gardiens en tenant compte de leur rôle, de leur temps de jeu et du niveau des équipes rencontrées.

## Approche

La méthode proposée évalue les performances par rapport à une référence adaptée à chaque rôle. Elle combine finition, création, progression, défense et conservation du ballon, avec une évaluation spécifique aux gardiens.

Les contributions sont ensuite agrégées sur la saison pour associer volume et niveau moyen de performance. Le classement cherche ainsi à mesurer l’excellence relative dans chaque rôle.

Les formules, pondérations et limites sont détaillées dans la [documentation mathématique](docs/METHODE_CLASSEMENT_BALLON_D_OR.md).

## Explorer les données

Le [dashboard Orion](docs/DASHBOARD.md) propose une interface sombre pour parcourir les compétitions et les clubs, comparer les joueurs et explorer les données complètes des matchs. La connexion à PitchAPI ouvre les saisons et les analyses à la demande. Les notes affichées proviennent de PitchAPI ; le classement Orion reste à calibrer et à valider.

## Licence

[MIT](LICENSE). Les données de fournisseurs tiers restent soumises à leurs propres conditions d’utilisation.
