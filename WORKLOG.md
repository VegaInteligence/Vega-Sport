# Worklog

- Objectif corrigé : construire une base de données JSON par saison et entité dans `data/raw/`, reliée directement au backend/frontend du dashboard ; réserver `data/computed/` aux futurs résultats.
- Conserver toutes les observations et leur provenance. Les archives d’origine sont des entrées d’import dans `data/sources/`, jamais le modèle de lecture du dashboard. Intermédiaires locaux dans `data/staging/` ignoré par Git.
- Tables principales : compétitions, équipes, versions d’identité des joueurs, calendriers, matchs, performances joueur-match, tirs et statistiques d’équipe. `playerRef` conserve les différences de nom/image sans fusion approximative.
- Import complet des treize familles détaillées et profils versionnés depuis les archives, avec index par match et profil. Complément Open Matchday distinct pour éviter les identités inventées et doubles comptes.
- `scripts/build_json_database.py` génère les tables, vérifie la reconstitution exacte des anciennes partitions et conserve les sources originales.
- Dashboard : chargeur avec jointures des tables JSON ; backend Node vers `data/raw/`, index des matchs/profils et futur `computed/`. Worker/build embarque les tables publiques de base et le complément, pas toutes les archives détaillées.
- État : import terminé. Six saisons / 189 partitions reconstituées sans différence ; 1 035 949 performances, 714 967 tirs, 53 686 entrées de calendrier, 34 880 observations détaillées de matchs/calendriers et 40 087 observations de profils conservées. Open Matchday : 16 229 lignes de résultats/calendriers/buts séparées.
- Validation : 28 contrôles Python et 56 Node réussis ; build 1719 assets réussi ; toutes les partitions jointes et leurs références joueurs/équipes/matchs contrôlées, 3 871 fichiers sources inchangés, exemples de réponses détaillées/profil reconstruits exactement par HTTP. Navigateur réel : 2026/2027 puis 2025/2026 et ouverture d’un match, sans erreur console. Preuves et capture dans `outputs/json-database/`.
- Neon supprimé à la demande de l’utilisateur ; aucun nouveau service DB. Aucun score Orion calculé.
- Livraison Git autorisée : commit et push de l’ensemble sur `main` ; aucun déploiement du site demandé.
- Validation terminée ; livraison de la base JSON et des classements sur GitHub. Le site hébergé reste à sa version précédente.
- Commit suggéré : `feat: add season-based JSON database and dashboard data access`.

## 1 novembre 2026 — Classements FIFA et UEFA

- Objectif : collecter les classements à partir de 2022, enrichir les fiches clubs et ajouter une page pour sélections/associations.
- Sources : SportsAPI (clé uniquement dans `.env`, instantanés actuels), FIFA officiel (32 éditions datées) et UEFA officiel (clubs + associations, années de fin de saison 2022–2027). 47 tableaux au total, sans erreur finale.
- Stockage : `data/raw/rankings/` pour les tables et liens de clubs ; réponses originales dans `data/sources/rankings/`. UEFA associations = performances des clubs par pays, pas force des sélections.
- Identités : 242 clubs reliés par nom/alias explicite et pays ; 588 non reliés, zéro ambiguïté retenue. Les éditions officielles UEFA alimentent les fiches clubs.
- Qualité : rangs FIFA non attribués conservés à null ; doublon SportsAPI conservé et signalé dans les métadonnées ; coefficient UEFA affiché = totalValue (minimum association inclus). Ne pas assimiler la mise à jour source à une date connue avant match.
- Interface : page Classements avec type/édition/recherche et historique sur les fiches clubs. Dates, fournisseur et périodes restent distincts.
- Validation : réconciliation exhaustive des 47 éditions avec les réponses sources et empreintes ; aucun secret dans frontend/tables/build ; 28 contrôles Python et 56 Node réussis ; build de 1 769 assets réussi. E2E navigateur réussi : FIFA 2022 avec recherche France, associations UEFA 2022, historique Bayern sur six saisons et absence de correspondance Fulham ; aucune erreur console. Captures et protocole dans `outputs/rankings/browser-evidence.json`.
- Documentation : `docs/RANKINGS.md`. Commit et push de l’ensemble autorisés ; pas de déploiement du site.
- Commit suggéré : `feat: add historical FIFA and UEFA rankings`.
