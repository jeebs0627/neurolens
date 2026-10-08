"""Baseline engine reproduction via Node (tools/colab/baseline_predict.cjs). No Python re-implementation of the gaze engine → no parity drift.

Returns per-session dicts keyed by frame canonical time with px/py (raw model), ax/ay (affine), bx/by (affine+residual), mode, drift and
allowlisted features recomputed by the current engine. Fidelity: 'snapshot+replay-verified' | 'snapshot' | 'replayed' | 'unavailable'."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .safe_io import load_json

TOOL = Path(__file__).resolve().parents[1] / "baseline_predict.cjs"


def node_available() -> bool:
    return shutil.which("node") is not None


def run_baseline(raw_dir: str | Path, out_dir: str | Path, log=print, timeout: int = 3600) -> dict:
    raw, out = Path(raw_dir).resolve(), Path(out_dir).resolve()   # node runs with cwd=repo root, so paths must be absolute
    out.mkdir(parents=True, exist_ok=True)
    if not node_available():
        raise RuntimeError("node is required for baseline reproduction (install Node.js ≥ 18)")
    cmd = ["node", str(TOOL), str(raw / "sessions"), "--out", str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout, cwd=str(TOOL.parents[2]))
    if proc.returncode != 0:
        raise RuntimeError("baseline_predict failed: " + (proc.stderr or proc.stdout)[-800:])
    log(proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "baseline done")
    return load_json(out / "_baseline_summary.json")


def load_baseline(out_dir: str | Path, code: str) -> dict | None:
    p = Path(out_dir) / f"{code}.baseline.json"
    return load_json(p) if p.exists() else None


def index_predictions(baseline: dict, prefer: tuple[str, ...] = ("replaySelection", "snapshot", "replayFinal")) -> tuple[dict, str | None]:
    """Choose the honest fit for residual targets: the selection model (fine points untouched) when available, else the snapshot/final."""
    preds = baseline.get("predictions") or {}
    for name in prefer:
        if name in preds:
            rows = preds[name]
            table = {}
            for block in ("calibrationFrames", "frames"):
                for r in rows.get(block) or []:
                    table[round(r["tc"], 1)] = {**r, "_block": block}
            return table, name
    return {}, None
