# Points d'attention relevés dans le code

En parcourant les calculs pour écrire cette documentation, plusieurs comportements méritent d'être connus. Ils ne sont pas forcément des erreurs, mais ils changent la lecture de certains chiffres. Rien n'a été modifié dans le code.

## Clubs

**1. L'écart « points − xPts » mélange deux périmètres.**
`xptsTotal` ne somme que les matchs où les deux xG sont connus, alors que `record.points` compte tous les matchs. L'écart de la colonne d'identité (`IdentityRail`), de la carte « Résultats et attendus », du classement aux points attendus et du tableau européen (`ExpectedGapTable`) est donc surestimé dès qu'un match n'a pas de xG. La courbe cumulée, elle, n'utilise que les matchs avec xPts. De même, la carte « Résultats et attendus » compare les buts réels de tous les matchs à `xG / match × nombre total de matchs`.
→ [ClubScoutTabs.jsx](../../../dashboard/frontend/src/components/ClubScoutTabs.jsx#L77), [ClubScoutUI.jsx](../../../dashboard/frontend/src/components/ClubScoutUI.jsx#L1442)

**2. Les indicateurs club hors xG sont calculés sur les seuls matchs avec xG.**
Possession, passes, tirs, duels, corners, cartons… passent par le filtre `has` (les deux xG connus). Un match aux statistiques fiables mais sans xG est ignoré pour ces indicateurs, alors que points, buts et matchs sans encaisser le comptent.
→ [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L649)

**3. « Finition (buts − xG) » inclut les buts contre son camp adverses.**
`gf` est le score final, qui comprend les contre son camp de l'adversaire, alors que le xG n'en contient pas. La finition d'une équipe qui bénéficie de contre son camp est surévaluée d'autant.

**4. « Buts évités par le gardien » inclut les contre son camp encaissés.**
`xGOT adverse − buts encaissés` : un contre son camp n'a pas de xGOT mais compte dans les buts encaissés, ce qui pénalise le gardien. Les penalties sont inclus des deux côtés.

**5. « xG par tir (hors penalty) » n'enlève les penalties que du numérateur.**
Σ npxG est divisé par Σ `total_shots`, qui n'est pas filtré des penalties dans le code. Une équipe qui tire beaucoup de penalties voit sa qualité de tir moyenne baisser.

**6. Les écarts entre deux clubs comptent un centile manquant pour 0.**
Dans `Gaps`, `self.centiles[key] ?? 0` : si un club n'a pas de centile sur un axe, l'autre semble le devancer largement.
→ [ClubScoutProfile.jsx](../../../dashboard/frontend/src/components/ClubScoutProfile.jsx#L520)

**7. Les sommes de xG par situation comptent un xG absent pour 0.**
`shotProfile` et les totaux de la semaine (`weekTotals`) remplacent un xG manquant par 0 : ce sont des bornes basses quand la couverture est partielle, sans indication du nombre de tirs sans xG.

## Joueurs

**8. Le zéro « aucun tir » n'est restauré que pour une performance, pas pour une saison.**
Au niveau d'un match, `xg` et `shotsOnTarget` valent 0 quand le joueur n'a pas tiré. Au niveau saison, la valeur reste absente ; or un centile saison exige une mesure observée sur **tous** les matchs. Un joueur qui a eu un seul match sans tir (fréquent chez les défenseurs et milieux défensifs) perd son centile saison de xG et de tirs cadrés.
→ [shared/player-profile.js](../../../dashboard/shared/player-profile.js#L57) vs [season-player.js](../../../dashboard/frontend/src/services/season-player.js#L203)

**9. Les grosses occasions créées sont classées au niveau saison malgré leurs zéros omis.**
Le code indique que le fournisseur ne publie jamais 0 pour le xA ni pour les grosses occasions. Le xA est exclu des classements, mais `bigChancesCreated` reste classable (`rankable: key !== "xa"`) et figure dans la pizza des milieux offensifs et attaquants. Avec la règle de couverture complète, seuls les joueurs ayant une valeur à **chaque** match entrent dans la distribution : le centile compare un groupe très sélectionné, et la plupart des joueurs n'en ont pas.
→ [scouting.js](../../../dashboard/frontend/src/services/scouting.js#L47), [PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L146)

**10. Deux définitions de la note saison.**
Profil et annuaire : moyenne simple des notes. Accueil : moyenne pondérée par les minutes. Un même joueur peut afficher deux notes saison différentes.
→ [Note du match](../02-metriques-attendues/04-note-du-match.md)

**11. La cohorte d'une performance compte des performances, pas des joueurs.**
Le centile d'un match compare à toutes les performances de 30 minutes ou plus du même poste : les titulaires indiscutables pèsent davantage dans la distribution que les joueurs peu utilisés. C'est cohérent avec la question posée (« ce match est-il bon pour un match de défenseur ? ») mais diffère du centile saison, qui compte chaque joueur une fois.

**12. La « Lecture du scout » écrit 0 pour une production absente.**
La phrase de production s'affiche dès que les buts **ou** les passes décisives sont renseignés, et remplace l'autre mesure par 0 si elle manque (`goals.value ?? 0`, `assists.value ?? 0`). Un joueur sans passes décisives renseignées lit « 0,00 passe décisive par 90 min » au lieu d'une valeur absente. Le point de vigilance de la même carte est aussi relatif : c'est toujours le centile le plus bas du joueur, même élevé.
→ [PlayerScoutOverview.jsx](../../../dashboard/frontend/src/components/PlayerScoutOverview.jsx#L338), [Carte « Lecture du scout »](../05-joueurs/07-lecture-du-scout.md)

## Modèle de points attendus

**13. Hypothèses fortes du modèle de Poisson.**
Buts indépendants, xG d'équipe agrégé (la répartition des occasions est ignorée), plancher λ = 0,01, troncature à 10 buts, défaite obtenue par complément. Ce sont des choix standard, mais ils expliquent par exemple qu'un 0-0 sans aucun tir vaille 1,01 xPts.

## Démo

**14. Calibrations européennes non ajustées.**
Les décalages de ligue et coefficients du niveau européen sont fixés à la main ; le commentaire du code précise qu'ils restent « à ajuster sur des résultats ». L'option « Clubs de niveau comparable », activée par défaut sur le profil joueur, en dépend.
