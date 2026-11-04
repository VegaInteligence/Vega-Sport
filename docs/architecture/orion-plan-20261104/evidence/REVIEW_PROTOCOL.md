# Protocole de vérification de la première livraison

Enregistré avant construction du lecteur visuel. Cette livraison contient uniquement des propositions et des preuves en lecture seule. Elle n’applique pas de migration, n’écrit aucune donnée distante et ne réactive aucun workflow.

## Entrées et setup

- Documents utilisateur complets et inchangés dans `inputs/`, avec empreintes SHA-256.
- Catalogue cible proposé généré depuis le JSON de référence ; aucune table du socle écartée silencieusement.
- Relevés AWS/RDS et Neon horodatés, code `main`, inventaires précédents explicitement identifiés comme historiques.
- Rendu SVG local Graphviz via `@viz-js/viz@3.31.0` ; lecteur autonome sans bibliothèque ni requête extérieure.
- Navigation et contrôles observés dans un navigateur via le CLI Playwright existant. Sorties navigateur sous `output/playwright/` et reçus durables dans ce dossier.

## Résultats attendus

1. Les deux fichiers d’entrée correspondent exactement aux originaux ; JSON intégral parsé, 84 tables / 943 colonnes retrouvées dans le socle.
2. Toutes les tables proposées ont un rôle, grain, colonnes/types, PK et liste de FK ; chaque table figure intégralement sur au moins un diagramme de domaine, y compris les historiques et réserves de modèles clairement marqués.
3. Chaque FK désigne une table, des colonnes de même type et une clé unique existantes dans le plan. Les noms SQL n’excèdent pas les limites PostgreSQL. Les CHECK ne référencent pas une colonne supprimée.
4. La correspondance actuelle→cible couvre toutes les tables des deux bases AWS inspectées et toutes les familles d’API/projections observées. Les destinations non prouvées ou champs inconnus sont visibles et bloquent le futur nettoyage.
5. Le lecteur permet : vue architecture ; sélection d’un domaine ; consultation d’une table et de toutes ses colonnes ; navigation d’une FK à sa cible ; recherche ; consultation des différences et exceptions JSONB.
6. La vue fonctionne sur desktop et mobile, sans erreur JavaScript, débordement global ou appel à AWS/Neon/PitchAPI. Les diagrammes conservent un défilement/zoom local.
7. La documentation distingue vérification statique, migrations non exécutées, règles intertables non implémentées et tests applicatifs futurs. Les anciens `passed` du JSON ne deviennent pas des preuves de déploiement.
8. L’approbation utilisateur reste requise ; une navigation ou un bouton du lecteur ne vaut pas autorisation de réorganisation.

## Échecs à conserver

Tout rendu incomplet, FK incohérente, colonne oubliée, différence non déclarée, erreur navigateur ou donnée non vérifiée est consigné avec son résultat initial et la correction. Un statut global « prêt à valider » exige le plan et ses preuves complets ; il ne signifie pas que la migration est effectuée.

Les commandes exactes de génération, les résultats réels, les logs et captures seront enregistrés dans `RESULTS.md` à la fin du parcours.

## Clarification utilisateur appliquée avant validation finale

Les nouvelles données PitchAPI vont directement dans les tables RDS après décodage en mémoire ; aucun fichier/document brut n’est créé dans S3 ou SQL. Les diagrammes doivent montrer une collecte médias séparée et aucune arête du job de données vers S3. Les seules sources temporaires sont les fichiers historiques déjà présents. Cette propriété du plan sera contrôlée en plus des références et de la navigation.
