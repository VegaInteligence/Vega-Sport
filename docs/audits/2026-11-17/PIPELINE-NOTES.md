# Où s’arrêtent les notes Vega

Les contrôles ultérieurs détaillent les premières années de notation, le support des gardiens, le rattrapage sud-africain et les entrées réelles du calcul des équipes. [Contre-lecture du 18 novembre](CONTRE-LECTURE.md)

Le 17 novembre, les passes de mesure de 21:06 à 21:07 UTC ont trouvé **2 249 579 participations** avec minutes positives admises par la requête joueurs. **2 229 830** avaient une contribution calculée, une référence utilisable et une note finale concordante en base. Les **19 749 restantes** n’avaient aucune ligne intermédiaire dans `agg.player_power_matches`. Aucune ligne déjà calculée n’avait perdu sa note lors de la persistance. La note requiert aussi un poste identifiable et des mesures exploitables.

## Retard de collecte ou information insuffisante

Le diagnostic détaillé des postes a lu les six partitions de 21:05:04 à 21:06:12 UTC. Il y a trouvé **19 512** absences intermédiaires. Pendant la collecte, l’écart entre cette lecture et celle des notes passe de 17 793 à 18 030 pour la seule partition 2021. Les 237 lignes supplémentaires expliquent la différence arithmétique entre les deux totaux. Leur état individuel n’a pas été apparié.

| Saison de la compétition | Sans intermédiaire à la lecture des notes | Sans intermédiaire au diagnostic de poste | Poste déterminable directement et touches mesurées | Poste à rechercher dans les autres apparitions |
|---|---:|---:|---:|---:|
| 2021/22 | 18 030 | 17 793 | 17 770 | 23 |
| 2022/23 | 113 | 113 | 0 | 113 |
| 2023/24 | 275 | 275 | 0 | 275 |
| 2024/25 | 88 | 88 | 0 | 88 |
| 2025/26 | 1 185 | 1 185 | 0 | 1 185 |
| 2026/27 | 58 | 58 | 0 | 58 |
| **Total** | **19 749** | **19 512** | **17 770** | **1 742** |

**17 770 participations peuvent atteindre l’étape intermédiaire avec les données présentes.** Elles appartiennent toutes à l’année de récompense 2021/22 et leurs statistiques ont été écrites après le début de la dernière passe publiée, à 19:47:16 UTC. Le worker a annoncé la réussite de cette passe à 19:52:30. Les plus gros volumes sont la MLS (1 999), le Championship (1 361), la Liga MX (1 186), la Ligue des champions (984), la Conference League (980), la Ligue Europa (975) et la Ligue 1 (921). Le rejeu doit encore trouver au moins un bloc mesurable et une distribution adaptée au poste pour produire la note finale. Les touches seules, en particulier pour un gardien, ne garantissent pas ces deux conditions.

**1 742 participations nécessitent de connaître le poste.** Parmi elles, 1 732 avaient déjà leurs statistiques lors du dernier calcul publié et dix sont arrivées depuis. À elle seule, la Premier Soccer League sud-africaine 2025/26 concentre 1 110 lignes, avec des statistiques disponibles au plus tard le 12 novembre et une passe publiée le 17. La Saudi Pro League 2023/24 en concentre 132. Pour un poste absent, Vega recherche un poste observé dans les autres matchs de la même année de récompense, puis applique sa règle de poste générique ou l’indice spécifique au gardien. Les reçus comptent les apparitions sans poste direct. Ils ne contiennent pas le détail longitudinal par joueur permettant de conclure qu’aucun des 1 742 postes ne sera récupérable. [Détail chiffré et éditions](score-pipeline-evidence.txt) · [Requêtes de poste et résultats RDS](preuves/score-pipeline/pending_verified/) · [Requêtes de notes et résultats RDS](preuves/score-pipeline/grades_verified/). La mesure nominative du 18 novembre retrouve 14 entrées encore sans poste sur 5 537 dans cette édition. [Vérification PSL](contre-lecture/joueurs/psl-lineage/pending-current-14.csv)

