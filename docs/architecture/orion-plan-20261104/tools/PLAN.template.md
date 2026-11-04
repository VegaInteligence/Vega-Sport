# StatArena — plan de BDD et d'architecture à valider

**4 novembre 2026 — proposition, sans réorganisation du nouveau schéma sur RDS.**

L'objectif reste un StatArena complet : backend AWS, PostgreSQL sur le RDS existant, frontend Vercel, CloudFront, données détaillées, fonctionnalités préservées et gains mesurés. Cette livraison présente la structure et les étapes ; elle ne démontre pas que la migration, les collectes ou le site sont terminés.

## 1. Décision proposée et documents

La cible utilise une base applicative de référence sur le RDS existant, organisée en trois schémas :

| Schéma | Responsabilité |
|---|---|
| `ingest` | Fournisseurs, identités publiques, collecte et reprise, provenance, qualité et snapshots |
| `football` | Identités, profils, compétitions, matchs, faits typés, classements et enrichissements |
| `analytics` | Agrégats de lecture, builds, publication et préparation distincte des modèles Orion |

Le modèle rendu annonce **{{TABLES}} tables, {{COLUMNS_FR}} colonnes et {{FOREIGN_KEYS}} clés étrangères**, dont **{{ACTIVE_TABLES}} tables dans le périmètre actif**.
Les **{{BASELINE_TABLES}} tables du JSON initial** constituent une référence : aucune obligation de conserver leur nombre ou leur découpage.
Chaque responsabilité du socle doit néanmoins être conservée, fusionnée, renommée ou différée avec sa raison et sa destination, jamais disparaître silencieusement.
Les neuf tables de modèles représentent une préparation distincte ; aucune nouvelle formule Orion n'est implicitement autorisée.

| Classe de conservation | Tables | Garantie proposée |
|---|---:|---|
| Versions sélectives dans la table métier | {{SELECTED_RELATIONS}} | Valeurs et dépendances retenues, clés physiques et logiques distinctes, intervalles de génération |
| Enfants de version atomique | {{PARENT_VERSION_CHILDREN}} | Appartenance à une version complète de collection, grille ou réseau ; pas de révision individuelle |
| Observations déjà append-only | {{APPEND_ONLY}} | Nouvel instantané ou observation lors d'une correction |
| Identités stables | {{STABLE_IDENTITIES}} | Attributs historiques lus dans les profils retenus |
| Autres métadonnées, opérations et résultats | {{OTHER_TABLES}} | Contrat propre à la table ; résultats immuables par build/run après validation |

Ces classes décrivent le modèle, sans prouver son exécution. Les quatre registres universels `row_versions`, `dataset_snapshot_rows`, `field_states` et `record_row_links` sont retirés. La matrice exhaustive des champs/variantes, les contributions de plusieurs sources et le pilote typé local restent ouverts.

Le [lecteur visuel](index.html) réunit **{{DOMAIN_DIAGRAMS}} planches de domaine**, architectures, dictionnaire et correspondances.
Le [JSON cible](target-schema.proposed.json), le [dictionnaire](DICTIONNAIRE.md), le [diff du socle](blueprint-diff.json) et la [correspondance des structures actuelles](current-to-target.csv) doivent être générés et vérifiés ensemble.
Le [JSON initial](inputs/Orion_schema_bdd.original.json), l'[audit initial](inputs/GPT_Pro_audit.original.txt) et la [revue GPT Pro](inputs/GPT_Pro_review.original.txt) sont conservés comme documents de conception.
Le détail proposé des clés, FK, sélections et risques figure dans [PRO_VERSIONING_DESIGN.md](PRO_VERSIONING_DESIGN.md).

**Politique de révision : {{REVISION_POLICY_STATUS}}.** Les faits nécessaires aux calculs et leurs dépendances changeantes conservent leurs valeurs dans les tables métier concernées.
Il n'y a pas de tables sœurs `*_history`, de copies cachées renommées, ni d'engagement à versionner chaque cellule.
Les pages de plan, le JSON et les diagrammes ne doivent pas annoncer une garantie absente des clés et règles réellement décrites par le JSON rendu.
Une incohérence entre ces artefacts bloque la validation ; leur présence ne prouve pas que des contraintes SQL ont été exécutées.

