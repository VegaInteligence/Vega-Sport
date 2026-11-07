# Programmation des contrôles de préparation — 7 novembre 2026

## Problème observé

Les [sept mesures après PR45](acceptance-20261107/browser-after-pr45.json), sur le commit de production `1ba22c484ad5c9b4ebc162b272f82f07b373850b`, séparent le travail de préparation de son attente en file. À la première ouverture de Clubs, deux contrôles attendent **940,5 puis 983,9 ms** avant de travailler **27 puis 0,6 ms**. Le premier retour Home attend **555,3 ms** avant un contrôle de **1,2 ms**. Les notifications de chargement/décodage doivent pouvoir vérifier le DOM sans attendre une nouvelle frame.

Ce constat ne suffit pas à expliquer toute la latence. Les quatre retours en mémoire prennent **245,4 / 128,8 / 245,9 / 230,7 ms**. Le nouveau main de l’accueil n’est observé qu’à **136,5 ms**, avant sa disponibilité complète à **229,1 ms**. Les deux frames de fin prennent aussi de **1,6 à 146,5 ms** sur ces quatre retours, et environ deux secondes sur certaines ouvertures avec réseau. Aucune cause de plateforme n’est affirmée et aucun de ces résultats n’est retiré.

## Modification ciblée

`prepareInitialPage` utilise une microtâche regroupée pour les notifications MutationObserver, load/error et décodage. La vérification lit toujours les marqueurs de chargement, les images réellement présentes dans le viewport et leur état de décodage. Scroll et resize gardent leur regroupement par frame ; une notification qui contrôle déjà la géométrie annule le contrôle de frame devenu redondant.

Trois phases explicites protègent le cycle : préparation, repli en attente de frame, nettoyage terminé. Dès l’entrée en repli, les notifications ordinaires ne peuvent plus révéler la page. Une unique frame dédiée attend le commit des fallbacks avant la révélation. Le nettoyage rend inertes les microtâches, événements et anciens décodages ; les timers et frames sont annulés. Un décodage d’une ancienne source ne peut pas valider la nouvelle.

Les délais **5 s images / 10 s page**, les critères de contenu prêt, l’horloge de clic et les deux frames finales de la mesure restent identiques. Aucun registre permanent d’URL « déjà décodées » ne remplace le contrôle de la nouvelle image.

## Validation et coût à surveiller

**58/58 tests ciblés réussissent**, dont 29 contrôles de préparation. Les sept nouveaux cas échouent avec l’ancienne programmation : contrôle sans nouvelle frame, regroupement, frame obligatoire de repli, nettoyage, nettoyage pendant le repli, absence de boucle sur décodage en attente et conservation du temps en file. Les cas de changement de source, données encore chargées, image lente, erreur, fallback et contenu hors écran demeurent présents.

Le risque résiduel est une multiplication des scans si des chargements arrivent dans des tâches distinctes. Une microtâche s’exécute avant une opportunité de rendu ; une chaîne de microtâches peut retarder ce rendu ([guide MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)). La trace opt-in conserve donc désormais les sommes **checkWorkMs** et **checkQueueMs** sur tous les contrôles, en plus du compteur total et des vingt derniers détails. Cela évite de sous-estimer le travail si les détails sont tronqués.

**La cible navigateur de 100 ms reste ouverte tant que la livraison exacte n’a pas été mesurée.** Les tests prouvent les invariants de disponibilité et la nouvelle programmation ; ils ne constituent pas une mesure de paint ou de navigation utilisateur.

## Retour de production et suppression des scans redondants

La [mesure après PR46](acceptance-20261107/browser-after-pr46.json) confirme une attente cumulée de **0,1 à 1 ms** sur les quatre retours en mémoire. Elle révèle aussi **26 / 42 / 28 / 93 contrôles**, et jusqu’à **136,8 ms de travail cumulé** pour l’accueil. La plupart des événements natifs précèdent le commit de l’état Media et ne changent pas encore le verdict de disponibilité. Les mesures complètes, y compris ce résultat défavorable, sont conservées.

Le correctif suivant ignore les événements natifs load/error des images dont le propriétaire Media expose un état reconnu. Le contrôleur observe déjà `data-media-state`, le remplacement de `src`/`srcset` et les mutations de descendants : le décodage réussi ou la suppression pour fallback provoque donc toujours son contrôle. Une image sans ce contrat de propriétaire continue de déclencher la préparation au chargement et attend son propre décodage.

**61/61 tests ciblés passent.** Deux nouvelles régressions échouent avant le correctif ; un troisième contrôle confirme le maintien du chemin des images natives. Une série de 24 événements load de Media ne provoque aucun scan supplémentaire avant son commit ready ; l’erreur native ne révèle pas la page avant le fallback. Les délais, le repli avec une frame obligatoire et le critère de navigation restent identiques.
