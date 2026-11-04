# Proposition Pro — résultats documentaires courants

4 novembre 2026, Europe/Paris. **Le plan, le JSON, le lecteur, le dictionnaire, les diagrammes et les correspondances décrivent le même modèle de 103 tables.** Ce lot reste documentaire : aucun SQL du nouveau modèle créé/appliqué, aucune migration ou purge distante, aucun pilote typé local accepté.

La revue Pro est prioritaire. Les anciennes valeurs nécessaires et leurs dépendances sont conservées sélectivement dans les tables métier ; les tables sœurs d’historique et les quatre registres universels restent retirés. Les 84 tables initiales sont une référence de responsabilités, sans quota de nombre ou de découpage.

## Preuves courantes

SHA-256 du modèle : `028c221d4cd45ad809a2340e62f34ab9df191c593b23c0c45d5f44587eb35a8c`. Les reçus de cohérence, inspection et navigateur portent cette même empreinte. Les fichiers initiaux sont inchangés ; `inputs-and-scope.json` et `pro-review-receipt.json` conservent leurs tailles et empreintes.

| Vérification | Résultat observé | Preuve |
|---|---|---|
| Modèle rendu | 103 tables, 1 791 colonnes, 450 FK ; 94 tables actives et 9 réserves de modèles | [proposal-inspection.json](proposal-inspection.json), [plan-coherence.json](plan-coherence.json) |
| Classes | 46 sélectives, 6 enfants atomiques, 9 append-only, 3 identités stables, 39 autres opérations/métadonnées/résultats ; 0 table sœur d’historique | JSON et inspection |
| Clés et contraintes déclarées | PK non nulles, cibles FK réelles non partielles et non différables ; 109 UQ, 154 index dont 119 uniques partiels, 889 CHECK ; 0 violation statique | Inspection indépendante, sans exécution SQL |
| Responsabilités et bootstrap | 84 dispositions motivées ; 10 graines périodes/positions avec contrat, définition et bindings explicites de génération/hash | Inspection ; bindings réels encore à fournir à l’exécution |
| Rendu complet | 13 domaines + 2 architectures + 1 vue métier = 16 SVG ; chaque table/colonne et chaque FK sortante retrouvée dans son domaine | [diagram-rendering.json](diagram-rendering.json), inspection |
| Dictionnaire et correspondances | Grains physiques/logiques, classes, clés de version, sélecteurs historiques, ancres parentes, UNIQUE, NULLS NOT DISTINCT et WHERE visibles ; 224 structures classées ; 0 définition de secours et 0 relation sans disposition | [dictionary-review.json](dictionary-review.json), [CSV](../current-to-target.csv) |
| JSONB | 51 exceptions listées, bornées à 16 Kio, pour configuration/qualité/diagnostics ou réserves de modèles ; aucun nouveau corps source | Dictionnaire et lecteur |
| Transformations en mémoire | Protocoles de première application, seconde application/roundtrip idempotents, noms futurs et rejet atomique de FK invalide réussis | [pro-transform-protocols.json](pro-transform-protocols.json) |
| Chromium, dernière exécution | 1208 contrôles réussis ; 103 tables, 1 791 colonnes et 450 liens FK parcourus, 14 choix de diagramme chargés ; recherche, contraintes, zoom, exceptions/dispositions, mobile et thème sombre | [viewer-e2e.json](viewer-e2e.json), [détails](viewer-checks.json), [log](viewer-e2e.log) |
| Réseau du lecteur | 0 requête extérieure, 0 erreur JavaScript, 0 ressource HTTP en échec | Dernier parcours navigateur |

Dernier reçu du parcours complet du modèle, antérieur au rafraîchissement du texte de disponibilité : `2026-11-04T17:41:53.861077+00:00`. Captures : [architecture desktop](architecture-desktop.png), [tirs](shots-desktop.png), [vue BDD](database-overview-desktop.png), [mobile](receipt-mobile.png), [architecture mobile](architecture-mobile.png), [mobile sombre](receipt-mobile-dark.png).

