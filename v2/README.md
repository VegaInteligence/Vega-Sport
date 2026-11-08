# Vega Sport — prototype de base v2

Cette implémentation suit les étapes 1 et 2 du document « Vega Sport — schéma v2 » fourni le 8 novembre 2026. Elle crée une base neuve à partir de PitchAPI. Le RDS, les fichiers et l'API qui servent actuellement le site ne sont ni lus ni modifiés par ce prototype.

## Ce qui fonctionne

- Migrations PostgreSQL 16 : faits `core`, tables de calcul `agg`, suivi `ops` et migration optionnelle pgvector.
- Transport de 19 routes historiques non redondantes, normalisation typée en mémoire, références internes et métadonnées des médias.
- Remplacement transactionnel d'une famille de match, couverture, hash de contenu, révisions, versions de ressources et périmètres à recalculer.
- Conservation des dernières données valides après un échec. L'échec de la tentative est enregistré dans `ops`, sans changer la couverture de la dernière écriture réussie dans `core`.
- File avec cibles typées, déduplication, reprise de bail et contrôle du jeton. Fonctions de cadence des scores et programmation des détails/contrôle à 24 heures.
- Profil joueur/club programmé dès la première apparition, même si un nom est déjà connu. Suivi distinct du dernier profil réussi et de son échéance à 30 jours ; test réel de profils borné séparément des matchs.
- Pilote borné Ligue 1 2025/26, rapports de couverture, tentatives HTTP, temps d'écriture et tailles physiques avec index.

Les tables `agg` sont créées mais leur alimentation et l'API de lecture constituent l'étape 6. La file est testée ; aucun ordonnanceur permanent n'est activé. Les données de modèles, postes, biographies, transferts, contrats et tracking non fournies restent absentes. Le prototype ne crée ni faux résultats ni valeurs issues de la maquette.

## Ajustements nécessaires du schéma proposé

| Point | Décision et raison |
|---|---|
| Identité des matchs | `core.matches` est un ancrage global non partitionné. Les détails sont partitionnés par saison et portent une FK `(match_id, season_id)`. PostgreSQL impose la clé de partition dans les contraintes uniques des tables partitionnées. |
| Heatmaps | Tableaux typés de 192 entiers, contraintes de dimension, bornes, absence de NULL et valeurs non négatives. Le frame demandé est explicitement `acting_ltr`. |
| Pays/régions | Texte pour conserver des codes fournisseur tels que `UEFA` ou `INT-2`, sans tronquer à trois caractères. |
| Compteurs agrégés | `integer` pour les sommes saisonnières, même lorsque la mesure d'un match tient dans un `smallint`. |
| Nombres | Les fractions ne sont jamais arrondies vers un compteur entier. NaN, infinis et dépassements sont refusés. `real` reste une précision volontairement limitée ; ce n'est pas une conservation bit à bit d'un double. |
| Classements | Observations fournisseur dans `core.official_standings`, calcul Vega dans `agg.standings`. Clé de substitution et unicité `NULLS NOT DISTINCT` pour les phases/groupes absents. |
| Statistiques de base/avancées | Espaces de colonnes distincts ; préfixe `advanced_` dans les agrégats, moyennes d'équipe séparées par suffixe `_avg`. |
| Pourcentage de passes | `accurate_passes_pct` complète la liste initiale pour conserver le pourcentage publié, par exemple dans `329 (82%)`, conformément à la règle de parsing du document. |
| Jobs | Cible explicite : catalogue, date, édition ou entité. Un bail utilise un jeton UUID ; un ancien travailleur ne peut pas écrire puis acquitter une tâche reprise. |
| Recalculs | Le périmètre joueur contient joueur, équipe et édition. Une correction marque les anciens et les nouveaux périmètres. |
| Erreurs | Une liste vide valide est une observation connue. Les indisponibilités explicites et les erreurs restent distinctes. Les logs contiennent des codes et chemins, jamais la réponse ni les lignes refusées par PostgreSQL. |

