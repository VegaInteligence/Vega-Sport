# Préférences stables entre les pages — 7 novembre 2026

## Problème et résultat vérifié

Le changement de structure des Providers entre l’accueil et les autres pages recréait les contextes Football et Research. Chaque contexte commençait avec un état non réconcilié, puis son effet relisait le stockage, créait de nouveaux objets et signalait ready. Cela provoquait un second commit de leurs consommateurs et réécrivait des valeurs identiques.

Un témoin utilisant les vrais Providers avec React passe de **deux commits au montage puis deux au remontage** à **un puis un**. Pour des préférences et saisons de page déjà enregistrées et inchangées, le témoin passe de **deux écritures localStorage et deux sessionStorage** à **aucune**. Une nouvelle sélection ou une nouvelle entrée de saison reste enregistrée. Ce témoin isole le comportement des contextes ; il ne mesure pas le rendu complet du navigateur et ne prouve pas la cible de 100 ms.

## Contrat conservé

Les instantanés validés appartiennent au Document du navigateur. Le hook utilise `useSyncExternalStore`, relit le stockage lorsqu’il consulte l’état et réutilise l’objet si la valeur n’a pas changé. Les changements entre deux visites, les événements storage et les mises à jour du même onglet sont pris en compte. Un changement entre rendu et abonnement est repris par la vérification de cohérence de React.

Le rendu serveur utilise exclusivement le bootstrap de sa requête. Il ne lit pas le stockage et ne remplit pas un cache partagé entre requêtes. Lors d’une première lecture locale bloquée ou invalide, Football conserve son ancien repli : les préférences et la saison fournies par cette requête. Le repli n’est promu dans le document qu’à l’abonnement commis. Un rendu abandonné ne peut donc pas imposer son état à un autre rendu. Research conserve son repli antérieur vers une sélection vide.

Une valeur locale valide garde la priorité, même lorsqu’elle représente les valeurs par défaut ou une préférence absente. Une édition déjà faite en mémoire survit à une erreur d’écriture et au remontage ; elle n’est pas remplacée par un ancien bootstrap. Une écriture échouée peut être retentée. Les lectures et rendus n’effectuent aucune écriture persistante.

La revue a détecté puis reproduit un défaut du premier prototype : une lecture bloquée remplaçait le focus du bootstrap par Europe. Ce défaut est corrigé avant publication. Les cas de lecture bloquée, JSON malformé et JSON null sont maintenant testés avec les vrais Providers, y compris la conservation du focus, des ligues favorites et de la saison.

## Validation

- **14 tests React dédiés** : SSR/hydratation, même onglet, événements storage, changements entre visites, rendu/abonnement, deux documents distincts, StrictMode, rendu abandonné, échecs d’écriture et récupération, repli de requête et vrais Providers.
- **67 tests ciblés** du lot de contextes et des contrats SSR/compact/Home réussissent.
- **85 tests combinés** avec les abonnements de ressources, la préparation des images et le diagnostic de navigation réussissent.
- Les 14 nouveaux tests sont explicitement inclus dans le workflow Verify ingestion.
- La compilation de production Next avec webpack réussit ; le contrôle de livraison Vercel et la mesure finale restent distincts.

## Mesure après livraison

La [livraison PR47](acceptance-20261107/release-pr47.json) est READY sur le commit `3c7638b88f873d468af32515e11c42f8b03b0882`, après les trois jobs de CI réussis. La [série navigateur complète](acceptance-20261107/browser-after-pr47.json) conserve sept retours réellement en mémoire : **94,6 à 215,1 ms**, dont six dépassent 100 ms. Le témoin React de commits et d’écritures reste une preuve fonctionnelle distincte ; il ne fournit pas isolément un gain de temps navigateur. Le [verdict courant](acceptance-20261107/README.md) conserve les autres limites de mesure.

Les durées de fraîcheur, la publication et les clés de ressources restent inchangées. La [recette navigateur](acceptance-20261107/README.md) conserve les résultats précédents et doit être complétée sur la livraison exacte. Le même lot supprime les scans redondants des événements natifs Media et ajoute le [diagnostic v5](BROWSER_ACCEPTANCE_METRICS.md), dont le changement de harnais interdit une attribution naïve de tout gain mesuré au seul produit.
