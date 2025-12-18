# VMAT Web TPS Demo – Implementation Plan

Goal: wrap the PortPy VMAT global optimal example into a callable runner, FastAPI backend, and Next.js UI that lets users tweak objectives, run optimization, view DVHs/dose, and compare runs—without changing PortPy math. Include a way to view shipped reference plan/dose DVH without re-running optimization.

Constraints: reuse PortPy code as-is, stick to the Lung_Patient_6 VMAT workflow from `examples/vmat_global_optimal.ipynb`, keep file-based storage, and mirror default objectives/parameters unless explicitly overridden.

## Workstreams
- **Runner (Python)**: Build `services/api/app/portpy_runner/vmat_global_optimal_runner.py` with `run_vmat_global_optimal(config)`. Must load CT/structures/beams, create downsampled influence matrix, rebuild the notebook MIP objectives/constraints, run MOSEK, and emit DVHs, dose grid reference, metrics, and solver traces. Defaults reproduce the notebook exactly; allow weight/target overrides via config.
- **Objective schema/adapter**: Define a JSON-editable schema (structure name, role, type, weight, dose perc/gy, flags) with defaults from `optimization_params_Lung_2Gy_30Fx*.json`. Adapter translates schema → PortPy objective definitions and plugs into the runner.
- **Storage layout**: Implement `data/portpy_cache/cases/<case_id>/...` and `data/runs/<run_id>/...` (config.json, dvh.json, metrics.json, dose.npz/zarr, logs.json). `run_id` = hash(config + timestamp). Keep large arrays in files.
- **FastAPI backend**: Endpoints `/cases`, `/cases/{case_id}`, `POST /optimize` (background job), `/runs/{run_id}`, plus reference plan/dose access (`/cases/{case_id}/reference_dose`). Wire background execution, status polling, and artifact serving; no auth in v1.
- **UI (Next.js)**: Single-page TJU-style layout: top bar; left objectives/structures panel (visibility, color chip, role, weight/target controls, reset, re-optimize); center DVH + metrics table (PTV D95/D98/D2; Rectum Dmean/Dmax/D2cc; Bladder Dmean/Dmax; Fem heads Dmax as available); right axial dose/contour viewer with slice slider and dose/contour toggles, plus “load prior plan/dose” action; bottom run comparison (select A/B, overlay DVH, delta metrics). Light theme with subtle Jefferson-blue accents.
- **Validation**: Add a lightweight script or tests to exercise the runner end-to-end with defaults; basic API smoke if time permits.

## Immediate next steps
1) Scaffold the runner module path and stub `run_vmat_global_optimal(config)` with default notebook parameters and expected return payload shape.  
2) Draft the objective JSON schema + adapter logic (map to PortPy objective definitions, support weight/dose overrides).  
3) Implement file-based run/case storage helpers (manifest writing, run_id hashing, saving dose arrays separately).  
4) Stub FastAPI app with the required routes and background job wiring; integrate the runner once ready.  
5) Lay out the Next.js page structure and shared design tokens (colors/typography) before wiring data.  

Progress tracking will update this file as components land.

## Progress checklist
- Runner
  - [x] Create module path `services/api/app/portpy_runner/` with stub `run_vmat_global_optimal`.
  - [x] Encode default config matching notebook (patient/beams/protocol/downsampling).
  - [x] Load CT/structures/beams/influence matrix with downsampling cache support.
  - [x] Rebuild objective/constraint set as in notebook (linearized over/under-dose, MIP deliverability).
  - [x] Run MOSEK, capture solver/objective trace (fallback to ECOS_BB if needed).
  - [x] Compute DVHs and key metrics; serialize dose grid to file reference.
  - [x] Package return payload and write artifacts to run directory.
- Objective schema/adapter
  - [x] Define JSON schema (structure, role, type, weight, dose perc/gy, flags, defaults).
  - [x] Load defaults from PortPy opt params; apply overrides.
  - [x] Translate schema to PortPy objective definitions used by runner.
  - [ ] Validate inputs and surface errors clearly (type coercion, bounds, required fields).
