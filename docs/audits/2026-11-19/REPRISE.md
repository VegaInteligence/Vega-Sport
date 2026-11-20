# Reprise des 24 critères ouverts de l’audit Vega-Sport — état au 20 novembre 2026

[Situation du 18 novembre](../2026-11-17/SITUATION.md) · [Registre des 91 critères](../2026-11-17/registres/requirements.csv) · [Spécifications des corrections](../../calculs/09-audit-2026-11/FAILURE_MODES.md) (§37 à §48) · [Preuves](preuves/)

**Candidat : code `16a782abb6`**, relu CODE PASS par Fable sur `25834c73b9`, puis fusionné avec le dernier `main` (voir plus bas), sur la branche locale `claude/audit-reprise-33` ; ce rapport est commité au-dessus, sans autre changement de code. La [PR 58](https://github.com/VegaInteligence/Vega-Sport/pull/58) est en brouillon ; sa branche distante reste à `e82992a37d` : rien n’a été poussé, le push demande l’accord de Hugo.

Le candidat contient deux fusions réelles de `main`, sans rebase : `c4a3cacd77` (commit `1594b63731`), puis `61d0ab3573`, la tête de `origin/main` lue au début de la seconde intégration (commit `a97bc68cf5`, aucun conflit). Cette seconde fusion apporte l’interface de la page club et de la journée (jusqu’à `bb0ac6ab16`) et le correctif de capacité de l’API de lecture écrit par une autre session (`41a8e75a7d` tests, `61d0ab3573` code : `db.mjs`, `handler.mjs`, `migrate.py`, `infra/aws`), conservés tels quels. L’écart de la branche avec ce `main` sur `backend/` et `infra/` est identique, ligne à ligne, à celui relu sur `25834c73b9` ; `infra/aws`, `migrate.py`, `db.mjs`, `handler.mjs` et `dashboard/` sont ceux de `main` ; la migration 154 est identique octet pour octet à celle de `bfab25d4ef` (blob `b6ac3564cb`) ; sous `backend/sql`, la branche n’ajoute à `bfab25d4ef` comme à `61d0ab3573` que 155, 156, 157, 159 et 160. Si `main` avance encore, l’écart est nommé à la publication, pas réintégré sans fin. `main` contient `bfab25d4ef`, en service depuis le 20 novembre à 01 h 50 UTC avec la migration 154 (`migrations applied=1 total=160`). Ce qui s’ajoute à `main` : les lots §37 à §47 et les deux corrections relevées par les revues du 20 novembre (§48).

CI GitHub : aucune sur ce SHA. La dernière verte, le run 44649492575, porte sur `e82992a37d`, branche seule, sans `main`. Les suites locales, rejouées sur ce code avec PostgreSQL 18.6, sont détaillées dans [Vérifications](#vérifications).

Rien de ce candidat n’est déployé. Dans la suite, « branche » veut dire vérifié sur ce SHA par les suites et les rejeux locaux ; « production » veut dire observé sur la version servie.

Sur les 33 critères suivis, 9 étaient vérifiés à la passation. Des 24 ouverts : **3 sont clos sur branche**, **15 ont avancé et gardent un reste nommé**, **6 sont bloqués** par une décision, une source ou un accès. Aucun des 24 n’est clos en production : il faut le déploiement, puis la mesure.

## Ce qui n’a pas été fait comme le demandait la passation

- **Linear** : ni lu ni mis à jour (règle de l’utilisateur pour ce dossier ; aucun accès à Linear dans la session de finalisation). La vérification des chevauchements n’est donc pas faite, ce qui ne prouve pas qu’il n’y en ait aucun (AGENTS.md). Les tickets VI-19, VI-21 et VI-27 à VI-32 ne portent aucune trace de ce travail. Le périmètre reste celui de VI-27.
- **Avis** : deux revues indépendantes, en lecture seule, ont été rendues le 20 novembre sur `e82992a37d`. Fable 5.2 a conclu CHANGES_REQUESTED, Opus 5.5 BLOCKED. Fable a ensuite cadré la finalisation (PLAN READY) ; Opus 5.5 seul l’a implémentée et testée. Selon la consigne de Hugo, une session Fable neuve relit le SHA intégré (E05b). Aucun avis Astra.
- **Base de production** : la session AWS `statarena` fonctionne. Deux lectures AWS ont été faites le 20 novembre par des sessions séparées, sans écriture ni SQL : déploiement, journaux, métriques (voir [État AWS](#état-aws-gate-séparé)). Aucune lecture SQL de la base : elle demande une tâche ECS, donc l’accord de Hugo. Les chiffres du registre qui viennent de la base (14 418 notes, 165 186 côtés Elo, 86 619 transferts…) ne sont pas remesurés.

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
| E04f | Une note Vega par participation éligible | avancé | branche | [année 2020](preuves/annee-2020/EVIDENCE.md), [intégration](preuves/integration-main/EVIDENCE.md) 48a–48e, [notes](preuves/notes/EVIDENCE.md) | Année de notation 2020 notée contre les références de 2021, sans classement (décision du 20 nov., §47 ; §48 pour l’ordre de la production) : 682/682 dans le rejeu par le vrai `Worker.daily`, 2021 inchangé. Reste : les coupes et archives que le calcul ne lit pas (E04e) ; les participations sans rôle, désormais motivées (`role_undetermined`) mais non notées ; la mesure en production après déploiement |
| E04g | Elo par match pour clubs et sélections | avancé | branche | [collecte](preuves/collecte/EVIDENCE.md) 37a–37f, [historique](preuves/historique/EVIDENCE.md) 41n–41o | Restauration des 35 identités en production (opération à accorder), puis recalcul de leurs 70 côtés |
| E04h | Elo par match et note de prestation d’équipe | sans objet | — | registre | — |
| E04i | Bonne entité, match, édition et millésime de chaque note | avancé | branche | [identités](preuves/identites/EVIDENCE.md), [notes](preuves/notes/EVIDENCE.md) | 64 notes pour 32 participations sur Lanús–Estudiantes ; versions de quantiles antérieures à vérifier sur une restauration ponctuelle de la base, dont la fenêtre de sept jours se referme vers le 25 novembre |
| E04j | Compléter les anciennes saisons selon une politique explicite | bloqué | — | [calendriers](preuves/calendriers/EVIDENCE.md) | Texte de politique proposé ci-dessous : à adopter ou corriger par l’utilisateur |
| E04k | Rattraper les notes et réveiller le calcul | avancé | branche | [collecte](preuves/collecte/EVIDENCE.md), [année 2020](preuves/annee-2020/EVIDENCE.md), [intégration](preuves/integration-main/EVIDENCE.md) | L’année 2020 est reprise une fois par l’étape des classements périmés, quel que soit l’ordre de ses calculs (§47, §48) ; les internationaux de la saison ne réveillent plus l’Elo, la Ligue des nations si (48f–48h). Reste : les notes des saisons antérieures ne sont pas reclassées après un changement d’Elo ; une correction écrite entre deux lectures du calcul |
| E04l | Signaler les échecs, distinguer zéro, absence et inéligibilité | avancé | branche | [notes](preuves/notes/EVIDENCE.md), [corrections de relecture](preuves/corrections-relecture/EVIDENCE.md) | Partiel : données et API closes sur la branche. L’écran affiche toujours « moy. 50 » quand aucun match n’est admissible (`PlayerScoutOverview.jsx:501`, `:715`), et `gradeStatus` n’est lu par aucun écran. Le changement d’écran attend une maquette validée ; il ne bloque pas ce lot |
| E04m | Algorithmes Vega et non note de fournisseur | inchangé | production | registre | — |
| E04n | Résultats internationaux anciens | inchangé | production | registre | — |
| E05a | Coordonner les pistes et respecter les propriétaires | inchangé | branche | registre | Vérification Linear non refaite |
| E05b | Double revue indépendante de la branche réunie | bloqué | — | [relecture interne](preuves/relecture/CONSTATS.md), [intégration](preuves/integration-main/EVIDENCE.md) | Deux avis rendus sur `e82992a37d` (Fable, Opus), leurs corrections faites (§48) ; reste la relecture du SHA intégré par une session Fable neuve |
| E05c | Corriger les défauts confirmés et valider avant fusion | avancé | branche | [témoins rejoués](preuves/temoins-34ca-sur-2088d36e60/EVIDENCE.md), [corrections de relecture](preuves/corrections-relecture/EVIDENCE.md), CI | Les deux avis ; accord sur les effets du déploiement |
| E06a | Rapport de couverture, matrice des sources | inchangé | branche | registre | — |
| E06b | Documenter changements, migrations, déploiements | inchangé | branche | ce document, `WORKLOG.md` | À répéter après le déploiement |
| E06e | Validation AWS avec le profil autorisé | inchangé | production (lecture seule) | [État AWS](#état-aws-gate-séparé) | Relue le 20 nov. sans écriture : déploiement conforme ; erreurs 53300 de l’API de lecture, gate séparé |

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
| Matchs internationaux de la saison | hors de l’Elo comme sur `main` ; ne réveillent plus le recalcul de l’Elo, la Ligue des nations et les autres éditions complémentaires si | `power.ELO_MATCHES`, `worker._COMPLEMENTARY` (§48) | aucun calcul Elo après une mise à jour de l’édition `nations-results:internationals:2026/2027` seule | — |
| Année de notation 2020/21 | le classement 2020/21 publié le 18 nov. (ligues à année civile seules, MLS en tête) retiré, ainsi que sa course au prix ; les notes d’août 2020 à juillet 2021 recalculées contre les références de 2021 ; les références propres de 2020 supprimées ; 2021/22 inchangé | étape des classements périmés du worker au premier passage (`power.stale_rankings`, §47 et §48 : le calcul publié de 2020 classe des joueurs) | journal `player ranking season=2020 method=power-ranking-v8 players=0` ; `/api/rankings/power?kind=players&season=2020/2021` répond 404 ; dans la base, `ref_season` 2021 pour l’année 2020 | relancer l’ancien calcul de 2020 (le code de `79ef8bbb45`) |
| Effets secondaires de 2020, actés | la contribution d’un match de 2020 reste mesurée sur la population de 2020 (méthode d’une année en cours) ; l’a priori de 2021/22 lit le classement 2020 retiré jusqu’à son prochain calcul, qui n’en trouvera plus ; 2020 sort des années du modèle de compositions (`players` > 0) ; l’éligibilité des révélations 2021 lit le classement 2020 | — | — | — |

Migrations ajoutées : 155, 156, 157, 159 et 160, toutes additives. Depuis le schéma de production (154), elles s’appliquent une fois (`applied=5 total=165`), puis plus rien (48j). Deux ont un effet sur les données :
- **160** remet à NULL la date de lecture de **toute** unité de blessures dont la dernière tentative a échoué et dont le joueur n’a aucun épisode Transfermarkt stocké. Cela inclut une liste vide acceptée puis refusée : la base ne distingue pas ce cas d’un premier 404. Le volume n’est pas mesuré.
- **159** incrémente une fois la version de **chaque** édition dont les rangs SportScore stockés se contredisent, la Veikkausliiga 2026 et toute autre (48k). En production, `DUPLICATE_GROUP` est aussi relevé sur `l_1xXulJ` et `l_45VZuL`. Le nombre d’éditions touchées n’est pas mesuré.

## Opérations de production à accorder séparément

1. **Restauration des 35 rencontres anglaises** avec leurs identifiants d’origine (`python -m vega.open_matchday_restore`, captures de `35-matchs-identites-et-elo.zip`) : essai à blanc, application, second passage ; procédure dans [historique](preuves/historique/EVIDENCE.md). Services arrêtés pendant l’opération.
2. **Lecture de la base** : `aws login --profile statarena`, puis une tâche de diagnostic en lecture seule. Les requêtes à poser sont listées dans [production](preuves/prod/EVIDENCE.md).

## État AWS (gate séparé)

**BLOQUÉ, et aggravé au recontrôle.** Deux relectures en lecture seule du 20 novembre, profil `statarena`, us-east-2, par des sessions distinctes : de 02 h 15 à 02 h 24 UTC, puis de 02 h 24 min 42 s à 02 h 53 min 38 s UTC (`finalisation-avis-aws-recontrole.md`). Aucune écriture, aucun SQL, aucune tâche lancée.

Le déploiement en service est inchangé et sain :
- **Tâches** : worker, backfill et live sur `bfab25d4ef`, définitions `:151`, un seul déploiement `COMPLETED` ; aucune stack modifiée depuis 01 h 54 UTC.
- **Migration** : tâche migrate `exit 0`, journal `applied=1 total=160`.
- **Base** : RDS PostgreSQL 18.3 (état non relu au recontrôle, la commande ayant été refusée ; métriques lues).

L’API de lecture refuse des requêtes en `53300` (`too_many_connections`), de plus en plus souvent :
- **Volume** : 73 refus de 01 h 50 à 02 h 24 UTC, puis 156 de 02 h 24 à 02 h 53, soit 229 en 63 minutes depuis le déploiement (contre 1 sur les 24 h précédentes).
- **Gravité** : jusqu’à 31 % des requêtes sur une tranche de 5 minutes ; `/api/health` touché.
- **Sans déploiement** : trois salves (02 h 25–02 h 31, 02 h 43–02 h 44, 02 h 47–02 h 49 UTC) sans aucune mise à jour ; `DatabaseConnections` plafonne à 19 pendant les salves ; concurrence de la Lambda jusqu’à 23, et à 1 pendant une salve (connexions gardées par des copies inactives, hypothèse).
- **Cause probable, non confirmée en SQL** : la limite de 12 connexions du login `vega_v2_read`, pas la limite globale. Elle ne vient pas du code de ce candidat (motif déjà vu le 15 novembre).

**Correctif et statut de production sont deux choses séparées.**
- **Le correctif** est celui de `main` (`61d0ab3573`, VI-33, une autre session) : au plus 32 copies de la fonction (`ReservedConcurrency`, passé par `deploy.sh`), login à 68 connexions, session inactive fermée par la base après 2 minutes, `stale-if-error` sur les réponses publiques. Ce candidat le contient par fusion, sans le modifier ni le réimplémenter ; ses tests de `main` (`test_api_capacity.py`, `edge.test.mjs`, `db.test.mjs`) tournent dans les suites de ce candidat.
- **Le statut de production** : au recontrôle (jusqu’à 02 h 53 UTC), ce correctif n’était pas déployé, la production étant toujours `bfab25d4ef`. Son déploiement et sa mesure relèvent de `main` et de Hugo, pas de cette branche. Déployer ce candidat déploierait aussi ce correctif.

Pour lever le blocage : un réglage en production (celui de `main` une fois déployé, ou un autre choisi par Hugo), puis zéro `53300` sur au moins 30 minutes consécutives à au moins 150 invocations par 5 minutes, sans palier de `DatabaseConnections` à 19. L’accepter comme défaut connu n’est plus recommandé.

Lectures restant à faire, en `SELECT` seulement, par une tâche `diagnose` à accorder :
- `agg.power_runs` de 2020 et 2021 ;
- `core.player_match_stats` par saison ;
- les notes 2020 par `ref_season` ;
- les lignes visées par 160 ;
- les éditions en conflit de rang ;
- `pg_stat_activity` par rôle.

## Décisions prises

| Sujet | Décision | Effet |
| --- | --- | --- |
| Année de notation 2020 (E04f), 20 nov. | Noter les matchs d’août 2020 à juillet 2021 contre les références de 2021, sans classement ni prix 2020 | §47, appliqué sur la branche ; le classement 2020/21 servi aujourd’hui disparaît au déploiement |

## Décisions attendues

| Sujet | Question | Recommandation |
| --- | --- | --- |
| Forme récente | Remplacer « moy. 50 » quand aucun match n’est admissible ? | Oui : afficher le nombre de matchs sans moyenne |
| Anciennes saisons (E04j) | Adopter la politique ci-dessous ? | Oui |
| Sélections (E04d) | Faire entrer les qualifications (1 403 du Mondial, 239 de l’Euro, 401 de la CAN) dans l’Elo des sélections ? | Mesurer l’effet d’abord ; afficher sans Elo en attendant |
| Coupes (E04b, E04c) | Livrer les 23 éditions de la branche `claude/audit-coupes` ? | Oui, après le candidat, comme lot séparé |
| Doublons natifs (E03f) | Écarter la copie non canonique de cinq paires natives des lecteurs ? | Oui, par une colonne lue par l’Elo, les notes et les listes ; à spécifier avant |
| Statistiques natives (E02d) | Refuser une réponse qui a moins de lignes que l’observation acceptée ? | Oui pour un match terminé depuis plus de 48 h |
| Retenue de fixture | Qu’emporte la levée d’une retenue (cotes, événements, prévision) ? | Rien n’est supprimé ; la fixture est marquée retirée |
| Dates de naissance | Restaurer les six dates écrasées par Wikidata ? | Oui, depuis l’instantané |
| Effets du déploiement | Accorder les effets de données ci-dessus, dont le retrait du classement 2020/21 et les portées de 159 et 160 ? | Oui, après les lectures SQL de l’[État AWS](#état-aws-gate-séparé) qui confirment que 2020 est partielle en production |
| Erreurs 53300 (gate AWS) | Déployer le correctif de capacité de `main` (`61d0ab3573`) ou un autre réglage, puis le mesurer ? | Oui, avant tout déploiement de ce candidat ; plus comme défaut accepté (jusqu’à 31 % de refus, `/api/health` touché) ; hors de cette branche |

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

Seconde relecture, sur `1cc4af1200` : aucune perte de données. Lectures de la migration 159 trois à vingt-cinq fois plus lentes (pages nation, classements) : ramenées à au plus 1,5 fois leur temps d’avant (§43.4). Recherche Transfermarkt d’un club sans nom refaite chaque jour : bornée à une reprise (§45.4). Migrations 155 à 160 corrigées en place pendant la journée : une base de développement migrée sur un SHA intermédiaire du candidat est à recréer ; la production, à 154 depuis le 20 nov., n’est pas concernée (aucune de ces migrations n’y est appliquée).

Revues du 20 novembre sur `e82992a37d` (lecture seule) : Fable 5.2 CHANGES_REQUESTED, Opus 5.5 BLOCKED. Leurs motifs et ce que la finalisation en fait ([intégration](preuves/integration-main/EVIDENCE.md)) :

| Motif | Suite |
| --- | --- |
| Le recalcul de 2020 ne se déclenche pas dans l’ordre de la production | corrigé (§48, 48a–48e) |
| `e82992a37d` n’est pas le SHA déployable, il manque `main` | fusions réelles de `c4a3cacd77` puis `61d0ab3573` ; 154 (identique à la production) et la bande des sélections conservées ; migrations rejouées depuis 154 (48j) |
| Les internationaux réveillent l’Elo à chaque résultat | corrigé (48f–48h) ; lecture partagée à neuf éditions (48i) |
| E04l déclaré clos | ramené à avancé (écran non changé) |
| Portées de 159 et 160, effets secondaires de 2020 | décrits ci-dessus ; volumes non mesurés |
| Le rapport sous-déclarait la CI et l’état de production | mis à jour |
| Incident 53300 | gate séparé ; correctif écrit sur `main` (`61d0ab3573`), contenu par fusion, non réimplémenté ici |

## Vérifications

| Vérification | Résultat |
| --- | --- |
| CI GitHub | aucune sur le code `16a782abb6` ni sur les SHA intégrés, faute de push ; la dernière, le run 44649492575, est verte sur `e82992a37d` (branche seule) ; avant elle, le run 44601959463 sur `c6c4592ca7` |
| Suites locales du code `16a782abb6` (PostgreSQL 18.6, Python 3.14, Node 24 et 26, harnais de la CI) | Python 758/758 OK, aucun test sauté, aucun échec attendu ; API 227/227 ; site 803/803 ; build du site, image du worker et ses contrôles, `cfn-lint`, paquets API et live réussis ([intégration](preuves/integration-main/EVIDENCE.md)) |
| Référence `main` `c4a3cacd77`, même harnais | Python 636, API 223, site 803 : tout vert |
| Après la fusion de `61d0ab3573` | une passe complète sur le SHA intégré, résultats consignés hors du dépôt (`validation-opus/run-ci/`) pour ne pas changer le SHA testé |
| Tests §48 | rouges sur la fusion `1594b63731` (6 échecs sur 46), puis verts sur `16a782abb6` (46/46) |
| Suites antérieures du candidat | `b2bedf115f` : Python 747 (1 sauté, pgvector absent), API 226, site 788 ; `79ef8bbb45` : Python 743 (1 sauté, 1 échec attendu 38a) |
| Référence `2088d36e60` | Python 635, API 222, site 788 |
| Production, API publique, 19 nov. 13 h 19–13 h 39 UTC | 442 lectures ; voir [production](preuves/prod/EVIDENCE.md) |

## Non vérifié

- Tout ce qui demande la base de production : volumes réels des refus nouveaux (`HISTORY_CONFLICT`, `EMPTY_AFTER_OBSERVATION`, `COPY_NOT_COVERED`), durée de `worker.elo_due`, homonymes parmi les 301 noms de clubs relus, présence d’une table Vega pour la Veikkausliiga.
- Le rendu du site : aucun écran n’a été modifié, aucun parcours navigateur n’a été rejoué sur le candidat.
- Les scores de Pologne, du pays de Galles et de la FA Cup rattrapés ne sont pas recoupés avec les organisateurs : ils portent la mention « publié par la source » avec le commit.
- Le travail isolé « Isolated pilot » (données réelles PitchAPI) ne tourne que sur `main` et les branches `claude/v2-*` : il n’a pas tourné sur ce candidat.
- Sans lecture de la base de production : que 2020 soit bien la seule année partielle (`core.player_match_stats` sans saison 2020) ; l’heure exacte des calculs publiés de 2020 et 2021 (déduite des journaux) ; la durée du calcul 2020 sur RDS.
- Les clubs créés par nom pour les 359 matchs Open Matchday ne sont pas comptés : risque de doublons (E03c).
- La page nation : un amical de l’édition des internationaux est listé une fois, sous le nom de l’édition (« Matchs internationaux 2026/2027 », 48l). Le carrousel de `main` en fait le groupe « Matchs internationaux 2026/2027 2026/27 » (saison en double), pas « Matchs amicaux ». Le libellé est le même avec ou sans 159 : le nom de la compétition vient de la projection de `main`. Constat seulement : l’écran n’est pas modifié.
