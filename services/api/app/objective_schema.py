"""
Objective schema and adapter for the PortPy VMAT runner.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List

import json


def load_default_objectives(portpy_repo: Path, protocol_name: str) -> List[Dict[str, Any]]:
    cfg_path = (
        portpy_repo
        / "portpy"
        / "config_files"
        / "optimization_params"
        / f"optimization_params_{protocol_name}.json"
    )
    with cfg_path.open() as f:
        data = json.load(f)
    return data.get("objective_functions", [])


def default_schema(portpy_repo: Path, protocol_name: str) -> List[Dict[str, Any]]:
    objs = load_default_objectives(portpy_repo, protocol_name)
    schema: List[Dict[str, Any]] = []
    for obj in objs:
        entry = {
            "structure_name": obj.get("structure_name"),
            "type": obj.get("type"),
            "weight": obj.get("weight"),
            "role": _infer_role(obj.get("structure_name", "")),
            "editable_weight": True,
            "editable_target": False,
        }
        if "dose_gy" in obj:
            entry["dose_gy"] = obj["dose_gy"]
            entry["editable_target"] = True
        if "dose_perc" in obj:
            entry["dose_perc"] = obj["dose_perc"]
            entry["editable_target"] = True
        schema.append(entry)
    return schema


def apply_schema_to_opt_params(
    opt_params: Dict[str, Any], schema_overrides: List[Dict[str, Any]]
) -> Dict[str, Any]:
    if not schema_overrides:
        return opt_params
    updated = deepcopy(opt_params)
    objs = updated.get("objective_functions", [])
    for override in schema_overrides:
        struct = override.get("structure_name")
        obj_type = override.get("type")
        for obj in objs:
            if obj.get("structure_name") == struct and obj.get("type") == obj_type:
                if "weight" in override:
                    obj["weight"] = override["weight"]
                if "dose_gy" in override:
                    obj["dose_gy"] = override["dose_gy"]
                if "dose_perc" in override:
                    obj["dose_perc"] = override["dose_perc"]
    updated["objective_functions"] = objs
    return updated


def _infer_role(structure_name: str) -> str:
    if structure_name.upper().startswith("PTV") or structure_name.upper() in {"CTV", "GTV"}:
        return "target"
    return "oar"
