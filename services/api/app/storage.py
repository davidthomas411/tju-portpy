"""
File-based storage for VMAT runs and PortPy caches.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Dict

import numpy as np

BASE_DATA_DIR = Path("data")
PORTPY_CACHE_DIR = BASE_DATA_DIR / "portpy_cache"
RUNS_DIR = BASE_DATA_DIR / "runs"


def ensure_dirs() -> None:
    for path in [BASE_DATA_DIR, PORTPY_CACHE_DIR, RUNS_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def generate_run_id(config: Dict[str, Any]) -> str:
    timestamp = time.strftime("%Y%m%dT%H%M%S")
    payload = json.dumps(config, sort_keys=True, default=str)
    h = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
    return f"{timestamp}-{h}"


def run_dir(run_id: str) -> Path:
    ensure_dirs()
    path = RUNS_DIR / run_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_run_artifacts(run_id: str, payload: Dict[str, Any]) -> Dict[str, Path]:
    rd = run_dir(run_id)
    to_json = {
        "config": payload.get("config_used"),
        "solver_trace": payload.get("solver_trace"),
        "dvh": payload.get("dvh"),
        "metrics": payload.get("metrics"),
        "clinical_criteria": payload.get("clinical_criteria"),
        "plan": payload.get("plan"),
    }
    for name, data in to_json.items():
        _write_json(rd / f"{name}.json", data)
    dose_info = payload.get("dose", {})
    dose_array = dose_info.get("dose_1d")
    dose_3d = dose_info.get("dose_3d")
    dose_path = None
    dose3d_path = None
    if dose_array is not None:
        dose_path = rd / "dose.npz"
        np.savez_compressed(dose_path, dose_1d=dose_array)
    if dose_3d is not None:
        dose3d_path = rd / "dose_3d.npz"
        np.savez_compressed(dose3d_path, dose_3d=dose_3d)
    logs_path = rd / "logs.json"
    _write_json(logs_path, {"status": "completed", "timestamp": time.time()})
    return {
        "run_dir": rd,
        "dose_path": dose_path,
        "dose3d_path": dose3d_path,
        "config_path": rd / "config.json",
        "metrics_path": rd / "metrics.json",
        "dvh_path": rd / "dvh.json",
        "logs_path": logs_path,
    }


def load_run(run_id: str) -> Dict[str, Any]:
    rd = run_dir(run_id)
    data: Dict[str, Any] = {}
    for name in ["config", "solver_trace", "dvh", "metrics", "clinical_criteria", "plan", "logs"]:
        path = rd / f"{name}.json"
        if path.exists():
            data[name] = _read_json(path)
    dose_path = rd / "dose.npz"
    if dose_path.exists():
        with np.load(dose_path) as npz:
            data["dose"] = {"dose_1d": npz["dose_1d"].tolist(), "path": str(dose_path)}
    dose3d_path = rd / "dose_3d.npz"
    if dose3d_path.exists():
        with np.load(dose3d_path) as npz:
            dose_entry = data.get("dose", {})
            dose_entry["dose_3d_path"] = str(dose3d_path)
            dose_entry["shape_3d"] = list(npz["dose_3d"].shape)
            data["dose"] = dose_entry
    return data


def append_log_line(run_id: str, message: str) -> None:
    rd = run_dir(run_id)
    path = rd / "run.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(message + "\n")


def load_log_lines(run_id: str, max_lines: int = 500) -> list[str]:
    rd = run_dir(run_id)
    path = rd / "run.log"
    if not path.exists():
        return []
    with path.open() as f:
        lines = f.readlines()
    return lines[-max_lines:]


def append_progress(run_id: str, payload: Dict[str, Any]) -> None:
    rd = run_dir(run_id)
    path = rd / "progress.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(payload) + "\n")


def load_progress(run_id: str, max_lines: int = 1000) -> list[Dict[str, Any]]:
    rd = run_dir(run_id)
    path = rd / "progress.jsonl"
    if not path.exists():
        return []
    with path.open() as f:
        lines = f.readlines()
    lines = lines[-max_lines:]
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def save_case_manifest(case_id: str, manifest: Dict[str, Any]) -> Path:
    case_dir = PORTPY_CACHE_DIR / "cases" / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    path = case_dir / "manifest.json"
    _write_json(path, manifest)
    return path


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    def _json_default(obj):
        import numpy as np  # local import
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, (np.ndarray,)):
            return obj.tolist()
        return str(obj)

    with path.open("w") as f:
        json.dump(data, f, indent=2, default=_json_default)


def _read_json(path: Path) -> Any:
    with path.open() as f:
        return json.load(f)
