"""FastAPI backend for PortPy VMAT demo."""
from __future__ import annotations

import base64
import io
import time
import h5py
import numpy as np
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, List

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import contextmanager
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None
try:
    import pydicom  # type: ignore
except Exception:
    pydicom = None
from scipy.ndimage import binary_erosion

from .download_patient import ensure_patient as ensure_patient_local
from .portpy_runner.vmat_global_optimal_runner import default_config, run_vmat_global_optimal
from .objective_schema import default_schema
from .storage import (
    ensure_dirs,
    generate_run_id,
    load_run,
    save_run_artifacts,
    append_log_line,
    load_log_lines,
    append_progress,
    load_progress,
)
from .objective_schema import _to_native

app = FastAPI(title="PortPy VMAT Demo", version="0.1.0")

# Load .env if present (for HF_TOKEN, etc.)
if load_dotenv:
    load_dotenv()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _portpy_repo() -> Path:
    return _repo_root() / "PortPy-master"


@app.get("/cases")
def list_cases() -> Dict[str, Any]:
    meta_dir = _portpy_repo() / "metadata"
    data_dir = _portpy_repo() / "data"
    cases = []
    if meta_dir.exists():
        cases += [d.name for d in meta_dir.iterdir() if d.is_dir() and "Patient" in d.name]
    if data_dir.exists():
        cases += [d.name for d in data_dir.iterdir() if d.is_dir() and "Patient" in d.name]
    cases = sorted(list(set(cases)), key=lambda x: [int(t) if t.isdigit() else t for t in _split_case_key(x)])
    print(f"[list_cases] found {len(cases)} cases from meta/data dirs")
    return {"cases": cases}


def _split_case_key(name: str):
    import re

    return re.findall(r"\d+|\D+", name)