## Ce qui déclenche le calcul

Le code de production `8018e0836c` relie les opérations suivantes.

1. `backend/vega/store.py:756–798` compare l’empreinte de la famille reçue. Une modification des statistiques ou de la composition met à jour le match, sa révision et les calculs dérivés à reprendre.
2. `backend/vega/worker.py:93–158` choisit les saisons à reprendre. Le délai habituel est d’une heure pour une saison récemment jouée et de six heures pour une ancienne saison en cours de collecte. La boucle essaie de nouveau après une erreur et vérifie les échéances une minute après la fin de la passe précédente. CloudWatch montre deux passes 2021 réussies le même jour, à 13:47:50 et 19:52:30 UTC. La lecture à 21:05 était encore dans ce délai historique. [Journal du worker](score-pipeline-worker.tsv).
3. `backend/vega/power.py:1016–1037,1134–1163,1486–1598` sélectionne les matchs natifs terminés dans l’année du 1ᵉʳ août au 31 juillet, avec temps de jeu positif et équipe reconnue. Un rôle impossible à déterminer enlève l’apparition avant l’écriture de la ligne intermédiaire. Un rôle résolu suffit pour cette ligne. Le calcul de sa note exige ensuite une contribution et une référence au poste. L’écriture des contributions et des notes est transactionnelle. Le seuil d’affichage des entrées courtes masquait **329 476** notes déjà calculées.
4. **Une fenêtre de rattrapage reste fragile pour les saisons anciennes.** Le planificateur compare la dernière modification des matchs au début du calcul des niveaux (`agg.calc_runs.kind='levels'`). Or `models.refresh_daily` calcule les joueurs avant les niveaux (`backend/vega/models.py:792–800`). Une dernière correction reçue entre les deux lectures peut ne susciter aucune nouvelle passe s’il n’arrive plus rien pour cette saison. Ce risque découle du code. Les 17 770 écritures observées après la passe restent compatibles avec le délai de six heures. Pour le lever, rattacher la reprise au point de lecture du calcul joueurs effectivement publié et tester une correction isolée à cet instant, y compris pour un match de juillet rattaché à l’année de récompense précédente.

## Joueurs des clubs, coupes et sélections

| Domaine | Matchs déclarés terminés | Participations avec minutes positives | Notes joueurs validées |
|---|---:|---:|---:|
| Compétitions natives de clubs | 75 187 | 2 244 296 | 2 224 547 |
| Coupes du monde natives 2022 et 2026 | 168 | 5 283 | 5 283 |
| Compétitions complémentaires de clubs | 5 859 | 0 observée | 0 |
| Compétitions complémentaires de sélections | 924 | 0 observée | 0 |
| Archives historiques | 494 372 | 0 observée | 0 |

Les **5 283** notes internationales natives proviennent de 1 995 apparitions en 2022 et 3 288 en 2026. Les compositions, événements, tirs et statistiques réunissent des indices de jeu sur **2 260 025** participations. Les collectes signalent 8 820 participants observés sans ligne de statistiques et 1 895 sans minutes mesurées, lors de requêtes distinctes à des instants voisins. Les archives peuvent comporter des noms libres de buteurs. La base ne dispose pas pour autant d’une composition, des minutes et des mesures attribuées à chaque joueur. La requête joueurs exclut en outre explicitement les éditions complémentaires et d’archives. Un rejeu avec les mêmes entrées ne peut pas fournir leur couverture historique. Le nombre de matchs terminés ci-dessus reprend les statuts en production, y compris les anomalies documentées dans l’audit des sources. [Grille par édition et entité](releve-21h-coverage-by-edition-and-entity.csv.gz) · [Contrôle indépendant des totaux](controle-grille-21h.json).

## Que signifie une note d’équipe par match ?

