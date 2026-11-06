# Fermeture de Neon — préparation uniquement

6 novembre 2026. **Aucun transfert, rejeu, rattrapage historique, redimensionnement RDS ou arrêt de Neon n'est lancé par ce lot.** La suppression du projet source attend une autorisation distincte. Le site fonctionne sur AWS ; la conservation de sa source historique est une autre question.

## Périmètre identifié

- Dépôt : `VegaInteligence/Vega`, ID stable 1441213700.
- Source : projet Neon `sweet-queen-11955006`, branche `br-mute-bonus-be23014e` / `production`, base `neondb`.
- Observation source en lecture seule à 17:52 UTC : 740 499 456 octets pour neondb ; 12 tables statarena et 9 tables neon_auth. Ce volume SQL ne comprend pas le stockage objet. Les estimations de lignes ne prouvent ni complétude ni vacuité.
- Cible : instance RDS existante `statarena-postgres`, Ohio/us-east-2, base `statarena_prod`. Ne pas restaurer un dump par-dessus cette base active.
- Bucket AWS connu : `statarena-football-333rosky-70db6e5f`. Les fichiers sources et les médias nécessitent un inventaire séparé des lignes PostgreSQL.
- La réconciliation précédente des 7 846 objets modifiés est déclarée terminée dans la PR 24. Sa capture privée est fixée dans `dashboard/scripts/reconcile_aws_staging.py`. Ne pas la rejouer aveuglément. Des éditions non publiées dans AWS ne prouvent pas que les octets source manquent encore.

## Procédure à exécuter seulement après accord

1. **Fixer le point de coupure.** Identifier tous les écrivains Neon, les mettre en pause au moment convenu, relever leur dernière écriture. Coordonner l'écrivain AWS existant ; conserver les nouveaux résultats qu'il a collectés. Inventorier aussi les autres bases/branches et le stockage objet avant de les exclure. Vérifier un snapshot RDS chiffré, son état disponible, la procédure de restauration et l'espace libre/WAL. Ne pas changer de classe RDS sans accord.
2. **Capturer une vue source cohérente.** Transaction PostgreSQL en lecture seule et snapshot cohérent pour toutes les tables. Si les écritures ne peuvent pas être gelées, snapshot coordonné plus delta final avec coupure mesurable. Les objets nécessitent leur propre manifeste immuable/hash ; un snapshot SQL ne fige pas un bucket.
3. **Comparer avant de copier.** Par clé métier ET contenu/version : manquant, identique, source plus récente, cible plus récente, conflit. Comparer fixtures, resources, objects, shards, observations, projections, assets et state. Examiner aussi ingest_failures et les travaux utiles de jobs/asset_jobs/dirty_partitions. Traduire les baux expirés et l'état opérationnel ; ne pas réimporter aveuglément des tâches exécutées.
4. **Préparer un delta révisable.** Manifeste signé par SHA-256, identités source/cible fixes, compteurs et liste des conflits. Réutiliser le writer et son verrou existants. Transactions et lots bornés, journal de reprise, reprise uniquement du non-commité. INSERT des manquants ; UPDATE seulement après contrôle de priorité et de fraîcheur. Aucun DROP, TRUNCATE, CASCADE, nouvelle base parallèle ou pg_restore global. Ne jamais écraser une observation AWS plus récente.
5. **Vérifier le stockage objet.** Existence, longueur et SHA-256 des octets réellement présents côté AWS ; ne pas assimiler un ETag multipart à un hash de contenu. Inclure les binaires SQL inline, images et références. Ne supprimer aucune archive/source avant réconciliation et décision de rétention.
6. **Publier les données déjà présentes.** Exécuter ensuite le publisher relationnel sur AWS. C'est une opération distincte du transfert source. Vérifier l'ensemble attendu des éditions, pas seulement un total (baseline antérieure : 230 couples compétition/saison, six libellés de saison). Couvrir profils, compositions, événements, tirs, statistiques avancées/mi-temps, classements et archives.
7. **Recette avant fermeture.** Comparaison des identifiants et valeurs sur les périmètres acceptés ; navigateur et runtime sans dépendance Neon ; un cycle quotidien réel réussi ; correction visible dans les caches ; échec fournisseur préservant la dernière donnée valide. Un HTTP 200 de health ne suffit pas.
8. **Arrêt puis suppression différée.** Seulement après approbation : retirer les derniers accès de migration, arrêter le compute source et vérifier l'absence de dépendance. La suppression irréversible du projet et du bucket nécessite une sauvegarde restaurable testée et une décision explicite de rétention. Ne pas confondre tables neon_auth copiées et remplacement du service d'authentification géré.

## Sécurité et livrables d'exécution

Les comptes, sessions, clés d'authentification et lignes métier ne vont jamais dans les logs publics, le dépôt ou l'explorateur de schéma. Les identifiants de migration restent hors Vercel. L'explorateur ne contient que des métadonnées PostgreSQL.

Conserver un rapport privé unique : identités, coupure, versions de schéma, différences clés/hashes, objets vérifiés, conflits, checkpoints, publications, rejets, retour arrière et contrôle d'arrêt. Aucune valeur manquante ne devient artificiellement zéro. Les différences non expliquées bloquent la fermeture ; les exceptions nécessitent acceptation.

## Workflows utiles conservés

| Fichier | Rôle |
|---|---|
| collect-football.yml | Collecte quotidienne et refresh matin ; historique uniquement manuel |
| uefa-standings.yml | Collecte spécialisée des classements |
| rematerialize.yml | Reconstruction manuelle depuis AWS, pas un transfert Neon |
| verify-ingestion.yml | Tests isolés sans identifiants cloud |
| production-validation.yml | Contrôle HTTP public ; aucun accès SQL et aucune mutation des workflows |
| database-schema.yml | Inventaire SQL en lecture seule, manuel ou lors d'une modification de l'extracteur |

Le contrôle Villarreal–PSG et l'auto-activation/dispatch depuis la validation du site sont retirés. L'historique des anciens runs est conservé comme preuve ; il ne constitue pas un workflow exécutable. Aucun workflow de transfert n'est programmé.
