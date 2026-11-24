# Score Vega : proposition d'un nouveau score (v9)

**Statut : proposition. Rien de ce qui suit n'est en service.** 20 novembre 2026, ticket [VI-42](https://linear.app/vegainteligence/issue/VI-42). Le score en service reste `power-ranking-v8` ([formules](../08-notes-vega/01-formules-et-raisons.md)).

Toutes les mesures viennent de la base de production, lue en lecture seule. Les scripts, leurs sorties et la façon de les relancer sont dans `~/Agents/scratch/vega-score-sim-20261120/` (`study9.py` est le calcul final des sections 1 à 10, `study10_run2.py` celui de la section 11, `study14.py` à `study17.py` ceux de la section 12, `README.md` décrit la tâche de diagnostic).

## 1. En bref

Le nouveau score garde ce que le score actuel mesure bien et corrige ce qui le rend incohérent d'un poste à l'autre.

| | Score actuel (v8) | Proposition (v9) |
| --- | --- | --- |
| Poids des blocs | annoncés, mais non tenus sur une saison (gardien : arrêts 21 % pour 60 % annoncés) | tenus : chaque bloc est mesuré en écarts-types de talent du poste |
| Bruit | 450 minutes pour tout | propre à chaque bloc : 220 minutes (conservation) à 3 400 (finition) et 13 300 (arrêts du gardien) |
| Gardien | quatre blocs, dominé par la relance | buts évités, en buts : un but évité vaut un but |
| Conservation (passes réussies, ballons touchés) | 10 à 20 % annoncés, 13 à 36 % réels | retirée du score, gardée dans le profil (choix, voir § 4.3) |
| Titulaire ou remplaçant | plancher sous 900 minutes | la part des titularisations entre dans le niveau |
| Niveau du club | poids choisi pour faire la moitié de l'écart | poids estimé sur les Coupes du monde, donné avec sa marge |
| Unité | écarts-types du poste | points Elo, la même pour tous les postes |
| Lectures | une note de match, une note de saison, un score | trois lectures d'un même calcul : match, saison, niveau |

Ce que la proposition ne prétend pas : elle ne prédit pas mieux les matchs que le score actuel de façon établie. Sur la saison de validation elle fait mieux (§ 6) ; sur les 3 315 matchs de test, rien ne se sépare. Elle est plus cohérente, pas démontrée plus exacte.

## 2. Ce qui ne va pas dans le score actuel (mesuré)

1. **Le score contient la note.** Score ≈ jeu propre + niveau du club (R² 0,94). Note de saison et jeu propre : r = 0,95. Dans un même championnat, note et score classent presque pareil (0,83).
2. **Les poids annoncés ne sont pas tenus.** Part de chaque bloc dans ce qui sépare les joueurs d'un poste, saison 2025/2026 :

| Poste | Finition | Création | Progression | Défense | Conservation |
| --- | ---: | ---: | ---: | ---: | ---: |
| Avant-centre, annoncé | 45 | 20 | 15 | 10 | 10 |
| Avant-centre, réel | 31 | 31 | 25 | 1 | 13 |
| Milieu défensif, annoncé | 5 | 15 | 20 | 40 | 20 |
| Milieu défensif, réel | 1 | 22 | 31 | 10 | 35 |
| Défenseur central, annoncé | 5 | 5 | 15 | 55 | 20 |
| Défenseur central, réel | 1 | 3 | 21 | 38 | 36 |
| Latéral, annoncé | 5 | 25 | 25 | 30 | 15 |
| Latéral, réel | 1 | 33 | 35 | 12 | 20 |

   Gardien : arrêts 21 % (60 annoncés), relance 76 % (15 annoncés).
