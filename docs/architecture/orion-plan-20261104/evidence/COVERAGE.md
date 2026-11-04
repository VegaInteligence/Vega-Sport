# Couverture du plan et obligations restantes

Le socle est le JSON complet fourni, pas un modèle réinventé. Le texte GPT Pro a également été lu intégralement. La couverture ci-dessous décrit **des destinations proposées**, sans prétendre que la transformation des sources est déjà faite. Une destination connue ne prouve pas que chaque champ utile est couvert.

## Familles PitchAPI réellement inventoriées

Les 24 familles sont issues de `neon-current.json` et `databases.json`. Leurs endpoints paramétrés restent des métadonnées techniques ; les nouvelles réponses sont décodées en mémoire, puis écrites directement dans les relations typées. Toutes les familles sont dans le périmètre, y compris celles dites « enrichment ».

| Famille | Destination métier proposée |
|---|---|
| `/date/{day}` | `football.matches`, équipes de match et scores, provenance/date de collecte |
| `/leagues` | `football.competitions`, éditions et identifiants fournisseur |
| `/leagues/{id}` | Compétitions/éditions/phases/groupes, équipes et référentiels liés |
| `/leagues/{id}/matches` | Matchs de tous statuts, participants et scores |
| `/matches/{id}` | Matchs, équipes, scores, lieu et contexte d’observation |
| `/matches/{id}/advanced` | `football.team_match_advanced`, métriques secondaires et couverture |
| `/matches/{id}/advanced/network` | `football.pass_networks`, nœuds, arêtes |
| `/matches/{id}/advanced/players` | `football.player_match_advanced`, joueurs/participations, SCA typé |
| `/matches/{id}/advanced/players/{id}` | Détail avancé joueur, métriques secondaires typées |
| `/matches/{id}/events` | `football.match_events`, acteurs, période et scores à portée explicite |
| `/matches/{id}/h2h` | `football.match_h2h_entries`, lien de rencontre résolu ou état explicite |
| `/matches/{id}/heatmaps` | `football.match_heatmaps`, `football.match_heatmap_cells` |
| `/matches/{id}/lineups` | `football.match_lineups`, `football.match_players`, entraîneurs |
| `/matches/{id}/momentum` | `football.match_momentum`, ordre et repère temporel |
| `/matches/{id}/players` | Joueurs de match et statistiques par période |
| `/matches/{id}/players/halves` | Statistiques joueur avec période, sans addition total + mi-temps |
| `/matches/{id}/players/{id}` | Détail joueur et métriques secondaires |
| `/matches/{id}/players/{id}/halves` | Détail par mi-temps/période |
| `/matches/{id}/players/{id}/shots` | `football.shots`, identité/tentative/source et contexte |
| `/matches/{id}/shots` | Tirs, acteurs et coordonnées typées |
| `/matches/{id}/shots/{id}` | Détail de tir, gardien/blocage/sauvetage/profils |
| `/matches/{id}/stats` | `football.team_match_stats` et métriques secondaires |
| `/players/{id}` | Identité joueur, versions de profil, affiliations, liens médias |
| `/teams/{id}` | Identité équipe, versions de profil, affiliations, liens médias |

Les huit projections courantes (`club-wikidata`, `coach-portrait`, `nations-results`, `open-cups`, `openligadb`, `player-honours`, `stadium`, `standings`) sont affectées aux identités, équipes/entraîneurs, compétitions/matchs internationaux, palmarès, lieux et snapshots de classement. Les fichiers FIFA/UEFA et archives sont affectés aux associations, profils, systèmes/snapshots/composantes de ranking et faits de match détaillés. Les images vont à S3 et `ingest.media_assets` ; aucun JSON métier ne reste comme substitut aux faits.

## Ce qui est vérifié et ce qui ne l’est pas

