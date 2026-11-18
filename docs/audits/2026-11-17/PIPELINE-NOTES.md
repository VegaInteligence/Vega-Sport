# Où s’arrêtent les notes Vega

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

**1 742 participations nécessitent de connaître le poste.** Parmi elles, 1 732 avaient déjà leurs statistiques lors du dernier calcul publié et dix sont arrivées depuis. À elle seule, la Premier Soccer League sud-africaine 2025/26 concentre 1 110 lignes, avec des statistiques disponibles au plus tard le 12 novembre et une passe publiée le 17. La Saudi Pro League 2023/24 en concentre 132. Pour un poste absent, Vega recherche un poste observé dans les autres matchs de la même année de récompense, puis applique sa règle de poste générique ou l’indice spécifique au gardien. Les reçus comptent les apparitions sans poste direct. Ils ne contiennent pas le détail longitudinal par joueur permettant de conclure qu’aucun des 1 742 postes ne sera récupérable. [Détail chiffré et éditions](score-pipeline-evidence.txt) · [Requêtes de poste et résultats RDS](preuves/score-pipeline/pending_verified/) · [Requêtes de notes et résultats RDS](preuves/score-pipeline/grades_verified/).

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

Le seul **indice synthétique Vega d’équipe persisté à la granularité équipe × match** identifié dans le code déployé est l’Elo. `agg.team_elo` conserve la force avant et après match, le résultat attendu et le résultat constaté. Le recalcul des deux côtés utilise le score et l’enjeu. Toutes les **161 982** participations de clubs et **1 860** de sélections admises par le filtre Elo déployé ont une ligne valide au contrôle de 21:03 UTC. La politique déployée exclut notamment **986 961** participations de clubs d’archives identifiables. Une valeur persistée ne valide ni le statut amont d’un match, ni l’existence d’une note de performance sportive distincte.

Le classement de saison `agg.team_power` reprend la dernière force Elo. L’indice club 0–100 `agg.team_index` est indexé par **club et cohorte**. Les xG, xPts, statistiques d’équipe et probabilités en cours de match sont des mesures spécifiques. Aucune formule déployée ni stockage d’une note globale 0–100 évaluant la prestation de chaque club ou sélection sur ce seul match n’a été identifié. Une telle exigence demeure à spécifier et à implémenter si c’est la note attendue. [Définition et granularité de l’Elo](https://github.com/VegaInteligence/Vega-Sport/blob/8018e0836ca0f32e8b2eb51fc2847154abff7f13/backend/sql/032_power_rankings.sql#L39-L65) · [Clé de l’indice de cohorte](https://github.com/VegaInteligence/Vega-Sport/blob/8018e0836ca0f32e8b2eb51fc2847154abff7f13/backend/sql/009_agg_validated.sql#L1429-L1445).

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
