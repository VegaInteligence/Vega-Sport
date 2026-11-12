# Audit du classement de puissance (12 novembre 2026) et version 2

Le classement de puissance applique [METHODE_CLASSEMENT_BALLON_D_OR.md](../../METHODE_CLASSEMENT_BALLON_D_OR.md) : un Elo pour les clubs (§ 3), une contribution par match relative au rôle pour les joueurs (§§ 4 à 8). C'est lui que lisent la page « Classement Ballon d'Or » et l'accueil. Cette page dit ce que la version 1 donnait sur la base, pourquoi, et ce que la version 2 change. Tous les chiffres viennent de la base de production, lus les 11 et 12 novembre 2026 ; les essais ont été rejoués hors ligne, sans rien écrire.

Code : [`backend/vega/power.py`](../../../backend/vega/power.py), `METHOD_VERSION = "power-ranking-v2"`. Chaque réglage est une constante nommée, conservée avec chaque calcul dans `agg.power_runs`.

## Ce que donnait la version 1

| Saison | Premiers du classement | Joueurs attendus |
| --- | --- | --- |
| 2026/2027 | 1. Aron Sigurdarson (KR, Islande), 2. Arturo Vidal (Colo Colo), 3. Eldin Jakupović (Chattanooga) | Lamine Yamal 62ᵉ |
| 2025/2026 | 1. Berkan Taz (Verl, 3ᵉ division allemande), 2. Manuel Locatelli, 3. Christos Tzolis, 4. Vitinha | Dembélé 8ᵉ, Yamal 28ᵉ, Kvaratskhelia 43ᵉ, Doué 81ᵉ, Kane 177ᵉ |

Six causes, toutes dans la méthode, ses réglages ou la lecture des données, aucune dans un joueur en particulier.

### 1. Les championnats n'étaient pas sur une échelle commune

Tous les clubs entraient à 1500. Un Elo ne fait que déplacer des points entre les clubs qui se rencontrent : un championnat sans match contre les autres garde 1500 de moyenne, quel que soit son niveau. Moyenne des clubs par championnat, saison 2026 : Premier League 1674, Bundesliga 1611, Serie A 1592, Ligue 1 1573, LaLiga 1572, MLS 1500, 3. Liga 1479, League Two 1431. Le § 3 de la méthode le dit : « des Elo calculés séparément avec la même moyenne ne créent pas automatiquement une échelle commune ».

L'attendu d'un joueur dépend de l'écart entre son club et l'adversaire (Δ). Il corrige donc la domination d'un club dans son championnat, pas le niveau du championnat : la vedette d'un petit championnat et celle de la Ligue des champions étaient jugées sur la même échelle.

### 2. Le rôle se lisait sur l'emplacement seul

Un emplacement est une rangée (ses dizaines) et une place dans la largeur (ses unités). Le même emplacement n'est pas le même rôle partout. Emplacements des titulaires relevés sur la base (saisons 2025 et 2026) :

| Formation | Emplacements | Lecture v1 | Lecture v2 |
| --- | --- | --- | --- |
| 4-3-3 | 103, 105, 107 | trois avants-centres | 103 et 107 ailiers, 105 avant-centre |
| 4-4-2 | 72, 74, 76, 78 | quatre milieux centraux | 72 et 78 ailiers |
| 3-4-3, 3-5-2, 3-4-2-1 | 72/78, 71/79, 62/68 | milieux | pistons (latéral / piston) |
| 4-1-4-1 | 82, 84, 86, 88 | quatre ailiers | 84 et 86 milieux centraux |
| 4-4-1-1 | 95 | avant-centre | milieu offensif (un avant-centre joue au-dessus) |

Kvaratskhelia et Doué, ailiers du 4-3-3 parisien, étaient donc évalués avec les poids et les références d'un avant-centre (finition 45 %). La table `core.formation_slots`, prévue pour décrire les emplacements, est vide : la règle est dans `role_of`.

### 3. Une « saison » mêlait des calendriers différents

L'identifiant de saison 2026 réunit les éditions 2026/2027 et les éditions de l'année civile 2026. Le 11 novembre, les secondes étaient finies (22 à 37 matchs pour les premiers du classement), les premières à leur quatorzième match. Comme le score pèse la contribution cumulée à 75 %, les premiers venaient d'Islande, du Chili, des États-Unis ou de Chine.

