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

**Lancement du 3 novembre 2026 :** le [run n° 1](https://github.com/OrionQuantPlatform/STATARENA/actions/runs/41711363014) a été déclenché sur le commit `25033cbaa8`, avec toutes les saisons activées, 100 minutes et des lots de 10 partitions. Dernier état observé : `pending`, derrière Daily Sync dans la file partagée. La commande de lancement et le statut sont conservés dans `docs/verification/rematerialization-launch-20261103/launch.json`. La régénération complète et `remaining: 0` ne sont pas encore attestés. Ne pas relancer avec la première case cochée pendant cette attente.
