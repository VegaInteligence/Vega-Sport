# Couverture des notes au 2026-11-18 02:02:22 UTC

Les 6 447 lignes couvrent 2 149 éditions, 208 compétitions et 157 saisons. La grille des statistiques et des notes provient d’une seule transaction RDS en lecture seule. Le contrôle inverse et les lectures de l’API ont chacun leur propre horodatage. Les tables détaillées comptent chaque type d’entité pour chaque édition et chaque saison. [Par édition](coverage-by-edition-and-entity.csv.gz) · [Par saison](coverage-by-season-and-entity.csv.gz) · [Horaires et requêtes](score-query-snapshots.csv.gz) · [Instantané PostgreSQL](snapshot.json)

| Entité et population mesurée | Attendu selon la règle déployée | Valeurs valides persistées | Évolution des valeurs valides depuis le relevé du 17 au soir |
| --- | ---: | ---: | ---: |
| Joueurs avec indice interne calculé | 2 282 580 | 2 282 580 | 52 750 |
| Clubs admis au calcul Elo | 161 982 | 161 982 | 0 |
| Sélections admises au calcul Elo | 1 864 | 1 864 | 4 |

La base enregistre 2 297 613 couples match–identifiant joueur avec des minutes positives admis au calcul. Pour 15 033 d’entre eux, l’intermédiaire manque à la date du relevé. Le seuil de la fiche performance masque 336 979 notes déjà enregistrées.

## Ce que compte une apparition enregistrée

| Couples match–identifiant joueur de matchs terminés | Durée positive, titularisation ou remplacement | Candidats supplémentaires détectés par but ou tir, gardien compris | Total enregistré |
| --- | ---: | ---: | ---: |
| Avec un indice de participation | 2 307 397 | 938 | 2 308 335 |
| Sans ligne de statistiques | 7 878 | 930 | 8 808 |
| Avec ligne de statistiques mais sans durée positive mesurée | 1 906 | 8 | 1 914 |

Les identifiants sont dédupliqués au sein de chaque match. Une même personne ou un même fait de jeu peut toutefois être rattaché à plusieurs identifiants. Une durée positive peut aussi figurer sur la ligne de la mauvaise personne. Le nombre de personnes ayant véritablement joué et le nombre de notes qui leur étaient dues restent inconnus. Le chiffre 2 308 335 ne fournit aucune borne physique. Les 938 identifiants supplémentaires sont des candidats à vérifier. [Décompositions pour les 2 149 éditions](participation-cues-by-edition.csv) · [Totaux](participation-cues-summary.json)

