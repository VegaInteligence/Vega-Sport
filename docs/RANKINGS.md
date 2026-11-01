# Classements FIFA et coefficients UEFA

Les tableaux sont stockés dans la base JSON sous `data/raw/rankings/`. Le site les lit directement, sans requête authentifiée dans le navigateur.

## Périmètre collecté

- FIFA masculin : les 32 éditions proposées par le catalogue officiel du 10 février 2022 au 7 octobre 2026.
- UEFA : coefficients globaux sur cinq saisons des clubs et associations pour les saisons se terminant en 2022, 2023, 2024, 2025, 2026 et 2027. La saison 2026/2027 est en cours et ses valeurs peuvent évoluer.
- SportsAPI : instantanés actuels FIFA masculin, clubs UEFA et pays UEFA. Son endpoint de classement documente uniquement le tableau actuel, sans paramètre historique. Les instantanés ne sont pas renommés en éditions historiques.

Sources : [SportsAPI](https://sportsapi.app/docs#rankings), [FIFA](https://inside.fifa.com/fifa-rankings/world-ranking/men), [UEFA clubs](https://www.uefa.com/nationalassociations/uefarankings/club/), [UEFA associations](https://www.uefa.com/nationalassociations/uefarankings/country/).

## Signification et dates

Le classement FIFA concerne les sélections nationales masculines. Le coefficient UEFA des associations mesure les résultats de leurs clubs en compétitions européennes ; ce n’est pas un classement de la force des sélections nationales.

L’édition FIFA conserve sa date officielle et son identifiant de calendrier. Les anciens et nouveaux formats de réponse FIFA sont pris en charge. Un pays sans rang garde `position: null` ; les 21 positions non attribuées présentes dans les éditions ne sont pas converties en zéro.

Pour l’UEFA, `period` désigne la saison et le nom de fichier son année de fin. `sourceUpdatedAt` est la date de mise à jour fournie par le service, parfois postérieure à la période historique. Elle ne constitue pas une date de publication initiale : ces tableaux annuels ne suffisent donc pas à attribuer automatiquement un coefficient connu avant chaque match.

Le coefficient affiché correspond à `overallRanking.totalValue`, incluant le minimum de l’association lorsqu’il s’applique. Les points propres au club sont conservés dans `earnedPoints`, et la ligne fournisseur complète dans `sourceRow`.

Les rangs peuvent être ex æquo. Les réponses SportsAPI des clubs comportent une même équipe à deux positions distinctes ; ces deux lignes restent présentes, avec l’anomalie enregistrée dans `quality.duplicateEntityIds`. Les fiches clubs utilisent les éditions officielles UEFA.

## Tables et relations

- `index.json` : éditions, sources, périodes, compteurs et SHA-256 des tableaux.
- `fifa-men/*.json`, `uefa-clubs/*.json`, `uefa-associations/*.json` : lignes de classement avec identifiants propres à la source, rang, points et ligne originale.
- `club-links.json` : correspondances des identifiants de clubs du projet avec ceux de l’UEFA. Les correspondances exigent un nom ou alias explicite non ambigu et un pays concordant.
- `data/sources/rankings/` : réponses originales conservées pour refaire les contrôles.

242 clubs du projet ont une correspondance vérifiée selon ces règles. Les 588 autres restent non reliés : cela ne prouve pas qu’ils soient absents du classement. L’interface affiche cette distinction. Aucun rapprochement approximatif de noms n’est effectué.

## Interface

La page **Classements** permet de choisir les sélections FIFA ou les associations UEFA, de sélectionner une édition et de rechercher un pays. Les fiches clubs reliées affichent l’historique UEFA des six saisons collectées, avec rang européen et coefficient. Une absence dans une édition est distincte d’une correspondance d’identité manquante.

## Reproduction

La clé SportsAPI est conservée dans `dashboard/.env` sous `SPORTSAPI_API_KEY`. Elle n’est jamais incluse dans les tables publiques, le frontend ou le build.

```bash
python3 dashboard/scripts/collect_rankings.py --from-year 2022
python3 dashboard/scripts/verify_rankings.py
bun dashboard/backend/server.js
```

Le collecteur réutilise les réponses locales. `--refresh` permet de les redemander aux sources. Les éditions restent séparées par fournisseur et ne se remplacent pas mutuellement.

Les preuves de collecte et de vérification sont dans `dashboard/outputs/rankings/`. Les premières tentatives rejetées sont conservées : paramètre FIFA superflu, positions non attribuées et doublon SportsAPI ont été identifiés puis traités explicitement. La réconciliation finale compare toutes les lignes normalisées aux réponses originales téléchargées.
