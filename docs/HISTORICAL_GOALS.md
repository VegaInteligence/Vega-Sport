# Archives de buts historiques

Ces données sont distinctes des performances PitchAPI et des archives de résultats.
Elles proviennent de [schochastics/football-data (World Club Ratings)](https://github.com/schochastics/football-data), sous [ODC-BY 1.0](https://opendatacommons.org/licenses/by/1-0/). Le manifeste conserve la révision, les liens et empreintes SHA-256 des fichiers originaux.

La couverture varie selon les compétitions et saisons. Ce sont des événements de but, pas des statistiques complètes de joueur : les matchs sans but ne figurent pas dans ces fichiers et aucun xG n'est fourni. Le type de but (contre son camp, penalty, etc.) n'est pas garanti par cette source. Le score affiché est celui indiqué après l'événement, et non nécessairement le score final. Lorsque le nombre d'événements ne correspond pas au score final inscrit dans le libellé du match, les événements sont signalés comme divergents.

Les lignes exactement identiques sont dédupliquées ; les fichiers originaux compressés sont conservés pour audit. Les événements dont la saison source n'est pas fiable ne sont pas affectés à une saison. Exception : le championnat norvégien se joue en année civile ; lorsque la source indique `NA`, ses matchs de l'année N sont regroupés sous N/N+1 et explicitement signalés comme année civile N. La saison source est préservée dans l'export CSV.

Pour reconstruire les archives et le manifeste :

```sh
python dashboard/scripts/build_historical_goals.py
```

Dans le dashboard : « Compétitions » puis « Archives de buts », avec recherche par joueur ou équipe, filtre de compétition et export CSV.
