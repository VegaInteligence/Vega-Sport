[Situation consolidée, mesures et correctifs du 18 novembre](SITUATION.md) · Cette page conserve les constats et les limites à la date de chaque relevé.

# Notes joueurs recalculées depuis les statistiques de match

**Sur les 2 282 580 notes publiées, 517 588 diffèrent de plus de 0,01 point avec les entrées actuelles du même algorithme Vega.** Parmi elles, 122 268 diffèrent de plus de 0,1 et 2 713 de plus d’un point. La plus grande différence atteint 12,714 points. Les sept lectures ont eu lieu le 18 novembre 2026 entre 08 h 21 et 08 h 44 UTC. La comparaison permet de mesurer la convergence sur les données actuelles. Les entrées contemporaines de chaque publication historique restent en partie inconnues.

| Millésime | Entrées admises | Sans poste | Calculables | En base | Écart > 0,01 | > 0,1 | > 1 | Maximum sur 100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2020 | 14 427 | 9 | 14 418 | 0 | 0 | 0 | 0 | Aucune note publiée |
| 2021 | 202 979 | 68 | 202 911 | 202 911 | 0 | 0 | 0 | 0,001 |
| 2022 | 265 707 | 135 | 265 572 | 265 572 | 20 943 | 908 | 0 | 0,437 |
| 2023 | 370 490 | 214 | 370 276 | 370 276 | 143 708 | 20 375 | 122 | 3,180 |
| 2024 | 561 558 | 94 | 561 464 | 561 464 | 345 255 | 100 435 | 2 591 | 12,714 |
| 2025 | 652 977 | 75 | 652 902 | 652 902 | 1 | 0 | 0 | 0,010 |
| 2026 | 229 475 | 20 | 229 455 | 229 455 | 7 681 | 550 | 0 | 0,457 |

Le millésime de notation commence le 1er août. Les 448 couples millésime–édition avec entrées indiquent aussi la saison où est stocké le match. La grille complète couvre 2 149 éditions, dont celles sans données individuelles. Les 615 entrées sans poste sont identifiées séparément. Sur les 14 427 entrées du premier millésime, 14 418 peuvent recevoir un indice calculé avec le périmètre partiel disponible. Les deux lectures de 2020 présentent la même empreinte brute et le rejeu intégral hors ligne retrouve les 14 418 résultats. Leur publication et le choix du référentiel pour cette année partielle restent ouverts. [Détail par édition](controles/recalcul-depuis-stats/editions.csv) · [Rejeu intégral 2020](controles/recalcul-depuis-stats/2020-hors-ligne.json) · [Les 615 cas sans poste](CLASSEMENTS-ET-IDENTITES.md) · [Grille complète](notes-transaction/README.md)

## Ce que reçoit le lecteur public

La route de performance a répondu HTTP 200 pour la clé qui présentait le plus grand écart de chaque millésime publié. Les six réponses retrouvent la note enregistrée dans RDS à moins de 0,00001 point. Au total, 50 139 participations changeraient d’entier avant application des règles de visibilité. Ce décompte concerne les valeurs du modèle. Le double arrondi du classement est un défaut de présentation distinct. [Six réponses et identifiants de calcul](controles/recalcul-depuis-stats/six-notes-publiques.json)

| Joueur | Saison | Compétition | Minutes | Note servie | Recalcul actuel |
| --- | --- | --- | ---: | ---: | ---: |
| Louie Watson | 2021/22 | Championship | 82 | 46,906 | 46,905 |
| Tammy Abraham | 2022/23 | Europa League | 90 | 25,135 | 25,572 |
| Omar Marmoush | 2023/24 | Conference League | 71 | 36,123 | 32,944 |
| Jonathan Ikoné | 2024/25 | Conference League | 90 | 50,875 | 38,161 |
| Marcelo Allende | 2025/26 | Premier Soccer League | 90 | 38,460 | 38,449 |
| Raymond Daniels | 2026/27 | Premier Soccer League | 88 | 25,630 | 25,173 |

## Effet du changement de contexte Elo

En 2022, les joueurs de chaque camp ont conservé l’Elo adverse lu à leur dernière publication intermédiaire. Les deux camps fournissent donc la paire historique sur les 8 754 matchs, soit les 265 572 participations comparées. À statistiques et postes fixes, le rejeu avec les Elo actuels donne 20 943 différences supérieures à 0,01 point. En remettant les deux Elo conservés puis en refaisant le même ajustement annuel, les 265 572 contributions concordent en précision binary32 et aucune note ne dépasse 0,01 d’écart avec la publication. Le maximum restant est 0,001439 point. Les 36 passages de frontière d’entier encore observés relèvent de petits écarts autour d’un seuil. [Deux calculs et cas extrêmes](controles/recalcul-depuis-stats/comparaison-elo-2022.json)