### 4. Le score par centiles ne départage pas les rôles

B = 0,75 Pct(T) + 0,25 Pct(R*) atteint son plafond pour les premiers de chaque rôle, et ce plafond, 100 × (n − ½) / n, dépend du nombre de joueurs du rôle : 99,97 pour 1 735 défenseurs centraux, 99,93 pour 720 gardiens (saison 2025). L'ordre entre les meilleurs de chaque rôle suivait la taille des groupes. Le § 9 de la méthode prévient que B mesure une excellence relative au rôle ; le § 12 laisse ouverts le traitement des égalités et la comparaison entre rôles.

### 5. Un zéro omis par le fournisseur était lu comme une valeur inconnue

PitchAPI ne publie jamais un xG, un xA ou une grosse occasion à zéro, et laisse un compte vide aussi souvent qu'il écrit 0. Sur les 259 937 lignes joueur-match de 45 minutes ou plus de la saison 2026 dont les ballons touchés sont connus : xG vide sur 48 % des lignes et jamais à 0, tirs cadrés vides sur 75 %, dribbles sur 23 %, grosses occasions manquées sur 96 %, erreurs menant à un but sur 99 %. La règle « une valeur absente ne vaut pas zéro » écartait alors l'indicateur du match : un avant-centre sans tir n'avait pas de finition ce jour-là, et une grosse occasion manquée n'était comparée qu'à d'autres grosses occasions manquées.

La version 2 rend son zéro à un vide (`restore_zeros`) quand la ligne du joueur porte des statistiques (ses ballons touchés sont connus) et que le fournisseur montre qu'il publie la statistique : dans le même match pour les statistiques courantes, dans la même édition pour les rares. 2 035 205 valeurs sur les 526 627 lignes de l'année 2025/2026.

Le même défaut touche les moyennes par 90 minutes et les centiles des fiches joueur, calculés ailleurs (`seasonMetric`, `buildCohorts`) : il a été corrigé le même jour par la migration 068 (voir « Les fiches joueur » plus bas).

### 6. Des matchs manquaient encore

Le rattrapage de l'historique n'était pas fini : le 12 novembre au matin, 11 des 17 matchs de Ligue des champions 2025/2026 du Paris Saint-Germain avaient leurs statistiques joueurs. Ce point se règle seul avec la collecte.

## Ce que change la version 2

### Une échelle commune pour les clubs

- **Niveau d'entrée par championnat.** Un club entre dans l'Elo au niveau de son championnat (la compétition nationale de sa première saison). Les niveaux sont le point fixe de l'Elo lui-même : on le déroule, on prend la moyenne de chaque championnat, on repart de ces moyennes, jusqu'à ce qu'elles ne bougent plus de 0,5 point (36 passages le 12 novembre).
- **Coupes nationales.** Les matchs des coupes complémentaires entre deux clubs connus des éditions PitchAPI comptent (environ 500 matchs) : ils relient les divisions d'un pays.
- **Prudence sur les petits échantillons.** Un niveau tiré de peu de matchs contre d'autres championnats est retenu vers 1500 : liens / (liens + 30).
- **Échelle commune.** Elle part du championnat le plus relié et accueille, de proche en proche, tout championnat dont les clubs ont joué 10 matchs contre des clubs déjà dessus : 38 championnats sur 72. Les autres (Brésil, Arabie saoudite, MLS, Argentine, Japon…) n'ont aucun match contre eux dans la base : leurs joueurs ont un score, pas de rang parmi les autres.

Niveaux obtenus : Premier League 1772, Bundesliga 1691, Serie A 1646, LaLiga 1642, Ligue 1 1633, Championship 1585, Belgique 1576, … 3. Liga 1426, League Two 1382. Premiers clubs : Arsenal 2051, Bayern 2014, Paris Saint-Germain 1971, Barcelone 1964, Manchester City 1954, Real Madrid 1944.