Le modèle révisé change matériellement les clés, relations, lecteurs et garanties. Il doit être présenté concrètement avant réorganisation distante ; l'accord antérieur sur une proposition comportant des tables sœurs ne vaut pas approbation implicite de ce modèle.

## 2. État des lieux et portée des mesures

Les résultats suivants sont des observations datées du **4 novembre 2026, fuseau Europe/Paris**, pas un relevé permanent.
Les inventaires SQL ont été faits vers **14:42–14:47**, et le contrôle S3 complet vers **15:51–15:58**.

| Objet | Observation | Conséquence |
|---|---|---|
| RDS | Une instance Ohio `db.t4g.micro`, PostgreSQL **18.6**, volume alloué **64 Gio** | Réutiliser cette instance ; aucune montée de version ou création d'instance automatique |
| Base `statarena_prod` | Environ **13,711 Go**, 161 tables et 5 vues `statarena_app` | Cible AWS observée ; mesurer la marge réelle et les consommateurs avant transformation |
| Base `statarena` | Environ **0,594 Go**, import plus ancien | Inventorier ses utilisateurs et comparer avant toute proposition de retrait |
| Lectures métier AWS | 14 203 joueurs, 575 équipes, 3 273 matchs enrichis, 7 813 fixtures, 125 456 performances | Couverture partielle ; une performance n'est pas nécessairement une participation prouvée |
| Inventaire de sources | Neon : 313 912 objets, 421 386 ressources, 1 935 projections ; AWS : 306 110, 415 426, 1 880 | Écarts nets à rapprocher par clés et contenu, pas liste exhaustive de manques |
| Calendrier source | 66 205 fixtures, 77 compétitions et 234 couples compétition-saison dans les inventaires comparés | Les comptes égaux ne prouvent ni les valeurs ni l'égalité des lignes |
| Documents SQL | 2 814 256 `file_documents`, dont 2 195 735 lignes SQLite converties, pour 10,432 Go | Extraire et vérifier les faits avant retrait ; le volume n'est pas une économie acquise |
| S3 | 306 124 objets / 4,891 Go, dont environ 401,93 Mo d'images | Nouvelle mesure exacte des clés et versions au nettoyage, sans extrapolation |

L'inventaire, les analyses et leurs limites se trouvent dans [la couverture](evidence/COVERAGE.md) et [l'audit AWS](../../verification/aws-architecture-audit-20261104/README.md).
L'examen de formes source n'a pas prouvé chaque élément de chaque archive : la réconciliation doit encore inspecter toutes les familles, variantes et relations.

### Disponibilité : observations datées et correctif séparé

Le contrôle à **17:27:06 Paris** a observé l'accueil Vercel en 200, mais `/api/health` et `/api/dashboard/manifest` en **503** sur l'alias public.
La variable d'origine API observée était configurée pour une preview, pas pour la production ; le déploiement concerné était `b2ec973d2d4a`.
À la même observation, l'API AWS répondait 200 pour health et manifeste ; une requête dense avec limite de 100 a répondu 200 en environ **5,94 s**, après un échec 503/SQL 57014 observé précédemment sur une requête dense.
Ces observations ponctuelles ne prouvent ni la résolution générale du timeout, ni un gain, ni la complétude des données.
Ce relevé de 17:27 Paris précède le correctif AWS du lot disponibilité. L'investigation est dans [orion-availability-20261104](../../verification/orion-availability-20261104/).
Le [reçu du 4 novembre à 18:27 Paris](../../verification/orion-availability-20261104/aws-dense-release-20261104T172730943519Z.json) vérifie ensuite le déploiement du ZIP `6827c8a889c2622b84ef05f5eb088cdae8255a3d00321f553d0cb77b3cb00ddb` sur la même fonction et la même origine AWS, stack `UPDATE_COMPLETE`.
Trois GET séquentiels de 100 matchs ont répondu 200 en **4 008,62 / 3 575,56 / 3 034,98 ms**, avec la même génération, 100 matchs, 4 788 performances et un contenu identique ; HEAD 200 et conditionnel 304 ont également été vérifiés.
Ces réponses `no-store` étaient toutes des MISS CloudFront ; elles ne mesurent ni p95, ni capacité, ni élimination générale des timeouts.

