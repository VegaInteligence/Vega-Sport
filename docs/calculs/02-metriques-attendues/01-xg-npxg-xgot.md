# xG, xG hors penalty, xGOT

## Définitions (fournisseur)

| Mesure | Ce qu'elle estime |
| --- | --- |
| **xG** (buts attendus) | Pour un tir, la probabilité qu'il devienne un but au moment de la frappe, d'après des tirs comparables. Pour une équipe ou un joueur, la somme de ces probabilités. |
| **npxG** (xG hors penalty) | Le même total sans les penalties. |
| **xG en jeu ouvert / sur phase arrêtée** | Le xG d'équipe séparé selon l'origine de l'action. |
| **xGOT** (xG cadrés, *expected goals on target*) | La valeur d'un tir cadré après prise en compte de son placement. Un tir non cadré a un xGOT nul ou absent. |

Ces valeurs sont **calculées par PitchAPI** ; Vega ne les modifie pas (voir [Provenance](../01-sources-et-conventions/01-provenance-des-donnees.md)).

## Ce que Vega en fait

### Pour une équipe dans un match
Valeur lue : statistique d'équipe `expected_goals` (et ses variantes). Elle n'est utilisée que si `teamStatsReliable` n'est pas faux.

### Pour une équipe sur une saison
Moyenne par match, sur les matchs où **les deux équipes** ont un xG connu ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L649), `has`) :

$$
\text{xG / match} = \frac{1}{n}\sum_{m \in \text{matchs avec xG}} \text{xG}_m
$$

Même principe pour xG concédés, npxG, xG en jeu ouvert, xG sur CPA, xGOT. Le détail des indicateurs dérivés (xG par tir, finition, qualité de frappe, part des CPA) est dans [Indicateurs d'équipe](../04-clubs/01-indicateurs-club.md).

### Pour un joueur dans un match
Valeur PitchAPI du joueur (`expected_goals`, `expected_goals_non_penalty`, `expected_goals_on_target_variant`). Si le joueur n'a pas tiré (`shots === 0`), le profil de la performance affiche **xG = 0** au lieu d'un vide.

### Pour un joueur sur une saison
- **Total** : somme des xG observés.
- **Par match** : total / nombre de matchs où le xG est observé.
- **Par 90** : `90 × total / minutes des matchs où le xG est observé`.

Détail : [Agrégation d'une saison](../05-joueurs/01-agregation-saison.md).

Sur l'accueil (meneurs de la saison), le xG d'un joueur n'est affiché **que s'il couvre tous ses matchs joués** ; sinon il vaut `null`, pour ne pas fabriquer une fausse surperformance « buts − xG » ([home-insights.js](../../../dashboard/frontend/src/services/home-insights.js#L622)).

### Pour une liste de tirs
- **Carte des tirs d'une saison** ([SeasonShots.jsx](../../../dashboard/frontend/src/components/SeasonShots.jsx#L322)) : xG total = somme des xG connus des tirs filtrés, contre son camp exclus ; la page indique « n / m tirs renseignés » quand certains manquent.
- **Profil de tirs d'un club** ([club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L1206), `shotProfile`) : tirs, xG et buts par situation (jeu placé, contre-attaque, corner, autre CPA, coup franc direct, penalty) ; contre son camp exclus ; un tir sans xG compte pour 0 dans la somme.
- **Taille des bulles** : rayon `0,68 + 0,92 × √xG` (xG borné à [0, 1]) sur la carte de saison.

## Écarts dérivés du xG

| Écart | Formule | Lecture |
| --- | --- | --- |
| Finition d'équipe | moyenne par match de `buts marqués − xG` | > 0 : l'équipe convertit mieux que des tirs comparables |
| Qualité de frappe d'équipe | moyenne par match de `xGOT − xG` | > 0 : les tirs sont mieux placés que la moyenne |
| Gardien d'équipe | moyenne par match de `xGOT concédés − buts encaissés` | > 0 : les arrêts ont évité des buts |
| Efficacité d'un joueur | `buts − xG` sur la saison | utilisé par les listes « Efficaces » et « Maladroits » |

## Exemple

Un club joue trois matchs avec des xG de 1,9 ; 0,7 ; 1,2 et marque 2, 0 et 3 buts.
- xG / match = (1,9 + 0,7 + 1,2) / 3 = **1,27**
- Finition / match = ((2 − 1,9) + (0 − 0,7) + (3 − 1,2)) / 3 = **+0,40**
