# Publication et suivis

Le 18 novembre, le code AWS est `8018e0836c` et l’alias Vercel est sur `17ca0f7617`. Seul le journal de travail diffère. [Vérification ECS et Lambda](controles/production-aws-0317.json) · [Alias Vercel](controles/production-vercel-0318.json) Les mesures du 17 novembre ont été faites sur RDS dans des transactions en lecture seule. Le travail de correction se déroule sur `codex/production-architecture-audit`. Le projet demande que les décisions de changement des modèles et de réparation de la base partagée restent coordonnées dans les tickets actifs.

| Responsable | Écart établi | Condition de clôture |
| --- | --- | --- |
| VI-19 | Les modèles de match, saison, composition et cotes peuvent diverger, les objectifs réglementaires incluent de la prolongation, et des fixtures n’ont aucune prévision. | Reproduire les cas de la matrice, aligner la sélection et l’horodatage du modèle, comparer la sortie des routes et refaire l’évaluation temporelle. |
| VI-21 | Sept clubs coréens ont chacun deux fiches Vega vérifiées pour une seule identité officielle. Les dix paires de fiches joueurs d’Incheon ont retrouvé chacune un identifiant K League unique. Le Racing Club de France et Matra Racing gardent deux identités Vega pour un même historique officiel. Un même match peut fournir quatre lignes Elo et 64 notes pour 32 joueurs. | Conserver les identifiants fournisseurs, transférer les relations sans perdre les différences de mesures, puis rejouer les notes et démontrer l’idempotence de la prochaine ingestion. |
| VI-21 | 189 résultats officiels absents au Kazakhstan et en Pologne, 24 au pays de Galles, et Bochum–Hertha absent. Une rencontre ukrainienne interrompue affecte les forces des deux clubs. | Réconcilier les calendriers et décisions officielles au niveau de chaque rencontre, rattacher le fournisseur à l’identifiant canonique, puis rejouer toute la chaîne Elo concernée. |
| VI-21 | Les entrées positives sans résultat intermédiaire, les participants connus sans données suffisantes et les archives exclues de la politique ont des causes différentes. | Ventiler les raisons par édition et rôle, démontrer le rattrapage des entrées éligibles, conserver les cas insuffisants explicitement indisponibles. |
| VI-21 | La dernière mise à jour d’un vieux match peut tomber entre la lecture des statistiques joueurs et le début du calcul des niveaux servant de marqueur. | Lier le réveil au dernier état des entrées effectivement publié pour chaque millésime joueur. Rejouer une correction reçue exactement entre les deux lectures. |
| VI-21 | Les seuls indices synthétiques d’équipe recalculés pour chaque match sont les Elo avant et après. L’indice club 0–100 est calculé par cohorte. | Si le besoin porte sur une note de prestation propre au seul match, définir la méthode, les entrées requises et les exclusions, puis vérifier la persistance pour les clubs et sélections. |
| VI-21 | Huit projections du même CSV étaient dues simultanément en rejeu. Le pont Node a transféré 30 114 776 octets décompressés, y compris lors du passage identique à zéro modification sportive. | Partager un même téléchargement lorsque plusieurs périmètres arrivent à échéance, préserver la validation par édition et vérifier le nombre réel de requêtes par passage. |
| VI-27 | Les sources et les corrections de cette branche doivent être publiées et rejouées de manière vérifiable. | Refaire les vérifications du rapport sur le commit déployé, comparer les requêtes de couverture et confirmer les écritures, images servies, identifiants et anomalies retenues. |
| VI-21 / VI-27 | Des visuels authentiques ne se rattachent pas encore à un seul club. Certains homonymes et des éditions historiques n’ont pas d’emblème vérifiable. | Résoudre les identités avec preuves multiples, conserver les marques d’époque à leur édition, puis relancer l’import vérifié uniquement sur les associations établies. |

### Chantiers de code indépendants

