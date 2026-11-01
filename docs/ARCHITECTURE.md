# Architecture

Orion est une application **Next.js App Router** avec un backend de données **Bun.serve**. Les routes sont définies par les fichiers `app/**/page.jsx`. Le layout Next partage le contexte React et les liens Next assurent la navigation sans rechargement du document.

```text
dashboard/
  frontend/
    app/
      layout.jsx              layout Next, métadonnées, styles
      providers.jsx           état partagé React
      page.jsx                vue d’ensemble
      competitions/page.jsx
      clubs/page.jsx
      joueurs/page.jsx
      matchs/page.jsx
      classements/page.jsx
      methode/page.jsx
      api/[...path]/route.js   transport vers Bun
      data/[...path]/route.js  transport vers Bun
      loading.jsx
      error.jsx
      not-found.jsx
    src/
      views/                  contenu des sept pages
      components/             UI, graphiques, profils et détails de match
      hooks/                  saison, filtres, sélection et comparaison
      services/               chargement des données et formatage
      server/                 proxy Next vers Bun
      styles.css              tokens et composants visuels
    public/                   favicon
    next.config.mjs
  backend/
    server.js                 serveur HTTP natif Bun
    app.js                    API et accès public borné aux données
    services/                 lectures JSON, fichiers et passerelle PitchAPI
  scripts/                    collecte, transformation et vérification
  outputs/                    preuves et journaux
  shared/                     navigation
  package.json
  bun.lock
data/                         base JSON canonique
docs/
tests/
```

Les identifiants, saisons et filtres restent dans les URL, par exemple `/clubs?season=2025%2F2026&id=t_1cpjqO`. `useSearchParams` suit les changements d’URL et le retour navigateur. Les mises à jour de filtre utilisent l’API History prise en charge par Next. Le cache conserve une saison complète ; les classements peuvent se consulter seuls sans télécharger ses performances.

Le backend conserve l’accès aux archives et aux clés. En local, Next relaie les réponses sur `/api/*` et `/data/*` vers `ORION_API_ORIGIN`. Sur Vercel, les mêmes handlers tournent dans les routes Next avec Bun ; les JSON sont lus depuis la révision GitHub du déploiement. Aucune copie de `data/` dans le frontend. Seuls les chemins de données autorisés sont exposés par l’application ; les observations absentes restent distinctes des zéros. La [configuration de déploiement](DEPLOYMENT.md) décrit le transport cloud et le worker quotidien.

## Développement

```sh
cd dashboard
bun install --frozen-lockfile
bun run dev
```

Site : http://127.0.0.1:3000. API Bun : http://127.0.0.1:8765/api/health. Ctrl+C arrête les deux processus. `PORT` règle le port du site, `API_PORT` celui de Bun. Les deux serveurs tournent avec Bun ; Next gère le frontend, Bun gère la logique de données. Les clés facultatives sont dans `dashboard/.env` et ne sont pas des variables `NEXT_PUBLIC_*`.

## Production et vérification

```sh
cd dashboard
bun run build
bun start
bun run test
bun run verify
bun run format:check
```

Le build Next est dans `frontend/.next/`, le cache de développement dans `frontend/.next-dev/`, tous deux ignorés par Git. Aucun `dist`, générateur de pages HTML ou export statique n’est utilisé. `bun run verify` démarre une instance Next de production et une API Bun sur des ports libres, exerce les routes réelles et enregistre ses preuves dans `outputs/next-migration/`. Le build de production est requis avant `bun start` ou `bun run verify`. Le site public existant n’est pas redéployé par ces commandes.

Pour ajouter une page : créer `frontend/app/<route>/page.jsx`, composer ses composants React et ajouter son lien dans `shared/pages.json`. Il n’y a aucun fichier HTML à créer. La navigation, les styles et l’état partagés passent par le layout Next.
