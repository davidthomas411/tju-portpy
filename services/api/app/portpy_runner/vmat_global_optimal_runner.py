"""
VMAT global optimal runner

This module wraps the PortPy VMAT global optimal notebook
(`PortPy-master/examples/vmat_global_optimal.ipynb`) into a callable
function that can be invoked by the backend. Defaults match the
notebook: Lung_Patient_6, sparse set of 7 beams, downsampled influence
matrix, and the MIP deliverability constraints.
"""
from __future__ import annotations

import sys
import time
from copy import deepcopy
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import cvxpy as cp
import numpy as np


def _default_repo_root() -> Path:
    """Returns repo root assuming this file lives under services/api/app/portpy_runner."""
    return Path(__file__).resolve().parents[4]


def default_config() -> Dict[str, Any]:
    """Default configuration mirroring the notebook settings."""
    repo_root = _default_repo_root()
    portpy_repo = repo_root / "PortPy-master"
    data_dir = portpy_repo / "data"
    beam_ids = list(np.arange(0, 72, 11))  # 7 beams for benchmark VMAT
    return {
        "patient_id": "Lung_Patient_6",
        "portpy_repo": str(portpy_repo),
        "data_dir": str(data_dir),
        "beam_ids": beam_ids,
        "protocol_global_opt": "Lung_2Gy_30Fx",
        "protocol_vmat": "Lung_2Gy_30Fx_vmat",
        "voxel_down_sample_factors": [6, 6, 1],
        "beamlet_down_sample_factor": 6,
        "per_beam_mu_upper_bound": 2.0,  # U in notebook
        "solver": "MOSEK",
        "solver_verbose": True,
        # Keep MIP runs bounded so they finish in a few minutes
        "mosek_params": {
            "MSK_DPAR_MIO_MAX_TIME": 300.0,       # seconds
            "MSK_DPAR_MIO_TOL_REL_GAP": 0.05,     # stop at 5% gap
        },
        "objective_overrides": [],  # list of dicts (structure_name, type, weight, dose_gy/dose_perc)
        "metrics": _default_metrics_config(),
        "dvh_structures": ["PTV", "ESOPHAGUS", "HEART", "CORD", "LUNG_R"],
    }


