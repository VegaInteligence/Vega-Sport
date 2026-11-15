# Notes Vega : toutes les formules et leurs raisons

Ce document rassemble, en un seul endroit, chaque calcul qui donne une note à un championnat, à un club et à un joueur, avec sa formule, ses réglages et la raison de chacun. Il décrit ce que fait le code en service (`backend/vega/power.py`, méthode `power-ranking-v8`, 15 novembre 2026).

Pour chaque réglage, il dit s'il est **mesuré** sur la base ou **choisi**. Un réglage choisi exprime une préférence ou reprend la méthode de départ ([METHODE_CLASSEMENT_BALLON_D_OR.md](../../METHODE_CLASSEMENT_BALLON_D_OR.md)) ; il n'a pas été ajusté sur les données.

Les validations et les chiffres viennent de la base de production, lus en lecture seule. Le détail des essais est dans [l'audit du classement](../05-joueurs/08-audit-classement-puissance.md).

## 0. Vue d'ensemble

Tout est sur une seule échelle, en **points Elo**. 400 points d'écart entre deux équipes donnent dix contre un.

| Objet | Sa note | En une phrase |
| --- | --- | --- |
| Championnat | son niveau ℓ, avec une erreur-type | la force moyenne de ses clubs, tirée des matchs entre championnats, des joueurs qui changent de championnat et de sa division |
| Club | sa force Elo R | il entre au niveau de son championnat, puis chaque résultat la corrige, selon ce que les deux forces prévoyaient |
| Joueur | son score de 0 à 100 | ce qu'il fait au-dessus de l'attendu de son rôle, match par match, plus le niveau du club où il le fait, comparé aux joueurs de son rôle |

L'ordre des calculs :
1. lire les matchs ;
2. calculer les niveaux des championnats ;
3. dérouler l'Elo des clubs ;
4. évaluer chaque joueur dans chaque match ;
5. faire la somme sur l'année ;
6. donner l'indice, le score et le rang.

Chaque étape lit les forces **d'avant** le match : une performance garde le niveau de l'adversaire à cette date.

## 1. Les matchs lus

| Règle | Raison |
| --- | --- |
| Tous les matchs terminés des éditions PitchAPI : championnats, coupes, coupes d'Europe, Coupe du monde | la base de la méthode (§ 3) |
| Les matchs des sources complémentaires (coupes nationales, coupes des autres confédérations, tournois de sélections) entre deux équipes que PitchAPI connaît, quand ils ne doublent pas un match déjà lu (mêmes équipes à trois jours près) | ils relient les divisions d'un pays et les championnats entre eux ; un doublon compterait deux fois le même résultat |
| Le résultat est celui après prolongation ; une séance de tirs au but est un nul | les tirs au but ne disent rien de la force sur 120 minutes |
| Clubs et sélections sont deux ensembles à part | la méthode le demande (§ 3) : ils ne se rencontrent jamais |
| **Année du trophée** : du 1ᵉʳ août au 31 juillet ; un championnat d'année civile en donne la seconde moitié d'une édition et la première de la suivante | sinon une « saison » mêlait des championnats finis et d'autres au quatorzième match (audit, cause 3) |
| **Un vide vaut zéro** quand la ligne du joueur porte des statistiques et que la source publie la mesure, dans le même match (mesures courantes) ou la même édition (rares) | PitchAPI n'écrit jamais un xG à 0 et laisse vides la moitié des comptes : lus comme inconnus, un avant-centre sans tir n'avait pas de finition ce jour-là (audit, cause 5) |

## 2. L'enjeu d'un match

$$
I_m = \text{prestige de la compétition} \times \text{coefficient du tour}
$$

| Compétition | Prestige | Tour | Coefficient |
| --- | ---: | --- | ---: |
| Championnat, coupe nationale | 1,00 | Match ordinaire, phase de ligue, 3ᵉ place | 1,00 |
| Ligue Conférence | 1,04 | Élimination directe avant les demi-finales | 1,05 |
| Ligue Europa, Copa Sudamericana | 1,08 | Demi-finale | 1,10 |
| Coupe du monde des clubs | 1,10 | Finale | 1,15 |
| Ligue des champions, Copa Libertadores, Coupes des champions CONCACAF et CAF | 1,15 | | |
| Nations League | 1,05 | | |
| Euro, Copa América, CAN, Coupe d'Asie, Gold Cup | 1,20 | | |
| Coupe du monde | 1,30 | | |

- **Choisi** (version 3, 12 novembre 2026). La méthode garde l'enjeu hors du modèle « au départ » et appelle un bonus « un choix de récompense à expliciter » (§ 9). Le choix fait : un match de Ligue des champions pèse plus qu'un match de championnat, sa finale (1,32) plus que toute autre finale de clubs, et la finale de la Coupe du monde (1,50) plus que tout.
- Les coefficients de tour sont ceux de l'annexe A.4 de la méthode.
- Les compétitions des autres confédérations pèsent comme leur équivalent européen.
- **Contrôlé** : l'Elo ne prédit pas moins bien avec l'enjeu. Erreur quadratique à un match d'avance sur 729 matchs européens : 0,1659 → 0,1655.

## 3. La force d'un club (Elo)

Résultat attendu de l'équipe A contre B, avant le match :

$$
E_A = \frac{1}{1 + 10^{(R_B - R_A - h)/400}}
$$

Après le match, avec $r_A$ = 1 (victoire), ½ (nul) ou 0 (défaite) :

$$
R_A \leftarrow R_A + K\, I_m\,(r_A - E_A), \qquad R_B \leftarrow R_B + K\, I_m\,\big((1 - r_A) - (1 - E_A)\big)
$$

| Réglage | Valeur | Statut | Raison |
| --- | --- | --- | --- |
| $K$ | 20 | choisi | la méthode laisse $K$ ouvert (§ 12) ; valeur fixée à la mise en place, non ajustée sur la base |
| $h$, avantage du terrain | 60 points, 0 sur terrain neutre | choisi | idem ; le terrain neutre vient de la source (tournois, finales) |
| Entrée d'un club | le niveau ℓ de son championnat (§ 4) | mesuré | des Elo partis tous de 1500 n'ont pas d'échelle commune : un championnat sans match contre les autres garde 1500 de moyenne quel que soit son niveau (§ 3 de la méthode, audit cause 1) |
| Championnat d'un club | la compétition nationale PitchAPI où il a joué le plus de matchs dans sa première saison | — | un club promu ou relégué garde sa force ; son championnat d'entrée ne sert qu'à son point de départ |
| Club sans championnat dans la base | le championnat de son pays, qui ne la tient pas, est un « championnat de pays » du modèle (§ 4.6) | mesuré | sinon il entrait à 1500, valeur arbitraire |

- **Le rang d'un club** est celui de sa force après son dernier match de la saison, parmi les clubs (les sélections à part). Tout club qui a joué a une force et un rang.
- **Les sélections** suivent la même formule, entre sélections seulement.
- **Le niveau d'un championnat pour une saison**, celui que montre le site, est la force moyenne, après leur dernier match de la saison, des clubs qui l'ont joué cette saison-là. Un promu y entre, un relégué en sort.

## 4. Le niveau d'un championnat

### 4.1 Ce qu'on cherche

ℓ_j, le niveau du championnat j : la force à laquelle ses clubs entrent dans l'Elo. Trois preuves le disent, avec des précisions différentes. Le niveau retenu est le **maximum a posteriori** d'un seul modèle qui les réunit, chacune comptée selon sa précision : plus une preuve est précise, plus elle pèse.

**Pourquoi un seul modèle.** La version 3 retenait le niveau vers 1500 dans la proportion liens / (liens + 30). Elle avait deux défauts :
- **Ce n'était pas un a priori cohérent.** À l'équilibre, sa force baissait quand les liens augmentaient, et 1500 est arbitraire.
- **Compter les matchs ne dit pas si le niveau est mesuré.** Un groupe de championnats qui ne jouent qu'entre eux paraît bien mesuré alors que sa place face aux autres ne l'est pas.

Résultat : les petits championnats restaient près de 1500, et 31 championnats n'avaient pas de niveau du tout.

### 4.2 Les matchs entre championnats

On déroule l'Elo depuis les niveaux. Chaque match m entre un club du championnat a (à domicile) et un club du championnat b apporte à ces deux niveaux :

$$
g_a \mathrel{+}= I_m (r - E)\,c, \quad g_b \mathrel{-}= I_m (r - E)\,c, \qquad c = \frac{\ln 10}{400}
$$

$$
\Lambda_{aa} \mathrel{+}= I_m E(1-E)c^2, \quad \Lambda_{bb} \mathrel{+}= I_m E(1-E)c^2, \quad \Lambda_{ab} = \Lambda_{ba} \mathrel{-}= I_m E(1-E)c^2
$$

- $g$ est la **pente** de la vraisemblance des résultats, $\Lambda$ son **information**. Les matchs à l'intérieur d'un championnat s'annulent : seul compte ce que ses clubs font contre les autres.
- Les deux sont divisés par la **dispersion** $\varphi = \sum (r - E)^2 / \sum E(1-E)$, sur ces mêmes matchs (0,73). Les nuls rendent les résultats moins dispersés qu'un pile ou face, et l'information est d'autant plus grande.
- Matchs lus : coupes d'Europe, coupes nationales entre divisions, Coupe du monde des clubs, Copa Libertadores et Sudamericana, Coupes des champions CONCACAF et CAF.

### 4.3 Les joueurs qui changent de championnat

Un joueur qui change de championnat est le même joueur. Si son rendement baisse, son nouveau championnat est plus difficile.

**1. Le rendement d'un séjour.** Un séjour = les matchs de championnat d'un joueur de champ, sur une année du trophée, dans un championnat, d'au moins 600 minutes. Seuls les matchs de championnat comptent : un séjour en coupe d'Europe ou en sélection ne s'intercale jamais entre deux années d'un championnat.

$$
c = \frac{90\,T_\text{séjour}}{M_\text{séjour}} - \bar{c}_{\text{championnat, année}}
$$

On retire la moyenne du championnat cette saison-là, pondérée par les minutes. Raison : le style d'un championnat, plus ou moins ouvert, change le rendement de tous ses joueurs. Sans ce retrait, la Bundesliga et la Ligue 1 passaient sous le Championship.

**2. Ce qu'un joueur garde d'une année sur l'autre**, mesuré sur ceux qui sont restés dans leur championnat (9 599 joueurs) :

$$
c' = \alpha + \rho\, c, \qquad \rho = 0{,}63
$$

**3. Le changement d'un passage** du championnat a vers b :

$$
y = c_\text{après} - (\alpha + \rho\, c_\text{avant})
$$

Raison : un joueur part souvent après une bonne saison, et sa saison suivante redescend de toute façon. Sans ce retrait, la pente était gonflée (0,22 au lieu de 0,13).

**4. Le modèle.** Pour une paire de championnats, ȳ est la moyenne des passages : ceux de a vers b tels quels, ceux de b vers a de signe changé.

$$
\bar{y}_{ab} \sim \mathcal{N}\!\left(-\kappa^\ast \frac{\ell_b - \ell_a}{400},\; \frac{s^2}{n_{ab}} + \tau_u^2\right)
$$

- $s^2$ est la variance d'un passage.
- $\tau_u$ est l'écart propre à une paire au-delà de ses joueurs, mesuré par la méthode des moments (0,09) :

$$
\tau_u^2 = \overline{(\bar{y} + \kappa^\ast(\ell_b - \ell_a)/400)^2 - s^2/n}
$$

En points Elo, c'est un lien entre les deux niveaux :

$$
\ell_b - \ell_a \approx -400\,\bar{y}/\kappa^\ast, \qquad \text{précision } \frac{1}{(400/\kappa^\ast)^2 (s^2/n + \tau_u^2)}
$$

**κ\*, le taux d'échange** entre rendement et niveau : 0,132, **mesuré**. C'est la valeur qui rend le plus vraisemblables ensemble les matchs et les passages (profil de la vraisemblance : 0,131 ± 0,006).
- Les seuls passages à l'intérieur d'un pays donnent 0,17 ; il faut donc le lire entre 0,13 et 0,17.
- À 0,17, aucun championnat mesuré ne bouge de plus de la moitié de son erreur.

Seules les années du trophée **terminées** comptent. Un niveau ne relit donc jamais ce que la saison en cours lui renvoie.

### 4.4 L'a priori : la division et la confédération

Quand les preuves manquent, il faut un point de départ. Il est donné **en écarts** plutôt qu'en « retour à 1500 » :

- **Une division inférieure** se tient sous la division au-dessus d'elle, dans son pays, d'un écart de division $b$ par division. On prend la plus proche au-dessus, et la plus informée s'il y en a plusieurs :

$$
\ell_t - \ell_u \sim \mathcal{N}\big(-b\,(t-u),\; (t-u)\,\tau_b^2\big)
$$

  $b$ = 162 points et $\tau_b$ = 49, **mesurés** à chaque calcul sur les 11 paires de divisions que les matchs et les passages mesurent à 40 points près. On retire de leur dispersion ce qu'y met l'erreur de mesure.
- **Une première division** se tient à la moyenne de sa confédération :

$$
\ell \sim \mathcal{N}(\mu_\text{conf}, \tau_c^2)
$$

  - $\tau_c$ est l'écart-type entre premières divisions européennes mesurées à 60 points près, moins leur erreur de mesure : environ 112, **mesuré**.
  - $\mu_\text{conf}$ est la moyenne des premières divisions informées de la confédération, chacune pesée par $1/(\tau_c^2 + \text{se}^2)$, rapprochée de la moyenne d'ensemble comme le ferait un championnat de plus.
  - Il faut au moins **trois** championnats informés pour une moyenne propre. Sinon, c'est la moyenne d'ensemble (cas de la CAF, deux championnats).
  - Environ 1490 pour l'UEFA et la CONMEBOL, 1480 pour la CONCACAF, 1430 pour l'AFC.
- **Une division inférieure seule de son pays** dans la base :

$$
\ell \sim \mathcal{N}\big(\mu_\text{conf} - b(t-1),\; \tau_c^2 + (t-1)\tau_b^2\big)
$$

Les divisions sont relues une par une (`TIERS`). Le Paulista A1, championnat d'État joué par des clubs de Serie A et de Serie B, compte comme une deuxième division.

### 4.5 Le calcul

1. **Matchs et passages seuls**, avec un a priori très large (1500 ± 400) qui ne fixe que l'origine de l'échelle. On en tire $\tau_u$, puis $b$, $\tau_b$, $\tau_c$ et les moyennes de confédération.
2. **Les trois preuves ensemble.** Pas de Newton :

$$
\ell \leftarrow \ell + (\Lambda_\text{matchs} + \Lambda_\text{passages} + \Lambda_\text{a priori})^{-1}\,(g_\text{matchs} + g_\text{passages} + g_\text{a priori})
$$

   L'Elo est redéroulé à chaque pas, depuis les nouveaux niveaux. Le calcul s'arrête quand plus aucun niveau ne bouge de 0,25 point (7 pas en service). Au-delà de 40 pas, il échoue et les niveaux d'avant restent.
3. **L'origine de l'échelle.** Matchs et passages ne disent que des écarts. On décale tous les niveaux d'une même constante, pour que les championnats qui tiennent l'échelle gardent leur niveau d'avant. Ces championnats sont ceux mesurés à 25 points près contre le mieux mesuré : les cinq grands championnats, les championnats anglais, la 2. Bundesliga, les Pays-Bas, le Portugal.
4. **L'erreur-type** d'un niveau, contre la moyenne de ces championnats :

$$
\text{se}_j = \sqrt{v^\top \Lambda^{-1} v}, \qquad v = e_j - \tfrac{1}{|\text{réf}|}\mathbf{1}_\text{réf}
$$

### 4.6 Mesuré ou provisoire

Un championnat est **mesuré** quand se ≤ **45 points**. Il le reste jusqu'à **52**, pour qu'aucun championnat n'entre et ne sorte du classement à chaque calcul. Ses joueurs reçoivent un rang. Un championnat au-dessus est **provisoire** : il garde son niveau, affiché avec sa marge, et ses joueurs un score sans rang.

Pourquoi 45 : une erreur e sur le niveau déplace l'indice d'un joueur d'environ $e/(\sqrt{2}\,\sigma)$ écart-type de son rôle, σ = 132 étant l'écart-type des forces des clubs sur les matchs de championnat de 2026/2027. On veut au plus un quart d'écart-type : e ≤ 0,25 × √2 × 132 ≈ 47, arrondi à 45. À 60 points, ce serait 0,32.

**Les autres cas :**
- **Un club que la base ne connaît que par les coupes d'Europe** (Ferencváros, Shakhtar Donetsk) prend le pays de son homonyme dans le classement UEFA, quand un seul club porte ce nom. Le championnat de son pays, que la base ne tient pas, est un « championnat de pays » du modèle : ajusté sur les matchs de ses clubs, avec l'a priori de sa confédération. Il est tenu hors des réglages de l'a priori, parce que seuls les meilleurs clubs d'un pays jouent en Europe, et n'a pas de ligne à lui.
- **Un championnat féminin** est un univers à part : ses clubs ne rencontrent jamais les autres.

### 4.7 Validations (lecture seule, base du 14 novembre)

| Épreuve | Version 3 | Version 4 | Critère |
| --- | ---: | ---: | --- |
| Prédire les 5 004 matchs entre championnats joués après le 1ᵉʳ août 2025, niveaux calculés avant (log-loss) | 0,6517 | 0,6466 | plus bas |
| Idem, championnats de moins de 100 liens | 0,6542 | 0,6395 | plus bas |
| Championnats dont le résultat après le 1ᵉʳ août reste à ±2 écarts-types | 73 % | 94 % | ≥ 90 % |
| Prédire les 1 282 passages de 2026/2027 (pente observé / prédit) | 1,30 ± 0,19 | 1,11 ± 0,12 | 0,85 à 1,15 |
| Matchs seuls contre passages seuls, 31 championnats (rms des écarts réduits) | — | 1,03 | ≤ 1,3 |

## 5. La note d'un joueur

### 5.1 Son rôle dans chaque match

- Un **titulaire** a le rôle de son emplacement, lu avec la formation de son équipe (`role_of`). Le même emplacement n'est pas le même rôle partout : 103 et 107 sont les ailiers d'un 4-3-3 et les attaquants d'un 4-2-4.
- Un **remplaçant** prend le rôle qu'il a le plus joué dans la saison, sinon le rôle par défaut de sa ligne.
- Sept rôles : avant-centre, ailier / milieu offensif, milieu central, milieu défensif, latéral / piston, défenseur central, gardien.
- **Son rôle principal** est celui où il a le plus de minutes.

### 5.2 L'attendu de chaque mesure

**Mesures de volume** (buts hors penalty, xG hors penalty, tirs cadrés, passes décisives, xA, occasions et grosses occasions créées, passes dans le dernier tiers, passes et courses progressives, tacles, interceptions, récupérations, dégagements, tirs contrés, ballons touchés, ainsi que, comptées contre lui, grosses occasions manquées, dribbles subis, erreurs menant à un but, pertes de balle) :

$$
\hat{x} = \frac{t}{90}\,\exp(\alpha + \beta\,\Delta), \qquad \Delta = \frac{R_\text{adversaire} - R_\text{équipe}}{400} \text{ avant le match}
$$

- α et β sont ajustés par **maximum de vraisemblance de Poisson**, par rôle et par mesure, sur l'année. β = 0 en dessous de 200 matchs.
- Raison : c'est la « régression simple » de la méthode (§ 5.1). On attend moins d'un joueur dont l'équipe est dominée, et plus en jouant plus longtemps.

**Mesures conditionnelles** (dribbles réussis, duels et duels aériens gagnés, passes réussies) :

$$
\hat{x} = \text{tentatives} \times \text{taux de réussite du rôle}
$$

Raison : six duels gagnés sur huit ne disent pas la même chose que six sur vingt (§ 5.2).

**Gardiens.** Les buts évités (xGOT subis − buts encaissés) sont déjà un écart à l'attendu, donc $\hat{x} = 0$ (§ 7.2). S'y ajoutent les sorties aériennes et les poings, les sorties dans la profondeur, et les passes et longs ballons réussis.

Une mesure avec moins de 30 matchs de référence dans le rôle n'est pas évaluée.

### 5.3 L'écart standardisé et la contribution du match

$$
c_k = d_k\,\frac{x_k - \hat{x}_k}{s_{r,k}}, \qquad s_{r,k} = \sqrt{\overline{(x - \hat{x})^2}} \text{ dans le rôle}
$$

- $d_k$ vaut +1 si plus est mieux, −1 pour une erreur ou une perte. $s$ met les mesures sur une même échelle (§ 6.1).
- Une mesure **absente** est écartée du match, jamais lue comme zéro. Les poids des blocs sont alors répartis sur les blocs mesurés.

**Blocs.** Les mesures sont regroupées en blocs, à poids égaux à l'intérieur d'un bloc, pour ne pas compter deux fois des mesures liées (passes décisives, xA, occasions créées). Les blocs sont ensuite pondérés selon le rôle (§ 6.2 et § 7.3, poids choisis par la méthode) :

$$
C = \sum_\text{blocs} W_{r,b}\;\overline{c}_{b}
$$

| Rôle | Finition | Création | Progression | Défense | Conservation |
| --- | ---: | ---: | ---: | ---: | ---: |
| Avant-centre | 45 % | 20 % | 15 % | 10 % | 10 % |
| Ailier / milieu offensif | 20 % | 35 % | 25 % | 10 % | 10 % |
| Milieu central | 10 % | 25 % | 25 % | 20 % | 20 % |
| Milieu défensif | 5 % | 15 % | 20 % | 40 % | 20 % |
| Latéral / piston | 5 % | 25 % | 25 % | 30 % | 15 % |
| Défenseur central | 5 % | 5 % | 15 % | 55 % | 20 % |

Gardien : arrêts 60 %, jeu aérien 15 %, profondeur 10 %, relance 15 %.

$C$ est la **note du match** : 0 pour ce qu'on attend de son rôle dans cette situation, positif au-dessus.

### 5.4 Le niveau où il joue

$C$ compare un joueur à l'attendu de son rôle **dans la situation de son club**. Elle dit de combien il s'écarte du niveau de son club, pas où se trouve ce niveau. On le rajoute :

$$
L = \frac{t}{90}\,\frac{R_\text{club} - \bar{R}}{400}
$$

$\bar{R}$ est la force moyenne des clubs sur les matchs-joueurs de l'année, pondérée par les minutes. Les sélections ont leur propre moyenne.

Le poids κ du niveau est **choisi** pour que la moitié de ce qui sépare deux joueurs classés soit le niveau où ils jouent, et l'autre moitié ce qu'ils y font (`LEVEL_SHARE` = 0,5) :

$$
\kappa = \sqrt{\frac{\text{part}}{1 - \text{part}}}\;\frac{\sigma_\text{propre}}{\sigma_\text{niveau}}
$$

σ_propre et σ_niveau sont les écarts-types, parmi les éligibles classés, des taux régularisés de C (centrés par rôle) et de L. On trouve κ ≈ 0,65 en 2026/2027.

**Ce qui est mesuré à côté.** Le taux d'échange κ\* = 0,132 (§ 4.3) serait la valeur pour laquelle la note d'un joueur ne change pas quand il change de championnat. Le choix de la moitié vient de la version 2 et reste une décision à part. Essayé à 0,132 en lecture seule, κ remplit les trente premiers de joueurs de championnats faibles. La cause supposée, qu'un score lisant le rendement brut et non celui pris par rapport au championnat ne tient pas ce taux, n'est pas vérifiée.

### 5.5 L'année

$$
T = \sum_m I_m\,(C_m + \kappa L_m) \qquad \text{(contribution cumulée, § 8.1)}
$$

$$
R^\ast = \frac{90\,T}{M + \lambda}, \qquad \lambda = 450 \text{ minutes} \qquad \text{(par 90 minutes, régularisée, § 8.2)}
$$

- On fait la somme des contributions et des minutes **avant** de diviser. La moyenne des notes de match donnerait trop de poids aux courtes apparitions.
- λ = 450 minutes (réglage de la méthode) rapproche de zéro le taux d'un petit échantillon : 5 matchs ne valent pas 30.
- **L'enjeu multiplie l'ensemble**, « pénalités comprises » (annexe A.5) : un mauvais match de finale coûte plus cher aussi.

### 5.6 L'indice, le score et le rang

**Éligibilité** : 900 minutes dans l'année (§ 8.3), ou la moitié des minutes du joueur le plus utilisé tant que l'année est jeune (810 le 14 novembre 2026). Elle ne décide plus qui a un score, mais qui sert de **référence** : κ, moyennes et écarts-types du rôle, centiles, course au Ballon d'Or.

**Indice.** Pour un joueur éligible de rôle principal r :

$$
Z = 0{,}75\,\frac{T - \overline{T}_r}{\sigma_{T,r}} + 0{,}25\,\frac{R^\ast - \overline{R^\ast}_r}{\sigma_{R^\ast,r}}
$$

Moyennes et écarts-types sont pris parmi les éligibles du rôle dans un championnat mesuré. Les poids 0,75 et 0,25 sont ceux de la méthode (§ 8.3) : la contribution cumulée d'abord, le niveau moyen ensuite.

**Sous le seuil de minutes** (version 5) : tout joueur qui a joué a un indice. Il part du bas de son rôle et rejoint son propre indice à mesure que ses minutes approchent du seuil :

$$
Z = Z_\text{bas} + \min\!\left(1, \frac{M}{\text{seuil}}\right)(Z_\text{propre} - Z_\text{bas})
$$

$Z_\text{bas}$ est le 10ᵉ centile de l'indice des joueurs classés du rôle, $Z_\text{propre}$ l'indice calculé comme pour un éligible.

Pourquoi : prolonger la formule telle quelle mettait un joueur qui n'a pas joué au niveau moyen de son rôle (T = 0 vaut « autant qu'un joueur moyen »). Mesuré : environ 40 % des titulaires classés seraient passés derrière lui.