**Production Vercel rétablie ensuite, le 4 novembre à 18:38 Paris**, sur le build exact `dpl_2YjDXsva7FBr4yDnzRShmZ776MbA`, commit `f65036cdb9273654614354cc083039d2a200a491`.
Les [12 parcours sur le vrai runtime Vercel](../../verification/orion-availability-20261104/vercel-browser-20261104T173656163590Z.json) ont réussi avant promotion du même build, sans reconstruction ; le [reçu de production](../../verification/orion-availability-20261104/vercel-production-readback.json) retrouve les alias canoniques sur cet identifiant, health/manifeste/archive en 200.
Le corpus sauvegardé expose **six saisons et 230 partitions référencées**, sans prétendre que chaque partition a été inspectée. Le [contrôle canonique de 18:41 Paris](../../verification/orion-availability-20261104/canonical-browser.json) réussit les deux parcours desktop et historique mobile.
Ce rétablissement utilise un **pont legacy temporaire Vercel → Neon** pour le corpus existant. La preview AWS conserve sa couverture partielle ; cette restauration n’est ni la bascule finale vers AWS, ni l’acceptation du nouveau schéma ou du pilote.
L’observation de 17:27 avec API 503 demeure historique ; son [diagramme conservé](evidence/architecture-1727-historical.svg) ne décrit plus la production rétablie.

## 3. Chemin des requêtes et des nouvelles données

![Architecture actuelle](diagrams/architecture-actuelle.svg)

![Architecture cible](diagrams/architecture-cible.svg)

1. **Vercel** sert le frontend ; les accès RDS restent côté backend. Les routes et identifiants publics existants restent compatibles.
2. **CloudFront API** relaie les requêtes vers le backend AWS et applique cache, revalidation et règles de routage observables.
3. **Lambda/backend AWS** lit les faits, dimensions et agrégats PostgreSQL ; il ne reconstruit pas les réponses depuis des fichiers ou documents.
4. **RDS** héberge tables typées, provenance, versions retenues et agrégats ; le rôle web utilise des droits de lecture bornés.
5. **CloudFront médias et S3** servent uniquement les visages, écussons, trophées et autres médias indispensables, avec leurs références et métadonnées SQL.
6. **Collecte de données** : PitchAPI → réponse décodée en mémoire → validation et normalisation → transaction RDS dans les tables typées.

Les nouvelles collectes n'écrivent aucun corps brut JSON, CSV ou archive en S3 ou dans un document SQL, même temporairement.
Les diagnostics, identifiants, empreintes et métadonnées de requête ne sont pas des corps de réponse ; ils ne servent pas à stocker un sous-arbre sportif opaque.
Les anciens fichiers déjà présents restent disponibles temporairement pour la reprise, la vérification et le retour arrière, puis sont retirés après acceptation.
Le Codex du partenaire conserve la responsabilité du transfert physique Neon → AWS : aucun second transfert concurrent n'est lancé ici.

Une erreur de parsing, un champ non mappé ou une conversion non représentable empêche l'acceptation de l'observation et produit un diagnostic sans réponse brute. Une réponse refusée peut nécessiter une nouvelle requête au fournisseur, dont la disponibilité future n'est pas garantie.
Le réseau, CORS, les variables, les domaines et l'accès RDS seront vérifiés sur le chemin réel ; aucun service payant ni changement DNS n'est supposé nécessaire.
Les accès actuellement nécessaires au transfert et aux consommateurs existants sont conservés jusqu'à leur inventaire et leur retrait autorisé.

## 4. Responsabilités et adaptation du socle

