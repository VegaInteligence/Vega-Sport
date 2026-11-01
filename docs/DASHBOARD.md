# Dashboard STATARENA

Application Next.js App Router avec backend Bun et base JSON locale. Sept sections : vue d’ensemble, compétitions, clubs, joueurs, classement joueurs, matchs et réglages. La méthode reste accessible dans le pied de page. Les données disponibles restent consultables sans clé API.

```sh
cd dashboard
bun install --frozen-lockfile
bun run dev
```

Ouvrir http://127.0.0.1:3000/. Les pages et la navigation utilisent Next.js ; `/api` et `/data` passent par le backend natif Bun. Le projet conserve les saisons, filtres, profils, comparaisons, exports et treize familles de détails de match. Les notes affichées sont celles de PitchAPI ; aucun classement STATARENA validé n’est encore calculé.

Les statistiques des matchs et des joueurs proposent toutes les périodes collectées et conservent les groupes de métriques de la source. Les fiches joueurs donnent aussi accès aux données avancées, tirs, cartes d’activité, événements, compositions, réseaux de passes et profils. Les synthèses restent disponibles.

Dans **Données complètes**, chaque famille de match dispose d’une analyse, d’un explorateur et du JSON intégral. **Archive complète** contient aussi les statuts et métadonnées d’observation. Les listes se parcourent par pages de cinquante éléments ; le JSON et son téléchargement gardent la précision originale. Une absence reste distincte de zéro.

La page **Classement joueurs** réserve trente positions « À venir » pour le futur classement de l’algorithme, avec un petit Ballon d’Or à côté du titre.

La [structure de l’application](ARCHITECTURE.md) décrit les routes, le backend, la production et les vérifications. Le [schéma JSON](JSON_DATABASE.md) décrit les tables ; la documentation des [données de classement](RANKINGS.md) décrit les archives FIFA/UEFA et les coefficients affichés sur les fiches clubs.