Le seul **indice synthétique Vega d’équipe persisté à la granularité équipe × match** identifié dans le code déployé est l’Elo. `agg.team_elo` conserve la force avant et après match, le résultat attendu et le résultat constaté. Le recalcul des deux côtés utilise le score et l’enjeu. Toutes les **161 982** participations de clubs et **1 860** de sélections admises par le filtre Elo déployé ont une ligne valide au contrôle de 21:03 UTC. La politique déployée exclut notamment **986 961** participations de clubs d’archives identifiables. Une valeur persistée ne valide ni le statut amont d’un match, ni l’existence d’une note de performance sportive distincte. Le run 2097 porte ce total à 163 846 côtés, dont 1 864 de sélections. Le sort des rencontres archivées entre clubs déjà cotés reste à décider.

Le classement de saison reprend le dernier Elo. Pour un club et une saison, le lecteur transforme cette force en score sur 100 par rapport à la référence masculine des ligues. Le classement des sélections sert leur Elo. L’indice descriptif de club est calculé par cohorte. Aucune note synthétique de prestation d’équipe sur 100 par match n’a été identifiée. [Contrat de lecture](controles/contrat-score-equipe.md) · [Témoin sur les routes](contre-lecture/equipes/score-witness.json)

Pour reproduire les chiffres depuis les reçus de lecture fournis, lancer `python3 delivery/score-pipeline-evidence.py` à la racine du dossier de preuves. [Script](score-pipeline-evidence.py) · [Points de mesure UTC](horaires-notes-21h.csv).

## Rejeu vérifié sur 23 participations

À **21:43:21 UTC**, 21 participations dont le poste et les touches étaient disponibles restaient sans ligne de calcul ni note en production. Leurs matchs et statistiques n’avaient pas changé depuis le relevé de 21:05. La sélection déterministe prend cinq joueurs de champ et deux gardiens dans chacune des trois éditions 2021/22 de Ligue 1, de Ligue des champions et de MLS. Le dernier calcul publié était toujours le nº 2089.

**Les 21 ont produit une note Vega, de 17,39 à 78,45 sur 100.** Le rejeu utilise les sept postes et les 178 217 participations de l’année de récompense, l’Elo d’avant-match et les fonctions du worker déployé pour calculer les contributions, ajuster les références et convertir les indices en notes. Vingt notes satisfont le seuil d’affichage. Le joueur 1011 en MLS a une note de 53,64 pour sept minutes, masquée par la règle des entrées courtes. Deux témoins supplémentaires, les joueurs 14126 en Ligue 1 et 63889 en A-League, avaient chacun une seule apparition annuelle, sans poste ni statistique spécifique de gardien. Le calcul a bien laissé leur note absente.

Le rejeu n’a écrit aucune donnée en production. Une seconde exécution locale a reproduit les blocs, contributions, indices et notes depuis les entrées et références conservées, à une tolérance de 10⁻¹². La récupération numérique est démontrée pour ces **21 cas**. L’échantillonnage ciblé ne permet pas d’attribuer un taux de réussite aux 17 770 participations. [Résultats individuels](preuves/score-replay/results.tsv) · [Vérificateur hors ligne](preuves/score-replay/offline.py) · [Reproduction et reçus](preuves/score-replay/README.md).

## Publication historique observée le 18 novembre

La passe automatique 2098 a publié 21 notes sur les 23 clés de 2021/22 suivies depuis minuit. Le seuil de la fiche performance en montre 20. Deux rôles demeurent indéterminés. Le relevé toutes saisons compte 52 750 notes valides de plus que les comptages partitionnés de la veille. Le groupe de 15 033 couples en attente à 02 h 02 comprend 14 418 postes attribuables et 615 rôles non résolus. [Grille par compétition, saison et entité](notes-transaction/README.md)

