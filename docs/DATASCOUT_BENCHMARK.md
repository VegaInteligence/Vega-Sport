# Data’Scout → ajouts utiles pour Orion

Audit fonctionnel du 1 novembre 2026. Site parcouru avec la session gratuite déjà ouverte, sur les treize outils de sa navigation. Comparaison avec Orion en production et le code de `cd1eed61`, puis vérification des champs réellement présents dans notre base JSON.

Les fonctions à plus forte valeur pour Orion sont les **indices personnalisables**, les **évaluations par rôle**, la **recherche de profils similaires** et les **comparaisons contextualisées**. Leur fondation commune est une agrégation joueur-saison fiable. Le caractère payant d’un widget Data’Scout ne réduit pas sa priorité dans ce benchmark. Le socle de données à construire est distinct du choix des fonctions finales.

Les propositions ci-dessous constituent un benchmark, sans modification de l’application. Les calculs propriétaires de Data’Scout n’ont pas été reproduits ni validés. Les captures actuelles et l’inventaire des données sont conservés dans [le dossier de preuves](../dashboard/outputs/datascout-benchmark/).

## Complément : les widgets payants font partie du périmètre

Complément demandé par l’utilisateur : un widget masqué reste une fonction à analyser dès lors que son intitulé et sa description sont visibles. Le compte gratuit suffit pour identifier son usage et ses prérequis ; l’accès abonné ne sert qu’à approfondir ses interactions et paramètres privés. Aucun abonnement n’est nécessaire pour établir cette matrice.

Le tableau des offres a été relu, le mode Personnalisé du classement a été ouvert jusqu’à son écran de restriction, et les descriptions des cartes payantes de la fiche Hakimi ont été réexaminées. Les documentations officielles des indices, rôles, similarité, valeur marchande et compatibilité précisent les usages. Les coefficients internes ne sont pas publiés dans les pages examinées.

