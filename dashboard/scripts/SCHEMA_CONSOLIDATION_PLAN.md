# Plan de consolidation progressive du schéma

## Statut exact

### Implémentation du 7 novembre 2026

Le plan ci-dessous conserve le diagnostic et les candidats de l'audit initial.
L'implémentation concrète est désormais décrite dans
[`DB_REFACTOR_OPERATIONS.md`](DB_REFACTOR_OPERATIONS.md) et dans le manifeste exact
[`consolidation-manifest.json`](consolidation-manifest.json). La migration 023
déplace réellement **112 tables physiques du modèle de publication vers trois
stockages de nœuds contraints et indexés**, avec backfill reprenable, comparaison
exhaustive, publication adaptée et retour arrière incluant les écritures nouvelles.
La cible physique active de `statarena_app` est **54 tables avec l'agrégat de
navigation justifié de la migration 025**, contre 161 dans l'inventaire initial.
Les tables de retour arrière, les sources, l'authentification et l'historique Pro
sont comptabilisés séparément ; leur conservation n'est pas présentée comme une
économie de stockage déjà réalisée. Les preuves de déploiement natif sont produites
par le déploiement, pas déduites de la seule présence des fichiers de migration.

### État de l'audit initial avant les migrations 023–025

L’inventaire de référence est celui du 6 novembre 2026 à 20:55:10 UTC,
artifact GitHub `13539309460`, run `42292333608`, transaction
`READ ONLY REPEATABLE READ`. Il contient **347 relations : 295 tables et 52 vues**.
Les 295 tables comprennent **286 tables applicatives et 9 tables d’authentification**.
Les neuf tables d’authentification restent hors regroupement métier, quel que soit
leur ancien nom de schéma. Les estimations de lignes ne prouvent ni vacuité ni
absence d’usage.

Les **40 relations applicatives cibles sont une proposition conditionnelle**.
La première livraison ne réduisait pas physiquement 295 tables à 40 et ne promettait pas une économie
de stockage correspondant à la taille des objets existants. La migration 021
ajoute une vue et des fonctions ; la migration 022 ajoute des colonnes à une file.
Aucune table métier existante n'était retirée dans cette première livraison. Le registre complet antérieur
`schema-classification.json/csv` contient 347 mappings, leurs contraintes,
incertitudes et preuves ; les deux vues de métriques joueur/mi-temps y ciblent
bien `football.player_match_stats` avec conservation période/états/totaux/ordre.

Les noms `football.*`, `ingest.*`, `analytics.*` ci-dessous désignent des contrats
logiques cibles. Certains noms existent déjà dans le modèle Pro, dont l’API
publique reste désactivée (`STATARENA_PRO_API=0` dans l’audit). L’identité de nom
ne démontre pas une équivalence de contrat : aucune activation globale, aucun
remplacement de ces tables et aucune recopie automatique n’est proposé.

## Tous les groupes cibles

Le nombre de relations sources est un nombre de références candidates, vues
incluses. Une source peut contribuer à plusieurs contrats : **les nombres ne
s’additionnent pas**. Les sources sans référence statique directe restent
conservées jusqu’à examen des fonctions SQL, dépendances et consommateurs réels.

| Contrat candidat | Grain à conserver | Relations sources candidates |
|---|---|---:|
| `ingest.sources` | Une source/dataset | 2 |
| `ingest.runs` | Une exécution d’import | 18 |
| `ingest.source_documents` | Un document source/version | 23 |
| `ingest.source_records` | Un enregistrement source | 37 |
| `ingest.jobs` | Une tâche active/dédupliquée | 20 |
| `ingest.quality_issues` | Une anomalie/candidat | 14 |
| `ingest.media_assets` | Un média | 3 |
| `ingest.schema_migrations` | Une migration appliquée | 2 |
| `ingest.fetches` | Une tentative de collecte | 3 |
| `football.competitions` | Une compétition | 6 |
| `football.competition_editions` | Une édition de compétition | 25 |
| `football.competition_sections` | Une phase/groupe | 16 |
| `football.teams` | Une équipe | 4 |
| `football.players` | Une personne sportive | 4 |
| `football.associations` | Une fédération | 1 |
| `football.venues` | Un stade | 4 |
| `football.coaches` | Un entraîneur | 3 |
| `football.memberships` | Une appartenance joueur OU entraîneur à une équipe | 4 |
| `football.edition_teams` | Une inscription équipe-édition | 3 |
| `football.matches` | Une rencontre | 37 |
| `football.match_teams` | Une équipe/côté de match | 44 |
| `football.match_players` | Un joueur inscrit à un match | 16 |
| `football.player_match_stats` | Un joueur-match-période-variante-révision | 29 |
| `football.team_match_stats` | Une équipe-match-période-variante-révision | 20 |
| `football.shots` | Un tir | 8 |
| `football.match_events` | Un événement de match | 8 |
| `football.coverage` | Une disponibilité par match/famille/source | 45 |
| `football.standings` | Une ligne de classement officiel/snapshot | 8 |
| `football.rankings` | Une entrée de classement/snapshot | 18 |
| `football.honours` | Une récompense attribuée | 11 |
| `football.match_visuals` | Une collection de détail par match/famille/sujet/période | 22 |
| `football.external_ids` | Une correspondance fournisseur/publique/alias | 23 |
| `football.entity_profiles` | Une observation de profil | 15 |
| `football.reference_definitions` | Une définition/mapping versionné | 40 |
| `analytics.publication_builds` | Un build validé et ses entrées | 20 |
| `analytics.published_scopes` | Un pointeur par périmètre/version publiée | 20 |
| `analytics.match_cards` | Une carte match par build | 1 |
| `analytics.player_season_stats` | Un agrégat joueur ou joueur-équipe par édition/build | 3 |
| `analytics.team_season_stats` | Un agrégat équipe par édition/build | 2 |
| `analytics.widget_snapshots` | Un résultat widget/période/périmètre | 0 |

