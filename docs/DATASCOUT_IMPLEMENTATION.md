# Couverture de l’audit Data’Scout

État au 2 novembre 2026 des fonctions relevées dans [DATASCOUT_BENCHMARK.md](DATASCOUT_BENCHMARK.md), pour les pages Matchs, Joueurs et Clubs. Toutes les valeurs affichées viennent des observations collectées (PitchAPI) ; aucune donnée absente n’est déduite ni remplacée par zéro.

Statuts : **ajouté** (cette livraison), **existant** (déjà en place, vérifié), **exclu** (demande explicite), **données manquantes** (la source ne contient pas l’information).

## Joueurs

| Fonction de l’audit | Statut | Où |
|---|---|---|
| Fiche joueur-saison : totaux, par 90, par match, titularisations, compétitions, derniers matchs | existant | Joueurs › fiche › Vue d’ensemble, Statistiques, Matchs |
| Radar et tableau de centiles au poste, cohorte et minimum de minutes visibles | existant | fiche › Vue d’ensemble, Statistiques |
| Forces et faiblesses explicables | existant | fiche › Traits statistiques |
| Évaluations par rôle | existant | fiche › Dimensions par profil ; Joueurs › Indices |
| Indice personnalisé (métriques, sens, poids, contributions, modèles enregistrés) | existant | Joueurs › Indices |
| Profils similaires avec indicateurs communs | existant | fiche › Profils similaires |
| Comparaison de 2 à 4 joueurs, saison précédente, médiane | existant, enrichi | fiche › Comparer : suggestions de profils proches ajoutées |
| Explorateur (axes libres, distribution, seuils, club mis en avant) | existant | Joueurs › Explorer |
| Évolution saisonnière et forme récente | existant, corrigé | fiche › Évolution : base masquée pour la note et les minutes, graphique à taille lisible |
| Listes et vues enregistrées, export/import JSON | existant | Joueurs › Mes listes |
| Rapport imprimable / PDF, CSV, SVG | existant | fiche › Rapport ; exports des vues |
| Classement Orion décomposable | hors périmètre | Les 30 places restent réservées jusqu’à validation de la méthode |

## Clubs

| Fonction de l’audit | Statut | Où |
|---|---|---|
| Bilan de saison total, domicile, extérieur, points par match, matchs sans encaisser | ajouté | Clubs › fiche › Vue d’ensemble |
| xG pour et contre, tirs, possession | ajouté | Vue d’ensemble ; Profil de jeu |
| Forme et prochains matchs | ajouté | Vue d’ensemble |
| Choix du périmètre (toutes compétitions ou une seule) | ajouté | sélecteur « Périmètre » commun aux onglets |
| Joueurs utilisés, minutes, titularisations, part du temps de jeu | ajouté | Effectif › Temps de jeu |
| Rotation : titulaires reconduits d’un match à l’autre, part des 11 plus utilisés | ajouté | Effectif |
| Systèmes utilisés et résultats par système | ajouté | Matchs |
| Buts marqués et encaissés par tranche de 15 minutes | ajouté | Matchs |
| Profil collectif en centiles, cohorte de la compétition | ajouté | Profil de jeu |
| Clubs au profil proche (ressemblance de style, pas de niveau) | ajouté | Profil de jeu |
| Comparaison de deux clubs et confrontations de la saison | ajouté | Comparer |
| Rapport club | ajouté | Rapport |
| Clubs enregistrés | ajouté | Enregistrer ; Clubs › Mes clubs |
| Entraîneur actuel | existant | Le club en bref |
| Historique des entraîneurs, pyramide des âges | données manquantes | Ni mandats datés ni dates de naissance dans les profils |
| Test de recrutement / compatibilité joueur–club | non fait | Prototype descriptif possible avec les données actuelles ; à cadrer séparément |

## Matchs

| Fonction de l’audit | Statut | Où |
|---|---|---|
| Contexte d’avant-match : forme, bilan, repos, repères de saison | ajouté | Matchs › fiche › Avant-match (onglet par défaut avant le coup d’envoi) |
| Confrontations précédentes avec bilan | ajouté | Avant-match |
| Joueurs les plus utilisés avant le match | ajouté | Avant-match |
| Lecture des événements : chronologie filtrable par type et par équipe, cartons et remplacements par équipe | ajouté | Vue d’ensemble › Temps forts |
| Libellés des événements (but, carton, remplacement) | corrigé | Temps forts et Données complètes affichaient les codes bruts de la source |
| Matchs enregistrés | ajouté | Enregistrer ; Matchs › Mes matchs |

Le contexte d’avant-match n’utilise que les matchs terminés avant le coup d’envoi. Vérification sur Juventus–Napoli (1er novembre 2026) : 12 matchs, 6-3-3, 20 buts marqués et 13 encaissés, identiques à un recomptage indépendant des données brutes.

## Exclusions et limites

- **Exclu à la demande** : création d’équipe, meilleur XI, formation modifiable et mercato simulé.
- **Données manquantes** : suivi physique (distances, sprints), âge, pied, taille, contrats, valeur marchande, blessures, directions de passes détaillées.
- **Modèles non validés** : projection dans une autre ligue et estimation de prix ne sont pas publiées.

## Recherche

La recherche de la page d’accueil est remplacée par une recherche globale dans la barre de navigation (joueurs, clubs, compétitions, initiales comme « psg »). Le texte tapé reste dans le champ : aucune mise à jour d’URL ni de page à chaque touche. Les filtres de liste (Joueurs, Matchs) gardent eux aussi leur texte localement et mettent l’URL à jour après une courte pause.
