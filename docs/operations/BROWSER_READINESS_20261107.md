# Retours de navigation et mesure de disponibilité — 7 novembre 2026

## Constat et périmètre

La recette navigateur de la livraison PR40 a observé des retours de plusieurs secondes et un compteur de loader non nul malgré des données déjà présentes. Ces observations ne valident pas l'objectif de 100 ms. Le témoin pris avant révélation contient 17 images avec une source `/_next/image`, toutes encore en cours de chargement à cet instant. Il n'établit pas qu'une image clippée était la cause des délais observés.

Les corrections suivantes partent de `a3b5c304bbd9481f1c97c3ac2b04a9758ccc4b91`. Elles règlent des défauts identifiés indépendamment ; leurs gains de navigation doivent être mesurés après déploiement.

## Changements

**Statut de connexion.** Chaque nouveau `FootballDataClient` recevait un identifiant séquentiel et créait une ressource `status:<id>`. Son loader ne faisait que relire la ressource globale `status:api`, déjà fraîche. Le chemin `aws-relational` réutilise désormais directement ce snapshot, en initialisant correctement `configured` et `statusKnown` du nouveau client. Une valeur inconnue reste inconnue ; `false` n'est pas transformé en succès. Les clients Pro et les lecteurs historiques conservent leur initialisation spécifique.

**Segments de route.** Le cache du routeur conserve une route dynamique visitée pendant 240 secondes. Aucun nouveau déclencheur de prefetch n'est ajouté. Les préférences navigateur, clés de génération et protections contre un bootstrap plus ancien restent en place. La revalidation de publication utilise une horloge commune au document : un remontage du provider à 3 min 59 s ne repousse pas le prochain contrôle à presque huit minutes. Les délais de quatre minutes, de reprise au focus et de changement de jour Paris sont conservés.

**Première zone visible.** Le contrôle des images intersecte désormais les rectangles avec les conteneurs de défilement ou d'overflow. Auparavant, une image à l'intérieur de la fenêtre mais entièrement hors de son conteneur visible pouvait bloquer jusqu'au délai de cinq secondes, alors qu'IntersectionObserver ne l'admettait pas. Les images partiellement visibles attendent toujours le décodage et l'état React prêt. L'opacité du masque n'exclut pas les images du contrôle. Les descendants en position absolue/fixe restent traités conservativement, car leur bloc contenant peut échapper à un clip intermédiaire. Les délais de cinq secondes pour les images et dix secondes pour l'ensemble de la page sont inchangés.

**Reçu de mesure v2.** Tous les fetches restent comptés. Seuls les POST `view`/`vitals`, de même origine, dont l'URL exacte est annoncée par les scripts des SDK Vercel installés, sont classés comme télémétrie non bloquante pour `dataInMemory`. Les lectures API, RSC — y compris le header RSC — et les destinations inconnues restent bloquantes. Une requête commencée avant le clic ou terminée pendant la file d'événements est prise en compte. Des ressources pending/loader, une preuve réseau tronquée, un onglet caché ou un filtre de même identité ne produisent pas un faux succès en mémoire. L'instrumentation conserve la promesse et les arguments du fetch natif ; elle ne modifie ni ne rejoue les requêtes.

## Validation et limites

Les **74 tests ciblés passent, sans échec ni skip** : disponibilité initiale, rendu compact des providers, identité du cache, revalidation et remontage, classification réseau, bootstrap et préférences. Les fixtures vérifient notamment deux vrais remontages avec des identifiants de client différents, les états de connexion true/false/inconnu, l'initialisation historique, le décodage visible, les clips imbriqués et le refus d'une génération SSR ancienne face à une publication plus récente en mémoire.

Le [reçu de régression](../verification/browser-readiness-20261107/regression.json) identifie l'ancien code : les deux nouveaux cas de clipping échouent sur ce parent et passent après correction. Ce test prouve le défaut logiciel ; il n'attribue pas les délais du témoin réel à ce défaut.

La compilation de production **Next.js 16.4.3 avec webpack** réussit et génère les 14 pages statiques. Le premier essai Turbopack local s'arrête parce que les dépendances de ce worktree sont un lien vers un répertoire extérieur à sa racine hermétique ; ce résultat n'est pas présenté comme un test du nouveau code. La CI et le build normal de déploiement restent les validations de livraison.

Après déploiement, relever les retours réellement en mémoire, sans lecture RSC/API, sur un navigateur de référence visible. Le temps reste celui du clic capturé à un nouveau workspace prêt, suivi de deux frames ; ce n'est pas une mesure instrumentale du paint. Les premiers rendus, changements de filtre et retours nécessitant une requête doivent conserver leurs résultats distincts. Aucun percentile navigateur ni gain garanti n'est déduit des tests locaux.
