# Régénérer les vues du dashboard

Le normaliseur conserve les champs enrichis des tirs, les statistiques et tentatives des joueurs, le brassard, ainsi que les métadonnées du match et de la composition. Le matérialiseur fusionne les détails enregistrés du match avec le calendrier avant normalisation. Les saisons déjà publiées doivent être reconstruites pour recevoir ces champs.

Le workflow manuel [Rematerialize Dashboard](https://github.com/OrionQuantPlatform/STATARENA/actions/workflows/rematerialize.yml) exécute `dashboard/scripts/neon_materialize.py`. Il relit les réponses présentes dans Neon, sans collecte auprès de la source. Les champs absents des réponses enregistrées restent indisponibles.

1. Dans GitHub Actions, ouvrir **Rematerialize Dashboard → Run workflow** sur `main`.
2. Pour la première exécution, cocher **Requeue every published season (first run only)**. Conserver les valeurs proposées : 100 minutes et 10 partitions par transaction.
3. Lire la dernière ligne du journal et l’artefact `rematerialize-…`. Si `remaining` est supérieur à zéro, relancer **sans cocher** la case.
4. Terminer lorsque le journal affiche `{"remaining":0}`. Conserver les numéros des exécutions comme preuve de la régénération.

Cocher la case à chaque reprise remettrait toutes les partitions en attente. Une interruption conserve les partitions non terminées. Le workflow partage la file `statarena-neon-ingestion` et le verrou PostgreSQL `97813003` avec la synchronisation : si le verrou est occupé, aucune partition n’est mise en attente et il faut relancer plus tard.

Les secrets d’ingestion sont les mêmes que pour Daily Sync : `NEON_INGEST_DATABASE_URL`, `NEON_STORAGE_ENDPOINT`, `NEON_INGEST_STORAGE_ACCESS_KEY_ID`, `NEON_INGEST_STORAGE_SECRET_ACCESS_KEY`. Le workflow utilise le bucket `statarena-data` et n’a besoin ni de clé de collecte ni de permission d’écriture GitHub.

Après publication, l’accueil compare son manifeste à partir de minuit à Paris, puis toutes les 30 minutes, et se recharge si les données ont changé. Une modification détectée en arrière-plan est appliquée au retour sur l’onglet. Un rechargement manuel permet de voir les nouvelles données immédiatement.

**Opération du 3 novembre 2026 :** les runs `41711363014` et `41721830156` ont été annulés pour corriger la lecture des réponses archivées, puis les lectures répétées des fichiers d'archive. Les corrections sont poussées dans `6b710d610e` et `58acaf1428`. Le [run de reprise](https://github.com/OrionQuantPlatform/STATARENA/actions/runs/41723613754), avec `queue_all=false`, 100 minutes et des lots de 10, a échoué à 22:59 UTC : Neon a fermé sa connexion. Le dernier compteur SQL réussi indiquait **100 partitions restantes** ; ce compteur n'est pas un reçu final.

**Blocage confirmé à 23:09 UTC (4 novembre, 00:09 à Paris) :** même une lecture SQL est refusée avec HTTP 402, quota Neon dépassé. Les endpoints publics de santé et de manifeste répondent 503. Le projet est en offre Free et indique 5 964 464 180 octets transférés ; le transfert public est la cause probable, sans être nommé par l'erreur générique. [Neon documente une allocation de 5 Go par projet et par mois, avec suspension après dépassement sur Free](https://neon.com/docs/introduction/plans#public-network-transfer).

Ne pas relancer en boucle pendant cette indisponibilité. Restaurer d'abord la disponibilité/le quota dans Neon ; aucun abonnement payant n'a été activé par l'agent. Ensuite, relire la file, vérifier qu'aucun run n'est actif/en attente et reprendre uniquement avec `queue_all=false`. Les transactions déjà validées restent publiées ; le lot interrompu doit être repris. Les journaux, le reçu d'incident et la commande de contrôle public sont dans [le dossier de vérification](verification/rematerialization-completion-20261103/quota-incident/README.md). La surveillance reste active et attend le retour de disponibilité.

La régénération complète, `remaining: 0`, la file SQL vide et la vérification finale du site ne sont **pas encore attestés**. Le contrôle public antérieur limité à Ligue 1 a réussi ; il ne remplace pas les six saisons et le parcours complet à exécuter après reprise.
