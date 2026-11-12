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

## Ce que la version 2 ne fait pas

- **L'enjeu du match.** Une finale compte comme un autre match contre le même adversaire. Le § 9 de la méthode garde l'enjeu hors du modèle ; son annexe A.4 propose un coefficient (1,05 en huitième et quart, 1,10 en demi-finale, 1,15 en finale) comme « choix de récompense à expliciter ». Il n'est pas appliqué.
- **Les championnats hors de l'échelle commune.** Il faut des matchs entre continents. La Coupe du monde des clubs 2025 est dans la base, mais ses 33 équipes n'y sont pas reliées à leurs clubs (leur nom porte le pays entre parenthèses, « Al Hilal (KSA) ») : les relier donnerait les seuls matchs entre confédérations de la base.
- **Le niveau par les transferts.** Les joueurs qui changent de championnat pourraient relier les championnats sans match commun ; non fait.
- **Les compétitions féminines.** Une compétition féminine figure parmi les éditions (8 matchs terminés) ; elle est hors de l'échelle commune, donc hors du classement.
