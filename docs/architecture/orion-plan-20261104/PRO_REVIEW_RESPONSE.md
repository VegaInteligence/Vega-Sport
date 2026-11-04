# Prise en compte de la revue GPT Pro

La revue complète est conservée dans `inputs/GPT_Pro_review.original.txt`. L'utilisateur lui a explicitement donné priorité sur son choix intermédiaire « état courant seulement ». La cible est donc une conservation **sélective des valeurs nécessaires dans les tables métier elles-mêmes**, avec des lecteurs courants simples. Les 54 tables sœurs `_history` restent supprimées. Aucune réorganisation n'a été appliquée au RDS.

Ce document sert de matrice de suivi. « Décrit » ou « vérifié statiquement » ne signifie ni exécuté dans PostgreSQL ni accepté sur le site.

| Point de la revue | Traitement retenu | Preuve ou vérification encore nécessaire |
|---|---|---|
| Plan et JSON divergents | Générer les chiffres et le texte depuis le même modèle, puis promouvoir ensemble le document complet | `tools/render_plan_text.py`, `tools/rebuild_plan.py` ; reçu de cohérence et navigation du modèle final |
| Politique des anciennes valeurs | Versions sélectives dans les tables métier ; identités stables, profils/dépendances figés et collections atomiques | `PRO_VERSIONING_DESIGN.md` ; transformation réelle des PK/FK puis E2E correction/recalcul |
| A — unicité HTTP | Empreinte de requête obligatoire en HTTP ; unicité requête/corpus/contenu, tentatives séparées | Helper de contraintes ; doublons et requêtes distinctes à exercer dans PostgreSQL |
| B — profils des tirs | Profil présent ⇒ identité présente, puis FK composite de bonne appartenance | CHECK et FK réels, cas NULL et mauvais joueur/gardien |
| C — contrats | PK de relation/contrat et de champ versionnées, références composites | Helper de versions ; enregistrer deux contrats et refuser les références incompatibles |
| D — liaison d'une version à son fait | Retirer le registre universel ; versions locales et ancres de FK typées | Vérifier les clés réelles et la cohérence du même snapshot, pas seulement l'existence d'un ID |
| E — états des champs | États ciblés et CHECK de type ; supprimer le mécanisme universel par cellule | Inventaire exhaustif des ambiguïtés ; fidélité API et absence/null/zéro/vide avant purge |
| F — initialisation | Bootstrap explicite des générations, définitions, contrats et provenance | Base PostgreSQL vide, interruption/reprise et journal ; aucun `passed` de conception comme substitut |
| G — cellules | UQ de coordonnées par version immuable de grille ; bornes sous contrôle parent | SQL réel, doublon/hors-grille, deux révisions et enfants immuables |
| G — file de collecte | Une file issue de l'existant, états/tentatives/baux bornés, acquisition atomique et index lié à la requête | `FOR UPDATE SKIP LOCKED`, concurrence, expiration et achèvement avec propriétaire/tentative valides |
| Complexité permanente / preuve | Provenance technique distincte des valeurs retenues et des artefacts de migration | Quatre registres universels retirés ; aucune preuve de migration lue dans chaque requête web |
| Heatmaps | Parent de version de carte, cellules relationnelles typées sans révision individuelle | Volume/index/temps comparés sur les cartes réelles du pilote |
| H2H | Résultats résolus lus dans les matchs canoniques ; observations non résolues conservées explicitement | Corriger un match et vérifier les confrontations sans divergence |
| Disponibilité et timeout | Lot opérationnel distinct, sans attendre la refonte ; couverture et UI à préserver | Dossier `../../verification/orion-availability-20261104/` ; aucune mise en production déduite de health200 |
| Reproductibilité d'un calcul | Figer cohorte, valeurs, dépendances, code, paramètres et règles numériques | Exemple 0,82 → 0,67 puis recalcul ; rester explicite sur l'état navigateur et les données manquantes |
| Corrections append-only d’un même record | Standing : UQ de contexte + data_revision interne ; détails : PK source_record_id + recorded_from_gen ; ranking : révision interne de normalisation | Sélection à g, égalité/no-op, révisions/générations strictement ordonnées, deux normaliseurs et recalcul antérieur ; aucune SQL exécutée |
| Provenance H2H | FK composite source_id/source_record_id vers le record du fournisseur déjà fixé par le parent | Record d’un autre fournisseur refusé en PostgreSQL, cas positif même fournisseur |
| Référence des 84 tables | Suivre les responsabilités et le diff ; aucun quota de tables | Correspondance du socle, raisons de fusion/retrait/report et contraintes effectivement cohérentes |

Le pilote doit conserver préparation, entrées, commandes, résultats attendus/réels et journaux. Les inventaires plus anciens et le prototype local abandonné restent des preuves datées ; ils ne valident pas ce nouveau schéma.

Les nouvelles données suivent PitchAPI → mémoire → RDS typé. Aucun nouveau corps de réponse n'est stocké dans S3 ou SQL documentaire. Les anciens fichiers restent temporairement jusqu'à la réconciliation ; leur suppression ne précède ni la couverture complète ni la fin des dépendances du transfert du partenaire.

Commit suggéré : `docs: align the Orion schema and pilot with the Pro review`.