3. **La cause.** Chaque mesure est divisée par son bruit d'un match. Un bloc régulier (passes) s'additionne match après match ; un bloc irrégulier (finition, arrêts) s'annule. Corrélation entre les matchs pairs et impairs d'un même joueur : conservation 0,82 à 0,88, progression 0,71 à 0,84, défense 0,55 à 0,72, création 0,4 à 0,7, finition 0,16 à 0,46, arrêts 0,04.
4. **Le poids du niveau du club est choisi**, pas estimé (κ ≈ 0,65 pour donner la moitié de l'écart).
5. **Sept rôles durs.** Un attaquant de soutien est comparé aux avant-centres : les matchs de Griezmann lus comme ceux d'un milieu offensif le font passer de 15e à 211e.

## 3. Comment chaque idée a été testée

Une idée est gardée si elle aide à prévoir des matchs qu'elle n'a pas vus.

- **Les matchs.** Clubs, 2024/2025 et 2025/2026 pour l'apprentissage (25 511 matchs), 2026/2027 pour le test (3 315 matchs). Validation : apprendre sur 2024/2025, juger sur 2025/2026 (13 641 matchs).
- **Ce qu'on prévoit.** Les buts de chaque équipe, par une loi de Poisson, à partir de l'écart d'Elo (les coefficients du pronostic en service).
- **Ce qu'on ajoute.** L'écart entre le onze du jour et le onze habituel du club. Le onze habituel est l'effectif pondéré par la part des titularisations de chacun jusque-là. Les deux sont évalués avec ce qu'on sait des joueurs **avant** le match (année précédente et année en cours jusqu'au match exclu).
- **Un contrôle dans tous les modèles.** La part de titulaires habituels dans le onze : une équipe remaniée fait moins bien, quels que soient ses joueurs.
- **Le critère.** La log-vraisemblance des buts par match, et la différence avec le score actuel, match par match, avec son erreur-type.

Un défaut du modèle de compositions en service (`lineup-v1`) est apparu en route : son « onze habituel » est la moyenne des sommes passées, chacune à sa date. Il mêle donc la forme de l'équipe à sa composition. Son coefficient de 45 points Elo par unité en est gonflé ; l'effet propre de la composition en vaut environ le quart (§ 9).

## 4. Le score proposé

### 4.1 Ce qu'on attend d'un joueur à chaque poste

La mesure d'un match ne change pas : pour chaque statistique, ce que fait le joueur moins ce qu'on attend de son poste face à cet écart de force, puis les blocs. Ce qu'un joueur de chaque poste fait par 90 minutes, à force égale (2025/2026 et 2026/2027) :

| Poste | xG | xA | Ballons dans la surface | Passes progressives | Tacles + interceptions | Récupérations | Dégagements | Passes réussies |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Avant-centre | 0,22 | 0,06 | 4,6 | 1,3 | 1,0 | 2,4 | 0,9 | 14 |
| Ailier / milieu offensif | 0,12 | 0,10 | 3,6 | 2,8 | 1,9 | 3,9 | 0,8 | 22 |
| Milieu central | 0,06 | 0,07 | 1,6 | 3,1 | 2,8 | 4,6 | 1,4 | 34 |
| Milieu défensif | 0,04 | 0,05 | 1,1 | 3,2 | 3,1 | 5,0 | 1,7 | 38 |
| Latéral / piston | 0,04 | 0,07 | 1,5 | 3,3 | 3,0 | 4,0 | 2,8 | 29 |
| Défenseur central | 0,04 | 0,02 | 1,0 | 2,7 | 2,5 | 3,6 | 5,7 | 42 |

Gardien : 0,78 sortie aérienne, 0,38 sortie dans la profondeur, 5,9 longs ballons réussis, 20 passes réussies.

### 4.2 Le talent par bloc

Pour un joueur de rôle r et un bloc b, avec S la somme de ses écarts de match et M ses minutes :

$$
\hat{\tau}_{b} = \frac{90\,S_b}{M + \lambda_{r,b}}
$$

λ est le nombre de minutes qui divise le bruit par deux. Il est **mesuré** par bloc et par rôle sur 2025/2026 (variance entre joueurs contre variance entre les matchs d'un même joueur) :

| Bloc | λ (médiane des rôles) |
| --- | ---: |
| Conservation | 218 |
| Progression | 357 |
| Défense | 782 |
| Création | 956 |
| Finition | 3 440 (de 1 459 pour un milieu central à 6 349 pour un défenseur central) |
| Gardien : relance | 313 |
| Gardien : profondeur | 878 |
| Gardien : jeu aérien | 1 680 |
| Gardien : buts évités | 13 291 |

L'année précédente compte pour moitié (S et M de l'année précédente multipliés par 0,5 ; **choisi**, à régler). Cette formule remplace à la fois les 450 minutes uniques et l'a priori de la saison passée de la version 8.

### 4.3 La valeur propre d'un joueur de champ

$$
V = E \sum_{b} \tilde{w}_{r,b}\,\frac{\hat{\tau}_b}{\sigma_{r,b}} \;+\; E_s\,(\text{part des titularisations})
$$

- σ est l'écart-type du talent du bloc parmi les joueurs du rôle. Diviser par σ fait que le poids annoncé est le poids réel.
- w̃ : les poids du rôle de la méthode, sans la conservation, ramenés à 1.
- **E = 9,1 points Elo par unité** (**mesuré** : 13,8 ± 1,7 par écart-type de composition). **Un seul E pour tous les postes** : un coefficient par poste donne de 4,1 à 8,1 ± 1,8 par écart-type, sans différence établie, et ne prévoit pas mieux.
- **E_s = 13,4 points Elo** entre un joueur jamais titulaire et un joueur toujours titulaire de son club (**mesuré** : 17,1 ± 1,7 par écart-type, le signal individuel le plus net de l'étude). Le choix de l'entraîneur est une information. Ce terme remplace le plancher sous 900 minutes.

**Pourquoi sortir la conservation.** Les cinq blocs ajustés séparément valent, en points Elo par écart-type de composition : défense 7,6 ± 1,7, création 5,8 ± 2,0, finition 5,5 ± 1,7, progression 4,5 ± 2,1, conservation 0,1 ± 1,9. La conservation n'apporte rien de plus que les quatre autres. L'écart avec la progression n'est pas significatif à lui seul : c'est donc un **choix**, pas une conclusion. Avec ou sans elle, la prévision est la même. Elle reste affichée dans le profil du joueur.

Ce qui sépare les joueurs d'un poste avec cette valeur, blocs seuls, 2025/2026 (poids visé entre parenthèses) :

| Poste | Finition | Création | Progression | Défense |
| --- | ---: | ---: | ---: | ---: |
| Avant-centre | 51 (50) | 26 (22) | 18 (17) | 5 (11) |
| Ailier / milieu offensif | 9 (22) | 54 (39) | 38 (28) | 0 (11) |
| Milieu central | 4 (13) | 40 (31) | 48 (31) | 7 (25) |
| Milieu défensif | 1 (6) | 11 (19) | 23 (25) | 64 (50) |
| Latéral / piston | 1 (6) | 30 (29) | 39 (29) | 30 (35) |
| Défenseur central | 1 (6) | 1 (6) | 11 (19) | 87 (69) |

Les postes défensifs et l'avant-centre retrouvent leurs poids. L'ailier et le milieu central restent tirés vers la création et la progression : chez eux, un joueur créatif défend et finit moins, les blocs se compensent.

### 4.4 Le gardien

$$
V_\text{gardien} = G \times \hat{g} \;+\; E_s\,(\text{part des titularisations}), \qquad \hat{g} = \frac{90 \sum (\text{xGOT subis} - \text{buts encaissés})}{M + 13\,291}
$$

- **G = 163 points Elo** : ce que vaut un but par match dans le pronostic en service. Un but évité vaut un but, **sans réglage**.
- Vérifié : laissé libre, le coefficient ressort à 345 ± 104 points par but pour les gardiens et à 233 ± 77 pour tous les buts « à leur valeur » (finition au-dessus des xG, erreurs, buts évités). Les deux sont positifs et compatibles avec 163.
- Avec 13 291 minutes de bruit, une saison complète compte pour un cinquième : le niveau d'un gardien se lit sur plusieurs saisons. L'écart-type du vrai talent est de 0,062 but par 90 minutes, soit 10 points Elo.
- Jeu aérien, profondeur et relance sortent du score et restent dans le profil : aucun gain hors échantillon, et pas de valeur en buts connue.

### 4.5 Le niveau du club

La valeur propre dit ce qu'un joueur fait de plus ou de moins que ce qu'on attend dans son club. Le niveau ajoute où se trouve ce club :

$$
\hat{A} = V - \overline{V}_\text{rôle} + \psi\,\frac{R_\text{club} - \overline{R}}{400}
$$

- $\overline{V}_\text{rôle}$ : la moyenne du rôle. Par convention, le joueur moyen de chaque poste a le même niveau.
- ψ : les points Elo de niveau qu'un joueur tire de 400 points d'Elo de son club.

**Ce que disent les Coupes du monde.** Des joueurs de clubs et de championnats différents y jouent ensemble : le résultat dit si ceux des grands clubs valent plus que leurs statistiques.

| Mesure | Résultat |
| --- | --- |
| Coupe du monde 2026, 83 matchs, valeur propre v9 des titulaires de champ | ψ = 19 ± 11 points Elo pour 400 |
| Même calcul, coefficient de la valeur propre (1 = un point de valeur vaut un point de résultat) | 1,63 ± 0,74 |
| Coupes du monde 2022 et 2026, 129 matchs, rendement v8 | κ = 0,60 ± 0,32, le κ en service étant 0,65 |
| Le niveau du club ajoute-t-il quelque chose aux statistiques ? | oui, nettement : la vraisemblance passe de −1,711 à −1,577 par match |
| Borne haute : si l'Elo d'un club était entièrement porté par ses onze joueurs | 36 |

Le niveau du club compte, c'est établi. Son poids exact ne l'est pas : entre 10 et 36, avec 24 au centre. **La valeur de ψ est une décision à prendre** (§ 8), éclairée par le tableau du § 5.

Selon ψ, le club pèse d'un tiers (ψ = 10) à plus de quatre cinquièmes (ψ = 36) de ce qui sépare les joueurs, et les trois quarts à ψ = 24. Ce n'est pas que les joueurs diffèrent peu : c'est que les statistiques d'un joueur en disent peu de façon sûre, et que le club où il joue en dit beaucoup.

### 4.6 Le score sur 100 et sa marge

Une seule courbe pour tous les postes, sur l'échelle Elo :

$$
\text{score} = \frac{100}{1 + 10^{-(\hat{A} - A_0)/36}}
$$

A₀ est le niveau médian des joueurs classés (score 50). Avec 36 points Elo pour dix contre un, le 90ᵉ centile est à 70, le 99ᵉ à 85 et le premier à 95 ou 96. Plus de normalisation à l'intérieur de chaque poste : la valeur décide. En 2025/2026 les cent premiers comptent 26 ailiers, 14 avant-centres, 12 milieux défensifs, 9 milieux centraux, 12 latéraux, 16 défenseurs centraux et 11 gardiens.

Chaque niveau a une erreur-type, tirée des minutes et du bruit de chaque bloc, plus celle du championnat. Un rang est « provisoire » quand cette erreur dépasse un seuil, au lieu d'une barre de minutes.

### 4.7 Trois lectures d'un même calcul

| Lecture | Calcul | Usage |
| --- | --- | --- |
| **Note du match** | les mêmes blocs et les mêmes poids, sur un seul match, sans réduction du bruit | fiche du match, forme récente, joueur de la semaine |
| **Valeur de la saison** | la somme des matchs, multipliée par l'enjeu, au-dessus d'un joueur de remplacement | course au Ballon d'Or, joueur de la saison |
| **Niveau = Score Vega** | § 4.2 à 4.6 : ce qu'on peut attendre de lui au prochain match | classement, liste des joueurs, comparaisons |

Un joueur en réussite aura une valeur de saison au-dessus de son niveau : c'est voulu. La note de saison actuelle (moyenne des notes) disparaît comme classement.

## 5. Ce que ça change

Rangs parmi les joueurs éligibles des championnats mesurés. Score et décomposition à ψ = 24.

### Saison 2025/2026 complète (12 737 joueurs)

| Joueur | Rang v8 | Rang v9 (ψ = 10 / 24 / 36) | Score | Propre + club |
| --- | ---: | --- | ---: | --- |
| Michael Olise | 2 | 2 / 1 / 1 | 96 | +22 +28 |
| Lionel Messi | 1 | 1 / 2 / 11 | 95 | +39 +8 |
| Harry Kane | 6 | 9 / 4 / 2 | 94 | +16 +28 |
| Lamine Yamal | 5 | 7 / 7 / 5 | 94 | +18 +25 |
| Kylian Mbappé | 3 | 14 / 8 / 9 | 93 | +15 +25 |
| Declan Rice | 9 | 23 / 9 / 6 | 92 | +10 +29 |
| David Raya (gardien) | 49 | 34 / 11 / 8 | 92 | +9 +29 |
| Rúben Neves | 44 | 13 / 12 / 18 | 92 | +17 +21 |
| Joshua Kimmich | 7 | 48 / 13 / 12 | 91 | +9 +28 |
| Erling Haaland | 36 | 52 / 21 / 17 | 90 | +9 +26 |
| Virgil van Dijk | 10 | 50 / 26 / 25 | 90 | +10 +25 |
| Vítinha | 4 | 79 / 27 / 19 | 90 | +8 +27 |
| Antoine Griezmann (Atlético) | 46 | 495 / 271 / 279 | 81 | +5 +18 |

Les meilleurs par poste, 2025/2026, ψ = 24 :

- **Avant-centre** : Messi, Kane, Dembélé, Mbappé, João Félix, Haaland.
- **Ailier / milieu offensif** : Olise, Cherki, Bruno Fernandes, Yamal, Doku.
- **Milieu central** : Rúben Neves, Al Juwayr, Vítinha, Milinković-Savić, Ødegaard.
- **Milieu défensif** : Rice, Kimmich, Locatelli, Pedri, Rodri.
- **Latéral / piston** : Nuno Mendes, Dimarco, Raum, Abu Al Shamat, Stanišić.
- **Défenseur central** : van Dijk, Schlotterbeck, Huijsen, Konaté, Senesi.
- **Gardien** : Raya, Joan García, Donnarumma, Lammens, Courtois, Maignan.

### Saison 2026/2027 au 20 novembre (3 853 joueurs)

| Joueur | Rang v8 | Rang v9 (ψ = 10 / 24 / 36) | Score | Propre + club |
| --- | ---: | --- | ---: | --- |
| Michael Olise | 3 | 3 / 1 / 1 | 95 | +16 +31 |
| Lamine Yamal | 1 | 2 / 2 / 2 | 95 | +19 +28 |
| Harry Kane | 8 | 7 / 4 / 3 | 93 | +11 +31 |
| Declan Rice | 7 | 12 / 5 / 4 | 92 | +8 +32 |
| Kylian Mbappé | 2 | 6 / 6 / 6 | 92 | +13 +26 |
| Rúben Neves | 9 | 5 / 7 / 11 | 92 | +15 +24 |
| David Raya (gardien) | 11 | 15 / 8 / 5 | 92 | +6 +32 |
| Joshua Kimmich | 5 | 23 / 11 / 8 | 90 | +5 +31 |
| Erling Haaland | 51 | 34 / 16 / 15 | 89 | +5 +28 |
| Vítinha | 4 | 60 / 22 / 20 | 87 | +4 +27 |
| Lionel Messi | 131 | 4 / 23 / 74 | 87 | +22 +9 |
| Virgil van Dijk | 41 | 71 / 41 / 42 | 85 | +5 +23 |
| Pau Cubarsí | 13 | 549 / 91 / 50 | 81 | −5 +28 |
| Antoine Griezmann (Orlando) | 15 | 67 / 295 / 474 | 73 | +14 +2 |

- **Griezmann.** Sa valeur propre reste parmi les meilleures (+14). Il descend parce que son club ne lui apporte presque rien (+2), là où le Real apporte +26 à Mbappé. Son rang dépend d'abord de ψ : 67e à 10, 295e à 24.
- **Vítinha, Cubarsí, Kimmich.** Ils perdent ce que la conservation leur donnait. Avec la conservation gardée, à ψ = 24 : Vítinha 8e, Kimmich 6e, Cubarsí 33e. C'est l'effet du choix du § 4.3.
- **Messi.** La plus haute valeur propre des deux saisons (+39 puis +22). Son rang dépend lui aussi de ψ.
- **Un défenseur central d'un club moyen** (Massiré Sylla, Union Saint-Gilloise) est 3e au 20 novembre avec +24 de valeur propre : en début de saison, quelques matchs suffisent encore à porter un joueur très haut. La marge d'erreur du § 4.6 doit l'afficher comme provisoire.

## 6. Validations

Différence de log-vraisemblance par match avec le score actuel, × 100 000 (positif = mieux), ± erreur-type appariée :

| Modèle | Validation (13 641 matchs) | Test (3 315 matchs) |
| --- | ---: | ---: |
| Blocs, bruit propre, poids annoncés | +6 ± 17 | −1 ± 30 |
| Poids tenus | +57 ± 22 | −22 ± 39 |
| Poids tenus, sans conservation (**v9**) | +71 ± 27 | −27 ± 50 |
| Quatre blocs à poids égaux | +63 ± 24 | +37 ± 46 |
| v9 + « avec ou sans le joueur » | +172 ± 35 | +30 ± 68 |

Pour l'échelle : l'Elo seul est à −248 (validation) et −290 (test) du score actuel.

Autres contrôles :

| Contrôle | Score actuel | v9 |
| --- | ---: | ---: |
| Accord avec la valeur marchande, à niveau de club égal et dans un même poste (11 116 joueurs) | 0,14 | 0,24 |
| Le même, gardiens seuls | 0,05 | 0,28 |
| Même joueur, 2025/2026 puis 2026/2027 (3 092 joueurs ; la seconde lit la moitié de la première) | 0,55 | 0,69 |
| Coupe du monde 2026, vraisemblance par match avec le niveau du club | −1,583 | −1,577 |

- En validation, tenir les poids fait mieux que le score actuel (2,6 erreurs-types). Sur le test, plus petit, rien ne se sépare.
- L'accord avec la valeur marchande à club égal est un contrôle indépendant du calcul : il passe de 0,14 à 0,24, et pour tous les postes.

## 7. Ce que les données ont refusé

- **Apprendre vingt à trente-cinq poids sur les résultats.** Quatre architectures essayées (mesures brutes ou blocs, attaque et défense séparées, cible buts ou xG, poids contraints à être positifs). Toutes prévoient moins bien les matchs de test que les versions à un coefficient, et trois sur quatre moins bien que le seul contrôle des titulaires. Les résultats ne portent pas assez d'information pour fixer autant de poids.
- **Un coefficient par poste.** Pas mieux qu'un seul.
- **Les blocs secondaires du gardien.** Aucun gain hors échantillon.
- **« Avec ou sans le joueur »** (les xG pour et contre de l'équipe quand il est sur le terrain, d'après la minute de chaque tir). Le meilleur gain en validation (+172 ± 35), mais non confirmé sur le test, un bruit si fort que son λ n'est pas mesurable, et un risque qu'il capte la forme du club plutôt que le joueur. Reporté à l'étape 2 avec ses contrôles.

## 8. Mesuré, choisi, à décider

| Réglage | Valeur | Statut |
| --- | --- | --- |
| λ par bloc et par rôle | § 4.2 | mesuré |
| σ par bloc et par rôle | écart-type du talent | mesuré |
| E, E_s | 9,1 et 13,4 points Elo | mesurés |
| G, valeur d'un but | 163 points Elo | tiré du pronostic en service |
| Poids des blocs par rôle | ceux de la méthode | choisis (inchangés) |
| Conservation hors du score | | **à décider** : dehors (proposé), ou gardée |
| Poids de l'année précédente | 0,5 | choisi, à régler |
| ψ, poids du niveau du club | 24, entre 10 et 36 | **à décider** |
| Échelle du score | 36 points Elo pour dix contre un | choisi |
| Postes | huit : l'ailier et le milieu offensif axial séparés (§ 11) | proposé |
| Seuil d'un second poste | 450 minutes sur deux saisons | choisi ; 270 et 900 donnent presque le même classement |
| Lien entre deux postes d'un même joueur | § 11.2 | mesuré |
| Lecture du soutien d'une attaque à deux | sur le style, § 11.1 | proposé ; étendue à tous les avant-centres : essayée et écartée |
| Bloc défense : attendus en contexte, échelle stabilisée, talent borné à ± 2 écarts-types | § 12 | retenu le 23 novembre 2026 ; la borne est gratuite mais non prouvée (§ 12.4) |

## 9. Limites et étape 2

1. **Les rôles.** Traité au § 11 (ajout du 20 novembre) : huit postes, un niveau par poste, le soutien d'une attaque à deux lu sur son style. Restent ouverts : le faux 9 aligné seul en pointe, et le milieu de côté d'un 4-4-2 rangé avec les ailiers.
2. **Les unités.** Les blocs restent en écarts-types d'un match. Étape 2 : des unités réelles (buts, passes) valorisées directement, et un attendu qui tient compte de la part du joueur dans le jeu de son équipe.
3. **« Avec ou sans le joueur ».** À reprendre avec un contrôle de la forme du club et les seules valeurs de l'année précédente.
4. **ψ.** À préciser avec tous les transferts (pas seulement ceux qui ont joué 600 minutes après), les promus et relégués, et chaque nouvelle compétition de sélections.
5. **Les gardiens.** Le niveau demande plusieurs saisons. Un jeune gardien restera longtemps près du niveau de son club.
6. **Le test est petit.** 3 315 matchs ne séparent pas les variantes. À rejuger en fin de saison 2026/2027.
7. **Le niveau des championnats** a été ajusté avec l'ancien rendement. Un nouveau calcul de la valeur propre demande de le vérifier une fois.

**Pour le pronostic** (hors de ce ticket). La somme des rendements du onze habituel d'un club, qui n'est pas un écart de composition, vaut 23,8 ± 1,7 points Elo par écart-type et améliore la prévision des matchs de test de 0,0088 par match, plusieurs fois ce qu'apporte la composition : l'Elo réagit trop lentement au jeu des équipes. C'est une propriété du club, pas d'un joueur.

## 10. Ce qu'il faudrait construire

1. Le calcul v9 à côté du v8, sans rien remplacer : mêmes lectures, écrit dans des tables à part.
2. Une page de comparaison v8 / v9 par joueur, privée, pour juger sur pièces.
3. Les calculs de l'étape 2 mesurés un par un avec le même plan d'expérience.
4. La bascule du site une fois ψ et la conservation décidés, avec la maquette des trois lectures validée avant.

## 11. Un niveau par poste (ajout du 20 novembre 2026, simulé)

Demande : un poste de base par joueur, un second poste acquis après un certain nombre de minutes, un niveau par poste, la saison comme moyenne de ces niveaux pondérée par les minutes ; un joueur de champ qui finit dans le but n'est pas compté ; l'attaquant de soutien n'est plus lu comme un avant-centre. Tout ce qui suit a été simulé sur la base, en lecture seule. Rien n'est en service.

### 11.1 Les règles

1. **Huit postes.** « Ailier / milieu offensif » est coupé en deux d'après la place sur la feuille de match. Dans les rangs 8 et 9, les places 4 à 6 sont l'axe (le 10 d'un 4-2-3-1, les deux meneurs d'un 3-4-2-1, le second attaquant d'un 4-4-1-1) ; les autres sont des ailiers. Les deux postes gardent les mêmes poids et ont chacun leurs attentes. En 2025/2026 : 79 070 matchs d'ailier, 28 062 de milieu offensif axial.
2. **Poste de base.** Celui où le joueur a le plus de minutes (cette saison, plus la moitié de la précédente).
3. **Poste acquis.** Un autre poste compte à partir de 450 minutes jouées à ce poste sur les deux saisons.
4. **Poste non acquis.** Ses matchs ne sont pas jugés : ni leurs minutes ni leurs écarts n'entrent dans le niveau. La titularisation, elle, compte toujours.
5. **Gardien de fortune.** Un match au poste de gardien d'un joueur de champ n'est pas jugé. Il en va de même du match où un joueur de champ a été le gardien d'au moins un tir.
6. **Un niveau par poste, un talent partagé.** Le talent d'un joueur dans un bloc n'est pas estimé à chaque poste séparément : ses postes s'informent l'un l'autre, autant que les données le permettent (formule ci-dessous).
7. **Niveau de la saison.** La moyenne des niveaux de ses postes acquis, pondérée par les minutes de la saison à chacun.
8. **Attaque à deux.** Quand une équipe aligne deux avant-centres, la feuille ne dit pas lequel est la pointe et lequel joue en soutien. On le lit sur le style, puis le soutien est jugé comme un milieu offensif axial, comme si la feuille avait annoncé un 4-4-1-1.

**Le talent partagé.** Pour un bloc b et un poste r, en écarts-types de talent du poste : le talent z a pour moyenne a priori 0 au poste de base et δ au second poste, pour variance 1, et pour covariance ρ entre deux postes du même joueur. Le rendement observé y = 90·S/M/σ a pour bruit λ/M. L'estimation est

```
ẑ = μ + C (C + D)⁻¹ (y − μ)        C : 1 sur la diagonale, ρ ailleurs ; D : les bruits λ/M
V_r = E · Σ_b w̃(r,b) · ẑ(b,r)      valeur au poste r, avec les poids de ce poste
niveau = Σ_r part_r · (V_r − moyenne du poste r) + E_s · titularisations + ψ · club
```

Avec un seul poste, on retrouve la formule du § 4.2. Si chaque poste était corrigé séparément, un joueur à 1 500 + 1 500 minutes ne garderait que 30 % de son écart de finition, contre 47 % pour 3 000 minutes au même poste.

**Le soutien.** Six mesures de style, qui disent où et combien, jamais avec quelle réussite : part des ballons touchés dans la surface, passes tentées par ballon touché, duels aériens par ballon touché, part des ballons de l'équipe, hors-jeu par ballon touché, centres par passe. Deux classes apprises sur des cas sans ambiguïté (1 702 saisons d'avant-centres alignés seuls, 888 de milieux offensifs axiaux, 900 minutes au moins), avec le bruit de mesure de chaque joueur selon ses minutes. Un mélange à deux classes est ensuite ajusté sur les joueurs d'attaque à deux eux-mêmes. Il donne à chacun une probabilité π d'être le soutien. Ses matchs d'attaque à deux sont lus deux fois en entier, en pointe et en soutien, et le niveau est le mélange des deux lectures : (1 − π) · pointe + π · soutien. Chaque lecture est recentrée sur les joueurs de sa classe.

### 11.2 Ce qui a été mesuré

| Mesure | Résultat |
| --- | --- |
| Joueurs de champ à un poste, deux, trois ou plus (2025/2026, seuil 450) | 7 277, 3 532, 927 |
| Minutes de la saison non jugées (poste non acquis) | 6,1 % (3,7 % au seuil 270, 11,0 % au seuil 900) |
| Doubles les plus fréquents | milieu défensif + milieu central, défenseur central + latéral, ailier + avant-centre, ailier + milieu offensif |
| Même joueur, postes voisins : covariance des talents (finition, création, progression, défense) | 0,73 ± 0,05, 0,88 ± 0,04, 0,80 ± 0,03, 0,70 ± 0,03 |
| Même joueur, postes éloignés | 0,20 ± 0,11, 0,78 ± 0,09, 0,70 ± 0,05, 0,37 ± 0,06 |
| Les deux classes de style séparées sur leurs propres joueurs | avant-centres 1 654 sur 1 702, milieux offensifs 817 sur 888 |
| Attaques à deux, 1 780 saisons de 900 minutes et plus | 1 568 pointes (π < 0,2), 101 soutiens (π > 0,8), 111 entre les deux |
| Soutiens d'une attaque à deux, contre les attentes d'un milieu offensif | finition + 0,12, création + 0,28, progression + 0,20, défense − 0,71 écart-type de talent (retiré par le recentrage) |
| Minutes pour qu'une note de poste soit pour moitié du signal | milieu central 517, milieu défensif 685, latéral 741, milieu offensif 775, défenseur central 1 003, ailier 1 381, avant-centre 3 063 |

Un joueur garde donc l'essentiel de son profil en passant à un poste voisin. Entre postes éloignés, la finition ne se transporte presque pas.

**Gardien de fortune.** Sur trois saisons, la base ne contient qu'un cas réel visible (37 minutes en 2026/2027). La règle écarte surtout une erreur de lecture : en 2025/2026, 3 415 matchs de 729 joueurs de champ sont rangés au poste de gardien sans aucune statistique de gardien, presque tous dans deux compétitions (Challenger Pro League 1 822, une Serie A 1 566). Le score en service les compte aujourd'hui comme des matchs de gardien. C'est un défaut du calcul actuel, à corriger à part.

### 11.3 Ce que ça change

Rang avec ψ = 24. V0 est la proposition des sections 1 à 10, V1 ajoute le niveau par poste, V2 ajoute la lecture des attaques à deux.

Saison 2026/2027 au 20 novembre (3 881 joueurs) :

| Joueur | Aujourd'hui | V0 | V1 | V2 |
| --- | ---: | ---: | ---: | ---: |
| Yamal | 1 | 2 | 1 | 1 |
| Olise | 3 | 1 | 2 | 2 |
| Kane | 8 | 4 | 4 | 3 |
| Rice | 7 | 5 | 6 | 5 |
| Mbappé | 2 | 6 | 5 | 6 |
| Kimmich | 5 | 11 | 10 | 10 |
| Haaland | 53 | 16 | 16 | 16 |
| Messi | 127 | 23 | 28 | 44 |
| Palmer | 329 | 151 | 146 | 141 |
| Griezmann | 16 | 295 | 279 | 847 |

Saison 2025/2026 complète (12 737 joueurs) :

| Joueur | Aujourd'hui | V0 | V1 | V2 |
| --- | ---: | ---: | ---: | ---: |
| Olise | 2 | 1 | 1 | 1 |
| Dembélé | 8 | 5 | 3 | 2 |
| Kane | 6 | 4 | 4 | 3 |
| Messi | 1 | 2 | 2 | 6 |
| Mbappé | 3 | 8 | 7 | 10 |
| João Félix | 34 | 16 | 18 | 51 |
| Valverde | 48 | 85 | 54 | 54 |
| Julián Álvarez | 26 | 79 | 59 | 148 |
| Camavinga | 474 | 526 | 270 | 264 |
| Palmer | 847 | 207 | 274 | 270 |
| Marquinhos | 176 | 435 | 405 | 400 |
| Griezmann | 46 | 271 | 231 | 774 |

Exemples de fiches (V2, ψ = 24) :

- **Palmer, 2025/2026.** Milieu offensif axial 1 327 minutes (59 %), score 81 ; ailier 915 minutes (41 %), score 82 ; 350 minutes de milieu central non jugées. En 2026/2027 : 880 minutes, toutes dans l'axe ; l'aile reste acquise mais n'est pas jouée.
- **Marquinhos, 2025/2026.** Défenseur central 2 279 minutes, score 79 ; 90 minutes de latéral non jugées.
- **Valverde, 2025/2026.** Quatre postes acquis : côté du milieu 39 %, latéral 34 %, milieu central 18 %, milieu défensif 9 %.
- **Griezmann, 2026/2027.** Soutien à 94 %. Lu en pointe : finition + 0,7, création + 3,3, progression + 2,1 écarts-types, score 73. Lu en soutien : finition + 1,4, création + 1,0, progression − 0,3, score 60. Niveau retenu + 8 points : + 5,7 pour lui-même, + 2,1 pour son club. Rang 566 si ψ = 10, 847 si ψ = 24, 1 002 si ψ = 36.

Les notes d'un même joueur à deux postes sont proches : son profil se transporte, et le club et les titularisations sont communs. Le niveau par poste déplace peu le haut du classement. Il corrige surtout les joueurs à plusieurs postes (Camavinga, Valverde, Tchouaméni) et, avec la lecture des attaques à deux, un petit groupe de soutiens.

### 11.4 Validations

| Contrôle | Résultat |
| --- | --- |
| Rendements par bloc de 2026/2027 à un second poste acquis, prévus depuis 2025/2026 : erreur quadratique du « poste principal » moins celle du niveau par poste | + 0,160 ± 0,024 (634 joueurs) : le niveau par poste prévoit mieux |
| Idem à un poste jamais joué avant : « chaque poste seul » moins talent partagé | + 0,154 ± 0,072 (353 joueurs) : le talent partagé prévoit mieux |
| Idem au poste de base | aucune différence |
| Accord avec la valeur marchande à club égal (V0, V1, V2) | 0,238, 0,233, 0,237 : inchangé |
| Même joueur d'une saison à la suivante (V0, V1, V2) | 0,686, 0,683, 0,680 : inchangé |
| Joueurs dont le poste de base change : variation moyenne du niveau | 3,89, 3,72, 3,72 points Elo |
| Seuil 270 ou 900 au lieu de 450 : déplacement dans les 300 premiers | médiane 1 à 2 rangs ; neuf sur dix à moins de 5 rangs (seuil 270) ou de 17 (seuil 900) |

Le niveau par poste ne rend pas le classement plus exact dans son ensemble. Il lit mieux les seconds postes, ce qui est mesuré, et ne dégrade rien d'autre.

### 11.5 Essayé et écarté : lire tous les avant-centres sur leur style

Le même défaut touche le « faux 9 » aligné seul en pointe : Dembélé en 2025/2026 a + 5,7 écarts-types de progression « pour un avant-centre ». Le classement par le style le reconnaît bien (Dembélé 0,97, Son 0,95, Kane 0,00, Haaland 0,00). Mais le juger ensuite avec les poids d'un milieu offensif, où la finition ne pèse que 22 %, fait tomber des buteurs : Mbappé recule au 35e rang en 2026/2027 et au 53e en 2025/2026, Dembélé au 14e. La lecture reste donc limitée aux attaques à deux, où elle ne fait que réparer l'ambiguïté de la feuille. Le faux 9 demande ses propres poids, ce que les données ne fixent pas (§ 7).

### 11.6 Limites

1. **Cas limites de l'attaque à deux.** Julián Álvarez est lu soutien à 48 % et perd près de 90 places : une pointe qui décroche beaucoup est en partie jugée comme un meneur.
2. **Le faux 9** reste comparé aux avant-centres (§ 11.5).
3. **Le milieu de côté d'un 4-4-2** est rangé avec les ailiers par la règle des rôles en service (Valverde, Camavinga).
4. **E, E_s et ψ** sont ceux des sections 4 et 6 : ils n'ont pas été réestimés avec huit postes, et le test sur les résultats des matchs n'a pas été refait.
5. **Le style** est mesuré sur les mêmes matchs que ceux qu'il sert à relire. Les mesures choisies ne sont pas notées par le score, mais un contrôle sur des matchs séparés reste à faire.
6. **Le lien entre postes** contient encore le style du club : le retirer demande un autre estimateur que celui essayé, qui ajoutait du bruit.
7. **Le haut du classement** garde quelques joueurs de championnats moyens. C'est la question de ψ, toujours ouverte.

## 12. Le bloc défense : attendus en contexte, échelle stabilisée, talent borné (ajout du 23 novembre 2026, simulé)

Origine : avec le calcul des sections 4 et 11, Massiré Sylla (défenseur central de l'Union Saint-Gilloise, axial d'une défense à trois, 1 248 minutes) sort 3e du classement 2026/2027 à ψ = 24, avec un talent défensif de + 4,0 écarts-types. Ses 14 matchs sont réels, sans doublon. Quatre calculs en lecture seule ont cherché ce que mesure le bloc et comment le corriger. Rien n'est en service. La correction du § 12.3 a été retenue le 23 novembre 2026.

### 12.1 Ce qui a été écarté

- **Le style de son équipe.** L'Union n'est pas plus exposée que les autres (facteur 1,03 à 1,08) et la part du club dans son écart est nulle. Le poste axial d'une défense à trois explique + 0,36 écart-type, pas + 4.
- **Les données.** Les erreurs menant à un but, vides dans la source pour l'Union, sont bien lues comme zéro (effet + 0,12 sur un seul des neuf indicateurs).
- **Le contexte seul.** Attendus en contexte, part des actions de l'équipe, échelle stabilisée, rétrécissement des comptages : Sylla reste 1er défenseur central dans toutes ces variantes (de + 3,80 à + 2,90 écarts-types).

### 12.2 Ce que mesure le bloc

| Question | Résultat | Lecture |
| --- | --- | --- |
| Suit-il les occasions concédées par l'équipe ? | + 0,031 ± 0,029 | aucun lien mesurable |
| Suit-il la valeur marchande des défenseurs centraux ? | corrélation 0,06 | presque aucun lien |
| Les neuf indicateurs vont-ils ensemble ? | corrélation moyenne + 0,05 | ils ne mesurent pas une même qualité |
| Vaut-il son prix dans les résultats des matchs ? (1 = prix annoncé) | centraux 1,05 ± 0,26 ; latéraux 0,84 ± 0,50 ; milieux défensifs 0,48 ± 0,38 | oui pour les centraux |
| Qu'est-ce qui porte cette valeur chez les centraux ? | tacles, interceptions, récupérations 1,10 ± 0,26 ; dégagements et tirs contrés 1,04 ± 0,29 ; taux de réussite − 0,27 ± 0,33 | les volumes, pas les taux |
| Les entraîneurs le suivent-ils ? | + 4,9 ± 0,8 point de titularisations par écart-type | oui (lu sur la saison précédente seulement) |

Le bloc mesure l'activité défensive, pas la qualité au sens du consensus. Cette activité vaut bien son prix dans les résultats, dans la plage où elle a été mesurée : environ ± 2 écarts-types. Un point Elo de valeur d'un défenseur central vaut 1,17 ± 0,25 point Elo de résultat. Le problème est ailleurs : un talent de + 4 sort de cette plage, et le calcul prolonge le prix en ligne droite là où aucun joueur n'était annoncé (personne au-dessus de + 3 dans le calibrage).

Quatre défauts réels ont été trouvés en chemin :

1. **Duels (score en service).** Les tentatives étaient additionnées avant que les vides aient leur zéro : cinq duels gagnés et aucun perdu devenaient cinq réussites pour zéro tentative. 4 à 6 % des matchs de joueurs de champ ; 0,07 écart-type en moyenne sur un talent de saison, 0,4 au plus. Corrigé dans `backend/vega/power.py` ([#71](https://github.com/VegaInteligence/Vega-Sport/issues/71)).
2. **3. Liga.** Depuis octobre 2026 la source livre des zéros à la place des statistiques : la compétition tombe à − 3,59 en 2026/2027. Défaut de données, à signaler et à filtrer.
3. **Effet de compétition.** L'attendu ne dépend que du rôle et de l'écart Elo. La compétition porte 14 % (2025/2026) puis 33 % (2026/2027) de ce qui sépare les défenseurs centraux.
4. **Échelle.** Les comptages sont asymétriques : sur une échelle linéaire, un seul match (15 récupérations et 7 interceptions) vaut 2,3 à lui seul.

### 12.3 La correction retenue

**La base**, pour tous les rôles de champ :

1. *Duels* : tentatives = gagnés + perdus, additionnés une fois les zéros rendus.
2. *Attendus en contexte.* Pour chaque rôle et chaque indicateur de volume, une régression de Poisson sur Δ = (Elo adverse − Elo propre) / 400 avant le match (le seul terme du calcul actuel, § 4.1), sur ln(passes tentées par l'adversaire / leur moyenne), et sur la place dans une défense à trois (axial ou excentré pour un défenseur central, simple indicateur de défense à trois pour les autres rôles). S'y ajoute un effet de la compétition et de la saison, rétréci vers zéro : u = ln((observé + k) / (attendu + k)), k = 50 actions. Les indicateurs conditionnels reçoivent le même effet rétréci sur leur taux.
3. *Échelle stabilisée.* L'écart d'un match n'est plus x − x̂ mais

$$
z = \sqrt{\frac{t}{90}}\;\frac{2\sqrt{x + 3/8} - c(\hat{x})}{s}
$$

où c(x̂) est l'espérance exacte de 2√(X + 3/8) pour une loi de Poisson de moyenne x̂, s la dispersion du rôle et t les minutes jouées. Une courte entrée en jeu ne pèse plus autant qu'un match entier.

**La borne.** Le talent défensif d'un joueur à un poste (après le rétrécissement du § 4.2) est borné entre − 2,0 et + 2,0 écarts-types. La règle : le prix du bloc a été vérifié jusqu'à environ 2 écarts-types, le score ne paie pas au-delà.

### 12.4 Ce que ça change, et ce que ça coûte

Saison 2026/2027 (4 486 joueurs, une seule grille de prix, sans le cas du soutien) :

| Variante | Sylla, ψ = 24 | Sylla, ψ = 10 | Sylla parmi les centraux (ψ = 24) | van Dijk (ψ = 24) |
| --- | --- | --- | --- | --- |
| Calcul des sections 4 et 11 | 3e (score 93) | 1er | 1er | 37e |
| Base seule | 11e (90) | 3e | 1er | 39e |
| Base + borne à 2,5 | 16e (88) | 5e | 1er | 39e |
| **Base + borne à 2,0 (retenu)** | **31e (86)** | **18e** | **6e** | 39e |
| Base + moitié volumes, moitié taux | 23e (87) | 12e | 3e | 18e |

| Variante | Prévision des matchs, validation | Prévision des matchs, test | Valeur marchande des centraux | Même joueur d'une saison à la suivante (centraux) |
| --- | --- | --- | --- | --- |
| Calcul des sections 4 et 11 | référence | référence | 0,202 | 0,729 |
| Base seule | − 9,3 ± 6,7 | + 2,9 ± 13,3 | 0,201 | 0,689 |
| Base + borne à 2,5 | − 9,0 ± 6,7 | + 2,9 ± 13,3 | 0,202 | 0,688 |
| **Base + borne à 2,0 (retenu)** | − 9,8 ± 6,8 | + 5,0 ± 13,4 | 0,204 | 0,686 |
| Base + moitié volumes, moitié taux | − 22,5 ± 10,9 | + 6,0 ± 20,3 | 0,186 | 0,632 |

Prévision : écart apparié par match face au calcul des sections 4 et 11, multiplié par 100 000 ; négatif veut dire moins bon (même plan d'expérience qu'au § 6).

- **La base** ne coûte rien de mesurable. La défense des centraux vaut toujours son prix (1,09 ± 0,27). Sur l'échelle stabilisée, plus aucun défenseur central ne dépasse + 3 écarts-types en 2025/2026, contre 3 avant. La stabilité des centraux baisse de 0,729 à 0,689 : une partie venait de l'effet de compétition, qui suit un joueur resté dans son championnat.
- **La borne à 2,0** touche vers le haut 5 défenseurs centraux sur 1 077 en 2026/2027 et 15 sur 2 695 en 2025/2026, aucun défenseur d'élite ; vers le bas, 3 et 12. Elle est gratuite, mais non prouvée. La part de valeur au-dessus de la borne a un écart-type de 0,39 point Elo, contre 7,9 pour tout le bloc des défenseurs : le test ne peut pas la voir (+ 1,5 ± 4,3 fois son prix), et borner ou non ne change pas la prévision (− 0,5 ± 0,8 en validation, + 0,8 ± 1,5 sur le test). Rien ne montre que la valeur s'arrête de croître au-dessus de 2, rien ne montre qu'elle continue.
- **Les dix premiers défenseurs centraux** en 2026/2027 à ψ = 24 deviennent : Upamecano (18e), Hill, Vušković, Huijsen, Gabriel, Sylla (31e), Tarkowski, Guéhi, van Dijk (39e), Jacquet.

### 12.5 Essayé et écarté

- **Un bloc fait seulement de taux de réussite.** La liste ressemble au consensus (van Dijk 1er défenseur central, Sylla 69e au général), mais elle prévoit moins bien les matchs (− 55,9 ± 20,3 en validation), suit moins la valeur marchande (0,20 → 0,15) et tient moins d'une saison à l'autre (0,73 → 0,61).
- **Moitié volumes, moitié taux.** Remonte van Dijk (39e → 18e), Saliba et Rúben Dias, avec un coût partout (tableaux du § 12.4 ; défense des centraux à 0,88 ± 0,30 de son prix). Le mélange n'a pas été remis à l'échelle et resserre les centraux de 5,2 à 4,5 points Elo, ce qui explique une partie de ce coût. À reprendre si le but devient de rapprocher la liste du consensus.
- **Le prix du bloc mesuré par famille de postes** au lieu du prix annoncé. Les écarts entre familles restent dans la marge d'erreur (centraux 1,05 ± 0,26, latéraux 0,84 ± 0,50, milieux défensifs 0,48 ± 0,38) et Sylla ne passe que de la 3e à la 5e place.

### 12.6 Limites

1. **À ψ = 10, Sylla reste le premier défenseur central** (18e au général), devant Tarkowski, Hill et Vušković. Avec un poids du club faible, la valeur propre domine et les joueurs de championnats moyens montent : c'est la question de ψ (§ 4.5), pas un reste du défaut.
2. **Les autres blocs ont des extrêmes plus lourds.** En 2025/2026, 22 avant-centres dépassent + 3 écarts-types en progression (maximum + 8,51) et 14 défenseurs centraux en création (maximum + 5,45). La plupart jouent dans de petits championnats, et le niveau de leur club les garde hors du haut du classement ; Sylla est sorti parce que l'Union est haute (+ 18 points Elo à ψ = 24). L'échelle stabilisée et la borne n'ont été testées que sur la défense : à tester sur ces deux blocs avant d'en faire une règle générale.
3. **E, E_s et les λ** des sections 4 et 6 n'ont pas été réestimés sur la nouvelle échelle.
4. **Le test des entraîneurs** ne lit que la saison précédente.
5. **Le classement de 2026/2027** repose sur un tiers de saison : le rang d'un joueur à 1 248 minutes doit afficher sa marge (§ 4.6).