Une autre construction, mesurer chacun au-dessus d'un niveau de remplacement, a échoué sur la base : ce niveau change d'une année à l'autre et devient positif en début de saison. Celle-ci, mesurée en lecture seule sur 2024/2025 à 2026/2027 :
- aucun joueur de moins de 180 minutes dans le premier cinquième ;
- le rang médian s'améliore avec les minutes ;
- les éligibles gardent exactement leur indice et leur ordre ; la course au Ballon d'Or ne change pas.

Pourquoi un indice standardisé et pas des centiles (§ 8.3) : les centiles plafonnaient pour les premiers de chaque rôle, et ce plafond dépendait de la taille du rôle. L'ordre entre les meilleurs suivait donc le nombre de joueurs du rôle (audit, cause 4).

**Score affiché** (0 à 100, la forme du résultat attendu de l'Elo) :

$$
\text{score} = \frac{100}{1 + 10^{-Z/4}}
$$

| Z | −2 | 0 | 1 | 2 | 3 | 4 | 6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Score | 24 | 50 | 64 | 76 | 85 | 91 | 97 |

50 est la moyenne du rôle parmi les classés. Quatre écarts-types d'indice font dix contre un, comme 400 points d'Elo.

**Rangs.**
- Le **rang** est l'ordre de Z parmi tous les joueurs de son univers (hommes, femmes), puis T, puis les minutes, à égalité le même rang. Chaque univers est numéroté à partir de 1. Le **rang dans le rôle** suit le même ordre dans le rôle principal, et « sur N au poste » compte l'univers du joueur.
- Un rang est **provisoire** sous le seuil de minutes (`eligible` faux), dans un championnat provisoire (`linked` faux), dans un club qu'aucun championnat de la base ne connaît (vu seulement en coupe d'Europe, `in_league` faux), ou pour un joueur connu seulement par sa sélection. Le site en donne la raison. Le site le dit sur la fiche du joueur. L'incertitude d'un championnat provisoire est commune à tous ses joueurs : l'ordre entre eux est exact. Face aux autres, elle vaut environ ± 200 à 300 places dans les 500 premiers, et beaucoup plus au milieu du classement, où les joueurs sont serrés.
- **Centiles** des blocs et de T, R\* : rang moyen dans le rôle, (nombre en dessous + ½ égaux) / n.
- **Course au Ballon d'Or** : les trente premiers classés d'un club de première division.