Le total de 2 308 335 clés est une mesure des identifiants présentant un indice de jeu. Sur les 8 808 identifiants sans statistiques de match, 7 878 proviennent de la première sélection de clés et 930 de l’ajout d’un acteur de tir ou d’un but. Huit autres entrent par ce supplément sans minutes mesurées. Deux noms d’acteurs supplémentaires sont contredits par les feuilles de match. La soustraction de deux à un total global ne déduirait pas le nombre réel de participants.

Les 46 réponses des invocations directes de Lambda à 02 h concordent octet pour octet avec les 46 réponses HTTPS signées de l’origine AWS à 02 h 22. Pour le joueur de sept minutes et Moutoussamy (une minute), la fonction frontend qui prépare les lignes du match obtient respectivement 53,7018 et 55,0536, tandis que leurs notes de fiche et de classement sont nulles. À 02 h 51 UTC, le tableau du match déployé sur Vercel affiche 54 pour Alexandru Mățan sur sept minutes et 55 pour Samuel Moutoussamy sur une minute. Les lecteurs publics de performance et de classement renvoient une note nulle pour ces deux apparitions. [Mățan dans le tableau du match](controles/matan-tableau.png) · [Moutoussamy dans le tableau du match](controles/moutoussamy-tableau.png) · [Requêtes du navigateur](controles/lecteurs-cameos.json)

## Contrôle des références de chaque note publiée

Les 2 282 580 notes publiées ont été recalculées à partir des contributions internes conservées et des quantiles disponibles le 18 novembre à 02 h 59 UTC. L’arrondi à l’entier change pour 1 083 notes avant application d’un seuil de lecture. Les 7 681 écarts supérieurs à 0,01 point appartiennent tous au millésime 2026, dont 550 supérieurs à 0,1. Le maximum des années terminées vaut 0,001439089 point. Le plus grand écart de 2026 concerne Raymond Daniels (88 minutes), publié à 25,629711 et recalculé à 25,173153. Les 32 plus grands écarts dépassent une borne conservatrice comprenant les arrondis et la tolérance d’écriture. La publication 2026 précède de deux secondes le lancement d’une nouvelle publication des références 2025. La version exacte des quantiles utilisée par chaque note n’est pas archivée. L’attribution des écarts à ce seul changement reste ouverte. [Par millésime](controles/notes-rejeu-contributions-annees.csv) · [Par édition](controles/notes-rejeu-contributions-editions.csv.gz) · [Lectures publiques et agrégats](controles/notes-rejeu-contributions.json) · [Bornes numériques](controles/notes-rejeu-marges.json)

Une seconde lecture compare les intermédiaires conservés aux notes dont la dernière écriture est plus ancienne. Les 630 929 petits écarts restent sous la tolérance de 0,0001 de l’indice. Ils changent 358 arrondis entiers, dont 284 satisfont les conditions de lecture de la fiche performance. Ces mesures portent sur une comparaison différente du rejeu des contributions. [Comparaison des deux lectures](controles/notes-rejeu-contributions.json)

À la Copa América 2024, les 32 matchs et les 64 valeurs Elo des sélections existent. Les 1 010 apparitions attestées (704 titulaires et 306 entrants, 339 personnes) n’ont aucune composition, statistique individuelle ni note dans Vega pour ces matchs. Les dates de naissance et les sources d’identité permettent déjà de relier 838 apparitions à 269 personnes de Vega. La correspondance reste ouverte pour 172 apparitions de 70 personnes. Les données événementielles indépendantes attestent au moins une action pour chaque apparition. La complétude et les conditions de réutilisation des champs nécessaires au calcul restent à établir. [Contrôle Copa América](controles/copa-2024.json) · [64 côtés](controles/copa-2024-participations-equipes.csv) · [Feuilles vérifiées](controles/copa-2024-feuilles.csv.gz)

## CAN masculine, faits disponibles par participation