Les 201 contrôles de l’ancienne livraison de 161 tables/1 971 colonnes/368 FK, 22 domaines et 73 exceptions sont conservés dans [historical-first-delivery](historical-first-delivery/README.md). Ils ne prouvent rien sur les 103 tables actuelles. Le premier parcours Pro, avant ajout du reçu de disponibilité au plan, reste dans [pro-before-availability-refresh](pro-before-availability-refresh/README.md). Les protocoles originaux restent dans [historical-pre-pro-protocols](historical-pre-pro-protocols/README.md). Le modèle et les 1 208 contrôles précédant la revue des clés sont conservés dans [pro-before-append-only-review](pro-before-append-only-review/README.md) ; la navigation réussie n’avait pas prouvé ces garanties métier.

La revue indépendante a relevé trois corrections bornées : UQ de standing incluant la révision de normalisation, PK des détails de match incluant la génération, et FK source/record des H2H appartenant au même fournisseur que le parent. Les modes d’échec et assertions ont précédé le changement du helper ; les échecs attendus sont dans [append-only-key-protocol-before-fix.json](append-only-key-protocol-before-fix.json) et [h2h-provider-protocol-before-fix.json](h2h-provider-protocol-before-fix.json). Le [diff exact du helper](revision-key-helper.diff) porte ces corrections et leurs sélecteurs/garde de scellement, sans colonne ou table nouvelle. SHA du helper corrigé : `6470475eeec92d17fdd2bfb6b8bd3e4ef4a87e6260148bccabe19f9f32e500b3`. Les protocoles courants passent ensuite avec 1 280 changements de première application et zéro à la seconde pour les versions ; 22 puis zéro pour les contraintes. Cela ne démontre pas encore leur enforcement SQL.

Le premier validateur de liens traitait à tort `tools/PLAN.template.md` comme un document publié dans `tools/` ; son faux échec est conservé dans [artifact-validation-template-link-failure.json](artifact-validation-template-link-failure.json). Il résout maintenant les liens du template à l’emplacement réel de `PLAN.md` et vérifie aussi le plan et les données embarqués dans le HTML.

## Reproduction locale

Racine : `/Users/lemonnierhugo/Desktop/Coding Project/Football_ranking`. Environnement existant : Python 3.14.6, `markdown-it-py` 4.2.0, Node 26.4.0, `@viz-js/viz` 3.31.0 / Graphviz 16.1.0 et Chromium local. Les dépendances ne deviennent pas celles de l’application.

Si nécessaire, préparer le moteur avec `npm install --prefix /tmp/statarena-plan-tools-20261104 --no-save @viz-js/viz@3.31.0` et installer `markdown-it-py==4.2.0` dans l’environnement Python utilisé. Générer et promouvoir le dossier entier seulement après les contrôles statiques :

```bash
python3 -B docs/architecture/orion-plan-20261104/tools/rebuild_plan.py
```

[rebuild.json](rebuild.json) conserve sources SHA-256, commandes, sorties et codes retour des six étapes. Le staging laisse la livraison précédente en place en cas d’échec ; un reçu d’échec est sauvegardé avant suppression du dossier temporaire. Aucune opération SQL ou distante n’existe dans cette commande.

Les deux scripts de protocole reconstruisent une fixture temporaire au bon stade du générateur, puis gardent leurs assertions de première application. L’entrée de contraintes comporte 107 tables avant retrait des registres ; celle des versions aboutit aux 103 tables. Le SHA de fixture est distinct du modèle final. Rerun exact des deux protocoles :

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

## Observations distantes et disponibilité

Les inventaires `databases.json`, `s3.json`, `neon-current.json`, `runtime-current.json` et `vercel-current.json` restent des observations datées de la première livraison. Aucun nouveau relevé distant n’a été lancé par ce lot. Le scan S3 de 15:51–15:58 Paris comptait 306 124 objets / 4 890 689 338 octets, dont 37 859 images / 401 928 242 octets ; il ne mesure pas l’espace récupéré.

