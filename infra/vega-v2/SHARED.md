# V2 sur le RDS existant

Le mode retenu conserve l'instance `statarena-postgres`, sa classe `db.t4g.micro`, ses 64 Gio et son abonnement actuel. Une base logique `vega_v2` partage ce serveur avec `statarena_prod`. Les tables et les lecteurs de production restent en place.

Le plan de seconde instance, réseau et collecteur Fargate a été abandonné : son change set non exécuté et sa pile CloudFormation vide ont été supprimés. Aucun second RDS ni réseau n'a été créé.

## Initialisation réalisée

`shared_ops.py bootstrap` vérifie le compte et l'instance, conserve les identifiants v2 dans deux paramètres SSM Standard chiffrés, puis appelle `shared_bootstrap.py`. Ce dernier crée seulement la base logique v2 et ses rôles. Le provisionnement des rôles est partagé avec `bootstrap.py` ; son ancien point d'entrée pour une instance dédiée n'est pas utilisé.

Sur PostgreSQL 18.6 réel, les huit migrations ont été appliquées, avec `pg_trgm 1.6` et `vector 0.8.2`. Le rôle `vega_v2_ingest` écrit la v2 ; `vega_v2_reader` lit les faits, agrégats et versions, avec des transactions en lecture seule par défaut. L'instance, la configuration de stockage, le propriétaire et les droits de `statarena_prod` ont été vérifiés inchangés.

Les rôles PostgreSQL sont globaux à l'instance. `PUBLIC` conserve son droit existant de connexion/temporaire à l'ancienne base, mais l'audit n'a trouvé aucun droit public sur ses tables ni aucune fonction applicative à privilèges élevés exécutable par `PUBLIC`. Le connecteur v2 impose en plus le nom de base `vega_v2` et ses deux rôles ; il refuse une URL distante arbitraire ou `statarena_prod`.

## Collecte progressive

Le workflow `Vega v2 collection (existing RDS)` utilise les runners GitHub existants. Il n'ajoute pas d'instance ni de service permanent. Le rôle IAM `VegaV2GitHubIngest` ne peut lire que le paramètre d'ingestion v2 et les métriques nécessaires. Il réutilise le mécanisme existant d'ouverture temporaire TCP/5432 au seul IPv4 du runner, avec nettoyage en fin de job.

La première phase récupère uniquement le catalogue et les calendriers depuis 2021. Elle ne lance ni les profils ni les treize familles par match. Le rapport `python -m vega_v2.worker plan` donne les éditions couvertes, les matchs terminés/à venir et le volume de requêtes restant. L'activation des détails est une action distincte, paginée et filtrable par édition.

Le plafond initial de la base v2 est de 1 Gio et le contrôle vérifie une réserve physique de 6 Gio, via CloudWatch. Une métrique périmée ou indisponible bloque les nouveaux travaux. Ces limites servent à mesurer la première étape sans épuiser le stockage partagé ; elles ne signifient pas que le backfill complet est déjà achevé ou qu'il tient sans mesure dans l'espace restant.

La collecte partage CPU, mémoire, disque et WAL avec la production. Les appels restent séquentiels et les écritures sont regroupées pour réduire les allers-retours SQL. Les tests locaux couvrent les baux, les reprises, les identités sans nom et les rollbacks.

Les coûts d'usage ordinaires d'AWS/GitHub restent ceux des services existants ; aucune formule ou capacité supplémentaire n'est activée par ce mode.

## Exploitation

- `shared_ops.py preflight` : vérifications sans mutation.
- `shared_ops.py bootstrap` : création/reprise de la seule base logique v2.
- `shared_ops.py verify` : identité, versions, taille et droits du lecteur.
- `shared-role.py` : rôle OIDC dédié au workflow v2.
- `shared_ci.py` : configuration du runner, sans exposition des identifiants.

Le retrait ultérieur concerne l'ancienne base logique ou ses tables et les anciens JSON, uniquement après accord explicite. L'instance RDS commune ne doit pas être supprimée puisqu'elle héberge la v2.
