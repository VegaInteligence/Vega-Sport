# Vercel et collecte quotidienne

Site : [statarena-analytics.vercel.app](https://statarena-analytics.vercel.app).

Le projet Vercel est relié à `OrionQuantPlatform/STATARENA`, branche de production `main`. Les pushes déclenchent les déploiements Git. Les commits qui restent uniquement sur une machine ne déclenchent pas Vercel.

| Réglage Vercel | Valeur |
| --- | --- |
| Root Directory | `dashboard/frontend` |
| Framework | Next.js |
| Install Command | `cd .. && bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Output Directory | valeur Next.js par défaut `.next` |
| Runtime | Bun 1.4.x |
| Région | Paris `cdg1` |
| Skip deployments when no root changes | désactivé, car les JSON sont hors du frontend |

`dashboard/frontend/vercel.json` et le workspace Bun définissent ces commandes. Le code partagé/backend reste dans `dashboard`. Il faut autoriser les fichiers extérieurs à la racine frontend pour le build du monorepo. Les clés et les 1,7 Go de données ne sont pas inclus dans les Functions.

## Données en production

En local, Next relaie les requêtes au serveur `Bun.serve` sur le port 8765. Sur Vercel, les mêmes handlers backend s'exécutent dans les routes Next avec le runtime Bun. Aucun service localhost n'est requis dans le cloud.

Les JSON canoniques restent dans `data/raw` et `data/computed`. Vercel utilise le SHA Git du déploiement pour lire exactement cette révision GitHub. Les routes `/data/*` redirigent vers les fichiers bruts publics correspondants ; les archives de matchs/profils sont reconstruites côté serveur à partir des partitions gzip. Les redirections ne sont pas mises en cache ; les requêtes du frontend portent le SHA public du build pour éviter de réutiliser une ancienne redirection après déploiement. Les fichiers GitHub eux-mêmes ont une URL immuable. Cela évite de charger toute la base dans un bundle et de dépendre d'un disque persistant dans une Function. Aucun secret n'est ajouté à ces URL. Cette configuration repose sur le caractère public actuel du dépôt.

Le cache mémoire du backend est borné et facultatif : la révision Git, et non un processus Vercel, constitue la source persistante. Un nouveau déploiement prend la nouvelle révision. Les anciennes saisons et les valeurs absentes sont conservées.

## Worker de minuit

`.github/workflows/daily-data.yml` planifie le worker à **00:00 Europe/Paris**, avec prise en compte des changements d'heure. GitHub Actions peut retarder un déclenchement lorsque ses runners sont chargés ; cette planification n'est pas une garantie à la seconde. Le workflow peut aussi être lancé manuellement depuis Actions.

1. Restauration des seules archives de la saison en cours depuis leurs bundles vérifiés.
2. Inventaire de toutes les compétitions européennes disponibles pour les saisons en cours (saisons civiles incluses).
3. Collecte des nouveaux matchs terminés, des trois derniers jours et des rencontres dont les métadonnées ont changé ; conservation des 13 familles. Les détails des rencontres à venir dans les 48 heures sont également actualisés. Le calendrier complet est actualisé quotidiennement.
4. Ajout/actualisation des profils concernés (cache de sept jours), normalisation avec les parseurs existants et reconstruction des partitions JSON de ces compétitions. Les autres saisons sont conservées.
5. Vérification des hashes, références et doublons, puis commit des seuls fichiers de données et push sans force sur `main`. Une course avec un autre push fait échouer la publication plutôt que remplacer ses modifications.
6. Déploiement Git Vercel automatique après le push, y compris les pushes du bot de collecte. Ce parcours a été vérifié sur une collecte réelle.

Une erreur d'authentification, un inventaire invalide, un échec transitoire persistant ou une normalisation invalide empêche le commit. Les erreurs d'indisponibilité par endpoint restent dans les observations ; elles ne deviennent pas des zéros. `raw/sync.json` décrit la dernière collecte réussie. GitHub Actions conserve les logs et une copie de ce reçu.

## Secrets

- GitHub Actions : `PITCHAPI_API_KEY`, secret du dépôt.
- Vercel : `PITCHAPI_API_KEY`, secret côté serveur, sans préfixe `NEXT_PUBLIC_`.
- Local : `dashboard/.env`, ignoré par Git.

Le bouton de thème est placé à droite de la navigation ; son choix est enregistré sur l’appareil. L’état de collecte reste accessible via `/api/settings` et GitHub Actions. Le focus **Top 7 Europe + UEFA** contient les premières divisions anglaise, espagnole, allemande, italienne, française, portugaise et néerlandaise, plus Champions League, Europa League et Conference League ; les autres données restent disponibles en désactivant ce focus.

## Vérifier ou lancer en local

```sh
cd dashboard
bun scripts/daily_refresh.mjs --plan
bun scripts/verify_daily_refresh.mjs
bun run test
```

`--plan` consulte le catalogue sans modifier la base. `verify_daily_refresh.mjs` utilise un fournisseur HTTP local et une base temporaire ; aucune vraie collecte n'est effectuée. Pour lancer la vraie collecte, utiliser `bun scripts/daily_refresh.mjs` avec la clé serveur configurée, puis `python3 scripts/verify_daily_data.py` et examiner le diff avant publication.

Les preuves de ce déploiement se trouvent dans `dashboard/outputs/vercel-daily/`.

Sources de configuration : [runtime Bun Vercel](https://vercel.com/docs/functions/runtimes/bun), [planification GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [PitchAPI](https://pitchapi.dev/).
