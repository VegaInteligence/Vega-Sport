# Rejeu des témoins des deux avis sur 34ca, contre le code livré `2088d36e60`

Les avis Fable 5.2 xhigh et Astra 6.2 xhigh rendus sur `34ca3b5b38` demandaient des corrections et fournissaient des harnais (`dossier-audit/collegue/temoins/` du ZIP de passation). Trois de ces harnais sont rejoués ici, par le coordinateur de la reprise, contre `main` = `2088d36e607d26e756ce71e523556b4f1e40407a` (déployé le 19 nov. 2026 à 10 h 05 UTC).

## Préparation

- PostgreSQL 18.6 local privé, `127.0.0.1:55533` ; Python 3.12.3 (venv du dossier de reprise, `psycopg` 3.3.9) ; Node 24.18.0 ; `backend/api/node_modules` installé par `npm ci`.
- Répertoire courant : le worktree `~/Agents/worktrees/vega-audit-reprise-20261119` sur `2088d36e60`, arbre propre côté code (seul `WORKLOG.md` modifié).
- Scripts : copies adaptées dans `~/Agents/scratch/passation-audit-20261119/work/temoins-rejeu/`. Adaptations : port 55439 → 55533 ; la révision testée est le checkout courant et non l’extraction Git de `34ca` ; les `assert` qui vérifiaient la présence du défaut sont remplacés par l’enregistrement des valeurs observées (`checks`) ; dans `compare-cup.py`, le second writer reçoit `lock_timeout = 5s` pour ne pas rester bloqué derrière le verrou d’édition ; dans `reconcile-probes.py`, lecture ajoutée des identifiants, de la prévision et des clés fournisseur avant et après le report. Chaque rejeu crée puis supprime sa propre base (`vega_v2_astra_*`).

## Commandes

```sh
S=~/Agents/scratch/passation-audit-20261119
export PATH=$S/venv/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH
cd ~/Agents/worktrees/vega-audit-reprise-20261119
python -B $S/work/temoins-rejeu/compare-cup.py "$PWD" 2088d36e60 > compare-cup.json
python -B $S/work/temoins-rejeu/real-euro.py > real-euro.json
python -B $S/work/temoins-rejeu/reconcile-probes.py "$PWD" > reconcile-probes.json
```

## Résultats (19 nov. 2026, vers 13 h 30 UTC)

| Témoin | Défaut sur `34ca` | Attendu après correction | Observé sur `2088d36e60` | Fichier |
| --- | --- | --- | --- | --- |
| Deux publications concurrentes de l’Euro 2024 (VI-27) | l’empreinte du dernier fichier est publiée mais la base garde 3–1 / 1–1, un état mixte | les deux scores du dernier fichier certifié, stables à la répétition | schéma 153 ; pendant la transaction du premier writer, le second attend le verrou d’édition (ici `DATABASE_ERROR` sur le délai de 5 s ajouté au harnais) ; état final 2–1 / 1–1, identique après répétition | `compare-cup.json` |
| Fichier Euro 2024 complet où seule la mi-temps d’Allemagne–Écosse manque (VI-27) | la mi-temps 3–0 disparaît de la route publique | 3–0 conservé, 51 matchs | `ht` [3, 0] et `ft` [5, 1] servis avant, après et à la répétition ; 51 matchs ; l’ancien ETag répond 304 | `real-euro.json` |
| Report d’une fixture du 29 au 30 nov. portant une prévision, et correction d’un autre score dans le même fichier (VI-27) | `MATCH_HAS_DEPENDENTS`, zéro écrit, l’ancien ETag répond 304 | le report et la correction appliqués, identité et prévision conservées | `['ok', 2, 0]` ; le match garde l’identifiant 2 et passe au 30 nov. ; la prévision (match 2, modèle 1) est conservée ; l’autre résultat passe à 3–1 ; l’ancien ETag répond 200 avec un nouvel ETag ; aucune ligne `ops.parse_failures` | `reconcile-probes.json` |
| Historique de transferts après un refus `HISTORY_MISSING` (VI-31) | la route publique passe de 200 à 404 alors que les trois mouvements restent stockés | la dernière lecture acceptée reste servie | 200 avant ; après le refus : 200, 304 sur l’ancien ETag, mêmes quatre lignes ; file : `HISTORY_MISSING`, 3 lignes, `read_at` conservé | `reconcile-probes.json` |
| Réponse partielle acceptée ensuite (VI-31) | le mouvement omis reste présenté comme réalisé, 304 | l’état du mouvement absent est exprimé sans effacer l’historique | 200 avec nouvel ETag ; le mouvement 83 est servi avec `"absentSince": "2026-11-19"` ; en base, `absent_since` daté sur 83 seulement | `reconcile-probes.json` |

## Limites

- Après le report, la seule clé fournisseur du match est la nouvelle clé datée du 30 nov. ; l’ancienne clé datée du 29 n’est pas gardée comme alias. La réconciliation des avis le recommandait « de préférence » ; le lot a retenu « report univoque sur le même match » (FAILURE_MODES §35). Observé, non modifié.
- `probes.py` (enrichissement du parent, référence tardive `ops.resource_versions`, quatrième club SportScore) n’a pas été rejoué : il greffe des fonctions internes (`snapshot._guard_dependents`, `snapshot.stored`) qui ont changé. Les tests du dépôt 35m–35v couvrent ces cas ; ils passent dans la suite complète (635 tests, `evidence/baseline-2088d36e60/python.txt`).
- Dans `compare-cup.py`, le second writer n’est pas relancé après la validation du premier : le harnais d’origine l’appelle de façon synchrone. Ce rejeu montre l’absence d’état mixte, pas l’ordre final de deux publications successives.
- Ce sont des rejeux locaux sur PostgreSQL 18.6, pas des mesures de production.
