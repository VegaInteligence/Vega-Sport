<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/branding/vega-banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/branding/vega-banner-light.svg">
  <img src=".github/branding/vega-banner-dark.svg" alt="Vega Intelligence" width="100%">
</picture>

# Vega Intelligence

Application d'analyse du football. Le site (Next.js) est hébergé sur Vercel ; il lit une API de lecture servie par CloudFront et Lambda, sur une base PostgreSQL (RDS) qu'un worker remplit depuis les sources.

## Organisation

| Répertoire | Responsabilité |
| --- | --- |
| `dashboard/frontend` | Le site et son transport HTTP vers l'API |
| `dashboard/shared` | Modules partagés entre le site et le backend (profil joueur, périmètres, archives) |
| `backend/vega` | Worker Python : planification, collecte, normalisation, calculs, sources |
| `backend/sql` | Migrations de la base (immuables, vérifiées par somme de contrôle) |
| `backend/api` | API de lecture Node : routes, tests de contrat |
| `backend/sources`, `backend/archives` | Lecteurs Node des sources complémentaires et constructeurs des archives |
| `backend/tests` | Tests Python du backend |
| `infra/aws` | Modèles CloudFormation, script de déploiement, paquets Lambda |
| `tests` | Tests du site |
| `docs/calculs` | Les formules, telles que le site et la base les calculent |

Le détail du backend est dans [backend/README.md](backend/README.md), celui du déploiement et de l'exploitation dans [infra/aws/README.md](infra/aws/README.md).

## Développement

Prérequis : Node.js 22 ou plus, Bun, Python 3.12 et PostgreSQL 18 (un conteneur suffit) pour les tests du backend.

```sh
cd dashboard
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Le site lit l'API nommée par `NEXT_PUBLIC_API_ORIGIN` ; aucun identifiant de base n'est nécessaire côté site.

## Vérification

```sh
# Backend : les bases de test jetables, puis les deux suites
eval "$(python3 backend/ci/test_databases.py postgresql://postgres:<mot de passe>@127.0.0.1:5432)"
PYTHONPATH=backend python3 -m unittest discover -s backend/tests
npm ci --prefix backend/api && npm test --prefix backend/api

# Site : tests et construction
node --test tests/*.test.mjs
(cd dashboard && bun run build)
```

La CI (`.github/workflows/ci.yml`) lance ces suites, vérifie les modèles d'infrastructure, construit l'image du worker et le paquet de l'API.

## Déploiement

```sh
aws login --profile statarena
AWS_PROFILE=statarena bash infra/aws/deploy.sh
```

Le script déploie le commit courant : migrations, worker, backfill, API de lecture. Les ressources AWS déployées gardent pour l'instant leurs noms d'origine (`vega-v2-…`).