Les 156 matchs des phases finales de la CAN masculine 2021, 2023 et 2025 sont en base, avec les 312 valeurs Elo des sélections. Les feuilles et les changements ESPN attestent respectivement 1 567, 1 607 et 1 612 apparitions, soit 4 786 au total. Vega ne conserve aucune statistique individuelle et aucune note joueur sur ces matchs. En 2023, une seconde source événementielle confirme les 1 144 titulaires et les 463 entrants. Les 32 rapports techniques CAF consultables corroborent 981 apparitions. [Trois éditions](controles/can-editions.csv) · [Feuilles, changements et rejeu hors ligne](controles/can/README.md) · [Capture RDS](controles/can-capture-rds.json)

Sur 980 lignes individuelles comparables entre la CAF et StatsBomb, 191 concordent sur les passes tentées, 268 sur les passes réussies et 917 sur les tirs. ESPN donne zéro sur toutes les 113 lignes d’arrêts de gardien en 2021 et les 1 612 lignes de tirs subis en 2025. Une apparition prouvée établit qui a joué. La possibilité de calculer la note Vega dépend encore des entrées exigées pour le poste. [Comparaison des conventions](controles/can-comparaison-statistiques.json) · [Disponibilité des champs ESPN](controles/can-champs-espn.csv)

## Deux instantanés RDS et lecture réelle des notes

Le second relevé RDS du 18 novembre à 04 h 22 UTC couvre les 2 149 éditions et 157 saisons en une transaction. Les 44 requêtes SQL et le calcul distinct des côtés Elo donnent les mêmes lignes qu’à 02 h 02 UTC. Les 6 447 lignes par édition et type et les 471 lignes par saison et type sont identiques à l’octet près. Les 15 033 participations à minutes positives sans indice demeurent en attente. [Rejeu comparé](controles/releve-notes-0422-comparaison.json) · [Reçu ECS et RDS](controles/releve-notes-0422-recu.json)

Sur Orenbourg–CSKA, PitchAPI donne 7,52 à Aleksei Tataev. Le lecteur de performance de Vega donne 48,490343. La fiche publique affiche 48 au départ puis 49 quand arrive le classement, qui arrondit d’abord à 48,5. Le changement a été reproduit en navigateur sur mobile et ordinateur. Sur 1 945 601 notes admissibles au rang, 97 029 prennent ainsi un point de plus à l’affichage, soit 4,987 %. Le comptage est indépendant du rejeu des références du modèle. VI-32 porte la précision de lecture. VI-21 garde la règle de visibilité de courte durée. [Recalcul avec les types du lecteur](controles/arrondi-lecteur-six-partitions.json) · [Six partitions](controles/arrondi-lecteur-six-partitions.csv) · [Témoins navigateur](controles/arrondi-lecteur-navigateur.json) · [Avant classement](controles/note-avant-classement.png) · [Après classement](controles/note-apres-classement.png)

La lecture de 46 joueurs d’Orenbourg–CSKA confirme l’absence de substitution par une note fournisseur. Sur les deux millions de notes internes valides, la projection pleine conserve également 336 979 valeurs masquées dans le classement du match. Le nombre mesure les réponses qui peuvent être servies. Six cas sont effectivement observés sur ce match. La cohérence de cette règle selon le lecteur reste chez VI-21. [Normalisation réelle du fournisseur](controles/notes-fournisseur-temoin.json)

## Scores bruts en Coupe d’Allemagne

La DFB publie le score à la mi-temps pour chacun des 111 matchs terminés de la Coupe d’Allemagne 2025/26 et 2026/27 au 18 novembre. Les 110 valeurs présentes dans le flux OpenLigaDB concordent. La projection écarte les 110 et le writer laisse les colonnes vides. Le match Hertha–Fribourg, 0–0 à la pause selon la DFB, est le seul où le fournisseur omet cette information. En prolongation, huit scores natifs étiquetés « After90Minutes » contredisent l’organisateur. Les 21 paires à 90 minutes manquent en base. Sur treize séances, onze paires conservées comprennent aussi les buts du match. Les 111 scores de jeu finaux restent exacts. Le rejeu et RDS concordent sur les 119 clés natives, dont huit rencontres à venir. Les éditions OpenLigaDB ont une clé de coupe. Le lecteur d’apprentissage des pronostics filtre ces éditions. [119 rencontres par phase](controles/dfb-coupe-119-phases.csv) · [111 feuilles officielles](controles/dfb-coupe-111-feuilles.json.gz) · [Relevé RDS](controles/dfb-coupe-rds-0541.json)