- [VI-28](https://linear.app/vegainteligence/issue/VI-28) conserve les mesures de mi-temps et leurs supports dans le lecteur joueur.
- [VI-29](https://linear.app/vegainteligence/issue/VI-29) protège la dernière publication des classements officiels SportScore.
- [VI-30](https://linear.app/vegainteligence/issue/VI-30) relie les vrais visuels déjà présents aux fiches et aux compositions des rencontres de coupe.
- [VI-31](https://linear.app/vegainteligence/issue/VI-31) protège les transferts et les anciens contrats pendant les relectures du fournisseur. Le rapprochement global des personnes, clubs et compétitions garde son propriétaire initial.


### Versions de repli du worker

Les deux services ECS de production avaient le retour automatique à la version précédente activé. Le relevé de leurs trois déploiements réussis les plus récents a trouvé, pour chacun, les révisions 142, 141 et 140 et les images `8018e0836c`, `3a4234ae64` et `3d4bb282a0`. Aucune de ces images ne contenait le premier correctif d’archives `1b28961a88`. La révision 142 tournait sur les deux services à la vérification. Avant tout rejeu historique en production, il reste à vérifier les cibles de repli au moment du déploiement et à vider les anciens processus capables d’écrire. Reçus dans `deployment-rollback-facts.json` et `deployment-rollback-revisions.json`.

## Constats renvoyés aux responsables le 18 novembre

[VI-21](https://linear.app/vegainteligence/issue/VI-21) conserve la couverture du calendrier, les six attributions de Ligue 1 et les références de notes. Les observations du recalcul et les calendriers ont été communiqués à la session responsable. [Six affectations vérifiées](controles/six-attributions-ligue1.csv) · [Identités des joueurs](controles/six-attributions-personnes.csv)

[VI-30](https://linear.app/vegainteligence/issue/VI-30) conserve le correctif des emplacements de logos et de la recherche Cymru North. [Observation du DOM](controles/visuels-annuaire-observation.json) · [Carte du championnat U21](controles/visuels-annuaire-bureau.png) · [Carte de la CAN](controles/visuels-annuaire-mobile.png)

[VI-28](https://linear.app/vegainteligence/issue/VI-28) conserve la projection API par métrique. Une maquette utilisant les deux réponses de joueurs réelles illustre les taux et minutes observées. Le changement de présentation attend la validation du dessin. [Deux fiches et deux écrans](controles/maquette-mi-temps.json)

## Ordre de correction et critères de vérification

1. **Protéger les écritures.** VI-27, VI-29 et VI-31 ont des témoins où un rejeu, une réponse vide ou une erreur fait perdre un fait établi. Sur les copies, conserver les lignes existantes, conserver la décision de blocage en cas de conflit et passer le deuxième import sans changement sportif. Les modes dégradés et les traitements concurrents font partie du test.
2. **Rétablir les identités et les calendriers.** VI-21 arbitre chaque cas avec les sources datées puis conserve les identifiants bruts des fournisseurs et les relations historiques. Vérifier un résultat officiel unique, les deux côtés, les titulaires, les entrées et les cas administratifs aux éditions touchées. Répéter sur deux imports, avec comptage des requêtes et des écritures réelles.
3. **Recalculer les scores depuis les faits corrigés.** VI-21 conserve les contributions, la version des références et la raison d’une absence. VI-19 vérifie ensuite les prévisions sur les données disponibles à leur date de publication. Comparer les valeurs attendues et persistées par compétition, saison et type d’entité, les effets en aval d’une correction, les seuils des lecteurs et les cas sans données suffisantes.
4. **Vérifier les lecteurs et les visuels.** VI-28 et VI-30 vérifient les taux et minutes par métrique, les routes canoniques et fournisseur, les images décodées et les véritables absences sur les deux écrans. Le rattachement d’une image reprend les décisions d’identité de la deuxième étape.
5. **Intégrer et contrôler le déploiement.** VI-27 rassemble les lots validés et les revues indépendantes. Rejouer la suite intégrée et les contrôles sur le contenu qui sera déployé. Après mise en production autorisée, relever séparément Vercel, ECS, Lambda et RDS, puis contrôler la première collecte, le rattrapage historique et les routes publiques.

## Contrôles CAN et logos du Mondial

[VI-21](https://linear.app/vegainteligence/issue/VI-21) conserve l’enrichissement des participations CAN et le calcul des notes. [Trois éditions](controles/can-editions.csv) · [Feuilles, changements et rejeu hors ligne](controles/can/README.md) · [Capture RDS](controles/can-capture-rds.json)

[VI-30](https://linear.app/vegainteligence/issue/VI-30) conserve les lecteurs et [VI-27](https://linear.app/vegainteligence/issue/VI-27) l’import des visuels datés. Le lecteur public du Mondial charge l’emblème « 26 » lorsqu’on sélectionne 1930 puis 2018. Les deux visuels de familles 64 et 198 renvoyés par le proxy public ont les empreintes des objets en base. Sur 2 149 éditions, le schéma de production ne possède aucun rattachement de visuel d’édition. Les 45 emblèmes vérifiés couvrent 16 familles, avec 41 images distinctes. Cinq affiches historiques restent classées comme affiches. Les familles chiffrées comme illustrées peuvent donc encore contenir une image vraie attribuée à la mauvaise époque. [50 rattachements datés](controles/logos-edition-50-candidats.csv) · [Reçu du proxy public](controles/mondial-logos-familles.json) · [Comparaison visuelle](controles/mondial-comparaison.png)