Le relevé de 17:27 Paris montrait Vercel API 503 et AWS partiel. Un lot disponibilité séparé a ensuite déployé le correctif AWS et enregistré [le reçu à 18:27 Paris](../../../verification/orion-availability-20261104/aws-dense-release-20261104T172730943519Z.json) : ZIP exact, stack UPDATE_COMPLETE, trois GET de 100 matchs en 200 avec même génération/contenu, HEAD 200 et conditionnel 304. Le plan rapporte les échantillons 4 008,62 / 3 575,56 / 3 034,98 ms sans p95 ni suppression générale des timeouts. Les réponses `no-store` sont des MISS attendus. Le lot disponibilité a ensuite rétabli la production Vercel : le [reçu de 18:38 Paris](../../../verification/orion-availability-20261104/vercel-production-readback.json) confirme le build exact `dpl_2YjDXsva7FBr4yDnzRShmZ776MbA`, commit `f65036cdb9273654614354cc083039d2a200a491`, promu sans reconstruction après [12 parcours réussis sur le runtime Vercel réel](../../../verification/orion-availability-20261104/vercel-browser-20261104T173656163590Z.json). Health/manifeste/archive canoniques répondent 200, avec six saisons et 230 partitions référencées dans le corpus existant. Le [contrôle canonique de 18:41 Paris](../../../verification/orion-availability-20261104/canonical-browser.json) réussit ses deux parcours desktop et historique mobile. Ce pont legacy temporaire Vercel → Neon restaure le site ; l’AWS preview reste partiel et la bascule finale vers AWS demeure ouverte. Ces parcours représentatifs ne vérifient pas chaque ligne, média ou partition et n’acceptent ni le nouveau schéma ni le pilote. L’ancien diagramme de 17:27/API 503 est [conservé comme historique](architecture-1727-historical.svg).

Le rafraîchissement de statut conserve exactement le modèle et les helpers. Les 1 208 contrôles de tables/colonnes/FK ci-dessus n’ont pas été relancés pour ce seul changement de récit et d’architecture ; seuls la génération statique, les liens/empreintes et l’image d’architecture modifiée sont revérifiés. Le [reçu du rafraîchissement](status-refresh.json) précise l’heure, la commande exacte, les sources de statut et cette limite ; les nouvelles captures [desktop](architecture-status-desktop.png) et [mobile](architecture-status-mobile.png) montrent l’architecture rétablie, distincte des captures du parcours complet antérieur.

## Limites et prochaine action

La couverture [COVERAGE.md](COVERAGE.md) distingue destination proposée et source réellement rapprochée. Les champs/variantes, types natifs, ordre et contributions de plusieurs records restent à inventorier exhaustivement ; quatre champs ciblés et un exemple xG ne prouvent pas l’ensemble. Le JSON conserve `source_inventory_complete=false`, `purge_authorized=false` et `sql_execution=not_performed`.

Aucune PK/FK/CHECK, règle intertable ou contrainte de génération de ce modèle n’a été exécutée dans PostgreSQL. Restent à vérifier sur le pilote typé local : correction 0,82 → 0,67 et recalcul de l’ancien snapshot avec cohorte/dépendances, concurrence, intervalles, fermeture unique, bootstrap réel/reprise, collections vides/partielles, sélection commune, droits immuables, cache/publication, fidélité numérique, puis WAL/espace libre/latences sur volumes comparables. Les promesses d’URL immuable et de recalcul exact restent conditionnées à ces preuves.

La revue du modèle révisé précède toute réorganisation distante. Le pilote et la réconciliation précèdent migration complète et purge. Les hashes ne rétablissent pas les octets supprimés. Aucun gain de stockage/coût/latence n’est attribué à ce lot documentaire.

Commit suggéré : `docs: synchronize the Orion Pro schema and review evidence`.
