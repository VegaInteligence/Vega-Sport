# Reprise des 24 critères ouverts de l’audit Vega-Sport — état au 19 novembre 2026

[Situation du 18 novembre](../2026-11-17/SITUATION.md) · [Registre des 91 critères](../2026-11-17/registres/requirements.csv) · [Spécifications des corrections](../../calculs/09-audit-2026-11/FAILURE_MODES.md) (§37 à §46) · [Preuves](preuves/)

**Candidat : `code `79ef8bbb45``**, branche `claude/audit-reprise-33`, [PR 58](https://github.com/VegaInteligence/Vega-Sport/pull/58) en brouillon. CI verte sur `c6c4592ca7` (run 44601959463 : Python 743 OK avec 1 échec attendu, API 226/226, site 788/788, image, infrastructure et paquet API réussis) ; `c6c4592ca7` ajoute à ce code le présent rapport, le registre et les preuves. Il part de `main` `2088d36e60`, déployé le 19 novembre à 10 h 05 UTC (migrations jusqu’à 153). Rien de ce candidat n’est déployé : « branche » ci-dessous veut dire vérifié sur ce SHA par les suites et les rejeux locaux (PostgreSQL 18.6), « production » veut dire observé sur la version servie.

Sur les 33 critères suivis, 9 étaient vérifiés à la passation. Des 24 ouverts : **4 sont clos sur branche**, **13 ont avancé et gardent un reste nommé**, **7 sont bloqués** par une décision, une source ou un accès. Aucun des 24 n’est clos en production : il faut le déploiement, puis la mesure.

## Ce qui n’a pas été fait comme le demandait la passation

- **Linear** : ni lu ni mis à jour (règle de l’utilisateur pour ce dossier). La comparaison des critères à Linear n’est pas faite ; les tickets VI-19, VI-21, VI-27 à VI-32 ne portent aucune trace de ce travail.
- **Avis Astra** : aucun modèle Astra n’est disponible dans la session qui a produit ce candidat. Les lots ont été écrits par des sous-agents Claude Opus 5.5 et coordonnés par Claude Fable 5.2. Une relecture indépendante par un sous-agent Opus neuf a été faite ; elle ne remplace ni la revue Fable de Hugo ni l’avis Astra, tous deux à rendre sur le même SHA (E05b).
- **Base de production** : aucune lecture SQL ni CloudWatch (session AWS expirée sur le poste). La production n’a été lue que par l’API publique. Les chiffres du registre qui viennent de la base (14 418 notes, 165 186 côtés Elo, 86 619 transferts…) ne sont pas remesurés.

## Tableau des 33 critères

État : **clos** (condition de sortie remplie, sous réserve des deux revues), **avancé** (une partie remplie, le reste est nommé), **bloqué** (rien ne peut avancer sans ce qui est nommé), **inchangé** (déjà vérifié à la passation, non remesuré sauf mention).

| Critère | Exigence | État | Environnement | Preuve | Reste ou blocage |
| --- | --- | --- | --- | --- | --- |
| E01a | Comparer le document, les tickets clos, le code, le déploiement et les données | inchangé | branche | registre | SHA de livraison à actualiser à la clôture |
| E01b | Vérifier les corrections actives sur leur version livrée | avancé | production (API) et branche | [production](preuves/prod/EVIDENCE.md), [témoins rejoués](preuves/temoins-34ca-sur-2088d36e60/EVIDENCE.md) | Ce que seule la base montre : migrations appliquées, erreurs de purge et de fusion dans les journaux, jumeaux d’archives restants sur trois saisons. Prévisions (VI-19) non examinées |
| E02a | Inventorier fournisseurs et usages | inchangé | branche | registre | — |
| E02b | Éviter les collectes redondantes en gardant les apports propres | clos | branche | [collecte](preuves/collecte/EVIDENCE.md) 37g–37j, [résiduels](preuves/residuels/EVIDENCE.md) 45a–45e | Mesurer les requêtes réelles après déploiement |
| E02c | Empêcher qu’un repli écrase une observation d’autorité | clos | branche ; production pour 45 tables sur 46 | [writers](preuves/writers/MATRICE.md), [garanties](preuves/garanties/EVIDENCE.md), [classements](preuves/classements/EVIDENCE.md) | Suivre les refus réels en base après déploiement ; table servie pour la Veikkausliiga à constater |
| E02d | Collecte et reprise incrémentales et idempotentes | avancé | branche | [writers](preuves/writers/MATRICE.md), [collecte](preuves/collecte/EVIDENCE.md) 37k–37m, [historique](preuves/historique/EVIDENCE.md) | Une réponse statistique native partielle est encore acceptée (règle à décider) ; une première réponse vide n’est jamais redemandée ; cotes et médias sans test sous le rôle réel |
| E03a | Contraintes physiques, clés canoniques, correspondances | inchangé | production | registre | — |
| E03b | Éviter les doublons de joueurs | bloqué | — | [identités](preuves/identites/EVIDENCE.md) | Aucune fusion appliquée. Cas : cinq attributions Henri / Siriné Doucouré ; maillot 33 du match 27785 ; deux acteurs erronés (Laval–Saint-Étienne, PSV–Copenhague) ; 511 candidats du Mondial des clubs. Il faut les preuves primaires dans le dépôt et la lecture de la base. Les dix joueurs d’Incheon ne sont plus servis (K League retirée) |
| E03c | Reconnaître les clubs identiques, préserver les homonymes | avancé | branche | [identités](preuves/identites/EVIDENCE.md) 39a–39l, [résiduels](preuves/residuels/EVIDENCE.md) 45h–45j | Estudiantes de Río Cuarto lié à sa réserve (lignes de production nécessaires) ; « Everton FC » des coupes 2024/25 ; 14 clubs de FA Cup en double ; « Dyn. Kyiv » ; doubles PitchAPI ; Racing/Matra et 25 paires sans preuve au dépôt ; homonymes des 301 noms relus à compter en base |
| E03d | Identités nationales canoniques | bloqué | — | [identités](preuves/identites/EVIDENCE.md) | 207 sélections sans code pays, aucune collision trouvée. Il manque une correspondance relue sélection → association qui garde distincts les prédécesseurs |
| E03e | Bonnes compétitions, saisons et éditions | avancé | branche | [identités](preuves/identites/EVIDENCE.md) 39a–39g, [classements](preuves/classements/EVIDENCE.md) 43k–43r | 33 matchs CONCACAF 2008/09 sous l’édition 3333 : gelés, il manque une édition relue et un plan d’archive. J1 et féminines saoudiennes : sans objet (retirées du périmètre) |
| E03f | Distinguer canoniques, doublons, reports, annulations, décisions | avancé | branche ; production pour les jumeaux ciblés | [classements](preuves/classements/EVIDENCE.md), [résiduels](preuves/residuels/EVIDENCE.md) 45f–45g, [production](preuves/prod/EVIDENCE.md) | Lanús–Estudiantes et quatre autres paires natives en double : spécifié (§43.3), non codé ; 46 paires terminé/reporté ; jumeaux d’archives restants (Premier League 2001/02, Serie A 2000/01) ; aucun chemin relu pour lever une retenue de fixture |
| E03g | Préserver adhésions, transferts et contrats | avancé | branche ; production pour les codes 200/304/404 | [témoins rejoués](preuves/temoins-34ca-sur-2088d36e60/EVIDENCE.md), [garanties](preuves/garanties/EVIDENCE.md) | 86 619 transferts ont une extrémité sans club canonique : à classer en base, puis règle de rattachement à décider |
| E03h | Prévenir la récidive, préserver les relations, supporter les réexécutions | clos | branche | [writers](preuves/writers/MATRICE.md) (26 rejeux), [garanties](preuves/garanties/EVIDENCE.md) (12 défauts corrigés), test 41n | Cases sans rejeu déclarées dans la matrice : cotes, médias, curated |
| E04a | Toutes les rencontres terminées des ligues domestiques | avancé | branche | [historique](preuves/historique/EVIDENCE.md), [calendriers](preuves/calendriers/EVIDENCE.md) | Angleterre : 540 sur 575 par le passage ordinaire, 575 après restauration des 35 (opération de production). Sans source lue : six barrages L1/L2. À décider : Bochum–Hertha, Majorque–Gérone, statut d’Obolon–Kryvbas |
| E04b | Coupes domestiques et phases qualificatives | avancé | branche ; branche séparée pour les saisons ajoutées | [identités](preuves/identites/EVIDENCE.md) 39h–39i, [historique](preuves/historique/EVIDENCE.md), [coupes](preuves/coupes/EVIDENCE.md) | Tours préliminaires de la FA Cup sans source ; Copa del Rey et Coupe de Suisse 2023/24 (trois noms à relire) ; décisions administratives des autres compétitions non inventoriées ; finale de CAN Maroc–Sénégal |
| E04c | Coupes européennes, qualifications et barrages | avancé | branche séparée | [coupes](preuves/coupes/EVIDENCE.md) | 856 qualifications 2024/25 et 2025/26 prêtes. Sans source lue : 2021/22 à 2023/24 et 2026/27 ; trois matchs du Partizan |
| E04d | Compétitions internationales, qualifications | bloqué | branche pour les doublons | [calendriers](preuves/calendriers/EVIDENCE.md), [classements](preuves/classements/EVIDENCE.md) | Décisions : faire entrer les qualifications dans l’Elo des sélections ou les afficher seulement ; source des matchs à venir. Source nouvelle nécessaire pour les séances et la prolongation de la Copa América 2024 |
| E04e | Participants réels et statistiques pour les noter | bloqué | — | [notes](preuves/notes/EVIDENCE.md), [calendriers](preuves/calendriers/EVIDENCE.md) | Aucune statistique individuelle hors des matchs natifs, et le sélecteur des notes est fermé aux coupes : il faut une source et une décision d’admission |
| E04f | Une note Vega par participation éligible | bloqué | — | [notes](preuves/notes/EVIDENCE.md) | Décision de méthode sur le millésime 2020 (11 562 notes dans le périmètre gardé) : retirer le verrou, ou noter contre les références de 2021 sans classement 2020 |
| E04g | Elo par match pour clubs et sélections | avancé | branche | [collecte](preuves/collecte/EVIDENCE.md) 37a–37f, [historique](preuves/historique/EVIDENCE.md) 41n–41o | Restauration des 35 identités en production (opération à accorder), puis recalcul de leurs 70 côtés |
| E04h | Elo par match et note de prestation d’équipe | sans objet | — | registre | — |
| E04i | Bonne entité, match, édition et millésime de chaque note | avancé | branche | [identités](preuves/identites/EVIDENCE.md), [notes](preuves/notes/EVIDENCE.md) | 64 notes pour 32 participations sur Lanús–Estudiantes ; versions de quantiles antérieures à vérifier sur une restauration ponctuelle de la base, dont la fenêtre de sept jours se referme vers le 25 novembre |
| E04j | Compléter les anciennes saisons selon une politique explicite | bloqué | — | [calendriers](preuves/calendriers/EVIDENCE.md) | Texte de politique proposé ci-dessous : à adopter ou corriger par l’utilisateur |
| E04k | Rattraper les notes et réveiller le calcul | avancé | branche | [collecte](preuves/collecte/EVIDENCE.md) | Millésime 2020 (E04f) ; les notes des saisons antérieures ne sont pas reclassées après un changement d’Elo ; correction écrite entre deux lectures du calcul |
| E04l | Signaler les échecs, distinguer zéro, absence et inéligibilité | clos | branche | [notes](preuves/notes/EVIDENCE.md), [corrections de relecture](preuves/corrections-relecture/EVIDENCE.md) | Texte « 0 derniers matchs · moy. 50 » du site : changement d’écran à valider |
| E04m | Algorithmes Vega et non note de fournisseur | inchangé | production | registre | — |
| E04n | Résultats internationaux anciens | inchangé | production | registre | — |
| E05a | Coordonner les pistes et respecter les propriétaires | inchangé | branche | registre | Vérification Linear non refaite |
| E05b | Double revue indépendante de la branche réunie | bloqué | — | [relecture interne](preuves/relecture/CONSTATS.md) | Les deux avis, Fable 5.2 xhigh (Hugo) et Astra 6.2 xhigh, sur le même SHA, puis la vérification de leurs corrections |
| E05c | Corriger les défauts confirmés et valider avant fusion | avancé | branche | [témoins rejoués](preuves/temoins-34ca-sur-2088d36e60/EVIDENCE.md), [corrections de relecture](preuves/corrections-relecture/EVIDENCE.md), CI | Les deux avis ; accord sur les effets du déploiement |
| E06a | Rapport de couverture, matrice des sources | inchangé | branche | registre | — |
| E06b | Documenter changements, migrations, déploiements | inchangé | branche | ce document, `WORKLOG.md` | À répéter après le déploiement |
| E06e | Validation AWS avec le profil autorisé | inchangé | branche | registre | Non refaite : session expirée |

Les deux critères de logos (E06c, E06d) restent au chantier séparé.

## Ce que le déploiement de ce candidat changerait dans les données

Accord de l’utilisateur nécessaire avant le déploiement. Chaque point est appliqué par le passage ordinaire du worker, sans opération manuelle.

| Changement | Volume | Mécanisme | Contrôle après | Retour arrière |
| --- | --- | --- | --- | --- |
| Côtés du FC Barcelona rendus | 15 côtés de match, de Barcelona SC vers FC Barcelona | passe d’identité quotidienne, correction relue avec préimage | journal du worker `team side correction barcelona-740 moved=15` ; Copa del Rey 2024/25 servie avec `t_32jSEF` | `core.team_side_corrections` donne le match, le côté et le club d’origine |
| Résultats Open Matchday rattrapés | 359 matchs dans 7 éditions (North 59, South 64, Northern Premier 78, Pologne I 20, Pologne II 36, Cymru Premier 22, FA Cup 80) | passage Open Matchday, résultats attestés par le commit de la source | totaux de `/api/cup-table` : 175, 176, 189, 126, 141, 127, 222 | supprimer les matchs dont la clé est dans `open_matchday_published.json` |
| Score corrigé | Ashton United–Warrington Town, 1–2 → 0–1 | final attesté par l’organisateur | ligne du 3 novembre | — |
| Matchs sortis de l’Elo | Tours–Lorient, Seraing U21–Beerschot U21 | `power.ADMINISTRATIVE` | recalcul suivant | retirer les deux entrées |
| Classement Veikkausliiga | la table mêlée n’est plus servie | vue de lecture (159) | `/api/standings?competition=l_3Ci5Cg` : table Vega ou 404 | vue de 150 |
| Pages nation | une rencontre tenue par deux éditions listée une fois ; libellé de l’édition | vue de lecture (159) | Argentine : 8 matchs de Coupe du monde 2026 | fonctions de 119–120 |
| Elo | un recalcul complet au premier passage | `worker.elo_due` | — | — |

Migrations ajoutées : 155, 156, 157, 159, 160, additives ; 160 remet en outre à NULL la date de lecture des unités de blessures dont la seule lecture a été refusée (aucun épisode stocké), et 159 incrémente une fois la version de l’édition Veikkausliiga 2026.

## Opérations de production à accorder séparément

1. **Restauration des 35 rencontres anglaises** avec leurs identifiants d’origine (`python -m vega.open_matchday_restore`, captures de `35-matchs-identites-et-elo.zip`) : essai à blanc, application, second passage ; procédure dans [historique](preuves/historique/EVIDENCE.md). Services arrêtés pendant l’opération.
2. **Lecture de la base** : `aws login --profile statarena`, puis une tâche de diagnostic en lecture seule. Les requêtes à poser sont listées dans [production](preuves/prod/EVIDENCE.md).

## Décisions attendues

| Sujet | Question | Recommandation |
| --- | --- | --- |
| Millésime 2020 (E04f) | Noter les matchs d’août 2020 à juillet 2021 ? | Oui, contre les références de 2021, sans publier de classement 2020 |
| Forme récente | Remplacer « moy. 50 » quand aucun match n’est admissible ? | Oui : afficher le nombre de matchs sans moyenne |
| Anciennes saisons (E04j) | Adopter la politique ci-dessous ? | Oui |
| Sélections (E04d) | Faire entrer les qualifications (1 403 du Mondial, 239 de l’Euro, 401 de la CAN) dans l’Elo des sélections ? | Mesurer l’effet d’abord ; afficher sans Elo en attendant |
| Coupes (E04b, E04c) | Livrer les 23 éditions de la branche `claude/audit-coupes` ? | Oui, après le candidat, comme lot séparé |
| Doublons natifs (E03f) | Écarter la copie non canonique de cinq paires natives des lecteurs ? | Oui, par une colonne lue par l’Elo, les notes et les listes ; à spécifier avant |
| Statistiques natives (E02d) | Refuser une réponse qui a moins de lignes que l’observation acceptée ? | Oui pour un match terminé depuis plus de 48 h |
| Retenue de fixture | Qu’emporte la levée d’une retenue (cotes, événements, prévision) ? | Rien n’est supprimé ; la fixture est marquée retirée |
| Dates de naissance | Restaurer les six dates écrasées par Wikidata ? | Oui, depuis l’instantané |

## Politique proposée pour les saisons d’avant 2021/22 (E04j)

Une saison ancienne n’apporte que ce que ses sources publient : le jour, les équipes et le score (OpenFootball 2010–2020, footballcsv, engsoccerdata), pour certaines les buteurs, et pour 14 divisions de 2000/01 à 2020/21 la mi-temps, les statistiques d’équipe et les cotes (football-data.co.uk).

1. **Absences de calendrier**, la source n’a pas la rencontre : tours préliminaires de la FA Cup ; Liga 2 2000/01–2011/12, Serie B 2000/01–2012/13, Ligue 2 2000/01–2013/14, divisions anglaises 2 à 4 en 2016/17 et 2017/18 ; qualifications des coupes européennes. Une absence est affichée comme telle ; aucun match n’est déduit d’une autre source sans décision.
2. **Absences de données**, la rencontre existe mais un champ manque : rencontres non jouées, dates non vérifiées, matchs sans score complet ; aucune composition ni statistique individuelle dans une archive. Un champ absent reste absent, jamais zéro ; aucune participation n’est déduite d’un score ou d’une liste de buteurs.
3. **Exclusions voulues** : les archives n’entrent ni dans l’Elo ni dans les notes joueur ; les clubs uniquement historiques n’ont pas de force ; les archives écossaises de 2ᵉ à 4ᵉ division sont retirées ; football-data enrichit un match d’archive apparié et n’en crée aucun ; à partir de 2021/22 l’édition native prime.

Toute levée d’une exclusion est une décision de méthode, mesurée avant d’être appliquée.

## Relecture indépendante

Un sous-agent Opus neuf a relu le diff du candidat à `8587ab6671` sans connaître les conclusions des lots. Six constats, tous traités dans ce candidat ([constats](preuves/relecture/CONSTATS.md), [corrections](preuves/corrections-relecture/EVIDENCE.md)) :

Première relecture, sur `8587ab6671` :

| Constat | Gravité | Correction |
| --- | --- | --- |
| `/api/read/performance` lisait toutes les partitions de statistiques pour un statut de note | grave, démontré (27,8 s par appel sur 1,5 M de lignes ; limite de l’API : 8 s) | lecture par clé : 4,4 ms |
| un premier 404 des blessures servi comme « aucune blessure » | moyen, démontré | un 404 ne pose plus de date de lecture acceptée ; 160 nettoie les unités concernées |
| la passe d’identité pouvait échouer à chaque passage sur le journal des côtés corrigés | moyen-faible | journal en premier déplacement gardé |
| recherche d’un refus déjà tracé sans index | faible | index (157) : 0,03 ms |
| lignes de statistiques sans équipe | — | ne se reproduit pas : elles n’ont jamais été notées |
| fusion de jumeaux d’archives contre la clé étrangère de 156 | très faible | la paire nommée par une correction est retenue |

Seconde relecture, sur `1cc4af1200` : aucune perte de données. Lectures de la migration 159 trois à vingt-cinq fois plus lentes (pages nation, classements) : ramenées à au plus 1,5 fois leur temps d’avant (§43.4). Recherche Transfermarkt d’un club sans nom refaite chaque jour : bornée à une reprise (§45.4). Migrations 155 à 160 corrigées en place pendant la journée : une base de développement migrée sur un SHA intermédiaire du candidat est à recréer ; la production, à 153, n’est pas concernée.

## Vérifications

| Vérification | Résultat |
| --- | --- |
| CI GitHub sur le candidat | run 44601959463 sur `c6c4592ca7` : Python 743 OK (1 échec attendu, pgvector présent), API 226/226, site 788/788, image, infrastructure et paquet API réussis |
| Suites locales (PostgreSQL 18.6, Python 3.12, Node 24) | sur `79ef8bbb45` : Python 743 OK (1 sauté : pgvector absent en local ; 1 échec attendu : millésime 2020), API 226/226, site 788/788 |
| Référence `2088d36e60` | Python 635, API 222, site 788 |
| Production, API publique, 19 nov. 13 h 19–13 h 39 UTC | 442 lectures ; voir [production](preuves/prod/EVIDENCE.md) |

## Non vérifié

- Tout ce qui demande la base de production : volumes réels des refus nouveaux (`HISTORY_CONFLICT`, `EMPTY_AFTER_OBSERVATION`, `COPY_NOT_COVERED`), durée de `worker.elo_due`, homonymes parmi les 301 noms de clubs relus, présence d’une table Vega pour la Veikkausliiga.
- Le rendu du site : aucun écran n’a été modifié, aucun parcours navigateur n’a été rejoué sur le candidat.
- Les scores de Pologne, du pays de Galles et de la FA Cup rattrapés ne sont pas recoupés avec les organisateurs : ils portent la mention « publié par la source » avec le commit.
- Le travail isolé « Isolated pilot » (données réelles PitchAPI) ne tourne que sur `main` et les branches `claude/v2-*` : il n’a pas tourné sur ce candidat.
