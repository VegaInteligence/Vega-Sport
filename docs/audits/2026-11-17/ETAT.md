# État au 18 novembre 2026

**Les correctifs restent candidats : la livraison globale n’est pas validée ni déployée.** Le dernier contrôle publié à 07 h 45 UTC identifie AWS `8018e0836c` et Vercel `17ca0f7617`. Les huit tickets clos ont été revérifiés ; les huit tickets de suivi restent actifs. [Versions et tickets](CLASSEMENTS-ET-IDENTITES.md#versions-contrôlées) · [Reçus de cet état](controles/etat-execution/faits.json)

## Exigences et production

Le document initial est décomposé en **38 critères : 12 implémentés en production, 24 incomplets et 2 manquants**. Leur état est identique sur la branche. Le registre complet contient **91 critères** : en production, 29 implémentés, 50 incomplets, 2 manquants et 10 sans objet ; sur la branche, 29 hérités de production, 4 implémentés sur branche, 53 incomplets, 2 manquants et 3 sans objet. Ces axes ne constituent pas un taux de validation scientifique. Les **26 calculs supplémentaires** ont leur inventaire distinct. [Critères](registres/requirements.csv) · [Calculs](registres/new-calculations.csv)

Les identités restent à corriger : 25 paires de clés de 13 clubs sont étayées sur leurs périodes ; les quatre saisons anciennes de Bundesliga contiennent 100 copies supplémentaires. Huit attributions LFP désignent Siriné Doucouré sur la ligne d’Henri. À Seongnam, les deux homonymes restent deux personnes ; les 313 rapprochements nominaux candidats n’autorisent pas une fusion. Ces ensembles se recoupent et ne donnent pas un nombre global de doublons. [Identités et sources](CLASSEMENTS-ET-IDENTITES.md) · [Copies et périodes](RENCONTRES.md)

**Joueurs : 2 297 613 entrées admises, 2 296 998 calculables, 2 282 580 publiées.** Les 14 418 calculables sans publication appartiennent à 2020 ; 615 entrées restent sans rôle. Le rejeu des sept millésimes trouve 517 588 écarts supérieurs à 0,01 point avec les entrées actuelles. Il ne prouve pas que les anciennes entrées étaient identiques. Les 615 cas sont analysés sur 587 matchs et 69 éditions ; aucun poste futur n’est présenté comme connu au jour du match. [Sept années de notation, dénominateur admis](RECALCUL-JOUEURS.md) · [615 cas](CLASSEMENTS-ET-IDENTITES.md#postes-manquants-et-identités-des-joueurs)

**Clubs et sélections : 163 846 côtés Elo pour 81 923 matchs admis**, dont 161 982 côtés de clubs et 1 864 de sélections. L’Elo commun est le score équipe × match ; le score club-saison sur 100 est une transformation distincte. Le classement des sélections expose l’Elo. Ces nombres ne garantissent ni l’absence de copies sportives ni la couverture des qualifications et archives. [Contrat et dénominateur](CONTRE-LECTURE.md) · [Grille par édition et entité](notes-transaction/coverage-by-edition-and-entity.csv.gz)

## Correctifs et validations par périmètre

| Lot et propriétaire conservé | Résultat vérifié | Ce qui reste ouvert |
| --- | --- | --- |
| Mi-temps — VI-28 ; précision — VI-32, T1 | 1 342 tests de CI au gel précédent ; 14 contrôles API mi-temps et 16 contrôles grade/match/rapport au checkpoint. | `coverage` expose les mesures partielles ; les anciens champs et le client gardent les totaux complets. Précision xG et `gradeExact` à terminer ; maquette distincte de l’implémentation. |
| SportScore — VI-29, T2 | **35 scénarios / 69 étapes** passent sur le candidat conservé ; la CI Python complète précédente reste en échec. | Trois nouveaux critères échouent : autorité multi-source, conservation des meilleurs troisièmes, exclusion de la petite finale du secours. Classification des tours : VI-21. |
| Transfermarkt — VI-31, T3 | Suite brute : **8 échecs et 14 erreurs** sur 32 tests ; diagnostic à horloge DB : **5 échecs et 14 erreurs**. Deux tests API passent. | Writer encore destructif, bloqué par la protection SQL ; terminer merge, 404, statut HTTP et concurrence. Les trois écarts d’horloge du harness ne sont pas des défauts métier. |
| Archives — VI-27, T4 | 665 résultats FIFA retrouvés sur branche ; répétition de 52 objets et 154 saisons, 240 copies ciblées retirées sur copie. | Dernière CI complète : six échecs Python et un frontend. Les preuves ponctuelles de conservation ne rendent pas toute la suite verte. |
| Visuels — VI-30, T7 ; import — T4 | 26 contrôles de parcours et 58 côtés par vue vérifiés antérieurement ; 12 tests API et 12 frontend au checkpoint. | Recherche générale Cymru North : 14/16 contrôles supplémentaires. Emblèmes d’édition et chaîne d’alias à finir ; pas de nouveau navigateur validant ces compléments. |

[Checkpoint et reçus par lot](controles/etat-execution/checkpoint-0713.txt) · [Trois nouveaux échecs SportScore](CLASSEMENTS-ET-IDENTITES.md) · [Détails de branche](BRANCHE.md)

## Images, sources et suite

En production, **1 475/11 003 racines de club** et **82/208 compétitions** ont un visuel lié : 9 528 et 126 restent sans pointeur. Le lot authentifié courant contient **1 584 associations et 1 503 images distinctes**. Deux répétitions locales conservent les 1 611 anciens pointeurs et portent les comptes à **2 955 clubs et 186 compétitions** ; ce n’est pas une publication. Restent 8 048 racines et 22 compétitions sans lien sur copie. Une image vraie de famille n’est pas une preuve de validité pour chaque époque. Les 45 emblèmes historiques et les deux natifs sont distincts des cinq affiches ; l’organisateur belge U21, Lyon avant 1950 et les identités non résolues restent réservés. [Import vérifié](controles/etat-execution/visuels-repetition.json) · [Identités et visuels](CLASSEMENTS-ET-IDENTITES.md) · [Périmètre T7](controles/etat-execution/visuels-0713.txt)

PitchAPI alimente les observations natives ; FIFA, DFB et fédérations étayent les contrôles externes. SportScore porte les tableaux officiels (T2), Transfermarkt les compléments de personnes (T3), les adaptateurs d’archives les résultats et événements (T4). Les sources officielles/provenancées fournissent les images : T4 importe, T7 restitue. VI-21 conserve les identités et révisions des notes ; VI-19 les méthodes de prévision. [Matrice source → domaine](SOURCES.md) · [Responsabilités et conditions](SUIVI.md)

Les réponses aux **neuf constats Fable T5 et huit T6** sont gelées à 07 h 42 ; Astra a approuvé ces rapports corrigés, sans approuver les modèles ou la production. Une nouvelle décision Fable et les revues finales des candidats restent nécessaires. Les dernières reprises Opus sont interrompues pour quota ; les mêmes sessions et worktrees sont conservés, sans assimiler leur préparation à une réussite. Intégrer les seuls lots acceptés, rejouer la CI commune et les deux revues, puis vérifier le déploiement autorisé. [Avis T5](controles/etat-execution/t5-astra-0742.txt) · [Avis T6](controles/etat-execution/t6-astra-0742.txt) · [Dernier checkpoint des reprises](controles/etat-execution/checkpoint-0713.txt)

## Vérifications complémentaires sur les dépendances

Les trois millésimes 2022 à 2024 ont 509 906 différences de plus de 0,01 point avec les Elo actuels. Sur les mêmes entrées, réintroduire les deux Elo enregistrés par les joueurs adverses ramène ce nombre à zéro. Le recalcul ordonné 2025 puis 2026 conserve 7 684 différences au même seuil pour 2026. [Trois expériences Elo et rattrapage ordonné](RECALCUL-JOUEURS.md)

Sur 88 275 tentatives PitchAPI du 17 au 18 novembre à 08 h UTC, aucun des 65 494 succès ne se répète pour le même couple famille–cible. Les huit requêtes du même fichier International Results restent un cas de mutualisation identifié dans l’autre collecteur. [Trafic par famille et statut](SOURCES.md#appels-pitchapi-sur-24-heures-complètes)
