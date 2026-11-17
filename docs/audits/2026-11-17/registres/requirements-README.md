# Registres de couverture et de calculs

`requirements.csv` contient 91 entrées. Les 38 identifiants A couvrent les 18 sections du document du 16 novembre, notamment les vérifications mathématiques déjà satisfaites (§17) et les quatre demandes de validation (§18). Les 36 identifiants E couvrent les demandes du 17 novembre, les huit identifiants L les tickets clos et les neuf identifiants N les constats supplémentaires N1–N9 de la traçabilité. Les sous-points parfois liés sont distincts par portée. Additionner les statuts ne donnerait donc pas un taux d’achèvement du projet.

`new-calculations.csv` décrit 26 modifications de méthodes, de populations calculées, d’agrégats ou de lecteurs sportifs depuis le code de référence du document initial. Il distingue les nouvelles simulations, les corrections de calcul, les extensions de périmètre et les simples projections d’une sortie existante. L’ordonnancement des cohortes est explicitement opérationnel. Sont exclus les seuls changements de version, documentation, maquette et dimensionnement visuel. Les migrations 119–133 et les changements de code sans migration ont servi au recensement.

## Versions et statuts

- Le document initial cite le code `36049afb498b177cc6d92ebd1b7b2346a81b7639`. L’ancienne branche de l’audit se termine à `7239f67f9c`. Elle diverge de la production à partir de `a912ed319e` (5 commits propres contre 45).
- R est la production vérifiée `8018e0836ca0f32e8b2eb51fc2847154abff7f13`. Les dates UTC restent celles de chaque preuve. W est le dernier commit d’intégration examiné pour ce registre, `0bb67f5bc5ba0b9ed90afc6dfa0e4e0866b15527`. Une version privée, des fichiers non commis ou un modèle de sensibilité hors ligne ne constituent pas une livraison sur W.
- `implemented_production` vaut pour le périmètre nommé et les chemins mesurés. Dans la colonne branche, le même statut désigne le comportement hérité de R. `implemented_branch` signifie qu’un correctif ou un livrable borné est présent sur W avec sa preuve. `incomplete` inclut les écarts reproduits, validations insuffisantes et décisions de méthode en attente. `missing` désigne l’absence établie du mécanisme demandé, distincte d’une donnée inconnue. `not_applicable` désigne une action d’audit ou de coordination, hors contrat d’exécution du produit; l’observation correspondante indique son état.
- `source_paths` et `callsite_path` sont relatifs au dépôt Git de Vega-Sport. `evidence_paths` est relatif à la racine de l’archive de preuves. Le point-virgule sépare les chemins et les commits, sans chemin absolu ni authentification nécessaire pour la lecture hors ligne. Les lignes procédurales renvoient aussi aux instructions du dépôt.
- Dans le registre des calculs, les deux colonnes `marker_at_*` indiquent seulement la présence d’un repère textuel dans le fichier nommé à la révision indiquée. Un même nom de fonction peut changer de sens entre révisions. Pour C18–C21, `historic_migration_equivalent` indique les migrations 124–127 de l’ancienne branche, renumérotées 128–131 en production; égalité d’intention ne signifie pas égalité d’octets.
- Pour mettre à jour le registre à l’intégration, traiter la ligne A15c avec VI-28, E02c avec VI-29, E03g avec VI-31, E06c/d avec VI-30 et les lignes de calendrier/archives avec VI-27. E05b et E06b attendent les revues et le reçu final. Mettre à jour la colonne production seulement après vérification du déploiement et des sorties publiques ou de la base. Les méthodes VI-19/21 restent à leurs propriétaires.

## Vérification reproductible

Depuis le dossier contenant les deux CSV, désigner le dépôt et l’archive de preuves dans les deux variables d’environnement. Les fichiers cités ont été contrôlés au moment de la remise sur disque et dans l’archive. Un repaquetage est nécessaire si le rapport évolue. Les deux CSV contiennent 71 chemins de preuve distincts. Ce contrôle relit les artefacts; il ne relance aucun modèle ni aucune collecte.

```sh
export VEGA_REVIEW_REPO='/chemin/vers/Vega-Sport'
export VEGA_REVIEW_ZIP='/chemin/vers/audit-evidence.zip'
python3 - <<'PY'
import csv, os, pathlib, re, subprocess, zipfile
repo = os.environ['VEGA_REVIEW_REPO']
release, old = '8018e0836c', '7239f67f9c'
def git(*args):
    return subprocess.run(['git', '-C', repo, *args], capture_output=True)
def records(name):
    with pathlib.Path(name).open(encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))
requirements = records('requirements.csv')
calculations = records('new-calculations.csv')
assert len(requirements) == len({r['id'] for r in requirements}) == 91
assert len(calculations) == len({r['id'] for r in calculations}) == 26
assert {int(re.match(r'A(\d+)', r['id'])[1]) for r in requirements if r['id'].startswith('A')} == set(range(1,19))
states = {'implemented_production','implemented_branch','incomplete','missing','not_applicable'}
assert all(r[k] in states for r in requirements for k in ('production_state','branch_state'))
files = {p for r in requirements for p in r['source_paths'].split(';')}
assert all(git('cat-file','-e',release+':'+p).returncode == 0 for p in files)
for r in calculations:
    assert all(git('merge-base','--is-ancestor',s,release).returncode == 0 for s in r['release_commits'].split(';'))
    for rev,key in [(old,'marker_at_historic_checkpoint'),(release,'marker_at_production')]:
        f = git('show',rev+':'+r['callsite_path'])
        actual = 'file_absent' if f.returncode else ('present' if r['code_marker'].encode() in f.stdout else 'marker_absent')
        assert actual == r[key], r['id']
    assert r['marker_at_production'] == 'present'
    if r['historic_migration_equivalent']:
        assert git('cat-file','-e',old+':'+r['historic_migration_equivalent']).returncode == 0
refs = {p for r in requirements + calculations for p in r['evidence_paths'].split(';')}
with zipfile.ZipFile(os.environ['VEGA_REVIEW_ZIP']) as z:
    assert not refs.difference(z.namelist())
print(f'{len(requirements)} exigences et contrôles; {len(calculations)} changements; {len(refs)} chemins de preuve distincts.')
PY
```

Pour examiner la sélection des changements, comparer les fichiers applicatifs depuis la version citée dans le document, puis depuis l’ancienne branche.

```sh
git -C "$VEGA_REVIEW_REPO" diff --name-status 36049afb498b..8018e0836c -- backend/sql backend/vega backend/api/src dashboard/frontend/src/services
git -C "$VEGA_REVIEW_REPO" diff --find-renames --name-status 7239f67f9c..8018e0836c -- backend/sql backend/vega backend/api/src
```
