# Plan Pro approuvé — candidat et preuves du pilote

4 novembre 2026, Europe/Paris. **Le pilote borné est autorisé et en cours.** Le modèle courant est `18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08` ; le plan, JSON, lecteur, dictionnaire et diagrammes l’utilisent. Ce rafraîchissement ne modifie ni modèle, ni helper, ni compilateur et n’exécute aucun SQL ou changement de service. Des lots distincts ont exécuté les E2E locaux bornés cités ci-dessous. Aucun nouveau schéma appliqué sur RDS, purge ou bascule finale n’est affirmé.

## Approbation et amendement

Le [reçu d’approbation](../../../verification/orion-pro-pilot-20261104/approval.json) conserve le choix explicite « Valider et lancer le pilote », le commit `411207645f61f9fa0a9e31680edbe475a0432868`, les octets du plan et le modèle initial `028c221d…`. La portée comprend PostgreSQL local jetable puis une compétition/deux saisons sur le RDS existant après acceptation locale et préflight frais. Aucune nouvelle confirmation globale du même plan n’est demandée.

Le [reçu d’amendement](../../../verification/orion-pro-pilot-20261104/model-amendments.json) documente huit chemins dans les deux tables existantes de valeurs de métriques : **quatre CHECK, deux descriptions de value_kind et deux descriptions de table**. Aucun ajout de table/colonne/clé. Le [readback indépendant en lecture seule](native-metric-amendment-readback.json) retrouve exactement ces huit différences entre le modèle du commit approuvé et le candidat. Cette correction ciblée relève du périmètre autorisé ; le reçu ne prétend pas à une seconde approbation utilisateur.

## Résultats et portée exacte

| Vérification | Résultat réel | Portée / preuve |
|---|---|---|
| Catalogue complet | 103 tables, 1 791 colonnes, 450 FK ; actif 94 tables, 1 709 colonnes, 431 FK | [proposal-inspection.json](proposal-inspection.json), [plan-coherence.json](plan-coherence.json) ; 9 réserves de modèles sans nouvelle formule |
| Classes et contraintes | 46 sélectives, 6 enfants atomiques, 9 append-only, 3 identités stables, 39 autres ; 109 UQ, 154 index dont 119 uniques partiels, 889 CHECK, 51 JSONB bornés | 0 table sœur, 0 registre universel retiré revenu, 0 violation statique ; aucune SQL déduite de l’inspection |
| Responsabilités et rendu | 84 dispositions, 224 correspondances, 0 définition de secours ; 13 domaines + 2 architectures + 1 vue = 16 SVG | Toutes tables/colonnes/FK de domaine rendues ; matrice de champs source exhaustive encore ouverte |
| Navigateur candidat | 1208 contrôles réussis ; 103 tables/1 791 colonnes/450 FK parcourus, 14 diagrammes chargés, descriptions de table/colonne et toutes les contraintes comparées au candidat | [viewer-e2e.json](viewer-e2e.json), [détails](viewer-checks.json), [log](viewer-e2e.log) ; desktop/mobile/clair/sombre, 0 erreur JS/HTTP et 0 requête extérieure |
| Composants de transformation existants | Protocoles contraintes/versions réussis et idempotents sur fixtures temporaires | [pro-transform-protocols.json](pro-transform-protocols.json) ; le helper natif de métriques relève des preuves séparées ci-dessous |
| États des métriques, candidat | **25/25** sur PostgreSQL 18.6 jetable, SHA `18da…` | [Résultat exact](../../../verification/orion-pro-pilot-20261104/metric-state-runs/20261104T183139777229Z-targeted-native-metric-candidate/result.json) ; valeurs zéro/vide/faux/null/absent, rejets contradictoires, correction et lecture figée joueur/équipe sur entrées synthétiques |
| Régression SQL, candidat | **23/23**, SHA `18da…` | [Résultat exact](../../../verification/orion-pro-pilot-20261104/runs/20261104T183222785812Z-recorded-metric-amendment-regression/result.json) ; schéma actif, bootstrap, reprise, corrections, parents, collections, générations, publication et baux sur fixtures bornées |
| Core issu de sources réelles, base initiale | **9/9 sur `028c…`**, `fullAcceptance=false` | [Résultat exact](../../../verification/orion-pro-pilot-20261104/real-source-runs/20261104T182830125656Z-core-shot-family-coverage/result.json) ; 612 fixtures, 15 437 performances dans le périmètre enregistré, dispositions non vérifiées conservées ; pas une preuve attribuée au candidat |
| Familles réelles supplémentaires | En cours ; dernier échec initial conservé, 1 réussite/1 échec/9 non vérifiés pour transformateur manquant | [Résultat initial](../../../verification/orion-pro-pilot-20261104/real-source-runs/20261104T183118248508Z-initial-red-missing-original-family-transformer/result.json) ; aucune acceptation globale déduite du core |

