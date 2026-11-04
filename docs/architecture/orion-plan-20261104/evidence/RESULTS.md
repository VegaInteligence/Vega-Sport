# Première livraison — plan à valider

4 novembre 2026, Europe/Paris. **Documentation et lectures uniquement. Aucun schéma créé, aucune donnée déplacée/supprimée, aucun workflow relancé, aucune bascule.** Le but final AWS reste ouvert.

## Entrées et attendus

Le [protocole préalable](REVIEW_PROTOCOL.md) décrit les résultats attendus et les échecs à conserver. Le prompt de mission prime sur les recommandations des documents joints. Le JSON fourni est le socle ; les deux documents sont copiés intégralement dans `../inputs/`. Le [reçu des entrées](inputs-and-scope.json) donne tailles, empreintes et comptages, sans prétendre que des empreintes prouvent la complétude des données football.

Le [plan](../PLAN.md), les 25 SVG et le [dictionnaire](../DICTIONNAIRE.md) couvrent les propositions. Le [mapping des familles](COVERAGE.md) distingue destination prévue et reprise non exécutée. Le [CSV](../current-to-target.csv) classe les 224 relations des deux bases inspectées ; il ne prouve pas encore chaque champ de chaque source.

## Résultats observés

| Vérification | Résultat réel | Preuve |
|---|---|---|
| Conservation du socle | 84 tables initiales conservées ; 943 colonnes dans l’original | `inputs-and-scope.json`, `proposal-inspection.json` |
| Catalogue proposé | 161 tables, 1 971 colonnes, 368 FK ; aucune cible/type de FK invalide détectée statiquement | `proposal-inspection.json` |
| Rendu | 22 domaines, 2 architectures, 1 vue métier ; toutes les tables et colonnes retrouvées dans leurs nœuds SVG | `diagram-rendering.json`, `proposal-inspection.json` |
| Dictionnaire / correspondances | 0 définition de secours à revoir ; 224 relations classées ; 0 relation sans destination/disposition | `dictionary-review.json`, `current-to-target.csv` |
| Nouvelles collectes | Flux proposé PitchAPI → mémoire → RDS ; job médias séparé ; aucun lien du job de données vers S3 | `architecture-cible.svg`, `proposal-inspection.json` |
| Lecteur dans Chromium | 201 contrôles réussis : 161 tables/1 971 colonnes, FK, recherche, 23 choix de diagramme, zoom, 73 exceptions JSONB, 224 correspondances, liens profonds, mobile et thème sombre | `viewer-e2e.json`, `viewer-checks.json`, `viewer-e2e.log` |
| Réseau du lecteur | 0 requête vers AWS/Neon/PitchAPI ou autre service, 0 erreur JS et 0 ressource HTTP en échec durant le parcours enregistré | `viewer-checks.json` |
| S3 existant | 307 pages, 306 124 objets, 4 890 689 338 octets ; 37 859 images / 401 928 242 octets | `s3.json`, scan complet 15:51–15:58 Paris |
| PostgreSQL | Deux bases applicatives inspectées en lecture seule, PostgreSQL 18.6 ; une instance RDS existante | `databases.json`, `runtime-current.json` |
| Production | Vercel READY encore sur Neon, API AWS sur `statarena_prod` ; collectes/build toujours désactivés au relevé | `vercel-current.json`, `runtime-current.json` |

Les captures [desktop](architecture-desktop.png), [table de tirs](shots-desktop.png), [vue BDD](database-overview-desktop.png), [mobile](receipt-mobile.png) et [mobile sombre](receipt-mobile-dark.png) sont inspectables. L’écran mobile défile vers le détail ; les tableaux/diagrammes gardent leur défilement local.

## Reproduction de la génération et du parcours

Répertoire de départ : `/Users/lemonnierhugo/Desktop/Coding Project/Football_ranking`. Environnement exécuté : Python 3.14.6, `markdown-it-py` 4.2.0, Node 26.4.0, `@viz-js/viz` 3.31.0 / Graphviz 16.1.0 et Chromium déjà installé. Les dépendances de rendu sont locales et ne deviennent pas des dépendances de l’application. Le CLI Playwright existant est utilisé ; aucun test unitaire n’a été ajouté.

Si le dossier temporaire du moteur de rendu a disparu, le préparer avec `npm install --prefix /tmp/statarena-plan-tools-20261104 --no-save @viz-js/viz@3.31.0`. Installer `markdown-it-py==4.2.0` dans l’environnement Python utilisé si nécessaire. Puis, dans cet ordre :

```bash
python3 docs/architecture/orion-plan-20261104/tools/build_proposal.py
python3 docs/architecture/orion-plan-20261104/tools/render_plan.py
node docs/architecture/orion-plan-20261104/tools/render_diagrams.mjs
python3 docs/architecture/orion-plan-20261104/tools/build_viewer.py
python3 docs/architecture/orion-plan-20261104/tools/inspect_proposal.py
python3 docs/architecture/orion-plan-20261104/tools/verify_artifacts.py
```

Dans un terminal distinct, servir uniquement ce document :

```bash
python3 -m http.server 8794 --bind 127.0.0.1 --directory docs/architecture/orion-plan-20261104
```