Depuis la version 6 (15 novembre 2026), **tout joueur qui a joué a un rang**. Un joueur connu seulement par sa sélection, ou d'un club vu seulement en coupe d'Europe, est classé parmi les hommes, provisoirement : sa part de niveau vient de l'Elo de son équipe, mesurée contre les équipes de même nature (la moyenne des sélections pour une sélection), et son championnat n'est pas mesuré. Les joueuses d'un championnat féminin sont notées entre elles (leur propre κ, leurs propres moyennes et écarts-types) et ont leur propre classement. Un poste qui n'a encore aucun joueur éligible dans son univers (premiers jours d'une année, petit championnat féminin) est placé face aux joueurs éligibles de tous les postes de l'univers : C est déjà relatif à l'attendu du rôle, son centre est commun.

**L'a priori de la saison passée (version 8, 15 novembre 2026).** En début de saison, quelques matchs ne disent pas grand-chose ; la saison passée du joueur en dit davantage. L'indice affiché les mêle :

$$
Z = w\,\rho\,Z_{\text{préc}} + (1 - w)\,Z_{\text{saison}}, \qquad w = \frac{W}{M + W}\,\max\!\left(0,\ 1 - \frac{M}{B}\right)
$$

- **Les notations.** $Z_{\text{saison}}$ est l'indice de la seule saison (plancher compris sous le seuil de minutes) ; $Z_{\text{préc}}$ est l'indice de la seule saison passée ; $M$ est le nombre de minutes jouées cette saison.
- **W = 450 minutes** : le poids de l'a priori, comme λ. **B = 1 800 minutes** : à partir d'une vingtaine de matchs complets, l'a priori disparaît et le score ne décrit plus que la saison en cours.
- **ρ = 0,81 (mesuré)** : la corrélation de l'indice d'une année à l'autre, sur 11 070 joueurs éligibles les deux années (2024/2025 → 2025/2026). Elle ramène l'a priori vers la moyenne du poste.
- **W est divisé par deux** quand le joueur a changé de club ou de poste : son indice passé portait le niveau de l'ancien club et l'échelle de l'ancien poste.
- **Un joueur sans saison passée** garde son indice de la saison.

**La course au Ballon d'Or et le joueur de la saison** lisent l'indice de la seule saison : une récompense ne paie que cette saison.

**Mesuré avant la mise en service** (lecture seule, 2025/2026). On prédit l'indice du reste de la saison, calculé sur les seuls matchs suivants, à partir des premières semaines. La corrélation de rang passe :
- de 0,49 à 0,69 fin août ;
- de 0,59 à 0,72 fin septembre ;
- de 0,64 à 0,73 fin octobre.

Les 50 premiers prévus contiennent 23 des 50 premiers réels fin août, contre 5 sans a priori. Un réglage plus long (W = 900, B = 2 700) ne gagnait que 0,005 de corrélation et aurait gardé l'a priori presque toute la saison.

### 5.7 La note d'un match

Un joueur reçoit, pour chaque match, une note qui ne dépend **que de ce match** : un joueur faible qui fait un très grand match a une très bonne note ce jour-là, quel que soit son classement.

**Ce qu'elle mesure.**
- **La contribution C du match seule** (§ 5.3) : ce qu'il a fait au-dessus de l'attendu de son rôle face à cet adversaire.
- **Ni le niveau du club** : il ne dépend pas de ce que le joueur a fait. Un écart-type de niveau pèserait κ·132/400 ≈ 0,2, soit 26 à 59 % de l'écart-type d'un match.
- **Ni l'enjeu** : c'est la récompense du trophée, montrée à côté.

C est une somme sur le match dont l'attendu suit déjà les minutes : une entrée en jeu n'est ni favorisée ni pénalisée parce qu'elle est courte.

**Formule.**

$$
z_1 = \frac{C - \bar{c}_r}{\sigma_{r,\text{compétition}}}, \qquad \sigma^2_{r,\text{comp}} = \frac{n\,\sigma^2_\text{comp} + 300\,\sigma_r^2}{n + 300}
$$

$$
z = \Phi^{-1}\big(p\big), \quad p = \text{part des matchs de référence du rôle sous } z_1, \qquad \text{note} = \frac{100}{1 + 10^{-z/4}}
$$

- $\bar{c}_r$ et $\sigma_r$ sont la moyenne et l'écart-type des matchs complets (60 minutes ou plus) du rôle, dans l'**année de référence**. C'est la dernière année du trophée terminée ; une année terminée est sa propre référence. L'échelle existe ainsi dès le premier jour d'une saison et ne bouge pas avec elle. Une année en cours n'est jamais gardée comme référence : une saison qui suit celle en cours, sans année terminée juste avant elle, est notée sur ses propres matchs, et rien n'est gardé.
- **La dispersion d'une compétition** est rapprochée de celle du rôle : 56 couples compétition-rôle sur 493 avaient une dispersion hors de 0,8 à 1,25 fois celle de leur rôle.
- **Le score normal** Φ⁻¹(p) est la valeur d'une loi normale qui laisse la même part p en dessous. Avec un z simple, les gardiens n'avaient que 0,38 fois leur part des 1 % meilleurs matchs, leur dispersion gonflée par de rares grosses erreurs.
- 50 est un match ordinaire du rôle. La note du meilleur match jamais vu d'un rôle approche 90.

**Affichage** : à partir de 20 minutes, ou en dessous quand le match s'écarte d'un écart-type de l'ordinaire. Les minutes sont toujours à côté. Le joueur a aussi un rang dans le match.

**Mesuré sur 2025/2026 avant la mise en service.**

| Épreuve | Résultat | Critère |
| --- | ---: | --- |
| Centre, moyenne / écart-type des matchs complets | ≤ 0,034 | ≤ 0,05 |
| Écart-type d'un rôle, 2024/2025 → 2025/2026 | ± 1,3 % | ± 5 % |
| Matchs de moins de 30 minutes parmi les 1 % meilleurs | 3,0 % | ≤ 5 % |
| Corrélation de rang avec la note PitchAPI dans un match (médiane) | 0,57 | ≥ 0,5 |
| Joueurs du dernier quart des titulaires avec au moins un match noté 75 ou plus | 25 % | sensible |

**La seule note de match du site (version 7, 15 novembre 2026).** La note Vega remplace partout la note du fournisseur, qui n'est plus lue et a été retirée de la base (migration 108). Elle est gardée où sont les statistiques du match (`agg.player_match_grades` : z, l'année de référence, la première valeur, la date du dernier changement), et seule une note qui bouge est réécrite.

