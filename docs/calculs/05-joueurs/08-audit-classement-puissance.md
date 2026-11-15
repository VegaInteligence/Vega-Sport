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
- **L'« Indice Vega » de la colonne de droite** lit le score du classement de puissance de la saison et le rang du joueur parmi les classés de son rôle (`/api/rankings/power/player`) ; l'ancien calcul (meilleur indice de rôle) reste pour une saison ou un joueur sans score. Sous l'indice, une ligne donne ses deux parts, en points du classement de la saison : ce que le joueur produit (`ownContribution`, la somme de ses contributions de match) et ce qu'ajoute le niveau de son club (`clubLevel`).
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
- **Les championnats hors de l'échelle commune** (réglé par la version 4, plus bas). Il faut des matchs entre continents, et la base n'en a presque pas. Les équipes de la Coupe du monde des clubs 2025 ont été reliées à leurs clubs le 12 novembre (30 sur 33 ; Auckland City, l'Espérance de Tunis et le Wydad n'ont pas de club PitchAPI) : leur source écrit le pays après le nom (« Al Hilal (KSA) »), ce que la règle d'identité lit désormais ([identity.py](../../../backend/vega/sources/identity.py)). L'Elo lit ainsi 55 des 64 matchs du tournoi. Rejoué hors ligne avant la fusion, cela déplace peu les clubs (Flamengo 33ᵉ → 30ᵉ, Palmeiras 38ᵉ → 34ᵉ, Fluminense 102ᵉ → 87ᵉ, Botafogo 232ᵉ → 196ᵉ ; Serie A brésilienne 1594 → 1605) et **ne fait entrer aucun championnat sur l'échelle commune** (38 sur 72 avant et après) : il faut 10 matchs contre des clubs de championnats déjà dessus, et le Brésil en a 9, la MLS 5, le Mexique 4, l'Arabie saoudite 3, l'Argentine 3. Le seuil n'a pas été abaissé pour autant : ce serait régler la méthode sur le résultat voulu.
- **Les Coupes du monde des clubs de 2021, 2022 et 2023** (12 novembre). Le même projet libre (OpenFootball, domaine public) publie les éditions annuelles ; celles jouées depuis la première saison de la base (2021/2022) sont lues, chacune dans la saison de son année (février 2022, février 2023, décembre 2023) : 22 matchs, dont Chelsea – Palmeiras et Manchester City – Fluminense. Les éditions plus anciennes sont antérieures à tout l'historique des clubs dans la base et ne sont pas lues. Le Brésil passe ainsi de 9 à 11 matchs contre des championnats de l'échelle : **la Serie A brésilienne, la Serie B et le Paulista la rejoignent (41 championnats sur 72)**. Rejoué hors ligne avant l'import : 225 joueurs de plus sont classés en 2026/2027 et 675 en 2025/2026 ; les trente premiers de la course ne changent que par permutations d'une ou deux places ; le premier joueur d'un club brésilien est 140ᵉ de l'ensemble en 2026/2027 (Léo Pereira, Flamengo) et 168ᵉ en 2025/2026 (José López, Palmeiras). Restent hors de l'échelle, avec leurs matchs contre elle : MLS 8, Arabie saoudite 7, Égypte 6, Équateur 4, Mexique 4, Argentine 3. La Coupe intercontinentale de la FIFA (2024, 2025) n'est dans aucune source libre branchée ; le fichier de ce nom chez OpenFootball est un tournoi de sélections.
- **Les coupes continentales des autres confédérations** (14 novembre 2026), lues mais tenues hors des forces des clubs jusqu'à la version 4, qui les y fait entrer. Copa Libertadores et Sudamericana (2021 à 2026), Coupe des champions de la CONCACAF (2021 à 2025) et Ligue des champions de la CAF (2023/2024 et 2024/2025), d'OpenFootball (domaine public) : 2 067 matchs joués, dont 1 402 entre deux clubs que PitchAPI connaît (orthographes relues club par club, `WORLD_CLUB_SPELLINGS`) et 1 180 entre deux championnats (129 Argentine – Brésil, 53 Liga MX – MLS). Rejouées avec eux, sur la base du 14 novembre : le niveau du Brésil passe de 1607 à 1654 (3e, devant la Liga), celui de l'Argentine de 1500 à 1598 (7e) et huit championnats sud-américains rejoignent l'échelle commune ; la MLS et la Liga MX n'y entrent pas (elles ne sont reliées qu'entre elles), l'Égypte et l'Afrique du Sud non plus (8 matchs). Le défaut est dans la méthode : le poids d'un niveau compte les matchs entre championnats, si bien que tout un continent relié au reste par les 11 matchs de la Coupe du monde des clubs paraît bien mesuré. Ces coupes sont donc lues et montrées (page « Coupes ») mais tenues hors de l'Elo (`ELO_APART` dans `power.py`) jusqu'à ce que le poids compte les matchs entre confédérations. Leur enjeu est fixé pour ce jour-là : la première compétition de clubs d'une confédération comme la Ligue des champions (1,15), la seconde comme la Ligue Europa (1,08).
- **Les tournois de sélections des autres confédérations** (14 novembre 2026) entrent dans l'Elo des sélections : Coupes d'Afrique des nations 2021, 2023 et 2025, Copa América 2024, Coupe d'Asie 2023, Gold Cup 2023 et 2025, d'International Results (domaine public), avec le terrain neutre que la source indique ; enjeu de l'Euro (1,20). Seuls comptent les matchs entre deux sélections que PitchAPI connaît (celles des Coupes du monde).
- **Le niveau par les transferts : mesuré le 14 novembre 2026, pas encore dans la méthode.** Un joueur qui change de championnat est le même joueur : si son rendement baisse, son nouveau championnat est plus difficile. Mesure, en lecture seule sur la base de production : les séjours d'un joueur de champ d'au moins 600 minutes dans un championnat sur une année du trophée (2024 à 2026 : 46 811 séjours), le rendement par 90 minutes de chacun (la contribution C du classement, qui ne dépend pas du niveau du championnat : elle se compare à l'attendu de son rôle selon l'écart entre son équipe et l'adversaire) diminué de la moyenne de son championnat cette saison-là (le style d'un championnat, plus ou moins ouvert, s'annule), puis les 4 360 passages d'un championnat à un autre. Les niveaux qui expliquent le mieux ces changements, par moindres carrés, l'English Championship en référence, convertis en points Elo par la pente mesurée sur 58 paires de championnats (−0,054 de rendement par 100 points d'écart) :

