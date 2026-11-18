# Classements officiels et identités de clubs

## Le classement des meilleurs troisièmes peut disparaître

Le widget SportScore du Mondial 2026 observé le 18 novembre à 07 h 56 UTC contient 60 lignes et 13 tableaux pour 48 équipes. RDS présente la même composition à 07 h 57. La comparaison avec les 104 rencontres de la FIFA concorde sur les dates, les côtés et les scores.

Sur PostgreSQL 18 local, le writer du candidat VI-29 reçoit d’abord cette réponse complète. Il reçoit ensuite les mêmes octets à l’exception des 3 988 octets du tableau des meilleurs troisièmes. Toutes les équipes figurent encore dans leurs douze groupes. Le worker accepte la réponse et retire les douze lignes transversales. Le GET sert alors 48 lignes et douze tableaux. Représenter la réponse complète rétablit 60 lignes et treize tableaux. Les réponses conditionnelles HTTP suivent chaque changement. Cette perte a été reproduite sur une réponse volontairement tronquée. Le flux de production examiné fournissait le tableau complet.

Le classement de secours Vega inclut une petite finale que le tour natif classe en phase régulière. Le 18 juillet, la France a perdu 4–6 contre l’Angleterre dans le match FIFA 103, identifiant 400021542, correspondant au match Vega 69466. En excluant uniquement ce match du calcul des groupes sur la copie, les 48 équipes retrouvent leurs trois rencontres. Le total passe de 146 côtés à 144 et sept rangs du tableau global changent. L’Angleterre, à 10 points en tête dans le secours observé, passe huitième avec 7 points. La France conserve ses 9 points et passe troisième à première. VI-29 conserve la qualification des tableaux et VI-21 la classification des tours et la republication des agrégats. [Résultats du rejeu](controles/sources-et-identites-18nov/classements-mondial-resultats.json) · [48 équipes](controles/sources-et-identites-18nov/classements-mondial-48-equipes.csv) · [104 rencontres FIFA–RDS](controles/sources-et-identites-18nov/classements-mondial-104-matchs.csv)

## Priorité des fournisseurs

Les 1 086 lignes officielles des 60 éditions observées dans RDS proviennent de SportScore. Aucune clé édition–phase–groupe–équipe ne réunit actuellement plusieurs sources. La branche permet néanmoins à une ligne complémentaire plus récente de se substituer au club dans la réponse publique en fonction de l’horodatage seul. Une ligne secondaire périmée provoque le repli de toute l’édition sur Vega. Ces deux comportements ont été reproduits sur une base locale avec le vrai GET et le writer du candidat. Les observations d’un deuxième fournisseur ont été introduites uniquement dans ce test. VI-29 porte le choix de l’autorité et la conservation des tableaux qualifiés. [SQL de production](controles/sources-et-identites-18nov/classements-sources-sql.py) · [Réponses HTTP et lignes stockées](controles/sources-et-identites-18nov/classements-multisource.json)

Le ZIP contient le writer du candidat, le lecteur HTTP, les migrations et les entrées des deux parcours. Après extraction, exécuter `python3 -I run.py --verify-only` pour contrôler les 393 fichiers, puis `python3 -I run.py --pg-bin /chemin/vers/postgresql-18/bin --out ../resultats` avec un dossier de résultats neuf. Le reçu conserve les cinq observations multi-source, les sept réponses du Mondial et les trois critères en échec. [Rejeu PostgreSQL 18](controles/sources-et-identites-18nov/classements-pg18.zip) · [SHA-256](controles/sources-et-identites-18nov/classements-pg18.zip.sha256) · [Reçu après extraction](controles/sources-et-identites-18nov/classements-pg18-recu.json)

## Postes manquants et identités des joueurs

Sur les 2 914 participations des 131 joueurs examinés, le moteur laisse 615 clés sans rôle, sur 587 matchs et 69 éditions. Pour 150 participations, le seul poste détaillé connu dans une autre année est postérieur au match. Un poste apparaît uniquement avant le match pour 15 clés, de part et d’autre pour 9, et dans aucune autre année admissible pour 441. Ces observations ont été recueillies en 2026. Leur disponibilité au jour du match reste inconnue.

À Lorient, les huit feuilles LFP contrôlées désignent Siriné Doucouré (Opta 511296, Vega 18586) pour les minutes et les touches attribuées à Henri (Vega 5978). Ces huit matchs comprennent les cinq déjà signalés. Au match 126697, la ligne statistique doit être rattachée au joueur déjà présent dans la composition. À Seongnam, la K League documente deux joueurs du même nom et de la même année de naissance. Les contrôles portent sur 18 participations. Les deux identifiants Vega 45927 et 62771 ont chacun une ligne statistique positive sur quatre mêmes matchs. L’absence de seconde ligne statistique sur les quatorze autres ne prouve aucune identité commune. Le recensement par nom et côté laisse 313 participations candidates à vérifier individuellement. Ces ensembles peuvent se recouper. VI-21 conserve la correction des liaisons et la qualification des entrées de notation.