| Widget ou ensemble de fonctions payantes | Valeur du produit | Traduction proposée pour Orion | État de la preuve |
|---|---|---|---|
| Classement sur indice personnalisé | Transformer un besoin de recrutement en classement selon ses propres critères. | Choix des métriques et de leur importance, critères à maximiser/minimiser, contraintes, contributions au score et modèles sauvegardés. Un mode exploratoire distinct du classement Orion validé. **Priorité forte.** | Restriction Starter constatée après clic ; usage et pondération décrits sur le site et dans l’offre API. Éditeur privé non vu. La disposition précise des contrôles proposés est notre recommandation. |
| Performance contextualisée et domination locale | Distinguer niveau contextualisé et surperformance dans son environnement. | Deux lectures complémentaires, avec cohorte et exposition visibles ; tester toute correction de difficulté. **Priorité forte pour le Top 30.** | Deux indices expliqués dans la documentation. Aucune formule exacte ni comparabilité empirique confirmée. |
| Plusieurs évaluations par rôle et meilleur rôle | Évaluer les fonctions compatibles avec l’usage du joueur. | Scores par rôle, contribution des blocs et minutes effectivement observées ; normaliser les positions avant de construire la taxonomie. **Priorité forte.** | Carte payante et documentation des rôles. Les rôles du teaser ne constituent pas une recommandation tactique vérifiée. |
| Synthèse de compétences | Résumer un profil en dimensions compréhensibles. | Blocs techniques : finition, création, progression/construction, défense, aérien. Ajouter les dimensions physiques uniquement avec leurs mesures. **Priorité forte.** | Carte visible sous restriction ; catégories et fonction identifiables. |
| Tableau complet de centiles et positionnement dans le championnat | Lire le détail d’un joueur face à ses pairs. | Valeurs, rangs relatifs, cohortes, minimum de minutes et couverture par indicateur. **Priorité forte.** | Carte payante, documentation et exemple public de la pépite. |
| Templates personnalisés de comparaison | Adapter les axes au rôle et à la question posée. | Modèles de métriques, modes brut/par 90/centiles et comparaison saison précédente/médiane. **Priorité forte.** | Personnalisation annoncée dans les offres ; comparaison générique testée. Éditeur de templates abonné non vu. |
| Joueurs similaires et recherche d’alternatives | Chercher un style comparable et préparer un remplacement. | Vecteurs statistiques par rôle, explication des ressemblances et filtres indépendants de niveau. Ajouter âge/prix/pied lorsque renseignés. **Priorité forte.** | Descriptif du widget, documentation dédiée et cartes dans la démo publique. |
| Évolution du niveau dans le temps | Lire progression, stabilité et changements de contexte. | Historique saisonnier de métriques et scores versionnés, séparé des évolutions de couverture. **Priorité forte.** | Widget réservé, axe temporel et description visibles ; exemple public à une seule saison. |
| Comparaison collective, équipes similaires et rotation détaillée | Décrire le style du club et les fonctions de son effectif. | Agrégats club-saison, distances entre styles, répartition des minutes et continuité du XI. **Priorité forte à moyenne.** | Descriptions des blocs verrouillés dans Analyse collective ; radars et aperçu d’utilisation visibles. Résultats privés non exécutés. |
| Test de recrutement et compatibilité joueur–club | Situer une cible dans un effectif et un style précis. | Première version descriptive sur rôle, concurrence et métriques collectives disponibles ; exposition des axes et des absences. **Priorité moyenne, prototype possible avec nos données.** | Bloc Pro décrit ; exemple public détaillé à trois axes sur quatre. Ce n’est pas une preuve de réussite future. |
| Projection dans une autre ligue ou un autre club | Estimer un changement de contexte sportif. | Recherche de similarité/contextes dès maintenant ; projection prédictive seulement après validation sur des transitions historiques. | Parcours standard restreint et démo publique. Les résultats affichés ne révèlent pas le modèle interne. |
| Analyse physique et adaptation au standard cible | Examiner allures, efforts et adéquation athlétique. | Source de tracking nécessaire pour vitesses, distances, sprints et accélérations ; ne pas les remplacer par des conduites de balle. | Familles identifiées dans l’offre, le glossaire, le sélecteur de statistiques et la démo. |
| Directions de passes et poids dans la circulation | Comprendre orientation, progression et participation au jeu. | Mettre en valeur les passes progressives/vers la surface déjà présentes ; vérifier les données directionnelles avant d’afficher arrière/latéral/avant ou une carte complète. | Fonction listée dans l’offre ; exemple public consulté. |
| Export de fiche PDF et rapports graphiques | Partager une analyse complète avec son contexte. | Rapport joueur/club avec métriques choisies, population, date et provenance. **Priorité moyenne.** | Export PDF annoncé, boutons visibles ; document final payant non téléchargé. |
| Valorisation et filtres de recrutement | Confronter cible sportive, âge et situation contractuelle. | Ajouter d’abord des métadonnées fiables. Toute estimation de valeur demande un modèle et une validation spécifiques. | Fonction et facteurs décrits officiellement ; aucune qualité de prix vérifiée. |
| Sauvegardes et intégration API | Réutiliser modèles, analyses et résultats dans d’autres outils. | Vues locales sauvegardées et interface d’export documentée sur notre backend ; aucune dépendance à l’API DataScout n’est proposée ici. | Volumes et offre API annoncés ; stockage distant et API commerciale non testés. |

Cette analyse relève les fonctions masquées sans prétendre avoir utilisé leurs paramètres privés. Les illustrations floutées ne permettent ni de confirmer les valeurs du joueur ni de reconstruire les formules.

### Priorité révisée

La première version du rapport mettait surtout en avant les surfaces gratuites. La priorité fonctionnelle devient : **score personnalisable et par rôle → profils similaires → comparaisons contextualisées et évolution → profil collectif et compatibilité descriptive**. Les agrégats saison, les métriques normalisées et les cohortes restent le socle technique commun, et non une raison de repousser tous les outils premium.

La compatibilité descriptive d’un joueur avec un effectif peut être étudiée avec nos données techniques actuelles. Les dimensions absentes doivent être omises explicitement. Elle ne doit pas être présentée comme une prévision de performance dans un transfert. Le besoin de nouvelles données concerne surtout le tracking physique, la biographie détaillée, les contrats et le marché.

