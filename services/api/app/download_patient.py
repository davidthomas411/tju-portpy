"""
Utility to download a single PortPy patient from Hugging Face if not present locally.
"""
from __future__ import annotations

from pathlib import Path

from huggingface_hub import snapshot_download

DATASET_REPO = "PortPy-Project/PortPy_Dataset"


def ensure_patient(patient_id: str, portpy_repo: Path) -> Path:
    """
    Ensure patient data exists under portpy_repo/data/<patient_id>.
    If the folder is missing, empty, or missing required assets, download just that patient from HF.
    """
    data_dir = portpy_repo / "data"
    target_dir = data_dir / patient_id
    required = [
        "CT_Data.h5",
        "CT_MetaData.json",
        "StructureSet_Data.h5",
        "StructureSet_MetaData.json",
    ]

    # If present and has required files, return; otherwise purge and re-download
    if target_dir.exists():
        missing = [name for name in required if not (target_dir / name).exists()]
        try:
            next(target_dir.iterdir())
            is_empty = False
        except StopIteration:
            is_empty = True

        if not is_empty and not missing:
            return target_dir

        import shutil

        shutil.rmtree(target_dir)

    cache_dir = portpy_repo / "hf_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    patterns = [f"data/{patient_id}/**"]
    snapshot_path = snapshot_download(
        repo_id=DATASET_REPO,
        repo_type="dataset",
        cache_dir=cache_dir,
        allow_patterns=patterns,
        resume_download=True,
    )
    src = Path(snapshot_path) / "data" / patient_id
    if not src.exists() or not any(src.iterdir()):
        raise FileNotFoundError(f"Patient {patient_id} not found in snapshot {snapshot_path}")
    data_dir.mkdir(parents=True, exist_ok=True)
    if target_dir.exists():
        import shutil
        shutil.rmtree(target_dir)
    import shutil
    shutil.copytree(src, target_dir)
    return target_dir


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Download a single PortPy patient if missing.")
    parser.add_argument("--patient", required=True)
    parser.add_argument("--portpy-repo", default="PortPy-master")
    args = parser.parse_args()
    out = ensure_patient(args.patient, Path(args.portpy_repo).resolve())
    print(f"Patient available at: {out}")
