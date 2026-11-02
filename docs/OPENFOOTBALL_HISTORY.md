# Archives historiques OpenFootball

Les archives de résultats 2010/2011 à 2020/2021 proviennent de
[openfootball/football.json](https://github.com/openfootball/football.json),
dédié au domaine public sous CC0-1.0. La version source est figée au commit
`e6744429ee395bc86f247348c6184bb08d4eb361` et son ZIP original est conservé dans
`data/sources/openfootball/`.

Elles contiennent les calendriers et scores disponibles pour les compétitions
européennes présentes dans la source. Elles ne contiennent pas les statistiques
individuelles, tirs, xG ou xA de PitchAPI. Une rencontre sans score reste sans
score ; les données sont exposées séparément et ne sont pas fusionnées avec les
matchs PitchAPI. Les saisons civiles éventuelles sont regroupées sous la saison
qui commence la même année, avec la valeur source conservée dans chaque entrée.

Pour reconstruire les fichiers et leurs empreintes :

```sh
python dashboard/scripts/build_openfootball_history.py --archive data/sources/openfootball/football-json-e6744429.zip
```

Le manifeste `data/raw/openfootball/index.json` détaille, pour chaque saison, le
nombre de compétitions, matchs et résultats renseignés. Dans le dashboard, ouvrir
« Compétitions », puis « Archives de résultats » ; les résultats peuvent être
filtrés par saison, compétition ou équipe et exportés en CSV.
