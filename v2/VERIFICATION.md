# Validation du prototype v2 — 8 novembre 2026

Les étapes 1 et 2 du schéma v2 sont validées sur une nouvelle base PostgreSQL isolée. Les 306 matchs de Ligue 1 2025/26 ont leurs 13 familles importées, soit 3 978 familles, sans erreur résiduelle ni champ inconnu signalé. Le RDS et le site actuels sont restés inchangés.

## Preuves

- Code exécuté : `dafd695b51c6ff4c3fa632fd17b100132ab95516`.
- [Pilote complet réussi](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42522162962), PostgreSQL 16.15 sur le runner GitHub.
- [Rapport complet](verification/ligue1-2025-26-20261108.md) et [quatre cas de régression](verification/regressions-20261108.md), copiés de l'artefact de ce run.
- 50 tests locaux, dont les contraintes PostgreSQL/pgvector, passent. En CI, 49 passent et le cas pgvector est sauté car l'extension n'est pas installée dans le service standard ; il a été exécuté localement sur PostgreSQL 16.10 et pgvector 0.8.1.
- [Contrôles d'ingestion existants réussis sur ce commit](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42522167545).

Le contrôle ciblé a importé quatre matchs, puis la passe complète a conservé ces quatre imports et ajouté les 302 autres dans la même base. Aucune deuxième passe de récupération n'a été nécessaire. Les réponses sont traitées en mémoire puis écrites en colonnes typées ; seuls des rapports de mesures sont exportés.

## Mesures

Les Mo ci-dessous correspondent à un million d'octets. Les tailles physiques comprennent les index et le TOAST.

| Périmètre | Octets | Mo |
|---|---:|---:|
| Faits et références `core` | 28 622 848 | 28,62 |
| Collecte et versions `ops` | 2 007 040 | 2,01 |
| Structure `agg`, encore vide | 278 528 | 0,28 |
| **Total des trois schémas** | **30 908 416** | **30,91** |

Cela représente environ **93,5 Ko de faits par match**, références comprises. Le document estimait environ 25 Mo pour la saison ; la mesure est proche de cet ordre de grandeur. Une extrapolation linéaire de `core` donnerait 4,54 Go pour 48 500 matchs ou 9,35 Go pour 100 000 matchs. Ces projections supposent une couverture comparable à cette saison et excluent les futurs agrégats, les sources supplémentaires et la rétention opérationnelle.

La collecte a effectué **3 986 appels HTTP** : 3 978 familles de match, quatre appels de catalogue/calendrier et quatre profils. Tous ont répondu 200. Aucun 429 ni réessai HTTP n'a été observé pendant ce run. Le temps cumulé des deux phases de collecte est de **21 min 10 s**, dont 28,51 s pour le contrôle ciblé et 1 241,45 s pour la passe complète.

La cadence minimale entre débuts de requêtes était de 0,25 s, en série. Le débit observé est d'environ 3,14 appels/s ; ce n'est pas une capacité garantie du fournisseur. Une réponse 429 augmente la cadence minimale à une seconde et fait respecter `Retry-After`.

Les écritures par famille ont une médiane entre **3,14 ms et 130,35 ms**, et un p95 entre **4,08 ms et 154,71 ms**. Ce sont des durées mesurées côté collecteur, qui incluent la résolution des références et la transaction PostgreSQL. Elles ne mesurent ni une requête de lecture isolée ni le chargement du site. Le réseau de passes est la famille la plus coûteuse à écrire dans ce test.

## Couverture conservée

- Les 306 réponses de chaque famille de match ont été importées. Un succès d'import ne signifie pas que chaque champ ou période est renseigné par le fournisseur.
- 685 identités joueur et 18 équipes sont enregistrées. Les profils explicites sont un échantillon de **2 joueurs et 2 équipes** ; les autres références proviennent des matchs et ont un travail de profil en attente.
- **19 identités joueur n'ont pas de nom fourni.** Leur nom reste NULL ; leurs événements et tirs sont conservés. Aucun nom artificiel n'a été ajouté.
- Les métriques physiques sélectionnées sont absentes dans cette collecte : zéro distance, sprint ou vitesse non NULL parmi les 12 200 lignes de statistiques joueur. Cette absence n'est pas transformée en zéro.
- Les données de modèles, contrats, blessures, projections et sources futures restent vides. Les images ne sont pas téléchargées : seules leurs métadonnées sont enregistrées.

## Corrections vérifiées

Le premier essai saisonnier était incomplet et n'est pas retenu comme mesure finale. Il a permis de corriger les dénominateurs des fractions, les alias physiques, la conservation du pourcentage publié des passes et la dépendance incorrecte entre une fiche joueur manquante et ses événements. Les noms vides sont normalisés en NULL. Les erreurs serveur 5xx, dont 521, font l'objet de réessais bornés.

Les tests couvrent aussi le remplacement atomique, la conservation des faits après échec, les références sans nom, l'enrichissement ultérieur sans nouvelle identité, les baux expirés ou visant une autre famille/un autre match, les imports concurrents partageant des joueurs et la stabilité des versions lorsque seul l'ordre des lignes change.

## Étape suivante

Ces mesures permettent d'ouvrir la revue AWS prévue à l'étape 3 : instance, stockage, réseau privé, sauvegardes et alarmes. Elles ne démontrent pas encore un gain de chargement web : l'alimentation des agrégats et leur API de lecture relèvent de l'étape 6, avant la bascule du frontend.

# Suite de l'implémentation (PR #54) — 9 novembre 2026

La PR #54 reprend la PR #53 et l'aligne sur le document validé : saisons, identités, tables manquantes, agrégats avec couverture, calculateur, vues `api`, planificateur et worker, modèles, API de lecture, rôles en base, piles AWS (non déployées).

## Preuves

- [Passage CI complet réussi](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42552580375) sur `117b80271a` : 91 tests Python, 8 tests de contrat de l'API (exécutés avec le rôle `vega_read`), pilote Ligue 1, puis 700 travaux du worker sur les vrais calendriers.
- [Rapport du worker](verification/worker-calendars-20261109.md), copié de l'artefact de ce run.

## Ce que les passages réels ont montré, et ce qui a été corrigé

Quatre passages successifs du worker sur les calendriers réels de J−1 à J+7 (toutes compétitions) ont servi de banc d'essai. Chacun a révélé un cas que les tests synthétiques ne pouvaient pas voir ; chacun est corrigé et couvert par un test :

| Passage | Constat | Correction |
|---|---|---|
| 1 | `/date` donne la compétition mais pas l'édition : 307 matchs refusés, aucune surveillance de score | un match sans édition va dans l'édition en cours de sa compétition (récupérée d'abord si inconnue) ; `is_current` est tenu |
| 1 | un statut inconnu faisait échouer toute la journée | le statut nouveau est signalé comme chemin inconnu, le reste est écrit |
| 2 | 10 résumés nommaient une autre édition que celle supposée | l'édition donnée par `/matches/{id}` gagne : le match est déplacé tant qu'il n'a pas de faits d'après-match |
| 2 | statut `started` | lu comme `in_play` |
| 3 | un code de tir inconnu faisait perdre tous les tirs d'un match | le tir est gardé, le champ reste vide, le code est signalé |
| 4 | code `OwnGoal` | lu comme but contre son camp |

Le dernier passage : **700 travaux, 761 appels, aucun échec contrôlé**. 202 matchs terminés et confirmés, une trentaine de matchs collectés sur leurs 13 familles, 626 matchs, 1 809 joueurs, 1 545 saisons joueur et 422 saisons club calculées. Les modèles ont tourné sur ces données : 330 cohortes, 4 888 centiles club, 508 indices club, 403 niveaux. Aucun centile joueur, comme attendu : avec environ un match par club, personne n'atteint les 450 minutes requises.

## Vérifications locales

- Les formules des modèles sont recalculées à la main dans `tests/test_models.py` (centiles, rangs, distributions, phases, indice, positions, rôles, indice joueur, similarité, niveaux avec les trois exemples de `docs/calculs`, force, profils d'âge, recalcul incrémental et différé).
- Les droits sont éprouvés dans `tests/test_roles.py` : la collecte crée des partitions sans posséder de table et n'atteint pas `agg` ; le calcul n'écrit pas `core` ; la lecture ne voit que `api`.
- Les trois gabarits CloudFormation passent `validate-template` ; l'image du worker se construit (ARM64) et ses entrées répondent ; le paquet de l'API se construit et répond hors ligne.

## Limites

Seules les routes listées dans le README sont servies par la v2 ; la parité réelle et la bascule attendent le déploiement et le backfill. Les sources autres que PitchAPI ne sont pas encore branchées. Les calibrations du niveau européen restent celles de la démo du site, versionnées `levels-demo-v1`.
