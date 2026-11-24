# Classement Ballon d’Or — méthode mathématique

## 1. Objectif et provenance

Construire un classement personnel à partir des performances de chaque joueur dans chaque match, en tenant compte du rôle joué, du temps de jeu et du contexte des équipes.

Source : discussion ChatGPT [« Créer classement Ballon d’Or »](https://chatgpt.com/c/6ae636c9-95a4-83eb-9639-06e8dfbdce60), consultée le 31 octobre 2026. Les quatre réponses de GPT disponibles ont été lues ; deux développent la méthode mathématique, les deux suivantes traitent des fournisseurs et du calcul des gardiens avec PitchAPI.

La discussion contient deux versions successives :

1. Un **barème offensif**, conservé en annexe A pour retrouver toutes les formules initiales.
2. Une **méthode d’excellence relative par rôle**, proposée ensuite par GPT pour permettre une comparaison entre attaquants, milieux, défenseurs et gardiens. Elle constitue le fil directeur des sections 2 à 9.

La section 10 présente l’alternative fondée sur la valeur des actions. Les coefficients proposés sont des réglages initiaux, sans validation empirique dans cette discussion. Aucun classement n’a été calculé.

Les équations sont réorganisées avec une notation commune. Les précisions ajoutées lors de cette mise en ordre sont signalées dans la section 12 ; elles ne constituent pas des décisions prises dans la discussion.

## 2. Notation

| Symbole | Définition |
|---|---|
| $j$ | Joueur |
| $m$ | Match |
| $k$ | Indicateur individuel |
| $r$ | Rôle joué pendant le match ou la séquence évaluée |
| $t_{jm}$ | Minutes du joueur $j$ dans le match $m$ |
| $M_j$ | Total de ses minutes sur la période retenue |
| $x_{jmk}$ | Valeur observée de l’indicateur $k$ |
| $\widehat{x}_{jmk}$ | Valeur attendue pour ce rôle et ce contexte |
| $d_k$ | Sens favorable de l’indicateur : $+1$ ou $-1$ |
| $s_{r,k}$ | Dispersion de référence de l’indicateur pour le rôle |
| $c_{jmk}$ | Écart orienté et standardisé à la référence |
| $w_{r,k}$ | Poids de l’indicateur pour le rôle |
| $C_{jm}$ | Contribution du joueur dans le match, selon la méthode par rôle |
| $T_j$ | Contribution cumulée sur la période |
| $R_j^\star$ | Contribution par 90 minutes régularisée |
| $\lambda$ | Volume de régularisation, exprimé en minutes |
| $\operatorname{Pct}_r$ | Percentile dans l’univers éligible du rôle |
| $B_j$ | Score final de la méthode par rôle |

Les lettres propres au barème historique sont définies dans l’annexe A. Les scores de ces deux méthodes ne doivent pas être additionnés.

## 3. Évaluer la force des équipes avant chaque match

La force d’une équipe se calcule indépendamment des notes individuelles. GPT propose une mise à jour de type Elo :

$$
\text{Force après match}
=\text{Force avant match}
+K_{\mathrm{Elo}}\left(\text{Résultat obtenu}-\text{Résultat attendu}\right).
$$

$K_{\mathrm{Elo}}$ contrôle l’ampleur de la mise à jour. Sa valeur, l’initialisation des équipes et la formule du résultat attendu n’ont pas été définies dans la discussion.

L’ordre des opérations est essentiel :

1. Enregistrer les forces des deux équipes **avant** le match.
2. Employer ces forces pour contextualiser les performances individuelles.
3. Actualiser les forces après le résultat, pour les matchs suivants.

Une performance passée conserve ainsi le niveau de l’adversaire à cette date. Les championnats doivent être reliés par les rencontres internationales de clubs : des Elo calculés séparément avec la même moyenne ne créent pas automatiquement une échelle commune. Les clubs et les sélections restent deux ensembles distincts.

Mise en œuvre pour les sélections (23 novembre 2026, `backend/vega/power.py`, FAILURE_MODES §51) : une passe à part, à partir du 1ᵉʳ juillet 2021, sur tous les matchs entre deux sélections (phases finales, éliminatoires, Ligues des nations, tournois mineurs, amicaux). Pas K = 30 × w × G, où G vaut 1 jusqu’à un but d’écart, 1,5 pour deux, (11 + écart) / 8 au-delà, et w l’enjeu du match pour une phase finale (Coupe du monde 1,30, Euro et championnats continentaux 1,20, Ligue des nations 1,05, tours compris), 1 pour un éliminatoire, 0,75 pour un autre tournoi, 0,5 pour un amical. Chaque sélection part de ses points FIFA du 18 février 2021 (1 point FIFA = 1 point Elo, l’édition centrée sur 1500 ; 1500 pour une sélection que l’édition ne classe pas). Les matchs antérieurs gardent l’Elo d’avant (K 20, départ 1500), qui ne nourrit plus les saisons depuis 2021/22. Le classement mondial d’une saison liste les sélections ayant joué dans les deux ans précédant sa date de référence, provisoire sous 8 matchs en quatre ans.

Une extension envisagée consiste à séparer la force offensive et la force défensive. La discussion n’en fournit pas les équations.

## 4. Définir les rôles et les occasions d’agir

| Rôle | Dimensions à mesurer |
|---|---|
| Avant-centre | Production de buts, occasions obtenues, finition, création |
| Ailier / milieu offensif | Création, progression, dribbles utiles, buts, pertes |
| Milieu central | Progression, création, conservation, défense |
| Milieu défensif | Protection, interceptions, récupération, progression, sécurité de relance |
| Latéral / piston | Création et progression sur le côté, duels défensifs, récupération |
| Défenseur central | Défense des situations dangereuses, duels aériens, interceptions, erreurs, relance |
| Gardien | Arrêts, sorties, jeu aérien, profondeur, relance |

Le rôle pertinent est celui joué dans le match, plutôt que la seule étiquette du joueur dans le fournisseur de données.

Le contexte doit aussi décrire les occasions d’agir. Six interceptions face à 80 séquences adverses ne s’interprètent pas comme six interceptions face à 30 séquences. Le taux de passes réussies dépend de la difficulté des passes ; le nombre de buts encaissés ne suffit pas à évaluer un gardien.

## 5. Estimer la performance attendue

### 5.1 Indicateurs de volume

Pour un indicateur tel que le nombre de passes clés :

$$
\widehat{x}_{jmk}
=\frac{t_{jm}}{90}\times
\widehat{\text{passes clés par 90}}.
$$

Le taux attendu peut dépendre du rôle, de la force de l’adversaire, de celle de l’équipe et du domicile ou extérieur. Si les données le permettent, il peut aussi intégrer la possession pendant la présence du joueur et les situations à dix contre onze.

Les références doivent être estimées sur un historique large, au-delà des seuls candidats au Ballon d’Or. GPT évoque une régression simple sans en fixer la famille ni les coefficients.

### 5.2 Indicateurs conditionnels

Pour les duels, l’exposition pertinente est le nombre de tentatives :

$$
\text{Duels gagnés attendus}
=\text{Duels disputés}\times
\text{Probabilité attendue de gagner un duel}.
$$

Cette équation évite de traiter un nombre de duels gagnés sans tenir compte des occasions d’en disputer.

## 6. Transformer chaque indicateur en contribution

### 6.1 Écart orienté et standardisé

$$
\boxed{
c_{jmk}
=d_k\frac{x_{jmk}-\widehat{x}_{jmk}}{s_{r,k}}
}
$$

- $d_k=+1$ lorsqu’une valeur plus élevée est souhaitable.
- $d_k=-1$ pour les erreurs ou pertes lorsque leur augmentation est défavorable.
- $s_{r,k}$ met les indicateurs sur des échelles comparables ; il est fixé à partir de l’historique du rôle.

Exemple fictif de la discussion : un défenseur réalise quatre interceptions. Si l’attendu est deux, l’écart brut est $+2$ ; s’il est quatre, l’écart vaut zéro ; s’il est six, l’écart vaut $-2$. La valeur standardisée dépend ensuite de $s_{r,k}$.

Cet ajustement dépend de la qualité de l’attente estimée. La formule ne garantit pas à elle seule que les contextes soient correctement comparés.

### 6.2 Combinaison selon le rôle

$$
\boxed{C_{jm}=\sum_k w_{r,k}\,c_{jmk}}
$$

GPT propose de regrouper les indicateurs en blocs avant de les pondérer, pour limiter les doubles comptes. Les passes décisives, passes clés et xA décrivent notamment des aspects corrélés de la création.

La table suivante donne des **poids de blocs**, tandis que $w_{r,k}$ désigne dans l’équation un **poids d’indicateur**. La répartition interne aux blocs reste à définir ; la discussion ne donne pas de formule supplémentaire pour cette étape.

| Rôle | Finition | Création | Progression | Défense | Conservation |
|---|---:|---:|---:|---:|---:|
| Avant-centre | 45 % | 20 % | 15 % | 10 % | 10 % |
| Ailier / milieu offensif | 20 % | 35 % | 25 % | 10 % | 10 % |
| Milieu central | 10 % | 25 % | 25 % | 20 % | 20 % |
| Milieu défensif | 5 % | 15 % | 20 % | 40 % | 20 % |
| Latéral / piston | 5 % | 25 % | 25 % | 30 % | 15 % |
| Défenseur central | 5 % | 5 % | 15 % | 55 % | 20 % |

Chaque ligne totalise 100 %. Ces poids expriment des préférences de classement et doivent être soumis à une analyse de sensibilité.

## 7. Traiter les gardiens

### 7.1 Arrêts au-dessus de l’attendu

$$
\boxed{
\text{Buts évités au-dessus de l’attendu}
=\text{PSxG subis}
-\text{Buts encaissés correspondants}
}
$$

Les PSxG sont des estimations après exécution du tir. L’exemple fictif donné par GPT est :

$$
2{,}3-1=+1{,}3.
$$

Le périmètre des buts comptés doit correspondre à celui des tirs modélisés.

### 7.2 Variante évoquée pour PitchAPI

La dernière réponse transpose ce calcul aux xGOT annoncés pour les tirs :

$$
\boxed{
\text{Buts évités}
=\sum_{\text{tirs correspondants}}\text{xGOT subis}
-\text{Buts encaissés correspondants}
}
$$

Il faut vérifier les identifiants des gardiens, les xGOT manquants et les exclusions pertinentes, notamment les tirs bloqués. Les PSxG et les xGOT désignent ici deux formulations évoquées dans la discussion ; leur interchangeabilité entre fournisseurs n’est pas établie.

### 7.3 Pondération initiale des blocs gardien

| Bloc | Poids proposé |
|---|---:|
| Arrêt des tirs | 60 % |
| Jeu aérien | 15 % |
| Couverture de la profondeur | 10 % |
| Relance | 15 % |

Ces blocs totalisent 100 %. Les arrêts ne mesurent pas à eux seuls les sorties, la relance ou la gestion de la profondeur. Les métriques et références des trois autres blocs restent à préciser selon les données disponibles.

## 8. Agréger sur la période

### 8.1 Contribution cumulée

$$
\boxed{T_j=\sum_m C_{jm}}
$$

$T_j$ est la somme des contributions au-dessus de la référence. Il peut être négatif.

### 8.2 Contribution par 90 minutes régularisée

$$
\boxed{R_j^\star=\frac{90T_j}{M_j+\lambda}}
$$

Réglage de départ proposé : $\lambda=450$ minutes. Comme le score est centré sur la référence, la régularisation rapproche les taux issus de petits échantillons de zéro.

Il faut agréger les contributions et les minutes avant de calculer le taux. La moyenne des taux par 90 de chaque match donnerait trop d’importance aux courtes apparitions.

### 8.3 Score final par percentiles

$$
\boxed{
B_j=0{,}75\,\operatorname{Pct}_r(T_j)
+0{,}25\,\operatorname{Pct}_r(R_j^\star)
}
$$

Les percentiles sont exprimés de 0 à 100 et calculés parmi les joueurs éligibles du rôle dans un univers fixé à l’avance. Le score privilégie la contribution cumulée (75 %) et complète par le niveau moyen régularisé (25 %).

La première proposition fixait un seuil initial de 900 minutes pour une saison complète. La seconde formule ne redéfinit pas ce seuil : le conserver pour la méthode par rôle reste une décision à prendre.

Pour les joueurs à plusieurs rôles, GPT demande de conserver les contributions par rôle et une référence cohérente avec leur mélange. **Aucune formule de fusion des rôles n’a été arrêtée.**

## 9. Interpréter le classement et éviter les doubles comptes

Le score final mesure l’**excellence relative au rôle**. Un défenseur au 98e percentile et un attaquant au 98e percentile sont chacun exceptionnels dans leur groupe ; cela ne prouve pas une contribution identique en buts ou en victoires.

La proposition la plus récente garde l’enjeu du match hors du modèle de performance au départ. Un bonus de finale serait un choix de récompense supplémentaire à expliciter.

Si la force adverse entre déjà dans la performance attendue, il ne faut pas appliquer en plus le multiplicateur UEFA/FIFA de l’annexe A pour corriger le même effet.

## 10. Alternative : attribuer une valeur aux actions

Pour chercher une unité commune aux passes, dribbles et interventions défensives, GPT présente le principe de VAEP :

$$
\boxed{
V(a)=\Delta P(\text{marquer})-\Delta P(\text{encaisser})
}
$$

$a$ désigne une action. Les probabilités sont évaluées à court terme, du point de vue de l’équipe dont on mesure la contribution. On additionne ensuite les valeurs attribuées aux actions d’un joueur.

| Exemple hypothétique de la discussion | Variation | Valeur |
|---|---|---:|
| Passe augmentant la probabilité de marquer | $\Delta P(\text{marquer})=+0{,}03$ | $+0{,}03$ |
| Intervention réduisant la probabilité d’encaisser | $\Delta P(\text{encaisser})=-0{,}03$ | $+0{,}03$ |
| Perte augmentant la probabilité d’encaisser | $\Delta P(\text{encaisser})=+0{,}06$ | $-0{,}06$ |

La discussion évoque également OBV, sans donner sa formule. Elle cite xT parmi les données avancées envisagées, sans développer son calcul.

Entraîner un modèle de valeur des actions demande les événements détaillés, leurs positions, leur ordre et leur contexte. Les statistiques agrégées par match ne suffisent pas. Les agrégats VAEP éventuellement fournis par une API sont à distinguer des données permettant d’entraîner son propre modèle.

Une somme de valeurs d’actions reste une attribution issue d’un modèle. Le travail sans ballon n’est pas intégralement observé. Ajouter des bonus de buts, passes décisives ou arrêts déjà évalués produirait un double compte.

## 11. Données et ordre de calcul

### 11.1 Tables proposées dans la discussion

| Table | Granularité | Contenu |
|---|---|---|
| Matchs | Un match | Date, équipes, compétition, résultat, contexte |
| Forces des équipes | Une équipe à une date de référence | Force avant match ; éventuellement attaque et défense |
| Performances individuelles | Un joueur dans un match | Rôle, minutes, observations, attentes, contributions |

À conserver dans les données : identifiants stables, adversaire, domicile/extérieur, tour, buts hors penalty, penalties marqués et ratés, passes décisives, passes clés, dribbles tentés et réussis, défense, erreurs, discipline et données gardien disponibles.

**Une valeur absente ne vaut pas zéro.** Séparer les penalties pendant le match des tirs au but de séance et conserver les dates des classements externes utilisés.

### 11.2 Ordre de calcul envisagé

1. Fixer la période, les compétitions et l’univers de joueurs éligibles.
2. Vérifier la couverture des données par compétition et par indicateur.
3. Calculer chronologiquement les forces des équipes.
4. Estimer les références par rôle sur un historique large.
5. Calculer les attentes, puis $c_{jmk}$ et $C_{jm}$ pour chaque joueur-match.
6. Agréger $T_j$, $M_j$ et $R_j^\star$.
7. Calculer les percentiles et $B_j$ dans les groupes définis.
8. Examiner la sensibilité aux poids, à la régularisation et aux seuils d’éligibilité.

La dernière réponse évoque PitchAPI comme source initiale à tester, après une recommandation précédente de Dribble360. Les capacités et conditions commerciales rapportées dans le chat ne sont pas vérifiées à nouveau ici. Ce document reprend les mathématiques ; la couverture effective des données reste à établir.

## 12. Points ouverts avant l’implémentation

| Point | État dans la discussion et précision de mise en ordre |
|---|---|
| Période et compétitions | Non fixées ; inclure explicitement ou exclure les matchs de sélection |
| Elo | Formule de mise à jour donnée, mais attente, initialisation et $K_{\mathrm{Elo}}$ manquants |
| Références par rôle | Historique large demandé ; modèle statistique et fenêtre de calibration non définis |
| Chronologie de calibration | Précision ajoutée : pour un classement reproductible sans information future, définir quelles données sont disponibles à chaque date |
| Standardisation | Dispersion historique proposée sans estimateur précis ; précision ajoutée : prévoir le cas $s_{r,k}=0$ ou absent |
| Blocs et indicateurs | Poids de blocs fournis, composition des blocs et poids internes à définir |
| Exposition et cumul | Précision ajoutée : vérifier que l’échelle des écarts par match et leur cumul restent comparables pour des durées et des découpages de rôle différents |
| Gardiens | Formule d’arrêts donnée ; autres métriques, couverture et traitement des tirs à préciser |
| Valeurs manquantes | Ne pas les confondre avec zéro ; règle de score en couverture partielle non fournie |
| Percentiles | Univers par rôle demandé ; traitement des égalités et convention exacte non fournis |
| Rôles multiples | Conserver les contributions par rôle ; règle finale de fusion non fournie |
| Éligibilité | 900 minutes proposées dans le premier barème ; application à la seconde méthode à confirmer |
| Paramètres | 75/25, 450 minutes et poids par rôle sont des propositions à tester |
| Évaluation empirique | Aucun résultat ni validation de ces formules dans la discussion |

## Annexe A — premier barème offensif

Ce barème précède la correction par rôle. Il reste utile pour retrouver la proposition initiale, mais favorise les contributions offensives et ne suffit pas pour comparer tous les postes.

### A.1 Variables et préparation

| Symbole | Signification |
|---|---|
| $G_{hp}$ | Buts hors penalty |
| $G_p$ | Penalties marqués pendant le match |
| $A$ | Passes décisives |
| $K$ | Passes menant à un tir, hors passes décisives |
| $D_r$ | Dribbles réussis |
| $D_e$ | Dribbles ratés |
| $P_e$ | Penalties ratés |
| $CSC$ | Buts contre son camp |
| $R$ | Expulsions |
| $r_m$ | Rang de l’adversaire avant le match |
| $N$ | Nombre d’équipes dans le classement utilisé |
| $I_m$ | Coefficient d’enjeu |

$$
D_e=\text{Dribbles tentés}-D_r.
$$

Si le fournisseur inclut les passes décisives dans les passes clés, les retirer pour obtenir $K$. Une expulsion sur deux jaunes compte comme une seule expulsion, sans ajouter une autre pénalité pour les mêmes cartons.

### A.2 Actions positives et négatives

$$
\boxed{P_m=4G_{hp}+2G_p+3A+0{,}30K+0{,}20D_r}
$$

$$
\boxed{N_m=0{,}10D_e+0{,}80P_e+1{,}50CSC+2R}
$$

Le penalty marqué vaut moins qu’un but hors penalty dans cette convention. Tous ces coefficients sont modifiables et non calibrés dans la discussion.

### A.3 Multiplicateur de l’adversaire

$$
\boxed{F_m=0{,}80+0{,}40\left(\frac{N-r_m}{N-1}\right)}
$$

| Rang | Multiplicateur |
|---|---:|
| Premier | $1{,}20$ |
| Milieu | Environ $1{,}00$ |
| Dernier | $0{,}80$ |

Le classement utilisé doit être celui disponible avant le match. Clubs et sélections sont traités séparément. Une équipe absente du classement UEFA reste non classée ; ne pas lui attribuer automatiquement le dernier rang. Précision de domaine ajoutée : cette équation nécessite $N>1$.

### A.4 Coefficient d’enjeu facultatif

| Match | $I_m$ proposé |
|---|---:|
| Officiel ordinaire | $1{,}00$ |
| Huitième ou quart d’une grande compétition retenue | $1{,}05$ |
| Demi-finale | $1{,}10$ |
| Finale | $1{,}15$ |

Définir les compétitions concernées avant le calcul. Pour mesurer la performance sans bonus d’enjeu, fixer $I_m=1$ partout.

### A.5 Score par match

$$
\boxed{S_m=I_m(F_mP_m-N_m)}
$$

Soit, sous forme développée :

$$
\boxed{
S_m=I_m\left[
F_m(4G_{hp}+2G_p+3A+0{,}30K+0{,}20D_r)
-(0{,}10D_e+0{,}80P_e+1{,}50CSC+2R)
\right]
}
$$

La force adverse multiplie les actions positives seulement ; l’enjeu multiplie l’ensemble, pénalités comprises.

### A.6 Agrégation de la première version

$$
T_j=\sum_m S_{j,m},\qquad
R_j=\frac{90T_j}{M_j}.
$$

$$
\boxed{
\operatorname{Score}_j
=0{,}75\operatorname{Percentile}(T_j)
+0{,}25\operatorname{Percentile}(R_j)
}
$$

Le « par 90 » se calcule après la somme de toute la période. Les percentiles vont de 0 à 100 dans un même groupe éligible fixé à l’avance. GPT propose ici un minimum de 900 minutes pour une saison complète, à adapter pour une période plus courte. La version suivante remplace ce taux brut par le taux régularisé et introduit les références par rôle.
