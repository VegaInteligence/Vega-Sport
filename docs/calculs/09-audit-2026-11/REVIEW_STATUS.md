# État de la revue — reprise du 17 novembre 2026 (étape 8)

Le contrôle du 18 novembre couvre les 38 critères initiaux, les nouvelles familles de calcul et les grilles de production par compétition, saison et type de participant. Les nombres et les limites ci-dessous gardent la date du relevé historique. [État actuel et preuves](../../audits/2026-11-17/SITUATION.md) · [Registre critère par critère](../../audits/2026-11-17/registres/requirements.csv)

La session à qui l’utilisateur a confié VI-23 l’a rebasée sur `main` (migrations 128–131, puis 132),
a fait faire la revue finale (Opus) et l’a mesurée en lecture seule sur la production. Un bloquant :
les tirs de but ne portent jamais « faux » pour l’indicateur contre son camp, si bien que la règle de
l’étape 7 ne mesurait finition, gardien, conversion et xG par tir que sur les matchs sans but ; et les
autres clubs d’un championnat n’étaient jamais mesurés. Corrigé par l’étape 8
([FAILURE_MODES §17](FAILURE_MODES.md)) : une seule classification par match côté serveur, lue par le
calculateur et par toutes les fiches de match.

Validation locale (Python 3.14) : voir la preuve d’étape 8 et le ticket Linear. Poussé et déployé le
17 novembre 2026 (`3d4bb282a0`, migrations 128–132 appliquées) ; le site en production donne les valeurs
attendues. Le recalcul des 2 149 éditions attend encore l’accord explicite de l’utilisateur.

---

# Checkpoint précédent — 17 novembre 2026, avant la reprise

Les corrections indépendantes sont implémentées et validées localement. **La vérification finale
conjointe reste en attente : le recontrôle Opus du lot corrigé est bloqué par son quota.** VI-23
reste In Progress. Les commits locaux conservent le travail ; ils ne constituent ni un déploiement,
ni une acceptation de production, ni une clôture de l’audit complet.

| Étape | Résultat conservé |
|---|---|
| Planification Astra/xhigh + Opus5.5/max | Deux contributions et brief rapproché, conservés dans les preuves locales |
| Implémentation | Même session Opus5.5/max, sept étapes, modèles et efforts vérifiés |
| Revue Opus v2, session fraîche | [Changements demandés](reviews/opus-v2.md), puis périmètre rapproché par Astra |
| Vérification Astra/xhigh v3 | [Acceptée pour le périmètre indépendant](reviews/astra-v3.md), 66 tests relancés indépendamment |
| Recontrôle Opus v3 | Deux échecs de quota, aucun verdict : `20261117T082256Z-review-2e031a65`, puis `20261117T083122Z-review-74419bfa` après l’heure de reprise annoncée |
| Rapprochement final disponible | [Disposition de tous les constats v2](reviews/reconciliation-v3.md) ; aucune nouvelle correction indépendante demandée, recontrôle Opus toujours indisponible |

Les deux tentatives v3 ont conservé les empreintes du lot. La seconde a échoué après l’heure
annoncée de reprise (10h30 Europe/Paris, horloge vérifiée à 08:30:50 UTC). Aucun autre essai,
changement de modèle, abonnement ou facturation n’a suivi.

Validation : Python388, API173, site662 ; navigateur réel132 assertions desktop/mobile ; build17pages.
Les suites Python/API et les deux intégrations propriétaire9/9 portent sur les sources inchangées
vérifiées par empreintes. Les essais RED, l’avis Next16.4.3, l’échec initial de préparation du navigateur
et sa correction avec assertions inchangées sont conservés, sans être présentés comme des succès.

Lot v3 relu : HEAD de base `a912ed319e4a0441f09b3f55151393e28c9a215c` ; 1080 fichiers,
empreinte `c56f0d68d0d17c95258057589b87a9bf97dfdf234076452c5c4ddc30abff5204` ; diff
`e1e1f084c3032f8038f53878ee04b8672d5fd5d35be5f0a78f5b1a84dee11dd6`.
Ensuite : documentation de livraison et suppression d’une ligne vide finale dans
`test_audit_models.py` demandée par `git diff --check`. AST du test et assertions strictement
identiques ; aucun code applicatif changé. Preuve : `checkpoint-whitespace.json`.

Preuves, commandes, entrées, sorties, captures, plans et manifestes :
`/Users/lemonnierhugo/.codex/visualizations/2026/11/17/01a1e6f1-9c43-7b81-a52e-3ee15c953578/calculation-review`.
Voir `final-evidence-index-v3.md`, `final-review-status.json` et `local-commit-receipts.json`.

Prochaine étape : quand Opus est disponible, figer le checkpoint courant et obtenir une nouvelle
revue Opus/max contre la base originale ; faire rapprocher ses conclusions par Astra, corriger
et revalider si nécessaire, puis seulement clôturer VI-23. Aucun push ni déploiement demandé.
Les relais VI-19/21/22 restent avec leurs propriétaires ; les limites réelles figurent dans
[la matrice](TRACEABILITY.md).
