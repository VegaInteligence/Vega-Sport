<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/branding/vega-banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/branding/vega-banner-light.svg">
  <img src=".github/branding/vega-banner-dark.svg" alt="Vega Intelligence" width="100%">
</picture>

# Vega Intelligence

Application d'analyse du football : matchs, compétitions, clubs et joueurs, avec ses propres calculs (centiles, rôles, classements de puissance). Le site (Next.js) est hébergé sur Vercel ; il lit une API de lecture servie par CloudFront et Lambda, sur une base PostgreSQL (RDS) qu'un worker remplit depuis les sources et recalcule en continu.

## Ce que montre le site

| Page | Contenu |
| --- | --- |
| Accueil (`/`) | matchs de la semaine, joueur de la semaine, meneurs de la saison, course au Ballon d'Or |
| Matchs (`/matchs`, `/calendrier`) | résultats et calendrier ; fiche de match : statistiques, chronologie des xG, carte des tirs, compositions, réseau de passes, zones de chaleur, momentum, face-à-face, suivi en direct ; avant un match, ses probabilités (victoire, nul, défaite, score le plus probable) |
| Compétitions (`/competitions`) | classement, journées et tableaux des championnats et des coupes d'Europe, coupes nationales et tournois des sources complémentaires, niveau du championnat sur l'échelle commune, projection de fin de saison (points, titre, places) |
| Clubs (`/clubs`) | fiche club : résultats, style, effectif, niveau européen |
| Joueurs (`/joueurs`) | annuaire filtrable (Explorer, Indices), fiche joueur : statistiques par 90 minutes, centiles et rangs dans sa cohorte, rôles, Indice Vega (son score au classement de puissance), comparaison, profils similaires, matchs |
| Classement des joueurs (`/classement-joueurs`) | la course au Ballon d'Or de chaque saison et sa méthode |
| Archives (`/archives`) | saisons de 1850 à 2020 |
| Méthode (`/methode`) | comment les chiffres sont calculés |

Sur téléphone, le site se présente comme une application (barre d'onglets, recherche flottante). Quelques rubriques des fiches joueur affichent encore des valeurs fictives, signalées par un badge (potentiel, disponibilité, pied fort, et l'âge ou la taille des joueurs que Wikidata ne permet pas de relier) : la source ne fournit pas ces données.

## Architecture

```
PitchAPI + sources complémentaires
            │  collecte planifiée (file de jobs), normalisation en tables typées
            ▼
   worker Python (ECS Fargate) ──► PostgreSQL 18 (RDS)
     collecte · calculs · modèles      core  faits (matchs, statistiques, événements, tirs…)
                                       agg   calculs (saisons, cohortes, classements, Elo)
                                       ops   file, versions, journal de collecte
                                       api   vues de lecture, seules lues par l'API
            ▼
   API de lecture Node (Lambda) derrière CloudFront, réponses versionnées et mises en cache
            ▼
   site Next.js (Vercel)        page d'état (dépôt séparé, lit /api/ops/status)
```

Principes tenus par le code et ses tests :

- **Tables typées seulement** : aucune réponse brute ni colonne JSON n'est stockée ; un champ inconnu de la source est noté (`ops.unknown_fields`), pas gardé.
- **Une identité par entité réelle** : les équipes et joueurs des différentes sources sont reliés par règles relues (`backend/vega/sources/identity.py`), jamais par leur seul nom.
- **Migrations immuables**, numérotées, vérifiées par somme de contrôle ; une vue lit des tables, jamais une autre vue.
- **L'API ne connaît que le schéma `api`** et aucune route ne nomme une source ; les identifiants publics sont ceux de Vega.
- **Absent n'est pas zéro**, sauf là où la base sait que la source publie la mesure pour le match (`agg.match_zeros`).

## Données