**Note de saison.** C'est la note du z moyen pondéré par les minutes, sur les matchs de 20 minutes ou plus :

$$
\bar{z} = \frac{\sum_i m_i\, z_i}{\sum_i m_i}, \qquad \text{note de saison} = \frac{100}{1 + 10^{-\bar{z}/4}}
$$

- **Pourquoi la moyenne des z.** La courbe écrase ses extrémités : environ 14 points par unité de z autour de 50, 10 vers z = 2. La moyenne des notes sous-estimerait les grands matchs.
- **Pourquoi pondérer par les minutes.** L'attendu de C croît avec les minutes, si bien que le z d'une courte entrée est tiré vers 0.
- **Pourquoi 20 minutes et non le seuil d'affichage.** Une courte entrée affichée parce que |z| ≥ 1 est choisie sur son résultat : la compter fausserait la moyenne.
- Les sommes de chaque édition (`agg.player_grade_editions`) s'additionnent entre éditions. La note de saison décrit les matchs joués ; le niveau du joueur reste le score du classement.

**Classer des notes de match.** Les meilleurs joueurs d'un match, le joueur de la semaine et le meilleur match de vos joueurs ne lisent que les matchs de 60 minutes ou plus, les matchs complets de la référence. Ils sont ordonnés par z.

**Couleurs.** Les paliers suivent les parts de matchs complets : 70 ou plus correspond à z ≥ 1,47, soit les 7 % meilleurs environ ; moins de 30, aux 7 % moins bons ; 40 à 60, au match ordinaire.