| Championnat | Passages | Transferts, Elo vs Championship | Échelle actuelle | Écart |
| --- | ---: | ---: | ---: | ---: |
| Premier League | 264 | +176 ± 28 | +189 | −12 |
| LaLiga | 226 | +141 ± 35 | +59 | +82 |
| Bundesliga | 240 | +93 ± 33 | +103 | −10 |
| Serie A (Italie) | 244 | +69 ± 34 | +57 | +12 |
| Ligue 1 | 246 | +66 ± 33 | +48 | +18 |
| Saudi Pro League (hors échelle) | 187 | +27 ± 38 | −21 | +48 |
| Serie A (Brésil) | 294 | +18 ± 39 | +19 | 0 |
| Liga Portugal | 200 | −47 ± 35 | −62 | +15 |
| First Division A (Belgique) | 232 | −53 ± 34 | −12 | −41 |
| MLS (hors échelle) | 253 | −76 ± 33 | −89 | +13 |
| Eredivisie | 245 | −94 ± 35 | −39 | −55 |
| Liga MX (hors échelle) | 105 | −105 ± 46 | −90 | −15 |
| Liga Profesional (Argentine, hors échelle) | 189 | −139 ± 42 | −88 | −51 |
| Allsvenskan | 109 | −218 ± 44 | −110 | −109 |
| Veikkausliiga | 35 | −592 ± 70 | −106 | −486 |

  Lecture : les championnats bien reliés par les matchs retrouvent leur place à 20 points près, sauf LaLiga, que les transferts placent plus haut ; le Brésil est exactement où l'échelle le met, devant le Portugal, la Belgique et les Pays-Bas ; les championnats hors de l'échelle reçoivent un niveau de leurs transferts (la MLS vers 1500, la Saudi Pro League au niveau du Brésil) ; les petits championnats, retenus vers 1500 par l'échelle faute de matchs contre les autres, sont nettement plus faibles. Sans la soustraction du style, la même mesure plaçait la Bundesliga et la Ligue 1 sous le Championship : le rendement par 90 minutes dépend aussi de l'ouverture du jeu. Non contrôlés : l'âge et la période d'adaptation ; la pente est mesurée sur l'échelle elle-même. Combiné aux matchs partout, selon la précision de chaque preuve, par la version 4 (plus bas), après correction de la sélection des joueurs qui partent.
