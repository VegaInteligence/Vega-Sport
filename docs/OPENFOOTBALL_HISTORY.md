# Archives historiques de résultats

Les résultats 2010/2011 à 2020/2021 proviennent de
[openfootball/football.json](https://github.com/openfootball/football.json).
Les saisons antérieures utilisent des fichiers de
[footballcsv/europe-champions-league](https://github.com/footballcsv/europe-champions-league),
[footballcsv/deutschland](https://github.com/footballcsv/deutschland),
[footballcsv/england](https://github.com/footballcsv/england) et
[footballcsv/cache.soccerdata](https://github.com/footballcsv/cache.soccerdata),
qui indiquent une licence CC0-1.0. Le dernier dépôt reprend des données de
[engsoccerdata](https://github.com/jalapic/engsoccerdata), dont le paquet indique
une licence GPL-2.0 ou ultérieure. Son auteur précise un usage gratuit non commercial
et demande une attribution. Les sources, révisions, empreintes et licences sont
conservées dans `data/sources/openfootball/` et le manifeste.

De 1888/1889 à 1954/1955, les saisons disponibles couvrent les divisions
anglaises, avec des interruptions dans la série. À partir de 1955/1956, elles
ajoutent la Coupe d’Europe ; à partir de 1963/1964, la Bundesliga. Les saisons
2010 à 2020 couvrent davantage de compétitions européennes. La couverture varie
selon la saison et ne représente pas toutes les ligues européennes.

Ces archives contiennent les calendriers et scores disponibles uniquement :
aucune statistique individuelle, tirs, xG ou xA ne sont inventés. Une rencontre
sans score reste sans score ; les données ne sont pas fusionnées avec les matchs
PitchAPI. Pour les matchs concernés, le score à 90 minutes, celui après
prolongation et les tirs au but sont conservés séparément. Les valeurs d’origine
des CSV restent dans chaque enregistrement pour permettre l’audit.

Pour reconstruire les fichiers et leurs empreintes :

```sh
python dashboard/scripts/build_openfootball_history.py --archive data/sources/openfootball/football-json-e6744429.zip
python dashboard/scripts/build_footballcsv_history.py --england data/sources/openfootball/footballcsv-england-52b7e5f5.zip --deutschland data/sources/openfootball/footballcsv-deutschland-17832462.zip --europe data/sources/openfootball/footballcsv-europe-66393c8d.zip --soccerdata data/sources/openfootball/footballcsv-soccerdata-f1c9d418.zip
```

Le manifeste `data/raw/openfootball/index.json` détaille, pour chaque saison, le
nombre de compétitions, matchs et résultats renseignés. Dans le dashboard, ouvrir
« Compétitions », puis « Archives de résultats » ; les résultats peuvent être
filtrés par saison, compétition ou équipe et exportés en CSV.
