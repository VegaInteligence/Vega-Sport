# Worklog

## Goal and binding direction — 2026-11-04
- Complete StatArena on existing AWS/RDS, Vercel frontend and CloudFront: detailed data, typed SQL web reads, all features/workflows, measured gains and eventual legacy cleanup. Checkout Football_ranking, GitHub OrionQuantPlatform/STATARENA, main only; commit/push each completed lot with bullet bodies. Preserve unrelated local work.
- Objective: /Users/lemonnierhugo/.codex/attachments/8c5d9c3d-762b-403f-99ef-58a795217f50/goal-objective.md. Original blueprint Orion_schema_bdd.json:84tables is a reference, not a quota.
- **GPT Pro review takes priority**, superseding preceding current-only preference. Retain correction values/dependencies selectively inside business tables; no sister `_history` tables, universal row registry or independent revision per cell. Simple current views and published-build frozen reads.
- New ingestion: PitchAPI → decode/validate in memory → typed RDS transaction. No new raw JSON/CSV/archive in S3 or SQL documents. S3 essential binary media only; legacy sources are temporary reconciliation/rollback inputs, deleted after full acceptance.
- Friend's Codex owns physical Neon→AWS source transfer. No second transfer, disruption or premature purge. Enrichment remains required; new scoring formulas are not automatically in scope.
- Initial54history approval is superseded. Present coherent Pro revision for explicit review before remote schema/data reorganization. Local pilot preparation and immediate availability lot may advance; no target RDS migration applied.
- Latest delegation preference: **gpt-6.1-sol, max**. Root owns integration/review; Astra only for demonstrated need. E2E preferred with reproducible evidence; never write unit tests after covered implementation.

## Existing services and constraints
- One RDS statarena-postgres, us-east-2, PostgreSQL18.6, db.t4g.micro/64GiB; approved20→64 expansion done, no new resize/upgrade. Two logical DBs statarena older import and statarena_prod current target; no drop/rename justified.
- Collect football, Build serving tables and Collect standings disabled. Builder41813449529 cancelled, owned AWS/ingress cleanup succeeded. Stale SQL worker marker is not an active lease. Keep collectors/builders disabled until adapted/validated.
- AWS API https://d317dq37z1tacb.cloudfront.net; signed Lambda origin, read-only RDS runtime, separate media CDN. Migrations003–011 sealed;8s SQL deadline,CloudFrontMaxTTL60. Preserve TLS/network/secret isolation.
- Last AWS ZIP226ff3eebecf3c578d8e35d607b0ad32e7e0341651a73e9b27e340ee5e2cfb89, Lambda512MiB/Node24/25s; refresh before release. Main Vercel git guard false. Final AWS cutover awaits full backend+data acceptance.

## Audit and limits
- docs/AUDIT_ARCHITECTURE_2026-11-04.md and docs/verification/aws-architecture-audit-20261104/. Prod161app tables+5views,14203players,575teams,3273finishedmatches,7813fixtures,125456appearances;38partitions/one season. Target ingest/football/analytics schemas absent at preflight.
- Prod13.711GB;file_documents2,814,256rows/10.432GB dominates storage. Typed serving projections are not complete normalization.108missinghome+108missingaway fixture references;15status disagreements. No full completeness/data-loss conclusion.
- S3 metadata306124objects/4,890,689,338B;images37859/401,928,242B. Neon/AWS counts differ; net totals are not an exact missing-key inventory.
- Old local-only history prototype never passed full acceptance or touched RDS; six active prototype files removed/archived with failures in docs/verification/orion-schema-pilot-20261104/superseded-prototype. Owned PG servers stopped.

## Current lots
- Pro plan:344-line review retained unchanged in docs/architecture/orion-plan-20261104/inputs/GPT_Pro_review.original.txt. Final pure helpers correct constraints and selective keys/grains: 103tables/1791columns/450FK/13domains/51JSONB,46selected,6atomic children,9append-only,3stable. Full staged rebuild passed static inspection; modelbrowser1208/1208 and independentreview pass; status-only architecture refresh7/7pass. Old161-table/201-check evidence is historical, not proof of revised model. SQL bootstrap/intertable/fidelity inventory/measured pilot still pending.
- Dense SQL: relational-core.js scopes appearances by parent match ID and groups extras once. Original patch preserved. Root independently reran real local PostgreSQL/HTTP E2E:8checks pass incl adversarial mismatch, compact wire, pagination, ETag/native scalars. Same-snapshot RDS pair100matches/4788appearances, equal semantic SHA:2605.772→2019.623ms (−22.49%,one ordered pair,notp95).8s unchanged. Release dry-run verifies account/network/templates; ZIP6827c8a889c2622b84ef05f5eb088cdae8255a3d00321f553d0cb77b3cb00ddb,61558B. Deployed code-only via reviewed CFN change set, UPDATE_COMPLETE; same resource identities/runtime/credentials. Dense HTTP3/3pass (4008.62/3575.56/3034.98ms), samegen/counts/hash; HEAD200/304pass; stable-match edge smoke10/10pass. Partitionno-store correctly yieldsMISS; initial inappropriate HITexpectation keptfailed.
- Vercel:canonical READY b2ec973d but publichealth/manifest503; productionAPIorigin absent, AWSpreview only. Old immutable0aaf316e serves6seasons/230chunks vs partialAWS1/38. Keep currentUI and temporary saved-Neon bridge; explicitAWS origin wins. No partialAWS public cutover.
- Bridge local HTTP20/browser8checks passed via labelled local shims. Sol final build passes, fixture fail-closed17workflows pass; real supplemental195refs/65competitions and6seasons/1985fixtures verified in32checks. Honours404matchesoldsource. Archive2020goals decoded2.677MB exceededcap; targeted savedgzip238411B HTTP6/6pass with HEAD/304/negotiation, finalbrowserrunning. ActualVercel build23s, real12workflowbrowser pass; samebuild dpl_2YjDXsva7FBr4yDnzRShmZ776MbA promoted. Bothcanonicalaliases verifiedhealth/manifest/archive200; canonicaldesktop/mobile2/2pass. Maincode f65036cdb9. TemporaryNeonrecovery, noenvchange; finalAWS cutover notperformed.
- Shared-dimension cache A/B/C E2E, complete data, schema/pilot, stable builds, workflow validation, full desktop/mobile parity, cleanup/Neon retirement remain open.

## Next action
- Review/publish coherent Pro plan on main; obtain required revised-schema validation before RDS reorganization.
- Dense-reader code committed/pushed eda0ce3e50 and deployed; publish exact release evidence. No timeout-elimination claim from bounded samples.
- Publish bridge production acceptance/evidence on main; keep missing-source404s explicit. DenseCI passed; frontendCI queued at lastcheck. Final model028c221d… reviewed with3boundedkey/provenance fixes; allfreshproofs complete; obtain revised-schema approval before remote normalization.
- Suggested commits: `perf: batch appearance metrics while preserving match membership`; `fix: bridge the current frontend to saved Neon data`; `docs: align the Orion schema and pilot with the Pro review`.
