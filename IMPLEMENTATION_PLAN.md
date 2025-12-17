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

## Next actions
- Harden MOSEK parameter detection (set only supported params for the installed version) to avoid fallback to ECOS.
- Add lightweight validation on objective overrides and clearer error surfacing to the UI.
- Add smoke tests (optimize + fetch artifacts) and MOSEK health check in CI.