| Structure ou responsabilité | Destination proposée | Raison et conséquence |
|---|---|---|
| Fixtures, résultats et matchs aplatis | Identité de match et faits/participants typés | Unifier les statuts sans inventer une relation ou un score manquant |
| Joueurs, équipes et fédérations | Identités stables, profils observés et alias publics | Préserver les routes et les anciens attributs nécessaires aux builds |
| Performances, statistiques et tirs | Tables métier typées, versionnées au grain utile | Conserver valeurs, période, provenance, corrections et variantes retenues |
| Événements, spatial et réseaux | Collections/faits typés et parents de version lorsqu'une famille est atomique | Garder l'ordre et les observations existantes ; pas une version par cellule |
| Classements et tableaux | Snapshots et lignes typés append-only, références exactes par calcul | Préserver les contributions et distinguer observation, publication et date sportive |
| H2H | Matchs canoniques pour les rencontres résolues ; observations séparées pour les non-résolues | Éviter deux résultats divergents après correction |
| `row_versions` et sélection générique par ligne | Versions typées dans les tables concernées et snapshot de génération | Un hash ou une identité de registre ne remplace jamais les anciennes valeurs |
| États source génériques par cellule | États typés ciblés dans la famille/colonne concernée | Préserver absent, null, zéro, vide et types sans mécanisme universel obligatoire |
| Liens génériques d'observation/version | FK de provenance directes et, si nécessaire, liens ciblés propres à la famille | Conserver les contributions réellement utilisées sans magasin générique caché |
| Fichiers et anciens documents SQL | Extraction contrôlée puis suppression après réconciliation | Leur hash subsiste comme métadonnée ; il ne reconstruit pas leur contenu |
| `statarena_app`, ancienne base et `neon_auth` | Maintien transitoire puis décision par relation/consommateur | Aucun retrait fondé sur un nom ou une estimation d'inutilité |

L'inventaire [current-to-target.csv](current-to-target.csv) donne une disposition pour chaque structure actuelle recensée.
Le [diff du socle](blueprint-diff.json) doit identifier aussi les responsabilités initiales fusionnées ou différées et les conséquences sur les clés et lecteurs.
Les données et fonctionnalités d'enrichissement restent dans le périmètre : événements, mi-temps, réseaux, heatmaps, profils, stades, entraîneurs, classements, palmarès et archives.

Il reste **{{JSONB_COUNT}} emplacements JSONB** dans le catalogue rendu ; chaque exception et sa borne doivent être visibles dans le dictionnaire.
Ils sont réservés aux configurations, diagnostics, codes de qualité et éventuelles réserves de modèles explicitement bornés, jamais aux corps source ou aux faits sportifs courants.
La matrice de couverture doit identifier chaque champ observé, son type, sa destination et son état ; un champ utile non représenté bloque sa purge.

## 5. Versions, snapshots et dépendances

Une identité de joueur, équipe ou fédération reste stable ; ses profils et les faits corrigibles conservent les anciennes valeurs typées dans la même table métier ou dans une table d'observations déjà prévue pour ce domaine.
Les sources concurrentes et les historiques déjà présents ne sont pas perdus lors de la sélection canonique.
Les profils, positions, périodes, métriques, mappings, classements et autres dimensions sont retenus lorsqu'ils influencent le calcul ou une représentation figée.
La liste exacte des tables, clés primaires, unicités, FK et choix de granularité est décrite dans [PRO_VERSIONING_DESIGN.md](PRO_VERSIONING_DESIGN.md) et doit correspondre au JSON livré.

Une génération transactionnelle sélectionne les versions visibles ; un snapshot scellé identifie cette génération et ses contrats.
Un verrou de génération couvre allocation et commit pour éviter deux publications hors ordre ; les valeurs anciennes ne sont pas réécrites.
Les FK visent des versions typées exactes ; un contrôle différé vérifie que les parents sélectionnés appartiennent au même match, à la bonne équipe et au bon joueur.
Une ancre physique ne prouve pas à elle seule la sélection du parent au même instantané ; ce contrôle de sélection et d'appartenance reste à implémenter et à exercer dans PostgreSQL.
Les versions d'une heatmap ou d'un réseau sont portées par le parent ; cellules, nœuds et arêtes héritent de son identité immuable.
Une collection vide est distincte d'une source absente, indisponible ou d'une réponse partielle ; seul un retrait prouvé crée une suppression ou un tombstone.
Un réimport identique ne crée pas de correction ni de publication superflue ; les tentatives de collecte restent traçables.
Une correction de parseur ou de mapping sur le même record source crée aussi une nouvelle observation typée : `standing_snapshots` conserve une UQ de contexte incluant `data_revision`, et `match_observation_details` utilise `(source_record_id, recorded_from_gen)` comme PK. Les révisions internes des tableaux et rankings progressent avec les générations ; la sélection à `g` conserve la dernière normalisation connue à `g`, sous contrôle de scellement à vérifier au pilote. Les anciens instantanés et enfants restent immuables. La provenance des enfants H2H est liée au fournisseur de leur parent par une FK source/record composite.

