# Couverture des exigences au 17 novembre 2026

La version de production comparée est `8018e0836ca0f32e8b2eb51fc2847154abff7f13`. La colonne production qualifie le comportement actuel. Lorsqu’une rubrique regroupe plusieurs calculs, chaque sous-point figure dans [la matrice technique](EXIGENCES.md). Les nouveaux correctifs de la branche figurent dans le [rapport de livraison](README.md).

| § du document initial | En production | Conclusion de la revue |
| --- | --- | --- |
| 1. Tentatives de duels | Incomplet | La restauration à zéro intervient après le calcul du dénominateur. 127 150 entrées avec réussites positives sont touchées dans la lecture figée. |
| 2. Buts hors penalty | Incomplet | L’annexe reproduit la conversion d’un inconnu en zéro. Aucun cas de buteur satisfaisant l’ensemble des conditions dans la lecture des saisons 2021–26. |
| 3. Niveau et incertitude des ligues | Incomplet | Estimation et covariance présentes. Le gradient publié ne correspond pas au gradient numérique sur le cas du document. |
| 4. Historique utilisable en prévision | Manquant pour l’usage à date | Réécrire les contributions avec les matchs futurs change la valeur historique utilisée par la composition. |
| 5. Conservation des matchs simulés | Incomplet | Plusieurs états et les équipes sans force estimée font disparaître des fixtures de la simulation. |
| 6. Loi de simulation de saison | Incomplet | Le modèle d’un match intègre ρ. La simulation peut garder la même distribution lorsque ρ change. |
| 7. Publication de journée ouverte | Incomplet | La règle de gel laisse entrer des résultats de la journée dans ses prédicteurs. |
| 8. Statistiques de clubs inconnues | Implémenté en production pour les champs vérifiés | Calcul et lecture des métriques avec leur support propre. Les cohortes contrôlées portent la version attendue. |
| 9. Écarts réel–attendu | Implémenté en production pour les chemins vérifiés | Échantillons appariés pour la finition du joueur et les points contre xPts du club. |
| 10. Propriétés des xPts | Implémenté en production dans le domaine défini | Loi symétrique et adaptative, branche SQL de la migration 130 et lecteur JS déployés. |
| 11. Accord des routes de pronostic | Incomplet | L’absence de forme, les coefficients les plus récents et l’arbitrage entre prévision de base et composition produisent des probabilités différentes pour le même cas. |
| 12. Variables de composition | Incomplet | L’apprentissage et la production ne lisent pas les mêmes compétitions pour une composition identique. |
| 13. Comparaisons sans observations | Partiellement implémenté en production | Similarité des clubs, seuils de pairs et embeddings corrigés sur les chemins vérifiés. L’absence d’un bloc joueur peut encore produire un centile. |
| 14. Horloges et prolongations | Incomplet | Durées et temps additionnel divergent. Les conventions de score avant et après un but coexistent dans des dizaines de milliers de matchs. |
| 15. Autres calculs | Partiellement implémenté en production | Périmètre des matchs terminés, demi-matchs complets, conversion hors penalty, buts contre son camp et retours en club corrigés sur les chemins vérifiés. Neutralité et correction tardive d’une journée restent ouvertes. |
| 16. Risques de modèle | Partiellement implémenté en production | xG contraint déployé et évalué sur un jeu temporel réel. Pour 96 matchs admis, un but en prolongation modifie encore la cible censée être à 90 minutes. Les choix de pondération du score restent des décisions de méthode. |
| 17. Calculs satisfaisants et documentation | Partiel | Les contrôles historiques et versions de méthodes figurent dans les annexes. Ce rapport date les preuves de production et les écarts nouvellement mesurés. |
| 18. Validation et ordre des réparations | Partiel | Deux évaluations temporelles réelles sont livrées pour les tirs xG et les issues de match. Les effets sur le top 100 après correction de tous les modèles, et la validation des prédictions réellement émises, restent indisponibles. |

## Exigences étendues du 17 novembre

| Demande | Preuve et limite |
| --- | --- |
| Relire les travaux clos | Huit tickets clos revus, avec critères, identifiants déployés, migrations et parcours observables. Les contraintes de chaque vérification figurent dans [le registre Linear](LINEAR.md). |
| Attribuer les sources et éliminer les doublons | Matrice source/domaine/champ/compétition, 2 149 éditions, 35 dossiers délégués au primaire vérifiés. Les absences attestées, les demandes en double et les matchs doublement ingérés figurent dans [la matrice des sources](SOURCES.md). |
| Identités et historique | Mesures de clés, relations, adhésions, transferts et doublons candidats, avec témoins réconciliés. Les fusions d’identités déjà attribuées à VI-21 et leurs recalculs restent ouverts. [Intégrité](INTEGRITE.md) |
| Toute participation éligible a une note Vega | Grille jointe par saison, compétition et type. Les différences entre observation manquante, note manquante, exclusion de politique et classement de force sont explicites. L’Elo par match est disponible pour la population du moteur. Une note 0–100 de prestation de l’équipe pour son seul match est absente. La cible produit reste incomplète. [Notes Vega](NOTES-VEGA.md) |
| Tous les clubs et compétitions ont leur vrai logo | Tous les objets S3 déjà rattachés ont été relus. Les visuels retrouvés possèdent une provenance et une empreinte. Les cas historiques, les doublons d’identité et les identités impossibles sont distingués. Le rapport de livraison donne les nombres validés et leur statut de publication. |