## Date des données utilisées dans la composition et les notes

Dans un contrôle sur les fonctions de production, les entrées de l’ancien match et le dernier référentiel de notes sont fixes. Ajouter des observations ultérieures au référentiel des primitives suffit à modifier la note et la variable de composition d’équipe utilisée par la prévision suivante. À 0,6 npxG, les deux valeurs restent à l’intérieur des quantiles. La note passe de 86,1519 à 48,2575 et la variable de composition de 0,104350 à −0,004013. Ce contrôle synthétique établit la dépendance dans le code. Son effet sur les prévisions effectivement émises reste inconnu. Les 41 tests existants de puissance et six de composition passent aussi. [Entrées, bornes et résultats](controles/prevision-composition-temoin.json) · [Commandes et tests](controles/prevision-composition-recu.json)

RDS conserve sept jours de restauration ponctuelle sur l’instance du projet. La fenêtre observée couvre les publications 2095 et 2096. Une restauration privée à l’instant précédant la réécriture est une piste pour vérifier les anciens quantiles. Le catalogue consulté ne contenait aucune tâche d’export RDS de cette instance. Le contenu de cette restauration reste à vérifier. Les quantiles actuellement conservés ont été capturés séparément pour les comparaisons avec les publications futures. Entre 02 h 59 et 05 h 54 UTC, les cinq référentiels, les contributions, les valeurs standardisées et les identifiants de publication des 37 participations témoins sont restés identiques. [Fenêtre effectivement disponible](controles/fenetre-rds-quantiles.json) · [37 participations sur deux relevés](controles/quantiles-temoins-0554.json)

## Belgique U21, participations et résultat administratif

Les 42 feuilles officielles de matchs joués établissent 924 titularisations et 364 entrées en jeu, soit 1 288 participations. Les 217 autres inscriptions sur le banc ne prouvent aucune entrée. La grille RDS enregistre zéro statistique joueur, zéro minute positive et zéro note pour l’édition. Les feuilles établissent les présences. La disponibilité des autres entrées du calcul reste à démontrer. [Participations par feuille](controles/belgique-u21-participations.csv) · [Sources et empreintes](controles/belgique-u21-preuves-participations.json)

Seraing–Beerschot, le 18 septembre, reçoit le statut fédéral de forfait et un score administratif de 0–5. Vega le marque terminé et s’en sert pour donner deux notes Elo en plus des 84 côtés des matchs joués. Le calcul 2097 perd 12,31 points pour Seraing et les donne à Beerschot. Retirer cette seule observation à niveaux d’entrée fixes modifie les cotes Elo après match sur 32 côtés, 16 rencontres ultérieures et neuf équipes, jusqu’au 13 novembre. L’écart maximal est de 11,97 points. La validation reproduit les 163 846 côtés du scénario publié à un pas de représentation près. [Forfait dans RDS](controles/belgique-u21-forfait-rds.json) · [Rejeu](controles/belgique-u21-elo-sensibilite.json) · [32 côtés ultérieurs](controles/belgique-u21-elo-32-cotes.csv)

Les six sorties de comparaison ont été reproduites à l’octet à partir des entrées gelées. [Reçu et commande](controles/belgique-u21-rejeu.json)

[Recalcul de sept millésimes depuis les statistiques et comparaison aux six lecteurs publics](RECALCUL-JOUEURS.md)

## Mondial des clubs 2025 et barrage

[64 matchs, 128 Elo, aucune note de joueur stockée et 2 032 participations établies](MONDIAL-DES-CLUBS-2025.md)
