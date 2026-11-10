# Compatibilité par niveau (onglet Projection)

`levelCompatibility` dans [player-projection.js](../../../dashboard/frontend/src/services/player-projection.js), affiché par [PlayerProjection.jsx](../../../dashboard/frontend/src/components/PlayerProjection.jsx).

Question posée : dans chaque club d'un championnat du Top 7, le joueur serait-il au-dessus, au niveau ou en dessous des titulaires à son poste ?

## Données lues

| Donnée | Lecture |
| --- | --- |
| Championnats proposés | les 7 championnats de `EUROPE_FOCUS` publiés pour la saison (manifeste) |
| Clubs d'un championnat, nom, logo | lecture publiée `clubs` sur ces 7 championnats ; un club appartient au championnat présent dans ses `competitionCounts` |
| Joueurs du même poste | la cohorte de l'onglet (lecture publiée `players`, groupe de poste du joueur, périmètre de compétitions de la page) |
| Club d'un joueur de la cohorte | son dernier club (`latest.teamId`) |

Aucun fichier de démo ni valeur fictive n'entre dans ce calcul.

## Indice comparé

L'**indice Vega** de chaque joueur est son meilleur indice de rôle ([Indices Vega et profils de rôle](03-indices-vega-et-roles.md)), calculé sur **toute la cohorte**, sans le filtre « Clubs de niveau comparable » : le joueur et les effectifs doivent être mesurés contre le même groupe. L'indice affiché dans la colonne d'identité peut donc différer quand ce filtre est actif.

Un joueur sans indice (moins de 450 minutes, ou indicateur non renseigné sur un match) n'est pas compté.

## Niveau d'un effectif

Pour chaque club du championnat choisi (hors club actuel du joueur) :

1. joueurs du club au même groupe de poste, ayant un indice ;
2. **titulaires** = les plus utilisés en minutes, autant qu'une composition type en aligne : gardien 1, défenseurs 4, milieux 3, milieux offensifs et attaquants 3 ;
3. niveau = moyenne des indices des titulaires **pondérée par leurs minutes**.

## Verdict

`écart = indice du joueur − niveau des titulaires`

| Écart | Verdict |
| --- | --- |
| > +5 | Au-dessus du niveau de l'effectif |
| de −5 à +5 | Au niveau de l'effectif |
| < −5 | En dessous du niveau de l'effectif |
| aucun titulaire mesurable | Effectif non mesurable |

La fiche d'un club classe tous ses joueurs du poste par indice et y insère le joueur : « 3e sur 6 au poste » compte les joueurs du club dont l'indice est strictement supérieur.

**Exemple.** Défenseur à 69. Lyon aligne Niakhaté (85, 720 min), Bacher (71, 1 001 min), Athekame (57, 990 min) et Abner (46, 811 min) : niveau = (85×720 + 71×1001 + 57×990 + 46×811) / 3 522 ≈ 64. Écart +5 (valeurs arrondies) : au niveau.

## Échantillon court

Le bandeau « Échantillon encore court » apparaît si le joueur a moins de **900 minutes**, ou si les titulaires d'un club ont moins de 900 minutes en moyenne (logo en pointillé). Quand tous les clubs sont dans ce cas, en début de saison, le bandeau le dit une fois, sans pointillés.

## Limites

- **Pas d'ajustement au niveau du championnat** : un indice se lit de la même façon en Premier League et en Eredivisie. Le niveau des clubs (calibrations de démo sur l'API actuelle, Elo sur la v2 : [Référentiels](../04-clubs/03-referentiels-et-niveau-europeen.md)) n'est pas utilisé ici.
- Le meilleur rôle de chacun est comparé : un milieu créateur et un milieu récupérateur sont jugés chacun sur son point fort.
- Les clubs absents de la cohorte (périmètre de compétitions réduit) apparaissent en « Effectif non mesurable ».
- **Compatibilité athlétique** : non affichée, aucune source de suivi physique n'est branchée.