- **Les compétitions féminines.** Une compétition féminine figure parmi les éditions (8 matchs terminés). Depuis la version 4, c'est un univers à part : ses joueuses ont un score calculé entre elles, sans rang parmi les autres.

## Version 4 : un niveau pour chaque championnat (15 novembre 2026)

Tous les championnats, clubs et joueurs ont désormais une note sur la même échelle. Conseil pris auprès d'un second modèle. Sa relecture du code a trouvé deux erreurs avant la mise en service : les compétitions européennes comptées comme des championnats dans les passages, et les équipes fusionnées encore listées par leur nom. Toutes deux sont corrigées, et les mesures ci-dessous refaites après correction.

**Ce qui n'allait pas.** La version 3 retenait le niveau d'un championnat vers 1500 dans la proportion liens / (liens + 30), « liens » comptant ses matchs contre tous les autres championnats. Deux défauts :
- cette retenue n'est pas un a priori cohérent : à l'équilibre, elle revient à un a priori dont la force baisse quand les liens augmentent, et 1500 est arbitraire ;
- compter les matchs ne dit pas si le niveau est mesuré. Un groupe de championnats qui ne jouent qu'entre eux (l'Amérique du Sud avec ses coupes, l'Arabie saoudite et sa deuxième division) paraît bien mesuré alors que sa place par rapport aux autres ne l'est pas. C'est ce qui faisait bondir l'Argentine de 98 points avec les coupes continentales, et ce qui laissait 31 championnats sans niveau.