`analytics.widget_snapshots` n’a aucune source physique équivalente identifiée.
Ce stockage n’est nécessaire que si le calcul de widgets est assez coûteux pour
justifier une matérialisation ; un calcul borné et mis en cache avec clé période,
version source et expiration peut remplir le besoin sans table supplémentaire.

## Ordre de réalisation et critères par famille

### 1. Publication et compositions — code réalisé, déploiement à valider

Le writer public écrit désormais les matchs modifiés par lots bornés, garde les
faits inchangés et partage une transaction avec les receipts et la génération.
La reprise 022 empêche une mauvaise partition de bloquer les suivantes. Ces
changements sont indépendants d’une refonte physique de la BDD.

La façade 021 réunit les quatre listes home/away × titulaire/remplaçant dans un
contrat `lineup_members`. Elle possède un usage public concret via la fonction
`detail_data_lineups`, une comparaison exhaustive et une bascule réversible.
Son étape physique ultérieure serait une table membres unique avec discriminants
`side` et `role`, FK de provenance et contraintes de position. Le volume de
référence des quatre tables est estimé à 389 483 lignes et 81 559 552 octets.
Le bénéfice doit être vérifié avant copie : cette famille n’est pas à elle seule
une solution aux 18 Go de relations de l’inventaire.

**Additif possible ensuite :** créer cette table seulement après accord sur le
contrat, recopier par `resource_id` dans des lots reprenables, conserver la clé
source et le digest, comparer chaque réponse native et chaque membre, puis
assurer les deux écritures dans la même transaction de publication. Basculer la
fonction sur la nouvelle table seulement après parité et mesures. Cette copie
n’est pas incluse dans le présent lot, afin d’éviter un double stockage sans
activation ni validation.

**Validation destructive distincte :** arrêt des anciens writers, preuve qu’aucun
consommateur ne dépend des quatre tables, période de rollback, sauvegarde
restaurée avec succès, puis retrait explicite. Ne pas multiplier des façades
analogues avant d’avoir terminé ce premier cycle et mesuré son utilité.

### 2. Identités, éditions et profils

Couvre compétitions, éditions, sections, équipes, joueurs, fédérations, stades,
entraîneurs, inscriptions, appartenances, identifiants externes et profils.
Réunir d’abord les mappings de fournisseurs dans un registre avec clés uniques
`(source, type, external_id, validité)` et des FK typées. Séparer l’identité
canonique de ses observations de nom/image/profil ; un nom n’est pas une clé.

**Additif :** établir une correspondance versionnée des IDs actuels et candidats,
conserver tous les alias publics, tester les liens joueur/équipe/compétition et
les saisons calendaires ou décalées, puis faire lire un seul parcours public.
Les carrières joueur/entraîneur conservent dates, précision et preuves ; une
absence de date ne doit pas devenir une date inventée. Éviter un couple libre
`entity_type/entity_id` dépourvu de FK sous prétexte de supprimer des tables.

**Parité :** aucun ID orphelin, aucune fusion d’homonymes, conservation des anciennes
URLs et de toutes les éditions sources. Les profils historiques ne doivent pas
être écrasés par l’image courante. **Retrait :** uniquement après migration de tous
les lecteurs/writers et validation explicite des tables ou index visés.

### 3. Matchs, équipes et joueurs inscrits

