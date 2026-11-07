# Préparation du premier écran après PR42

Les [mesures de phases](acceptance-20261107/browser-after-pr42.json) montrent des retours Clubs/Joueurs avec données en mémoire : le nouveau workspace est observé en 42–64,2 ms, puis l'état ready en 199,6–261,7 ms. La mesure complète reste au-dessus des 100 ms. Pour l'accueil, le nouveau main est observé pour la première fois à 157 ms après le clic. Ce délai inclut les effets de mise en page et ne mesure pas isolément le travail de React ou la création du DOM. Ce diagnostic ne prouve pas qu'un seul changement suffira à atteindre la cible.

## Correction

- `PageWorkspace` installe la préparation pendant son layout effect et effectue le premier contrôle immédiatement. Les contrôles suivants restent déclenchés par les mutations, les événements d'image et les frames.
- `DirectMediaImage` commence le décodage d'une image native déjà complète pendant son layout effect. Ses callbacks sont liés au rendu effectivement commité ; un rendu abandonné, une ancienne source ou un démontage ne peut valider la nouvelle image.
- Le contrôleur de page attend l'état visible `ready` de `Media`, qui suit déjà son décodage. Il n'impose plus un second décodage de la même image. Les médias encore loading, les alternatives et les échecs restent attendus jusqu'à leur état terminal.
- Les lectures de styles et de clips d'un ancêtre commun sont réutilisées au sein d'un seul contrôle, puis recalculées au passage suivant. Une image native hors `Media` conserve son propre contrôle de décodage, y compris en cas de changement de `srcset`.
- Le diagnostic expose aussi `data-vega-acceptance-count`, afin d'attendre la fin d'une transition avant de lancer la suivante. L'horloge, le critère ready, la classification mémoire et les deux frames finales restent identiques.

## Vérification

Le [reçu de régression](../verification/browser-readiness-20261107/decode-regression.json) conserve les six cas qui échouent sur le contrôleur PR42 et passent après correction. La suite ciblée de préparation comprend 75 tests réussis, aucun échec ni test ignoré. Une vérification indépendante de 54 tests de préparation, médias, navigation et optimisation d'image passe également. Le build de production Next.js 16.4.3 avec webpack réussit ses 14 pages statiques ; le build standard Vercel reste à confirmer par le déploiement.

Les échéances restent **5 secondes pour les images et 10 secondes pour la page**. Les tests DOM prouvent les règles de disponibilité, d'annulation et de lecture de géométrie. Ils ne prouvent pas un temps de rendu natif. Le verdict des 100 ms exige une nouvelle recette navigateur sur le déploiement exact.
