# Duels, niveaux des ligues et sources indépendantes

Les contrôles joueurs et équipes rapprochent les publications de PostgreSQL, les calendriers officiels et les résultats administratifs datés. [Contre-lecture du 18 novembre](CONTRE-LECTURE.md)

Ces mesures relient trois questions du document initial à des conséquences observables. La première porte sur le classement des joueurs, la deuxième sur les niveaux de départ des clubs, et la troisième sur les résultats effectivement ingérés et servis.

## Duels et classement annuel 2022/23

Une transaction RDS du 17 novembre à 22 h 51 UTC a fourni 265 707 participations. Le worker a pu attribuer un rôle à 265 572 d’entre elles et a classé 14 844 joueurs. Pour le second calcul, les références des indicateurs ont été figées. Seule la mesure conditionnelle d’un duel dont le dénominateur manque alors que les réussites sont positives a été retirée chez les joueurs de champ. Cela concerne 16 221 participations et 8 028 joueurs. L’éligibilité, les enjeux, la valeur du club et le prior suivent les règles de production.

| Classement public | Joueurs | Rangs du top 100 initial reproduits | Entre après intervention | Sort après intervention |
| --- | ---: | ---: | --- | --- |
| Course annuelle en première division mesurée | 5 247 | 100/100 | Joško Gvardiol, 102ᵉ → 98ᵉ | Niklas Süle, 100ᵉ → 103ᵉ |
| Général masculin | 14 844 | 100/100 | Joško Gvardiol, 105ᵉ → 99ᵉ | Ryan Manning, 96ᵉ → 104ᵉ |

Dans chaque vue, 99 joueurs restent dans le top 100 et 39 places gardent le même titulaire après l’intervention. Aucune joueuse ne figurait dans la population de ce millésime. Les sources ne permettent pas de déterminer dans chaque duel si l’absence de défaites mesurées correspondait à un vrai zéro. Le calcul démontre la sensibilité du classement à un choix sur les données manquantes. Les écarts entre version publiée et reproduction annuelle tenant au prior sont documentés séparément. [Résultats des classements](controles/top100-resultats.json) · [Comparaison à la publication](controles/top100-publication.json) · [Joueur par joueur](controles/top100-rangs.tsv.gz)

## Estimation des niveaux de ligue et vérification de l’Elo

Le recalcul a suivi les 81 921 matchs dans l’ordre du worker, dont 13 808 contribuent au terme de comparaison interchampionnats. Sur 8 des 72 coordonnées ordinaires de ligue, le signe du gradient utilisé par le worker diffère de celui de la dérivée de l’objectif séquentiel. Le contraste Bundesliga/2. Bundesliga donne +0,021473 et −0,018195. Un calcul indépendant sur six directions vérifie les dérivées à 6,41 × 10⁻¹⁰ près. Ces écarts mettent notamment en cause l’interprétation publiée des erreurs-types. [Directions testées](controles/elo-directions.csv) · [Vérification indépendante](controles/elo-verification.json)

Un autre contrôle porte sur le centrage final. La reconstruction déplace les niveaux ajustés de −211,645 points et laisse les équipes sans niveau ajusté à 1 500. L’espérance Elo de 555 matchs varie de plus de 0,01, avec un maximum de 0,2953. Cette espérance donne un point à une victoire et un demi-point à un nul. Les niveaux Elo réellement persistés pour les 161 982 côtés de clubs et les 1 860 côtés de sélections ont par ailleurs été reproduits à un pas de précision binary32 près. [Mesure de centrage](controles/elo-recentrage.json) · [Mesure de précision](controles/elo-precision.json)

## Classements officiels et téléchargements redondants