@app.get("/cases/{case_id}")
def get_case(case_id: str) -> Dict[str, Any]:
    manifest = _load_case_manifest(case_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return manifest


@app.get("/cases/{case_id}/dose_slice/{slice_idx}")
def get_dose_slice(case_id: str, slice_idx: int, threshold_gy: Optional[float] = None) -> Dict[str, Any]:
    """
    Return a dose overlay PNG for the given slice, derived from the reference RT Dose resampled to CT.
    """
    case_dir = _portpy_repo() / "data" / case_id
    if not case_dir.exists():
        raise HTTPException(status_code=404, detail=f"Case directory not found: {case_dir}")

    rt_dose_path = _find_rt_dose(case_dir)
    try:
        dose_3d = _load_dose_resampled_to_ct(case_id=case_id, rt_dose_path=rt_dose_path)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to load RT Dose: {exc}")

    if slice_idx < 0 or slice_idx >= dose_3d.shape[0]:
        raise HTTPException(status_code=400, detail=f"slice_idx out of range (0-{dose_3d.shape[0]-1})")

    dose_slice = dose_3d[slice_idx, :, :]
    overlay_png = _dose_overlay_png(dose_slice, threshold_gy=threshold_gy)
    stats = {
        "mean_gy": float(np.mean(dose_slice)),
        "max_gy": float(np.max(dose_slice)),
        "shape": list(dose_slice.shape),
    }
    return {"slice_index": slice_idx, "overlay_png": overlay_png, "stats": stats}


@app.get("/cases/{case_id}/reference_dose")
def get_reference_dose(case_id: str, structs: Optional[str] = None) -> Dict[str, Any]:
    """
    Load the shipped RT Plan/RT Dose for a case, compute DVH, and return dose stats.
    This does not run optimization; it uses the precomputed DICOM dose.
    """
    case_dir = _portpy_repo() / "data" / case_id
    if not case_dir.exists():
        raise HTTPException(status_code=404, detail=f"Case directory not found: {case_dir}")

    rt_dose_path = _find_rt_dose(case_dir)
    rt_plan_path = _find_rt_plan(case_dir)
    ss_meta_path = case_dir / "StructureSet_MetaData.json"
    ss_data_path = case_dir / "StructureSet_Data.h5"
    if not ss_meta_path.exists() or not ss_data_path.exists():
        raise HTTPException(status_code=404, detail="StructureSet files not found")

    struct_filter = structs.split(",") if structs else None
    try:
        dose_3d = _load_dose_resampled_to_ct(case_id=case_id, rt_dose_path=rt_dose_path)
        # Prescription info from clinical criteria for context
        try:
            import portpy.photon as pp  # type: ignore

            data = pp.DataExplorer(data_dir=str(_portpy_repo() / "data"))
            data.patient_id = case_id
            clinical_criteria = pp.ClinicalCriteria(data, protocol_name=default_config().get("protocol_global_opt", ""))
            pres_gy = clinical_criteria.get_prescription()
            num_fx = clinical_criteria.get_num_of_fractions()
            clinical_table = _clinical_criteria_from_dose(
                dose_3d=dose_3d,
                ss_meta_path=ss_meta_path,
                ss_data_path=ss_data_path,
                clinical_criteria=clinical_criteria,
                prescription_gy=pres_gy,
            )
        except Exception:
            pres_gy = None
            num_fx = None
            clinical_table = []
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to load RT Dose: {exc}")

    dvh, metrics = _compute_dvh_from_dose(
        dose_3d=dose_3d,
        ss_meta_path=ss_meta_path,
        ss_data_path=ss_data_path,
        struct_filter=struct_filter,
    )
    dose_stats = {
        "mean_gy": float(np.mean(dose_3d)),
        "max_gy": float(np.max(dose_3d)),
        "shape": list(dose_3d.shape),
    }
    return _to_native({
        "case_id": case_id,
        "plan": {
            "rt_plan_path": str(rt_plan_path) if rt_plan_path else None,
            "rt_dose_path": str(rt_dose_path),
            "source": "reference_rt_dose",
            "patient_id": case_id,
            "beam_ids": default_config().get("beam_ids"),
            "prescription_gy": pres_gy,
            "num_fractions": num_fx,
        },
        "dose": {
            "stats": dose_stats,
            "source": "reference_rt_dose",
            "path": str(rt_dose_path),
        },
        "dvh": dvh,
        "metrics": metrics,
        "clinical_criteria": clinical_table,
    })


@app.get("/cases/{case_id}/ct_slice/{slice_idx}")
def get_ct_slice(case_id: str, slice_idx: int, structs: Optional[str] = None) -> Dict[str, Any]:
    """
    Return a CT axial slice as base64 PNG plus basic metadata/debug info.
    If structures are available, overlays contour outlines.
    """
    case_dir = _portpy_repo() / "data" / case_id
    ct_meta_path = case_dir / "CT_MetaData.json"
    ct_data_path = case_dir / "CT_Data.h5"
    ss_meta_path = case_dir / "StructureSet_MetaData.json"
    ss_data_path = case_dir / "StructureSet_Data.h5"
    debug = {
        "ct_path": str(ct_data_path),
        "ct_exists": ct_data_path.exists(),
        "folder_listing": [p.name for p in case_dir.iterdir()] if case_dir.exists() else [],
    }
    if not ct_meta_path.exists() or not ct_data_path.exists():
        raise HTTPException(status_code=404, detail="CT files not found")
    with ct_meta_path.open() as f:
        meta = json.load(f)
    dataset_key = meta.get("ct_hu_3d_File", "CT_Data.h5/ct_hu_3d").split("/")[-1]
    try:
        with h5py.File(ct_data_path, "r") as h5:
            if dataset_key not in h5:
                debug["ct_keys"] = list(h5.keys())
                raise HTTPException(status_code=404, detail="CT dataset not found in H5")
            arr = h5[dataset_key]
            num_slices = arr.shape[0]
            if slice_idx < 0 or slice_idx >= num_slices:
                raise HTTPException(status_code=400, detail=f"slice_idx out of range (0-{num_slices-1})")
            slice_hu = arr[slice_idx, :, :]
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))

    window_center = 0
    window_width = 400
    lo = window_center - window_width / 2
    hi = window_center + window_width / 2
    img = np.clip(slice_hu, lo, hi)
    img = (img - lo) / (hi - lo) * 255.0
    img_uint8 = img.astype(np.uint8)
    # Convert to RGBA for overlays
    try:
        from PIL import Image

        pil_img = Image.fromarray(img_uint8).convert("RGBA")
        overlays_applied = False
        if ss_meta_path.exists() and ss_data_path.exists():
            overlays_applied = _overlay_contours(
                pil_img,
                ss_meta_path=ss_meta_path,
                ss_data_path=ss_data_path,
                slice_idx=slice_idx,
                struct_filter=structs.split(",") if structs else None,
            )
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        image_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        image_png = f"data:image/png;base64,{image_b64}"
    except Exception as exc:  # noqa: BLE001
        image_png = None
        debug["overlay_error"] = str(exc)

    return {
        "slice_index": slice_idx,
        "num_slices": int(arr.shape[0]),
        "stats": {
            "mean_hu": float(np.mean(slice_hu)),
            "min_hu": float(np.min(slice_hu)),
            "max_hu": float(np.max(slice_hu)),
        },
        "window": {"center": window_center, "width": window_width},
        "image_png": image_png,
        "debug": debug,
    }


