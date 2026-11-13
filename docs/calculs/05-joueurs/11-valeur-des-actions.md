# Valeur des actions

Trois mesures du fournisseur des données qui donnent une valeur aux actions d'un joueur au lieu de les compter ([actions.py](../../../backend/vega/actions.py), `/api/players/{id}/actions`). La [méthode du classement](../../METHODE_CLASSEMENT_BALLON_D_OR.md) en décrit le principe (§ 10) et demande de ne pas confondre ces agrégats avec un modèle que l'on entraînerait soi-même : la base ne détient aucune action localisée, elle ne peut donc ni les recalculer ni les vérifier action par action.

## Ce que le fournisseur envoie

Pour chaque joueur de chaque match, sept sommes :

| Mesure | Colonnes | Lecture |
| --- | --- | --- |
| VAEP | total, part offensive, part défensive | ce que ses actions changent aux chances de marquer et d'encaisser (§ 10) |
| Valeur de possession (PV) | total, part offensive, part défensive | la même idée, par un second modèle du fournisseur |
| Menace attendue (xT) | total | le danger des zones où il amène le ballon |

Elles sont mesurées sur toutes les minutes des saisons 2025/2026 et 2026/2027.

## Ce que la fiche montre

Onglet « Stats avancées » de la fiche d'un joueur, carte « Valeur des actions » :

1. **Son championnat seulement.** Les sommes du joueur dans le championnat où il a le plus joué de la saison (ses clubs de ce championnat réunis), rapportées à 90 minutes. Les coupes et les compétitions internationales n'y entrent pas.
2. **Au moins 450 minutes** mesurées dans ce championnat.
3. **Parmi son poste, dans ce championnat.** Le rang et le centile de chaque total parmi les joueurs du même rôle (celui du classement de puissance) du même championnat, quand ils sont **au moins 20**. En dessous, la carte donne les valeurs sans rang. Le centile est le rang moyen : (joueurs en dessous + la moitié des ex æquo) / joueurs.
4. **Pas de gardiens.**

Les parts offensive et défensive se lisent à côté de leur total ; elles n'ont pas de rang.

## Pourquoi parmi son championnat

Ces valeurs ne sont pas corrigées du niveau des championnats. Parmi les titulaires de 2025/2026 à 1 800 minutes ou plus, les dix meilleures VAEP par 90 minutes mêlent Ousmane Dembélé (0,60), Michael Olise (0,56), Kylian Mbappé (0,54) et Harry Kane (0,53) à Jens Petter Hauge (0,62), Dominik Schwizer (0,58), Iñigo Vicente (0,57) ou Aleksandar Katai (0,56) : la même valeur ne dit pas la même chose d'un championnat à l'autre. Le classement, lui, corrige chaque match du niveau de l'adversaire ; appliquer sa correction à des sommes dont on ne connaît pas le calcul serait une invention. Un joueur est donc situé parmi ceux qui ont joué les mêmes adversaires que lui.

## Pourquoi le classement ne les utilise pas

Mesuré sur les 10 963 titulaires de 2025/2026 (classés, championnat sur l'échelle commune, 450 minutes mesurées) :

| | VAEP | PV | xT | Rendement du classement |
| --- | --- | --- | --- | --- |
| Même joueur, 2025/2026 puis 2026/2027 (corrélation) | 0,29 | 0,26 | 0,66 | 0,70 |
| Accord avec le rendement du classement, par rôle (hors gardiens) | 0,36 à 0,53 | 0,25 à 0,47 | 0,31 à 0,59 | |
| Le même accord chez les gardiens | 0,06 | −0,11 | −0,03 | |
| Somme des joueurs d'un club par match, contre son Elo (812 clubs) | 0,56 | 0,52 | | |

- **Stabilité.** D'une saison à la suivante (12 263 joueurs à 450 minutes dans chacune), la VAEP et la PV d'un joueur changent beaucoup plus que son rendement au classement (0,29 et 0,26 contre 0,70). Une mesure qui se retrouve si peu d'une année sur l'autre porte plus de circonstances que de niveau ; fonder le classement dessus le rendrait plus instable qu'il ne l'est. L'xT se retrouve presque aussi bien (0,66), mais il ne mesure que la progression du ballon : le classement la compte déjà dans son bloc « progression ».
- **Accord partiel.** Dans un même rôle, ces valeurs et le rendement du classement vont dans le même sens sans se recouvrir : elles disent autre chose, d'où leur place en lecture complémentaire.
- **Gardiens.** Aucun accord avec le rendement du classement, alors que leur VAEP moyenne par 90 minutes (0,157) est la plus haute de tous les rôles, devant les ailiers (0,156) : ce que ces sommes mesurent chez un gardien n'est pas ce que la fiche présenterait. Ils n'ont pas de carte.
- **Double compte.** Le § 10 de la méthode le rappelle : ajouter ces valeurs à des buts, des passes décisives ou des arrêts déjà évalués compterait deux fois la même chose.

Moyennes par 90 minutes selon le rôle (mêmes titulaires), qui montrent pourquoi un joueur n'est comparé qu'à son poste :

| Rôle | Joueurs | xT | VAEP | dont offensive | dont défensive | PV |
| --- | --- | --- | --- | --- | --- | --- |
| Défenseur central | 2 368 | 0,062 | 0,078 | 0,115 | −0,038 | 0,076 |
| Ailier / milieu offensif | 2 193 | 0,109 | 0,156 | 0,178 | −0,021 | 0,179 |
| Latéral / piston | 2 065 | 0,110 | 0,113 | 0,155 | −0,041 | 0,127 |
| Avant-centre | 1 329 | 0,030 | 0,056 | 0,079 | −0,023 | 0,095 |
| Milieu central | 1 217 | 0,067 | 0,115 | 0,132 | −0,018 | 0,120 |
| Milieu défensif | 1 073 | 0,061 | 0,113 | 0,128 | −0,015 | 0,113 |
| Gardien | 868 | 0,030 | 0,157 | 0,104 | 0,053 | 0,097 |

## Calcul

Une requête par saison, après le classement (qui donne le rôle de chaque joueur) : `agg.player_action_values` et `agg.action_value_runs`. Une saison déjà classée qui n'a pas encore de lecture la reçoit par cette seule requête, sans que ses modèles soient recalculés.
