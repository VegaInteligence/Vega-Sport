# État au 18 novembre 2026

**La branche contient des corrections candidates. La livraison globale reste ouverte.** À 11 h 26 UTC, le worker et le rattrapage AWS exécutent le déploiement `8018e0836c`. Les deux empreintes Lambda concordent. Vercel et la branche principale pointent vers `17ca0f7617`. À 11 h 23 UTC, Linear compte huit tickets récemment clos et huit tickets actifs. [AWS et Git](controles/etat-execution/deploiement-1126.json) · [Vercel](controles/etat-execution/vercel-1126.json) · [Linear](controles/etat-execution/linear-1123.json)

## Exigences et production

Le document initial est décomposé en **38 critères : 12 implémentés en production, 24 incomplets et 2 manquants**. Leur état est identique sur la branche. Le registre complet contient **91 critères** : en production, 29 implémentés, 50 incomplets, 2 manquants et 10 sans objet ; sur la branche, 29 hérités de production, 4 implémentés sur branche, 53 incomplets, 2 manquants et 3 sans objet. Ces axes ne constituent pas un taux de validation scientifique. Les **26 calculs supplémentaires** ont leur inventaire distinct. [Critères](registres/requirements.csv) · [Calculs](registres/new-calculations.csv)

Les identités restent à corriger : 25 paires de clés de 13 clubs sont étayées sur leurs périodes ; les quatre saisons anciennes de Bundesliga contiennent 100 copies supplémentaires. Huit attributions LFP désignent Siriné Doucouré sur la ligne d’Henri. À Seongnam, les deux homonymes restent deux personnes ; les 313 rapprochements nominaux candidats n’autorisent pas une fusion. Ces ensembles se recoupent et ne donnent pas un nombre global de doublons. [Identités et sources](CLASSEMENTS-ET-IDENTITES.md) · [Copies et périodes](RENCONTRES.md)