def _overlay_contours(
    pil_img,
    ss_meta_path: Path,
    ss_data_path: Path,
    slice_idx: int,
    struct_filter: Optional[List[str]] = None,
) -> bool:
    """Draw simple contour outlines for selected structures onto a PIL image."""
    try:
        import json
        from PIL import ImageDraw

        with ss_meta_path.open() as f:
            structs_meta = json.load(f)
        names = structs_meta["structures"]["name"] if isinstance(structs_meta, dict) and "structures" in structs_meta else [
            s["name"] for s in structs_meta
        ]
        mask_files = (
            structs_meta["structures"]["structure_mask_3d_File"]
            if isinstance(structs_meta, dict) and "structures" in structs_meta
            else [s["structure_mask_3d_File"] for s in structs_meta]
        )
        structs = list(zip(names, mask_files))
        if struct_filter:
            structs = [s for s in structs if s[0] in struct_filter]
        else:
            keep = {"PTV", "CORD", "ESOPHAGUS", "HEART", "LUNG_L", "LUNG_R"}
            structs = [s for s in structs if s[0] in keep]

        colors = {
            "PTV": (255, 0, 0, 180),
            "CORD": (255, 255, 0, 180),
            "ESOPHAGUS": (0, 255, 0, 180),
            "HEART": (0, 128, 255, 180),
            "LUNG_L": (255, 128, 0, 180),
            "LUNG_R": (255, 0, 255, 180),
        }
        drawn = False
        with h5py.File(ss_data_path, "r") as h5:
            for name, mask_path in structs:
                ds_name = mask_path.split("/")[-1]
                if ds_name not in h5:
                    continue
                mask = h5[ds_name]
                if slice_idx >= mask.shape[0]:
                    continue
                mask_slice = mask[slice_idx, :, :]
                boundary = mask_slice & ~binary_erosion(mask_slice)
                if not boundary.any():
                    continue
                draw = ImageDraw.Draw(pil_img, "RGBA")
                color = colors.get(name.upper(), (255, 255, 255, 180))
                ys, xs = np.nonzero(boundary)
                for x, y in zip(xs.tolist(), ys.tolist()):
                    draw.point((x, y), fill=color)
                drawn = True
        return drawn
    except Exception:
        return False


@app.post("/ensure_patient/{case_id}")
def ensure_patient_route(case_id: str) -> Dict[str, Any]:
    try:
        print(f"[ensure_patient] requested {case_id}")
        patient_dir = ensure_patient_local(case_id, portpy_repo=_portpy_repo())
        print(f"[ensure_patient] {case_id} available at {patient_dir}")
        return {"case_id": case_id, "path": str(patient_dir)}
    except Exception as exc:  # noqa: BLE001
        print(f"[ensure_patient] failed for {case_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/optimize")
