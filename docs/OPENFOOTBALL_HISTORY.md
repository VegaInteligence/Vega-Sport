# Archives historiques de résultats

Les archives sont distinctes de PitchAPI et contiennent uniquement les
calendriers et scores disponibles : aucune statistique individuelle, tir, xG ou
xA n’est inventé.

Sources et conditions :

- [openfootball/football.json](https://github.com/openfootball/football.json) et
  les dépôts footballcsv Angleterre, Allemagne et Coupe d’Europe indiquent CC0-1.0.
- [footballcsv/cache.soccerdata](https://github.com/footballcsv/cache.soccerdata)
  indique CC0-1.0 pour son cache et reprend des données de
  [engsoccerdata](https://github.com/jalapic/engsoccerdata).
- [schochastics/football-data (World Club Ratings)](https://github.com/schochastics/football-data) est publié sous ODC-BY 1.0 ; les résultats écossais 1890/1891–1993/1994 sont ajoutés aux saisons concernées. La source est partielle pour 1915/1916 (379 résultats pour 380 matchs attendus).
- Le paquet engsoccerdata indique GPL-2.0 ou ultérieure ; son auteur précise un
  usage gratuit non commercial et demande une attribution. Les fichiers source,
  révisions, empreintes, licences et attribution sont conservés dans
  `data/sources/openfootball/` et `data/sources/engsoccerdata/`.

La FA Cup remonte à 1871/1872, sans les tours préliminaires. Les divisions
anglaises disponibles remontent à 1888/1889 ; les championnats espagnol, italien,
français et néerlandais remontent respectivement aux saisons 1928/1929,
1929/1930, 1932/1933 et 1956/1957 dans cette source. La Coupe d’Europe et la
Bundesliga commencent en 1955/1956 et 1963/1964. D’autres compétitions complètent
les années récentes. De 2010 à 2020, les championnats déjà présents dans
OpenFootball ne sont pas réimportés une seconde fois. La couverture varie selon
la saison et ne représente pas toutes les ligues européennes ; certaines dénominations ont été normalisées par
la source et les résultats historiques n’ont pas tous été vérifiés par l’auteur.

Les rencontres signalées comme non disputées sont conservées comme telles, sans
score inventé. Lorsque toutes les rencontres d’une compétition partagent une
même date source, cette date est marquée non vérifiée et n’est pas présentée
comme une date exacte ; la valeur d’origine reste dans `sourceFields`. Pour les
matchs concernés, le score à 90 minutes, celui après prolongation et les tirs au
but sont conservés séparément lorsque la source les fournit. Les CSV d’origine
restent disponibles pour permettre l’audit.

Pour reconstruire les fichiers et leurs empreintes :

```sh
python dashboard/scripts/build_openfootball_history.py --archive data/sources/openfootball/football-json-e6744429.zip
python dashboard/scripts/build_footballcsv_history.py --england data/sources/openfootball/footballcsv-england-52b7e5f5.zip --deutschland data/sources/openfootball/footballcsv-deutschland-17832462.zip --europe data/sources/openfootball/footballcsv-europe-66393c8d.zip --soccerdata data/sources/openfootball/footballcsv-soccerdata-f1c9d418.zip
python dashboard/scripts/build_engsoccerdata_history.py
python dashboard/scripts/build_scottish_history.py
```

Le manifeste `data/raw/openfootball/index.json` détaille, pour chaque saison, le
nombre de compétitions, rencontres, résultats renseignés, rencontres non
jouées et dates absentes ou non vérifiées. Dans le dashboard, ouvrir
« Compétitions », puis « Archives de résultats » ; les résultats peuvent être
filtrés par saison, compétition ou équipe et exportés en CSV.