- Storage
  - [x] Create `data/portpy_cache/cases/<case_id>/manifest.json` and artifacts folder.
  - [x] Implement run_id hashing (config + timestamp) and `data/runs/<run_id>/...` writers.
  - [x] Save large arrays (dose) to npz/zarr; save DVH/metrics/logs to JSON.
  - [x] Add helpers to read run artifacts for API/UI.
- FastAPI backend
  - [x] Scaffold app and router.
  - [x] Implement `/cases` and `/cases/{case_id}` from cache/metadata.
  - [x] Implement `POST /optimize` to enqueue background runner job and return run_id.
  - [x] Implement `/runs/{run_id}` status + artifact retrieval.
  - [x] Add `/cases/{case_id}/reference_dose` to load shipped RT plan/dose and compute DVH/metrics.
  - [x] Wire logging/progress capture + solver health check; no auth in v1.
- UI (Next.js)
  - [x] Set up Next.js app with TJU-themed tokens (colors/typography/spacing).
  - [x] Build top bar with case selector, run status, save/load.
  - [x] Objectives panel (visibility, color chip, role tag, weight/target controls, reset, re-optimize).
  - [x] DVH plot with multi-ROI overlays; metrics table (PTV D95/D98/D2; Rectum Dmean/Dmax/D2cc; Bladder Dmean/Dmax; Fem heads Dmax).
  - [x] Axial dose viewer with contours, isodose overlays, slice slider, toggles, and “Load prior plan/dose” button.
  - [x] Run comparison section (select A/B, overlay DVHs, delta metrics).
  - [x] Connect to backend endpoints and handle loading/errors; add console + solver progress charts/timer.
- Validation
  - [ ] Add CLI/script to run default VMAT and verify outputs exist (dose, DVH, metrics).
  - [ ] Add minimal API smoke test (optimize + fetch run).
  - [ ] Manual UI sanity checklist for DVH/dose rendering and run comparisons.

## Recent updates
- Added backend solver log/progress capture with MOSEK/ECOS traces, solver health endpoint, and native-type serialization to avoid numpy errors.
- Added reference RT plan/dose loader with DVH/metrics and Eclipse-like dose overlay + threshold control in the UI.
- Introduced console panel, auto-scroll, solver progress charts with elapsed timer, and prescription pane.
- Bounded MOSEK runs with optional time/gap caps and retries; ECOS_BB fallback remains.

# Next Release – v1.0.0 (Job orchestration, reliability, and data explorer)

Goal: make the app a fast, reliable experiment runner. Queue jobs to remote/desktop workers without blocking the UI, avoid stale artifacts, and expose a database-backed history so prior runs and parameter sweeps are instantly explorable. Guarantee DVH/dose/CC freshness when switching plans/cases, and add missing PTV minimum coverage criteria/normalization.

## Themes
- **Job orchestration + workers**: API issues job IDs to a queue; workers (desktop or server agents) pull, run optimizer, and push artifacts. Frontend never blocks; polling is via status endpoints that stream progress/logs. Support round-robin or target worker selection.
- **Asynchronous dose reconstruction**: If dose reconstruction >10s, offload to a background task; UI only swaps in when ready. Avoid UI freezes; show “pending dose” states and previously cached dose.
- **Database-backed runs**: Central DB (e.g., Postgres/SQLite) for runs, configs, objectives, CC, metrics, artifacts manifest. File store (npz) remains for large arrays, but metadata is queryable for parameter-space analysis and a “Runs/Jobs” page.
- **UI reliability + responsiveness**: Never show stale dose/DVH/CC when switching case/plan. Auto-select the most recent valid artifacts; prefetch needed runs. Replace free-text beam IDs with a beam-count selector that prepopulates IDs from metadata.
- **Clinical criteria completeness**: Add PTV minimum coverage to the clinical criteria file; allow optional plan normalization for comparing runs with different PTV coverage.
- **Versioning**: Track changes as v1.0.0; note API/UI/DB migrations explicitly.

