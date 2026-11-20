# Lot « historique » — fenêtre glissante Open Matchday (E04a, E04b tours qualificatifs, E04g)

- Worktree : `/home/romai/Agents/worktrees/vega-audit-historique-20261119`, branche `claude/audit-historique`, départ `d3e96a097b` (= `main` `2088d36e60` + lot « collecte »).
- Commits : `c636ff8774` (§41 + tests rouges + données attestées), `c45a903f09` (correctif), `70168967ac` (tests anciens bornés au registre des 35, attente 41n).
- PostgreSQL 18.6 privé `127.0.0.1:55538`. Aucune migration ajoutée (157 non utilisé).
- Entrées : historique Git d'Open Matchday téléchargé par le lot « calendriers » (`../calendriers/telechargements/om/hist/`, 125 versions de 8 dossiers, `*-commits.json` de l'API GitHub) ; capsule organisateurs `angleterre-575.zip` (extraite dans `entrees/ang575/`) ; captures relues des 35 (`35-matchs-identites-et-elo.zip`, `rds/avant.zlib` SHA-256 `ed7496ec…`, `rds/apres.zlib` `e850dd9e…`). Aucun nouveau téléchargement GitHub. Production : 7 GET anonymes `/api/cup-table` (`api/`, `api/MANIFEST.txt`).
- Tous les fichiers téléchargés sont lus comme données (`python -I`), jamais exécutés.

## Rejeu

```bash
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:$PATH
E=/home/romai/Agents/scratch/passation-audit-20261119/evidence/historique
W=/home/romai/Agents/worktrees/vega-audit-historique-20261119
H=$E/../calendriers/telechargements/om/hist
python -I $E/scripts/fenetres.py $H $E/fenetres.json                    # sorties de fenêtre, version par version
# 1. Le gel (sur d3e96a097b : git -C $W checkout d3e96a097b ; sur la branche : accepté)
python -I $E/scripts/repro_gel.py $W $H 55538 POL_2_division-1 06b3cf482d 772fb543b5
python -I $E/scripts/repro_gel.py $W $H 55538 WAL_1_cymru-premier fd27c060ea 772fb543b5
python -I $E/scripts/repro_gel.py $W $H 55538 ENG_CUP_fa-cup 55a7b8e0f4 772fb543b5
python -I $E/scripts/repro_gel.py $W $H 55538 POL_3_division-2 77e35fdbd5 3a3ac5075a
# 2. Le fichier attesté (doit redonner l'octet près backend/vega/sources/data/open_matchday_published.json, SHA-256 7c9639c1…)
python -I $E/scripts/attestations.py $W $H $E/entrees/ang575 /tmp/published.json /tmp/decompte.json
# Tests du lot
psql -h 127.0.0.1 -p 55538 -U postgres -c 'CREATE DATABASE vega_v2_window_test'
cd $W && VEGA_V2_WINDOW_TEST_DSN=postgresql://postgres@127.0.0.1:55538/vega_v2_window_test PYTHONPATH=backend CI=true \
  python -m unittest backend/tests/test_open_matchday_window.py -v
# Mesure finale (base vega_v2_history_mesure)
python -I $E/scripts/mesure.py $W $H $E/entrees/ang575 55538 $E/mesure-finale.json
# Suites complètes
PGPORT_LOCAL=55538 /home/romai/Agents/scratch/passation-audit-20261119/work/run-suites.sh $W $E/suites all
```

## 1. Gel d'une édition non attestée — reproduit, corrigé

Sur `d3e96a097b`, writer réel `sources.run_due` sous `vega_collect`, deux versions Git consécutives réelles (`rouge/gel-*.json`) :

| Dossier | Versions | Sorties par le bord gauche | Résultat (avant) |
|---|---|---:|---|
| Pologne I Liga | 06b3cf48 → 772fb543 | 9 | `SNAPSHOT_DROPS_RESULT` à chaque lecture, 106 gardés, les 9 nouveaux jamais écrits |
| Cymru Premier | fd27c060 → 772fb543 | 14 | idem, 111 gardés |
| FA Cup | 55a7b8e0 → 772fb543 | 78 | idem, 180 gardés |
| Pologne II Liga | 77e35fdb → 3a3ac507 | 8 | idem, 107 gardés |

`fenetres.json` : sur 125 versions de 8 dossiers, toutes les sorties se font par le bord gauche sauf 6 (résultats déplacés ou remplacés par la source, Ashton–Rylands, Weston–Billericay, Kharkiv–Karpaty). La production sert aujourd'hui exactement le dernier fichier de chaque dossier (`api-avant-deploiement.json`) : la garde y est arrivée après leur dernier glissement ; le prochain les gèle.