- **PitchAPI** : 77 compétitions (73 championnats nationaux, les trois coupes d'Europe de clubs, la Coupe du monde) ; par match : résumé, événements, tirs avec coordonnées et xG, compositions, statistiques d'équipe et de joueur (match et mi-temps), statistiques avancées (passes et conduites progressives, valeurs d'action), réseau de passes, zones de chaleur, momentum, face-à-face.
- **Sources complémentaires** (`backend/vega/sources`) : OpenFootball (coupes nationales, Euros, Coupes du monde, Coupes du monde des clubs), OpenLigaDB, International Results, open-matchday, classements UEFA et FIFA, Wikidata et Wikimedia (clubs, entraîneurs, palmarès, stades, date de naissance et taille des joueurs). Sources et licences : [docs/CUP_COMPETITIONS.md](docs/CUP_COMPETITIONS.md), [docs/OPENFOOTBALL_HISTORY.md](docs/OPENFOOTBALL_HISTORY.md).
- **Archives** 1850–2020, importées une fois.

## Calculs

Les formules sont documentées telles que le code les applique dans [docs/calculs](docs/calculs/README.md).

- **Saisons** de joueur et de club, états de jeu, classements, xPts, cohortes, centiles et rangs, rôles et indices.
- **Classements de puissance** ([méthode](docs/METHODE_CLASSEMENT_BALLON_D_OR.md), [audit et versions](docs/calculs/05-joueurs/08-audit-classement-puissance.md)), version 3 depuis le 12 novembre 2026 :
  - clubs et sélections : un Elo sur tous les matchs, les clubs entrant au niveau de leur championnat, sur une échelle commune aux championnats reliés par assez de matchs (41 sur 72) ;
  - joueurs : contribution par match relative au rôle et à l'adversaire, niveau du club, année du trophée du 1ᵉʳ août au 31 juillet, Coupe du monde comprise ;
  - enjeu : un match compte pour le prestige de sa compétition × son tour (championnat 1, Ligue des champions 1,15, sa finale 1,32, finale de Coupe du monde 1,50).
- **Niveau des championnats** : la force moyenne des clubs de chaque championnat, saison par saison.
- **xG de Vega** ([méthode et vérification](docs/calculs/02-metriques-attendues/05-xg-vega.md)) : un second calcul des buts attendus, d'après la distance, l'angle, la partie du corps et la situation du tir, jugé sur une saison non vue ; il double le xG de la source sans le remplacer.
- **Profils proches** ([méthode](docs/calculs/05-joueurs/04-similarite-radar-et-traits.md)) : chaque joueur placé sur les axes appris de toutes les statistiques de la saison ; ses voisins sont les joueurs au même genre de saison, sans que le poste entre dans le calcul.
- **Pronostics et projections** ([méthode et vérifications](docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md)) : un modèle de buts ajusté sur la force des deux équipes, jugé sur des matchs non vus ; chaque championnat en cours est rejoué 1 000 fois jusqu'à son terme.

## Infrastructure

| Élément | Où | Détail |
| --- | --- | --- |
| Site | Vercel | déployé à chaque poussée sur `main` |
| Base | AWS RDS, `us-east-2` | PostgreSQL 18, `db.t4g.medium`, privée, sauvegardes 7 jours |
| Worker | AWS ECS Fargate | un service toujours actif (collecte, calculs, modèles), un service de rattrapage de l'historique, une tâche de migration à la demande |
| API de lecture | AWS Lambda (Node 24) + CloudFront | lit le schéma `api` avec un rôle en lecture seule ; sert aussi les copies d'images |
| Direct | AWS AppSync Events + ingestion planifiée | scores et événements des matchs en cours |
| Secrets | AWS SSM (SecureString) | clé de la source, mots de passe de base, clé de la page d'état |
| Déploiement | GitHub Actions, workflow **Deploy** (manuel) | `infra/aws/deploy.sh` : migrations, image du worker, API ; piles CloudFormation `vega-v2-*` |
| Intégration continue | GitHub Actions, `ci.yml` | suites backend, API et site, modèles d'infrastructure, image et paquet |

Les ressources AWS gardent leurs noms d'origine (`vega-v2-…`). Procédure, rôles et coûts : [infra/aws/README.md](infra/aws/README.md).

## État du projet (12 novembre 2026)

- Le backend actuel sert le site depuis le 10 novembre 2026 ; le précédent a été retiré ce jour-là.
- Le rattrapage de l'historique (saisons depuis 2021/2022) est en cours.
- En service depuis le 12 novembre : classements de puissance version 3 (enjeu des matchs, Coupe du monde), championnats brésiliens sur l'échelle commune, zéros omis par la source rendus aux fiches et aux listes, niveau des championnats, pronostics de match et projections de fin de saison, équipes des Coupes du monde des clubs et sélections de la Ligue des nations reliées à leurs équipes, date de naissance et taille des joueurs lues de Wikidata, xG de Vega sur les tirs, partenaires de passe des joueurs, lecture des deux mi-temps des clubs, profils les plus proches d'un joueur.
- Limites connues : les championnats sans assez de matchs contre les autres (MLS, Arabie saoudite, Mexique, Argentine…) donnent un score à leurs joueurs, pas de rang ; la date de naissance et la taille viennent de Wikidata, club par club, pour les seuls joueurs reliés sans doute possible (environ quatre sur dix dans les grands clubs, moins ailleurs), aucun pied fort ; hors Coupe du monde, le football de sélections n'a que des résultats.
- Suites de tests au 12 novembre : 235 tests Python, 124 tests de l'API, 538 tests du site, toutes vertes.

## Organisation du dépôt

| Répertoire | Responsabilité |
| --- | --- |
| `dashboard/frontend` | le site et son transport HTTP vers l'API |
| `dashboard/shared` | modules partagés entre le site et le backend (profil joueur, périmètres, archives) |
| `backend/vega` | worker Python : planification, collecte, normalisation, calculs, modèles, sources |
| `backend/sql` | migrations de la base |
| `backend/api` | API de lecture Node : routes, tests de contrat |
| `backend/sources`, `backend/archives` | lecteurs Node des sources complémentaires et constructeurs des archives |
| `backend/tests` | tests Python du backend |
| `infra/aws` | modèles CloudFormation, script de déploiement, paquets Lambda |
| `tests` | tests du site |
| `docs` | méthode du classement, formules (`docs/calculs`), sources et crédits |

Le détail du backend est dans [backend/README.md](backend/README.md).

## Développement

Prérequis : Node.js 22 ou plus, Bun, Python 3.12 et PostgreSQL 18 (un conteneur suffit) pour les tests du backend.

```sh
cd dashboard
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Le site lit l'API nommée par `NEXT_PUBLIC_API_ORIGIN` ; aucun identifiant de base n'est nécessaire côté site.

## Vérification

```sh
# Backend : les bases de test jetables, puis les deux suites
eval "$(python3 backend/ci/test_databases.py postgresql://postgres:<mot de passe>@127.0.0.1:5432)"
PYTHONPATH=backend python3 -m unittest discover -s backend/tests
npm ci --prefix backend/api && npm test --prefix backend/api

# Site : tests et construction
node --test tests/*.test.mjs
(cd dashboard && bun run build)
```

## Déploiement

Le site se déploie seul à chaque poussée sur `main`. Le backend se déploie par le workflow **Deploy** (GitHub Actions) ou depuis un poste :

```sh
aws login --profile statarena
AWS_PROFILE=statarena bash infra/aws/deploy.sh
```

Le script déploie le commit courant : migrations, worker, rattrapage, API de lecture. La collecte s'interrompt une dizaine de minutes pendant un déploiement.
