# Chargement des données

Le dashboard utilise les vues dérivées dans `data/computed/dashboard/`. Elles regroupent les huit tables de chaque compétition en un seul fichier, sans retirer de champ ni de ligne. Les colonnes répétitives utilisent des dictionnaires de chaînes ; le décodeur reconstruit les objets d'origine, y compris les champs optionnels et les valeurs nulles.

Pour la saison 2026/2027, le chargement complet passe de 360 requêtes de tables à 45 et de 19,79 à 13,82 Mo compressés. Avec un filtre de compétition, une seule archive est demandée. La liste complète des compétitions reste disponible dans le manifeste (72 Ko au lieu de 505 Ko). Les fichiers déjà chargés sont réutilisés dans une limite de 48 compétitions en mémoire ; les erreurs ne sont pas conservées dans le cache.

En production, les fichiers publics sont lus directement à une révision immuable de GitHub, évitant un passage par une fonction Vercel pour chaque redirection. `ORION_DATA_REVISION`, lorsqu'il est défini, prend la même priorité côté serveur et navigateur. La navigation apparaît pendant le chargement, avec un état d'attente accessible.

## Mesures et limites

Le relevé HTTP initial en production a pris 16,94 s pour la saison complète et 6,06 s pour une seule compétition. Les mesures locales après optimisation (1,11 s et 0,08 s) servent à vérifier le code ; elles ne constituent pas une comparaison de latence réseau avec la production. Les mesures de déploiement, lorsqu'elles sont effectuées, sont conservées séparément dans `dashboard/outputs/loading-performance/`.

Les données détaillées de toutes les compétitions d'une saison complète restent volumineuses. Les temps dépendent du réseau, du cache HTTP et du terminal. Le format réduit le volume et les requêtes ; il ne garantit pas un délai identique pour tous les visiteurs.

## Reproduction

- `python3 dashboard/scripts/verify_loading_views.py` : régénération, comparaison intégrale des 127 partitions et contrôle de stabilité des fichiers.
- `cd dashboard && ORION_VERIFY_URL=http://127.0.0.1:3000 node scripts/benchmark_loading.mjs outputs/loading-performance/http-local.json` : mesure du chargeur sur une application en cours d'exécution.
- `cd dashboard && node --max-old-space-size=3072 scripts/verify_loading_http.mjs` : comparaison avec le chargement canonique, portée d'une compétition, réutilisation et reprise après une erreur HTTP.
- `cd dashboard && bun scripts/verify_daily_refresh.mjs` : collecte et publication complètes dans un environnement temporaire.

Le rafraîchissement normal régénère les vues à partir des empreintes des tables, puis publie `data/computed` avec `data/raw`. Les réponses brutes et les archives originales ne sont pas modifiées par la génération des vues.