Le run initial des états de métriques sur `028c…` reste [RED : 19 réussites, 4 échecs et 2 non vérifiés](../../../verification/orion-pro-pilot-20261104/metric-state-runs/20261104T182823662466Z-original-approved-null-absent-red/result.json). Le candidat n’efface ni ce résultat ni les échecs antérieurs de bootstrap, provenance ou gardes du pilote.

Dernier E2E documentaire candidat : `2026-11-04T18:37:57.207431+00:00`. Captures actuelles : [desktop](architecture-desktop.png), [tirs](shots-desktop.png), [vue BDD](database-overview-desktop.png), [mobile](receipt-mobile.png), [mobile sombre](receipt-mobile-dark.png). Son SHA est celui du candidat, vérifié depuis la réponse HTTP locale. Les anciens 1 208 contrôles `028c…` sont [historiques](historical-approved-028c-before-native-metrics/README.md) et ne sont pas réutilisés comme preuve du candidat.

La première livraison 161 tables/1 971 colonnes/368 FK et ses 201 contrôles reste dans [historical-first-delivery](historical-first-delivery/README.md). Les [protocoles initiaux](historical-pre-pro-protocols/README.md), le [modèle avant correction append-only/H2H](pro-before-append-only-review/README.md) et leurs échecs restent conservés. Les passages au vert sont bornés à leur empreinte, leurs entrées et leurs assertions.

## Reproduction locale

Racine : `/Users/lemonnierhugo/Desktop/Coding Project/Football_ranking`. Environnement existant : Python 3.14.6, `markdown-it-py` 4.2.0, Node 26.4.0, `@viz-js/viz` 3.31.0 / Graphviz 16.1.0 et Chromium local. Les dépendances ne deviennent pas celles de l’application.

Si nécessaire, préparer le moteur avec `npm install --prefix /tmp/statarena-plan-tools-20261104 --no-save @viz-js/viz@3.31.0` et installer `markdown-it-py==4.2.0` dans l’environnement Python utilisé. Générer et promouvoir le dossier entier seulement après les contrôles statiques :

```bash
python3 -B docs/architecture/orion-plan-20261104/tools/rebuild_plan.py
```

[rebuild.json](rebuild.json) conserve sources SHA-256, commandes, sorties et codes retour des six étapes. Le staging laisse la livraison précédente en place en cas d’échec ; un reçu d’échec est sauvegardé avant suppression du dossier temporaire. Aucune opération SQL ou distante n’existe dans cette commande.

Les deux anciens scripts de protocole des composants contraintes/versions reconstruisent une fixture temporaire au bon stade du générateur et gardent leurs assertions de première application. Ils ne couvrent pas le nouveau helper d’états de métriques ; son reçu PostgreSQL 25/25 et l’amendement exact restent des preuves distinctes. L’entrée de contraintes comporte 107 tables avant retrait des registres ; celle des versions aboutit aux 103 tables. Le SHA de fixture est distinct du modèle final. Rerun exact des deux protocoles :

```bash
python3 -B - <<'PYCODE'
from pathlib import Path
import re
for name in ('CONSTRAINT', 'VERSION'):
    p = Path(f'docs/architecture/orion-plan-20261104/tools/PRO_{name}_PROTOCOL.md')
    code = re.search(r'```python\n(.*?)\n```', p.read_text(), re.S).group(1)
    exec(compile(code, str(p), 'exec'), {'__name__': '__main__'})
PYCODE
```

