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
- Le commit `b1bd916` de `main`, arrivé pendant la refonte avec le dashboard initial, a été intégré : commande locale `node dashboard/server.js`, indicateurs gardiens et recherche du catalogue conservés dans la nouvelle interface.

## 31 octobre 2026 — Refonte sombre et exploration PitchAPI

- Nouvelle demande : remplacer le design blanc par une interface noire, afficher les vrais logos et ouvrir l’ensemble des données PitchAPI.
- Refonte sombre avec accents lime, logos de clubs, portraits, match mis en avant, catalogue de compétitions et fiches clubs. Les 18 logos de clubs de l’instantané se chargent dans le navigateur.
- Catalogue initial complet : 77 compétitions et 303 couples compétition–saison. Les données réellement collectées restent 9 matchs, 18 équipes et 320 joueurs référencés, dont 274 entrés en jeu.
- Les quatre réponses détaillées déjà présentes par match sont maintenant publiables intégralement : compositions, statistiques équipes, statistiques joueurs et tirs. Treize familles sont consultables depuis chaque match avec état de disponibilité explicite et export JSON.
- Passerelle serveur couvrant les 24 formes de ressources GET documentées, validation des routes, clé exclusivement côté serveur, cache court, erreurs nettoyées, limites de ressources et repli sur l’instantané. Site préparé en Worker ESM sans dépendance frontend.
- Collecteur exhaustif Python ajouté : index de toutes les saisons, détails des matchs terminés, profils et points de reprise. Le plan hors réseau confirme 77/303 ; aucune collecte supplémentaire réelle n’a été exécutée, car aucune clé PitchAPI n’est configurée dans l’environnement de travail ou le site.
- Validation : 19 tests Python et 45 tests Node réussis. Contrôle navigateur des logos, catalogue, saisons, clubs, compositions, statistiques complètes et mi-temps, états absents et export JSON réel. Mobile et tablette sans débordement horizontal du document.
- Travail parallèle sur le design, l’intégration API, la collecte et les régressions. La méthode de classement Orion reste inchangée et non calculée.
