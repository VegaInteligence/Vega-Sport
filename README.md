# StatArena

Application d’analyse du football. Le frontend Next.js est hébergé sur Vercel ; l’API AWS est servie par CloudFront et Lambda, les données relationnelles par PostgreSQL sur RDS et les fichiers source et images par S3.

## Développement

Prérequis : Node.js 24, Bun 1.4.4 et Python 3.13 pour les workers.

```sh
cd dashboard
bun install --frozen-lockfile
cp .env.example .env
bun run dev:frontend
```

Le frontend utilise `NEXT_PUBLIC_API_ORIGIN`. L’origine AWS actuelle est `https://d317dq37z1tacb.cloudfront.net`. Aucun identifiant PostgreSQL ou S3 n’est nécessaire dans Vercel. Pour travailler sur une API locale, configurer `DATABASE_URL`, le certificat RDS et l’accès réseau, puis lancer `bun run dev:backend` et pointer le frontend vers cette API.

## Organisation

| Répertoire | Responsabilité |
| --- | --- |
| `dashboard/frontend` | Interface et transport HTTP vers l’API |
| `dashboard/backend` | Routes AWS et lectures PostgreSQL |
| `dashboard/backend/migrations` | Historique SQL appliqué et migrations suivantes |
| `dashboard/scripts` | Collecte, normalisation, publication et contrôles |
| `dashboard/scripts/lib` | Lecteurs AWS réservés aux workers de collecte |
| `infra/aws-backend` | Packaging Lambda et déploiement CloudFormation |
| `tests` | Tests de comportement et d’intégration |
| `docs/verification` | Fixtures et références historiques encore utilisées par les tests |

Les anciennes implémentations du serveur Neon et les outils de bootstrap vers Neon sont retirés. Les préfixes historiques `raw/neon/…` encore présents identifient des objets déjà copiés dans S3 ; ils ne configurent pas un service Neon.

Les migrations déjà appliquées restent immuables. Les anciens modèles JSON conservés pour reproduire ces migrations ne sont pas un nouveau plan de déploiement. Les neuf tables de scoring réservées ne font pas partie du socle actif. La migration `019_retire_reserved_models.sql` les retire si elles existent et sont vides ; elle refuse toute table peuplée et toute dépendance extérieure, sans `CASCADE`.

## Vérification

```sh
cd dashboard
bun run build
cd ..
node --test tests/aws-only-runtime.test.mjs tests/aws-delivery.test.mjs tests/aws-maintenance.test.mjs
```

La CI `Verify ingestion` vérifie aussi la publication relationnelle, les lecteurs versionnés et les migrations sur PostgreSQL 18.6. Les reçus, journaux et captures générés sont publiés comme artefacts CI et ignorés par Git.

Avant une bascule Vercel, comparer les éditions disponibles avec le site courant puis lire effectivement une partition de chaque saison :

```sh
STATARENA_TEST_ORIGIN=https://d317dq37z1tacb.cloudfront.net \
STATARENA_BASELINE_ORIGIN=https://statarena-analytics.vercel.app \
node dashboard/scripts/verify_aws_runtime.mjs
```

Ce contrôle échoue si AWS perd une compétition/saison existante, même si `/api/health` répond correctement. Une compilation réussie ne remplace pas ce contrôle.

## Exploitation AWS

Le déploiement utilise le bucket privé de releases et un change set CloudFormation. La base, les sous-réseaux et le CDN d’images existants sont réutilisés. Les rôles runtime restent en lecture seule. Les workers utilisent les paramètres SSM existants par l’action GitHub `.github/actions/aws-database` ; les secrets ne doivent apparaître ni dans le dépôt ni dans les artefacts.

`dashboard/scripts/rds-maintenance.mjs` est une entrée privée de maintenance temporaire, distincte du serveur HTTP. Elle n’est pas intégrée au ZIP de production. Elle propose uniquement l’inventaire du catalogue et l’application contrôlée de la migration de retrait des modèles vides. Sa création dans AWS reste soumise à l’autorisation de cet accès temporaire ; préparer ce fichier ne crée aucune fonction ni aucun accès.
