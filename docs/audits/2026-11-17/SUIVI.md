# Publication et suivis

La production vérifiée a servi le commit `8018e0836ca0f32e8b2eb51fc2847154abff7f13`. Les mesures du 17 novembre ont été faites sur RDS dans des transactions en lecture seule. Le travail de correction se déroule sur `codex/production-architecture-audit`. Le projet demande que les décisions de changement des modèles et de réparation de la base partagée restent coordonnées dans les tickets actifs.

| Responsable | Écart établi | Condition de clôture |
| --- | --- | --- |
| VI-19 | Les modèles de match, saison, composition et cotes peuvent diverger, les objectifs réglementaires incluent de la prolongation, et des fixtures n’ont aucune prévision. | Reproduire les cas de la matrice, aligner la sélection et l’horodatage du modèle, comparer la sortie des routes et refaire l’évaluation temporelle. |
| VI-21 | Sept clubs coréens ont chacun deux fiches Vega vérifiées pour une seule identité officielle. Les dix paires de fiches joueurs d’Incheon ont retrouvé chacune un identifiant K League unique. Le Racing Club de France et Matra Racing gardent deux identités Vega pour un même historique officiel. Un même match peut fournir quatre lignes Elo et 64 notes pour 32 joueurs. | Conserver les identifiants fournisseurs, transférer les relations sans perdre les différences de mesures, puis rejouer les notes et démontrer l’idempotence de la prochaine ingestion. |
| VI-21 | 189 résultats officiels absents au Kazakhstan et en Pologne, 24 au pays de Galles, et Bochum–Hertha absent. Une rencontre ukrainienne interrompue affecte les forces des deux clubs. | Réconcilier les calendriers et décisions officielles au niveau de chaque rencontre, rattacher le fournisseur à l’identifiant canonique, puis rejouer toute la chaîne Elo concernée. |
| VI-21 | Les entrées positives sans résultat intermédiaire, les participants connus sans données suffisantes et les archives exclues de la politique ont des causes différentes. | Ventiler les raisons par édition et rôle, démontrer le rattrapage des entrées éligibles, conserver les cas insuffisants explicitement indisponibles. |
| VI-21 | La dernière mise à jour d’un vieux match peut tomber entre la lecture des statistiques joueurs et le début du calcul des niveaux servant de marqueur. | Lier le réveil au dernier état des entrées effectivement publié pour chaque millésime joueur. Rejouer une correction reçue exactement entre les deux lectures. |
| VI-21 | Les seuls indices synthétiques d’équipe recalculés pour chaque match sont les Elo avant et après. L’indice club 0–100 est calculé par cohorte. | Si le besoin porte sur une note de prestation propre au seul match, définir la méthode, les entrées requises et les exclusions, puis vérifier la persistance pour les clubs et sélections. |
| VI-21 | Huit projections internationales prévues depuis la même ressource CSV ont des échéances autonomes. | Partager un même téléchargement lorsque plusieurs périmètres arrivent à échéance, préserver la validation par édition et vérifier le nombre réel de requêtes par passage. |
| VI-27 | Les sources et les corrections de cette branche doivent être publiées et rejouées de manière vérifiable. | Refaire les vérifications du rapport sur le commit déployé, comparer les requêtes de couverture et confirmer les écritures, images servies, identifiants et anomalies retenues. |
| VI-21 / VI-27 | Des visuels authentiques ne se rattachent pas encore à un seul club. Certains homonymes et des éditions historiques n’ont pas d’emblème vérifiable. | Résoudre les identités avec preuves multiples, conserver les marques d’époque à leur édition, puis relancer l’import vérifié uniquement sur les associations établies. |

### Chantiers de code indépendants

- [VI-28](https://linear.app/vegainteligence/issue/VI-28) conserve les mesures de mi-temps et leurs supports dans le lecteur joueur.
- [VI-29](https://linear.app/vegainteligence/issue/VI-29) protège la dernière publication des classements officiels SportScore.
- [VI-30](https://linear.app/vegainteligence/issue/VI-30) relie les vrais visuels déjà présents aux fiches et aux compositions des rencontres de coupe.
- [VI-31](https://linear.app/vegainteligence/issue/VI-31) protège les transferts et les anciens contrats pendant les relectures du fournisseur. Le rapprochement global des personnes, clubs et compétitions garde son propriétaire initial.