Servir uniquement le dossier documentaire dans un terminal distinct :

```bash
python3 -m http.server 8794 --bind 127.0.0.1 --directory docs/architecture/orion-plan-20261104
```

Adapter le chemin Chromium dans [browser-config.json](browser-config.json) si nécessaire. Créer le dossier et ouvrir une session neuve depuis celui-ci :

```bash
mkdir -p output/playwright/orion-plan
cp docs/architecture/orion-plan-20261104/evidence/browser-config.json output/playwright/orion-plan/browser-config.json
cd output/playwright/orion-plan
/Users/lemonnierhugo/.codex/skills/playwright/scripts/playwright_cli.sh -s=orion-plan close
/Users/lemonnierhugo/.codex/skills/playwright/scripts/playwright_cli.sh -s=orion-plan open http://127.0.0.1:8794 --config browser-config.json
cd ../../..
python3 -B docs/architecture/orion-plan-20261104/tools/review_viewer.py
python3 -B docs/architecture/orion-plan-20261104/tools/verify_artifacts.py
```

Le navigateur est préparé à 1440×1000 puis 390×844, clair/sombre. `review-viewer.js` charge le modèle local, vérifie son SHA-256 indépendant, chaque colonne/type/nullabilité/description, toutes les contraintes et chacun des 450 liens FK ; les captures sont copiées dans ce dossier. Les attendus de la dernière exécution sont dans le reçu E2E ; la matrice préalable figure dans [REVIEW_PROTOCOL.md](REVIEW_PROTOCOL.md). Aucun test unitaire n’a été ajouté.

## Disponibilité, limites et suite

Le site Vercel reste rétabli sur le build exact `dpl_2YjDXsva7FBr4yDnzRShmZ776MbA`, commit `f65036cdb9…`, via le pont temporaire vers Neon : [production](../../../verification/orion-availability-20261104/vercel-production-readback.json), [12 parcours runtime réels](../../../verification/orion-availability-20261104/vercel-browser-20261104T173656163590Z.json), [deux parcours canoniques](../../../verification/orion-availability-20261104/canonical-browser.json). Le corpus sauvegardé expose six saisons/230 partitions référencées, sans prétendre qu’elles ont toutes été vérifiées. AWS preview reste partiel ; le [correctif de lecture dense AWS](../../../verification/orion-availability-20261104/aws-dense-release-20261104T172730943519Z.json) n’est ni la bascule finale ni l’acceptation du nouveau schéma. L’[ancienne architecture 17:27/API503](architecture-1727-historical.svg) est explicitement historique. Aucun service n’a été modifié pendant ce rafraîchissement.

**Les 25 cas de métriques ne prouvent pas la fidélité générale de xG ou des statistiques communes.** Les CHECK autorisent et contraignent les observations enregistrées ; les projections numériques communes demandent des mappings explicites, une autorité de valeur/état claire et des contrôles de cohérence. Une ligne manquante reste inconnue ; `absent` n’est valide qu’avec champ attendu et couverture acceptée prouvés. Les représentations textuelles/décimales, toutes les familles source et les contributions de plusieurs records restent à inventorier.

La régression 23/23 note elle-même les états source des colonnes communes comme limite. Le core réel 9/9 conserve `fullAcceptance=false` et les champs/unités/profils non vérifiés. Les tests synthétiques, la navigation documentaire et les modèles réservés ne clôturent ni ce travail ni la parité des lecteurs/collecteurs/cache publics. Les preuves SQL bornées sont séparées des statuts de conception du JSON ; aucun `passed` de conception ne remplace leur reçu.

La [couverture](COVERAGE.md) précise destinations et limites. Le pilote complet, les familles réelles, le préflight RDS, WAL/espace libre/charge/performance, l’acceptation conjointe backend+données et les conditions de purge restent ouverts. `source_inventory_complete=false` et `purge_authorized=false` restent explicites. Les sources historiques ne sont pas supprimées avant rapprochement et fin des dépendances du transfert. Aucun gain de stockage/coût/latence n’est attribué à ce lot documentaire.

Commit suggéré : `docs: refresh approved Orion pilot and native metric evidence`.