**Exemple proposé, à tester :** à la génération 41, un joueur a `xG = 0,82` ; un build utilise ce snapshot.
Une correction insérée à la génération 58 porte `xG = 0,67`, sans effacer la première valeur.
La lecture courante du nouveau build retourne 0,67 ; un recalcul du build 41 doit relire 0,82 et les dépendances de 41.
Ce résultat reste une exigence, pas une preuve : le pilote doit démontrer la conservation, les contraintes et le calcul de bout en bout.

Un résultat reproductible exige également le périmètre, la cohorte complète, les minutes et couvertures, seuils, paramètres, code et règles numériques réellement utilisés.
Le scouting existant calcule notamment des centiles sur des pairs : garder seulement la ligne du joueur ne suffit pas.
Le texte d'un hash ne rétablit ni une réponse supprimée ni un environnement de calcul ; un état local du navigateur non enregistré n'est pas automatiquement reproductible.
Les décimales source doivent être converties sans perte silencieuse avant toute coercition JavaScript ; les types retenus et leur compatibilité avec les calculs existants seront testés.
L'ordre des agrégations flottantes, les dépendances, les versions du runtime et les paramètres doivent être figés pour revendiquer une reproduction exacte.

Une date de saison ou de classement n'établit pas sa disponibilité à une date passée. Dates d'effet, publication, récupération et connaissance par le système restent distinctes ; une disponibilité inconnue impose un calcul incomplet ou rétrospectif clairement identifié.

**Compromis UX / DX / AX :** des vues courantes simplifient les lectures et rendent l'état inspectable, mais les clés et contrôles de cohérence deviennent plus exigeants.
Le verrou global rend l'ordre de publication explicite pour les agents et les développeurs, au prix possible d'une contention à mesurer.
La fidélité des valeurs et des états source améliore les résultats et la compatibilité, au prix de colonnes et validations supplémentaires ; aucune amélioration universelle n'est présumée.

## 6. Corrections précises issues de la revue Pro

Ces points sont des exigences du modèle rendu et du pilote, pas des tests déjà réussis.

| Point | Décision à porter dans les contraintes et les lecteurs |
|---|---|
| A — réponses HTTP | Dédupliquer par corpus, empreinte de requête canonique et hash de contenu ; pour HTTP l'empreinte est obligatoire, tandis que les tentatives restent distinctes dans `resource_fetches` |
| B — profils des tirs | Si un profil joueur ou gardien est renseigné, exiger l'identité correspondante et vérifier la FK composite ; une identité sans profil reste permise |
| C — contrats | Versionner explicitement les contrats de relation et leurs champs : `(relation_code, contract_version)` et références de champs cohérentes |
| D — liaison des versions | Ne pas accepter un `row_version_id` générique comme preuve d'appartenance ; les versions/faits et leurs FK sont liés au bon grain, puis contrôlés au scellement |
| E — états des champs | Empêcher les combinaisons contradictoires entre état et valeur scalaire ; porter les distinctions nécessaires de manière ciblée et vérifiable |
| F — bootstrap | Initialiser les périodes et positions, leurs versions et leur provenance avant les lignes qui les référencent ; les anciennes graines seules ne suffisent pas |
| G — heatmaps et file | Unicité des coordonnées dans **une version de grille**, bornes contrôlées sur le parent ; états, tentatives, baux, acquisition atomique et index de la file explicitement définis |

Les index uniques partiels du courant ne constituent pas à eux seuls une cible de FK ni une preuve d'absence de chevauchements historiques.
Les règles intertables exigent des contraintes adaptées, des verrous et contrôles différés, puis des tentatives de violation dans un vrai PostgreSQL.
L'inventaire des cas à exercer figure dans [le protocole de contraintes](tools/PRO_CONSTRAINT_PROTOCOL.md). Ses recommandations C/D fondées sur le registre universel sont remplacées par [la conception des versions](PRO_VERSIONING_DESIGN.md) ; le contrôle E doit être traduit sur les états ciblés retenus.

## 7. Lectures, publication et cache

Les vues courantes servent les usages internes ; les réponses publiques résolvent d'abord le build publié puis lisent les faits et dimensions de son snapshot.
Un build figé conserve l'identifiant du snapshot de données, celui du catalogue ou de ses dépendances, et la version de représentation réellement utilisée.
Une URL multi-éditions fige aussi la sélection des builds de toutes les éditions concernées : elle ne relit pas des pointeurs actuels.
Les URL immuables ne seront annoncées qu'après preuve de l'accessibilité durable de leurs valeurs, dépendances et médias.