Sources complémentaires : [offres et API](https://datascout.pro/fr/abonnement), [indice de performance](https://datascout.pro/fr/glossaire/indice-de-performance), [domination](https://datascout.pro/fr/glossaire/indice-de-domination), [rôles](https://datascout.pro/fr/glossaire/roles-et-postes), [similarité](https://datascout.pro/fr/glossaire/profils-similaires), [compatibilité](https://datascout.pro/fr/glossaire/score-de-compatibilite), [valeur marchande](https://datascout.pro/fr/glossaire/valeur-marchande). Les variantes d’accès observées en démo et les fonctions des plans sont présentées comme deux éléments distincts.

![Comparatif des fonctions payantes](../dashboard/outputs/datascout-benchmark/24-paid-plan-matrix.jpg)

![Accès au classement personnalisé](../dashboard/outputs/datascout-benchmark/25-custom-ranking-access.jpg)

![Cartes de scores et de rôles masquées](../dashboard/outputs/datascout-benchmark/26-paid-role-scores.jpg)

## Parcours et fonctions inspectées

« Testé » signifie qu’une interaction a produit un résultat visible. « Partiel » signifie que l’entrée et les contrôles ont été examinés, avec une limite nommée. Les limites d’abonnement décrivent cette session à cette date.

| Étape | Outil Data’Scout et état observé | Fonctions constatées | Différence avec Orion et ajout proposé |
|---|---|---|---|
| 1 | [Accueil](https://datascout.pro/fr), consulté | Organisation des outils, exemples, applications mobiles et offres. | Garder notre navigation actuelle ; répartir les ajouts dans Joueurs, Clubs et Classement joueurs. |
| 2 | [Analyse individuelle](https://datascout.pro/fr/fiches-joueurs), testé avec Hakimi | Recherche par joueur/saison, identité, positions, carrière, absences, bilan saison, forces/faiblesses, radar de centiles. Plusieurs blocs d’indices et données physiques sont verrouillés. | Orion possède surtout des lignes et fiches de performances par match. Ajouter une vraie synthèse saison, avec historique, couverture et contexte. Les informations biographiques enrichies nécessitent une autre source. |
| 3 | Comparaison au joueur médian, testée dans la fiche | Référence de même poste, modèle de radar, valeurs brutes/centiles, tableau et valeurs numériques. | Ajouter médiane du poste, saison précédente et comparaison de compétitions dans la fiche joueur. |
| 4 | [Analyse collective](https://datascout.pro/fr/analyse-equipe), PSG chargé | Forme, classement du championnat, domicile/extérieur, formations utilisées, buts par tranche de minutes, joueurs utilisés, pyramide des âges, historique d’entraîneurs et radars offensif/défensif. Comparaisons d’équipes, rotation détaillée, équipes similaires et test de recrutement sont limités. | Nos fiches clubs contiennent identité, matchs, joueurs et historique UEFA. Ajouter bilan saison, xG pour/contre, forme, effectif par minutes, formations et profil collectif. Âges et mandats d’entraîneurs manquent. |
| 5 | [Analyse entraîneur](https://datascout.pro/fr/coachs), Luis Enrique chargé | Carrière/mandats, formations, signature tactique, tableau saisonnier et contrôles de comparaison de deux à quatre saisons/entraîneurs. Export visible. | Fonction absente. Demande une base d’entraîneurs et de mandats datés ; faible priorité pour notre objectif actuel. |
| 6 | [Comparaison](https://datascout.pro/fr/comparaison), radar Hakimi/Mendes généré | Jusqu’à quatre joueurs annoncés ; deux testés. Saison propre à chaque joueur, modèles par poste, référence médiane, radar, tableau et affichage brut/centiles. | Notre comparaison porte sur trois performances de match et un ensemble fixe de métriques. Ajouter un mode joueur-saison, des métriques sélectionnables et des raccourcis de référence. |
| 7 | [Projection](https://datascout.pro/fr/projection), partiel | Joueur sélectionné, parcours vers championnat/club cible ; calcul réservé à Starter sur cette page. | Demande un modèle de transfert validé. Un exemple public a été examiné à l’étape 15, sans vérifier sa justesse prédictive. |
| 8 | [Nuage de points](https://datascout.pro/fr/scatter-plot), graphique xG/xA généré | Sélecteur de 158 statistiques dans cette interface, axes libres, un/deux axes, jusqu’à quatre ligues, postes, âge/minutes/valeur, couleurs et mise en avant de clubs/joueurs, seuils et export. Physique verrouillé. | Nous avons déjà un nuage par apparition avec deux couples d’axes prédéfinis. Étendre ce composant à des axes libres, des agrégats saison et des filtres utiles. |
| 9 | [Classement performance](https://datascout.pro/fr/ranking), tableau chargé | Rôle, poste, ligue/saison, profil, contrat/prêt, tri, pagination, niveau et domination locale ; mode personnalisé verrouillé. | Notre Top 30 est volontairement en attente. Construire notre classement après validation de notre méthode ; afficher les composantes et la couverture, avec filtres par rôle. |
| 10 | [Classement collectif](https://datascout.pro/fr/classement-collectif), tableau chargé | Classement des clubs, quatre indicateurs sélectionnables, indices globaux et dimensions de style. | Ajouter des comparaisons de clubs dans Clubs/Compétitions, sans réintroduire la page de classements nationaux FIFA/UEFA supprimée. |
| 11 | [Scouting](https://datascout.pro/fr/scouting), recherche exécutée | Groupes de filtres, terrain pour choisir les postes, 31 libellés de rôles spécialisés, seuils, critères actifs, sauvegarde/export et tables par catégorie. Une recherche DD +60 min/match a retourné 38 lignes. | Ajouter des filtres statistiques cumulables, un sélecteur de colonnes, des profils de recherche et des résultats au niveau joueur-saison. Commencer avec poste/minutes/compétition/statistiques ; âge/pied/contrat demandent des données nouvelles. |
| 12 | [Mes favoris](https://datascout.pro/fr/mes-favoris), état vide consulté | Espace de favoris, compteur 0/50 et retour aux fiches. Contrôle d’enregistrement également visible dans les fiches. | Ajouter une sélection persistante et des listes locales exportables. Aucun favori n’a été ajouté pour cet audit ; classement/dossiers internes non testés. |
| 13 | [Création d’équipe](https://datascout.pro/fr/shadow-team), PSG chargé | Effectif réparti automatiquement sur un terrain, huit formations, options par poste, statuts titulaire/remplaçant/option/à suivre, colonnes de profil et compatibilité, sauvegarde/export. | Un constructeur de XI et une profondeur d’effectif sont possibles après normalisation des postes. Un « meilleur XI » exige un critère de score explicite ; l’optimalité de leur sélection n’a pas été vérifiée. |
| 14 | [Mercato idéal](https://datascout.pro/fr/mercato), PSG chargé | Simulation d’effectif, départs/arrivées/prêts/solde, recrutement et ajout manuel, formation/banc, récapitulatif et sauvegarde/export. | À garder pour une extension recrutement : marché, contrats et prix n’existent pas dans nos profils. Aucune transaction de simulation ni sauvegarde effectuée. |
| 15 | [Pépite du jour](https://datascout.pro/fr/pepite-du-jour), exemple public complet examiné | Joueur du jour et archives, profils similaires, centiles détaillés, directions de passes, exemple de projection et compatibilité avec un club, comparaison à son effectif, avertissement sur faibles minutes et vote. | Ajouter un joueur à découvrir ou les performances de la semaine avec justification transparente. La qualification « jeune pépite » attend des âges vérifiés. Similarité et compatibilité sont deux chantiers distincts. Aucun vote effectué. |

L’exemple public de la dernière étape donne accès à des présentations normalement limitées dans d’autres pages. Il montre notamment une compatibilité décomposée en niveau, profil, style collectif et physique. Le score observé n’utilise que trois axes sur quatre et indique le manque de minutes. Cela confirme l’interface, pas la qualité de ses prévisions.

Les contrôles secondaires observés incluent exports d’images/rapports, modèles de comparaison, aide et [glossaire](https://datascout.pro/fr/glossaire), [conseils de lecture](https://datascout.pro/fr/conseils-analyse), tutoriels, langues/thème et liens vers les applications mobiles. Les téléchargements, changements de thème/langue, applications natives et synchronisation du compte n’ont pas été testés. Les modèles de comparaison personnalisés et l’export PDF sont également annoncés sur leurs pages publiques ; leur fonctionnement payant n’a pas été exécuté.

## Les ajouts à privilégier

| Priorité | Ajout à Orion | Résultat utilisateur | Données et effort |
|---|---|---|---|
| 1 | Fiche joueur-saison | Bilan total/par 90, temps de jeu, titularisations, ventilation par compétition, forme récente et accès aux matchs. | Données présentes ; agrégation et couverture à calculer. Effort moyen, socle des autres fonctions. |
| 1 | Radars et tableau de centiles | Situer le joueur parmi des pairs de même poste et sur une population visible. | Normalisation des postes, seuil de minutes et définition des cohortes d’abord. Effort moyen. |
| 1 | Comparateur joueur-saison | Deux à quatre joueurs, ou le même joueur sur deux saisons ; comparaison à la médiane. | Réutiliser les agrégats et centiles ; garder le mode actuel par match. Effort moyen. |
| 1 | Explorateur statistique | Axes X/Y et colonnes libres, filtres par poste, seuils de métriques et minutes. | Étendre nos graphiques/tableaux ; âge, pied et contrats exclus tant qu’absents. Effort moyen. |
| 1 | Listes et vues sauvegardées | Retrouver joueurs, filtres, colonnes et modèles de graphiques. | Stockage local et export/import JSON possibles, sans nouvelle base externe. Effort faible à moyen ; pas de synchronisation entre appareils à ce stade. |
| 1 | Explication au point d’usage | Définition, unité, source et couverture d’une métrique ; liens vers le glossaire. | Métadonnées de métriques à compléter. Effort faible. Présentation à la demande pour garder les pages épurées. |
| 1 | Profil club-saison | Forme, xG pour/contre, domicile/extérieur, joueurs utilisés, formations, rotation et comparaison de clubs. | Matchs, statistiques et compositions déjà présents ; vérifier l’exhaustivité avant un classement officiel. Effort moyen. |
| 1 | Profils similaires | Trouver des joueurs au style statistique proche, avec les raisons de la ressemblance. | Agrégats normalisés et modèle de distance à tester ; distinguer similarité de style et niveau. Effort moyen à élevé. |
| 2 | Forces/faiblesses explicables | Résumé fondé sur les métriques disponibles et les pairs, relié aux chiffres. | Règles déterministes possibles, sans générer d’affirmations tactiques absentes des données. Effort moyen. |
| 2 | Exports propres et liens partageables | Fiche/radar/tableau exportable, contexte et date inclus, URL qui conserve les filtres. | CSV/JSON et filtres URL existent déjà ; ajouter rendu PDF/image et contexte complet. Effort faible à moyen. |
| 2 | Classement Orion décomposable | Top 30, scores par dimension, évolution et version du calcul. | S’appuyer sur notre [méthode](METHODE_CLASSEMENT_BALLON_D_OR.md), puis calibrer et valider avant de remplir les positions. La note PitchAPI demeure une mesure distincte. |
| 3 | XI et profondeur d’effectif | Répartir les joueurs par poste, comparer titulaire/remplaçant et tester une formation. | Postes et critères de sélection fiables requis. Effort moyen ; automatisation optimale plus exigeante. |
| 3 | Découverte hebdomadaire | Mettre en avant une performance ou un profil, avec critères de sélection visibles. | Possible sans âge ; filtre « U23 » seulement après enrichissement biographique. Effort faible à moyen. |

À traiter comme des chantiers de données/modélisation séparés : biographies et blessures, suivi physique, analyse d’entraîneurs, projection prédictive entre ligues, estimation de prix et simulation de mercato. La compatibilité descriptive fait l’objet d’un prototype distinct, appuyé sur les données techniques déjà disponibles. Leur existence chez Data’Scout ne suffit pas à rendre ces calculs fiables dans Orion.

## Ce que nos fichiers permettent réellement

L’inspection actuelle couvre les **44 partitions de compétitions de 2026/2027**, soit **163 357 lignes de performances**, ainsi que toutes les tables de profils référencées dans l’index. Ces nombres comptent des apparitions/observations, pas des joueurs uniques.

| Élément | Constat dans les fichiers | Conséquence |
|---|---|---|
| Temps de jeu | 135 555 lignes avec minutes connues et positives. | Les minutes manquantes restent inconnues ; on ne les transforme pas en zéro. |
| Mesures d’attaque | xG connu sur 65 117 lignes, xA sur 59 662 ; couverture variable. | Afficher la couverture propre à chaque métrique et ne pas comparer des totaux incomplets comme des saisons complètes. |
| Postes | `positionId` et coordonnées sur 163 243 lignes ; `role` nul partout dans ces performances. | Des identifiants de placement ne sont pas encore une taxonomie de rôles comparable entre formations. Ce mapping est un préalable aux centiles par poste. |
| Profils joueurs | 37 233 observations, limitées aux identifiants, nom, nom court, numéro, position, pays et image. | Pas de naissance/âge, taille, pied, contrat, prix ou historique de blessure/transfert dans ces profils. |
| Nationalité | Un `country_code` dans les profils ; `country` des performances vient de la compétition. | Ne pas utiliser le pays de la ligue comme nationalité du joueur, ni prétendre connaître tous ses passeports. |
| Profils équipes | 1 258 observations, avec identifiant, nom et image. | Les mandats d’entraîneurs et valeurs d’effectif doivent être obtenus ailleurs. |
| Détails de matchs | Statistiques complètes, périodes, événements, tirs, compositions, avancé, réseaux et cartes d’activité conservés. | Source utile pour agrégations, formations, profils collectifs et cartes de tirs saisonnières. La couverture est à contrôler par famille. |
| Statistiques avancées | Certains agrégats de passes, conduites et valeur des actions existent dans les archives. | Les promouvoir dans l’exploration ; ne pas assimiler une distance de conduite de balle à une distance totale courue ou à du tracking physique. |

Les résultats reproductibles sont dans [data-readiness.json](../dashboard/outputs/datascout-benchmark/data-readiness.json) et [profile-field-inventory.json](../dashboard/outputs/datascout-benchmark/profile-field-inventory.json). Plusieurs saisons sont déjà référencées ; la comparabilité historique et la couverture doivent être vérifiées avant les modèles de progression ou de transfert.

## Organisation proposée

Conserver la navbar actuelle. Dans **Joueurs**, organiser la fiche autour de Vue d’ensemble, Statistiques, Évolution et Comparer ; proposer l’explorateur et les listes comme vues de cet espace. Dans **Clubs**, enrichir la fiche avec effectif, profil collectif et comparaisons. Dans **Classement joueurs**, conserver les trente positions réservées jusqu’à validation de notre calcul.

Les résultats dérivés restent dans **data/computed**, à côté des observations de **data/raw**. Le worker Bun peut produire des agrégats par joueur-saison-compétition, club-saison et cohorte après la collecte quotidienne. Le dashboard lit ces résultats versionnés ; aucune nouvelle base externe n’est nécessaire pour ces analyses. Les listes personnelles locales restent des préférences utilisateur, séparées des données football.

Les calculs de base doivent être communs aux tableaux, radars, comparateurs et classements :

- Grouper par identifiant stable, saison et compétition, puis fusionner les compétitions sélectionnées sans compter un match deux fois. Conserver les passages dans plusieurs clubs et le rôle effectivement joué.
- Pour une métrique additive, calculer le par 90 avec la somme des valeurs observées et les minutes correspondantes, après contrôle de fiabilité. Ne pas moyenner les taux par match ni ajouter les périodes All et mi-temps ensemble.
- Afficher le nombre de matchs/minutes réellement couverts. Une métrique sans observation reste absente ; un taux de réussite utilise la somme des réussites et tentatives, pas la moyenne des pourcentages.
- Définir et afficher la cohorte des centiles : saison, poste, compétitions, minimum de minutes et règle pour les joueurs polyvalents. Adapter les minima à la couverture de début de saison ; ne pas appliquer aveuglément un seuil de saison complète.
- Versionner les formules et séparer une statistique descriptive, une ressemblance de style et une estimation prédictive. La projection exige une validation sur des transitions historiques avec séparation temporelle.

UX : un contexte de comparaison clair et des vues compactes. DX : une seule définition des métriques et des calculs partagés. AX : URLs stables, filtres nommés, tableaux lisibles en complément des graphiques et provenance consultable en JSON. Le stockage local des listes favorise la simplicité mais ne fournit pas une synchronisation entre appareils.

## Points d’interface à retenir de l’audit

- Étapes 2, 3, 6 et 8 : les raccourcis, modèles par poste et tableaux associés aux graphiques rendent les analyses faciles à lancer. Réutiliser ces interactions dans notre langage visuel actuel.
- Étapes 5 et 13 : des tutoriels superposés et des navigations qui n’ont pas toujours quitté le contexte sélectionné ont compliqué le parcours. Une navigation directe ou un onglet de recherche a permis de poursuivre ; ce constat n’est pas un diagnostic de leur code.
- Étape 11 : plusieurs lignes portent le nom d’un même joueur, notamment Hakimi, sans compétition explicitée dans les colonnes visibles. Notre agrégation et nos libellés doivent rendre ces périmètres immédiatement identifiables. Le bandeau annonce aussi une démo Ligue 1 alors que des lignes multiligues étaient visibles ; l’exactitude de ces filtres n’a pas été validée.
- Étape 8 : les boutons d’affectation d’axes sont nommés simplement X et Y dans l’arbre accessible. Prévoir chez nous des noms complets et une navigation clavier claire.
- Étapes 3, 6 et 15 : garder des valeurs et un tableau textuel avec les radars, ainsi que des états explicites pour faible couverture et données manquantes. L’exemple de projection signale ses minutes limitées ; nous devons également rendre l’échantillon visible.

Ce parcours ne constitue pas un audit WCAG complet : clavier exhaustif, lecteurs d’écran, responsive, téléchargements et mathématiques propriétaires de Data’Scout n’ont pas été testés. Aucun achat, favori, vote, rapport ou scénario n’a été sauvegardé. Des captures initiales de chargement ont été rejetées et remplacées par des états chargés ; la capture du tutoriel entraîneur est conservée comme preuve de cette étape.

## Captures acceptées

Les numéros suivent le parcours. Les vues intermédiaires associées à une même fonction sont regroupées dans [le journal](../dashboard/outputs/datascout-benchmark/browser-observations.json). Ce sont des captures de la session actuelle, pas des images marketing réutilisées.

![Accueil et navigation](../dashboard/outputs/datascout-benchmark/01-home.jpg)

![Fiche joueur Data’Scout](../dashboard/outputs/datascout-benchmark/02-player-profile.jpg)

![Raccourci de comparaison à la médiane](../dashboard/outputs/datascout-benchmark/03-player-comparison.jpg)

![Comparaison au joueur médian et tableau](../dashboard/outputs/datascout-benchmark/04-comparison-radar-table.jpg)

![Profil collectif](../dashboard/outputs/datascout-benchmark/05-team-analysis.jpg)

![Tutoriel à l’entrée de l’analyse entraîneur](../dashboard/outputs/datascout-benchmark/06-coaches.jpg)

![Profil entraîneur](../dashboard/outputs/datascout-benchmark/07-coach-profile.jpg)

![Comparaison entre deux joueurs](../dashboard/outputs/datascout-benchmark/08-comparison-tool.jpg)

![Projection limitée sur la fiche standard](../dashboard/outputs/datascout-benchmark/09-projection.jpg)

![Choix des métriques](../dashboard/outputs/datascout-benchmark/10-scatter-axis-picker.jpg)

![Nuage de points et filtres](../dashboard/outputs/datascout-benchmark/11-scatter-plot.jpg)

![Classement individuel](../dashboard/outputs/datascout-benchmark/12-performance-ranking.jpg)

![Classement collectif](../dashboard/outputs/datascout-benchmark/13-team-ranking.jpg)

![Groupes de critères de recherche](../dashboard/outputs/datascout-benchmark/14-scouting-filters.jpg)

![Recherche de profils](../dashboard/outputs/datascout-benchmark/15-scouting-results.jpg)

![Espace de favoris](../dashboard/outputs/datascout-benchmark/16-favorites.jpg)

![Construction d’effectif](../dashboard/outputs/datascout-benchmark/17-team-builder.jpg)

![Simulation de mercato](../dashboard/outputs/datascout-benchmark/18-mercato.jpg)

![Découverte quotidienne](../dashboard/outputs/datascout-benchmark/19-daily-discovery.jpg)

![Profils similaires dans l’exemple public](../dashboard/outputs/datascout-benchmark/20-similar-players.jpg)

![Projection dans l’exemple public](../dashboard/outputs/datascout-benchmark/21-projection-demo.jpg)

![Détail de compatibilité et minutes limitées](../dashboard/outputs/datascout-benchmark/22-club-compatibility.jpg)

![État actuel d’Orion : performances par match](../dashboard/outputs/datascout-benchmark/23-orion-current-player.jpg)

Prochaine étape recommandée : définir le score exploratoire personnalisable et les évaluations par rôle, puis construire les agrégats communs qui les alimenteront avec les profils similaires et les comparaisons.

Nom de commit suggéré : `docs: compare DataScout features with Orion`.
