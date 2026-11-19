# football-data.co.uk — les saisons de championnat 2000/01 à 2020/21

PitchAPI ne sert l'historique qu'à partir de 2021/22. Avant, la base tient déjà, pour chaque saison du top 7, le jour, les équipes et le score de chaque match (archives OpenFootball, footballcsv, engsoccerdata : [OPENFOOTBALL_HISTORY.md](OPENFOOTBALL_HISTORY.md)). Les fichiers de [football-data.co.uk](https://www.football-data.co.uk) y ajoutent ce que les archives n'ont pas : le score à la mi-temps, les statistiques de match quand le fichier les donne, l'arbitre (Angleterre) et les cotes 1X2.

Choix de l'utilisateur, 19 novembre 2026, informé des conditions du site : les données sont gratuites mais « intended for private individuals only, NOT commercial or data training products using automated bots/scrapers/AI », « for the purposes of league match prediction only ». Aucune licence n'est nommée. Ces conditions sont recopiées dans la ligne `football-data-co-uk` de `core.source_revisions`.

## Ce qui est lu

- 14 divisions : Angleterre 1 à 4 (`E0`–`E3`), Espagne 1 et 2 (`SP1`, `SP2`), Allemagne 1 et 2 (`D1`, `D2`), Italie 1 et 2 (`I1`, `I2`), France 1 et 2 (`F1`, `F2`), Portugal 1 (`P1`), Pays-Bas 1 (`N1`) ;
- 21 saisons, 2000/01 à 2020/21 : 294 fichiers `https://football-data.co.uk/mmz4281/AABB/DIV.csv`, chacun épinglé par son SHA-256 (`backend/vega/sources/data/football-data-files.json`, tels que servis le 19 novembre 2026). Les fichiers sont lus avant la transaction d'écriture (la base coupe une session restée 60 s inactive dans une transaction) ; le premier fichier différent ou absent arrête la lecture, rien n'est écrit (`SOURCE_CHANGED`), et la portée réessaie une heure plus tard ;
- statistiques : tirs, tirs cadrés, poteaux, corners, fautes (coups francs concédés quand le fichier n'a pas les fautes), hors-jeu, cartons, points de cartons, affluence. Depuis 2000/01 pour l'Angleterre, l'Espagne, l'Allemagne, l'Italie et la France, depuis 2017/18 pour le Portugal et les Pays-Bas. Une statistique absente reste absente, jamais 0 ; une statistique mal saisie par la source (« NA », 145 fautes, 9 cartons rouges : 4 des 294 fichiers) est absente, le match reste ;
- cotes 1X2 : Bet365 et sa clôture, Pinnacle et sa clôture (depuis 2012/13), moyenne et maximum du marché (Oddsportal depuis 2019/20, Betbrain avant). Une cote de 1 ou moins, ou un triplet incomplet, n'est pas une cote. Over/under et handicaps asiatiques ne sont pas lus.

Un fichier est incohérent (`INVALID_SOURCE`, rien n'est écrit) quand une ligne n'a pas de score, a une date hors de sa saison (1ᵉʳ juillet au 31 août de l'année suivante : 2019/20 a fini en août), une autre division que son fichier, ou le même match deux fois.

## Le lien avec les matchs de la base

Les lignes sont dans `core.footballdata_matches` (migration 140), une par ligne de fichier, avec les noms de clubs du fichier. Rien n'est écrit dans `core.matches` ni dans `core.team_match_stats`.

Le seul lien est `match_id`, le match d'archives apparié :

1. par pays et saison, chaque ligne regarde les matchs d'archives du même score à un jour près ;
2. un nom désigne l'équipe qu'on trouve de son côté, parmi ces matchs, dans le plus grand nombre de ses lignes : au moins 3 et au moins la moitié d'entre elles, et plus qu'aucune autre équipe ; une équipe n'est désignée que par un nom, celui qui a le plus de votes. (Des votes fractionnés, 1/n par candidat, ne suffisaient pas : un samedi anglais compte quatre divisions et les coupes, avec beaucoup de scores identiques, et presque rien ne s'appariait en Angleterre.)
3. une ligne s'apparie au seul match d'archives entre ses deux équipes, domicile et extérieur comme écrits, à trois jours près ; deux candidats, ou un match réclamé par deux lignes : pas de lien.

Une archive qui remplace un match efface le lien (`ON DELETE SET NULL`) ; le passage suivant (chaque semaine) apparie de nouveau, sans relire les fichiers.

## Mesure (19 novembre 2026)

Sur les 294 vrais fichiers et les 111 336 matchs d'archives du top 7 de 2000/01 à 2020/21 servis par l'API de production (`/api/read/archive`), avec les fonctions du lecteur (`typed`, `pair`), puis sur une base PostgreSQL 18 jetable sous le rôle de collecte :

- 117 833 lignes typées, aucun fichier refusé ; 97 616 appariées, dont 97 599 au même score et 95 194 au même jour ; chaque lien tombe dans l'édition de championnat de sa division (aucun dans une coupe) ;
- 20 217 lignes sans lien, là où les archives n'ont pas l'édition : Liga 2 2000/01–2011/12, Serie B 2000/01–2012/13, Ligue 2 2000/01–2013/14, divisions 2 à 4 anglaises 2016/17 et 2017/18 ; et quelques trous des archives elles-mêmes : 34 matchs du Sporting en double au Portugal en 2003/04 et 2014/15 (deux candidats, pas de lien), 78 matchs de Championship 2019/20 reportés par le Covid et datés autrement (plus de trois jours) ;
- statistiques de match sur 75 886 lignes, mi-temps sur 117 800, arbitre sur 42 814, cotes Bet365 sur 106 300, Pinnacle (clôture) sur 50 285 ;
- la répétition, dans les conditions de production (0,5 s entre deux fichiers, session coupée après 60 s d'inactivité dans une transaction) : 294 fichiers lus en dehors de toute transaction (`prepare`), puis 117 833 lignes écrites et appariées ; 188 s en tout ; `core.matches` et `core.team_match_stats` inchangés ; un second passage ne lit aucun fichier.

En production, les équipes d'archives sont celles que la passe d'identité a fusionnées dans les clubs PitchAPI : deux orthographes d'un même club y sont une seule équipe, ce qui ne peut qu'aider l'appariement.