La [configuration navigateur](browser-config.json) contient le chemin Chromium de cette machine ; l’adapter si nécessaire. Préparer le dossier et démarrer le navigateur depuis celui-ci, puis lancer le parcours depuis la racine du dépôt :

```bash
mkdir -p output/playwright/orion-plan
cp docs/architecture/orion-plan-20261104/evidence/browser-config.json output/playwright/orion-plan/browser-config.json
cd output/playwright/orion-plan
/Users/lemonnierhugo/.codex/skills/playwright/scripts/playwright_cli.sh -s=orion-plan open http://127.0.0.1:8794 --config browser-config.json
cd ../../..
python3 docs/architecture/orion-plan-20261104/tools/review_viewer.py
```

Le parcours exact se trouve dans `../tools/review-viewer.js` ; le wrapper injecte toutes les colonnes attendues du JSON proposé, puis conserve sortie et résultats. Il ne dispose d’aucune opération de migration ou de déploiement.

## Reproduction des lectures distantes

Ces commandes remplacent les reçus locaux : conserver une copie avant tout nouveau relevé. Elles exigent les accès existants, AWS CLI connecté sur `statarena`, le certificat RDS du dépôt et la configuration libpq locale. Aucun mot de passe n’est copié dans les preuves.

```bash
PYTHONPATH=/tmp/statarena-publication-test-python python3 docs/architecture/orion-plan-20261104/tools/audit_aws.py --pgpass
python3 docs/architecture/orion-plan-20261104/tools/capture_runtime.py
python3 docs/architecture/orion-plan-20261104/tools/capture_vercel.py
python3 docs/architecture/orion-plan-20261104/tools/audit_s3.py
python3 docs/verification/aws-release-20261104/scan_credentials.py
```

`psycopg` est fourni par l’environnement temporaire existant ; s’il manque, le préparer dans un environnement Python séparé. Vercel CLI utilisé : 65.11.0. La requête Neon est conservée exactement dans `neon-current.json.sql` : outil connecté `neon_run_sql`, projet `sweet-queen-11955006`, branche `br-mute-bonus-be23014e`, base `neondb`. L’API n’est pas appelée par la génération locale du plan. Les métadonnées de réseau publiées masquent les IP administratives personnelles `/32`.

## Échecs et limites conservés

- L’inspection statique initiale utilisait `Counter(dict)` au lieu des clés ; le faux échec de couverture est conservé dans `proposal-inspection-initial.json`. Le contrôle corrigé inspecte chaque nœud SVG et toutes ses colonnes.
- Le navigateur par défaut Chrome n’était pas installé ; le parcours utilise le Chromium local indiqué dans `browser-config.json`. Le premier favicon a répondu 404 ; l’icône est désormais embarquée.
- Le premier parcours complet a trouvé un débordement mobile réel de 18 px. Après correction de la grille, un libellé technique non sécable restait en dépassement. Les deux échecs sont conservés dans `viewer-e2e-initial.*`, `viewer-e2e-after-grid-fix.*` et `mobile-overflow-initial.png`. La grille et le retour à la ligne ont ensuite été corrigés.
- La revue visuelle a repéré une substitution de labels inopérante dans le diagramme « actuel ». Il est maintenant construit séparément du diagramme cible et montre les sources structurées existantes, les collectes désactivées et la production encore sur Neon. Le contrôle statique vérifie aussi cette distinction.
- AWS CLI avait expiré pendant l’inventaire : la requête de configuration a échoué, tandis que les lectures SQL sont restées disponibles. La reconnexion explicitement autorisée a permis `runtime-current.json`. Aucun échec n’est présenté comme un défaut de RDS.
- La première requête Neon utilisait `projections.kind` au lieu de `name`. Le relevé corrigé et le catalogue réel sont conservés. Le regroupement des URLs omettait ensuite les identifiants de tirs `s_` ; le résultat initial compressé est conservé et regroupé hors ligne en 24 familles, sans nouvelle lecture de données.
- Les totaux Neon/AWS diffèrent, mais leurs différences nettes ne donnent pas encore la liste exacte des données manquantes. Les relevés ne constituent pas un instantané distribué figé.
- Aucune contrainte n’a été exécutée dans PostgreSQL pour ce nouveau modèle ; aucun parseur de migration ni E2E applicatif n’a été lancé. L’historique SQL ajoute du stockage et doit être mesuré au pilote. L’absence de réponses brutes futures implique l’impossibilité de rejouer leurs octets ou de reparcourir des champs non conservés.

**Avant/après de ce lot documentaire : 0 modification de service, 0 octet supprimé et aucun gain de latence/coût revendiqué.** Les allocations et inventaires sont des baselines, pas des économies obtenues. Les métriques d’exploitation seront comparées sur le même corpus après implémentation approuvée.

`artifact-validation.json` contrôle la syntaxe et les liens locaux. `credential-scan.json` conserve le dernier contrôle exact des identifiants connus : 2 904 fichiers et 63 contenus gzip inspectés, aucune correspondance ; il ne couvre pas tous les secrets possibles ni l’historique Git.

La prochaine étape est la validation explicite du plan par l’utilisateur, demandée dans le prompt de mission. Les schémas, normalisations, collectes, suppression et production restent inchangés dans l’attente.

Commit suggéré : `docs: propose the Orion relational schema and AWS migration plan`.
