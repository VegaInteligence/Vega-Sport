# Archive réversible des captures de transfert Neon

## Périmètre et état

La migration `026_legacy_transfer_archive.sql` installe des fonctions opérateur.
**Son installation ne déplace aucune table.** L'exécution et ses preuves natives
sont des opérations distinctes, à enregistrer par l'opérateur privé.

Les dix tables suivantes sont des captures conservées de la réconciliation
historique. Elles n'ont aucun consommateur statique dans les lecteurs ou les
workflows de collecte actuels. L'archive les déplace de `statarena` vers
`statarena_legacy_transfer`, avec le même nom de table.

| Tables | Propriétaire natif observé le 7 novembre 2026 |
|---|---|
| `neon_delta_documents`, `neon_delta_queue` | `statarena_admin` |
| `neon_asset_delta`, `neon_asset_job_delta`, `neon_dirty_partition_delta`, `neon_ingest_failure_delta`, `neon_job_delta`, `neon_projection_delta`, `neon_resource_delta`, `neon_state_delta` | `statarena_ingest` |

Cette opération **retire dix tables du schéma de travail, sans réduire le nombre
physique de tables ni supprimer de lignes**. Elle ne récupère pas leur espace
disque. Le contenu, les OID, les propriétaires, les privilèges des tables, les
colonnes, les contraintes et les index sont conservés. Les estimations de lignes
de l'ancien inventaire ne constituent jamais la preuve d'exécution.

`neon_auth`, les tables actives `resources`, `objects`, `fixtures`, `jobs`,
`asset_jobs`, `dirty_partitions` et les autres tables de collecte restent hors
de l'allowlist. Aucun préfixe générique n'est accepté par la fonction de mutation.

## Audit des consommateurs

Audit du code courant à partir de `cdc12d23ee26201049aed2a7b6bf7bfa61034f2d`,
avant ajout de cette migration :

- Recherche des dix noms exacts et des identifiants SQL `neon_` dans
  `dashboard/backend`, `dashboard/scripts`, `infra` et `.github` : aucune
  référence applicative ou de workflow. Les fonctions d'archive et leur test
  deviennent leurs seuls nouveaux consommateurs explicites.
- `collect-football.yml` appelle `aws_ingest.py`, les collecteurs spécialisés,
  puis `relational_materialize.py`. `uefa-standings.yml` et `rematerialize.yml`
  utilisent également les tables de staging actives et le publisher relationnel.
  Aucun n'appelle un lecteur de ces captures.
- `dashboard/scripts/reconcile_aws_staging.py` reste un outil manuel de reprise.
  Il lit une capture S3 précisément fixée, utilise des tables **temporaires**
  `_statarena_delta_resources`, `_statarena_delta_fixtures`,
  `_statarena_delta_projections`, `_statarena_delta_assets`, puis les cibles
  actives correspondantes. Il ne lit ni n'écrit les dix `neon_*` ci-dessus.
- Les chaînes `raw/neon/...` encore présentes dans `aws_store.py`,
  `aws_ingest.py` et `aws_assets.py` sont des chemins d'objets S3 historiques,
  pas les noms de tables de capture.
- `docs/operations/NEON_RETIREMENT.md` indique que la réconciliation précédente
  des 7 846 objets a été terminée dans la PR 24 et qu'aucun workflow de transfert
  n'est programmé. Le document de fermeture Neon ne vaut pas preuve de la
  fermeture effective du service source.
- L'inventaire du 6 novembre à 20:55 UTC contient des colonnes telles que
  `captured_at`, `source_sha256` et `target_*_at_capture`, sans FK ni dépendance de
  vue sur ces dix tables. La migration refait ces vérifications sur le catalogue
  actuel, sous verrou, et inclut les triggers, règles, politiques, publications,
  dépendances de types et références textuelles des fonctions SQL.

L'audit du dépôt ne peut pas démontrer l'absence d'un ancien processus extérieur
ou d'une requête SQL dynamique construite par fragments. L'opérateur doit
confronter ce résultat aux activités et ordonnanceurs natifs avant l'autorisation.

## Contrat d'exécution

Les deux propriétaires utilisent **leurs identifiants existants**. Aucune
appartenance de rôle, aucun `SET ROLE`, aucune propriété de table ni aucun
privilège de lecture croisée n'est nécessaire à l'opération. Les fonctions sont
`SECURITY INVOKER`; `PUBLIC` n'a pas le droit de les exécuter. L'installation
accorde seulement leur exécution et l'accès au schéma des fonctions aux deux
propriétaires existants `statarena_admin` et `statarena_ingest`.

### 1. Installer et inspecter

Installer la migration dans une transaction et enregistrer son nom/SHA-256 dans
le journal de migration existant. L'installateur doit posséder les fonctions et
le schéma `statarena_app`; aucun accès au schéma d'archive n'est créé à ce stade.

