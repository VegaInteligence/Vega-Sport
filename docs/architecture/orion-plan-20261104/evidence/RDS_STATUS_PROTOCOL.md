# Focused documentary RDS status workflow

Scope: changed plan text and reader status only. The canonical model, SQL migrations, builders, helpers, dictionary and structural diagrams remain unchanged. No SQL, external service, deployment or business-data import is performed by this workflow.

Inputs: the committed application receipt `docs/verification/orion-pro-pilot-20261104/rds-runs/20261104T193736115395Z-reviewed-schema-bootstrap/result.json`, independent readback `docs/verification/orion-pro-pilot-20261104/rds-readbacks/20261104T193830558195Z-rds-schema-bootstrap/result.json` and model SHA `18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08`.

Expected outcomes: the header and embedded plan identify the applied RDS bootstrap, 94 tables, 1 709 columns, 431 FK, 10 seeds and sealed 012/013; no real business data imported; backend/data/full acceptance/cutover/purge remain open. The two RDS receipts are linked, approval is already acquired, Vercel restoration remains separate, and obsolete no-RDS-application claims are absent from the current status. Desktop/mobile/light/dark remain readable, with no JavaScript errors, failed HTTP request or external request.

Failure modes: stale generated plan/HTML; quantities confused with the full 103-table design; schema installation represented as imported data or backend acceptance; sealed SQL or model bytes changed; old 1208 checks represented as checks of the new status; broken links or mobile overflow. Any failed assertion is retained and reported, never silently converted to a pass.

Setup: repository root `/Users/lemonnierhugo/Desktop/Coding Project/Football_ranking`, existing local HTTP server on `127.0.0.1:8794` serving the plan folder, Playwright CLI session `orion-plan`, installed local Chromium, desktop 1440×1000 and mobile 390×844. The previous 1208-check rendering and exact bytes are preserved under `historical-before-rds-bootstrap-status`; the current run is targeted and does not repeat them.

Exact rerun from the repository root:

```sh
python3 -B docs/architecture/orion-plan-20261104/tools/render_plan_text.py
python3 -B docs/architecture/orion-plan-20261104/tools/build_viewer.py
python3 -B docs/architecture/orion-plan-20261104/evidence/run_rds_status_workflow.py
python3 -B docs/architecture/orion-plan-20261104/tools/inspect_proposal.py
python3 -B docs/architecture/orion-plan-20261104/tools/verify_artifacts.py
```

The runner saves exact setup, command, browser assertions/log, input and output hashes, protected-byte comparison, screenshots and actual result in `rds-status-refresh.json`. The static scripts retain their own receipts. SQL/RDS execution proof comes only from the separate application/readback receipts.
