# Dashboard STATARENA

Application Next.js App Router avec backend Bun et base JSON locale. Sept sections : vue d’ensemble, compétitions, clubs, joueurs, classement Ballon d’Or, matchs et réglages. La méthode reste accessible dans le pied de page. Les données disponibles restent consultables sans clé API.

```sh
cd dashboard
bun install --frozen-lockfile
bun run dev
```

Ouvrir http://127.0.0.1:3000/. Les pages et la navigation utilisent Next.js ; `/api` et `/data` passent par le backend natif Bun. Le projet conserve les saisons, filtres, profils, comparaisons, exports et treize familles de détails de match. Les notes affichées sont celles de PitchAPI ; aucun classement STATARENA validé n’est encore calculé.

Les statistiques des matchs et des joueurs proposent toutes les périodes collectées et conservent les groupes de métriques de la source. Les fiches joueurs donnent aussi accès aux données avancées, tirs, cartes d’activité, événements, compositions, réseaux de passes et profils. Les synthèses restent disponibles.

Dans **Données complètes**, chaque famille de match dispose d’une analyse, d’un explorateur et du JSON intégral. **Archive complète** contient aussi les statuts et métadonnées d’observation. Les listes se parcourent par pages de cinquante éléments ; le JSON et son téléchargement gardent la précision originale. Une absence reste distincte de zéro.

La page **Classement Ballon d’Or** réserve trente positions « À venir » pour le futur classement de l’algorithme, avec un petit Ballon d’Or à côté du titre.

La [structure de l’application](ARCHITECTURE.md) décrit les routes, le backend, la production et les vérifications. Le [schéma JSON](JSON_DATABASE.md) décrit les tables ; la documentation des [données de classement](RANKINGS.md) décrit les archives FIFA/UEFA et les coefficients affichés sur les fiches clubs.

## Compétitions et classements

La page met en avant les sept championnats européens et les trois coupes
européennes, avec leurs logos et leur pays ; le catalogue complet reste
accessible et consultable par recherche. Les préférences de l’accueil utilisent
le même ordre de priorité.

Pour la dernière saison proposée d’une compétition, le site affiche les
tableaux et groupes disponibles auprès de [SportScore](https://sportscore.com/),
avec attribution. L’API ne fournit pas la saison de ses tableaux : l’interface
les présente donc comme le dernier tableau disponible, sans affirmer qu’il
correspond à une saison historique choisie. Les correspondances explicites
PitchAPI/SportScore figurent dans `sportscore-standings.js`.

Si le tableau tiers n’est pas disponible ou si une saison plus ancienne est
sélectionnée, un classement est calculé à partir des scores PitchAPI pour les
ligues simples ou lorsque le calendrier complet est un aller-retour équilibré.
Il est signalé comme calculé et ne tient pas compte des sanctions ni de tous
les départages. Les autres formats affichent une indisponibilité plutôt qu’un
classement supposé.