**Le modèle** ([`power.py`](../../../backend/vega/power.py), « League levels (version 4) »). Le niveau ℓ de chaque championnat est le maximum a posteriori d'un seul modèle, qui réunit trois preuves :
- **Les matchs entre championnats.** Avec l'Elo relancé depuis les niveaux, un match apporte le score I_m (r − E)·c et l'information I_m E(1 − E)·c² sur les deux championnats (c = ln 10 / 400), divisés par la dispersion des résultats (φ = 0,73 ; les nuls la font passer sous 1).
- **Les joueurs qui changent de championnat.** On ne lit que ses matchs de championnat : un séjour en coupe d'Europe ou en sélection ne s'intercale jamais entre deux années. Son rendement par 90 minutes est pris par rapport à la moyenne de son championnat cette saison-là. On en retire ce qu'en garde n'importe quel joueur d'une année sur l'autre, mesuré sur ceux qui sont restés (c' = α + 0,63 c sur 9 599 joueurs restés des années 2024 et 2025). Ce qui reste vaut −κ\* (ℓ_b − ℓ_a) / 400 par passage (3 120 passages), avec la variance d'un passage et l'écart propre à une paire (τ_u = 0,09).
- **Un a priori, sous forme d'écarts plutôt que d'un retour à 1500.** Une deuxième division se tient sous la première de son pays d'un écart de division b (162 points, écart-type 49, mesuré sur 11 paires). Une première division se tient à la moyenne de sa confédération si au moins trois de ses championnats sont mesurés : UEFA 1492, CONMEBOL 1499, CONCACAF 1482, AFC 1439 ; la CAF prend la moyenne d'ensemble. L'écart-type entre championnats européens est de 111.

Tous ces réglages sont mesurés à chaque calcul sur les championnats que les seuls matchs et passages mesurent, à l'exception de κ\*. Les divisions de chaque championnat ont été relues une par une (`TIERS`) ; le Paulista A1, championnat d'État joué par des clubs de Serie A et de Serie B, est classé en deuxième division. Un championnat sans aucune preuve reçoit son a priori, et son erreur-type le dit. Un calcul qui ne converge pas en 40 pas échoue et laisse les niveaux d'avant.

**Mesuré.** Un championnat est **mesuré** (`linked`, ses joueurs classés) quand son erreur-type est d'au plus 45 points ; il le reste jusqu'à 52, pour qu'aucun championnat n'entre et ne sorte du classement à chaque calcul.

Pourquoi 45 : à ce seuil, une erreur sur le niveau déplace l'indice d'un joueur d'au plus un quart d'écart-type de son rôle. Le calcul est e / (√2 σ), σ = 132 étant l'écart-type des forces des clubs sur les matchs de championnat de 2026/2027 ; à 60 points, ce serait 0,32.

Les autres championnats ont un niveau marqué « provisoire » sur le site, avec sa marge, et leurs joueurs un score sans rang.

**Les coupes des autres confédérations** entrent dans l'Elo (`ELO_APART` supprimé). Les clubs de ces coupes sont reliés à ceux de PitchAPI par la passe d'identité, qui tourne avant l'Elo dans le même passage quotidien.

**Les équipes fusionnées.** Une équipe fusionnée reste comme pointeur vers celle qu'elle est (`core.teams.merged_into`, 094) : la supprimer faisait relire 40 millions de lignes par équipe, et une série de cent équipes a tourné cinq heures le 14 novembre. Les listes par nom (recherche, liens FIFA, SportsAPI, UEFA, alias) laissent ces lignes de côté.

**κ\*, le taux d'échange entre rendement et niveau.** Mesuré par profil de la vraisemblance du modèle complet : 0,131 ± 0,006 (erreur statistique), gardé à 0,132.
- La pente naïve des passages (0,22) était gonflée par la sélection : un joueur part après une bonne saison, et sa saison suivante redescend en partie.
- Mesurée seulement sur les paires de championnats que les matchs mesurent à 25 points près, elle donne 0,167. Les passages d'un même pays (montées, descentes, prêts) donnent 0,17 ; ceux entre deux pays 0,08 ± 0,03. L'écart peut venir de l'erreur sur les petits écarts entre pays, ou de ce que les clubs recrutent à l'étranger des joueurs meilleurs que leurs statistiques. Il faut donc lire κ\* entre 0,13 et 0,17.
- À 0,17, aucun championnat mesuré ne bouge de plus de 0,44 de son erreur (médiane 0,15). Les plus grands déplacements sont des championnats non mesurés : Islande −49, J3 League +23.

**Validations, en lecture seule** sur une copie de la base du 14 novembre où les fusions d'équipes en attente sont appliquées comme le fera la passe d'identité. Les deux méthodes lisent les coupes des autres confédérations.

| Épreuve | Version 3 | Version 4 | Critère |
| --- | ---: | ---: | --- |
| Prédire les 5 004 matchs entre championnats joués après le 1ᵉʳ août 2025, niveaux calculés avant cette date (log-loss) | 0,6517 | 0,6466 | plus bas |
| La même épreuve, championnats de moins de 100 liens (1 794 matchs) | 0,6542 | 0,6395 | plus bas |
| Championnats dont le résultat après le 1ᵉʳ août reste à ±2 écarts-types de l'attendu | 73 % de 49 | 94 % de 49 | ≥ 90 % |
| Prédire les 1 282 passages de 2026/2027 (pente observé / prédit) | 1,30 ± 0,19 | 1,11 ± 0,12 | entre 0,85 et 1,15 |
| Matchs seuls contre transferts seuls, 31 championnats que les deux mesurent (rms des écarts réduits) | — | 1,03 | ≤ 1,3 |
| Ajouter les coupes continentales : déplacement du Brésil | — | −25 (erreur-type 42) | < 1 erreur-type |
| Ajouter les coupes continentales : déplacement des championnats européens | — | ≤ 2 points | ≤ 5 points |

Hors de ±2 sur l'épreuve des matchs : Israël (−2,8), le Venezuela (+2,3) et le Danemark (+2,1) ; la version 3 manquait déjà Israël et le Danemark (−3,1 et +3,5).

L'Argentine et la Liga MX montent avec les coupes de leur confédération (+124 et +113 points). Ce n'est pas un retard des clubs qui entrent au niveau de leur championnat. Leur surplus dans ces coupes, Σ(r − E) par saison, reste faible chaque année (|z| ≤ 1,3) et n'est pas plus fort au début.

**Ce que cela change** (base du 14 novembre, coupes continentales comprises ; erreur-type contre les onze championnats qui tiennent l'échelle) :
- les cinq grands championnats et le Championship restent à quelques points de leur niveau d'avant ;
- les petits championnats, que la version 3 retenait vers 1500, descendent : Finlande, Suède, Slovaquie, Suisse et Danemark perdent entre 90 et 300 points ;
- les 31 championnats hors de l'échelle reçoivent un niveau (Argentine, Liga MX, MLS, Équateur, Japon, Chine…) ;
- 47 championnats d'hommes sur 71 sont mesurés, soit environ 77 % des séjours de 900 minutes en championnat de 2026/2027 (58 % des éligibles étaient classés avant). Saudi Pro League (± 51) et Russie (± 55) restent provisoires.

**En service** (15 novembre, 1 h 25 UTC, lu dans la base) :
- 259 équipes des sources de coupes fusionnées en pointeurs ; 100 des 119 clubs de la Copa Libertadores sont désormais ceux de leur championnat (5 la veille) ;
- le calcul des niveaux converge en 7 pas : écart de division 162 ± 49, écart-type entre premières divisions 112, φ = 0,73 ; 3 410 passages lus (années 2024 et 2025) ;
- 48 championnats d'hommes mesurés : les 47 du seuil, plus la Slovaquie (± 51), gardée par la marge de 52 points puisqu'elle était sur l'échelle la veille. Argentine 1596 ± 32, Liga MX 1575 ± 42 et MLS 1520 ± 39 sont mesurées ; Saudi Pro League 1567 ± 51 reste provisoire ;
- classement 2026/2027 : 5 115 joueurs classés sur 6 601 éligibles (77 %, contre 3 859 la veille), κ = 0,651. La course commence par Yamal, Mbappé, Olise, Vitinha et Güler ; Antoine Griezmann (Orlando City, 16ᵉ) et Carles Gil (New England Revolution, 25ᵉ) y entrent, la MLS étant mesurée.

**Suite, 15 novembre au matin** (lu dans la base à 9 h 10 UTC) :
- **tous les classements de joueurs suivent la version 4.** Les 157 saisons publiées vont de 1871 à 2027. Les 153 qui suivaient une méthode plus ancienne n'avaient aucune statistique de joueur ; une saison qu'aucune règle quotidienne ne reprend est reclassée seule (`power.stale_rankings`) ;
- **la deuxième division turque (TFF 1. Lig).** PitchAPI lui donne le pays « INT », si bien que ses matchs passaient pour internationaux : ses 20 clubs n'avaient ni championnat, ni niveau, ni tableau. Le pays relu est désormais écrit à la collecte (`store.COMPETITION_COUNTRIES`, migration 097). Elle est mesurée à 1473 ± 26, sous la Süper Lig, et 49 championnats sont mesurés ;
- **les clubs que la base ne connaît que par les coupes d'Europe** (Ferencváros, Shakhtar Donetsk, Pafos, Levski Sofia, Kairat Almaty…) entraient à 1500. Chacun prend le pays du club UEFA de son nom quand un seul le porte, mots de forme du club mis à part (« FC », « NK »…). Le championnat de son pays devient un championnat du modèle : ajusté sur ses matchs avec l'a priori de sa confédération, il est tenu hors des réglages de l'a priori (seuls les meilleurs clubs d'un pays jouent en Europe) et n'a pas de ligne à lui. Trois clubs restent sans pays, dont l'Omonia, que l'UEFA écrit autrement ;
- classement 2026/2027 : 5 270 joueurs classés sur 6 614 éligibles (80 %).

**Ce qui n'est pas changé : le poids du niveau du club (κ).** Le score garde LEVEL_SHARE = 0,5 : la moitié de ce qui sépare deux joueurs est le niveau où ils jouent. Un κ égal au taux d'échange (0,132) laisserait la note d'un joueur inchangée quand il change de championnat. Essayé en lecture seule sur 2026/2027, il remplit les trente premiers de joueurs de Bolivie, du Paraguay, de Norvège et de Roumanie. L'explication avancée n'est pas vérifiée : le taux d'échange est mesuré sur le rendement pris par rapport à la moyenne de son championnat, alors que le score lit le rendement brut. Il faudrait rejouer avec le rendement pris par rapport à son championnat. Si ces joueurs restaient en tête, ce serait que le taux d'échange vaut en moyenne mais pas pour les meilleurs : il faudrait alors une standardisation dans le championnat, pas seulement un centrage. C'est un changement de la méthode à décider à part ; il n'est pas fait. Avec plus de joueurs classés, le κ publié pour la même part de 0,5 change ; sa valeur après la mise en service est lue dans `agg.power_runs`.

**Limites.**
- Les sélections nationales gardent leur Elo de la version 3 ; la confédération comme « championnat » des sélections reste à faire.
- Les joueuses du championnat féminin entrent encore dans les références de rôle communes (`references()`) ; leur score est calculé entre elles.
- Le taux d'échange est fixé pour la version 4. Il est à mesurer de nouveau quand la base aura plus d'années de transferts : seules les années du trophée terminées comptent (2024 et 2025).

## Version 5 : un rang pour chaque joueur, une note pour chaque match (15 novembre 2026)

Demande du propriétaire : un joueur doit avoir un rang dès son premier match, et une note de match qui ne dépend que de ce match. Conseil pris auprès d'un second modèle ; formules, raisons et mesures dans [les notes Vega](../08-notes-vega/01-formules-et-raisons.md) (§ 5.6 et § 5.7).

- **Rang pour tous.** Sous le seuil de minutes, l'indice part du 10ᵉ centile du rôle et rejoint celui du joueur au seuil. Les éligibles gardent leur indice et leur ordre ; la course au Ballon d'Or ne change pas.
  - **Mesuré** sur 2024/2025, 2025/2026 et 2026/2027 avant la mise en service : 32 627, 37 269 et 29 691 joueurs classés ; aucun joueur de moins de 180 minutes dans le premier cinquième ; le rang médian s'améliore avec les minutes.
  - **Rangs provisoires** : sous le seuil, et dans un championnat provisoire (21 à 28 joueurs dans les 500 premiers).
  - **En production** (relu le 15 novembre à 16 h 25 UTC, les 157 saisons recalculées en version 5) : 29 365 joueurs classés sur 29 692 en 2026/2027, 36 690 sur 37 361 en 2025/2026, 31 950 sur 32 627 en 2024/2025. Le chiffre mesuré avant comptait chaque joueur qui avait un indice ; le rang, lui, ne va qu'aux joueurs d'un club dont le championnat est dans la base.
  - **Restent sans rang**, avec un score : en 2026/2027, les 327 joueurs de 17 clubs vus seulement en Ligue des champions, Ligue Europa ou Ligue Conférence, sans leur championnat ; en 2025/2026, 412 joueurs de tels clubs, 167 de championnats féminins (notées entre elles, sans rang dans le classement des hommes) et 92 connus seulement par leur sélection.
  - **Écartée, la mesure au-dessus d'un niveau de remplacement** : ce niveau variait de plus de 25 % d'une année à l'autre pour trois rôles, et devenait positif en début de saison.
- **Note de match.** La contribution du match seule, ramenée à la dispersion de son rôle (et de sa compétition) dans la dernière année terminée, en score normal, sur la courbe 0–100. Elle est montrée sur la fiche du match à côté de la note PitchAPI, avec le rang du joueur dans le match.
  - **En production** : chaque match joué des trois dernières saisons a sa note (651 805 en 2025/2026) ; un match complet moyen vaut 0,000 en écart standardisé, soit 50. Seules 2024/2025 et 2025/2026, terminées, sont gardées comme références.
  - **Sans note du fournisseur** (certains championnats n'en ont pas), la carte « Meilleures notes » liste les meilleures notes Vega du match.
  - **Sans minutes jouées** dans la source, un match n'a pas de note : le classement ne lit que les matchs où le joueur a des minutes.