Les agrégations futures devront conserver les dénominateurs de couverture par métrique. Une métrique absente ne vaut pas zéro ; un ratio par 90 minutes ne doit pas utiliser les minutes de matchs où cette métrique n'était pas couverte. La note pondérée par les minutes ne doit inclure que les observations notées avec des minutes valides. Les formules de rôles, indices, potentiel, projections et vecteurs doivent être définies et versionnées avant de remplir leurs tables.

## Exécution locale

Installer Python 3.12, PostgreSQL 16 avec `pg_trgm`, puis `pip install -r v2/requirements.txt`. Créer une base dédiée, par exemple `vega_v2_pilot`. La connexion est volontairement limitée à localhost et à un nom commençant par `vega_v2_` pendant cette phase.

```sh
export PYTHONPATH=v2
export V2_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/vega_v2_pilot
# Fournir PITCHAPI_API_KEY dans l'environnement, sans la mettre dans le dépôt.
python -m vega_v2.pilot --max-matches 1 --report work/vega-v2-pilot.md
```

`--max-matches 306` borne le pilote saisonnier ; `--resume` conserve les familles déjà importées avec succès ou explicitement indisponibles. La liste des matchs de la compétition entière est conservée, même lors du contrôle d'un seul match. Le rapport explicite cette différence pour éviter une extrapolation trompeuse du coût par match. `--vector` applique la migration optionnelle si l'extension est installée. `--profile-limit 2` (défaut) contrôle un profil club et un profil joueur ; mettre zéro pour mesurer uniquement les familles de match. Les références intégrées aux matchs et les profils explicitement collectés ont des compteurs distincts.

Le workflow `Vega v2 isolated pilot` utilise le secret PitchAPI déjà présent dans le dépôt et un PostgreSQL éphémère sur le runner GitHub. Il n'a aucun identifiant AWS ou Neon. Il exporte uniquement un rapport de mesures, jamais la base, un dump ou des réponses API. Le nombre de matchs par défaut des branches de développement est dans `pilot-scope.txt`.

## Validation

Les tests avec base utilisent cinq bases locales jetables distinctes : `vega_v2_test`, `vega_v2_jobs_test`, `vega_v2_store_test`, `vega_v2_pilot_test`, `vega_v2_profiles_test`. Définir respectivement `VEGA_V2_TEST_DSN`, `VEGA_V2_JOBS_TEST_DSN`, `VEGA_V2_STORE_TEST_DSN`, `VEGA_V2_PILOT_TEST_DSN`, `VEGA_V2_PROFILES_TEST_DSN`, puis lancer :

```sh
python -m unittest discover -s v2/tests -v
```

Les suites ne doivent pas être lancées simultanément contre la même base de test. Les tests de schéma incluent pgvector lorsque l'extension est installée. Les tests d'ingestion couvrent le réimport identique, la correction, le rollback, la conservation des faits après erreur et le rejet d'un bail expiré. Les nombres de tests et les mesures réelles sont consignés dans le compte rendu du pilote, séparément des résultats synthétiques.

## Suite dépendante du pilote

Le choix d'infrastructure, le backfill complet, le worker permanent, les agrégats, l'API v2 et la bascule frontend attendent les mesures et les décisions correspondantes. Les 80 Ko par match et 25 Mo pour la Ligue 1 du document restent des estimations tant que le pilote complet n'est pas achevé. Aucun retrait du RDS ou des JSON S3 n'est inclus.

La [documentation PitchAPI](https://pitchapi.dev/) consultée le 8 novembre 2026 décrit désormais `/matches/{id}/live`, contrairement à la mention d'absence de live dans le document fourni. Ce constat appelle une vérification de couverture, fraîcheur et droits lors de l'étape 10 ; il ne modifie pas ce collecteur historique.