Après correctif : 41a–41b verts (115 / 119 / 219 / 111, les sortants gardés à l'identique, aucune ligne d'échec, relecture sans écriture) ; 41c–41f (retrait intérieur, trou du premier jour, version disjointe, résultat déplacé) restent refusés.

## 2. Résultats publiés puis sortis — fichier attesté et création

`scripts/attestations.py` → `open_matchday_published.json` (360 résultats, SHA-256 `7c9639c1204504e2e27cc59313384e600546dc912b90504fce058f26555a3d3c`), décompte `decompte-attestations.json` :

| Dossier | Publiés puis sortis | Attestés | Exclus |
|---|---:|---:|---|
| National League North | 71 | 59 (organisateur) | 12 = les 35 (outil de restauration) |
| National League South | 77 | 64 (organisateur) | 12 des 35 ; Weston–Billericay 24/10 (absent des résultats officiels) |
| Northern Premier League | 90 | 78 (organisateur, dont Ashton–Rylands 31/10) + la finale 0–1 de 8625 | 11 des 35 ; Emley–Bamber Bridge 06/10 (remplacé par la source le 03/11) |
| Pologne I Liga | 20 | 20 (source, commit) | — |
| Pologne II Liga | 37 | 36 (source, commit) | Kleczew–Podhale 31/07 (date corrigée au 01/08 par la source ; le 01/08 est attesté) |
| Cymru Premier | 22 | 22 (source, commit) | — |
| FA Cup (tours qualificatifs 18–20 sept.) | 80 | 80 (source, commit) | — |
| Ukraine (contrôle, hors liste) | 2 | 0 | 1 déplacé, 1 sorti de l'intérieur |

Anglais : 201 + 35 = 236 = les absences de la capsule ; les 201 de `VI21-prior-201.csv` sont tous retrouvés dans l'historique au score officiel.

## 3. Les 35

41m : jamais créés tant qu'absents ; une version qui les contient alors que l'édition existe reste refusée (`ATTESTED_HISTORY_RESTORE_REQUIRED`). 41n et `mesure-finale.json` : après le passage ordinaire (540), l'outil `open_matchday_restore` (captures réelles) annonce 35, restaure 35 avec leurs identifiants d'origine, 70 Elo conservés ; le passage suivant les garde (575, aucun nouveau match, aucune révision), le suivant ne change aucune version de ligne ; une seconde restauration écrit 0.

## 4. Score 8625

Avant : avec l'attestation 0–1, `ATTESTED_HISTORY_CONFLICT`, toute la version NPL refusée (41p rouge). Après : 8625 passe à 0–1 (même id, `revision + 1`), le reste écrit, une seule ligne `ATTESTED_FINAL_KEPT` ; relecture sans écriture ni nouvelle ligne.

## Mesure finale (`mesure-finale.json`)

Base locale avec les parents de production des 35 (captures), fichiers du jour des 7 dossiers, un passage :

| Dossier | Ligne vivantes | Stockés après le passage |
|---|---:|---:|
| North | 116 | 175 |
| South | 112 | 176 |
| NPL | 111 | 189 |
| Pologne I | 106 | 126 |
| Pologne II | 105 | 141 |
| Cymru Premier | 105 | 127 |
| FA Cup | 142 | 222 |

Anglais contre les 575 officiels : 540 exacts, 0 score divergent, 35 absents = exactement les 35 ; après restauration : 575 exacts, 0 absent, 0 en trop.

## Journaux

- Rouge : `rouge/base-sha.txt`, `rouge/gel-*.json`, `rouge/tests-rouges.txt` (15 échecs sur 16 sur `d3e96a097b` + données ; 41c/41d-f/41m/41q verts car inchangés), `rouge/tests-rouges-41p.txt`.
- Vert : `vert/tests-1.txt` (15/16 ; 41n attendait `unmatched` 0 au lieu de 1, erreur du test corrigée dans `70168967ac`), `vert/existants-1.txt` (4 échecs des anciens tests nommant des dossiers réels, bornés ensuite au registre), `vert/existants-2.txt` (77 OK).
- Suites complètes : `suites/` (voir rapport).

## Suites complètes (`suites/`, SHA `70168967ac`, propre)

Python 656 OK (1 sauté : pgvector absent, comme la référence 635+1), API 222/222, site 788/788. Référence `2088d36e60` : 635 Python, 222 API.