def run_vmat_global_optimal(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Run the VMAT global optimal example programmatically.

    Args:
        config: optional overrides; merged with `default_config()`.

    Returns:
        Dictionary containing DVH data, metrics, solver trace, solution summary, and dose array.
        Note: dose arrays are returned in-memory; file persistence is handled by callers.
    """
    cfg = _merge_config(default_config(), config or {})
    repo_root = _default_repo_root()
    portpy_repo = Path(cfg["portpy_repo"]).expanduser()
    if str(portpy_repo) not in sys.path:
        sys.path.append(str(portpy_repo))

    # Late import after sys.path adjustment
    import portpy.photon as pp  # type: ignore

    data_dir = Path(cfg["data_dir"]).expanduser()
    data = pp.DataExplorer(data_dir=str(data_dir))
    data.patient_id = cfg["patient_id"]

    # Core data objects
    ct = pp.CT(data)
    structs = pp.Structures(data)
    beams = pp.Beams(data, beam_ids=cfg["beam_ids"])

    # Clinical/opt params
    clinical_criteria = pp.ClinicalCriteria(data, protocol_name=cfg["protocol_global_opt"])
    opt_protocol = cfg.get("protocol_vmat") or cfg["protocol_global_opt"]
    opt_params = data.load_config_opt_params(protocol_name=opt_protocol)
    structs.create_opt_structures(opt_params=opt_params)

    # Influence matrix + downsampling
    voxel_down_sample_factors = cfg["voxel_down_sample_factors"]
    opt_vox_xyz_res_mm = [
        ct_res * factor for ct_res, factor in zip(ct.get_ct_res_xyz_mm(), voxel_down_sample_factors)
    ]
    beamlet_down_sample_factor = cfg["beamlet_down_sample_factor"]
    new_beamlet_width_mm = beams.get_finest_beamlet_width() * beamlet_down_sample_factor
    new_beamlet_height_mm = beams.get_finest_beamlet_height() * beamlet_down_sample_factor
    inf_matrix_db = (
        pp.InfluenceMatrix(ct=ct, structs=structs, beams=beams)
        .create_down_sample(
            beamlet_width_mm=new_beamlet_width_mm,
            beamlet_height_mm=new_beamlet_height_mm,
            opt_vox_xyz_res_mm=opt_vox_xyz_res_mm,
        )
    )

    my_plan = pp.Plan(ct=ct, structs=structs, beams=beams, inf_matrix=inf_matrix_db, clinical_criteria=clinical_criteria)

    # Remove smoothness objective
    for obj in opt_params.get("objective_functions", []):
        if obj.get("type") == "smoothness-quadratic":
            obj["weight"] = 0

    # Apply any overrides supplied by caller (weights/targets)
    opt_params = _apply_objective_overrides(opt_params, cfg.get("objective_overrides", []), clinical_criteria)

    # Build optimization
    opt = pp.Optimization(my_plan, opt_params=opt_params)
    opt.create_cvxpy_problem()
    _rebuild_linearized_objectives(opt, opt_params, inf_matrix_db, clinical_criteria)

    mip_vars = _add_vmat_constraints(opt, my_plan, inf_matrix_db, cfg["per_beam_mu_upper_bound"])

    # Solve
    start_solve = time.time()
    try:
        solve_kwargs = {"verbose": cfg.get("solver_verbose", False)}
        if cfg["solver"] == "MOSEK" and cfg.get("mosek_params"):
            solve_kwargs["mosek_params"] = cfg.get("mosek_params")
        sol = opt.solve(solver=cfg["solver"], **solve_kwargs)
        solver_used = cfg["solver"]
    except Exception as err:  # noqa: BLE001
        # Retry MOSEK without custom params before falling back
        if cfg["solver"] == "MOSEK":
            try:
                sol = opt.solve(solver="MOSEK", verbose=cfg.get("solver_verbose", False))
                solver_used = "MOSEK"
                sol["warning"] = f"Retry without mosek_params after error: {err}"
            except Exception as err2:  # noqa: BLE001
                fallback = "ECOS_BB"
                sol = opt.solve(solver=fallback, verbose=True)
                solver_used = fallback
                sol["warning"] = f"Primary solver failed ({err}); retry failed ({err2}); used {fallback}."
        else:
            fallback = "ECOS_BB"
            sol = opt.solve(solver=fallback, verbose=True)
            solver_used = fallback
            sol["warning"] = f"Primary solver failed ({err}); used {fallback}."
    solve_time = time.time() - start_solve

    status = getattr(opt.prob, "status", None) if getattr(opt, "prob", None) else sol.get("status")
    if status not in ("optimal", "optimal_inaccurate"):
        # Surface failure early; downstream artifacts depend on a valid solution
        return {
            "solver_trace": {
                "solver": solver_used,
                "status": status or "failed",
                "warning": sol.get("warning"),
                "solve_time_seconds": solve_time,
            },
            "solution": {},
        }

    # Attach MIP vars to solution
    sol["MU"] = mip_vars["mu"].value
    sol["left_leaf_pos"] = mip_vars["lbi"].value
    sol["right_leaf_pos"] = mip_vars["rbi"].value
    sol["inf_matrix"] = inf_matrix_db
    sol["dose_1d"] = inf_matrix_db.A @ sol["optimal_intensity"] * my_plan.get_num_of_fractions()

    # DVH + metrics
    dvh_structs = cfg.get("dvh_structures") or my_plan.structures.get_structures()
    dvh_data = _compute_dvh(my_plan, sol, dvh_structs)
    metrics = _compute_metrics(my_plan, sol, cfg.get("metrics", []))
    clinical_table = _compute_clinical_criteria(my_plan, sol, clinical_criteria)

    solver_trace = {
        "solver": solver_used,
        "objective_value": float(opt.prob.value) if getattr(opt, "prob", None) else None,
        "solve_time_seconds": solve_time,
        "status": getattr(opt.prob, "status", None) if getattr(opt, "prob", None) else sol.get("status"),
    }

    return {
        "config_used": cfg,
        "solver_trace": solver_trace,
        "dvh": dvh_data,
        "metrics": metrics,
        "clinical_criteria": clinical_table,
        "dose": {
            "dose_1d": sol["dose_1d"],
            "shape": list(sol["dose_1d"].shape),
            "unit": "Gy",
            "num_fractions": my_plan.get_num_of_fractions(),
        },
        "solution": {
            "optimal_intensity": sol["optimal_intensity"],
            "MU": sol["MU"],
            "left_leaf_pos": sol["left_leaf_pos"],
            "right_leaf_pos": sol["right_leaf_pos"],
        },
        "plan": {
            "patient_id": cfg["patient_id"],
            "beam_ids": cfg["beam_ids"],
            "prescription_gy": clinical_criteria.get_prescription(),
            "num_fractions": clinical_criteria.get_num_of_fractions(),
        },
    }


# --- helpers ---


def _merge_config(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for k, v in overrides.items():
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            merged[k] = _merge_config(merged[k], v)
        else:
            merged[k] = v
    return merged


def _apply_objective_overrides(
    opt_params: Dict[str, Any], overrides: List[Dict[str, Any]], clinical_criteria
) -> Dict[str, Any]:
    """Adjust objective weights/targets based on caller input."""
    if not overrides:
        return opt_params
    updated = deepcopy(opt_params)
    objs = updated.get("objective_functions", [])
    for ov in overrides:
        struct = ov.get("structure_name")
        obj_type = ov.get("type")
        for obj in objs:
            if obj.get("structure_name") == struct and obj.get("type") == obj_type:
                if "weight" in ov:
                    obj["weight"] = ov["weight"]
                if "dose_gy" in ov:
                    obj["dose_gy"] = ov["dose_gy"]
                if "dose_perc" in ov:
                    obj["dose_perc"] = ov["dose_perc"]
    updated["objective_functions"] = objs
    return updated


def _rebuild_linearized_objectives(opt, opt_params: Dict[str, Any], inf_matrix, clinical_criteria) -> None:
    """Matches the notebook replacement of quadratic objectives with linearized slack formulations."""
    obj_funcs = opt_params["objective_functions"] if "objective_functions" in opt_params else []
    A = inf_matrix.A
    st = inf_matrix
    x = opt.vars["x"]
    opt.obj = []  # remove previous objective functions
    for obj in obj_funcs:
        obj_type = obj.get("type")
        struct = obj.get("structure_name")
        if struct not in opt.my_plan.structures.get_structures():
            continue
        if obj_type == "quadratic-overdose":
            dose_gy = _resolve_obj_dose(opt, obj, clinical_criteria)
            dO = cp.Variable(len(st.get_opt_voxels_idx(struct)), pos=True)
            opt.obj += [(1 / len(st.get_opt_voxels_idx(struct))) * (obj["weight"] * cp.sum(dO))]
            opt.constraints += [A[st.get_opt_voxels_idx(struct), :] @ x <= dose_gy + dO]
        elif obj_type == "quadratic-underdose":
            dose_gy = _resolve_obj_dose(opt, obj, clinical_criteria)
            dU = cp.Variable(len(st.get_opt_voxels_idx(struct)), pos=True)
            opt.obj += [(1 / len(st.get_opt_voxels_idx(struct))) * (obj["weight"] * cp.sum(dU))]
            opt.constraints += [A[st.get_opt_voxels_idx(struct), :] @ x >= dose_gy - dU]
        elif obj_type == "quadratic":
            opt.obj += [
                (1 / len(st.get_opt_voxels_idx(struct))) * (obj["weight"] * cp.sum(A[st.get_opt_voxels_idx(struct), :] @ x))
            ]
        else:
            # The notebook ignored other types (e.g., linear-overdose); we keep behavior consistent.
            continue


def _resolve_obj_dose(opt, obj: Dict[str, Any], clinical_criteria) -> float:
    """Convert dose fields to per-fraction Gy as the notebook does."""
    if "dose_gy" in obj:
        dose_val = opt.get_num(obj["dose_gy"])
    elif "dose_perc" in obj:
        dose_val = obj["dose_perc"] / 100 * clinical_criteria.get_prescription()
    else:
        dose_val = clinical_criteria.get_prescription()
    return dose_val / clinical_criteria.get_num_of_fractions()


def _add_vmat_constraints(opt, my_plan, inf_matrix, mu_upper: float) -> Dict[str, Any]:
    """Adds MIP deliverability constraints matching the notebook."""
    beam_maps = my_plan.inf_matrix.get_bev_2d_grid(beam_id=my_plan.beams.get_all_beam_ids())
    vmat_beams = []
    for beam_map in beam_maps:
        beam_map = beam_map[~np.all(beam_map == -1, axis=1), :]  # remove rows which are not in BEV
        num_rows, num_cols = beam_map.shape
        leaf_idx_beamlet_map = {}
        for j, row in enumerate(beam_map):
            leaf_idx_beamlet_map[j] = row[row >= 0].tolist()
        vmat_beams.append(
            {
                "leaf_idx_beamlet_map": leaf_idx_beamlet_map,
                "num_rows": num_rows,
                "num_cols": num_cols,
                "beam_map": beam_map,
            }
        )
    total_rows = sum([b["num_rows"] for b in vmat_beams])

    lbi = cp.Variable(total_rows, integer=True)
    rbi = cp.Variable(total_rows, integer=True)
    z = cp.Variable(my_plan.inf_matrix.A.shape[1], boolean=True)
    mu = cp.Variable(len(vmat_beams), pos=True)
    x = opt.vars["x"]
    U = mu_upper

    leaf_in_prev_beam = 0
    for i, beam in enumerate(vmat_beams):
        beam_map = beam["beam_map"]
        leaf_idx_beamlet_map = beam["leaf_idx_beamlet_map"]

        for leaf in leaf_idx_beamlet_map:
            beamlets_in_leaf = leaf_idx_beamlet_map[leaf]
            c = np.where(np.isin(beam_map, beamlets_in_leaf))

            opt.constraints += [rbi[leaf_in_prev_beam + leaf] - cp.multiply(c[1] + 1, z[beamlets_in_leaf]) >= 1]
            opt.constraints += [
                cp.multiply((beam["num_cols"] - c[1]), z[beamlets_in_leaf])
                + lbi[leaf_in_prev_beam + leaf]
                <= beam["num_cols"]
            ]
            opt.constraints += [
                cp.sum([z[b_i] for b_i in beamlets_in_leaf])
                == rbi[leaf_in_prev_beam + leaf] - lbi[leaf_in_prev_beam + leaf] - 1
            ]
            opt.constraints += [rbi[leaf_in_prev_beam + leaf] <= beam["num_cols"]]

            opt.constraints += [x[beamlets_in_leaf] <= U * z[beamlets_in_leaf]]
            opt.constraints += [mu[i] - U * (1 - z[beamlets_in_leaf]) <= x[beamlets_in_leaf]]
            opt.constraints += [x[beamlets_in_leaf] <= mu[i]]

        leaf_in_prev_beam = leaf_in_prev_beam + len(leaf_idx_beamlet_map)
        opt.constraints += [mu[i] <= U]
    opt.constraints += [lbi >= 0]
    opt.constraints += [rbi >= 0]
    return {"lbi": lbi, "rbi": rbi, "z": z, "mu": mu}


def _compute_dvh(my_plan, sol: Dict[str, Any], struct_names: List[str]) -> Dict[str, Any]:
    """Return DVH curves as arrays (Gy vs % volume)."""
    from portpy.photon.evaluation import Evaluation  # type: ignore

    dose_1d = sol["dose_1d"]
    dvh = {}
    for struct in struct_names:
        if struct not in my_plan.structures.get_structures():
            continue
        x, y = Evaluation.get_dvh(sol, struct=struct, dose_1d=dose_1d)
        dvh[struct] = {"dose_gy": x, "volume_perc": y * 100}
    return dvh


def _compute_metrics(my_plan, sol: Dict[str, Any], metrics_cfg: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute selected dose metrics."""
    from portpy.photon.evaluation import Evaluation  # type: ignore

    dose_1d = sol["dose_1d"]
    metrics: Dict[str, Any] = {}
    for item in metrics_cfg:
        struct = item["structure"]
        if struct not in my_plan.structures.get_structures():
            continue
        metrics.setdefault(struct, {})
        if item["type"] == "D":
            vol = item["volume_perc"]
            dose = Evaluation.get_dose(sol, struct=struct, volume_per=vol, dose_1d=dose_1d)
            metrics[struct][f"D{vol}"] = float(dose)
        elif item["type"] == "Dmean":
            dose = Evaluation.get_mean_dose(sol, struct=struct, dose_1d=dose_1d)
            metrics[struct]["Dmean"] = float(dose)
        elif item["type"] == "Dmax":
            dose = Evaluation.get_max_dose(sol, struct=struct, dose_1d=dose_1d)
            metrics[struct]["Dmax"] = float(dose)
        elif item["type"] == "Dcc":
            vol_cc = item["volume_cc"]
            total_cc = my_plan.structures.get_volume_cc(struct)
            if total_cc > 0:
                vol_per = vol_cc / total_cc * 100
                dose = Evaluation.get_dose(sol, struct=struct, volume_per=vol_per, dose_1d=dose_1d)
                metrics[struct][f"D{vol_cc}cc"] = float(dose)
    return metrics


def _compute_clinical_criteria(my_plan, sol: Dict[str, Any], clinical_criteria) -> List[Dict[str, Any]]:
    """Return clinical criteria table (Constraint, Structure, Limit, Goal, Plan Value)."""
    try:
        from portpy.photon.evaluation import Evaluation  # type: ignore
        import pandas as pd  # type: ignore
    except Exception:
        return []

    try:
        df = Evaluation.display_clinical_criteria(
            my_plan,
            sol=sol,
            clinical_criteria=clinical_criteria,
            return_df=True,
            in_browser=False,
            open_browser=False,
        )
        if df is None:
            return []
        df = df.where(pd.notnull(df), None)
        table = df.to_dict(orient="records")
        return json.loads(json.dumps(table))
    except Exception:
        return []


def _default_metrics_config() -> List[Dict[str, Any]]:
    """Key metrics for the lung case; UI can override."""
    return [
        {"structure": "PTV", "type": "D", "volume_perc": 95},
        {"structure": "PTV", "type": "D", "volume_perc": 98},
        {"structure": "PTV", "type": "D", "volume_perc": 2},
        {"structure": "ESOPHAGUS", "type": "Dmean"},
        {"structure": "ESOPHAGUS", "type": "Dmax"},
        {"structure": "HEART", "type": "Dmean"},
        {"structure": "HEART", "type": "Dmax"},
        {"structure": "CORD", "type": "Dmax"},
        {"structure": "LUNG_L", "type": "Dmean"},
        {"structure": "LUNG_R", "type": "Dmean"},
        {"structure": "LUNGS_NOT_GTV", "type": "Dmean"},
    ]
