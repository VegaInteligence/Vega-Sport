# Relais au partenaire pour les visuels

Le partenaire de Hugo reprend E06c et E06d sous VI-30. La branche au passage de relais est `codex/production-architecture-audit` au commit `a6b4a313742283daaa305703aa49956f240b3bf1`. Les sources des essais UEFA dérivent du code intégré `01130327f8`. Les correctifs visuels et les preuves déjà intégrés sont conservés.

| Éléments à reprendre | Situation au relais |
| --- | --- |
| Dernier paquet qualifié avant la campagne UEFA | 1 605 associations. La migration 146 retire deux attributions familiales erronées dans la copie intégrée. |
| Nouveau cumul local candidat | 1 932 associations, dont 1 828 fiches d’équipes et 104 compétitions. Le ZIP porte l’empreinte SHA-256 `0547bdfae5c34c924e1c47a27ad3c68f2ef3a4b9915265974378f209b4422476`, le manifeste `8f50533de53eec90b4e510e45a4608ccdc610cbf77dbe53551aadcb69f5c2feb`. |
| Apport UEFA | 81 profils et 246 occurrences historiquement attribuées. Ces 327 rattachements représentent 143 clubs UEFA distincts. |
| Couverture sur la copie du 18 | Après import incrémental et migrations, 3 303 fiches de club, 184 familles de compétitions et 54 sélections ont un emblème. Le deuxième passage retrouve les 1 932 associations. |
| Autres contrôles | Vicenza manque à la copie du 17. Huit racines contradictoires et dix-huit rapprochements non réciproques sont conservés pour expertise. Le registre des 3 466 racines de l’archive européenne laisse 3 139 cas ouverts après les ajouts. |
| Publication | Aucune publication du lot. L’import direct du cumul depuis une copie vierge du paquet, les nouvelles acquisitions et la validation du déploiement restent au partenaire. VI-21 garde les décisions de fusion d’identité. |

Le dossier de travail local est `tracks/7-artwork/uefa-historic-archive` à la racine des preuves de l’audit. Il contient `PASSAGE-DE-RELAIS.md`, `candidate-1932.zip`, le manifeste, les preuves des imports et les entrées rejetées. Le ZIP des 91 critères contient la note détaillée du relais. [Reçus du lot](relais-1932.json) · [Inventaire des 3 466 racines](relais-3466.csv.gz) · [VI-30](https://linear.app/vegainteligence/issue/VI-30#comment-94c53d99-27b2-46b2-ba04-982dc7eaa28a)
