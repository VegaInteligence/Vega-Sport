# Dashboard STATARENA

Application Next.js App Router avec backend Bun et base JSON locale. Sept sections : vue d’ensemble, compétitions, clubs, joueurs, classement Ballon d’Or, matchs et réglages. La méthode reste accessible dans le pied de page. Les données disponibles restent consultables sans clé API.

```sh
cd dashboard
bun install --frozen-lockfile
bun run dev
```

Ouvrir http://127.0.0.1:3000/. Les pages et la navigation utilisent Next.js ; `/api` et `/data` passent par le backend natif Bun. Le projet conserve les saisons, filtres, profils, comparaisons, exports et treize familles de détails de match. Les notes affichées sont celles de PitchAPI ; aucun classement STATARENA validé n’est encore calculé.

La liste Joueurs affiche une ligne par identifiant joueur. Les statistiques représentent les moyennes des observations renseignées ; le nombre de matchs et les minutes moyennes restent visibles. Le mode par 90 minutes utilise la somme de chaque statistique et les minutes de ses observations connues. La note reste une moyenne, sans conversion par 90. Les seuils de minutes, note et statistiques s’appliquent après regroupement ; la compétition, la période, le statut, le lieu et le résultat définissent d’abord l’échantillon. La position est celle qui cumule le plus de temps de jeu. Le CSV et la comparaison utilisent ces mêmes valeurs, avec la couverture de chaque statistique dans le CSV. La fiche joueur donne accès aux performances match par match.

Sur l’accueil, le contrôle Compétitions réunit toutes les compétitions, le préréglage Top 7 Europe + UEFA et la sélection personnalisée enregistrée sur l’appareil. La page Clubs combine recherche, pays et saison ; ses pages s’adaptent aux dimensions de l’écran. Les classements de compétitions utilisent la largeur disponible avec défilement horizontal du tableau sur mobile.

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

## Fiches clubs

La fiche regroupe les joueurs inscrits dans les matchs collectés de la saison choisie en gardiens, défenseurs, milieux et attaquants. Le dernier poste connu dans une composition est utilisé ; les joueurs sans poste restent dans une rubrique distincte. Ces joueurs ne constituent pas nécessairement l’effectif complet ou actuel du club.

Le stade, l’entraîneur et l’année de fondation proviennent de Wikidata lorsque l’identité du club est établie par l’identifiant UEFA existant ou, à défaut, par une correspondance unique du nom exact et du pays. Les portraits proviennent de Wikimedia Commons avec le crédit et la licence indiqués. Si Wikidata ne fournit pas l’information, la fiche indique l’entraîneur observé au dernier match collecté et le stade du dernier match à domicile renseigné par PitchAPI. Les informations Wikidata sont actuelles au moment de leur consultation et ne sont pas présentées comme historiques pour la saison choisie. Les réponses sont mises en cache côté site.


## Fiche stade

Le nom du stade ouvre une fiche indépendante de la saison sélectionnée. Pour les stades liés à une entrée Wikidata, elle affiche la capacité maximale référencée, la date de création et celle d'ouverture, avec leurs précisions et la date de la capacité quand elle existe. Cette capacité ne garantit pas le nombre de places disponibles pour un match, notamment en cas de travaux.

Si des coordonnées terrestres sont disponibles, une carte interactive utilise MapLibre et les tuiles OpenFreeMap / OpenStreetMap. Elle affiche les volumes 3D présents dans les données cartographiques ; il ne s'agit pas nécessairement d'un modèle architectural détaillé du stade. Lorsque les données ou la carte ne sont pas disponibles, la fiche le signale.


### Plans officiels des tribunes

Quand une source officielle a été vérifiée, la fiche propose un lien vers le plan du stade ou sa visite des tribunes. Les plans restent hébergés par leur éditeur ; leur présentation et leur disponibilité peuvent varier. Certaines vues 3D, notamment celles de la billetterie Juventus, dépendent des matchs en vente ou d'une connexion. Le catalogue est relié à l'identifiant du stade, et aucune correspondance n'est supposée lorsqu'elle est absente.
