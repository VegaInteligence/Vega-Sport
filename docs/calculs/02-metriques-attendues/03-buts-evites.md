# Buts évités (gardien)

Il existe deux mesures distinctes : celle du **gardien** (fournie par PitchAPI) et celle de l'**équipe** (calculée par Vega).

## Gardien : `goalsPrevented` (fournisseur)

Champ PitchAPI `goals_prevented`, par match. Il mesure les buts que le gardien a empêchés par rapport à ce qu'auraient donné des tirs cadrés comparables ; la définition usuelle est « xGOT des tirs subis − buts encaissés sur ces tirs », mais le calcul exact est celui du fournisseur et Vega ne le refait pas. Il n'est disponible que pour une partie des gardiens.

- **Saison** : total, par match, par 90, comme toute mesure de comptage ([Agrégation](../05-joueurs/01-agregation-saison.md)).
- **Classable** : oui, dans la cohorte des gardiens (centile, indice « Arrêts », radar gardien).

## Équipe : « Buts évités par le gardien / match » (Vega)

Calculé match par match dans [club-scout.js](../../../dashboard/frontend/src/services/club-scout.js#L771) (`keeper`) :

$$
\text{Buts évités / match} = \frac{1}{n}\sum_{m} \left(\text{xGOT concédés}_m - \text{buts encaissés}_m\right)
$$

- `xGOT concédés` = statistique d'équipe `expected_goals_on_target` **de l'adversaire**.
- Seulement sur les matchs où les deux xG d'équipe sont connus.
- Positif : les arrêts ont empêché des buts ; négatif : l'équipe encaisse plus que la qualité des tirs cadrés subis.

Exemple : l'adversaire cadre pour 1,6 xGOT et marque 1 but → +0,6 ce match-là.

Cette mesure entre dans la phase « Finition et gardien » de l'indice Vega club et dans le graphique finition / gardien de la page club.

Limite : les buts encaissés comprennent les contre son camp, qui n'ont pas de xGOT (voir [points d'attention](../07-limites/02-points-d-attention.md)).

## Origine de la méthode

La formule « PSxG ou xGOT subis − buts encaissés » est aussi celle retenue pour les gardiens dans la méthode Ballon d'Or proposée ([METHODE_CLASSEMENT_BALLON_D_OR.md](../../METHODE_CLASSEMENT_BALLON_D_OR.md), § 7), qui n'est pas encore implémentée.
