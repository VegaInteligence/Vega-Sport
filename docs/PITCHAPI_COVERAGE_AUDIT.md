# Audit de couverture PitchAPI

Relevé du 1er novembre 2026. Le périmètre demandé comprend toutes les compétitions européennes du catalogue depuis 2024/2025 (les saisons civiles sont regroupées par année de début), ainsi que la Coupe du monde. Les autres compétitions internationales et championnats non européens sont hors périmètre.

## Méthode

Le script `python3 dashboard/scripts/audit_pitchapi_coverage.py` compare le catalogue et les calendriers actuels obtenus via le proxy du site aux inventaires archivés, puis compare les familles de réponses des matchs terminés aux documents enregistrés. Il ne suffit pas qu'un identifiant figure dans l'index : une ancienne fiche de calendrier peut ne comporter que trois familles. Le résultat détaillé se trouve dans `dashboard/outputs/pitchapi-coverage/live-catalogue-audit.json`.

Le script `python3 dashboard/scripts/audit_saved_responses.py` dénombre les statuts conservés pour les observations détaillées et les profils. Les chiffres de réponses ci-dessous concernent des versions archivées ; ils ne représentent pas nécessairement des matchs uniques. Les nouvelles données ou corrections futures de PitchAPI peuvent modifier ces résultats.

## Résultat avant rafraîchissement

- Les 126 couples compétition-saison européens du catalogue étaient présents dans les inventaires. Leurs 27 737 matchs terminés avaient un document, mais 48 n'avaient qu'une ancienne fiche de calendrier et pas les dix autres familles de données détaillées.
- Les treize familles ont été récupérées pour ces 48 matchs et conservées en zone temporaire. Parmi ces réponses, PitchAPI renvoie six indisponibilités pour les statistiques par mi-temps et deux pour chaque famille d'analyses avancées.
- La Coupe du monde 2026, 104 matchs terminés dans le catalogue, n'était pas inventoriée. Les treize réponses de chaque match ont été récupérées en zone temporaire, en conservant les erreurs 404.
- Avant rafraîchissement, les observations déjà archivées contenaient 2 410 réponses `HALVES_UNAVAILABLE` et 142 réponses `ANALYTICS_UNAVAILABLE` pour chacune des quatre familles concernées. Des exemples ont été revérifiés, mais pas tous : on ne peut pas conclure que tous ces 404 sont encore actuels.
- Pour 595 profils distincts, aucune observation enregistrée ne réussissait et au moins une portait `PLAN_UPGRADE_REQUIRED`. Sept exemples revérifiés via le proxy ont renvoyé `PITCHAPI_AUTH_FAILED`, et un a rencontré une limite de débit. Pour 176 autres entités, les observations disponibles ne contenaient pas de succès et incluaient un `RESOURCE_NOT_FOUND`.

Un statut HTTP 200 ne garantit pas que chaque champ soit renseigné, qu'une liste contienne des événements, ou que l'historique soit scientifiquement complet. Les réponses 404, les valeurs nulles, les éventuelles erreurs et les données absentes ne doivent pas être remplacées par des zéros. La [documentation de PitchAPI](https://pitchapi.dev/) décrit les familles, leurs champs et les codes d'indisponibilité ; le catalogue et les réponses restent susceptibles d'évoluer.

## État après rafraîchissement et import local

Le rafraîchissement GitHub [41347598645](https://github.com/OrionQuantPlatform/Football_Ranking/actions/runs/41347598645) a terminé avec succès : 281 matchs récents et 62 fiches de rencontres ont été actualisés. Après synchronisation locale et import de la Coupe du monde, l'audit retrouve les 127 couples compétition-saison du périmètre et ne relève aucun match terminé sans document ou sans l'une des treize familles de réponse. Ce résultat inclut les réponses 404 explicites et ne signifie pas que toutes les valeurs existent.

La Coupe du monde contient localement 104 matchs, 5 323 lignes de performances et 2 505 tirs normalisés. Sur 418 profils mentionnés et absents de l'index avant cet import, 411 réponses exploitables ont été indexées et sept ont renvoyé 404. Les 1 008 fichiers de tables préexistants ont conservé leurs empreintes. La Coupe du monde et les adaptations du collecteur font partie du dépôt.

Les réponses conservées comprennent 2 521 versions `HALVES_UNAVAILABLE` et 147 versions `ANALYTICS_UNAVAILABLE` pour chacune des quatre familles avancées. Ces nombres comptent des versions de réponse, pas nécessairement des matchs distincts. Parmi les réponses HTTP 200, 13 listes de joueurs étaient vides ; une nouvelle requête pour chacun de ces 13 matchs a également renvoyé une liste vide.

Après la mise à jour, 601 profils distincts ne possèdent toujours aucune version réussie et ont au moins une réponse historique `PLAN_UPGRADE_REQUIRED`. En outre, 183 entités sans version réussie présentent au moins une réponse `RESOURCE_NOT_FOUND` ; ce total inclut les sept profils de la Coupe du monde. Ces statuts ne prouvent pas qu'un refus persiste pour chaque entité aujourd'hui.

## Limites

Les contrôles comparent le catalogue renvoyé par l'API, pas l'ensemble du football mondial. Une compétition ou un match absent chez le fournisseur ne peut pas être détecté comme manquant par cette seule méthode. Les profils refusés exigent une nouvelle tentative avec un accès fonctionnel ; le contrôle local direct a rencontré un HTTP 403 Cloudflare, tandis que le proxy hébergé donne accès aux calendriers et à la majorité des ressources. La vérification d'un petit échantillon de réponses actuelles ne prouve pas que chaque valeur historique n'a pas changé depuis sa collecte.