def optimize(config: Optional[Dict[str, Any]] = None, background_tasks: BackgroundTasks = None) -> Dict[str, str]:
    ensure_dirs()
    merged_config = default_config()
    if config:
        merged_config.update(config)
    run_id = generate_run_id(merged_config)
    append_log_line(run_id, f"[{run_id}] queued")
    if background_tasks is None:
        _run_job(run_id, merged_config)
    else:
        background_tasks.add_task(_run_job, run_id, merged_config)
    return {"run_id": run_id, "status": "queued"}


@app.get("/runs/{run_id}")
def get_run(run_id: str) -> Dict[str, Any]:
    # In this simplified rehydrate, assume run files exist
    artifacts = load_run(run_id)
    status = artifacts.get("logs", {}).get("status", "unknown")
    if status == "unknown":
        status = artifacts.get("solver_trace", {}).get("status", status)
    return {"run_id": run_id, "status": status, "artifacts": artifacts}


@app.get("/runs/{run_id}/logs")
def get_run_logs(run_id: str) -> Dict[str, Any]:
    lines = load_log_lines(run_id)
    artifacts = load_run(run_id)
    status = artifacts.get("logs", {}).get("status", "unknown")
    return {"run_id": run_id, "status": status, "lines": lines}


@app.get("/runs/{run_id}/progress")
def get_run_progress(run_id: str) -> Dict[str, Any]:
    artifacts = load_run(run_id)
    status = artifacts.get("logs", {}).get("status", "unknown")
    progress = load_progress(run_id)
    return {"run_id": run_id, "status": status, "progress": progress}


@app.get("/health/solver")
def solver_health() -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "mosek_import": False,
        "mosek_license": False,
        "solver_used": None,
        "error": None,
        "license_file": os.getenv("MOSEKLM_LICENSE_FILE"),
    }
    try:
        import mosek  # type: ignore
        info["mosek_import"] = True
    except Exception as exc:  # noqa: BLE001
        info["error"] = f"mosek import failed: {exc}"
        return _to_native(info)

    # Try a tiny LP with MOSEK via cvxpy to confirm license usability
    try:
        import cvxpy as cp  # type: ignore

        x = cp.Variable()
        prob = cp.Problem(cp.Minimize(x), [x >= 1])
        prob.solve(solver="MOSEK", verbose=False)
        info["solver_used"] = "MOSEK"
        if prob.status.lower().startswith("optimal"):
            info["mosek_license"] = True
    except Exception as exc:  # noqa: BLE001
        info["error"] = f"mosek solve failed: {exc}"
    return _to_native(info)


def _run_job(run_id: str, config: Dict[str, Any]) -> None:
    try:
        append_log_line(run_id, f"[{run_id}] started")
        with _capture_solver_output(run_id, parser=_progress_parser(run_id)):
            result = run_vmat_global_optimal(config)
        # Convert to native types to avoid numpy serialization issues
        result = _to_native(result)
        solver_status = result.get("solver_trace", {}).get("status", "unknown")
        if solver_status in (None, "unknown"):
            # If we have artifacts (dose/dvh), mark as completed so UI can load them
            if result.get("dose") or result.get("dvh"):
                solver_status = "completed"
        append_log_line(run_id, f"[{run_id}] {solver_status}")
        save_run_artifacts(run_id, result)
        # overwrite logs.json with solver status so polling stops
        from .storage import _write_json, run_dir
        _write_json(run_dir(run_id) / "logs.json", {"status": solver_status, "timestamp": time.time()})
    except Exception as exc:  # noqa: BLE001
        append_log_line(run_id, f"[{run_id}] failed: {exc}")
        save_run_artifacts(run_id, _to_native({"solver_trace": {"status": "failed", "error": str(exc)}}))
        # mark logs status as failed so UI polling stops correctly
        from .storage import _write_json, run_dir
        _write_json(run_dir(run_id) / "logs.json", {"status": "failed", "timestamp": time.time(), "error": str(exc)})