## Workstreams & tasks
- **Orchestrator/queue**
  - Add a job table (id, case, config hash, status, timestamps, worker_id, error, artifacts refs).
  - Implement a lightweight queue (DB-backed) and worker lease/heartbeat.
  - Extend API: `POST /jobs` (enqueue), `GET /jobs`, `GET /jobs/{id}`, `PATCH /jobs/{id}` (cancel), `GET /workers` (status).
  - Worker agent CLI/service: subscribes to queue, runs optimizer, streams logs/progress, uploads artifacts manifest.
  - Configurable worker selection (auto/best available/specific worker).
- **Asynchronous dose/dvh pipeline**
  - Split optimizer vs dose reconstruction tasks. If dose build >10s, enqueue a separate reconstruction job; UI shows cached dose until complete.
  - Cache dose volumes keyed by (run_id, checksum) to avoid recompute on replay.
  - Stream progress states so UI doesn’t freeze; explicit “dose pending” badge.
- **Database integration**
  - Add DB schema for runs, jobs, configs, objectives, clinical criteria, metrics, artifacts manifest, and references to npz paths.
  - Migrate existing run metadata into DB; maintain file store for arrays.
  - Add filters/search for runs (case, beams, voxel ds, gap, solver, timestamps).
  - Expose a “Database / Jobs” page in the UI to view queued/running/completed jobs with sortable columns and quick load actions.
- **UI reliability & UX**
  - Ensure display plan resets on case change and always points to the freshest artifacts for the selected run; invalidate stale cache on selection change.
  - Prefetch artifacts for selected run and reference; guard against stale DVH/CC.
  - Replace beam ID text field with: (a) dropdown for beam pattern (metadata default), (b) numeric beam count selector, (c) optional advanced “edit IDs” dialog.
  - Keep UI snappy: optimistic state for job enqueue; background polling with minimal re-render; debounce inputs.
- **Clinical criteria completeness**
  - Add PTV minimum coverage to the clinical criteria JSON; expose in UI.
  - Add optional plan normalization toggle to compare runs with differing PTV coverage.
  - Recompute CC for each run on load and cache results in DB.
- **Versioning & migration**
  - Tag this plan as v1.0.0; document breaking changes (DB required, new endpoints).
  - Migration script to bootstrap DB and ingest existing runs.
  - Update README with multi-worker/queue instructions.

## Smooth path forward (phased)
1) **DB + queue scaffold**: Define schema, add run/job records, keep file store for dose; implement API CRUD and worker heartbeat.
2) **Worker agent**: CLI/service to pull jobs, run optimizer, stream logs/progress, write artifacts manifest + npz paths; support local desktop/WSL and remote.
3) **UI jobs page + reliable plan selection**: New page for jobs/runs; tighten plan selection to avoid stale dose/DVH; auto-set display plan on completion.
4) **Async dose pipeline**: Split reconstruction task; add “pending dose” state and caching; threshold >10s triggers background path.
5) **Beam UX + CC updates**: Add beam-count selector and advanced edit; add PTV min coverage + normalization toggle; surface in CC display.
6) **Polish + docs**: README update, environment instructions, migration guide; perf tuning (no reload for backend, cache dose loads).

## Risks / mitigations
- **WSL I/O latency**: Keep data/cache in WSL home or dedicated volume; minimize large file churn on `/mnt`.
- **Long dose loads**: Enforce caching + background reconstruction; precompute when idle.
- **Staleness**: Aggressive cache invalidation on case/plan change; display plan pinning logic with versioned artifacts.
- **Multi-worker coordination**: Use DB leases/heartbeats; handle worker dropouts with retry/cancel states.

## Next actions
- Harden MOSEK parameter detection (set only supported params for the installed version) to avoid fallback to ECOS.
- Add lightweight validation on objective overrides and clearer error surfacing to the UI.
- Add smoke tests (optimize + fetch artifacts) and MOSEK health check in CI.
