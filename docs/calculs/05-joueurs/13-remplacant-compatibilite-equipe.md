# Remplaçant : compatibilité avec l'équipe

Onglet « Remplaçant » de `/joueurs` ([PlayerReplacements.jsx](../../../dashboard/frontend/src/components/PlayerReplacements.jsx)), lecture `/api/players/{id}/similar` en mode remplacement ([profiles.mjs](../../../backend/api/src/routes/profiles.mjs)), valeurs par joueur calculées par le worker ([team_fit.py](../../../backend/vega/team_fit.py), table `agg.player_team_fit`, migration 162). Issue [VI-40](https://linear.app/vegainteligence/issue/VI-40) / GitHub #62, 20 novembre 2026.

Question posée : pour remplacer le joueur P **dans son équipe** T, quels joueurs de la saison conviennent le mieux ? Ce n'est pas seulement « même profil statistique » : il faut aussi le même rôle dans le jeu de l'équipe, un club au style proche, autant d'effort, autant de travail défensif et autant de discipline.

## Le club et le rôle d'un joueur

- **Club principal** : le club (hors sélection) où il a joué le plus de minutes dans la saison, toutes compétitions. Il faut au moins 450 minutes dans ce club, sinon le joueur n'a pas de ligne.
- **Rôle** : celui du classement de puissance de la saison (`agg.player_power.role`).
- **Cohorte d'un centile** : les joueurs de son rôle qui ont la valeur, s'ils sont au moins 30. Sinon, ceux de sa ligne (gardiens, défenseurs, milieux, attaquants). Sinon, pas de centile.
- **Centile** : la part des pairs strictement en dessous, plus la moitié des égaux, sur 100.

## Les éléments par joueur (worker)

**Rôle dans l'équipe.** Six parts du jeu de son club :
- ballons touchés ;
- passes tentées ;
- passes dans le dernier tiers ;
- occasions créées ;
- tirs ;
- actions défensives.

Chaque part est part_k = Σ joueur_k / Σ_matchs (total_équipe_k × minutes / 90). Elle compte les matchs de son club où sa valeur et le total de l'équipe sont connus, et demande au moins 450 minutes ainsi mesurées. Le total d'un match est connu quand les joueurs qui ont la valeur couvrent au moins 80 % des minutes de l'équipe : un remplaçant sans la mesure ne masque plus tout le match. Avec la règle stricte (tous les joueurs mesurés), la part de tirs n'existait en 2026/27 que pour 4 686 joueurs sur 12 522. Chaque part devient un centile dans la cohorte.

**Travail défensif.** On ne mesure pas les replis eux-mêmes : il faudrait le suivi des joueurs sans le ballon. L'approche retenue est la somme tacles + interceptions + récupérations par 90 minutes, ajustée à la possession adverse :

> Σ_m (actions_m × 50 / (100 − possession_m)) × 90 / Σ_m minutes_m

Un joueur d'une équipe qui a souvent le ballon défend moins souvent, et l'ajustement compense. Il faut au moins 450 minutes avec les trois valeurs et la possession connues. Le résultat est un centile dans la cohorte.

**Effort.** Distance, course rapide (`running_m`) et sprints par 90 minutes, sur les matchs où la distance est connue (au moins 450 minutes). Effort = moyenne des centiles connus parmi les trois, la distance étant obligatoire.

**Discipline.**
- Fautes : ses fautes par 90 divisées par celles de son équipe par joueur-90.
- Cartons : un jaune vaut 1 point, un deuxième jaune ou un rouge 2 points. Ses points par 90 sont tirés vers la moyenne de son rôle par 900 minutes fictives (les cartons sont rares), puis divisés par ceux de son équipe par joueur-90.
- Indice = moyenne des deux rapports connus. Discipline = 100 − centile de l'indice dans la cohorte (plus haut = plus discipliné). Il faut au moins 900 minutes.

## La compatibilité (lecture)

**Candidats.** On part des joueurs plus proches que la distance médiane, filtrés par âge et valeur. On garde les 300 plus proches en profil, et on retire ceux dont le club principal est T.

**Éléments, pour un candidat C face à P :**

| Élément | Poids | Valeur |
| --- | --- | --- |
| Profil | 40 | la ressemblance de profil (0–100), comme avant |
| Rôle dans l'équipe | 20 | 100 − moyenne des écarts de centile entre C et P sur les parts connues des deux (au moins 4) |
| Style de club | 15 | 100 − moyenne des écarts de centile entre le club de C et T sur les 10 axes de style (`api.team_style_centiles`, édition du club avec le plus de matchs ; au moins 5 axes communs) |
| Travail défensif | 10 | 100 − max(0, centile de P − centile de C) |
| Effort | 10 | 100 − max(0, effort de P − effort de C) |
| Discipline | 5 | 100 − max(0, discipline de P − discipline de C) |

Travail défensif, effort et discipline ne pénalisent qu'un candidat qui fait **moins** que P.

**Score.** Score = Σ poids × élément ÷ Σ poids des éléments connus. Un élément inconnu sort du calcul ; on ne l'impute jamais.

**Niveau.** Si la ligue de C est plus faible que celle de T de plus de 50 points de niveau, le score perd 0,15 point par point au-delà. Une ligue plus forte ne rapporte rien. L'écart n'est renvoyé (`levelGap`, étiquette « Ligue plus faible ») que lorsqu'il coûte des points.

Les pondérations sont un **jugement**, pas un ajustement sur des données. Une validation reste à faire sur de vrais transferts : la note d'un joueur a-t-elle tenu quand la compatibilité était haute ?

## Cas limites (écrits avant le code)

1. Un joueur sans club principal de 450 minutes n'a pas de ligne : toute sa compatibilité repose sur le profil.
2. Un joueur prêté à mi-saison est rattaché au club où il a le plus joué. Les matchs de l'autre club n'entrent pas dans ses parts.
3. Une part dont le total d'équipe vaut 0 sur tous ses matchs reste inconnue, sans division par zéro.
4. Rôle ou ligne trop petits (moins de 30 pairs) : centile inconnu.
5. Possession de 100 % ou inconnue : le match sort du travail défensif.
6. Aucun carton dans l'équipe : le rapport des cartons est inconnu ; l'indice ne garde que les fautes.
7. Un gardien n'a ni parts de jeu de champ, ni effort comparé à des joueurs de champ : sa cohorte est celle des gardiens.
8. Un coéquipier de P n'est jamais proposé.
9. Si P lui-même n'a pas de ligne, seuls le profil et le style (si son club est connu) comptent.
10. Le tri « Profil » rend l'ordre de ressemblance pure, sur les mêmes 40 joueurs affichés.