def _load_case_manifest(case_id: str) -> Optional[Dict[str, Any]]:
    meta_dir = _portpy_repo() / "metadata" / case_id
    data_meta_dir = _portpy_repo() / "data" / case_id

    ss_path = meta_dir / "StructureSet_MetaData.json"
    beams_path = meta_dir / "Beams"
    if not ss_path.exists():
        ss_path = data_meta_dir / "StructureSet_MetaData.json"
        beams_path = data_meta_dir / "Beams"
    if not ss_path.exists():
        return None
    with ss_path.open() as f:
        structs = json.load(f)
    beams = []
    if beams_path.exists():
        for path in beams_path.glob("Beam_*_MetaData.json"):
            with path.open() as f:
                data = json.load(f)
            beams.append({"id": _to_native(data.get("ID")), "gantry_angle": _to_native(data.get("gantry_angle"))})

    # Load default objectives from PortPy config
    objs = []
    pres_gy = None
    num_fx = None
    try:
        portpy_repo = _portpy_repo()
        objs = default_schema(portpy_repo, default_config().get("protocol_global_opt", ""))
        objs = _to_native(objs)
        try:
            import portpy.photon as pp  # type: ignore

            data = pp.DataExplorer(data_dir=str(_portpy_repo() / "data"))
            data.patient_id = case_id
            clinical_criteria = pp.ClinicalCriteria(data, protocol_name=default_config().get("protocol_global_opt", ""))
            pres_gy = clinical_criteria.get_prescription()
            num_fx = clinical_criteria.get_num_of_fractions()
        except Exception:
            pres_gy = None
            num_fx = None
    except Exception:
        objs = _to_native(objs)

    return {
        "case_id": case_id,
        "structures": [_to_native(s.get("name")) for s in structs],
        "structures_detail": _to_native(structs),
        "beams": beams,
        "objectives": objs,
        "prescription_gy": pres_gy,
        "num_fractions": num_fx,
    }


def _find_rt_dose(case_dir: Path) -> Path:
    dicom_dir = case_dir / "DicomFiles"
    candidates = list(dicom_dir.glob("rt_dose*.dcm"))
    if not candidates:
        raise HTTPException(status_code=404, detail="RT Dose DICOM not found")
    return candidates[0]


def _find_rt_plan(case_dir: Path) -> Optional[Path]:
    dicom_dir = case_dir / "DicomFiles"
    candidates = list(dicom_dir.glob("rt_plan*.dcm"))
    return candidates[0] if candidates else None


def _load_dose_resampled_to_ct(case_id: str, rt_dose_path: Path) -> np.ndarray:
    """
    Load RT Dose DICOM and resample to the CT grid using PortPy utilities.
    Falls back to raw pydicom pixel data if conversion fails.
    """
    try:
        import portpy.photon as pp  # type: ignore
        from portpy.photon.utils import convert_dose_rt_dicom_to_portpy  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"PortPy import failed; ensure dependencies are installed: {exc}"
        )

    portpy_repo = _portpy_repo()
    data_dir = portpy_repo / "data"
    data = pp.DataExplorer(data_dir=str(data_dir))
    data.patient_id = case_id
    ct = pp.CT(data)

    try:
        dose_3d = convert_dose_rt_dicom_to_portpy(ct=ct, dose_file_name=str(rt_dose_path))
    except Exception as exc:  # noqa: BLE001
        if pydicom is None:
            raise HTTPException(status_code=500, detail=f"RT Dose conversion failed: {exc}")
        ds = pydicom.dcmread(str(rt_dose_path))
        dose_3d = ds.pixel_array * getattr(ds, "DoseGridScaling", 1.0)
    return np.asarray(dose_3d, dtype=np.float32)