Depuis **chaque connexion propriétaire**, exécuter :

```sql
SELECT statarena_app.legacy_transfer_preflight(false);
```

Conserver ces deux réponses JSON hors des logs publics. Leur réunion doit couvrir
exactement les dix noms, sans recouvrement : deux pour `statarena_admin`, huit pour
`statarena_ingest`. Chaque réponse donne la base, l'acteur, le propriétaire du
schéma, les OID, les **comptages exacts**, les ACL, une empreinte du catalogue et
les compteurs de dépendances/triggers. Tous les compteurs de blocage doivent être
nuls. Aucune ligne métier n'est renvoyée.

### 2. Autoriser au niveau du propriétaire du schéma source

Depuis la connexion du propriétaire réel de `statarena`, après examen des deux
préflights et des consommateurs natifs :

```sql
SELECT statarena_app.legacy_transfer_authorize(
  ARRAY['statarena_admin', 'statarena_ingest']::text[]
);
```

Cette étape refuse tout écart dans les dix noms ou les propriétaires examinés.
Elle crée le schéma d'archive sous le propriétaire du schéma source, retire son
accès `PUBLIC`, puis accorde `USAGE, CREATE` sur les schémas source/destination
aux deux propriétaires. Le privilège `CREATE` sur le schéma source garantit que
le retour arrière reste possible. Les ACL des tables ne changent pas.

### 3. Déplacer chaque lot propriétaire

Depuis chaque connexion propriétaire, lier **sa propre réponse JSON de préflight**
comme paramètre du driver PostgreSQL :

```sql
SELECT statarena_app.legacy_transfer_archive($1::jsonb);
```

Chaque appel prend le verrou de publication existant `97813003`, verrouille en
ordre les tables du propriétaire, recompte les lignes et vérifie exactement le
préflight. Une variation des OID, colonnes, index, propriétaires, ACL, nombres de
lignes ou dépendances bloque le lot. Le mouvement utilise uniquement
`ALTER TABLE ... SET SCHEMA`, puis vérifie à nouveau le même catalogue et les
mêmes comptes. Un échec annule tout le lot dans sa transaction.

Le premier propriétaire peut terminer avant le second; l'appel du second ignore
les tables déjà archivées appartenant à l'autre propriétaire. Un lot propriétaire
partiellement déplacé ou un nom occupé provoque un arrêt. Répéter un appel réussi
avec le même préflight est sans effet supplémentaire, après nouvelle vérification.

Conserver **les deux reçus de retour arrière** renvoyés. Aucun nouvel objet de
stockage de reçus n'est créé, et le propriétaire `statarena_admin` n'a pas besoin de droits
sur `statarena_app.consolidation_state`.

### 4. Vérification finale

Depuis chaque propriétaire :

```sql
SELECT statarena_app.legacy_transfer_preflight(true);
```

Comparer la réponse au champ `after` de son reçu. La réunion des deux réponses
doit contenir exactement les dix tables et tous les OID/comptages initiaux.
Confirmer dans le catalogue natif l'absence de ces dix noms dans `statarena` et
leur présence dans `statarena_legacy_transfer`. Vérifier les lectures publiques
et la collecte active avant de clore le rapport d'exécution.

## Retour arrière

Depuis chaque connexion propriétaire, lier son reçu opérateur conservé :

```sql
SELECT statarena_app.legacy_transfer_rollback($1::jsonb);
```

Le contrôle reprend les mêmes propriétaires, ACL, colonnes, OID et comptes sous
verrou. Un nom source occupé, une dépendance nouvelle ou une modification non
examinée de l'archive bloque le retour. Aucun remplacement de table existante,
aucun `DROP`, aucun `TRUNCATE` et aucun `CASCADE` n'est utilisé. L'archive vide et
les fonctions restent installées après restauration. Le reçu et une répétition
du préflight prouvent le retour des deux lots.

## Validation reproductible

`tests/legacy_transfer_archive_postgres.py` crée un fixture isolé avec deux rôles
`NOINHERIT` et sans droit de lecture croisée. Il couvre la conservation des
valeurs natives, la portée exacte, les ACL/OID, les dépendances et triggers,
l'autorisation du propriétaire de schéma, les comptes périmés, les deux lots,
l'idempotence et le retour arrière. Il refuse les hôtes RDS et les bases de
production. Lancer dans une base PostgreSQL jetable fraîche :

```sh
TEST_DATABASE_URL=postgresql://localhost/vega_ci_test python tests/legacy_transfer_archive_postgres.py
```

Références PostgreSQL : [ALTER TABLE, SET SCHEMA](https://www.postgresql.org/docs/18/sql-altertable.html),
[dépendances natives](https://www.postgresql.org/docs/18/catalog-pg-depend.html)
et [limites du suivi des corps de fonctions](https://www.postgresql.org/docs/18/ddl-depend.html).