**Joueurs : 2 297 613 entrées admises, 2 296 998 calculables, 2 282 580 publiées.** Les 14 418 calculables sans publication appartiennent à 2020 ; 615 entrées restent sans rôle. Le rejeu des sept millésimes trouve 517 588 écarts supérieurs à 0,01 point avec les entrées actuelles. Il ne prouve pas que les anciennes entrées étaient identiques. Les 615 cas sont analysés sur 587 matchs et 69 éditions ; aucun poste futur n’est présenté comme connu au jour du match. [Sept années de notation, dénominateur admis](RECALCUL-JOUEURS.md) · [615 cas](CLASSEMENTS-ET-IDENTITES.md#postes-manquants-et-identités-des-joueurs)

**Clubs et sélections : 163 846 côtés Elo pour 81 923 matchs admis**, dont 161 982 côtés de clubs et 1 864 de sélections. L’Elo commun est le score équipe × match ; le score club-saison sur 100 est une transformation distincte. Le classement des sélections expose l’Elo. Ces nombres ne garantissent ni l’absence de copies sportives ni la couverture des qualifications et archives. [Contrat et dénominateur](CONTRE-LECTURE.md) · [Grille par édition et entité](notes-transaction/coverage-by-edition-and-entity.csv.gz)

## Correctifs et validations par périmètre

Point du 18 novembre à 12 h 55 UTC. Les commits des lots indiqués ci-dessous sont sur leurs branches locales respectives. La matrice des exigences distingue la production et la branche d’intégration.

| Périmètre | Résultat vérifié | Travail ouvert |
| --- | --- | --- |
| Mi-temps et précision, VI-28 et VI-32 | La branche 2813e7c1d6 passe 448 tests Python, 200 tests API et 701 tests du site. Les 40 contrôles de mi-temps et les quatre scénarios de précision passent. | Intégration, revue et présentation des valeurs après validation de la maquette. [Précision](controles/reprises-midi/grade-4.tap) · [Vrais rangs publics](controles/reprises-midi/rangs-publics.json) |
| Classements, VI-29 | La migration 138 préserve les 1 086 observations des 60 éditions. Le premier candidat refusait un vrai tableau suédois et une correction complète. Le candidat 6d712c5a14 a passé 49 scénarios, la vérification des tableaux du Mondial et sept scénarios sur copies RDS. | L’observation japonaise historique reste affichée sous le mauvais millésime. La lecture qualifiée reste en correction et l’affectation des saisons relève de VI-21. [Renouvellement et calendrier intégral](CLASSEMENTS-ET-ELO.md) |
| Transferts et contrats, VI-31 | Le commit dc33b4fe59 conserve les 55 transferts testés sous trois réponses dégradées. 480 tests Python et 184 tests API passent. Le coordinateur a répété les deux contrôles ciblés. | Intégration et contre-revue. Sur 46 362 transferts, 26 450 manquent encore d’au moins un club canonique. [Suite Python](controles/reprises-midi/transfermarkt-480.txt) · [Suite API](controles/reprises-midi/transfermarkt-184.txt) |
| Archives, VI-27 | Parmi 494 713 rencontres, le rejeu retire uniquement les 240 copies russes ciblées. Les 154 versions sont stables au deuxième passage. Le test des 23 Mondiaux couvre 1 069 entrées et 67 mi-temps justifiées. | Les 100 copies allemandes et les références historiques restent en traitement. Les notes Elo et leurs paramètres conservent leurs propriétaires. [154 saisons](controles/reprises-midi/archives-154.json) · [23 Mondiaux](controles/reprises-midi/mondiaux-23.json) |
| Emblèmes, VI-30 et VI-27 | Le writer et les lecteurs ont été éprouvés avec 47 vrais emblèmes d’édition et 41 images distinctes, ainsi qu’avec les 16 profils de clubs des 48 matchs CAF sur les deux tailles d’écran. | CI commune, recherche et lots historiques. Le filtre SQL protège le visuel de famille. La réingestion du même logo par Store.entity change encore la version du lecteur sans changement de logo. Le hunk et le rejeu sont chez VI-21. [Réingestion](controles/reprises-midi/rejeu-logo-mondial.json) · [Handoff](https://linear.app/vegainteligence/issue/VI-21#comment-6103605a-5aff-4dfc-9a48-bc60edbb2b60) |


## Images, sources et suite

En production, **1 475/11 003 racines de club** et **82/208 compétitions** ont un visuel lié : 9 528 et 126 restent sans pointeur. Le lot authentifié courant contient **1 598 associations et 1 517 images distinctes**. Deux répétitions locales conservent les 1 611 anciens pointeurs et portent les comptes à **2 969 clubs et 186 compétitions** ; ce n’est pas une publication. Restent 8 034 racines et 22 compétitions sans lien sur copie. Une image vraie de famille n’est pas une preuve de validité pour chaque époque. Les 45 emblèmes historiques et les deux natifs sont distincts des cinq affiches ; l’organisateur belge U21, Lyon avant 1950 et les identités non résolues restent réservés. [Import vérifié](controles/etat-execution/visuels-repetition.json) · [Identités et visuels](CLASSEMENTS-ET-IDENTITES.md) · [Périmètre T7](controles/etat-execution/visuels-0713.txt)

PitchAPI alimente les observations natives ; FIFA, DFB et fédérations étayent les contrôles externes. SportScore porte les tableaux officiels (T2), Transfermarkt les compléments de personnes (T3), les adaptateurs d’archives les résultats et événements (T4). Les sources officielles/provenancées fournissent les images : T4 importe, T7 restitue. VI-21 conserve les identités et révisions des notes ; VI-19 les méthodes de prévision. [Matrice source → domaine](SOURCES.md) · [Responsabilités et conditions](SUIVI.md)

Astra a relu les réponses scientifiques corrigées. Fable a accepté le rapport d’équipe T6 et son premier avis sur les joueurs a conduit à un addendum. Sa nouvelle revue de cet addendum a été interrompue par le quota. Opus a terminé le lot des transferts. Les lots dont la session Opus s’est effectivement arrêtée ont été transmis à Sol 6.2 xhigh après vérification du verrou. La revue indépendante finale de la branche intégrée par Astra 6.2 xhigh et Fable 5.2 xhigh reste ouverte. [Preuves des scores d’équipe](CLASSEMENTS-ET-ELO.md) · [Calculs individuels](RECALCUL-JOUEURS.md)

## Vérifications complémentaires sur les dépendances

Les trois millésimes 2022 à 2024 ont 509 906 différences de plus de 0,01 point avec les Elo actuels. Sur les mêmes entrées, réintroduire les deux Elo enregistrés par les joueurs adverses ramène ce nombre à zéro. Le recalcul ordonné 2025 puis 2026 conserve 7 684 différences au même seuil pour 2026. [Trois expériences Elo et rattrapage ordonné](RECALCUL-JOUEURS.md)

Sur 88 275 tentatives PitchAPI du 17 au 18 novembre à 08 h UTC, aucun des 65 494 succès ne se répète pour le même couple famille–cible. Les huit requêtes du même fichier International Results restent un cas de mutualisation identifié dans l’autre collecteur. [Trafic par famille et statut](SOURCES.md#appels-pitchapi-sur-24-heures-complètes)

## Mondial des clubs et origine des blasons manquants

Les 63 matchs du tournoi 2025 et son barrage ont 128 Elo d’équipe et zéro note de joueur en production. Les feuilles officielles attestent 1 996 participations dans le tournoi et 36 dans le barrage. Les 33 clubs concernés ont désormais un visuel vérifié en production ou sur la copie. [Comptes, identités et sources](MONDIAL-DES-CLUBS-2025.md) · [Provenance des fiches de club sans logo](SOURCES.md#pourquoi-tant-de-clubs-restent-sans-blason)

## Mesure complète de 09 h 59 UTC

La troisième lecture complète a revérifié 2 149 éditions, soit 6 447 lignes par compétition, saison et type d’entité. Le détail et les 471 agrégats par saison et type d’entité sont identiques à ceux de 04 h 22 UTC. La couverture mesurée en production reste de 2 282 580 notes de joueur, 161 982 Elo de clubs et 1 864 Elo de sélections. Les participations externes attestées, telles celles du Mondial des clubs, sont documentées par édition. [Grille par édition et type](controles/notes-0959/coverage-by-edition-and-entity.csv.gz) · [Agrégats par saison](controles/notes-0959/coverage-by-season-and-entity.csv.gz) · [Deux lectures comparées](controles/notes-0959/comparaison-deux-transactions.json)

Sur le relevé des transferts à 09 h 41 UTC, une répétition sur copie conserve les 46 362 transferts et 12 570 contrats. Pour 26 450 transferts, il reste au moins un club canonique à raccorder. [Migration et clés fournisseur](BRANCHE.md#migration-139-sur-les-transferts-et-contrats-réels)

## Quatre éditions du Mondial des clubs

Sur les 86 matchs contrôlés, les organisateurs attestent 2 707 participations de joueurs. Vega conserve 172 valeurs Elo de côté et aucune note de joueur pour ces matchs. La finale Chelsea–Palmeiras a aussi un score à 90 minutes erroné en production. [Résultats par édition et filtre de calcul](MONDIAL-DES-CLUBS-2021-23.md)

## Résultats féminins saoudiens et succès de collecte vides

La fédération publie 28 résultats cette saison contre huit dans Vega. Les 28 feuilles attestent 831 participations et la base ne contient aucune note de joueuse pour ces matchs. Sur 304 éditions natives de PitchAPI, 487 matchs terminés ont une collecte de statistiques réussie sur le plan technique et aucune minute positive. Ces matchs ont 974 Elo et aucune note individuelle. [Sources par saison, requêtes et reproduction](PREMIERE-DIVISION-FEMININE-SAOUDIENNE.md)

## Disponibilité des indicateurs individuels et notes réellement servies

Parmi les 2 282 580 notes enregistrées, au moins 578 928 (25,36 %) ont un indicateur attendu indisponible dans leurs entrées conservées, après prise en compte des zéros que la méthode sait rétablir. Parmi elles, au moins 104 792 perdent un bloc entier. Ces deux nombres se recouvrent. Jonas Dakir apparaît avec 90 minutes et une note de 37,9 dans le classement malgré la seule présence du bloc distribution. Pour Marius Bülter en année de notation 2020, la fiche de performance répond 200 avec une note absente et le classement du match répond 404. Le contrôle de 11 h 57 a trouvé six exécutions de publication 2020 successives sans sortie. Le jeu de preuves contient les dates exactes, les ventilations, les captures publiques et le rejeu. [Indicateurs, feuilles et vérification autonome](controles/reprises-midi/rejeu-indicateurs-joueurs.zip) · [Reçu des vérifications](controles/reprises-midi/indicateurs-joueurs-recu.json)
