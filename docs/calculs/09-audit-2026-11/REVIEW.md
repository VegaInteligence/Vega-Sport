# Revue et corrections de l’audit des calculs

17 novembre 2026 — branche `codex/calculation-audit-20261117`, base
`a912ed319e4a0441f09b3f55151393e28c9a215c`.

**Checkpoint local : corrections indépendantes testées ; recontrôle final Opus en attente de quota.**
Voir [l’état détaillé des revues](REVIEW_STATUS.md).

L’[audit reçu](SOURCE_AUDIT.md) est conservé sans modification comme référence historique.
La [matrice de suivi](TRACEABILITY.md) distingue les corrections de cette branche, les travaux
des autres sessions, les choix de modèle et les validations encore indisponibles. Le document
original est une source à vérifier ; ses recommandations ne valent pas preuve d’exécution.

## Corrections indépendantes

- Agrégats joueurs limités aux matchs terminés, suppression des lignes devenues obsolètes,
  écart buts−xG et critères de classement calculés sur les mêmes observations.
- Mi-temps complètes uniquement ; exclusions comptées. Centiles soumis à un minimum par mesure.
- Indicateurs club contrôlant leurs primitives et leur couverture propre ; champs appariés pour
  les écarts points/xPts et xG. Dénominateurs hors penalty et traitement prudent des buts contre son camp.
- Loi des xPts adaptative et symétrique, avec domaine numérique explicite ; valeurs inconnues
  conservées dans les lectures match et joueur.
- Embeddings limités aux profils suffisamment renseignés par des valeurs finies ; retours
  d’absence suivant les apparitions en club, sans interruption par une sélection.
- Modèle xG versionné et contraint contre le rebond à grande distance, même score Python/SQL,
  publication refusée si l’ajustement ne converge pas ou produit un résultat invalide ; ce refus
  n’arrête plus les autres calculs quotidiens de la saison, et l’étape reste signalée en échec.
- Évaluateur xG reproductible sur entrées datées et hachées, séparation chronologique et état
  explicite des comparaisons incomplètes. Aucun gain prédictif revendiqué.
- Phrase du scout et minutes par but ou passe décisive respectant les données absentes ;
  situations de tir normalisées, attribution aux vraies équipes et xG inconnu conservé par catégorie.
- Stade 5 : résumés de saison des joueurs du site limités aux matchs terminés, listes de matchs
  conservées en entier ; groupe de poste des cohortes lu sur les matchs terminés ; qualité de
  frappe sur ses deux propres termes ; club du dossier mesuré sur sa lecture complète pour la
  finition, le gardien, la conversion et le xG par tir, sans rang ni médiane sous 5 clubs mesurés ;
  tirs de la séance de tirs au but écartés ; xG de mi-temps non fini écarté ; loi des xPts appelée
  une fois par ligne de la vue.
- Stade 6 : la fiche affichée du joueur lit enfin ce résumé terminé (le navigateur du coordinateur
  montrait encore 260 min et « 87′ » au lieu de 170 et « 57′ ») ; la liste des matchs de l’onglet
  Matchs, la présence et le temps de jeu gardent toutes les observations ; un joueur observé sans
  match terminé garde ses onglets, son identité et son club.
- Stade 7 (corrections bornées après la revue v2) :
  - la fiche d’une performance et la comparaison de joueurs, hors lecture compacte, ne comptent
    plus que les matchs terminés ;
  - la force d’un adversaire sans centile (moins de 5 clubs mesurés) n’est plus le niveau le plus
    faible ;
  - les deux infobulles de notes écrivent « — » pour un but ou une passe décisive inconnus ;
  - les tireurs de la fiche match ne comptent plus la séance de tirs au but.

Les migrations nouvelles sont 125–128 (124–127 avant le rebasage sur main du 17 novembre 2026). Aucun fichier de migration existant ni générateur d’API
n’a été réécrit. La procédure de recalcul et ses préconditions figurent dans la matrice.

## Calculs ajoutés depuis l’audit et travaux en cours

