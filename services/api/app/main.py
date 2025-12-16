"""FastAPI backend for PortPy VMAT demo."""
from __future__ import annotations

import base64
import io
import h5py
import numpy as np
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, List

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None
from scipy.ndimage import binary_erosion

from .download_patient import ensure_patient as ensure_patient_local
from .portpy_runner.vmat_global_optimal_runner import default_config, run_vmat_global_optimal
from .storage import (
    ensure_dirs,
    generate_run_id,
    load_run,
    save_run_artifacts,
)

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
    return {"run_id": run_id, "status": status, "artifacts": artifacts}


def _run_job(run_id: str, config: Dict[str, Any]) -> None:
    try:
        result = run_vmat_global_optimal(config)
        save_run_artifacts(run_id, result)
    except Exception as exc:  # noqa: BLE001
        save_run_artifacts(run_id, {"solver_trace": {"status": "failed", "error": str(exc)}})


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
            beams.append({"id": data.get("ID"), "gantry_angle": data.get("gantry_angle")})
    return {
        "case_id": case_id,
        "structures": [s.get("name") for s in structs],
        "structures_detail": structs,
        "beams": beams,
    }