| Route ou objet | Fraîcheur proposée | Condition |
|---|---|---|
| Health, erreurs temporaires, configuration | `no-store` | Ne pas masquer un défaut de disponibilité |
| Manifeste et calendrier mutable | TTL court à mesurer, proposé 30–60 s | Version et invalidation cohérentes jusqu'au navigateur |
| Résumé mutable d'un match terminé | Maximum proposé 300 s, selon usage | Une correction produit un nouveau build ou une invalidation adaptée |
| URL explicitement figée par build/snapshot | Cache long possible | Toutes les valeurs et dimensions de la réponse sont réellement immuables |
| Média adressé par hash | Cache long possible | Nouveau contenu = nouvelle clé ; média nécessaire conservé |

La politique CloudFront API observée limitait `MaxTTL` à 60 s : un en-tête Lambda ne suffit pas à obtenir un cache plus long.
HEAD et 304 doivent consulter les métadonnées avant les lectures lourdes ; pagination et curseurs gardent une version et un ordre total stables.
Une correction d'une dimension partagée doit invalider les éditions concernées, y compris celles liées avant ou après la correction ; une édition indépendante ne doit pas être invalidée inutilement.
Si les dépendances d'une réponse ne peuvent pas être déterminées, invalider de manière conservatrice et ne pas promettre une isolation fine non prouvée.
Les listes utilisent des agrégats ciblés, pagination et chargement séparé des familles lourdes ; le cache mémoire reste borné.

## 8. Ordre d'exécution après validation du modèle révisé

| Lot | Travail | Porte de sortie |
|---|---|---|
| P0 — contrat | Figer plan, JSON, diagrammes, responsabilités et accès nécessaires | Présentation et validation explicite du nouveau modèle ; pas de réorganisation distante avant cette étape |
| P1 — pilote | Migrations neuves, base locale jetable puis périmètre approuvé d'une compétition et deux saisons | Cas difficiles, contraintes, reprise et performance mesurés ; aucune suppression anticipée |
| P2 — normalisation représentative | Transformer par lots un jeu de données déjà sur AWS en faits et variantes typés | Reçus, checkpoints, rejets, rapprochement et stabilisation du schéma |
| P3A — backend | Dès stabilisation du schéma, adapter API, agrégats, cache et parcours sur des jeux représentatifs | Contrats, identifiants, états et lectures SQL vérifiés |
| P3B — données | En parallèle de P3A, normaliser le reste et rapprocher Neon, AWS, faits finaux et médias avec le propriétaire du transfert | Manques, différences et non-vérifiés nommés ; aucune migration physique concurrente |
| P4 — acceptation commune | Tester collectes, publication et site complet Vercel → CloudFront → AWS → RDS | Backend et données acceptés ensemble sur la même génération |
| P5 — bascule/nettoyage | Basculer puis retirer les anciennes dépendances et sources devenues inutiles | Inventaire, accord des dépendants, réconciliation complète et preuve de non-dépendance |

Les migrations 003–011 déjà scellées ne sont pas réécrites ; une nouvelle migration porte chaque changement approuvé.
L'ancien prototype local interrompu est archivé dans [superseded-prototype](../../verification/orion-schema-pilot-20261104/superseded-prototype/) ; il ne constitue ni une migration RDS ni une acceptation du nouveau modèle.
Les workflows de collecte, enrichissement, construction/publication et contrôle sont regroupés par fonction, sans doublons ; les variantes quotidienne et historique partagent les règles de reprise.
Une seule acquisition d'un travail utilise un bail avec propriétaire et expiration ; checkpoints, transactions bornées et idempotence permettent le redémarrage sans doublon. Un bail perdu ne peut pas publier ; les échecs, indisponibilités et nouvelles tentatives restent distingués.
Les anciens workflows observés désactivés ne sont pas relancés simplement parce que le plan existe : vérifier leur adaptation, leurs baux, leurs permissions et leur déclenchement réel.

Avant et pendant le pilote, contrôler l'espace libre RDS réel (`FreeStorageSpace`), le volume alloué de 64 Gio, toutes les bases, les index, WAL et la croissance temporaire.
Le garde existant de 52 Go est un premier repère, pas une preuve que l'espace libre suffit ; arrêter le traitement avant saturation si la marge mesurée est insuffisante. Aucun agrandissement, changement de classe ou suppression anticipée de sources n'est automatique.

