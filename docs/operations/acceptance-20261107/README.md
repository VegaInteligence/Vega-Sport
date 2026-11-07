# Recette du plan « Audit et plan de refonte » — 7 novembre 2026

## Verdict à cette étape

Les corrections de lecture, de fraîcheur et de publication, la consolidation du modèle applicatif et le retrait physique des structures remplacées disposent de preuves de production. Les six cohortes API mesurées depuis AWS Paris atteignent les cibles de p95 proposées, et le nettoyage des ressources temporaires est confirmé. **La recette complète ne peut pas être déclarée à 100 % : les quatre retours réellement en mémoire après PR45 prennent 245,4 ms, 128,8 ms, 245,9 ms et 230,7 ms, au-dessus de la cible de 100 ms. Le taux naturel de cache par route n'est pas observable avec les journaux actuellement désactivés.** Une implémentation terminée ne vaut pas une cible de performance mesurée.

Ce dossier rapproche le plan du 6 novembre des preuves effectivement conservées. Son [empreinte et ses critères de référence](plan-reference.json) permettent d'identifier le document initial. Les chiffres ci-dessous sont des observations datées ; ils ne sont pas des compteurs permanents. Les documents antérieurs restent utiles pour les étapes réversibles, mais leurs inventaires de 56 tables applicatives, 302 tables physiques ou 112 tables retenues ne décrivent plus l'état final.