Couvre `matches`, `match_teams`, `match_players` et le rapprochement des fixtures,
résumés, compositions et apparitions publiques. Distinguer une fixture attendue,
une participation inscrite et une participation effectivement jouée. Une ligne
à zéro minute n’est pas nécessairement inutile. Conserver heure connue/inconnue,
état, saison source, saison affichée, côté, tirs au but et provenance.

**Additif :** cartographie stable des IDs et des scopes, comparaison des réponses
publiques de listes et de détails, activation progressive par compétition/saison.
La publication incrémentale livrée réduit déjà les écritures dans le schéma
actuel ; une nouvelle copie intégrale n’est pas requise pour ce gain.
**Retrait :** jamais pendant une reconstruction partielle ; maintenir les anciens
scopes jusqu’à publication atomique complète et possibilité de retour arrière.

### 4. Métriques joueur/équipe et définitions

Les regroupements proposés pour `player_match_stats`, `team_match_stats` et
`reference_definitions` doivent préserver joueur/équipe, match, période, variante,
révision, groupe, ordinal, valeur, total, précision, unité et état natif. Les vues
`half_stat_metrics` et `player_stat_metrics` ne sont pas des définitions : elles
reconstruisent des valeurs. Leur suppression ne peut pas être remplacée par un
simple dictionnaire de noms.

**Additif :** contrat de projection stable sur un échantillon représentatif, puis
comparaison exhaustive des sorties reconstruites ; choisir des colonnes typées
pour les métriques réellement exploitées et un supplément borné pour les valeurs
rares si le contrat le justifie. Ne pas convertir systématiquement null en zéro,
ni absent en null, ni texte numérique en nombre. Le rapport estimait 478 547
lignes de valeurs Pro pour 15 437 lignes de statistiques : c’est une piste de
simplification de représentation, pas une autorisation d’effacer le modèle Pro.
**Retrait :** prouver parité des vues, totaux, filtres et statistiques avancées
partiellement couvertes avant toute suppression de tables/cellules.

### 5. Tirs, événements et couvertures

Réunir les projections d’un même tir ou événement seulement si leurs identités
source et leur granularité concordent. Garder période, temps ajouté, ordre,
acteurs, gardien, buts contre son camp, coordonnées et valeurs exactes. Une
couverture réussie vide diffère d’une famille non collectée ou en erreur.

**Additif :** mapping par identifiant source + variante avec liens de provenance,
comparison complète des chronologies et tirs, couvertures séparant attendu,
collecté, observé et date source. La date de publication n’est pas la date de
collecte. **Retrait :** après replay des sources et comparaison des variantes,
jamais en dédupliquant uniquement sur minute/joueur ou coordonnées.

### 6. Classements officiels, rankings et palmarès

Les cibles `standings`, `rankings`, `honours` regroupent leurs familles de détails
sans confondre méthodes, dates, snapshots, compétitions, phases, sanctions,
composantes saisonnières, fédérations et équipes. Les palmarès conservent la
source, les éditions et les regroupements d’affichage lorsque ceux-ci ont un
sens distinct de l’événement sportif.

**Additif :** normaliser une famille après l’autre avec source immuable, garder
les anciens nombres décimaux et les états, comparer le JSON public et les rangs
à chaque date. Un classement calculé n’écrase pas un classement officiel.
**Retrait :** seulement après validation des doubles sources, lectures publiques,
contrats historiques et règles d’ordre, sans réveiller les collecteurs désactivés
qui ont été remplacés par la collecte consolidée.

### 7. Détails visuels : heatmaps, réseaux, momentum, h2h

`match_visuals` est conditionnel. Les collections consultées comme un document
borné peuvent être stockées sous un contrat JSONB validé par famille, avec
coordonnées, référentiel, période, sujet, paramètres, ordre et provenance. Les
éléments nécessitant agrégation SQL ou jointures gardent une structure adaptée.
Ce n’est pas une invitation à mettre toutes les statistiques dans un blob JSON.

**Additif :** mesurer les lectures réelles, définir limites de taille et schéma,
rejouer les payloads natifs et comparer exactement avant toute écriture miroir.
**Retrait :** après tests des paramètres alternatifs et confirmation que les
requêtes analytiques ne perdent ni indexabilité ni précision.

### 8. Ingestion, archives, fichiers et médias

Couvre sources, runs, documents, records, jobs, fetches, anomalies, médias et
migrations. Les 27 tables `statarena` restent des sources actives du writer.
`file_documents` seul représente environ 10,525 Go dans l’inventaire : ce volume
ne justifie aucune suppression. Distinguer une observation source, un contenu
immuable, un catalogue d’objets, une tentative de collecte et un résultat publié.