def _compute_dvh_from_dose(
    dose_3d: np.ndarray,
    ss_meta_path: Path,
    ss_data_path: Path,
    struct_filter: Optional[List[str]] = None,
    num_bins: int = 400,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Compute DVH curves and simple metrics from a 3D dose and structure masks."""
    with ss_meta_path.open() as f:
        ss_meta = json.load(f)
    if isinstance(ss_meta, dict) and "structures" in ss_meta:
        names = ss_meta["structures"].get("name", [])
        mask_files = ss_meta["structures"].get("structure_mask_3d_File", [])
    else:
        names = [s.get("name") for s in ss_meta]
        mask_files = [s.get("structure_mask_3d_File") for s in ss_meta]
    structs = list(zip(names, mask_files))
    if struct_filter:
        structs = [s for s in structs if s[0] in struct_filter]
    else:
        keep = {"PTV", "CORD", "ESOPHAGUS", "HEART", "LUNG_L", "LUNG_R"}
        structs = [s for s in structs if s[0] in keep]

    dvh: Dict[str, Any] = {}
    metrics: Dict[str, Any] = {}
    with h5py.File(ss_data_path, "r") as h5:
        for name, mask_path in structs:
            if not name or not mask_path:
                continue
            ds_name = mask_path.split("/")[-1]
            if ds_name not in h5:
                continue
            mask = h5[ds_name][()]
            if mask.shape != dose_3d.shape:
                # Shape mismatch; skip to avoid misleading DVH
                continue
            vals = dose_3d[mask.astype(bool)]
            if vals.size == 0:
                continue
            max_dose = float(vals.max())
            bins = np.linspace(0, max_dose if max_dose > 0 else 0.1, num_bins)
            hist, edges = np.histogram(vals, bins=bins)
            cumulative = np.cumsum(hist[::-1])[::-1]
            volume_perc = (cumulative / cumulative[0] * 100.0) if cumulative[0] > 0 else np.zeros_like(cumulative)
            dvh[name] = {"dose_gy": edges[:-1].tolist(), "volume_perc": volume_perc.tolist()}
            metrics[name] = {"Dmean": float(np.mean(vals)), "Dmax": max_dose}
    return dvh, metrics


def _clinical_criteria_from_dose(
    dose_3d: np.ndarray,
    ss_meta_path: Path,
    ss_data_path: Path,
    clinical_criteria,
    prescription_gy: Optional[float],
) -> List[Dict[str, Any]]:
    """Compute clinical criteria plan values directly from dose and structure masks."""
    try:
        with ss_meta_path.open() as f:
            ss_meta = json.load(f)
        if isinstance(ss_meta, dict) and "structures" in ss_meta:
            names = ss_meta["structures"].get("name", [])
            mask_files = ss_meta["structures"].get("structure_mask_3d_File", [])
        else:
            names = [s.get("name") for s in ss_meta]
            mask_files = [s.get("structure_mask_3d_File") for s in ss_meta]
        name_to_mask = {}
        with h5py.File(ss_data_path, "r") as h5:
            for n, mf in zip(names, mask_files):
                if not n or not mf:
                    continue
                ds_name = mf.split("/")[-1]
                if ds_name in h5:
                    mask = h5[ds_name][()]
                    if mask.shape == dose_3d.shape:
                        name_to_mask[n] = mask.astype(bool)
    except Exception:
        return []

    pres = prescription_gy or 1.0
    table: List[Dict[str, Any]] = []

    def plan_value_max(struct: str) -> Optional[float]:
        m = name_to_mask.get(struct)
        if m is None:
            return None
        vals = dose_3d[m]
        if vals.size == 0:
            return None
        return float(np.max(vals))

    def plan_value_mean(struct: str) -> Optional[float]:
        m = name_to_mask.get(struct)
        if m is None:
            return None
        vals = dose_3d[m]
        if vals.size == 0:
            return None
        return float(np.mean(vals))

    def plan_value_v(struct: str, dose: float) -> Optional[float]:
        m = name_to_mask.get(struct)
        if m is None:
            return None
        vals = dose_3d[m]
        if vals.size == 0:
            return None
        return float(np.sum(vals >= dose) / vals.size * 100.0)

    def plan_value_d(struct: str, volume_perc: float) -> Optional[float]:
        m = name_to_mask.get(struct)
        if m is None:
            return None
        vals = dose_3d[m]
        if vals.size == 0:
            return None
        # dose at volume_perc% (descending)
        sorted_vals = np.sort(vals)[::-1]
        idx = int(np.clip(volume_perc / 100.0 * (len(sorted_vals) - 1), 0, len(sorted_vals) - 1))
        return float(sorted_vals[idx])

    for crit in getattr(clinical_criteria, "clinical_criteria_dict", {}).get("criteria", []):
        ctype = crit.get("type")
        params = crit.get("parameters", {})
        cons = crit.get("constraints", {})
        struct = params.get("structure_name")
        if not struct:
            continue
        constraint_label = ctype.replace("_", " ") if ctype else ""
        row: Dict[str, Any] = {
            "Constraint": constraint_label,
            "Structure Name": struct,
            "Limit": None,
            "Goal": None,
        }
        # Limits/goals formatting
        if "limit_dose_gy" in cons:
            row["Limit"] = f"{cons['limit_dose_gy']}Gy"
        elif "limit_dose_perc" in cons and prescription_gy:
            row["Limit"] = f"{cons['limit_dose_perc']}%"
        elif "limit_volume_perc" in cons:
            row["Limit"] = f"{cons['limit_volume_perc']}%"
        if "goal_dose_gy" in cons:
            row["Goal"] = f"{cons['goal_dose_gy']}Gy"
        elif "goal_dose_perc" in cons and prescription_gy:
            row["Goal"] = f"{cons['goal_dose_perc']}%"
        elif "goal_volume_perc" in cons:
            row["Goal"] = f"{cons['goal_volume_perc']}%"

        plan_val: Optional[float] = None
        if ctype == "max_dose":
            plan_val = plan_value_max(struct)
        elif ctype == "mean_dose":
            plan_val = plan_value_mean(struct)
        elif ctype == "dose_volume_V":
            dose = params.get("dose_gy")
            dose_perc = params.get("dose_perc")
            if dose is None and dose_perc is not None:
                dose = dose_perc * pres / 100.0
            if dose is not None:
                plan_val = plan_value_v(struct, dose)
                row["Constraint"] = f"V({round(dose,2)}Gy)"
        elif ctype == "dose_volume_D":
            vol = params.get("volume_perc")
            if vol is not None:
                plan_val = plan_value_d(struct, vol)

        if plan_val is not None:
            row["Plan Value"] = round(plan_val, 2)
        table.append(row)
    return table


def _dose_overlay_png(dose_slice: np.ndarray, threshold_gy: Optional[float] = None) -> str:
    """Create an Eclipse-like heatmap overlay PNG (base64 data URI) from a 2D dose slice."""
    try:
        from PIL import Image
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"PIL required for dose overlay: {exc}")

    max_val = float(np.max(dose_slice)) if dose_slice.size else 0.0
    if max_val <= 0:
        max_val = 1e-6
    norm = np.clip(dose_slice / max_val, 0.0, 1.0)
    if threshold_gy is not None:
        norm = np.where(dose_slice >= threshold_gy, norm, 0.0)
    # Eclipse-inspired ramp: deep blue -> cyan -> green -> yellow -> orange -> red -> magenta -> white
    stops = np.array([0.0, 0.18, 0.35, 0.5, 0.65, 0.8, 0.9, 1.0])
    palette = np.array(
        [
            [0, 0, 180],
            [0, 200, 255],
            [0, 230, 120],
            [255, 255, 0],
            [255, 180, 0],
            [255, 0, 0],
            [255, 0, 200],
            [255, 255, 255],
        ]
    )
    r = np.interp(norm, stops, palette[:, 0]).astype(np.uint8)
    g = np.interp(norm, stops, palette[:, 1]).astype(np.uint8)
    b = np.interp(norm, stops, palette[:, 2]).astype(np.uint8)
    a = np.clip(norm ** 0.8 * 210, 0, 210).astype(np.uint8)  # stronger at high dose, lighter at low
    rgba = np.stack([r, g, b, a], axis=-1)
    img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    image_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{image_b64}"


@contextmanager
def _capture_solver_output(run_id: str, parser=None):
    """
    Redirect stdout/stderr to append_log_line so solver progress appears in run logs.
    Uses an OS pipe + reader thread to catch C-level prints (MOSEK/ECOS) in real time.
    """
    import os
    import sys
    import threading
    import re

    # Skip noisy web access logs so the console stays focused on solver output.
    ansi_re = re.compile(r"\x1b\[[0-9;]*[mK]")

    def _is_noise(line: str) -> bool:
        plain = ansi_re.sub("", line)
        if "HTTP/1.1" in plain and ("GET /" in plain or "POST /" in plain or "OPTIONS /" in plain):
            return True
        if plain.startswith("INFO:") and "Uvicorn running" in plain:
            return True
        return False

    r_fd, w_fd = os.pipe()

    def reader():
        with os.fdopen(r_fd) as r:
            for line in r:
                line = line.rstrip()
                if not line or _is_noise(line):
                    continue
                append_log_line(run_id, line)
                if parser:
                    try:
                        parser(line)
                    except Exception:
                        pass

    t = threading.Thread(target=reader, daemon=True)
    t.start()

    # Duplicate original stdout/stderr
    orig_out = os.dup(1)
    orig_err = os.dup(2)
    try:
        os.dup2(w_fd, 1)
        os.dup2(w_fd, 2)
        yield
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        try:
            os.close(w_fd)
        except Exception:
            pass
        os.dup2(orig_out, 1)
        os.dup2(orig_err, 2)
        os.close(orig_out)
        os.close(orig_err)
        try:
            t.join(timeout=1.0)
        except Exception:
            pass


def _progress_parser(run_id: str):
    import re
    import time

    iter_re = re.compile(
        r"^\s*(\d+)\s+([\-+\deE\.]+)\s+([\-+\deE\.]+)\s+([\-+\deE\.]+)\s+([\-+\deE\.]+)\s+([\-+\deE\.]+)"
    )
    cvx_mip_re = re.compile(r"\(CVXPY\).+:\s+(.*)")
    runtime_re = re.compile(r"Runtime:\s*([0-9\.]+)")

    def parse(line: str) -> None:
        m = iter_re.match(line)
        if m:
            it, pcost, dcost, gap, pres, dres = m.groups()
            append_progress(
                run_id,
                {
                    "iter": int(it),
                    "pcost": float(pcost),
                    "dcost": float(dcost),
                    "gap": float(gap),
                    "pres": float(pres),
                    "dres": float(dres),
                    "ts": time.time(),
                },
            )
            return
        # Heuristic for MOSEK numeric iteration lines: first token int, then numeric fields
        tokens = line.strip().split()
        if tokens and tokens[0].isdigit() and len(tokens) >= 4:
            try:
                it = int(tokens[0])
                nums = [float(t) for t in tokens[1:]]
                payload = {"iter": it, "ts": time.time()}
                if len(nums) > 0:
                    payload["pcost"] = nums[0]
                if len(nums) > 1:
                    payload["dcost"] = nums[1]
                if len(nums) > 2:
                    payload["gap"] = nums[2]
                if len(nums) > 3:
                    payload["pres"] = nums[3]
                if len(nums) > 4:
                    payload["dres"] = nums[4]
                append_progress(run_id, payload)
                return
            except Exception:
                pass
        mr = runtime_re.search(line)
        if mr:
            try:
                append_progress(run_id, {"runtime_seconds": float(mr.group(1)), "ts": time.time()})
            except Exception:
                pass
        # MOSEK/CVXPY MIP progress lines: "(CVXPY) ...: 0 1 1 0 2.8e+04 1.06e+03 96.2 83.2"
        mm = cvx_mip_re.search(line)
        if mm:
            tokens = mm.group(1).strip().split()
            values: list[float | None] = []
            for t in tokens:
                if t.upper() == "NA":
                    values.append(None)
                    continue
                try:
                    values.append(float(t))
                except Exception:
                    # ignore non-numeric tails like "Root"
                    return
            if len(values) >= 4 and values[0] is not None:
                node = int(values[0])
                # Use last three fields as best_obj, gap_pct, time_s when available
                best_obj = values[-3] if len(values) >= 3 else None
                gap_pct = values[-2] if len(values) >= 2 else None
                time_s = values[-1] if len(values) >= 1 else None
                payload = {"iter": node, "ts": time.time()}
                if best_obj is not None:
                    payload["pcost"] = best_obj
                if gap_pct is not None:
                    payload["gap"] = gap_pct
                if time_s is not None:
                    payload["runtime_seconds"] = time_s
                append_progress(run_id, payload)

    return parse