La livraison backend utilisée pour les mesures France est [PR #40](https://github.com/VegaInteligence/Vega-Sport/pull/40), commit `a3b5c304bbd9481f1c97c3ac2b04a9758ccc4b91` : [CI de PR 42407285635](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42407285635) puis [CI main 42407893041](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42407893041) réussies, frontend READY sur ce même commit, backend UPDATE_COMPLETE / Active / Successful. Le [reçu de livraison](release-pr40.json) conserve les identités et hashes de l'artefact. Le [contrôle de production à 19:55:07 UTC](production-runtime-final.json) passe ses **15 vérifications : 14 réponses 200 et une validation 304**, avec les sept capacités compactes annoncées exercées. La livraison frontend suivante, [PR41](https://github.com/VegaInteligence/Vega-Sport/pull/41), est également **READY en production**, commit `cd34a83d55d2b09e022781df1ca514326c3691bc`, après [CI 42410152701 réussie](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42410152701). Son [reçu](release-pr41.json) confirme que l'artefact backend reste inchangé. Les premiers retours navigateur après cette livraison sont conservés séparément et dépassent encore la cible des 100 ms.

## État concret livré

| Indicateur | Observation vérifiée | Portée |
| --- | --- | --- |
| Modèle applicatif actif | **58 tables physiques** dans `statarena_app` | Les vues de compatibilité ne sont pas comptées comme des tables physiques. |
| Base entière | **192 tables physiques**, dont **134 hors application** | Le retrait fait passer l'inventaire de 304 à 192. |
| Objets retirés | **112 anciennes tables et 62 anciennes fonctions** | Retrait atomique contrôlé ; contrats actifs et droits conservés. |
| Publication | **Génération 923** ; publication enregistrée à **19:18:03 UTC** | Ce compteur change à chaque lot modifié validé ; ce n'est pas une date de collecte. |
| Travaux restants | **33 373 = 33 065 entrées catalogue + 308 partitions** | État à la fin de l'exécution bornée, à 19:18:04 UTC. Le catalogue inclut des profils globaux ; ce total n'est pas un nombre de matchs. |
| Périmètre prioritaire courant | **10 partitions publiées, 0 tâche en attente, éligible, différée ou précédemment échouée ; 0 ligne source dirty** | Dix ligues par défaut, saison 2026/2027 ; lectures à 19:37–19:38 UTC. |
| Parité récente source/publication | **111 fixtures sources, 111 présentes, 0 différence de statut/jour, 0 match terminé manquant** | Fenêtre du 4 au 9 novembre inclus, sources déjà collectées ; aucune borne sentinelle atteinte. |
| Agrégats et archives | **182/182 rollups frais**, 0 ambigu ; **154/154 éditions d'archives prêtes** | Contrôle après publication, génération 923. |
| Accueil par défaut | **97 424 octets JSON, 20 498 octets gzip**, HTTP 200 | Dix ligues, saison 2026/2027, `media=1`, ETag `media-home-v2` ; fichiers images séparés. |
| API depuis AWS Paris | **300/300 essais HTTP 200** ; p95 chauds **11,597–12,697 ms**, p95 Miss **348,536–496,081 ms** | Trois requêtes exactes, 50 Hit et 50 Miss chacune ; ne représente pas tous les filtres, réseaux ou appareils. |

Sources : [inventaire et retrait](schema-retirement.json), [publication](publication.json), [priorité et parité](priority-freshness.json), [payload réel](home-payload-live.json), [synthèse France](france-http-summary.json).

## Matrice du plan initial vers les preuves

### Lots de réalisation et intégrité

| Critère initial | Preuve et résultat | Limite / statut exact |
| --- | --- | --- |
| **Lot 0 — Observer une collecte/publication réellement planifiée** | [Exécution 42328681818](scheduled-automation.json) : événement `schedule`, succès, 02:19:42–04:13:15 UTC. La continuation est documentée dans [PUBLICATION_CONTINUATION](../PUBLICATION_CONTINUATION_20261107.md). | Établi pour cette exécution. Une configuration cron ou un lancement manuel ne remplace pas cette preuve ; aucune réussite universelle des futurs cycles n'est affirmée. |
| **Lot 0 — Reprise bornée, erreurs visibles, file mesurable, priorité courante** | [Exécution normale 42404602873](publication.json) : 240 entrées catalogue, 6 partitions, aucun lot/partition en échec ou différé ; compteurs réconciliés. [Priorité courante](priority-freshness.json) vide. | La continuation reste nécessaire pour les 33 373 travaux. Un run réussi ne signifie pas une file intégralement traitée. |
| **Lot 1 — Périodes, éligibilité, grain, tailles, fraîcheur** | Contrats de période Paris, couvertures, pagination et générations ; [audit des lectures](../NAVIGATION_READ_AUDIT_20261107.md), [contrats de performance](../FRONTEND_PERFORMANCE_20261107.md) et [accueil compact](../HOME_PAYLOAD_20261107.md). | Les noms de champs proposés dans le plan n'étaient pas tous un contrat littéral ; l'API expose les périodes/métadonnées et l'interface traite ses états. Ne pas annoncer un enum uniforme `ready/partial/empty/stale` sur chaque route. |
| **Lot 1 — Baseline reproductible des quatre parcours** | Le plan demande : « première visite, cache chaud, changement de filtres et retour à une page ». [Baseline avant PR41](browser-baseline-before-pr41.json) : nouveau document, première disponibilité **3 558,6 ms** ; [filtre Ligue 1](browser-filter-baseline.json) : **430 joueurs**, API **449,8 ms**, borne externe **542 ms**. Les huit transitions antérieures sont conservées. | **Recette de navigation non acceptée : les trois retours en mémoire après PR41 dépassent 100 ms** ; une distribution représentative reste à mesurer. Le cache HTTP de la première ouverture n'était pas contrôlé : ce n'est pas une visite entièrement froide. Le filtre n'est ni un paint mesuré, ni un retour en mémoire ; aucune baseline manquante n'est inventée. |
| **Lot 2 — Aucun téléchargement de saison complète à l'ouverture des écrans principaux** | Lectures bornées pour accueil, joueurs, clubs et recherche ; totaux et cohortes calculés côté serveur. [Audit des lectures](../NAVIGATION_READ_AUDIT_20261107.md), [recette UI](../FRONTEND_UI_ACCEPTANCE_20261107.md). | Les exports, analyses complètes, onglets explicites et anciennes capacités de compatibilité restent des parcours distincts. Un échec d'un endpoint annoncé ne déclenche pas silencieusement une saison complète. |
| **Lot 2 — Pagination exacte, recherche globale, détails à la demande** | Joueurs 20, clubs 24, matchs 30 ; recherche bornée joueurs/clubs, annulable et indépendante du filtre de compétition ; fiches puis onglets. L'endpoint réalisé est `/api/read/home`. | Le nom proposé `/api/home/summary` n'est pas une exigence fonctionnelle. Les classements et dénominateurs portent sur la cohorte entière, pas sur la page visible. |
| **Lot 3 — Semaine/jour corrects, archive datée, données absentes explicites** | Tests de frontières Paris/changement d'heure, exclusion des matchs en cours, xG inconnus conservés, expirations et renouvellement client ; [contrats de fraîcheur](../FRONTEND_PERFORMANCE_20261107.md). | Les tests de calendrier ne sont pas une observation de tous les passages de minuit en production. Le service Ballon d'Or reste non implémenté : aucun classement inventé n'est livré. |
| **Lot 3 — Cache borné, partagé et lié à la publication** | TTL, déduplication, annulation, reprise après erreur, digests/cursors avec conflit 409 ; réponses d'erreur `no-store`. Hits réels et validateurs présents dans les [reçus HTTP précédents](../../verification/db-refactor-20261107/runtime-after-cutover.json). | Les URL mutables ne sont pas déclarées immuables. Un hit observé n'est pas un taux de cache représentatif du trafic réel. |
| **Lot 3 — Nouvelle publication visible sans rechargement sous cinq minutes** | [Témoin de publication](visible-publication.json) : onglet laissé ouvert, de vide à prêt/visible, **≤141 s depuis le reçu du commit** ; **280,435 s depuis la baseline antérieure au commit**. | Établi sur une partition d'archive réellement modifiée. Ce n'est ni une mesure exacte du paint, ni le délai fournisseur → site, ni une promesse de collecte toutes les cinq minutes. |
| **Lot 4 — Consolidation par famille, parité et réversibilité** | [Bascule native](../PRODUCTION_CUTOVER_20261107.md) : 7 838 886 lignes des 112 types et 207 790 ressources exactement vérifiées ; [aller-retour natif](../NATIVE_ROUNDTRIP_20261107.md), y compris écritures nouvelles avant retour. | Parité de la transformation des familles effectivement migrées. L'annexe candidate à 40 tables n'a pas été appliquée comme une liste de renommages imposés. |
| **Lot 4 — Absence de double modèle permanent** | Les 112 anciennes structures physiques remplacées sont supprimées ; un seul chemin public actif utilise le modèle consolidé. | **Exception explicite : 98 tables Pro restent physiquement conservées**, sans activation globale du mode Pro. L'unification physique de tous les modèles historiques de la base n'est pas revendiquée. |
| **Lot 5 — Retrait explicite, dépendances, sauvegarde restaurée, contrats conservés** | [Reçu de retrait](schema-retirement.json) et [procédure](../PHYSICAL_PROVIDER_RETIREMENT_20261107.md) : plan lié aux identités/contrats, répétition native, snapshot restauré et vérifié, autorisation enregistrée ; `DROP … RESTRICT`, sans `CASCADE`. | Aucun retrait supplémentaire pour atteindre un nombre arbitraire. Les vues actives et leurs contrats sont conservés. La suppression ne prétend pas avoir rescanné chaque ligne : la preuve exhaustive de données appartient à la phase de copie/bascule. |
| **§7 — États natifs, identités, décimales, variantes et lignée** | Contrats typés, identifiants/anciennes URL préservés, reconstruction des ressources, fixtures de valeurs nulles/absentes/0/false, propres buts, saisons civiles et détails ; [mapping et recette native](../DB_REFACTOR_RELEASE_20261107.md). Le compacteur [conserve les champs affichés](../HOME_PAYLOAD_20261107.md). | Les faits natifs conservés et leurs preuves exactes sont distincts des calculs flottants dérivés, comparés selon leur contrat numérique. Ne pas généraliser une identité binaire à tous les agrégats de toutes les routes. |
| **§7 — Coûts SQL, transactions et capacité** | [Correctif rollup 037](../ROLLUP_PUBLICATION_20261107.md) : parité native exacte ; ancienne/finale chaudes 1 076/695 ms sur un scope. En production, six refreshs de **1,031–1,840 s** ; contrôles de capacité et rollback de lots maintenus. | Une paire native n'est pas un p95. Les autres étapes d'une partition prennent encore du temps. Aucun gain « ancien froid → nouveau chaud », quota accru ou débit global garanti n'est présenté. |

### Objectifs chiffrés de la section 8

| Cible du plan | Preuve disponible | Verdict |
| --- | --- | --- |
| Zéro saison complète pour accueil/joueurs/clubs/recherche | Audit des routes et contrats de lectures ci-dessus. | Établi sur le chemin public avec les capacités déployées. |
| Zéro recherche au survol | Recherche déclenchée par saisie stabilisée ; couverture de focus/annulation dans les tests de navigation. | Établi par contrat et parcours. |
| Accueil : 2–4 lectures de données utiles | [Analyse du bootstrap](../HOME_PAYLOAD_20261107.md) : deux lectures critiques, manifeste puis résumé ; catalogue dérivé localement, seeds réutilisées. Statut client distinct non bloquant. | Respecté statiquement pour le parcours par défaut. Ce n'est pas une capture réseau ; préférences divergentes, revalidation et conflits peuvent ajouter des lectures. |
| Cartes d'accueil : environ 100 Ko avant compression | [97 424 octets réels](home-payload-live.json), images binaires exclues, mappings inclus. Comparaison de rendu et préservation des champs dans [HOME_PAYLOAD](../HOME_PAYLOAD_20261107.md). | Atteint sur le scope par défaut mesuré. Le [dernier manifeste](production-runtime-final.json) pèse séparément **200 353 octets** ; le budget ne décrit pas tout le bootstrap, le HTML ni tout scope personnalisé. |
| Ressource déjà en mémoire : rendu utile <100 ms | [Après PR41](browser-after-pr41.json), les trois retours classés en mémoire prennent **260,6 puis 257,5 ms vers Clubs**, **356 ms vers Joueurs** : deux hits frais par transition, aucun loader, aucune lecture API/RSC ; seules les télémétries déclarées sont exclues. | **CIBLE NON ATTEINTE sur ces trois observations.** Ce n'est pas un p95 représentatif. Les phases de rendu et d'images restent à diagnostiquer ; l'horloge et le critère ne sont pas abaissés pour produire un succès. |
| API chaude : p95 <200–300 ms depuis France | [50 Hit par route](france-http-summary.json) : accueil **12,697 ms**, joueurs **11,597 ms**, clubs **12,538 ms** depuis `eu-west-3`, POP CDG50-P5. | **Atteint pour les requêtes et le point réseau mesurés.** Le filtre joueurs du benchmark diffère du défaut UI ; ce n'est pas une mesure de rendu ou de réseau résidentiel. |
| Première réponse sans cache partagé : p95 <1 s | [50 vrais Miss par route](france-http-trials.json) : accueil **487,651 ms**, joueurs **496,081 ms**, clubs **348,536 ms**. | **Atteint en p95 dans ces cohortes**, sans garantie par requête : maximum accueil **1 266,866 ms** conservé. Un Miss CDN ne signifie pas Lambda/DB froids ; le pilote antérieur à **2 859,169 ms** reste séparé et visible. |
| Premier contenu indépendant d'une compétition lente | Lectures par route et détails différés implémentés ; anciennes séquences UI réussies. | Architecture vérifiée ; **mesure navigateur finale à compléter**, sans assimiler un masque d'attente résiduel à un rendu utile rapide. |
| Publication visible <5 min ; changement jour/semaine correct | Témoin ≤141 s et tests de calendrier cités ci-dessus. | Établi dans les périmètres décrits ; ne garantit pas l'état du fournisseur en direct. |
| Parité métier/couvertures ; aucune publication partielle annoncée complète | Copie/parité native, agrégats liés au digest, génération atomique, rollbacks injectés ; 182 scopes frais et 154 archives prêtes après publication. | Établi sur les contrats et jeux éprouvés. Les 111 fixtures ne prouvent pas l'égalité de chaque métrique des bodies fournisseurs. |
| Retour arrière exercé ; aucune suppression non validée | Roundtrip avant retrait, restauration de snapshot, répétition et autorisation du retrait enregistrées. | Établi pour ces opérations ; le retour actuel passe par restauration, avec les limites ci-dessous. |
| Taux de cache cible par route sur trafic réel | Politique conditionnelle définie ci-dessous, par route et fenêtre TTL. Les sondes conservent chaque `X-Cache`. | **Cible documentée ; taux naturel NON MESURÉ.** Les logs CloudFront standard et temps réel sont désactivés. Le ratio construit 50 Hit + 50 Miss ne représente pas le trafic des utilisateurs. |
| Test concurrent : latence, erreurs, throttles et charge DB simultanés | [Trois flux Miss simultanés](france-http-trials.json), concurrence backend observée **3**, **0 erreur / 0 throttle**, CPU maximal des moyennes minute **10,883 %**, connexions DB **3**. [Corrélation](france-load-observation.json). | **Observation concurrente établie à concurrence 3.** Ce n'est pas un test de saturation ou une capacité générale multi-utilisateur ; les métriques couvrent aussi le trafic de production éventuel. |

## Mesures France : protocole, résultats et portée

La sonde temporaire était une Lambda **Python 3.13 ARM64, 512 MiB**, en **eu-west-3**. Elle ouvre une nouvelle connexion HTTPS pour chaque essai et mesure jusqu'à la lecture du corps. Les réponses passent par le POP **CDG50-P5**. Les percentiles sont empiriques : rang `ceil(0,95 × n)`, donc la **48e valeur triée sur 50** pour le p95. Aucun intervalle de confiance ni comportement de tous les utilisateurs français n'est déduit de cet échantillon. Les [300 essais individuels](france-http-trials.json), leur query de base complète, les trois warmups et le pilote antérieur sont conservés.

| Route | Cache observé | Essais | p50 (ms) | p95 (ms) | Maximum (ms) | HTTP |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Accueil | Hit | 50 | 8,909 | **12,697** | 25,928 | 50 × 200 |
| Joueurs | Hit | 50 | 8,633 | **11,597** | 12,410 | 50 × 200 |
| Clubs | Hit | 50 | 9,897 | **12,538** | 13,778 | 50 × 200 |
| Accueil | Miss | 50 | 423,329 | **487,651** | **1 266,866** | 50 × 200 |
| Joueurs | Miss | 50 | 436,177 | **496,081** | 578,048 | 50 × 200 |
| Clubs | Miss | 50 | 323,958 | **348,536** | 550,361 | 50 × 200 |

Toutes les requêtes finales ciblent la saison **2026/2027**, la génération **923** et le même ensemble de dix ligues, avec `media=1`. L'accueil utilise `/api/read/home`. Les clubs utilisent la page 1 de 24 éléments. Les joueurs utilisent exactement **`basis=total`, `minutes=0`, `sort=rating`, `direction=desc`, `page=1`, `limit=20`**. Le défaut de l'interface joueurs utilise **`basis=perMatch`, `minutes=1`, `ranking=rating`** : cette autre cohorte n'est pas déclarée identique ni couverte par le même percentile. Les chemins complets sont conservés dans les reçus, avec tous les identifiants de ligue et paramètres.

Les séries chaudes suivent un warmup puis répètent la même URL pendant sa validité. Les séries Miss changent uniquement l'ordre du même ensemble de ligues : cela crée des clés CDN distinctes, tandis que le lecteur normalise le périmètre. Chaque statut Hit/Miss est vérifié dans `X-Cache`. Les reçus natifs conservent la query de base, mais pas le chemin individuel de chacune des permutations ; aucune liste de chemins observés n'est reconstruite comme si elle avait été enregistrée.

L'accueil réécrit `data.period.asOf` avec l'horloge de la requête dans [relational-home.js](../../../dashboard/backend/services/relational-home.js). Les 50 corps Miss ont ainsi des hashes différents, tout en conservant la génération 923 et une taille de 97 424 octets. Un hash de réponse différent ne suffit donc pas à conclure à des faits de football instables. Les deux autres routes ont chacune un seul hash dans leurs 50 Miss. Cette observation n'est pas une preuve d'égalité exhaustive obtenue en comparant tous les bodies après retrait de l'horloge : les corps complets ne sont pas conservés dans la sonde.

Le pilote du **7 novembre à 19:16 UTC**, avant le compactage final et à la génération **922**, contenait deux essais accueil de **2 859,169 ms** et **441,964 ms**, sur une réponse de **179 114 octets**. Il reste visible dans le reçu. Les trois warmups finaux sont également conservés : accueil **539,467 ms**, joueurs **591,202 ms**, clubs **898,751 ms**. Ils n'appartiennent pas aux six cohortes de 50 définies par le protocole ; aucun essai de ces cohortes n'est retiré. Le maximum final de l'accueil au-dessus d'une seconde reste inclus dans son p95. Un Miss CDN n'impose pas un démarrage Lambda froid, un cache PostgreSQL froid ou une première visite navigateur sans cache.

### Observation concurrente

Les trois séries Miss se chevauchent réellement, entre **19:53:11 et 19:53:39 UTC**. La [fenêtre CloudWatch](france-load-observation.json) couvre **19:51:00–19:55:17 UTC**, avec des pas de 60 secondes :

| Indicateur | Observation |
| --- | ---: |
| Concurrence maximale backend retournée | **3** |
| Erreurs Lambda / throttles retournés | **0 / 0** |
| Maximum des moyennes CPU RDS par minute | **10,883 %** |
| Maximum des connexions DB retournées | **3** |
| Minimum de mémoire libérable RDS retourné | **105 517 056 octets** |
| Minimum d'espace de stockage libre retourné | **21 807 788 032 octets** |

Ces métriques couvrent la fonction et la base entières, y compris un éventuel trafic extérieur à la sonde. Le maximum d'une moyenne CPU par minute n'est pas un pic CPU instantané. Les points absents ne sont pas convertis en zéro ; le solde de crédits CPU n'a aucun point retourné. Le test établit le comportement pour **trois flux bornés**, avec latence, erreurs, throttles et ressources observés simultanément. Il ne dimensionne pas la capacité maximale du service.

## Recette navigateur après PR41 : cible non atteinte

Le [reçu v2](browser-after-pr41.json) commence à **20:23:43 UTC** sur Chrome 156 sous Linux, viewport **1 363 × 936**, DPR 1 ; les indications navigateur sont cinq threads et 8 GiB de mémoire. C'est l'appareil de référence cloud, pas l'appareil de Hugo. Le premier marqueur de disponibilité du nouveau document est observé à **15 439,8 ms**. Cette valeur n'est pas une mesure du premier pixel utile, et le cache HTTP/images préexistant n'a pas été entièrement contrôlé. Elle ne constitue pas une comparaison à conditions égales avec la baseline précédente à 3 558,6 ms.

| Transition conservée | Durée clic → prêt + deux frames | Données en mémoire | Lectures API/RSC observées pendant l'intervalle |
| --- | ---: | --- | ---: |
| Accueil → Clubs, première ouverture | 7 523,3 ms | Non ; deux loaders | 2 |
| Clubs → Joueurs, première ouverture | 6 277,1 ms | Non ; deux loaders | 1 |
| Joueurs → Clubs, retour | **260,6 ms** | **Oui** | **0** |
| Clubs → Joueurs, retour | **356 ms** | **Oui** | **0** |
| Joueurs → Clubs, retour supplémentaire | **257,5 ms** | **Oui** | **0** |

Les trois retours ont chacun deux hits de ressources fraîches, zéro pending, zéro loader, aucune requête bloquante et une preuve réseau complète. Les seules requêtes exclues du label de mémoire sont les POST Vercel déclarés ; leurs compteurs restent conservés. **Les trois observations dépassent 100 ms.** Ce petit échantillon suffit à constater ces dépassements, mais ne produit pas un p95 navigateur représentatif.

Les premières ouvertures avec lectures réseau sont conservées, sans les mélanger aux retours en mémoire. Le reçu actuel ne sépare pas encore la création du nouveau workspace, sa préparation et l'attente des images ; il ne prouve donc pas qu'un timeout d'image cause chacun de ces délais. La mesure de phases doit orienter la suite, en conservant l'horloge, les critères de contenu prêt et les mêmes deadlines. Le [guide de mesure v2](../BROWSER_ACCEPTANCE_METRICS.md) précise la classification et les limites.

## Mesures de phases après PR42

[PR42](https://github.com/VegaInteligence/Vega-Sport/pull/42) ajoute uniquement une décomposition du même intervalle. La [CI 42411708790](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42411708790) réussit ses trois jobs ; le commit `32bf347dcecae91bbf086e10cd165d510f6ddde4` est READY en production. Les critères, les deux frames finales et les délais des images restent inchangés. Le [reçu v3 complet](browser-after-pr42.json) conserve les sept transitions de ce nouveau document sur le même navigateur de référence.

| Parcours dans l'ordre observé | Nouveau main (ms) | Ready (ms) | Deux frames après ready (ms) | Total (ms) | Données en mémoire |
| --- | ---: | ---: | ---: | ---: | --- |
| Accueil → Clubs, première ouverture | 43,4 | 3 296 | 2 031,6 | 5 327,6 | Non |
| Clubs → Joueurs, première ouverture | 26,7 | 3 297 | 2 030,1 | 5 327,1 | Non |
| Joueurs → Clubs | 42 | 199,6 | 25,9 | **225,5** | Oui |
| Clubs → Joueurs | 64,2 | 261,7 | 18,6 | **280,3** | Oui |
| Joueurs → Accueil, première navigation retour | 77,6 | 3 347,8 | 2 029,7 | 5 377,5 | Non : RSC |
| Accueil → Clubs | 53,7 | 248,4 | 30,5 | **278,9** | Oui |
| Clubs → Accueil | 157 | 622,6 | 23,6 | **646,2** | Oui |

Le marqueur de première disponibilité est **13 695,1 ms** sur ce document ; le cache HTTP préexistant n'est pas contrôlé. Les quatre retours en mémoire n'ont aucun loader, aucun transfert API/RSC ni aucune requête bloquante. Ils dépassent tous 100 ms. Les délais entre création du main et ready dominent les retours Clubs/Joueurs ; pour l'accueil, la création du DOM dépasse déjà 100 ms. Les deux frames finales de trois autres parcours prennent environ deux secondes : cette observation est conservée sans l'attribuer à un timeout d'image ni à une cause de plateforme non démontrée. Ces mesures orientent un correctif de préparation du rendu ; elles ne constituent pas encore son résultat.

## Contrôle supplémentaire après PR44

[PR44](https://github.com/VegaInteligence/Vega-Sport/pull/44) est déployée sur `0f17dbfb338a912d910168909835ab33d3a1d38d` après [trois jobs CI réussis](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42413222112). Le [reçu de livraison](release-pr44.json) et les [sept transitions complètes](browser-after-pr44.json) sont conservés. Les délais des images, l'horloge et le critère de fin n'ont pas changé.

La première disponibilité est observée à **1 738,9 ms** dans ce nouveau document, avec cache HTTP préexistant non contrôlé. Ce chiffre ne prouve pas un gain causal par rapport aux ouvertures précédentes. Les trois retours classés en mémoire sont :

| Destination | Nouveau main (ms) | Ready (ms) | Deux frames finales (ms) | Total (ms) |
| --- | ---: | ---: | ---: | ---: |
| Clubs | 56,3 | 247,5 | 2 030 | **2 277,5** |
| Joueurs | 76,3 | 297,3 | 28,3 | **325,6** |
| Clubs | 181,3 | 413,7 | 29,1 | **442,8** |

**La cible de 100 ms reste non atteinte.** Les deux premières ouvertures et le premier retour Clubs ont utilisé une attente de sélecteur sur le compteur de reçus ; les autres parcours ont été lus dans un appel ultérieur sans cette attente active. Tous restent présents. Le délai d'environ deux secondes entre ready et la seconde frame a aussi été observé ailleurs ; sa cause n'est pas attribuée sans preuve. Le dernier retour Accueil de **679,4 ms** comporte un loader, deux requêtes déjà en vol et des transferts API/RSC : il n'est pas classé en mémoire. Aucun résultat n'est éliminé pour produire un percentile favorable.

La suite se concentre sur le replay d'abonnement du cache et une trace opt-in séparant le travail du contrôleur de préparation de son attente d'une frame. La correction des invariants de disponibilité ne constitue pas, à elle seule, une réussite de latence.

## Mesures de préparation après PR45

[PR45](https://github.com/VegaInteligence/Vega-Sport/pull/45) est READY en production sur `1ba22c484ad5c9b4ebc162b272f82f07b373850b`, après les trois jobs réussis de [CI 42416098655](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42416098655). Le [reçu](release-pr45.json) conserve aussi le premier run échoué : quatre fixtures SSR reposaient sur le cache global ; elles passent maintenant un bootstrap de requête explicite, avec les assertions de trophées conservées et une vérification d’isolation supplémentaire.

Les [sept transitions v4](browser-after-pr45.json) utilisent le même critère de fin. Le clic et la capture AX sont effectués dans deux appels séparés ; cela ne change ni l’origine temporelle ni le critère et ne prouve pas à lui seul une cause des attentes de frames. Le [contrôle supplémentaire PR44](browser-pr44-separated-capture.json) conserve aussi trois observations tardives, toutes avec du réseau encore présent : 360 ms, 1 284,9 ms et 116,1 ms. Aucune n’est classée en mémoire.

| Retour PR45 classé en mémoire | Nouveau main (ms) | Ready (ms) | Deux frames finales (ms) | Total (ms) | Contrôles de préparation |
| --- | ---: | ---: | ---: | ---: | ---: |
| Joueurs → Clubs | 52,7 | 98,9 | 146,5 | **245,4** | 5 |
| Clubs → Joueurs | 81,6 | 118 | 10,8 | **128,8** | 3 |
| Accueil → Clubs | 86,2 | 130,2 | 115,7 | **245,9** | 5 |
| Clubs → Accueil | 136,5 | 229,1 | 1,6 | **230,7** | 3 |

Les quatre transitions ont des hits frais, aucun loader, aucune requête bloquante et aucun transfert API/RSC. Elles ne satisfont pas la cible de 100 ms. Le travail du premier contrôle coûte respectivement 15,7 / 26,7 / 18,3 / 49,3 ms ; les autres contrôles sont plus courts. L’accueil dépasse déjà 100 ms au montage du main. Les deux frames finales restent très variables et leur cause n’est pas attribuée sans contrôle.

Les ouvertures avec réseau montrent aussi une attente de programmation : le premier Clubs attend 940,5 puis 983,9 ms avant deux contrôles dont le travail prend 27 puis 0,6 ms. Le premier retour Home attend 555,3 ms avant un contrôle de 1,2 ms. La première disponibilité de ce document est 1 934,9 ms, avec cache HTTP préexistant non contrôlé. Ces données motivent le correctif ciblé de programmation documenté dans [BROWSER_READINESS_NOTIFICATIONS](../BROWSER_READINESS_NOTIFICATIONS_20261107.md), sans prétendre qu’il règle le coût du montage ou qu’il a déjà passé la cible navigateur.

## Politique de cache par route et condition

La politique suivante fixe un objectif vérifiable de réutilisation pour les quatre lectures critiques ci-dessous. **Elle n'est pas un taux naturel déjà obtenu.** Pour chaque route, on distingue le trafic complet et la sous-cohorte des répétitions éligibles : même POP, URL canonique complète, génération, représentation et négociation de compression, après une réponse mise en cache, dans sa durée de validité, sans changement de période ou de publication. Les premières demandes et les nouvelles clés restent présentes dans le taux naturel, même si elles ne sont pas des répétitions éligibles.

| Route | Fenêtre de réutilisation | Cible conditionnelle documentée |
| --- | --- | --- |
| `/api/dashboard/manifest` | 15 s, même représentation/version demandée | **≥95 % de Hit** parmi les répétitions éligibles. |
| `/api/read/home` | 30 s, même scope, génération, période et options personnelles | **≥95 % de Hit** parmi les répétitions éligibles ; ne pas prolonger le TTL pour atteindre ce ratio. |
| `/api/read/players` | 30 s, même page, tri, base, seuil de minutes, classement et scope | **≥95 % de Hit** parmi les répétitions éligibles ; chaque combinaison conserve sa propre clé. |
| `/api/read/clubs` | 30 s, même page, filtres et scope | **≥95 % de Hit** parmi les répétitions éligibles. |

Un bilan sur trafic réel doit publier, **par route et POP**, les nombres Hit, Miss, RefreshHit, erreur et inconnu, le volume et la période d'observation. Le taux naturel doit inclure les premières demandes et nouvelles clés éligibles au cache ; le taux de répétition doit indiquer son propre dénominateur. Les erreurs et conflits de génération sont suivis séparément avec leurs réponses `no-store`, sans être masqués par un bon ratio de cache. Une route peu répétée n'a pas de garantie de fort taux naturel global.

Dans la configuration constatée par l'opérateur, **les logs CloudFront standard et temps réel sont désactivés**. Les invocations origin Lambda ne fournissent pas le dénominateur des Hits servis au CDN et ne permettent pas de reconstituer un taux naturel par route. Les séries synthétiques prouvent 50/50 Hit après warmup pour les trois URL testées et 50/50 Miss pour les clés volontairement distinctes. Additionner ces groupes pour annoncer « 50 % de cache sur le site » serait incorrect. **La politique est définie ; sa mesure sur trafic naturel reste explicitement non disponible.** Aucune journalisation n'est activée par ce dossier documentaire.

## Exceptions justifiées et limites de récupération

La cible d'environ 40 tables était indicative. L'inventaire final de **192** se décompose ainsi : **58 applicatives + 98 Pro historiques (65 football, 23 ingest, 10 analytics) + 17 sources/ingestion + 9 authentification + 10 captures de transfert archivées**. Ces 134 tables hors application n'ont pas été supprimées sans preuve de remplacement et d'inutilité. Les 58 tables applicatives se décomposent en **49 tables relationnelles conservées, trois magasins consolidés, une table de contrôle de consolidation, un agrégat joueurs, deux projections d'archives et deux projections d'accueil**, conformément aux inventaires successifs. Les captures de transfert sont réconciliées et gelées ; l'authentification est hors du périmètre sportif. Les trois magasins consolidés restent typés, contraints et indexés, avec leur lignée ; ils ne forment pas un stockage JSON universel opaque. Voir [inventaire](schema-retirement.json) et [archivage du transfert](../LEGACY_TRANSFER_ARCHIVE_20261107.md).

La comparaison correcte du retrait est **304 → 192**, soit 112 tables. Le diagnostic initial recensait 295 tables avant l'ajout de neuf structures nécessaires à la consolidation et aux projections. Il serait incorrect d'écrire « 295 moins 112 = 192 », ou de confondre les 58 tables applicatives avec toute la base. Le nombre de vues ne constitue pas une duplication physique de leurs lignes. Aucun espace disque immédiatement rendu au système n'est déduit du seul nombre de tables.

Le snapshot précédant le retrait reste disponible ; sa restauration isolée a vérifié les **112 anciennes tables et les contrats actifs**. Après retrait, `rollback_available=false` : **le rollback physique en place n'existe plus**. La stratégie est `restore_snapshot_then_replay`. Avant une récupération réelle, conserver une capture cohérente de la base actuelle, puis reconstruire dans une cible isolée, ensemble sources, serving, reçus, génération et projections. Le [runbook](../PHYSICAL_PROVIDER_RETIREMENT_20261107.md) ne prétend pas disposer d'un importeur universel validé de tous les deltas après snapshot, ni d'une garantie de récupération sans perte de chaque version intermédiaire. Une sauvegarde historique ne doit pas remplacer directement la production plus récente.

La fraîcheur courante est également bornée : les dix partitions ont des derniers watermarks retenus allant du **7 novembre 02:22:05 au 03:19:55 UTC**, sans watermark manquant ; leur dernier jour de match est le 6 novembre. L'inventaire des rencontres du 6 et du 7 novembre a aussi été récupéré vers 12:52 UTC. La comparaison des 111 fixtures prouve l'alignement avec les **sources déjà collectées** sur la fenêtre testée, pas l'absence de nouvelles données chez le fournisseur. Les horodatages d'inventaire, de modification de ligne, de collecte de partition, de publication et la période d'un widget ont des sens distincts. [Preuve bornée](priority-freshness.json).

Pour le Ballon d'Or, le plan exige de **ne pas fabriquer un classement** tant que les règles de calcul ne sont pas implémentées. Ce contrat est respecté. L'invention d'un barème ou la création d'un classement supplémentaire ne fait pas partie de la recette de cette refonte.

## Champs de clôture à compléter par les reçus définitifs

| Champ | Valeur / preuve attendue |
| --- | --- |
| CI et déploiement exacts | **PR40 et PR41 VÉRIFIÉES** : [PR40](release-pr40.json), [PR41](release-pr41.json), [15 contrôles backend de production réussis](production-runtime-final.json). PR41 est READY sur `cd34a83d…`, avec le même backend que la sonde France ; aucun succès de latence navigateur n'est inféré de la CI. |
| Paris, trois routes, cache chaud | **MESURÉ** : 50 Hit par route, tous 200 ; p95 accueil/joueurs/clubs **12,697 / 11,597 / 12,538 ms**, avec p50, maximum, POP, timestamps, queries et hashes conservés. [Reçus](france-http-trials.json). |
| Paris, trois routes, sans cache partagé | **MESURÉ** : 50 Miss par route, tous 200 ; p95 **487,651 / 496,081 / 348,536 ms**. Cache DB/Lambda non contrôlé ; maximum final accueil **1 266,866 ms** et pilote **2 859,169 ms** conservés. |
| Navigateur de référence | **CIBLE 100 ms NON ATTEINTE** sur [trois retours en mémoire après PR41](browser-after-pr41.json) : Clubs **260,6 / 257,5 ms**, Joueurs **356 ms**. Compléter les phases et une distribution représentative, en conservant les observations lentes et les vraies conditions de cache. |
| Baseline navigateur avant PR41 | **CONSERVÉE** : [première disponibilité 3 558,6 ms et huit transitions](browser-baseline-before-pr41.json) ; [filtre Ligue 1, 430 joueurs, API 449,8 ms et borne externe 542 ms](browser-filter-baseline.json). Cache HTTP initial non contrôlé ; pas de revendication de paint <100 ms. |
| Charge simultanée et cache | **CONCURRENCE MESURÉE À 3**, erreurs/throttles 0/0 et métriques RDS conservées. **Taux naturel de cache NON OBSERVABLE** : logs CloudFront standard/temps réel désactivés ; politique conditionnelle définie ci-dessus. |
| Nettoyage des ressources DB temporaires | **VÉRIFIÉ à 19:46 UTC** : trois stacks workers et clone absents ; snapshot et production disponibles. [Reçu](db-cleanup.json). |
| Nettoyage de la sonde Paris | **VÉRIFIÉ** : stack temporaire absente ; backend de production toujours Active / Successful avec le même hash. [Reçu final](cleanup-final.json). Le reçu ne comporte pas de timestamp de suppression : aucune heure précise n'est inventée. |
| Préservation du dossier final | Les reçus sélectionnés sont présents dans ce dossier et reliés aux sources par SHA-256. **Dossier documentaire publié par PR43**, puis complété par PR45 ; la navigation reste une recette ouverte. La preuve de restauration/retrait avait déjà été préservée avec relecture indépendante. |
| Verdict de recette | **À COMPLÉTER honnêtement** : critères atteints, cibles non atteintes et exceptions acceptées ; ne pas déclarer 100 % tant qu'une preuve requise manque. |

## Reçus et provenance

Les reçus JSON de ce dossier contiennent des champs sélectionnés, les 300 essais HTTP, des observations navigateur, des agrégats vérifiés et les limites correspondantes. Le [manifeste des sources](sources.json) donne les empreintes des reçus opérateur utilisés. Aucun journal brut, corps fournisseur, secret, URL signée ou identifiant de connexion n'est copié. Les sources de performance ont été relues et les six p95 recalculés à partir des essais. Les JSON synthétiques ne remplacent pas les preuves natives de migration ; les preuves natives historiques ne remplacent pas une mesure de la dernière livraison.

Les critères facilement oubliés restent visibles : les **quatre parcours** de baseline, le **taux de cache par route sur trafic réel**, la **charge concurrente corrélée** et la limite du **double modèle Pro conservé**. Le contrat **Ballon d'Or** est traité explicitement ci-dessus. Ces points ne justifient ni une suppression supplémentaire non éprouvée ni une métrique de réussite artificielle.
