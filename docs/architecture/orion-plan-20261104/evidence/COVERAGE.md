# Couverture du plan et obligations restantes

Le JSON complet fourni est une référence de responsabilités, pas un quota de 84 tables. L’audit et la revue GPT Pro ont été lus intégralement ; l’utilisateur a explicitement donné priorité à la revue et à la conservation sélective des valeurs typées. La couverture ci-dessous décrit **des destinations proposées**, sans prétendre que la transformation des sources est déjà faite. Une destination connue ne prouve pas que chaque champ utile est couvert.

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

## Couverture du candidat et limites du pilote

| Exigence | État / preuve | Travail restant |
|---|---|---|
| Approbation | Plan Pro et pilote borné explicitement approuvés ; reçu immuable `approval.json` | Acceptation locale complète puis préflight avant RDS borné ; bascule finale conditionnelle |
| Chaîne du modèle | `028c…` approuvé → `18da…` candidat : huit chemins, quatre CHECK et quatre descriptions dans deux tables | Aucun ajout de table, colonne ou clé ; ne pas transformer la correction ciblée en refonte implicite |
| Catalogue | 103 tables / 1 791 colonnes / 450 FK ; actif : 94 / 1 709 / 431 ; 16 SVG et 13 domaines | Implantation des neuf réserves de modèles hors périmètre, aucune nouvelle formule |
| Revue documentaire courante | Nouveau parcours navigateur et inspection sur le SHA candidat ; grains, types, PK/UQ/FK/CHECK/index et descriptions complets | La navigation ne prouve pas la fidélité de toutes les sources ou les lecteurs de production |
| Régression SQL candidat | [23/23 sur PostgreSQL local jetable](../../../verification/orion-pro-pilot-20261104/runs/20261104T183222785812Z-recorded-metric-amendment-regression/result.json) | Fixtures bornées ; RDS, performance, application/cache et inventaire complet hors portée |
| États des métriques enregistrées | [25/25 sur le candidat](../../../verification/orion-pro-pilot-20261104/metric-state-runs/20261104T183139777229Z-targeted-native-metric-candidate/result.json), après RED 19/4/2 conservé | xG et autres colonnes communes : mapping vers observation native et cohérence à vérifier ; ligne absente = inconnu |
| Core issu de sources réelles | [9/9 sur la base `028c…`](../../../verification/orion-pro-pilot-20261104/real-source-runs/20261104T182830125656Z-core-shot-family-coverage/result.json) ; `fullAcceptance=false` explicite | Champs non vérifiés, unités, profils/médias et familles source supplémentaires ; pas une preuve attribuée à `18da…` |
| Dictionnaire et dispositions | 84 responsabilités initiales, 224 structures actuelles, 0 définition de secours, 51 JSONB bornés | Réconciliation champ/type/ordre/variante/contribution avant purge |
| Versions | 46 sélectives, 6 enfants atomiques, 9 append-only, 3 identités stables, 39 autres opérations/résultats | Lecture publique par build/snapshot et dépendances complètes |
| Bootstrap et gardes | Cas locaux de bindings, reprise, parents, profils, HTTP, génération, publication et baux dans le 23/23 | Workflows de production, charge, capacité et exploitation |
| Site actuel | Vercel rétabli par pont temporaire Neon, build exact ; 12 parcours réels puis 2 canoniques | AWS preview partiel ; aucun nouveau schéma accepté par le seul rétablissement du site |
| Purge | `source_inventory_complete=false`, `purge_authorized=false` | Aucune suppression avant inventaire exhaustif, rapprochement et acceptation commune |

Les [reçus du pilote](../../../verification/orion-pro-pilot-20261104/) distinguent modèles, entrées synthétiques ou réelles et périmètres de chaque run. Les anciennes preuves `028c…`, y compris 1 208 contrôles de présentation, sont [archivées séparément](historical-approved-028c-before-native-metrics/README.md). Le détail de l’amendement courant est dans [native-metric-amendment-readback.json](native-metric-amendment-readback.json).

## Limite de couverture à garder visible

Les inspections antérieures étendent les 36 fichiers de l’audit initial : 1 203 718 lignes de tirs sur 3 053 chemins, treize contrats de familles, 35 691 profils et 537 catalogues sont documentés dans les preuves existantes citées dans le plan. Cependant l’inventaire de formes des archives ne couvre que 948 de 3 053 chemins, et certains inspecteurs n’ont parcouru que le premier élément de tableaux imbriqués. Ces limites empêchent de présenter la reprise détaillée comme déjà acceptée.

Le pilote puis la normalisation doivent émettre un reçu pour **chaque enregistrement et chaque champ** : destination typée/version/état, valeur et type conservés, anomalie éventuelle. Un champ inconnu ou non représenté bloque la purge de la source historique concernée. Pour un nouvel appel PitchAPI non conservé brut, il bloque l’acceptation et peut nécessiter un nouvel appel ; aucune garantie de récupération ultérieure n’est inventée.

Les différences nettes de comptes Neon/AWS sont 7 802 objets, 5 960 ressources et 55 projections au relevé. Ce sont des signaux à rapprocher, pas la liste exacte des manques. La copie initiale physique reste sous la responsabilité du Codex du collègue.

Ce rafraîchissement documentaire n’exécute aucun SQL. Des E2E locaux bornés ont été exécutés par les lots de pilote cités ci-dessus ; ils ne valent pas acceptation complète. Les dispositions de champs réels non vérifiées, les états des projections statistiques communes, la parité publique et les mesures de concurrence/charge, WAL, capacité RDS restent ouverts. Aucun nouveau schéma appliqué sur RDS, aucune purge ni bascule finale ne sont affirmés.

Commit suggéré : `docs: refresh approved Orion pilot and native metric evidence`.
