# Notes Vega : toutes les formules et leurs raisons

Ce document rassemble, en un seul endroit, chaque calcul qui donne une note à un championnat, à un club et à un joueur, avec sa formule, ses réglages et la raison de chacun. Il décrit ce que fait le code en service (`backend/vega/power.py`, méthode `power-ranking-v8`, 15 novembre 2026).

Pour chaque réglage, il dit s'il est **mesuré** sur la base ou **choisi**. Un réglage choisi exprime une préférence ou reprend la méthode de départ ([METHODE_CLASSEMENT_BALLON_D_OR.md](../../METHODE_CLASSEMENT_BALLON_D_OR.md)) ; il n'a pas été ajusté sur les données.

Les validations et les chiffres viennent de la base de production, lus en lecture seule. Le détail des essais est dans [l'audit du classement](../05-joueurs/08-audit-classement-puissance.md).

## 0. Vue d'ensemble

Tout est sur une seule échelle, en **points Elo**. 400 points d'écart entre deux équipes donnent dix contre un.

| Objet | Sa note | En une phrase |
| --- | --- | --- |
| Championnat | son niveau ℓ et une marge interne en points Elo | la force moyenne de ses clubs, tirée des matchs entre championnats, des joueurs qui changent de championnat et de sa division |
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
| Les matchs des sources complémentaires (coupes nationales, coupes des autres confédérations, tournois de sélections) entre deux équipes que PitchAPI connaît, et tous ceux entre deux sélections (depuis le 16 novembre 2026), quand ils ne doublent pas un match déjà lu (mêmes équipes à trois jours près) | ils relient les divisions d'un pays et les championnats entre eux ; un doublon compterait deux fois le même résultat |
| Depuis le 17 novembre 2026 (VI-21) : **tous** les matchs des championnats et coupes d'open-matchday, de la Coupe d'Allemagne (OpenLigaDB seule : la copie d'open-matchday écrivait ses amateurs autrement, un match comptait deux fois), des archives des coupes nationales d'OpenFootball, de la Coupe de France, des Copas Libertadores et Sudamericana, de la Coupe des champions de la CONCACAF et de la Coupe du monde des clubs, même entre clubs que PitchAPI ne connaît pas | un seul Elo pour tous les matchs (décision du 16 novembre) ; les clubs professionnels de ces sources sont reliés à leur club (près de 250 orthographes revues une à une) |
| L'Elo applique lui-même les fusions que nomment les règles d'identification, avant le passage quotidien qui les écrit | une copie pas encore fusionnée joue comme son club, jamais comme un club à part (118 l'étaient le 17 novembre) |
| Depuis le 17 novembre 2026, après-midi : **toutes** les compétitions comptent, quelle que soit leur source, Ligue des champions africaine comprise (« chaque compétition doit être prise en compte dans les scores des équipes ») | un seul Elo, nourri de tous les matchs ; le niveau des pays africains que la base ne tient pas vient de l'a priori de leur confédération, estimé avec eux (§ 4.4) |
| Restent hors de l'Elo : un club contre une sélection, un match de coupe sans date, deux équipes non marquées « sélection » dans une compétition de sélections (nations historiques), les archives historiques (décision de l'utilisateur) et les copies d'une même compétition | ce ne sont pas des matchs entre clubs, ou ils compteraient deux fois |
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
| Club d'un championnat d'open-matchday que PitchAPI ne tient pas (17 novembre 2026) | le niveau de ce championnat, ajusté comme un « championnat de pays » : sa division (lue dans le nom du dossier, ENG_5 = 5ᵉ ; un championnat de réserve U21 = 3ᵉ) et son pays donnent l'a priori, ses matchs contre les autres le corrigent | mesuré | les clubs de 5ᵉ division anglaise ne partent pas au niveau de la Premier League |
| Club vu seulement dans les coupes de son pays (17 novembre 2026) | le niveau des « clubs de coupe » de son pays : une division sous le plus bas championnat que l'Elo tient de ce pays, corrigé par leurs matchs de coupe contre les clubs classés | mesuré | même raison ; un club amateur part sous la plus basse division connue |

- **Le rang d'un club** est celui de sa force après son dernier match de la saison, parmi les clubs (les sélections à part). Tout club de la source principale qui a joué a une force et un rang.
- **Les clubs sans force.** Mesuré le 17 novembre 2026 (VI-21), avant ces règles : 9 586 des 11 062 clubs qui ont joué un match de la base n'avaient pas de force. Après les deux étapes du 17 novembre (open-matchday, puis archives et coupes américaines), mesuré en mémoire sur la base : 3 060 équipes classées. Ce sont 607 clubs de plus que la veille ; 139 copies se fondent dans leur club. Pour les clubs de la source principale, l'écart médian est de 2,9 points (90ᵉ centile 15, maximum 37 : le championnat des Émirats, +32 pour une erreur de 65, par la Coupe du monde des clubs). Le 17 novembre après-midi, toutes les compétitions comptent : 3 141 équipes classées (83 de plus, surtout les clubs africains de la Ligue des champions de la CAF). Restent sans force : les clubs des seules archives historiques (7 520, que l'Elo ne lit pas, décision de l'utilisateur) et les équipes « à déterminer » des calendriers (« 2nd ranked », les places de l'Euro 2028).
- **Les sélections** suivent la même formule, entre sélections seulement.
- **Le niveau d'un championnat pour une saison**, celui que montre le site, est la force moyenne, après leur dernier match de la saison, des clubs qui l'ont joué cette saison-là. Un promu y entre, un relégué en sort.

## 4. Le niveau d'un championnat

### 4.1 Ce qu'on cherche

Le niveau initial ℓ_j détermine la force d’entrée des clubs du championnat j. Le calcul combine les résultats entre championnats, les passages de joueurs et les hypothèses de division et de confédération. Il résout un système itératif approché. La dérivée des mises à jour Elo successives manque dans le terme des matchs, ce qui invalide son interprétation comme maximum a posteriori de la vraisemblance séquentielle annoncée. [Calcul](../../../backend/vega/power.py) · [Contre-exemple du §3](../09-audit-2026-11/SOURCE_AUDIT.md)

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

- Pour un match entre deux championnats ajustés distincts, le code utilise +1 et −1 comme sensibilités de l’écart Elo aux deux niveaux initiaux. Il ajoute le résidu pondéré à $g$ et sa courbure locale à $\Lambda$. Tous les matchs font évoluer les Elo suivants, y compris les matchs internes. Le calcul de $g$ et de $\Lambda$ omet la propagation de ces dépendances.
- Les deux sont divisés par la **dispersion** $\varphi = \sum (r - E)^2 / \sum E(1-E)$, sur ces mêmes matchs (0,73). Les nuls rendent les résultats moins dispersés qu'un pile ou face, ce qui augmente le poids numérique du terme des matchs lorsque la dispersion est inférieure à 1.
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
- **Une première division** (ou un « championnat de pays » : les clubs d'un pays que la base ne tient pas) se tient à la moyenne de sa confédération, elle-même **inconnue et estimée avec eux** (depuis le 17 novembre 2026) :

$$
\ell = m_c + e, \qquad e \sim \mathcal{N}(0, \tau_c^2), \qquad m_c \sim \mathcal{N}(\mu, \sigma_c^2)
$$

  - $\tau_c$ est l'écart-type entre premières divisions européennes mesurées à 60 points près, moins leur erreur de mesure : environ 148, **mesuré**.
  - $\mu$ est la moyenne d'ensemble des premières divisions informées. $\sigma_c$ est l'écart des moyennes de confédération autour d'elle, mesuré sur celles qui ont au moins trois championnats informés, leur erreur retirée ; au moins 60 points.
  - Pourquoi : avant, chaque championnat de pays recevait son propre a priori, indépendant, à la moyenne mondiale. Une grappe de pays qui ne jouent qu'entre eux (la Ligue des champions africaine) comptait alors la même inconnue — le niveau de l'Afrique — une fois par pays. Elle tirait toute la grappe vers la moyenne mondiale, et l'Égypte avec (+108, deux fois son erreur). Avec une moyenne partagée, les matchs entre ces pays disent leurs écarts entre eux ; le niveau de l'Afrique face au monde vient des matchs entre continents (Coupe du monde des clubs) et des transferts.
  - Toutes les associations de la FIFA sont rattachées à leur confédération (et les membres associés que nomment les sources : Zanzibar, la Réunion, les départements français d'Amérique).
  - Mesuré le 17 novembre (lecture seule) : championnat d'Égypte +70 (erreur 55), d'Afrique du Sud +63 (erreur 63), Al Ahly 1779 ; les 12 championnats de référence bougent de 1,5 point au plus, les clubs PitchAPI de 1,4 en médiane. Avec $\sigma_c$ à 60, 100 ou 150, Al Ahly vaut 1779, 1764 ou 1755 : moins d'une erreur d'écart. Moyennes : UEFA 1425, CONMEBOL 1434, CONCACAF 1391, OFC 1382, AFC 1367, CAF 1363.
- **Une division inférieure seule de son pays** dans la base :

$$
\ell \sim \mathcal{N}\big(\mu_\text{conf} - b(t-1),\; \tau_c^2 + (t-1)\tau_b^2\big)
$$

Les divisions sont relues une par une (`TIERS`). Le Paulista A1, championnat d'État joué par des clubs de Serie A et de Serie B, compte comme une deuxième division.

### 4.5 Le calcul

1. **Matchs et passages seuls**, avec un a priori très large (1500 ± 400) qui ne fixe que l'origine de l'échelle. On en tire $\tau_u$, puis $b$, $\tau_b$, $\tau_c$ et les moyennes de confédération.
2. **Les trois sources réunies.** Le calcul résout le système linéaire suivant à chaque itération.

$$
\ell \leftarrow \ell + (\Lambda_\text{matchs} + \Lambda_\text{passages} + \Lambda_\text{a priori})^{-1}\,(g_\text{matchs} + g_\text{passages} + g_\text{a priori})
$$

   L'Elo est redéroulé à chaque pas, depuis les nouveaux niveaux. Le calcul s'arrête quand plus aucun niveau ne bouge de 0,25 point (7 pas en service). Au-delà de 40 pas, il échoue et les niveaux d'avant restent.
3. **L’origine de l’échelle.** Le code décale ensemble les niveaux ajustés pour conserver, en moyenne, les valeurs antérieures des références disponibles. Les groupes hors ajustement gardent l’initialisation du lecteur. Ce décalage peut donc modifier l’espérance d’une rencontre entre groupes ajustés et groupes laissés à leur valeur initiale. Les références sont les championnats ordinaires à moins de 25 points de marge relative à la meilleure référence, avec repli sur celle-ci. Les cinq grands championnats, les divisions anglaises, la 2. Bundesliga, les Pays-Bas et le Portugal sont des exemples de la mesure historique.
4. **Marge interne d’un niveau.** Le code inverse la matrice approchée et mesure l’écart à la moyenne des références selon la formule ci-dessous. La calibration de cette marge comme erreur-type d’un estimateur séquentiel reste à établir.

$$
\text{se}_j = \sqrt{v^\top \Lambda^{-1} v}, \qquad v = e_j - \tfrac{1}{|\text{réf}|}\mathbf{1}_\text{réf}
$$

### 4.6 Mesuré ou provisoire

Pour les championnats masculins ajustés, le statut **mesuré** s’ouvre lorsque la marge interne vaut au plus **45 points** et se conserve jusqu’à **52 points** inclus. Au-delà, le championnat garde son niveau et sa marge avec le statut **provisoire**. Dans le classement de puissance des joueurs, un indice publié donne toujours un rang dans son univers. Le statut provisoire du championnat masculin peut rendre ce rang provisoire.

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

### 4.8 Le score sur 100 d'un club et d'un championnat

Route : `/api/rankings/power?kind=clubs` (champ `score`) et `/api/rankings/leagues` (champ `score`), dans [rankings.mjs](../../../backend/api/src/routes/rankings.mjs) (`outOf100`). Le site les montre dans l'onglet Clubs du Power Ranking et sur la carte « Niveau du championnat ». L'Elo et le niveau restent affichés à côté.

Le score est la **chance de battre la référence sur terrain neutre**, un nul comptant pour moitié, c'est-à-dire l'espérance de l'Elo :

$$
\text{score} = \frac{100}{1 + 10^{-(R - R_\text{réf})/400}}
$$

- **R** : l'Elo du club après son dernier match de la saison, ou le niveau du championnat (la force moyenne de ses clubs, dernière saison).
- **R_réf** : le niveau moyen des premières divisions masculines mesurées (§ 4.6), chacune comptant pour une. Tant qu'aucune n'est mesurée, c'est la moyenne de tous les championnats masculins.

**Lecture.** 50 = au niveau d'un championnat moyen de premier rang mesuré. 76 = 200 points au-dessus : il battrait trois fois sur quatre un club de ce niveau. 91 = 400 points au-dessus.

**Pourquoi cette forme.** Elle ne demande aucun réglage de plus : c'est la loi de l'Elo lui-même, et le score garde l'ordre de l'Elo. Une échelle de 0 à 100 bornée par le meilleur et le moins bon club changerait de sens à chaque match du dernier club.

**Ce qui est choisi.** La référence, une moyenne de championnats et non un club. Elle bouge un peu à chaque calcul des niveaux, et tous les scores avec elle.

Pas de score pour un championnat féminin, univers à part, ni pour une sélection nationale : la référence est faite de clubs.

**Ce qui étaye le niveau, sur la carte.** Le nombre de matchs contre d'autres championnats (`links`) et le nombre de joueurs passés d'un championnat à l'autre (`movers`), avec la marge quand le niveau est mesuré. Un niveau provisoire garde sa phrase et sa marge.

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
- Sur la fiche et dans le classement complet, le rang est **provisoire** si le seuil de minutes n’est pas atteint. Ensuite, le lecteur donne aux hommes d’une sélection seule, d’un club sans championnat dans la base ou d’un championnat de niveau provisoire le motif correspondant. Une joueuse admissible en minutes a un rang dans l’univers féminin sans motif de ligue provisoire. Le statut renseigne sur la fiabilité des entrées. La marge interne de la ligue ne fournit pas un intervalle statistique validé pour le rang du joueur.
- **Centiles** des blocs et de T, R\* : rang moyen dans le rôle, (nombre en dessous + ½ égaux) / n.
- **Course au Ballon d'Or** : les trente premiers classés d'un club de première division.

Depuis la version 6 (15 novembre 2026), **tout joueur doté d’un indice a un rang dans son univers**. Un joueur connu seulement par sa sélection, ou d'un club vu seulement en coupe d'Europe, est classé parmi les hommes, provisoirement : sa part de niveau vient de l'Elo de son équipe, mesurée contre les équipes de même nature (la moyenne des sélections pour une sélection), et son championnat n'est pas mesuré. Les joueuses d'un championnat féminin sont notées entre elles (leur propre κ, leurs propres moyennes et écarts-types) et ont leur propre classement. Un poste qui n'a encore aucun joueur éligible dans son univers (premiers jours d'une année, petit championnat féminin) est placé face aux joueurs éligibles de tous les postes de l'univers : C est déjà relatif à l'attendu du rôle, son centre est commun.

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
| Coupes européennes : prolongation, tirs au but | ⅓ d'un match ; 50/50 | choisis le 16 novembre 2026 ([pronostics](../06-accueil-et-matchs/03-pronostics-et-projections.md)) |

**Questions ouvertes :**
- la part du niveau du club (§ 5.4) ;
- λ : sur la base, la variance des matchs et celle entre joueurs donnent λ ≈ 175 à 250 minutes plutôt que 450. Le changer déplacerait tous les scores ; c'est une décision à part.
- les clubs sans Elo (2 066 au 16 novembre 2026, copies non reliées et clubs des seules sources complémentaires) : les faire entrer dans l'Elo unique ([pronostics](../06-accueil-et-matchs/03-pronostics-et-projections.md)), en attente.

## 8. Les blocs du profil lus dans la base (16 novembre 2026)

Ces cinq blocs montraient des valeurs de maquette. Ils sont maintenant calculés sur les données collectées ; aucune étiquette n'est inventée : une zone, un pied ou un style n'est nommé que si les chiffres le disent nettement.

### 8.1 L'effectif d'un club

- La fiche du club donne la valeur de l'effectif, celle de ses 18 joueurs les mieux cotés, l'âge moyen et le nombre de joueurs, le jour où elle est lue. Elle est relue chaque mois pour les deux dernières saisons (migration 117).
- La valeur n'existe qu'au présent : elle n'est montrée que pour la saison en cours, avec sa date.
- Le rang se calcule parmi les clubs du championnat qui ont une valeur, dès que les trois quarts en ont une. La page dit combien : « 2ᵉ des 19 clubs estimés du championnat (sur 20) », ou « 2ᵉ du championnat sur 20 » quand tous en ont une.
- Un club de la base est relié à sa fiche quand au moins 3 de nos joueurs reliés y sont vus pendant qu'ils jouent pour lui (à 30 jours près), avec 60 % des voix dans les deux sens. Un joueur est vu à un club par chacune de ses valeurs (le club du jour de l'estimation) et, depuis le 16 novembre, par sa fiche (son club le jour où elle est lue). Un joueur mis en doute ne vote pas. Le rattachement passe une fois par jour.
- Âge pondéré par les minutes : Σ (âge + 0,5) × minutes / Σ minutes, sur les minutes dont l'âge est connu. Un joueur sans date de naissance chez nous prend celle de sa fiche quand il y est relié (jamais pour un lien mis en doute) ; la base garde la sienne seule. L'âge est en années révolues au jour du match ; + 0,5 corrige ce demi-an manquant en moyenne. Montré seulement si les âges connus couvrent au moins 90 % des minutes et au moins 4 950 minutes (cinq matchs complets).

### 8.2 Le physique

- Données : distance, distance en course, distance en sprint, nombre de sprints et vitesse de pointe de chaque match suivi. Seules certaines compétitions sont suivies (au 16 novembre : Ligue des champions 2024/25 et 2025/26, Premier League 2026/27 sur 93 des 100 matchs).
- Chaque valeur est ramenée à 90 minutes : 90 × Σ valeur / Σ minutes, sur les matchs qui la donnent.
- Vitesse de pointe : une valeur au-dessus de 38 km/h est écartée (aucun joueur suivi n'y arrive ; 24 valeurs au-dessus de 100 dans la base), comme une valeur sur moins de 20 minutes. Le centile porte sur la **médiane** des pointes de match, pas sur le maximum de la saison : le maximum grandit avec le nombre de matchs. Le maximum est affiché à part.
- Comparaison : les joueurs du même rôle du classement Vega suivis au moins 450 minutes dans la même compétition et la même saison. Si le rôle en compte moins de 30, sa ligne (défenseurs, milieux, attaquants) ; un gardien n'est comparé qu'aux gardiens. Moins de 10 joueurs : pas de centile.
- Centile : part des joueurs en dessous, les égalités comptées pour moitié.
- « Reste de la distance » : distance − course − sprint, sans seuil de vitesse connu.
- Accélérations, décélérations et baisse en deuxième mi-temps : pas de donnée, rien n'est affiché.
- **Charge de matchs** (tous les joueurs, sans suivi) : sur les matchs joués de la sélection (minutes > 0), le nombre de matchs, de titularisations, de matchs complets (90 minutes ou plus), les minutes et leur moyenne par match ; le repos médian en jours entre deux matchs joués ; les enchaînements courts, un match 3 jours ou moins après le précédent (samedi-mardi) ; les minutes des 28 jours qui finissent à son dernier match. Les matchs où il n'est pas entré ne comptent pas : le repos se mesure entre ses matchs joués.

### 8.3 Le profil de jeu

- **Zone** : les cartes d'activité de la saison additionnées (16 cases dans la longueur, attaque vers la droite ; 12 dans la largeur). Tiers : cases 0 à 4, 5 à 10, 11 à 15. Côtés : cases 0 à 3 de la largeur pour sa droite, 8 à 11 pour sa gauche (vérifié sur des ailiers et latéraux connus des deux côtés). Une carte dont les cases ne font pas le total de ses actions est écartée. Une zone est nommée si elle a au moins 45 % des actions et 10 points de plus que la suivante ; sinon « répartie ». Les tiers n'ont pas la même surface (5, 6 et 5 cases) : la part de chaque tiers est d'abord rapportée à son nombre de cases, sinon le tiers central passerait devant par sa seule taille (un avant-centre y a souvent le plus d'actions). Le texte affiche les parts brutes. Il faut 5 matchs.
- **Pied** : les tirs de la saison hors penalties et contre son camp. « Surtout du pied droit » (ou gauche) à 70 % des tirs du pied ou plus ; la part de la tête à part. C'est le pied avec lequel il frappe, pas son pied fort déclaré. La répartition entre les pieds ne compte que les tirs du pied ; la part de la tête est donnée sur tous ses tirs. Il faut 10 tirs.
- **Surface** : part de ces tirs pris dans la surface ; « de près » à 80 % ou plus, « souvent de loin » à 50 % ou moins.
- Pas d'étiquette tirée des centiles (« dribbleur » au-dessus d'un seuil) : elle répéterait « Points forts » avec un seuil arbitraire.

### 8.4 Le contexte d'équipe

- Le style du club est celui de la page club : mêmes valeurs, mêmes centiles dans son championnat, mêmes étiquettes (seuils 75 et 25 des centiles).
- Part des passes reçues : Σ passes reçues / Σ passes de son équipe, sur les réseaux de passes où il figure. Un réseau couvre un match jusqu'au premier changement. Il faut 5 réseaux. Son centile se calcule parmi les joueurs de son rôle dans le même championnat, avec la même règle de repli qu'au § 8.2. Au-dessus de 50, il se lit « plus que X % des … » ; en dessous, « moins que (100 − X) % des … ».

### 8.5 La saison précédente dans les comparaisons

- Ses centiles de la saison précédente, face aux joueurs de son groupe de poste de cette saison-là, dans les mêmes compétitions, avec les mêmes indicateurs et le même seuil de minutes. La lecture ne part que si la comparaison est demandée.
- Sous le seuil de minutes, ou absent de ces compétitions à ce poste : rien n'est tracé, la raison est dite.

| Réglage | Valeur | Statut |
| --- | --- | --- |
| Vitesse de pointe retenue | ≤ 38 km/h, 20 minutes ou plus | choisi |
| Minutes pour être comparé (physique) | 450 | choisi |
| Taille d'un rôle avant repli sur la ligne | 30 joueurs | choisi |
| Zone nommée | 45 % et 10 points d'avance | choisi |
| Pied nommé | 70 %, 10 tirs | choisi |
| Couverture de l'âge pondéré | 90 %, 4 950 minutes | choisi |
| Réseaux de passes | 5 | choisi |
