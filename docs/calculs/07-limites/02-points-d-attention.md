# Points d'attention relevés dans le code

En parcourant les calculs pour écrire cette documentation, plusieurs comportements méritent d'être connus. Ils ne sont pas forcément des erreurs, mais ils changent la lecture de certains chiffres. Rien n'a été modifié dans le code au moment de les écrire ; l'audit des calculs du 16 novembre 2026 en a corrigé une partie le 17 novembre (signalé à chaque point, détail dans la [traçabilité](../09-audit-2026-11/TRACEABILITY.md)).

## Clubs

**1. L'écart « points − xPts » mélangeait deux périmètres (corrigé le 17 novembre 2026, VI-22).**
`xptsTotal` ne somme que les matchs où les deux xG sont connus, alors que `record.points` compte tous les matchs. La colonne d'identité, la carte « Résultats et attendus », le classement aux points attendus et le tableau européen comparent désormais points et xPts des mêmes matchs ; la carte compare les buts aux xG des matchs où le xG de ce côté est connu, et les totaux (finition, qualité de frappe, gardien) multiplient la moyenne par les seuls matchs qui la portent ([club-supported.js](../../../dashboard/frontend/src/services/club-supported.js), qui lit les champs appariés de la cohorte, `pairedPointsDelta` et `pairedXg*`, VI-23). Une valeur sans aucun match affiche « — », sans flèche.
→ [ClubScoutTabs.jsx](../../../dashboard/frontend/src/components/ClubScoutTabs.jsx#L77), [ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L1442)

**2. Les indicateurs club hors xG sont calculés sur les seuls matchs avec xG.** *(corrigé le 17 novembre 2026 : chaque indicateur se calcule sur les matchs qui connaissent ses termes)*
Possession, passes, tirs, duels, corners, cartons… passent par le filtre `has` (les deux xG connus). Un match aux statistiques fiables mais sans xG est ignoré pour ces indicateurs, alors que points, buts et matchs sans encaisser le comptent.
→ [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L649)

**3. « Finition (buts − xG) » inclut les buts contre son camp adverses.** *(corrigé le 17 novembre 2026, sur les matchs dont les contre son camp sont classés)*
`gf` est le score final, qui comprend les contre son camp de l'adversaire, alors que le xG n'en contient pas. La finition d'une équipe qui bénéficie de contre son camp est surévaluée d'autant.

**4. « Buts évités par le gardien » inclut les contre son camp encaissés.** *(corrigé le 17 novembre 2026 pour les contre son camp ; les penalties restent des deux côtés)*
`xGOT adverse − buts encaissés` : un contre son camp n'a pas de xGOT mais compte dans les buts encaissés, ce qui pénalise le gardien. Les penalties sont inclus des deux côtés.

**5. « xG par tir (hors penalty) » n'enlève les penalties que du numérateur.** *(corrigé le 17 novembre 2026 : penalties retirés des deux termes, comptés sur une liste de tirs complète)*
Σ npxG est divisé par Σ `total_shots`, qui n'est pas filtré des penalties dans le code. Une équipe qui tire beaucoup de penalties voit sa qualité de tir moyenne baisser.

**6. Les écarts entre deux clubs comptent un centile manquant pour 0.**
Dans `Gaps`, `self.centiles[key] ?? 0` : si un club n'a pas de centile sur un axe, l'autre semble le devancer largement.
→ [ClubScoutProfile.jsx](../../../dashboard/frontend/src/components/ClubScoutProfile.jsx#L520)

**7. Les sommes de xG par situation comptent un xG absent pour 0.** *(17 novembre 2026 : dans `shotProfile`, le xG d'une situation devient inconnu dès qu'un tir n'en a pas, et un 0 connu reste 0 ; sur la carte du club, un xG absent vaut encore 0,01 dans l'en-tête de VI-22 : transmis ; `weekTotals` n'est pas modifié)*
`shotProfile` et les totaux de la semaine (`weekTotals`) remplacent un xG manquant par 0 : ce sont des bornes basses quand la couverture est partielle, sans indication du nombre de tirs sans xG.

## Joueurs

**8. Le zéro « aucun tir » n'est restauré que pour une performance, pas pour une saison.**
Au niveau d'un match, `xg` et `shotsOnTarget` valent 0 quand le joueur n'a pas tiré. Au niveau saison, la valeur reste absente ; or un centile saison exige une mesure observée sur **tous** les matchs. Un joueur qui a eu un seul match sans tir (fréquent chez les défenseurs et milieux défensifs) perd son centile saison de xG et de tirs cadrés.
→ [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L57) vs [season-player.js](../../../dashboard/frontend/src/services/season-player.js#L203)

**9. Les grosses occasions créées sont classées au niveau saison malgré leurs zéros omis.** *(levé le 12 novembre 2026 : un vide vaut zéro là où le fournisseur publie la mesure, voir [Valeurs absentes](../01-sources-et-conventions/02-valeurs-absentes-et-fiabilite.md) ; le xA est classé à la même condition)*
Les centiles saison du xA et des grosses occasions créées exigent une observation sur tous les matchs et toutes les minutes du joueur, ainsi qu’une cohorte suffisante. Le lecteur restitue certains zéros omis lorsque la couverture est établie. Sur la fiche d’une performance individuelle, le xA reste sans centile.
→ [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L47), [PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L146)

**10. Deux définitions de la note saison (résolu le 15 novembre 2026).**
La note du fournisseur avait deux moyennes de saison : une moyenne simple sur le profil et l'annuaire, une moyenne pondérée par les minutes sur l'accueil. La note Vega qui la remplace n'a qu'une définition, partout : la note du z moyen pondéré par les minutes, sur les matchs de 20 minutes ou plus.
→ [Note du match](../02-metriques-attendues/04-note-du-match.md)

**11. La cohorte d'une performance compte des performances, pas des joueurs.**
Le centile d'un match compare à toutes les performances de 30 minutes ou plus du même poste : les titulaires indiscutables pèsent davantage dans la distribution que les joueurs peu utilisés. C'est cohérent avec la question posée (« ce match est-il bon pour un match de défenseur ? ») mais diffère du centile saison, qui compte chaque joueur une fois.

**12. La « Lecture du scout » écrit 0 pour une production absente.** *(corrigé le 17 novembre 2026 : seule une valeur connue est écrite)*
La phrase de production s'affiche dès que les buts **ou** les passes décisives sont renseignés, et remplace l'autre mesure par 0 si elle manque (`goals.value ?? 0`, `assists.value ?? 0`). Un joueur sans passes décisives renseignées lit « 0,00 passe décisive par 90 min » au lieu d'une valeur absente. Le point de vigilance de la même carte est aussi relatif : c'est toujours le centile le plus bas du joueur, même élevé.
→ [PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L338), [Carte « Lecture du scout »](../05-joueurs/07-lecture-du-scout.md)

## Modèle de points attendus

**13. Hypothèses fortes du modèle de Poisson.**
Buts indépendants, xG d'équipe agrégé (la répartition des occasions est ignorée), plancher λ = 0,01. Ce sont des choix standard, mais ils expliquent par exemple qu'un 0-0 sans aucun tir vaille 1,01 xPts. *(La troncature à 10 buts et la défaite par complément ont été retirées le 17 novembre 2026 ; le domaine s'arrête à 100 xG par camp.)*

## Encore ouvert après l'audit du 16 novembre 2026

**17. Mi-temps : couverture réduite.** Une mi-temps incomplète est écartée au lieu de compter ses vides pour 0 ; sur la feuille réelle des tests, 4 mi-temps sur 50 (180 minutes) disparaissent. La route ne publie pas encore le nombre de mi-temps écartées (chantier VI-22).

**18. Plongement : moins de joueurs placés.** Un joueur doit connaître 90 % des statistiques gardées ; combien de joueurs perd la production n'est pas mesuré.

**19. xG de Vega : moins souple.** Les contraintes l'empêchent de remonter loin du but, au prix d'un ajustement un peu moins bon quand les tirs disent le contraire (mesuré sur une entrée synthétique seulement).

**20. Durées des états de match.** Non corrigées (affichage du chantier VI-22) ; un but sans score dans les événements fait échouer le recalcul de l'édition.

**21. Situations des tirs du profil club.** `shotProfile` ne reconnaissait que la graphie du fournisseur (`Penalty`, `RegularPlay`…), alors que les fiches de match intégrées portent les codes normalisés (`penalty`, `regular_play`…) : un penalty y tombait dans « jeu placé ». *(Corrigé le 17 novembre 2026 : une seule lecture des deux graphies ; une situation inconnue n'est plus du jeu placé ; un tir d'une autre équipe n'est d'aucun côté. Montrer les tirs non classés reste au chantier VI-22.)*

**22. Minutes par but ou passe décisive.** Le bloc Saison et le tableau par compétition comptaient un but ou une passe inconnus pour 0. *(Corrigé le 17 novembre 2026 : le chiffre n'existe que sur des buts et des passes connus sur tous les matchs joués, voir [Agrégation](../05-joueurs/01-agregation-saison.md).)*

**23. Un ajustement du xG de Vega qui n'a pas convergé était publié.** *(Corrigé le 17 novembre 2026 : il n'est plus publié, et le modèle précédent reste ; voir [Le xG de Vega](../02-metriques-attendues/05-xg-vega.md).)*

**24. Indicateurs de tir des cohortes lues en résumé.** Les lectures de championnat et du référentiel européen ne portent pas les listes de tirs : les autres clubs n'ont ni xG par tir, ni finition, ni gardien, ni conversion. Le club du dossier les reçoit de sa propre lecture complète ; moins de 5 clubs mesurés, ces quatre indicateurs n'ont ni rang ni médiane. *(17 novembre 2026, étape 5 : les totaux de saison de l'onglet avancé, qui multiplient la moyenne par tous les matchs et lisent une absence comme 0, restent au chantier VI-22 ; voir [Indicateurs d'équipe](../04-clubs/01-indicateurs-club.md).)*

**25. Recalcul nécessaire.** Les nouvelles définitions (saisons des joueurs et groupe de poste de leurs cohortes, mi-temps, xPts, indicateurs club du serveur dont la qualité de frappe, retours, plongement, xG) ne valent pour une édition qu'une fois recalculée ; la procédure est dans la [traçabilité](../09-audit-2026-11/TRACEABILITY.md).

## Mesuré, non construit (14 novembre 2026)

Trois idées de la feuille de route ont été mesurées sur la base de production avant d'être écrites, et laissées de côté parce que la mesure ne les soutient pas.

**14. Courbe d'âge des joueurs.** Rendement propre par 90 minutes (classement de puissance) des joueurs à 450 minutes ou plus dans deux années de suite, par âge au 1ᵉʳ août : de 2024/2025 à 2025/2026 (2 127 joueurs), la variation moyenne va de −0,012 à +0,023 selon la tranche d'âge, avec une erreur type de 0,008 à 0,011 ; seuls les moins de 21 ans s'écartent de zéro (+0,023 ± 0,010), et les 21-23 ans reculent (−0,012). Aucune forme de courbe. L'échantillon est de plus biaisé : la date de naissance (Wikidata) n'est connue que pour 3 759 joueurs sur 56 385, et pour 26,5 % du meilleur quart du classement contre 4,3 % du moins bon. Une courbe tirée de ces joueurs décrirait les bons joueurs connus, pas les joueurs. À reprendre quand la source des dates de naissance couvrira la base.

**15. Jours de repos dans le pronostic.** Aucun effet mesurable ; chiffres dans [Pronostics](../06-accueil-et-matchs/03-pronostics-et-projections.md).

**16. Une seule règle pour les zéros omis.** Le classement de puissance garde sa restauration (`restore_zeros`) à côté de la règle commune (`agg.match_zeros`). Comparées sur les 227 718 joueurs-matchs de l'année en cours et les 17 mesures qu'elles partagent : elles rendent le même zéro partout, sauf 17 à 92 vides de plus pour la règle commune sur sept mesures (au plus 1,1 % des vides de la mesure) et 1 155 de plus pour le classement sur trois mesures rares (grosses occasions manquées et créées, erreurs menant à un but ; 0,5 % de leurs vides). Les réunir ne changerait aucun rang de façon visible et obligerait à recalculer toutes les années : laissé tel quel.
