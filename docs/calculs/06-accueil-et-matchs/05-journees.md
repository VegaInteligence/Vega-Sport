# Journées, équipe de la journée et joueur de la saison

Code : [rounds.py](../../../backend/vega/rounds.py). Routes : `/api/rankings/rounds` et `/api/rankings/round`. Le site les montre sous le classement d'un championnat (`LeagueRoundCards`).

## Ce qu'est une journée

- **Une journée** est une ligne de `core.rounds` d'une édition de championnat.
- **Quand les matchs joués n'ont pas de journée** (la MLS), le championnat est découpé en **semaines**, du mardi 12 h UTC au mardi suivant. Le week-end américain et le lundi européen finissent avant la coupure ; le mardi européen commence après.
- **Un match futur sans journée** n'est pas encore programmé dans une journée : il ne bloque rien.
- Seules les journées de la phase régulière comptent.

## Quand une journée se ferme

Un match est **à l'heure** s'il commence au plus tard 4 jours après le coup d'envoi médian de sa journée. Un match reporté plus loin ne bloque jamais sa journée.

La journée se ferme quand trois conditions sont réunies :

1. **Ses matchs à l'heure sont tous réglés.** Chacun est soit terminé (y compris sur tapis vert ou annulé), soit reporté ou suspendu, soit encore « à venir » ou « en cours » 72 heures après son coup d'envoi (un statut que la source n'a jamais mis à jour).
2. **Six heures ont passé depuis la fin de son dernier match**, pour laisser passer les corrections tardives des statistiques. La fin d'un match est son coup d'envoi plus 2 heures.
3. **Le classement des joueurs de l'année a tourné après cette fin**, pour que les notes de match comptent toute la journée.

**Dans tous les cas, la journée se ferme 7 jours après le coup d'envoi médian** : rien n'attend indéfiniment.

**Pourquoi ces seuils.**
- Les 4 jours séparent le match reporté du match de la journée qui se joue un lundi.
- Les 72 heures couvrent un statut jamais mis à jour.
- Les 6 heures absorbent les corrections de statistiques.
- Les 7 jours empêchent un report de bloquer le championnat.

Tous ces réglages sont **choisis** ; aucun n'est ajusté sur les données.

## Ce qui attend la fermeture, et ce qui n'attend pas

**Attendent la fin de la journée** (la photo est prise à sa fermeture) :
- la projection de fin de saison du championnat : les matchs d'une journée encore ouverte comptent comme « à jouer » ;
- l'équipe de la journée ;
- la course au joueur de la saison.

**Bougent à chaque match terminé**, au plus une heure après :
- la note de chaque match ;
- l'Elo des clubs ;
- les pronostics d'un match ;
- le classement Vega des joueurs, toutes ligues confondues.

**Pourquoi le classement global n'attend pas.** Des centaines de compétitions ont des journées qui se chevauchent : elles ne sont jamais toutes fermées en même temps, et l'attente ne ferait que le retarder. Une journée à moitié jouée ne le fausse pas plus que des matchs en retard. Faire attendre la projection d'un championnat est un choix de cohérence pour le lecteur : elle se lit « après la journée N ».

**Un match reporté joué plus tard** reste dans sa journée pour les données, et la journée passe « amendée ». La projection et la course, qui cumulent toute la saison, le prennent à la fermeture suivante. L'équipe de la journée, une fois publiée, ne change plus.

## L'équipe de la journée

Les candidats sont les joueurs qui ont joué **au moins 60 minutes** dans la journée. Si aucun système ne peut être rempli ainsi, le seuil passe à 45 minutes. Dans une semaine où un joueur a joué deux matchs, on prend son z moyen pondéré par les minutes.

**Systèmes essayés** : 4-3-3, 4-2-3-1, 4-4-2, 3-4-3 et 3-5-2. Le 4-1-4-1 et le 5-3-2 demandent les mêmes postes que le 4-3-3 et le 3-5-2.

**Postes acceptés par case.** Le rôle retenu est celui que le joueur a tenu dans ce match.

| Case | Rôles acceptés |
| --- | --- |
| Gardien | gardien |
| Défenseur central | défenseur central |
| Latéral | latéral |
| Piston | latéral, ailier |
| Milieu défensif | milieu défensif, milieu central |
| Milieu central | milieu central, milieu défensif |
| Meneur (le 10 du 4-2-3-1) | milieu central, ailier |
| Ailier | ailier |
| Avant-centre | avant-centre |

**Choix des joueurs.** Pour chaque système, on cherche l'affectation exacte (méthode hongroise) qui maximise la somme des z des onze cases, chaque case n'acceptant que ses rôles. Le système retenu est celui dont la somme est la plus haute ; à égalité, l'ordre de la liste ci-dessus départage.

**Pourquoi la somme des z, pas celle des notes.** z est la quantité additive. La note sur 100 écrase les extrémités, et une somme de notes sous-estimerait les très grands matchs.

L'équipe n'est publiée que si au moins 80 % des matchs joués de la journée ont leurs notes. Il n'y a pas de limite de joueurs par club.

## Le joueur de la saison

Pour chaque joueur, on prend ses matchs de 20 minutes ou plus dans les journées fermées de ce championnat :

$$
\bar{z}^{*} = \frac{\sum_i m_i\, z_i}{\sum_i m_i + 450}, \qquad \text{note} = \frac{100}{1 + 10^{-\bar{z}^{*}/4}}
$$

- **Le 450 au dénominateur** rapproche de 0 (soit 50) un joueur qui a peu joué, comme le λ du classement Vega. Sans lui, un joueur qui a fait trois très bons matchs passerait devant un titulaire régulier.
- **Ni niveau du club, ni enjeu, ni a priori de la saison passée.** Dans un même championnat, le niveau du club ne ferait que favoriser les grands clubs ; tous les matchs de championnat ont le même enjeu ; et la course ne récompense que cette saison.
- **Conditions pour concourir** : au moins 3 matchs, et au moins la moitié des minutes que son club a pu jouer dans ces journées (matchs du club × 90).
- Le site montre les trois premiers ; les dix premiers sont gardés pour chaque journée.

**Choisi** : 450 minutes, 50 % des minutes, 3 matchs. **Mesuré** : les z, par la note de match.

## Note de saison, score Vega et joueur de la saison

Ce sont trois réponses à trois questions différentes.

- **La note de saison**, dans les listes, est la qualité moyenne de ses matchs pour son poste. 50 est un match ordinaire. Le temps de jeu et le niveau du club n'y entrent pas.
- **Le score Vega**, dans le classement, couvre toute sa saison : le volume de jeu (75 %), la qualité par match (25 %) et le niveau de son club, face à tous les joueurs de son poste des ligues mesurées.
- **Le joueur de la saison** d'un championnat est la note de saison réduite vers 50 tant qu'il a peu joué, dans ce championnat seulement.

**Exemple : Cristian Cásseres (Toulouse, 15 novembre 2026).**
- Note de saison en Ligue 1 : 77,9, la première du championnat.
- Score Vega : 84,6, 43ᵉ du classement.
- Ses matchs sont notés de 67 à 92, y compris les défaites contre Lyon, Lille et Marseille. Un match se juge face à ce qu'on attend de son poste contre cet adversaire : une équipe qui perd n'est pas un joueur qui joue mal.
- Au classement, il est juste au seuil de 900 minutes, et le volume compte pour 75 % : des titulaires qui ont plus joué passent devant lui.
- Une application de notation indépendante le classe aussi premier de Ligue 1.