Une reproduction locale indépendante exerce le véritable planificateur et ses écritures PostgreSQL. Une seule correction de résultat en 2024/25 entraîne la réécriture des 320 valeurs Elo de 2021/22. Sur 298 côtés, l’Elo d’avant-match change. La passe sélectionne 2024 et conserve toutes les anciennes notes de 2021. Recalculer explicitement 2021 modifie 245 des 320 notes au dixième, dont 96 à l’entier. Le maximum est de 2,016 points. Le témoin sans correction conserve toutes ses notes dans deux montages indépendants. Le défaut démontré ici concerne la propagation d’une révision tardive vers un millésime antérieur. [Jeu et commandes PostgreSQL 18](controles/recalcul-depuis-stats/dependance-elo-pg18.zip) · [Résultats de la passe quotidienne](controles/recalcul-depuis-stats/dependance-elo-pg18.json)

## Même expérience en 2023 et 2024

Les deux Elo enregistrés se reconstituent sur les 370 276 participations de 2023 et les 561 464 de 2024. Avec 2022, cela donne 1 197 312 participations dans 39 104 matchs. Dans les trois années, toutes les contributions calculées avec ces deux Elo reproduisent la valeur enregistrée en précision `real`. Les 509 906 écarts de plus de 0,01 point et les 2 713 écarts de plus d’un point observés avec les Elo actuels disparaissent. Le plus grand écart résiduel reste inférieur à 0,00144 point. Le test inclut Jonathan Ikoné et Omar Marmoush. Il démontre l’effet suffisant du contexte Elo dans ces populations et aux seuils indiqués. [Résultats des trois expériences](controles/recalcul-depuis-stats/rejeu-contexte-elo-trois-annees.csv) · [Reçus, empreintes et scripts](controles/recalcul-depuis-stats/recalcul-joueurs-20261118.zip)

## Si 2025 est recalculé avant 2026

Les deux années ont été relues dans une seule transaction. Les 14 560 cellules du référentiel 2025 ont ensuite suivi la conversion PostgreSQL `real` et la lecture psycopg de production. Sur les 229 455 contributions actuelles de 2026, remplacer uniquement la référence publiée de 2025 par celle du rejeu change la note d’au plus 0,00309234 point. Quinze valeurs calculées changent d’entier. Lorsque les deux années sont recalculées dans cet ordre, 7 684 notes de 2026 divergent de plus de 0,01 par rapport aux notes publiées, dont 551 de plus de 0,1 et aucune de plus d’un point. Ces comptes portent sur les valeurs calculées avant la tolérance d’écriture. [Vérification des contrastes](controles/recalcul-depuis-stats/rejeu-2025-puis-2026.json) · [Rejeu hors ligne des 229 455 contributions](controles/recalcul-depuis-stats/rejeu-2025-puis-2026.zip)

## Reproduction et limites

L’image du worker est épinglée au commit `8018e0836c`. La sélection utilise les statistiques à minutes positives d’un match terminé, les deux partitions physiques du millésime et les éditions admises par le lecteur. Les matchs absents en amont et les apparitions sans ligne de statistiques demandent un autre dénominateur. Le compteur d’écarts d’index intermédiaires est limité aux notes et intermédiaires comparables. Aucun cas de divergence d’identité ni d’index publié sans clé d’entrée n’a été observé dans les comparaisons. Le code conserve son comportement documenté sur les tentatives de duel inconnues. Une concordance de calcul laisse ouverte la qualité des données collectées.

Les années terminées recalculent leurs paramètres sur leurs propres entrées. La ligne 2026 utilise les références 2025 conservées en production au moment de la lecture. Chaque année de ce tableau est un rejeu indépendant. Le fichier ZIP contient toutes les entrées du millésime 2020, les reçus des sept lectures, les grilles, les scripts des diagnostics et les six corps HTTP. Les autres années gardent les empreintes des populations annuelles, les mesures par édition et des témoins. Un autre opérateur peut vérifier ces éléments hors ligne et refaire les lectures sur RDS si les entrées sont encore disponibles. Après extraction, exécuter `python3 -B verify.py`. [Archive de vérification](controles/recalcul-depuis-stats/recalcul-joueurs-20261118.zip) · [Reçu après extraction vide](controles/recalcul-depuis-stats/verification-archive.json) · [Suivi de la convergence dans VI-21](https://linear.app/vegainteligence/issue/VI-21#comment-fff3e147-15a9-44f5-8aaf-fc3badc34e57)

## Disponibilité des indicateurs individuels et notes réellement servies

Parmi les 2 282 580 notes enregistrées, au moins 578 928 (25,36 %) ont un indicateur attendu indisponible dans leurs entrées conservées, après prise en compte des zéros que la méthode sait rétablir. Parmi elles, au moins 104 792 perdent un bloc entier. Ces deux nombres se recouvrent. Jonas Dakir apparaît avec 90 minutes et une note de 37,9 dans le classement malgré la seule présence du bloc distribution. Pour Marius Bülter en année de notation 2020, la fiche de performance répond 200 avec une note absente et le classement du match répond 404. Le contrôle de 11 h 57 a trouvé six exécutions de publication 2020 successives sans sortie. Le jeu de preuves contient les dates exactes, les ventilations, les captures publiques et le rejeu. [Indicateurs, feuilles et vérification autonome](controles/reprises-midi/rejeu-indicateurs-joueurs.zip) · [Reçu des vérifications](controles/reprises-midi/indicateurs-joueurs-recu.json)