**Validation.** Sur les 337 matchs européens de clubs de la saison 2026, avec des niveaux ajustés sur les seules saisons précédentes, l'erreur quadratique des probabilités (score de Brier) passe de 0,1727 à 0,1664 sans retenue, 0,1675 avec une retenue de 20 matchs et 0,1683 avec 60 ; sur 11 215 matchs nationaux, de 0,1659 à 0,1645. La retenue coûte un peu de précision et évite qu'un championnat prenne plus de 100 points sur une trentaine de matchs (le championnat croate, 27 matchs contre les autres, passait de 1504 à 1629 sans elle).

### Les joueurs

- **Rôle par formation** (tableau ci-dessus).
- **Année du trophée.** Du 1ᵉʳ août au 31 juillet, quel que soit le calendrier du championnat : un championnat d'année civile donne la seconde moitié d'une édition et la première de la suivante.
- **Éligibilité.** 900 minutes, ou la moitié des minutes du joueur le plus utilisé tant que l'année est jeune (810 minutes le 12 novembre pour 2026/2027).
- **Niveau du club.** La contribution C mesure un joueur contre ce qu'on attend de son rôle dans la situation de son club : elle dit de combien il s'écarte du niveau de son club, pas où se trouve ce niveau. On le rajoute : L = (t / 90) × (Elo du club − moyenne) / 400, et T = Σ (C + κ L).
- **Indice entre rôles.** Le rang est celui de l'indice standardisé Z = 0,75 z(T) + 0,25 z(R*), z pris dans le rôle principal. Le score affiché est 100 / (1 + 10^(−Z / 4)) : 50 pour la moyenne du rôle, la forme du résultat attendu de l'Elo. Les centiles T et R* restent servis.
- **Course au Ballon d'Or.** Les joueurs classés d'un club de première division (le championnat le plus haut de son pays sur l'échelle commune).

### Le poids du niveau du club (κ)

C'est le réglage qui décide de l'influence du club sur le score du joueur. Deux mesures :

- **Les joueurs qui changent de club.** 7 521 joueurs ont les deux années, 1 390 ont changé de club. Leur contribution par 90 minutes baisse de 0,086 (± 0,014) par 400 points d'Elo gagnés par leur club (0,082 ± 0,012 sur tous les joueurs). C'est une borne basse : on ne voit que ceux qui jouent encore assez dans le club plus fort.
- **Le partage de la dispersion.** κ est fixé pour que le niveau du club et la contribution propre aient la même dispersion parmi les joueurs classés (`LEVEL_SHARE = 0,5`) : la moitié de ce qui sépare deux joueurs est le niveau où ils jouent, l'autre ce qu'ils y font. Cela donne κ = 0,60 pour 2025/2026 et 0,68 pour 2026/2027, au-dessus de la borne basse.

Le choix reste un réglage : à κ = 1 le classement suit davantage la hiérarchie des clubs, à κ = 0,25 les vedettes des divisions inférieures remontent.

## Résultat (rejoué hors ligne le 12 novembre 2026)

| Année | Course (clubs de première division) |
| --- | --- |
| 2025/2026 | 1. Vitinha 98,7 · 2. Olise 98,5 · 3. Yamal 97,5 · 4. Kane 97,3 · 5. Mbappé 97,1 · 6. Dembélé 96,8 · 7. Kimmich · 8. Dimarco · 9. Rice · 10. Szoboszlai |
| 2026/2027 (au 12 novembre) | 1. Yamal 94,7 · 2. Mbappé 92,7 · 3. Vitinha 92,1 · 4. Olise 92,0 · 5. Güler 90,6 · 6. Raphinha · 7. Kimmich |

Kvaratskhelia est 51ᵉ et Doué 74ᵉ de la course 2025/2026 (9 233 joueurs classés en tout, divisions inférieures comprises) : leur contribution propre est bonne sans être parmi les toutes premières des ailiers, et le niveau de leur club les porte comme il porte leurs coéquipiers. Le rôle corrigé seul les faisait reculer, de la 40ᵉ à la 347ᵉ place et de la 85ᵉ à la 296ᵉ lors du premier essai (comparés à des avants-centres, leur progression et leur conservation sortaient du lot) ; c'est le niveau du club qui les replace.

## Les fiches joueur (12 novembre, migrations 068 et 069)

Les moyennes par 90 minutes, les centiles et les indices de rôle des fiches lisaient un zéro omis comme une valeur inconnue : une mesure n'est classée que si elle est observée sur tous les matchs joués, et un attaquant resté un match sans tirer n'avait plus de xG « complet ».

- **Un vide vaut zéro là où le fournisseur publie la mesure pour le match** (`agg.match_zeros`, règle et relevé dans [Valeurs absentes](../01-sources-et-conventions/02-valeurs-absentes-et-fiabilite.md)). Les lignes du fournisseur ne changent pas ; les fiches, les listes, l'accueil et les lignes saison rendent le zéro à la lecture.
- **Résultat sur la base**, parmi les 17 741 lignes joueur-édition d'au moins 450 minutes de 2026/2027, mesure observée sur tous les matchs joués, avant → après : xG 519 → 16 915 (3 % → 95 %), tirs 9 011 → 17 741, dribbles 9 033 → 17 566, duels gagnés 12 299 → 17 566, passes dans le dernier tiers 11 616 → 16 785, tirs cadrés 340 → 9 070, npxG 320 → 8 891, xA 2 016 → 8 891, grosses occasions créées 0 → 8 895. Les quatre dernières plafonnent à la moitié : ce sont les éditions qui les publient. Les sommes ne bougent pas (un zéro n'ajoute rien).
- **Sur une fiche** (Lamine Yamal, 2026/2027, onglet « Stats avancées », 135 joueurs à son poste) : xG 9ᵉ sur 30 → 22ᵉ sur 135, tirs 1ᵉʳ sur 30 → 2ᵉ sur 135, tirs cadrés 9ᵉ sur 30 → 18ᵉ sur 135, xGOT « non classé » → 20ᵉ sur 135. Les 30 étaient les seuls joueurs à avoir tiré à chaque match.
- **Le xA est classé** comme les autres mesures, là où il est observé sur tous les matchs.
- **L'« Indice Vega » de la colonne de droite** lit le score du classement de puissance de la saison et le rang du joueur parmi les classés de son rôle (`/api/rankings/power/player`) ; l'ancien calcul (meilleur indice de rôle) reste pour une saison ou un joueur sans score.
- **Une nouvelle version de la méthode** recalcule la saison en cours dans l'heure (`due_seasons`), sans attendre le passage quotidien. Le classement 2026/2027, resté sur la version 1 depuis minuit, est passé en version 2 à 12 h 49 UTC : 1. Lamine Yamal 94,7 ; 2. Kylian Mbappé 92,7 ; 3. Vitinha 92,1 ; 4. Michael Olise 92,0.
- **Lu sur le site après déploiement** (colonne de droite) : Lamine Yamal 2026/2027, 95 et 1ᵉʳ sur 537 à son poste (92 et 4ᵉ sur 68 avec l'ancien indice) ; Khvicha Kvaratskhelia 2025/2026, 89 et 14ᵉ sur 1 814 ; Désiré Doué 2025/2026, 87 et 19ᵉ sur 1 814.

- **Les gardiens** (migration 070). Mesure faite, le fournisseur écrit déjà leurs zéros d'arrêts et de buts encaissés ; il laisse vides le xGOT subi et les buts évités d'un match sans tir cadré. Ces vides valent zéro pour le gardien titulaire (poste 11 de la feuille de match) dont la ligne ne montre ni arrêt ni but encaissé. Détail dans [Valeurs absentes](../01-sources-et-conventions/02-valeurs-absentes-et-fiabilite.md). Après déploiement : parmi les gardiens d'au moins 450 minutes de 2026/2027 dont l'édition publie les buts évités (765), la mesure est observée sur tous les matchs pour 743 contre 580 ; les 22 restants ont un vide à côté d'un arrêt ou d'un but encaissé, ou un match hors du poste 11. Sur le site, les buts évités de David Raya, Gianluigi Donnarumma et Thibaut Courtois étaient « non classés » (moins de 30 gardiens complets parmi les 35 de leur comparaison) ; ils sont 9ᵉ, 30ᵉ et 25ᵉ sur 35. Les totaux ne bougent pas.

Non fait : le classement de puissance garde sa propre restauration (`restore_zeros`), de même idée, sans lire `agg.match_zeros`.

## Version 3 : l'enjeu des matchs (12 novembre 2026)

La méthode laisse l'enjeu hors du modèle « au départ » et appelle un bonus « un choix de récompense à expliciter » (§ 9, annexe A.4). Le choix a été fait le 12 novembre : un match de Ligue des champions pèse plus qu'un match de championnat, une finale de Ligue des champions plus que toute autre finale de clubs, et la finale de la Coupe du monde plus que tout.

**La règle.** Un match compte pour I = prestige de sa compétition × tour.

| Compétition | Prestige | | Tour | Coefficient |
|---|---:|---|---|---:|
| Championnat, coupe nationale | 1,00 | | Match ordinaire, phase de ligue, match pour la 3ᵉ place | 1,00 |
| Ligue Conférence | 1,04 | | Tour à élimination avant les demi-finales | 1,05 |
| Ligue Europa | 1,08 | | Demi-finale | 1,10 |
| Coupe du monde des clubs | 1,10 | | Finale | 1,15 |
| Ligue des champions | 1,15 | | | |
| Euro | 1,20 | | | |
| Coupe du monde | 1,30 | | | |

Les coefficients de tour sont ceux de l'annexe A.4 (le tour qui précède les huitièmes compte comme eux) ; ceux de prestige sont un choix, non un ajustement sur des données. Ils donnent : finale de Ligue des champions 1,32, de Ligue Europa 1,24, de Coupe du monde des clubs 1,27, d'un championnat ou d'une coupe nationale 1,15 ; finale de l'Euro 1,38 ; demi-finale de Coupe du monde 1,43, finale 1,50.

**Où il s'applique.** L'Elo des clubs et celui des sélections bougent de K × I. Le match d'un joueur ajoute I × (C + κ L) à son total, « pénalités comprises » (A.5) : un mauvais match de finale coûte plus cher aussi. Les matchs de la Coupe du monde, que le classement des joueurs ignorait, y entrent donc ; leur niveau L est celui de la sélection parmi les sélections, celui du club parmi les clubs. Un joueur reste classé par son club : les 95 joueurs que la base ne connaît que par leur sélection ont un score et pas de rang.

**Rejoué hors ligne avant mise en service** (base de production, 12 novembre) :
- 3 449 matchs ont un enjeu différent de 1.
- L'Elo ne prédit pas moins bien : erreur quadratique à un match d'avance 0,1659 → 0,1655 sur les 729 matchs européens de clubs des deux saisons, inchangée sur les championnats (0,1643 et 0,1640), 0,1618 → 0,1583 sur les 104 matchs de la Coupe du monde 2026. L'ordre des clubs ne change presque pas (le Real Madrid passe devant Manchester City, 5ᵉ et 6ᵉ), celui des sélections non plus.
- Course 2025/2026, avec les 3 288 matchs-joueurs de la Coupe du monde : Olise 1ᵉʳ (1ᵉʳ), Mbappé 2ᵉ (3ᵉ), Vitinha 3ᵉ (2ᵉ), Dembélé 4ᵉ (7ᵉ), Kane 5ᵉ (4ᵉ), Kimmich 6ᵉ, Yamal 7ᵉ (5ᵉ) ; Pedri 35ᵉ → 22ᵉ, Rodri 96ᵉ → 41ᵉ, Hakimi 84ᵉ → 44ᵉ, Wirtz 81ᵉ → 48ᵉ, Kvaratskhelia 56ᵉ → 53ᵉ, Doué 92ᵉ → 67ᵉ.
- Course 2026/2027 (pas encore de match de sélection) : les treize premiers gardent leur place à une permutation près.

**Limite visible.** Lionel Messi a la plus forte contribution de la Coupe du monde 2026 (+15,4 en 8 matchs) et n'a pas de rang : son club est en MLS, hors de l'échelle commune (8 matchs contre elle pour 10 demandés).

**Vérifié en service** (12 novembre, 16 h 12 UTC, lu dans la base) :
- les enjeux gardés avec chaque match sont ceux du tableau : Ligue des champions 1,15 en phase de ligue, 1,2075 du barrage aux quarts, 1,265 en demi-finale, 1,3225 en finale ; Coupe du monde 1,30, 1,365, 1,43 et 1,495 pour la finale Espagne – Argentine du 19 juillet 2026, le plus fort enjeu de la base ; finale de Ligue Europa 1,242, de Coupe du monde des clubs 1,265 ; demi-finales de barrage d'un championnat 1,10 ;
- le total de chaque joueur est bien la somme, sur ses matchs, de l'enjeu × la contribution (plus grand écart : 0,000006) ;
- course 2025/2026 : Olise 99,4, Mbappé 99,2, Vitinha 99,2, Kane 98,2, Dembélé 98,2, Yamal 97,8 ; 10 507 joueurs classés, dont 698 de clubs brésiliens ; Kvaratskhelia 56ᵉ de l'ensemble, Doué 70ᵉ ; 3 288 matchs-joueurs de Coupe du monde pour 1 039 joueurs ;
- course 2026/2027 : Yamal 95,4, Mbappé 93,4, Olise 92,9, Vitinha 92,7 ; 3 809 classés, dont 225 de clubs brésiliens (Léo Pereira 156ᵉ, sans rang la veille).
- Lionel Messi a le plus haut score de 2025/2026 (99,6) et pas de rang : un score hors de l'échelle commune ne se compare pas aux autres.

## Ce que la version 2 ne fait pas

- **L'enjeu du match** : fait par la version 3, ci-dessus.
- **Les championnats hors de l'échelle commune.** Il faut des matchs entre continents, et la base n'en a presque pas. Les équipes de la Coupe du monde des clubs 2025 ont été reliées à leurs clubs le 12 novembre (30 sur 33 ; Auckland City, l'Espérance de Tunis et le Wydad n'ont pas de club PitchAPI) : leur source écrit le pays après le nom (« Al Hilal (KSA) »), ce que la règle d'identité lit désormais ([identity.py](../../../backend/vega/sources/identity.py)). L'Elo lit ainsi 55 des 64 matchs du tournoi. Rejoué hors ligne avant la fusion, cela déplace peu les clubs (Flamengo 33ᵉ → 30ᵉ, Palmeiras 38ᵉ → 34ᵉ, Fluminense 102ᵉ → 87ᵉ, Botafogo 232ᵉ → 196ᵉ ; Serie A brésilienne 1594 → 1605) et **ne fait entrer aucun championnat sur l'échelle commune** (38 sur 72 avant et après) : il faut 10 matchs contre des clubs de championnats déjà dessus, et le Brésil en a 9, la MLS 5, le Mexique 4, l'Arabie saoudite 3, l'Argentine 3. Le seuil n'a pas été abaissé pour autant : ce serait régler la méthode sur le résultat voulu.
- **Les Coupes du monde des clubs de 2021, 2022 et 2023** (12 novembre). Le même projet libre (OpenFootball, domaine public) publie les éditions annuelles ; celles jouées depuis la première saison de la base (2021/2022) sont lues, chacune dans la saison de son année (février 2022, février 2023, décembre 2023) : 22 matchs, dont Chelsea – Palmeiras et Manchester City – Fluminense. Les éditions plus anciennes sont antérieures à tout l'historique des clubs dans la base et ne sont pas lues. Le Brésil passe ainsi de 9 à 11 matchs contre des championnats de l'échelle : **la Serie A brésilienne, la Serie B et le Paulista la rejoignent (41 championnats sur 72)**. Rejoué hors ligne avant l'import : 225 joueurs de plus sont classés en 2026/2027 et 675 en 2025/2026 ; les trente premiers de la course ne changent que par permutations d'une ou deux places ; le premier joueur d'un club brésilien est 140ᵉ de l'ensemble en 2026/2027 (Léo Pereira, Flamengo) et 168ᵉ en 2025/2026 (José López, Palmeiras). Restent hors de l'échelle, avec leurs matchs contre elle : MLS 8, Arabie saoudite 7, Égypte 6, Équateur 4, Mexique 4, Argentine 3. La Coupe intercontinentale de la FIFA (2024, 2025) n'est dans aucune source libre branchée ; le fichier de ce nom chez OpenFootball est un tournoi de sélections.
- **Le niveau par les transferts.** Les joueurs qui changent de championnat pourraient relier les championnats sans match commun ; non fait.
- **Les compétitions féminines.** Une compétition féminine figure parmi les éditions (8 matchs terminés) ; elle est hors de l'échelle commune, donc hors du classement.
