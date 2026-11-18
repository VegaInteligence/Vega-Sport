# Guide des preuves

Les fichiers CSV utilisent la virgule comme séparateur, l’UTF-8 et une ligne d’en-tête. Le champ vide signifie que la mesure est inconnue ou sans objet pour cette ligne. La valeur numérique zéro correspond à une mesure ou à une exclusion établie par la requête.

| Question | Fichiers du paquet de preuves |
| --- | --- |
| Quelle version répondait en production ? | `production-release.json`, `ci-release.json`, `vercel.json`, `db/model_verified/release-schema.json` |
| Quels critères du document et des tickets sont satisfaits ? | `original/MATRIX.md`, `original/CLOSED_ISSUES.md`, `original/run/manifest.json`, `linear-current.json` |
| Combien de joueurs ou de côtés de matchs étaient couverts ? | `scores/coverage-by-edition-and-entity.csv`, `scores/coverage-by-season-and-entity.csv`, `scores/grid-validation.json`, puis `final-scores/scores/coverage-by-edition-and-entity.csv` et `final-scores/scores/grid-validation.json` pour le relevé de 21 h UTC |
| Comment les nombres ont-ils été établis ? | `scores/score-and-icons.md`, `scores/score-query-snapshots.csv`, `scores/*.sql`, `db/team_exact/team-exact.json`, `team_probe.py` |
| Quelles sont les entrées et les priorités des fournisseurs ? | `sources/source-matrix.md`, `sources/configured-scopes.csv`, `sources/competition-source-editions.csv`, `sources/precedence-mappings.csv` |
| Quels matchs et quelles identités posent problème ? | `sources/integrity-findings.md`, `sources/sql/`, `sources/upstream/`, `db/integrity_verified/`, `db/verification_verified/` |
| Quelle est l’incidence des duels impossibles ? | `db/calculation_verified/primitive-*.sql` et les résultats JSON correspondants |
| Quelles images sont réelles, accessibles et récupérables ? | `scores/authentic-artwork.md`, `scores/authentic-artwork-inventory.csv`, `scores/backend-ready-artwork.json`, `scores/s3-object-verification.json`, `artwork-complete/release.json`, `root-checks/artwork-complete/receipt.json`. Les fichiers image sont dans le ZIP séparé. |
| Où sont la validation xG et les tests en navigateur ? | `xg/input.json`, `xg/report.json`, `xg/run.json`, `browser/evidence.json`, `browser/*.png` |
| Qu’ont vérifié les relecteurs ? | `reviews/`, avec les rapports et les configurations observées des sessions |

Chaque fichier des archives d’audit peut être contrôlé par rapport à `SHA256SUMS.txt`. Chaque logo téléchargé est identifié par son empreinte dans le manifeste livré avec les images. Pour contrôler à nouveau la grille à partir des résultats figés, exécuter `python3 scores/build-score-grid.py`, puis `python3 grid_validation.py` à la racine des preuves.

Les scripts qui relisent RDS ont besoin de l’accès AWS autorisé au VPC du projet. Chaque lot utilise une tâche diagnostique temporaire. Le connecteur SQL impose des transactions en lecture seule et des limites de durée. Le rejeu local des tests d’écriture utilise des bases jetables PostgreSQL 18.

Les contrôles complémentaires des chronologies, des identités d’Incheon et des participations doublées figurent dans `db/chronology_homonyms_verified`, `db/gamefacts_verified`, `db/incheon_lineage_verified` et `sources/incheon/league-rosters.json`. La vérification officielle, match par match, au Kazakhstan, en Pologne et en Ukraine est dans `continental-club-art/production-fixture-report.md`. La comparaison chronologique des probabilités est dans `forecast/README.md`.

Pour vérifier puis reconstituer un paquet d’images au format du programme d’import, utiliser `python3 verify_artwork_pack.py <ZIP> --manifest-sha256 <empreinte> --output <répertoire>`. La commande vérifie chaque fichier et la clé typée de chaque association. Les quinze visuels exclusivement historiques ont leur propre manifeste par édition. Ils sont fournis séparément.

La seconde mesure est reproductible à partir des fichiers figés avec `cd final-scores && python3 scores/build-score-grid.py && python3 verify_grid.py`. Pour obtenir un nouveau relevé avec l’accès AWS du projet, exécuter à la racine des preuves `python3 recheck_scores.py /chemin/vers/un-nouveau-releve`. Chaque nouvelle collecte enregistre son heure et sa définition de tâche. Les comparaisons comptant les participations et les indices dans des requêtes distinctes gardent leurs horaires propres.

Les comparaisons au niveau des millésimes et des éditions se reproduisent avec `python3 delivery/score-pipeline-evidence.py`. Le fichier `delivery/score-pipeline-worker.tsv` contient le résultat horodaté du worker. Pour les logos, `root-checks/role-ui/README.md` explique la réplique locale et distingue les parcours corrects et les régressions observées.

Les calendriers UEFA et DFB match par match, les tirages des scores de prolongation et le contrôle des doublons allemands figurent dans `tracks/2-ingestion/continental-calendar/README.md`. Le registre des sept clubs coréens comparé à l’organisateur est dans `tracks/3-identities/k-league/review.md`. Le rejeu numérique des 163 842 côtés de l’Elo est documenté dans `tracks/6-teams/README.md`.


La collecte annuelle et la comparaison du top 100 sont dans `tracks/5-players/top100`. Les quatre sorties du vérificateur ont été reproduites à l’identique. Le relevé numérique complet de l’Elo et le contrôle des six directions se trouvent sous `tracks/6-teams`, notamment `snapshot/inputs.json.zlib` et `gradient/`. Le trajet du classement officiel jusqu’au lecteur HTTP est dans `tracks/2-ingestion/sportscore-red`. Les huit lectures observées d’un même fichier, leur fournisseur et leur volume figurent dans `tracks/2-ingestion/shared-download`. Les mesures compactes sont réunies dans les [contrôles de calcul et d’ingestion](CONTROLES.md).

Les [91 entrées du registre](registres/requirements.csv) couvrent les sous-points du document initial, la demande du 17 novembre, les tickets clos et les constats de traçabilité. Les [26 changements de calcul](registres/new-calculations.csv) citent leur commit et le fichier qui produit ou lit le résultat. Les [instructions de reproduction](registres/requirements-README.md) explicitent le périmètre et la date de chaque état.

Le fichier `visuels-manifeste.json.gz` décrit les 1 571 associations proposées, leur source, leur clé et leurs empreintes. Le contrôle direct et le contrôle incrémental sur deux copies de PostgreSQL ont conservé les 1 611 pointeurs présents avant import. [Vérification des deux chemins](controles/visuels-actuels-rejeu.json)

Le contrôle de la Coupe du monde utilise les 1 068 feuilles FIFA figées, les 23 calendriers et des exportations RDS triangulées. Les 168 rencontres des deux éditions natives sont rapprochées par côté, maillot et preuve nominale. Les fichiers se trouvent sous `tracks/2-ingestion/world-cup-calendar` et `tracks/5-players/modern-world-cups`. Les cas saoudiens, argentins, français et turcs ont leurs pièces originales, requêtes et rejoueurs dans les sous-dossiers `adjudications` et `provider-observation` des volets 2, 3 et 5. [Constats et pièces compactes](RENCONTRES.md)

## Rejeu du relevé de nuit

La [publication transactionnelle](notes-transaction/README.md) contient les SQL et leurs résultats, un tableau par édition, un tableau par saison et le détail des causes par édition. Le [mode de reproduction](notes-transaction/rejeu.md) indique comment vérifier les empreintes et régénérer les tables hors réseau.
