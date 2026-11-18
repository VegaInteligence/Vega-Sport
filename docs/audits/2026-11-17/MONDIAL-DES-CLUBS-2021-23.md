# Mondial des clubs 2021 à 2023

Chelsea–Palmeiras est encore enregistré à **2–1 à 90 minutes** en production. La FIFA donne **1–1 à 90 minutes, puis 2–1 après prolongation**. Le relevé RDS de 10 h 12 UTC retrouve les 22 matchs des trois éditions et tous les scores finaux une fois les buts attribués au bon club. Pour ces rencontres, il manque les joueurs en base et les 44 côtés disposent de leur Elo. [22 matchs détaillés](controles/mondial-clubs-2021-23/fixtures.csv) · [Requête de production](controles/mondial-clubs-2021-23/capture-query.sql)

| Édition FIFA | Matchs | Titulaires | Entrants | Joueurs × match | Banc sans entrée | Côtés avec Elo | Notes de joueur |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021, Émirats, joué en février 2022 | 8 | 176 | 67 | 243 | 103 | 16 | 0 |
| 2022, Maroc, joué en février 2023 | 7 | 154 | 57 | 211 | 105 | 14 | 0 |
| 2023, Arabie saoudite, joué en décembre 2023 | 7 | 154 | 67 | 221 | 96 | 14 | 0 |

Les 675 participations concernent 312 joueurs distincts. Les minutes d’entrée des 191 remplaçants figurent sur les feuilles. Sur ces matchs, la base ne contient ni compositions, ni observations individuelles de match, ni notes. Les feuilles attestent la participation. Le calcul d’une note exige aussi une identité, un poste et les mesures nécessaires à l’algorithme Vega. [Comptes par édition](controles/mondial-clubs-2021-23/per-edition.csv) · [Sources officielles](controles/mondial-clubs-2021-23/official-sources.csv)

La finale et la petite finale de 2022 inversent l’ordre des clubs par rapport à la FIFA. Les 22 matchs ont un type de tour `regular`, aucune heure de coup d’envoi, aucun numéro FIFA et aucun score de mi-temps dans RDS. Aux Émirats, les huit heures du champ local de l’API FIFA retardent d’une heure sur le programme officiel. L’heure UTC convertie au fuseau du stade concorde avec celui-ci sur les huit matchs. Dans la finale 2021, l’archive sépare déjà les scores à la pause, à 90 et après prolongation. Sur les mêmes octets, le parseur déployé reproduit le 2–1 erroné à 90 minutes et celui de la branche restitue 1–1. [Comparaison des parseurs](controles/mondial-clubs-2021-23/parser-outcomes.json) · [Horaires vérifiés](controles/mondial-clubs-2021-23/kickoffs.csv) · [Archive de contrôle hors ligne](controles/mondial-clubs-2021-23/mondial-clubs-2021-23.zip)

## Conditions du calcul des notes

Avec les 63 matchs et le barrage de 2025, quatre éditions totalisent **86 matchs, 2 707 participations individuelles attestées, 172 côtés avec Elo et zéro note de joueur dans RDS**. Le sélecteur SQL `PLAYER_MATCHES`, dans `backend/vega/power.py` à la ligne 1029, exige à la fois `cs.archive_key IS NULL` et `cs.cup_key IS NULL`. Alimenter les statistiques sous les clés actuelles laisserait donc ces éditions hors de ce chemin de calcul. VI-21 conserve la décision d’admission, les contrôles de données minimales, le recalcul saisonnier et la vérification de la lecture publique. [Édition 2025 et barrage](MONDIAL-DES-CLUBS-2025.md) · [Suivi VI-21](https://linear.app/vegainteligence/issue/VI-21)

## Publication et relecture

Deux contrôles de l’origine de production, à 10 h 31 et 10 h 37 UTC, retrouvent le même score erroné. Les trois lecteurs d’édition et leurs trois snapshots servent les 22 rencontres. Les 22 routes de détail génériques et le résumé de Chelsea–Palmeiras répondent 404. Un match natif témoin répond 200. Le composant de coupe utilise la voie d’édition. Dans la seconde mesure, les sept GET avec ETag inchangé retournent 304. [32 GET et 7 relectures signées](controles/mondial-clubs-2021-23/reponses-origine.json) · [Corps des réponses et vérificateur](controles/mondial-clubs-2021-23/lectures-production.zip)

Le writer de production a reconstitué les 22 clés de match et les trois empreintes d’édition sur PostgreSQL 18. Le passage au commit `da75069864` modifie uniquement le match 736663. Le GET d’édition expose alors 1–1 à 90 minutes puis 2–1 après prolongation. Lors de la lecture hebdomadaire suivante, les trois vérifications d’édition avancent et aucune ligne de match n’est réécrite. Les 22 mi-temps connues restent absentes, dont six véritables 0–0. Après la correction, le manifeste global conserve sa génération, même en demandant une publication forcée. Le test témoin avance une autre ressource et fait passer la génération de 1 à 2. Ce dernier constat porte sur la copie locale. [Résultats PostgreSQL](controles/mondial-clubs-2021-23/resultats-sur-postgres.json) · [Rejeu du writer, de l’API et du manifeste](controles/mondial-clubs-2021-23/rejeu-postgres.zip)
