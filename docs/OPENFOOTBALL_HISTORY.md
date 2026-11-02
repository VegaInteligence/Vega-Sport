# Archives historiques de résultats

Les résultats 2010/2011 à 2020/2021 proviennent de
[openfootball/football.json](https://github.com/openfootball/football.json).
Les saisons antérieures proviennent de sources CC0 du même écosystème :
[Coupe d’Europe](https://github.com/footballcsv/europe-champions-league),
[Bundesliga](https://github.com/footballcsv/deutschland) et
[divisions anglaises](https://github.com/footballcsv/england). Les ZIP source et
licences sont conservés dans `data/sources/openfootball/`, avec leurs révisions
et empreintes dans le manifeste.

De 1955/1956 à 1962/1963, les archives couvrent la Coupe d’Europe. À partir de
1963/1964, elles comprennent aussi la Bundesliga ; à partir de 1992/1993, elles
ajoutent les divisions anglaises disponibles. Les saisons 2010 à 2020 couvrent
davantage de compétitions européennes. La couverture varie selon la saison.

Ces archives contiennent les calendriers et scores disponibles uniquement :
aucune statistique individuelle, tirs, xG ou xA ne sont inventés. Une rencontre
sans score reste sans score ; les données ne sont pas fusionnées avec les matchs
PitchAPI. Pour les matchs concernés, le score à 90 minutes, celui après
prolongation et les tirs au but sont conservés séparément. Les valeurs d’origine
des CSV restent dans chaque enregistrement pour permettre l’audit.

Pour reconstruire les fichiers et leurs empreintes :

```sh
python dashboard/scripts/build_openfootball_history.py --archive data/sources/openfootball/football-json-e6744429.zip
python dashboard/scripts/build_footballcsv_history.py --england data/sources/openfootball/footballcsv-england-52b7e5f5.zip --deutschland data/sources/openfootball/footballcsv-deutschland-17832462.zip --europe data/sources/openfootball/footballcsv-europe-66393c8d.zip
```

Le manifeste `data/raw/openfootball/index.json` détaille, pour chaque saison, le
nombre de compétitions, matchs et résultats renseignés. Dans le dashboard, ouvrir
« Compétitions », puis « Archives de résultats » ; les résultats peuvent être
filtrés par saison, compétition ou équipe et exportés en CSV.
