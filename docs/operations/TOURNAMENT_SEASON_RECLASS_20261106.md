# Reclassification des saisons — 6 novembre 2026

Maintenance terminée sur AWS RDS `statarena_prod` ; snapshot chiffré `statarena-before-season-reclass-20261106` disponible.

- Coupe du monde 2026 : **104 matchs**, d'abord sous `2026/2027`, désormais sous `2025/2026`.
- Coupe du monde 2022 : **64 matchs** de collecte, désormais sous `2022/2023`. Cette édition n'était pas encore publiée.
- Données conservées : **5 323** performances joueurs, **2 505** tirs, **3 847** statistiques d'équipes sur le Mondial 2026.
- Alias vide `2026` de cette compétition supprimé après comparaison des **17 définitions de métriques identiques**.
- Année d'édition officielle conservée dans `statarena.fixtures.body.season`.
- Nouvelle génération de publication **198**. La route AWS `/api/seasons/partition?league=l_1XLtP0&season=2025%2F2026` renvoie 200 ; l'ancienne édition `2026%2F2027` renvoie 404.
- Aucun transfert Neon, aucun changement de classe RDS, aucune suppression de données fournisseur.

Audit et application : [GitHub Actions #42290472400](https://github.com/VegaInteligence/Vega/actions/runs/42290472400). Empreinte : `259bed9298ef5aec97cc46d59308eff2beafd7058427f2529bfc6262bd9e981e`.

Le workflow SQL ponctuel a été retiré après réussite, sans désactiver les collectes quotidiennes. La correction permanente reste dans `dashboard/scripts/football_seasons.py` et dans le publisher relationnel.