| Exigence de première livraison | État / preuve | Travail après approbation |
|---|---|---|
| Lecture des deux documents complets, priorité au prompt | Fichiers exacts, `inputs-and-scope.json` | Figer la version approuvée |
| Inventaire AWS et Neon réel | Catalogues/colonnes/types, comptes, versions, configuration et états horodatés | Comparaison exhaustive des clés/versions, sans second transfert |
| Toutes tables/colonnes/PK/FK visibles | 25 SVG, dictionnaire, 161 tables/1 971 colonnes/368 FK vérifiées statiquement | Migrations/contraintes exécutées et E2E |
| Grain, sens, contraintes et index | Dictionnaire et lecteur, 0 définition de secours | Réviser les cas réels non observés au pilote |
| Changements exacts du socle | `changes.json`, `blueprint-diff.json` intégral | Accord explicite sur les adaptations, surtout 54 historiques |
| Disposition de l’existant | 224 relations dans le CSV ; destinations/suppressions conditionnelles | Reçu champ par champ avant tout retrait |
| Identifiants et liens existants | `public_aliases`, source IDs, politique BIGINT | Contrats HTTP et parcours réels desktop/mobile |
| Historique/provenance sans source permanente | Versions SQL typées, snapshots, états absent/null/vide/type natif | Prouver fidélité, cohérence intertables et recalcul défini |
| JSONB métier ciblé supprimé | Colonnes/relations typées ; 73 exceptions techniques explicites et bornées | Refus des payloads opaques dans les écrivains/permissions |
| Orion : schéma contre nouvelles formules | 9 tables réservées signalées, scoring nouveau hors périmètre | Préserver le scouting existant |
| Flux PitchAPI direct RDS, médias seuls sur S3 | Diagramme cible, CHECK du reçu HTTP et politique du plan | Écrivain direct SQL et job médias avec permissions séparées |
| Reprise, rollback, dépendances et capacité | Lots P0–P5 et conditions de sortie dans le plan | Pilote de reprise/concurrence, WAL/espace libre et arrêt propre |
| Backend/données en parallèle après schéma stable | P3A/P3B distincts ; acceptation conjointe avant bascule | Adaptation des lecteurs et rapprochement complet |
| Nettoyage complet RDS/S3 | Conditions de purge, inventaires/versions/sauvegardes et non-dépendance | Réconciliation et suppressions effectives, gains mesurés |
| Liaisons Vercel/CloudFront/Lambda/RDS | Relevés de routing/env/CORS/TTL/réseau ; état actuel et cible séparés | Parcours depuis le site public et propagation d’une mise à jour |
| Mesures par lot et publication main | Baselines enregistrées ; aucun gain inventé | Latence/SQL/réseau/cache/stockage/coût comparables |

## Limite de couverture à garder visible

Les inspections antérieures étendent les 36 fichiers de l’audit initial : 1 203 718 lignes de tirs sur 3 053 chemins, treize contrats de familles, 35 691 profils et 537 catalogues sont documentés dans les preuves existantes citées dans le plan. Cependant l’inventaire de formes des archives ne couvre que 948 de 3 053 chemins, et certains inspecteurs n’ont parcouru que le premier élément de tableaux imbriqués. Ces limites empêchent de présenter la reprise détaillée comme déjà acceptée.

Le pilote puis la normalisation doivent émettre un reçu pour **chaque enregistrement et chaque champ** : destination typée/version/état, valeur et type conservés, anomalie éventuelle. Un champ inconnu ou non représenté bloque la purge de la source historique concernée. Pour un nouvel appel PitchAPI non conservé brut, il bloque l’acceptation et peut nécessiter un nouvel appel ; aucune garantie de récupération ultérieure n’est inventée.

Les différences nettes de comptes Neon/AWS sont 7 802 objets, 5 960 ressources et 55 projections au relevé. Ce sont des signaux à rapprocher, pas la liste exacte des manques. La copie initiale physique reste sous la responsabilité du Codex du collègue.

Commit suggéré : `docs: propose the Orion relational schema and AWS migration plan`.
