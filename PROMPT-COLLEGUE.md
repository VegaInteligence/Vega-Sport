# Reprendre les corrections de l’audit Vega-Sport

Reconstitue le ZIP avec `python3 reconstituer.py`, puis ouvre `LIRE-D-ABORD.md` et `collegue/GUIDE-COLLEGUE.md`. Importe le bundle dans un worktree séparé. Vérifie que le point de départ est `c3a16fa179`. Le code de référence `4c413029c1` passait 598 tests Python, 219 API et 780 site.

Commence par comparer le commit de passation avec `main` et la production actuelle. Le déploiement `0f368fd389` avait déjà introduit des corrections à rapprocher. Vérifie la dernière activité Linear avant de reprendre chaque lot.

- VI-27 : publications concurrentes des coupes, conservation des scores de période et reports Open Matchday sur des matchs ayant une prévision.
- VI-29 : vérifier l’admissibilité des tableaux SportScore jusqu’à la publication et garder la dernière table fiable quand le flux est incomplet.
- VI-31 : préserver les mouvements et contrats historiques confirmés lorsque la collecte suivante échoue ou retire une observation.

Utilise les deux avis précédents et leurs reproductions. Laisse les prévisions à VI-19, l’identité intersources, les calendriers primaires et les recalculs à VI-21, et les logos à VI-30. Effectue les tests en écriture sur une copie PostgreSQL locale. Livrer le SHA final, la CI, les preuves de non-régression et la liste des critères des 33 qui peuvent être clôturés. Remets à Hugo le candidat qui doit passer sa revue Fable 5.2 xhigh. Les prochains avis indépendants doivent porter sur le même SHA.