**Additif :** dédupliquer les futurs contenus par hash sans perdre leurs multiples
observations, externaliser uniquement les corps source dont la récupération et
l’intégrité sont vérifiables, conserver localisateurs/requêtes/horodatages et un
replay indépendant. Pour les jobs, unifier priorités, leases et retries après
avoir démontré l’équivalence des règles de collecte et de publication ; ne pas
réutiliser une seule file avec des contraintes vagues. 022 améliore la file
existante sans la migrer.

**Retrait :** preuve de restauration/replay, conservation des lignées mult sources,
absence de références actives, politique de rétention validée, export vérifié
et accord explicite sur chaque famille. Les tables `neon_*_delta` ne sont pas
inutiles parce que leur nom évoque une ancienne infrastructure : vérifier leur
rôle de journal/reconciliation avant toute décision.

### 9. Builds, scopes publiés, agrégats et widgets

Conserver un build identifié par code/contrat/entrées, validé avant publication,
et un pointeur de scope atomique. Les cartes match et agrégats joueur/équipe sont
des accélérateurs conditionnels de lectures mesurées ; ils ne remplacent pas les
faits ni les sources. Les widgets ont période UTC ou timezone explicite,
version source, calcul, expiration et couverture. Une donnée source ancienne
reste ancienne même après recalcul.

**Additif :** préparer uniquement les agrégats demandés par les routes actives,
contrôler leur parité avec un calcul direct, publier par version, et utiliser le
même identifiant de version dans les clés de cache. Les états de traitement et
receipts doivent rester lisibles pendant toute bascule. **Retrait :** après preuve
des caches invalidés, rollback de version et consommateurs migrés, avec accord
explicite ; aucune file/backlog n’est vidée pour afficher un état « terminé ».

## Recette exacte pour 021 et 022

Les commandes suivantes sont préparées pour le contexte GitHub AWS vérifié du
worker, avec `DATABASE_URL` fourni par l’action de credentials. Elles n’ont pas
été exécutées sur production par ce lot. `--install-only` vérifie les migrations
scellées déjà appliquées, puis installe les nouvelles migrations atomiquement.
Ne pas l’exécuter aveuglément sur une ancienne base vierge : l’installateur
historique contient des migrations antérieures, à examiner si leur digest n’est
pas encore enregistré.

1. Sur base isolée ou restore récent : exécuter les quatre scripts SQL décrits
   dans `PUBLICATION_REFACTOR.md`, tester le rôle runtime et le transport COPY
   natif, mesurer plans et temps sur un scope représentatif.
2. Sur l’environnement autorisé : vérifier sauvegarde/restauration et versions
   appliquées, puis `python dashboard/scripts/relational_materialize.py --install-only`.
   Contrôler `worker_schema` pour `021_lineup_read_contract.sql` et
   `022_publication_retries.sql`. Aucune publication de données ni bascule du
   reader lineups n’a lieu avec cette commande.
3. Exécuter `python dashboard/scripts/lineup_consolidation.py --batch 128`.
   Exiger `complete=true`, aucune différence, un nombre de ressources concordant,
   SELECT du rôle runtime sur la nouvelle vue et EXECUTE sur les fonctions.
4. Exécuter `python dashboard/scripts/lineup_consolidation.py --activate --batch 128`.
   La comparaison est répétée sous lease dans la transaction de bascule ; un échec
   annule la bascule et la génération ensemble. Vérifier ensuite des réponses
   publiques, leurs caches et les temps observés.
5. Retour du reader : `python dashboard/scripts/lineup_consolidation.py --rollback`.
   Retour du writer : définir `STATARENA_INCREMENTAL_CORE=0` dans le processus de
   publication autorisé puis relancer le même scope ; la file reprend ses
   entrées sans les effacer. Conserver les colonnes 022 et les objets 021 en place
   lors du rollback : les anciens readers/writers tolèrent ces objets additifs.

Le workflow manuel expose ces actions via `schema_only=true` et `lineup_reader`
(`unchanged`, `verify`, `unified`, `legacy`). Il reste désactivé tant que son
activation n’est pas explicitement décidée ; la préparation du fichier ne change
pas son état GitHub. Le workflow de collecte actif installera également les
migrations scellées lorsque ce code sera effectivement publié et exécuté.

Pour 022, une relance normale conserve les retries. Une nouvelle source remet le
job en éligibilité. `--all` est un requeue explicite de tous les scopes, pas un
outil de nettoyage ; il réinitialise l’attente mais ne supprime aucun job/source.
Aucune commande de suppression de colonne, table ou backlog n’est nécessaire au
rollback. Toutes ces phases sont distinctes d’une future validation destructive.
