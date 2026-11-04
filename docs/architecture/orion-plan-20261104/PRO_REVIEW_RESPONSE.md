# Prise en compte de la revue GPT Pro

La revue complète est conservée dans `inputs/GPT_Pro_review.original.txt`. L’utilisateur l’a priorisée, puis a explicitement choisi « Valider et lancer le pilote ». Le [reçu d’approbation](../../verification/orion-pro-pilot-20261104/approval.json) conserve le plan et le modèle `028c221d…` du commit `4112076…`. Le [reçu d’amendement](../../verification/orion-pro-pilot-20261104/model-amendments.json) relie ce modèle au candidat courant `18da43f9…` par huit chemins ciblés, sans seconde approbation revendiquée ni ajout de table, colonne ou clé.

La conservation reste sélective dans les tables métier, avec lecteurs courants simples, zéro table sœur d’historique et quatre registres universels retirés. Le pilote local est autorisé et en cours ; aucune application du nouveau schéma sur RDS, purge ou bascule finale n’est revendiquée. Un statut de conception n’est pas un reçu d’exécution.

| Point | Traitement et preuve bornée | Limite restante |
|---|---|---|
| Plan et JSON divergents | Modèle courant, dictionnaire, diagrammes et texte générés ensemble ; navigateur vérifié séparément pour le SHA courant | Les anciens 1 208 contrôles `028c…` restent historiques, sans réattribution au candidat |
| Valeurs corrigées | Versions typées, ancres et snapshots ; régression locale candidat 23/23, dont correction/relecture et cohorte | Périmètre réel complet, lecteurs publics et fidélité numérique générale |
| A — réponses HTTP | Cas `http_dedup` et gardes des reçus réussis dans la régression locale | Collecteur de production, volumes et exploitation RDS |
| B — profils des tirs | FK composite et CHECK ; cas `shot_profiles` local réussi | Toutes variantes réelles, médias et contrats publics |
| C — contrats | PK versionnées et cas `contract_and_seed_versions` local réussi | Évolution complète des contrats et déploiement distant |
| D — version du bon fait | Registre universel retiré ; cas de mauvais parent/fournisseur et cohérence de sélection réussis localement | Exhaustivité des rattachements et lecture applicative |
| E — états source | Quatre CHECK et quatre descriptions amendés dans les deux tables de métriques enregistrées ; PostgreSQL candidat 25/25 | Les colonnes statistiques communes, notamment xG, exigent mapping et cohérence avec ces observations ; inventaire exhaustif non acquis |
| F — bootstrap | Cas de bindings, reprise et migrations idempotentes réussis dans PostgreSQL jetable | Préflight et acceptation du pilote RDS borné |
| G — cartes/réseaux | Cas `atomic_heatmaps_networks` et collections réussis sur fixtures locales | Volumes réels, repères spatiaux, index et temps mesurés |
| G — file | Cas `queue_lease` et concurrence/générations réussis localement | Workers et reprise de production |
| Append-only | Clés de normalisation, sélecteurs à g et cas de correction du même record réussis localement | Transformateurs et familles réelles complètes |
| H2H | Source/record lié au fournisseur du parent ; cas adversarial local réussi | Réponses publiques depuis matchs canoniques et familles source réelles |
| Complexité | Aucune table/cellule de registre universel ajoutée ; provenance distincte des preuves | Contributions de plusieurs records encore à inventorier |
| Disponibilité | Vercel rétabli sur le même build, pont temporaire Neon ; correctif AWS séparé | AWS preview partiel, bascule finale et acceptation conjointe ouvertes |
| Référence des 84 tables | Responsabilités et dispositions conservées, aucun quota de découpage | Réconciliation de tous les champs/variantes avant retrait |

Le [run métriques initial](../../verification/orion-pro-pilot-20261104/metric-state-runs/20261104T182823662466Z-original-approved-null-absent-red/result.json) conserve **19 réussites, 4 échecs, 2 non vérifiés**. Le [run candidat](../../verification/orion-pro-pilot-20261104/metric-state-runs/20261104T183139777229Z-targeted-native-metric-candidate/result.json) passe **25/25** sur entrées synthétiques : zéro, chaîne vide, faux, null, absent, combinaisons contradictoires et lecture figée. Une ligne manquante reste inconnue ; `absent` exige un champ attendu et une couverture acceptée prouvés. Ce succès ne prouve pas l’état natif de `player_match_stats.xg` ou d’autres projections communes.

La [régression SQL du candidat](../../verification/orion-pro-pilot-20261104/runs/20261104T183222785812Z-recorded-metric-amendment-regression/result.json) passe **23/23**. Le [core issu de sources réelles](../../verification/orion-pro-pilot-20261104/real-source-runs/20261104T182830125656Z-core-shot-family-coverage/result.json) passe **9/9 sur `028c…`**, avec `fullAcceptance=false` et des dispositions de champs encore non vérifiées. Ces preuves restent distinctes ; les familles supplémentaires du candidat sont en cours. Aucun résultat ne clôt l’inventaire des sources, la parité publique, les performances/capacité RDS ou les conditions de purge.

Les nouvelles données suivent PitchAPI → mémoire → SQL typé ; aucun nouveau corps de réponse ou document sportif opaque n’est autorisé. Les sources historiques restent temporairement jusqu’à réconciliation et fin des dépendances du transfert. Préparation, entrées, commandes, résultats et journaux du pilote sont conservés dans les reçus liés ; les anciens inventaires et prototypes ne sont pas des preuves actuelles.

Commit suggéré : `docs: refresh approved Orion pilot and native metric evidence`.