Sur Laval–Saint-Étienne, Vega attribue le but de la 51ᵉ minute à Miguel Belem, absent de ses familles composition et joueurs. Le tir victorieux de la même minute est rattaché à Ben Old, que le club désigne comme buteur. Sur PSV–Copenhague, Vega attribue le tir à 90+5 à Oscar Højlund. La feuille UEFA et le compte rendu de Copenhague désignent Emil Højlund, que Vega enregistre entrant à la 86ᵉ. Ces deux erreurs sont constatées sur des relevés nominatifs distincts du recensement agrégé. Leur incidence exacte sur son total reste inconnue. [Témoins de l’origine AWS](origin-https/actor-ranking.json) · [Reçus officiels bornés](origin-https/official-actor-receipts.json) · [Feuille ASSE](https://www.asse.fr/fr/lives/laval-asse-l8856/) · [Composition UEFA](https://match.uefa.com/v5/matches/2033414/lineups?language=EN) · [Compte rendu de Copenhague](https://fck.dk/nyhed/kampreferat-en-af-vores-mest-forrygende-kampe-nogensinde)

La grille brute archivée nommait ce champ `known_participations_minimum`. La grille de lecture diffusée et le CSV de décomposition utilisent `recorded_match_player_id_pairs_with_participation_cues` pour les joueurs. Les équipes ont une colonne propre, `recorded_finished_team_sides`. Les SQL et leurs sorties conservent les noms originaux avec leurs empreintes. [Archive et rejeu initiaux](archive/initial-delivery.zip) · [SQL des signaux de base](db/participants_verified/) · [SQL des actions supplémentaires](db/events_verified/)

Sur les 23 mêmes couples joueur–match de 2021/22, 21 possèdent maintenant l’intermédiaire et 21 une note persistée, dont 20 satisfont la règle d’affichage. Le calcul local antérieur avait produit 21 valeurs et deux rôles indéterminés. [23 clés et nouvelles valeurs](sample-keys.json) · [Publications du worker](run-times.json) · [Écarts mesurés](comparaison.json)

## Éditions avec le plus de participations en attente d’un indice joueur

| Édition | Saison | Participations admises | Notes persistées | Sans indice |
| --- | --- | ---: | ---: | ---: |
| MLS (883) | 2021/2022 | 14 063 | 7 899 | 6 164 |
| Eliteserien (780) | 2021/2022 | 7 070 | 3 891 | 3 179 |
| Allsvenskan (729) | 2021/2022 | 7 037 | 4 171 | 2 866 |
| 2. Bundesliga (714) | 2021/2022 | 9 380 | 8 921 | 459 |
| First Division A (798) | 2021/2022 | 9 633 | 9 228 | 405 |
| Superligaen (980) | 2021/2022 | 5 941 | 5 539 | 402 |
| Liga MX (853) | 2021/2022 | 5 212 | 4 839 | 373 |
| Bundesliga (744) | 2021/2022 | 5 861 | 5 593 | 268 |
| Super League (963) | 2021/2022 | 5 522 | 5 308 | 214 |
| Saudi Pro League (938) | 2023/2024 | 9 080 | 8 948 | 132 |
| Premiership (913) | 2021/2022 | 6 436 | 6 325 | 111 |
| K League 1 (822) | 2023/2024 | 6 978 | 6 940 | 38 |

Ce tableau compte les entrées admises par l’algorithme avant attribution du poste. La grille détaille les statistiques absentes et les notes déjà calculées mais masquées. Le CSV joueurs ci-dessous explique comment les postes se répartissent parmi les lignes en attente.

## Causes mesurées pour les joueurs

Le [CSV joueurs](player-reasons-by-edition.csv) contient une ligne par édition. La table s’appuie sur les six partitions source de 2021 à 2026 et le recensement global des partitions. Les 90 groupes en attente contiennent des années de récompense de 2020 à 2026. Le fichier de synthèse conserve l’heure du relevé, le SHA déployé, la méthode observée et les identifiants des publications par année concernée. [Synthèse et années](player-reasons-summary.json) · [Catalogue](db/catalog_verified/editions.json) · [Partitions](db/catalog_verified/season-universe.json)

| Compteur SQL demandé | Population contrôlée | Total |
| --- | --- | ---: |
| `unknown_or_wrong_team` | Minutes positives avec équipe absente ou étrangère aux deux adversaires | 0 |
| `positive_minutes_outside_award_window` | Minutes positives en domaine natif, sans date ou hors fenêtre de récompense | 0 |
| `no_published_award` | Entrées admises sans intermédiaire, sans publication joueurs dans leur année | 0 |
| `insufficient_contribution` | Entrées admises avec intermédiaire, contribution absente | 0 |
| `insufficient_role_reference` | Entrées admises avec contribution dans un intermédiaire, indice absent | 0 |

Dans les 2 810 237 lignes de statistiques de matchs terminés, 512 624 ont une durée inconnue et 2 297 613 une durée positive. La valeur zéro ou négative apparaît 0 fois. Les 2 297 613 entrées admises se répartissent entre 2 282 580 indices valides persistés et 15 033 entrées sans intermédiaire. Dans les notes valides, 1 945 601 franchissent le seuil de la fiche joueur et 336 979 restent masquées sur cette fiche.

Parmi les entrées sans intermédiaire, 14 411 ont un poste assignable immédiatement, 7 retrouvent un poste détaillé dans une autre apparition de la même année et 615 restent sans poste. Les statistiques de 14 427 entrées en attente portent une écriture postérieure au démarrage de la dernière publication. Le contrôle des postes assignables dont l’écriture précède ou coïncide avec ce démarrage donne 0. Ces horodatages décrivent l’état observé et ne démontrent pas la visibilité transactionnelle d’une ligne au démarrage du worker. [Six sorties annuelles et six sources SQL](db/longitudinal/) · [Statistiques et indices](db/grades_verified/) · [Entrées en attente](db/pending_verified/) · [Contrôle inverse des notes par partition](db/grade_integrity_verified/)

Sur 304 éditions natives, 301 ont des statistiques joueurs sur matchs terminés. Les 99 éditions de coupe complémentaires et 1 746 éditions d’archives ont respectivement 0 et 0 éditions avec de telles statistiques. Une absence de source laisse la population sportive réelle inconnue. Les compteurs portent sur les lignes conservées en base. Les champs d’équipe, d’année, de chronologie et de provenance peuvent se recouper au sein d’une population. Les six requêtes annuelles établissent la disponibilité du poste parmi les cas en attente. Elles ne permettent pas d’attribuer à chaque joueur noté la voie de résolution de son poste, de séparer dans le compteur de fenêtre les dates absentes, ou d’énumérer les clés individuelles à partir des groupes. Les matchs non terminés et les rencontres sans statistiques restent comptés dans le catalogue des éditions. Le contrôle inverse des intermédiaires et des paires multi-annuelles utilise une transaction indépendante.

Le second relevé, à 2026-11-18 02:11:08 UTC, a parcouru 2 282 580 intermédiaires, soit 2 282 580 paires match/joueur distinctes. Il retrouve 2 282 580 sources admises. Les effectifs sans source, à source inéligible, à année incorrecte, sur plusieurs années ou en excédent sont respectivement 0, 0, 0, 0 et 0. Cette transaction a son propre reçu et sa propre heure. [Résultat indépendant](reverse-intermediate/reverse-intermediate.json) · [Reçu indépendant](reverse-intermediate/receipt.json) · [Requête](reverse-intermediate/reverse-intermediate.sql) · [Cas témoins sur PostgreSQL 18.3](reverse-intermediate/local/local-verification.json)

## Lecteurs et valeur transmise au tableau

À 02 h 00 UTC, le collecteur a transmis des événements GET construits localement avec `aws lambda invoke`. Les 46 invocations distinctes de `vega-v2-api` ont produit des enveloppes contenant `statusCode=200`. Le collecteur a conservé les valeurs extraites et les SHA-256 des corps. À 02 h 22 UTC, le relecteur a adressé les mêmes chemins et requêtes à l’URL de fonction AWS par HTTPS, avec signature SigV4 et authentification IAM. Les 46 corps reçus ont chacun le même SHA-256 que celui consigné à 02 h 00. Le paquet contient ces corps pour rejouer la vérification hors réseau. [Collecteur Lambda](reader-0200/reader.py) · [Empreintes des enveloppes](reader-0200/response-digests.json) · [Reçus HTTPS et clés](origin-https/origin-observations.json) · [Corps indexés par SHA-256](origin-https/origin-bodies/)

Pour les 27 clés relues, les deux lecteurs retrouvent le même identifiant. Pour 23 clés, les notes numériques concordent. Pour deux autres, les deux valeurs sont nulles. Dix GET HTTPS signés supplémentaires à 02 h 24 UTC couvrent les événements, tirs, joueurs et compositions des deux matchs à attribution contestée et le classement de deux matchs avec caméo. Tous ont répondu HTTP 200. Pour ces deux caméos, la fiche performance et le classement rendent une note nulle alors que la famille joueurs contient une note numérique. Sur les corps HTTPS, la fonction frontend de production `boardRows` restitue 53,7018086536606 pour Alexandru Mățan (7 minutes) et 55,053611690361 pour Samuel Moutoussamy (1 minute). Le contrôle porte sur les données des lignes de tableau exécutées sous Node.js. Le chemin CDN/Vercel et le rendu dans un navigateur restent non observés. [Dix reçus supplémentaires](origin-https/actor-ranking.json) · [Sorties du tableau](origin-https/board.jsonl) · [Module figé](origin-https/match-tabs.mjs) · [Protocole de rejeu](rejeu.md)
