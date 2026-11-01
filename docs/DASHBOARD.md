# Dashboard Orion

Application Next.js App Router avec backend Bun et base JSON locale. Sept sections : vue d’ensemble, compétitions, clubs, joueurs, classement joueurs, matchs et réglages. La méthode reste accessible dans le pied de page. Les données disponibles restent consultables sans clé API.

```sh
cd dashboard
bun install --frozen-lockfile
bun run dev
```

Ouvrir http://127.0.0.1:3000/. Les pages et la navigation utilisent Next.js ; `/api` et `/data` passent par le backend natif Bun. Le projet conserve les saisons, filtres, profils, comparaisons, exports et treize familles de détails de match. Les notes affichées sont celles de PitchAPI ; aucun classement Orion validé n’est encore calculé.

La page **Classement joueurs** réserve trente positions « À venir » pour le futur classement de l’algorithme, avec un petit Ballon d’Or à côté du titre.

La [structure de l’application](ARCHITECTURE.md) décrit les routes, le backend, la production et les vérifications. Le [schéma JSON](JSON_DATABASE.md) décrit les tables ; la documentation des [données de classement](RANKINGS.md) décrit les archives FIFA/UEFA et les coefficients affichés sur les fiches clubs.