| Domaine relu | Constat vérifié ou limite | Propriétaire conservé |
|---|---|---|
| Coupes européennes | Une ronde partiellement tirée peut remplacer la ronde entière ; une seule manche peut décider une confrontation prévue sur deux manches. Reproductions synthétiques : ronde de 16 limitée à 2 équipes, puis masse de qualification 0 ; première manche 1−0 donnant une qualification 1/0. | [VI-19](https://linear.app/vegainteligence/issue/VI-19) |
| Finales de coupe | Le chemin d’une finale déjà inscrite ne transporte pas le même indicateur de terrain neutre que la finale synthétisée. Le résultat 57,22 % du contrôle ne mesure pas isolément ce biais : ses coefficients sont déjà asymétriques. | VI-19 |
| Formats, départages et probabilités par tour | Revue du format de Conference League, des critères de départage, des effectifs incomplets, de l’imbrication des probabilités et de l’incertitude entre tours. Aucun correctif du propriétaire n’est présumé livré. | VI-19 |
| Sources/Elo | La nouvelle exclusion des dossiers COVERED a été relue sur `adad382925` et sa suite 37/37 exécutée. Elle ne corrige pas l’objectif MAP, sa covariance, les zéros injustifiés ou les fuites temporelles de l’audit. Identités inversées, fenêtre de dédoublonnage et disponibilité historique restent à traiter. | [VI-21](https://linear.app/vegainteligence/issue/VI-21) |
| Nations | Risques statiques : comptes et dates incluant les rencontres futures, joueurs sans filtre terminé, maxima de tirs au but recomposant une paire inexistante, stade programmé présenté comme atteint. Pas de mesure d’incidence en production. | VI-21 |
| Similarité des clubs | Le nouvel endpoint et le nouvel onglet filtrent le support commun ; suite 5/5 et chaîne réelle calculateur→cohorte→route 9/9 passées. L’ancien choix automatique et les suggestions « Comparer avec » utilisent encore le calcul à 100 sans axe commun. Correction partielle, pas clôture de 13a. | [VI-22](https://linear.app/vegainteligence/issue/VI-22) |
| Niveau des championnats dans la similarité | Pénalité continue approuvée par l’utilisateur conservée : aucune dépendance au niveau propre du club ni nouveau seuil dur imposé. Copie et visibilité du support restent au propriétaire. | VI-22 |
| Indicateurs et lectures supplémentaires | Support réel des indicateurs serveur, classement xPts malgré couverture inégale, champs xG appariés, valeurs inconnues des onglets match, taux de contribution incomplet, échec de publication xG et catégories de tirs : corrections indépendantes de cette branche. | [VI-23](https://linear.app/vegainteligence/issue/VI-23) |

Les preuves détaillées, scripts, entrées et réponses sont conservés dans le dossier d’évidence
local indiqué dans `WORKLOG.md`. Les constats statiques sont distingués des reproductions exécutées.
La revue ne prend pas possession du code des autres sessions.

## Validation locale exécutée

| Vérification | Résultat |
|---|---|
| Python, suite complète après les corrections du stade 5 | 388 passés, 0 échec, 0 ignoré ; 380 au stade 4 ; aucun fichier Python modifié aux stades 6 et 7 |
| Site, suite complète après le stade 7 | 662 passés, 0 échec, 0 ignoré ; 652 au stade 6 |
| API, suite complète | 173 passés, 0 échec, 0 ignoré |
| Tests du stade 5 déclarés avant le code | 18 échecs attendus, tous en échec sur le code inchangé (RED), puis 20/20 passés avec les 2 témoins |
| Tests de rendu du stade 6 déclarés avant le code | 4 échecs attendus, tous en échec (RED), puis 5/5 passés avec le témoin |
| Tests du stade 7 déclarés avant le code | 10 échecs attendus, tous en échec sur le code inchangé (RED), puis 10/10 passés ; les 34 fichiers concernés passent |
| Application réelle, infobulles des notes (stade 7) | RED du coordinateur avant correction : 8 échecs attendus (but ou passe inconnus affichés « 0 »), 4 témoins à zéro réussis. GREEN réel après correction : 12/12 assertions réussies, desktop et mobile, sources stables |
| Application réelle, desktop et mobile, relancée après le stade 7 | 70/70 assertions, 7 cas, 14 vues ; phase RED 46 passées / 24 échecs attendus avant correction |
| Application réelle, résumé terminé et historique brut (relancés après le stade 7) | 42/42 assertions : conversion 100,0 %, joueur à 170 min / 2 matchs / « 57′ », puis saison sans match terminé à 0 / 0 / « — » ; identité et trois observations conservées. Historique ancien : 8/8 supplémentaires. RED valide : 26 réussites / 16 échecs attendus |
| Compatibilité avec la route de similarité VI-22 | Deux parcours 9/9 après le stade 5, dont l’ordre réel des migrations 123 puis 124–127 ; calculateur et cohortes réels, sources inchangées. Les stades 6 et 7 ne modifient aucun de leurs composants |
| Build du dashboard | Réussi après répétition ordinaire de la commande ; premier arrêt sur l’avis de sécurité Next 16.4.3 conservé, aucune mise à jour effectuée |

Environnement : Python 3.12.11, Node 26.4.0, Bun 1.4.4, PostgreSQL 18.6/pgvector dans des bases
jetables dédiées. Node 22 de la CI n’a pas été exécuté. Les erreurs initiales de préparation et
les essais RED restent dans les preuves ; ils ne sont pas présentés comme des tests réussis.
Un premier rerun du résumé a conservé les buts nuls du cas précédent (38 réussites / 4 échecs) ;
les entrées déclarées ont été restaurées, puis les mêmes assertions ont donné 42/42. Aucun code
ni résultat attendu n’a été changé pour ce défaut de préparation.

La revue finale v2 a donné deux verdicts différents (Astra/xhigh : aucun défaut actionnable ;
Opus/max : changements demandés), tous deux conservés. Le rapprochement d’Astra a fixé le
périmètre du stade 7. Astra/xhigh a accepté le lot corrigé v3 et relancé 66 tests avec succès.
Le recontrôle Opus/max v3 a échoué sur le quota dans deux sessions fraîches, sans verdict.
La vérification conjointe reste donc en attente ; VI-23 n’est pas clôturé ([état](REVIEW_STATUS.md)).
L’intégration du refus d’ajustement xG dans la passe quotidienne est corrigée et vérifiée (stade 4) :
le refus est journalisé, les autres modèles de la saison et les recomptes s’exécutent, puis l’étape est
signalée en échec avec son délai de reprise ; toute autre erreur l’arrête aussitôt.

## Limites et relais

Les corrections de prévision/Elo/composition, l’horloge B7, le crash sur un événement de but sans
score, les consommateurs UI des champs appariés, l’affichage des exclusions de mi-temps et le xG
absent de la carte de tirs restent avec leurs propriétaires. La carte de correspondance des écrans
VI-22 a été corrigée sur leurs expressions actuelles ([matrice](TRACEABILITY.md)) : les totaux de
saison de finition, de gardien et de qualité de frappe multiplient encore la moyenne par tous les
matchs et lisent une absence comme 0, et les écarts « Buts · xG » demandent des buts appariés que
le service ne fournit pas encore. Côté base, `models._team_index` range encore les xPts sur les
totaux malgré une couverture inégale ; aucune route ne lit cette position (limite consignée). Un xG absent de la carte garde encore
la valeur historique 0,01 ; cette branche ne prétend pas corriger son total affiché.

Le sens d’un indicateur de but contre son camp absent doit être établi par VI-21 : les fixtures
synthétiques ne définissent pas le contrat fournisseur, et la feuille d’événements réelle des tests
ne contient aucun but (13 cartons jaunes, 7 remplacements). Si les buts ordinaires n’ont pas
l’indicateur, seuls les matchs sans but sont mesurés : un 0–0 classé et un 1–0 non classé donnent
une finition de −1 sur un seul match. Le support mesuré est conservé, mais ces valeurs ne sont pas
une estimation de la saison ; une suppression globale demanderait une nouvelle conception commune.
Restent aussi à VI-22 : l’addition d’un xG de catégorie inconnu comme 0 dans la carte
« Coups de pied arrêtés », et le libellé « hors référentiel » d’un adversaire sans centile. Un
réajustement xG refusé laisse les nouveaux tirs sans xG jusqu’au prochain ajustement réussi, sans
modèle de repli. La règle conservatrice peut réduire la
couverture. Aucun snapshot de production ni impact réel sur les classements ou la calibration
n’a été évalué. Aucun déploiement, recalcul en production ou push n’a été effectué.