## 9. Vérifications et mesures d'acceptation

Documenter les modes d'échec et résultats attendus **avant le code** ; privilégier des E2E sur les parcours complets.
Chaque E2E conserve configuration et entrées, commande exacte, résultats attendus et observés, ainsi que les logs, traces ou captures nécessaires à sa reproduction.
Les valeurs `passed` d'un JSON de conception, un workflow activé ou un contrôle de santé ne remplacent pas ces preuves.

| Parcours ou cas | Vérifications minimales |
|---|---|
| Matchs | Pagination, requêtes regroupées, volume retourné, résumés légers et familles lourdes séparées |
| Joueur et club | Agrégats bornés, cohortes complètes, appartenance/position, classements et absence de requêtes répétées par métrique |
| Compétitions, saisons et classements | Identités publiques, dates et granularité ; tableaux et contributions correspondant au snapshot |
| Correction | 0,82 → 0,67, recalcul de l'ancien snapshot, nouvelle publication et propagation des caches |
| Réimport / reprise | Aucun doublon ni publication inutile, interruption, bail expiré et deux écrivains concurrents |
| Contraintes | Mauvais parent, mauvais profil, versions incompatibles, doublons/limites de grille et suppression non réconciliée rejetés |
| États et couverture | Absent, null, zéro, chaîne vide, liste vide, variante et donnée indisponible restent distincts |
| Dépendance partagée | Scénario A/B/C : correction liée invalide A ; changement indépendant C préserve le build, ETag et curseur A |
| Site et services | Desktop/mobile, routes existantes, Vercel → CloudFront → backend → RDS et mises à jour de bout en bout |

Comparer avant/après sur le même corpus, la même génération et les mêmes contrats : latence HTTP/SQL, nombre de requêtes, volumes lus/transmis, hit/miss/304, stockage et coût de calcul lorsque mesurable.
Séparer froid et chaud, répéter sous une charge décrite et conserver les échecs ; aucun p95 ni gain ne découle d'un appel isolé.
Le pilote mesuré précède la migration complète et le nettoyage ; l'adaptation backend peut ensuite progresser parallèlement au contrôle des données.

## 10. Retour arrière et nettoyage final

Avant purge, les anciens lecteurs et sources restent disponibles ; un lot interrompu ne déplace pas les pointeurs publiés et reprend au dernier checkpoint accepté.
À la bascule, conserver les versions de code et les pointeurs précédents tant que leurs dépendances existent.
Après purge, le retour arrière est limité aux versions SQL, médias et codes compatibles conservés : les anciens lecteurs dépendant des fichiers ne sont plus restaurables fonctionnellement.

Le nettoyage attend la représentation complète de chaque champ et variante utile, la réconciliation par clés et contenu, les médias, l'acceptation conjointe et la fin des dépendances du transfert du partenaire.
Supprimer alors les sources structurées et leurs copies devenues inutiles dans RDS et S3 : JSON, CSV, archives, dumps et documents stockés en base.
Ne pas déplacer ces copies dans une autre table ou un autre emplacement pour les conserver indéfiniment.
Les médias indispensables restent sous forme de fichier, avec type, références, justification et métadonnées appropriés.
Les hashes et métadonnées de provenance conservés ne permettent pas de recréer les octets supprimés ou de rejouer arbitrairement un parseur sur l'ancien corps.

Fournir l'inventaire exact des suppressions, les médias conservés, l'espace récupéré mesuré séparément dans RDS et S3 et la vérification des parcours après purge.
La libération d'espace dans PostgreSQL ou S3 ne réduit pas nécessairement la capacité RDS provisionnée ni la facture.
Identifier aussi les snapshots, sauvegardes et versions d'objet ; distinguer suppression active et expiration effective des copies encore retenues.

Chaque lot terminé donne son état, les preuves reproductibles, les écarts et limites, ainsi qu'un commit et push sur `main` selon les instructions du projet. Le nettoyage et la bascule finale restent conditionnés à l'acceptation conjointe des données et du backend, et ne découlent pas de ce document.

Commit suggéré : `docs: align the Orion schema plan with the Pro review`.
