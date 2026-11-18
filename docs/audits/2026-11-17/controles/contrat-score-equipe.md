# Mesure d’équipe attendue dans l’audit

Le document de calcul du 16 novembre distingue l’Elo de force et l’indice descriptif d’un club par cohorte. La demande de couverture du 17 novembre porte sur le « appropriate Vega Score » pour chaque joueur, club et sélection. Elle ne fixe aucune échelle supplémentaire pour les équipes.

Dans le journal de la session responsable, le commit `2b1ab2ad02` consigne le choix du 16 novembre, « one club Elo for every match, no separate cup Elo », puis la validation du 17 novembre. La revue de périmètre commune des modèles retient l’Elo interne et demande de documenter les limites du calcul. Le libellé E04h qui imposait de publier une deuxième note était une interprétation ajoutée au registre d’audit.

E04g vérifie le calcul de la mesure définie chez les clubs et les sélections. E04a–d vérifient le périmètre réel, notamment les résultats absents ou exclus. E04h documente la distinction entre une force qui évolue et une note de prestation ponctuelle pour expliquer aux lecteurs les unités disponibles. Cette seconde échelle reste une hypothèse de produit hors cahier des charges. Une couverture complète nécessite les fixtures véritables ainsi que deux côtés correctement attribués, un contexte de lieu exact et la valeur calculée sur les entrées correctes.

Vérification Git depuis une copie du dépôt contenant l’historique concerné :

```sh
git show 2b1ab2ad02:WORKLOG.md
git rev-list --left-right --count 2b1ab2ad02...8018e0836c
git diff --name-only 2b1ab2ad02 8018e0836c
```

Au contrôle du 18 novembre, la branche de travail historique `claude/v2-complete` s’arrêtait au premier commit et le code AWS au second. Résultat du décompte Git, zéro commit propre au premier et un au second. Les différences concernent le délai maximal de rafraîchissement des cohortes, sa migration 133, les tests et les documents correspondants. L’état d’une nouvelle session ou d’un changement encore privé reste inconnu.
