# VI-30 — authentic artwork in the existing slots (written before the tests)

Track 7 of [VI-27](https://linear.app/vegainteligence/issue/VI-27), issue
[VI-30](https://linear.app/vegainteligence/issue/VI-30), 18 Nov 2026, base `d4d3fbc542`. A
track-specific file, so that it does not collide with the shared `FAILURE_MODES.md` (§20–§22 are
other tracks'); the coordinator may fold it in as a section at integration.

Read paths only. No ingestion, asset import, URL gate, identity merge, forecast, extra-time or
scoring change: the primary worker owns the importer, `/api/assets`, `image-source.js`, the cup
extra-time serializer (`openCupMatch`, `openLigaMatch`, `notes`) and migration 134; VI-19 owns
forecasts; VI-21 owns identities and `drop_copy`.

## 1. What the branch does (measured in the rehearsal, 18 Nov 2026)

Commit `d4d3fbc542` already resolves the club hero's crest through the checked resolver (`Picture`)
and publishes a competition's own logo in the cup catalogue (migration 135). Measured on the root
harness (`root-checks/role-ui/partial-739c98`), both viewports:

- `/competitions?id=l_v0000130`, the id `/api/cups/index` publishes for Cymru North, shows
  « Compétition inconnue ou indisponible ». `CompetitionsPage` looks an id up by `c.id` only, and the
  catalogue entry is `open-matchday:WAL_2_cymru-north`; its loading guard covers `open-matchday:`
  ids only. The supplemental index (`/api/cup-index?kind=supplemental`), from which the entry is
  built, does not carry the edition's competition id.
- The 29 Cymru North results show initials in all 58 side slots, though each side's team has a
  stored crest in the base. `api.cup_table_rows` (127) joins both teams but selects neither id nor
  crest; `tableRow` emits names only; `CupMatch` renders `<Media name={name} />`.
- `Picture` keeps its failure across a change of `url` (`useState` without a key), unlike `Media`,
  which remounts its attempt on a new source.

## 2. The rules

**A side is its row's own foreign key.** A table row (`/api/cup-table`, the `table-v1` body of
`/api/cups/edition` and `/api/cup-snapshot?kind=edition`) gains an additive `sides` object:

```json
{ "home": "Brickfield", "away": "Llanuwchllyn", "…": "the CSV fields, unchanged",
  "sides": { "home": { "id": "t_v0003688", "image_url": "https://media.vega.invalid/sha256/….jpg" },
             "away": { "id": "t_v0003689", "image_url": "https://media.vega.invalid/sha256/….png" } } }
```

- `sides.home` (`sides.away`) is present only when the row's `home_team_id` (`away_team_id`) is set.
  `sides` is omitted when neither is.
- `id` is the public id of the team the FK names, after one `merged_into` hop: merges move every
  match and leave the merged row as a pointer to the kept team, never to another pointer
  (`identity.py merge_teams`, 094). The API already resolves a merged team's public id the same way
  (`api.internal_id`, 096).
- `image_url` is that team's crest asset reference as stored (`core.assets.source_url`), else `null`.
  The site resolves it through its one gate (`safeImageUrl`, `/api/assets`), as every other crest.
- `home` and `away` keep the source's spelling. Names never choose a crest: two clubs spelled alike
  each keep their own row's FK.
- The provider keys `homeId`/`awayId` of the other cup bodies are unchanged and unrelated.

**A competition answers to its canonical id.** The supplemental index's items gain
`competition_id`, the public id of the edition's competition (`api.cup_editions.competition_id`,
the edition's FK). The site's entry keeps its id `open-matchday:<folder>` and carries the canonical
id as `canonicalId`. A page asked for `l_v…` opens the entry whose id or `canonicalId` it is; the
URL is not rewritten; the directory and the search list the entry once. An item whose canonical id
is a native competition's id is that competition: it is not listed a second time (exact identity,
before the existing name-and-country rule).

**Lookups wait for the catalogue that can answer them.** An `l_v…` id not found yet waits for the
supplemental index like an `open-matchday:` id: the loading state while it loads, the retry notice
when it fails, « Compétition inconnue ou indisponible » only once it answered without the id. Neither
route depends on `/api/cups/index`.

**The site carries the sides to the existing slots.** `normalizeSupplementalCup` copies a side's
`id` and `image_url` to `homeTeamId`/`awayTeamId` and `homeImage`/`awayImage` (the names the bracket
already reads). `CupMatch` passes the image to its two `Media` slots; the national-team branch keeps
its flags. Two legs combined keep the first leg's sides in the displayed order.

**`Picture` restarts on a new source.** Its attempt is keyed by its `url`, as `Media`'s is. Markup,
classes and the plain (non-deferred) image stay as they are.

## 3. Failure modes and expected outcomes

| # | Situation | Expected | Covered by |
|---|---|---|---|
| V1 | both FKs set, both teams with a stored crest (Cymru North, 29 rows) | `sides` from each row's FK; both slots decode that crest's bytes | API contract; E2E 58/58 under both URLs and viewports |
| V2 | FK set, team without a crest | `{ id, image_url: null }`; initials | API contract |
| V3 | one FK null; both null | the side omitted; `sides` omitted; the source name and initials | API contract |
| V4 | two clubs spelled alike, in different rows | each row its own id and crest; a name never borrows one | API contract |
| V5 | an FK naming a merged team | the kept team's id and crest; the source spelling kept | API contract |
| V6 | a stored reference the gate refuses (other host, query) | passed as stored; the site requests nothing and shows initials | site render test |
| V7 | the crest's object answers 404 | initials, no other image (directory and hero) | E2E (Churchill control) |
| V8 | a national-team cup | flags as today; images ignored | site render test |
| V9 | a fixture | `sides` beside its forecast | API contract |
| V10 | the CSV part of every row | byte for byte as before (`sides` aside) | API contract (adjusted, see §4) |
| V11 | two legs, the second reversed | the combined tie keeps the first leg's images, in displayed order | site unit test |
| V12 | `/competitions?id=l_v0000130` | the same entry, edition and header as `open-matchday:WAL_2_cymru-north`; URL kept; one directory card | E2E; site unit test |
| V13 | an `l_v…` id while the supplemental index loads | the loading state, never « inconnue » | E2E (delayed index) |
| V14 | an `l_v…` id when the supplemental index fails | the retry notice; « Réessayer » opens the entry | E2E (failed index) |
| V15 | an `l_v…` id no catalogue holds | « Compétition inconnue ou indisponible » | E2E |
| V16 | an item without `competition_id` (an older API) | no alias, as today | site unit test |
| V17 | `/api/cups/index` unavailable | both URLs still open, sides still shown | E2E |
| V18 | an item whose canonical id is a native competition's | listed once, as the native one | site unit test |
| V19 | `Picture` given a new `url` after a failure | a new attempt with the new source | site unit test |
| V20 | `RankingDialog`'s raw `imageUrl` | changed only if a club row is observed broken | E2E observation |

## 4. Existing expectations adjusted

`backend/api/test/cups.test.mjs` « open-matchday catalogue and tables, as main's » compares each
`/api/cup-table` row to the CSV line with `deepEqual`. Under V1 a row also has `sides`. The CSV part
stays compared byte for byte; `sides` is asserted on its own (V10).

## 5. Not changed (recorded)

- The other cup formats (`matches-v1`, `rounds-v1`, `results-v1`: national archives, OpenLigaDB,
  International Results) serialize their sides in `openCupMatch` and `openLigaMatch`, owned by the
  primary worker's extra-time change. Their list slots still show initials; extending them waits for
  that change (`api.cup_matches` already joins both teams).
- An open-matchday folder holding two editions would give two entries with the same id
  (`supplementalCupCatalog` makes one per item). Production holds one edition per folder (30, all
  2026/2027, registry of 17 Nov 2026): not observed, not changed.
- `Archive.jsx` and the complementary leagues' standings have no badge slot; no slot is added.

## Emblèmes d'édition et emplacements sans visuel

- **E1 — famille et édition.** L'emblème exact provient du pointeur qualifié de l'édition. Les coupes, snapshots natifs, rencontres natives et archives à saison explicite exposent `editionArtwork: { imageUrl, role: "edition_emblem" }` lorsque le pointeur existe. L'index des familles, les anciens champs familiaux et les octets des assets restent stables. Aucun repli depuis une saison voisine, une affiche ou un logo d'organisateur.
- **E2 — sélection.** Sur les deux familles Mondial, le logo daté 2026 ne remplit ni l'annuaire familial ni une édition sans image. Les saisons 1930/1958 restent sans emblème. La sélection 2026 native garde son libellé malgré la saison SQL 2025. CAN 2021, 2023, 2025, Asie 2023 et les éditions FIFA attestées chargent chacune les bytes du manifeste dans le slot existant. Vérifier l'accès direct, un retour, un changement rapide et une erreur réseau sans retour d'image de l'ancienne saison.
- **E3 — placement.** L'annuaire et le titre conservent le nom et le slot de compétition quand l'image manque ou échoue. Trophées et initiales n'y représentent aucune compétition. Les icônes fonctionnelles, noms, dimensions, images des équipes et drapeaux nationaux gardent leur rôle.
- **E4 — compatibilité.** La réponse historique pour une entrée sans emblème omet l'extension. Le repli de snapshot lit la même édition via le corps de coupe ou ses fixtures natives. Les archives exposent l'emblème de la clé et de la saison demandées, y compris si deux associations authentiques partagent un fichier. Le sélecteur d'archives sans slot reste utilisable.
- **E5 — revalidation.** Une liaison change l'ETag des lectures affectées et la répétition conserve la nouvelle valeur. Les pages d'archives suivent la version `archive_season`, les fixtures la génération publiée, et les corps de coupe leur propre représentation. Vérifier le sidecar archive et la route d'asset des coupes sans sidecar. Tester sur PostgreSQL et HTTP locaux sans modifier la production.

- **E6 — coupe de clubs non tabulaire.** La projection des côtés `table-v1` laisse au lecteur `matches-v1` les initiales quand bien même son FK a un vrai écusson. Témoin : les 48 rencontres de groupe CAF 2024/25 puis les 96 emplacements observables. Utiliser les mêmes identités et références sur les deux voies de lecture, en gardant la représentation des drapeaux nationaux, le nom de source et le score par période. Les écussons illustrent le profil, leur dessin historique à la date du match reste à documenter.

- **E7 — recherche bornée.** Quand le manifeste active la recherche bornée des joueurs et clubs, le client continue à chercher les compétitions dans son catalogue. En désactivant l'index complémentaire dans ce mode, « Cymru North » disparaît aussi bien sur ordinateur que téléphone. La recherche doit charger ce catalogue après saisie, donner une seule entrée Cymru North, montrer son logo propre et ouvrir sa fiche. Une panne du catalogue ne doit pas cacher les résultats natifs ni déclencher le chargement général des joueurs et des clubs.