**Choisi** : 20 et 60 minutes, les paliers de couleur. **Mesuré** : la référence de chaque rôle.

## 6. Les sélections

- Même Elo, entre sélections.
- Leurs matchs entrent dans le classement des joueurs avec leur enjeu : Coupe du monde 1,30 ; Euro, Copa América, CAN, Coupe d'Asie et Gold Cup 1,20 ; Nations League 1,05.
- Le niveau L d'un match de sélection est celui de la sélection parmi les sélections.

## 7. Ce qui est mesuré et ce qui est choisi

| Réglage | Valeur | Statut |
| --- | --- | --- |
| Niveaux des championnats ℓ et leurs erreurs | § 4 | mesuré |
| Taux d'échange κ\* | 0,132 | mesuré (0,13 à 0,17) |
| Écart de division b, τ_b | 162, 49 | mesurés à chaque calcul |
| τ_c, moyennes de confédération | 112 ; 1430 à 1490 | mesurés à chaque calcul |
| Dispersion des résultats φ | 0,73 | mesurée à chaque calcul |
| α, β des attendus ; taux de réussite ; s | par rôle et mesure | mesurés chaque année |
| Seuil « mesuré » | 45 (52 pour rester) | déduit d'une tolérance choisie (¼ d'écart-type) |
| K, avantage du terrain | 20, 60 | choisis |
| Enjeux | § 2 | choisis |
| Poids des blocs par rôle | § 5.3 | choisis (méthode § 6.2, 7.3) |
| 75 % / 25 %, λ = 450, 900 minutes | | choisis (méthode § 8) |
| Bas d'un rôle pour les joueurs sous le seuil | 10ᵉ centile | choisi, vérifié en lecture seule |
| Note d'un match : référence, 300 matchs de rapprochement, 20 minutes | § 5.7 | référence mesurée, réglages choisis |
| Part du niveau du club | 0,5 (κ ≈ 0,65) | choisie ; à décider face à κ\* |
| Divisions des championnats | `TIERS` | relues à la main |

**Questions ouvertes :**
- la part du niveau du club (§ 5.4) ;
- λ : sur la base, la variance des matchs et celle entre joueurs donnent λ ≈ 175 à 250 minutes plutôt que 450. Le changer déplacerait tous les scores ; c'est une décision à part.
