# Worklog

- Objectif : concevoir un classement personnel du Ballon d’Or, explicable et adapté aux différents rôles.
- Direction : excellence relative par rôle, contexte des équipes, performance par match et agrégation sur la saison ; hypothèses et alternative VAEP dans `docs/METHODE_CLASSEMENT_BALLON_D_OR.md`.
- État : méthode documentée et licence MIT ajoutée. README épuré à la demande de l’utilisateur : présentation du projet, approche, documentation et licence ; sans checklist, calendrier, badges ou instructions techniques. Aucun pipeline, modèle ou classement implémenté ni validé.
- Données : PitchAPI envisagée ; couverture, qualité et droits restent à vérifier. `.env` est ignoré par Git.
- Prochaine action : mesurer la couverture des données et arrêter les paramètres ouverts de la méthode avant implémentation.
- Commit suggéré : `docs: simplify project README`.

## 31 octobre 2026 — Dashboard d’exploration

- Audit du dépôt : aucune interface préexistante dans la branche `main` consultée ; création du dashboard dans `dashboard/` à partir des fichiers disponibles.
- Design clair et responsive, navigation par vue d’ensemble, joueurs, matchs, données et méthode. Filtres, tri, comparaison de trois apparitions, fiches joueurs et matchs, carte des tirs, fil des xG et export CSV.
- Préparation reproductible des données avec la bibliothèque standard Python ; frontend HTML/CSS/JavaScript sans dépendance. Les fichiers bruts restent inchangés.
- Valeurs absentes conservées, zéros suspects de 3. Liga masqués, notes PitchAPI identifiées et rôles non interprétés. Aucun modèle ou classement Orion implémenté.
- Revue croisée par sous-agents pour la méthode, les données, les graphiques et le système visuel. Tests des données et des fonctions JavaScript, plus vérification des interactions et des mises en page dans le navigateur.
- Documentation : `docs/DASHBOARD.md` et `docs/DASHBOARD_DATA.md`.