Les tests du collecteur SportScore ont traversé le vrai gestionnaire HTTP sous le rôle de lecture. Un échantillon tronqué a retiré un club du classement. Une réponse vide a remplacé les huit points après sanction par dix points dérivés. Le remplacement d’un seul club par un autre à cardinalité identique a attribué le nouveau nom et ses points au mauvais club. L’alias déjà documenté utilisé comme témoin a conservé le bon rattachement. En production, 15 éditions avaient des noms non rattachés, zéro écriture et aucune ligne officielle conservée à 22 h 51 UTC. L’instantané courant ne permet pas de compter les observations historiques perdues. [Quatre tests et valeurs servies](controles/sportscore-verdicts.json) · [Lecture de production](controles/sportscore-scopes.json) · [VI-29](https://linear.app/vegainteligence/issue/VI-29)

Le worker a téléchargé huit fois le même CSV International Results quand ses huit éditions étaient dues, puis a conservé les 373 résultats. Huit jours plus tard, il a relu 30 114 776 octets décompressés pour zéro modification sportive. Quand trois éditions étaient dues, il a effectué trois téléchargements. Une exécution immédiate a effectué zéro requête. Le partage d’une seule lecture par passage conserve le suivi et la validation de chaque édition. L’expérience utilise le code déployé, une base locale et le fichier réel figé. [Reçu par échéance](controles/resultats-internationaux-lectures.json) · [Révision de la source](controles/resultats-internationaux-source.json) · [VI-21](https://linear.app/vegainteligence/issue/VI-21)

## Résultats administratifs

Tours–Lorient du 21 décembre 2024 a été attribué à Lorient, 0–3, sans être joué. OpenFootball porte l’annotation explicite de cette décision. Vega affiche un match terminé et a fait varier l’Elo des deux équipes, de +4,625 pour Lorient et −4,625 pour Tours. [Décision de la FFF](https://www.fff.fr/article/13900-lorient-qualifie-pour-les-16es-de-finale.html) · [Requête, identifiants et valeurs Elo](controles/decisions-matchs.json)

La finale de la CAN 2025, jouée le 18 janvier 2026, nécessite de conserver le 0–1 sur le terrain après prolongation et le 3–0 administratif en faveur du Maroc. Le CSV International Results fournit seulement ce dernier score. L’Elo publié attribue la victoire au Maroc. Au 17 novembre, le Tribunal arbitral du sport avait annoncé la mise en délibéré de l’appel et attendait sa sentence pour la fin de novembre. [Communication du TAS](https://www.tas-cas.org/generated/assets/lists/dceab111-07bc-435f-b5f9-de88eff9db72/CAS%20Media%20Release_12295_procedural%20update.pdf) · [État mesuré pour les deux matchs](controles/decisions-matchs.json)

## Calendriers de clubs et de sélections

La comparaison avec les listes officielles des trois coupes d’Europe couvre 18 éditions de 2021/22 à 2026/27. Parmi les 2 478 rencontres terminées des tableaux principaux, 2 475 ont une fixture Vega avec score concordant. Trois matchs du Partizan en Ligue Conférence manquent. Sur les 2 489 matchs de qualification terminés, aucun n’a été retrouvé dans son édition à un jour près. Vingt-huit séances de tirs au but de tableaux principaux n’ont pas de score numérique de séance dans Vega. Pour 37 matchs dont le score a changé en prolongation, le total final est correct et le score à 90 minutes manque. [Résultats UEFA et DFB par édition et phase](controles/calendriers-uefa-dfb.csv) · [Détails des sources de tirs au but en Allemagne](controles/dfb-tirs-au-but.json)

Côté sélections, 701 affiches officielles des éliminatoires européens du Mondial 2022 (258), de l’EURO 2024 (239) et du Mondial 2026 (204) ont été comparées aux 859 lignes RDS reliant deux équipes typées nationales entre septembre 2020 et novembre 2026. Aucune de ces 701 affiches ne correspond dans cette population, y compris avec inversion des équipes et tolérance d’un jour. Une rencontre stockée sous deux clubs mal typés reste en dehors de ce dénominateur. En Ligue des nations 2026/27, 120 des 156 affiches sont présentes et 118 scores concordent. [Contrôle des identités nationales](controles/calendriers-selections.json)

Les 32 rencontres et leurs scores en Copa América 2024 concordent après vérification du sens des équipes et du jour au stade. En FA Cup 2024/25, les 123 matchs du tableau principal sont présents avec le bon résultat. Les 39 fiches répertoriées dans l’autre archive de cette édition se retrouvent parmi ces 123 rencontres. En 32ᵉˢ de finale de la Coupe de France 2024/25, les 32 affiches et résultats définitifs concordent, dont 31 matchs joués et la qualification de Lorient sur décision administrative. [Rapprochement FA Cup](controles/calendriers-fa.json) · [Contrôle de la Coupe de France](controles/calendriers-fff.json) · [Affiches de Copa América](controles/calendriers-copa.json.gz)

## Clés physiques et provenance des notes

Le catalogue PostgreSQL de production déclare 252 clés étrangères de premier niveau et 652 instances après prise en compte des partitions. Toutes étaient validées et appliquées. Aucun déclencheur de clé étrangère inspecté n’était désactivé ou limité à la réplication. Aucun index du périmètre n’était invalide ou indisponible. Ces propriétés assurent l’existence des cibles déclarées. Les identités sportives doublées lors d’une promotion existent malgré ces protections. [État du catalogue](controles/integrite-physique.json) · [252 relations déclarées](controles/relations-physiques.json.gz) · [Identités coréennes par match](controles/identites-kleague.json.gz)

Les vues publiques des apparitions et des notes de match dépendent de `agg.player_match_grades`. Les vues de saison lisent les grades agrégés de Vega. Le catalogue des tables et vues applicatives n’expose plus de colonne `rating`, `rating_…` ou `…_rating` depuis la migration 108. Le rejeu de 21 notes réellement manquantes retrouve leurs valeurs par l’algorithme interne à partir des minutes et statistiques du joueur. [Dépendances déclarées des cinq vues](controles/provenance-notes.json) · [Lecture des noms de colonnes](controles/colonnes-ratings.json) · [Rejeu des notes](PIPELINE-NOTES.md)
