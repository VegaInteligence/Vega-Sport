# Coupes dans Compétitions

Le catalogue conserve les compétitions PitchAPI et ajoute des entrées distinctes par source. Les scores externes ne sont pas convertis en statistiques joueurs ou en classements inventés.

- **Coupe du monde 2022 et 2026** : catalogue et matchs PitchAPI existants. Les éditions 1930 à 2018 sont accessibles séparément dans « Coupe du monde — archives » via [OpenFootball worldcup.json](https://github.com/openfootball/worldcup.json), CC0-1.0.
- **Euro** : éditions 2020 (jouée en 2021), 2024 et calendrier 2028 via [OpenFootball euro.json](https://github.com/openfootball/euro.json), CC0-1.0. Les codes d’équipes non déterminées sont conservés comme tels.
- **Coupe du monde des clubs 2025** : [OpenFootball worldcup.json](https://github.com/openfootball/worldcup.json), CC0-1.0.
- **Coupe de France** : l’archive 2024/2025 est issue de [OpenFootball Europe](https://github.com/openfootball/europe/blob/master/france/2024-25_frcup.txt), CC0-1.0. Elle ne constitue pas une couverture de la saison actuelle. Le parseur vérifie le nombre de matchs annoncé et sépare les tirs au but du score du match.
- **Coupes nationales 2026/2027** : onze jeux de données présents dans l’index complémentaire [open-matchday](https://github.com/oladeeayo/open-matchday), dont la Coupe du Roi, la FA Cup et les Coupes de la Ligue anglaise et écossaise. La couverture dépend de la source ; ses [conditions](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md) indiquent un usage non commercial avec attribution.

Les fichiers OpenFootball sont chargés à la demande depuis des chemins autorisés, avec un cache d’une heure ; leur actualisation dépend de la source. Les données open-matchday utilisent l’index déjà produit par le projet. Les horaires sans fuseau vérifié ne sont pas affichés. Pour les matchs externes, le site affiche les résultats et calendriers disponibles sans prétendre fournir une fiche détaillée PitchAPI.

La Coupe de la Ligue française a connu sa dernière édition en 2019/2020 ([rapport FFF](https://media.fff.fr/uploads/document/ebe701d2b3b355e77b00d3badd780254.pdf)). Aucune archive vérifiée de cette compétition n’est ajoutée ici ; elle ne doit pas être confondue avec la Coupe de la Ligue anglaise.