Après extraction, exécuter `python3 -I -B verify.py`. Les options `--match 126697` et `--joueur 45927` montrent les décisions et leurs témoins. Les huit feuilles LFP sont documentées par leurs projections du côté lorientais, leurs URL et leurs empreintes. Le paquet conserve également les fragments nécessaires au contrôle K League. Les réponses intégrales sont dans la preuve opérateur. [Rejeu des 615 participations](controles/sources-et-identites-18nov/postes-615-20261118.zip) · [SHA-256](controles/sources-et-identites-18nov/postes-615-20261118.zip.sha256) · [Reçu après extraction](controles/sources-et-identites-18nov/postes-615-recu.json)

## Écussons de cinq clubs français

Les sources de club et les feuilles officielles qualifient l’écusson de profil des cinq fiches historiques de Marseille, Nice, Lille, Rennes et Auxerre. Les 14 rencontres retenues ont été comparées par date, score et ordre des deux équipes. Les autres identifiants de club sont conservés. Pour Lyon, la racine 6128 comprend 34 matchs de 1945 avant la fondation de l’OL en 1950. L’identité de ces lignes doit être résolue avant de poser un blason sur cette fiche. Le chargeur local a vérifié les cinq fichiers authentiques. Une première répétition cumulative utilisant un ancien export n’a pas retrouvé la clé de Vicenza. Les deux répétitions avec la capture RDS suivante, sur laquelle cette clé existe, ont réussi. [Correspondances avec les rencontres originales](controles/sources-et-identites-18nov/clubs-france-temoins.csv) · [34 matchs de Lyon](controles/sources-et-identites-18nov/lyon-34-matchs.csv) · [Rejeu cumulatif](controles/visuels-actuels-rejeu.json)

## Sept profils de clubs de Bundesliga

Les 68 calendriers d’équipes de la DFB couvrent les 1 092 matchs des quatre éditions de 1963/64 à 1966/67. Chaque rencontre apparaît sur les calendriers des deux adversaires, soit 2 184 occurrences. Les 1 192 lignes locales comptent 100 lignes supplémentaires. Tous les scores correspondent. Les 18 lignes dont la date diffère sont exclues des témoins exacts.

Les calendriers et les archives des clubs rattachent six emblèmes actuels à des fiches de profil. Le dessin porté lors de ces saisons reste indéterminé. Pour SC Tasmania, la DFB associe au calendrier historique le drapeau du SC. Le club successeur documente la rupture de 1973 et distingue son propre emblème. [Calendrier DFB de Tasmania](https://datencenter.dfb.de/competitions/bundesliga/seasons/1965-1966/teams/sv-tasmania-berlin) · [Histoire publiée par le SV](https://www.sv-tasmania-berlin.de/verein/geschichte/)

| Fiche Vega | Club | Matchs DFB distincts au jour exact sur cette fiche | Visuel qualifié |
| ---: | --- | ---: | --- |
| 4121 | Preußen Münster | 30 | Emblème actuel de profil |
| 4122 | TSV 1860 München | 125 | Ovale FA 1860 actuel |
| 4201 | Borussia Mönchengladbach | 67 | Emblème actuel de profil |
| 6731 | Frankfurter SG Eintracht | 6 | Emblème actuel du club, six matchs contre Meiderich/MSV |
| 6736 | Meidericher SV | 99 | Emblème actuel du MSV Duisburg, renommage documenté en 1967 |
| 6814 | VfB Borussia Neunkirchen | 61 | Emblème actuel de profil |
| 6884 | SC Tasmania 1900 Berlin | 34 | Drapeau historique du SC |

Le chargeur a lu sept entrées et sept images distinctes hors ligne. Les décisions de fusion, de correction de date ou de clé relèvent de VI-21. Le paquet de provenance contient les 1 092 lignes DFB avec les identifiants des rencontres, les témoins par fiche, les URL et empreintes des pièces primaires, le manifeste des profils et le ZIP des sept images. Son reçu relie chaque membre à l’archive opérateur complète. [Provenance des sept clubs](controles/sources-et-identites-18nov/clubs-dfb-provenance.zip) · [Empreintes et reçu opérateur](controles/sources-et-identites-18nov/clubs-dfb-provenance-recu.json)

## Versions contrôlées

Le 18 novembre à 07 h 45 UTC, le worker AWS servait `8018e0836c` et le domaine public Vercel `17ca0f7617`. Les huit tickets clos et les huit tickets actifs ont été relus. [Reçu AWS](controles/sources-et-identites-18nov/backend-actif.json) · [Alias Vercel](controles/sources-et-identites-18nov/frontend-actif.json) · [État Linear](controles/sources-et-identites-18nov/linear-actif.json)
