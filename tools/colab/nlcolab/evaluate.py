"""Evaluation without leakage: per-split metrics, region/condition breakdowns, proxy vs reference separation, group bootstrap CIs,
and locked-test access logging. Reports always carry limitations (proxy labels, no eye-tracker reference, degrees not reported)."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

from .gaze_dataset import Record
from .train_gaze import Preprocess, matrix


def _metrics(d: np.ndarray, ex: np.ndarray, ey: np.ndarray, w: np.ndarray, Wpx: np.ndarray) -> dict:
    if not len(d):
        return {"n": 0}
    order = np.argsort(d)
    cw = np.cumsum(w[order]) / max(1e-12, w.sum())
    q = lambda p: float(d[order][min(len(d) - 1, int(np.searchsorted(cw, p)))])
    return {"n": int(len(d)), "medianPx": q(0.5), "meanPx": float(np.average(d, weights=w)), "rmsePx": float(math.sqrt(np.average(d ** 2, weights=w))), "p90Px": q(0.9), "p95Px": q(0.95), "biasXPx": float(np.average(ex, weights=w)), "biasYPx": float(np.average(ey, weights=w)), "medianPctW": float(q(0.5) / np.average(Wpx, weights=w) * 100)}


def evaluate_split(records: list[Record], model, pre: Preprocess, name: str, manifest: dict | None = None, who: str = "evaluate") -> dict:
    """Evaluate `model` on records of one split. Reading locked_test/temporal_test is logged into the split manifest."""
    rs = [r for r in records if r.split_role == name]
    if manifest is not None and name in ("locked_test", "temporal_test"):
        manifest.setdefault("access_log", []).append({"at": datetime.now(timezone.utc).isoformat(), "split": name, "by": who, "records": len(rs), "note": "repeated reads turn this split into a regression benchmark; a new prospective holdout is needed for fresh generalisation claims"})
    if not rs:
        return {"split": name, "n": 0}
    X, Y, w, _ = matrix(rs)
    Z = pre.transform(X)
    pred = model.predict(Z)
    Wpx, Hpx = np.array([r.target["W"] for r in rs]), np.array([r.target["H"] for r in rs])
    ex, ey = (pred[:, 0] - Y[:, 0]) * Wpx, (pred[:, 1] - Y[:, 1]) * Hpx
    d = np.hypot(ex, ey)
    out = {"split": name, **_metrics(d, ex, ey, w, Wpx), "windows": len({r.window_id for r in rs}), "sessions": len({r.session_id for r in rs}), "groups": len({r.subject_key or r.session_id for r in rs}),
           "byRegion": {}, "byLabelSource": {}, "byEyeMode": {}, "bySession": {}, "coverage": {"windowsWithPrediction": len({r.window_id for r in rs}), "note": "coverage denominator = labelled windows with a baseline prediction; windows without eye observation are excluded upstream and counted in the inventory"}}
    for key, fn in (("byRegion", lambda r: r.target["region"]), ("byLabelSource", lambda r: r.label_source), ("byEyeMode", lambda r: str(r.base.get("mode"))), ("bySession", lambda r: r.session_id)):
        idx = defaultdict(list)
        for i, r in enumerate(rs):
            idx[fn(r)].append(i)
        for k, ii in idx.items():
            ii = np.array(ii)
            out[key][k] = _metrics(d[ii], ex[ii], ey[ii], w[ii], Wpx[ii])
    return out


def compare(baseline_eval: dict, model_eval: dict) -> dict:
    if not baseline_eval.get("n") or not model_eval.get("n"):
        return {"ok": False, "reason": "empty"}
    gain = 1 - model_eval["medianPx"] / max(1e-9, baseline_eval["medianPx"])
    return {"medianGain": gain, "p95Ratio": model_eval["p95Px"] / max(1e-9, baseline_eval["p95Px"]), "coverageDelta": (model_eval["windows"] - baseline_eval["windows"]) / max(1, baseline_eval["windows"]),
            "worseRegions": [k for k, v in model_eval.get("byRegion", {}).items() if k in baseline_eval.get("byRegion", {}) and v.get("medianPx", 0) > baseline_eval["byRegion"][k].get("medianPx", 0) * 1.05],
            "sparseRegions": [k for k, v in model_eval.get("byRegion", {}).items() if v.get("n", 0) < 30]}


def bootstrap_gain(records: list[Record], model, baseline, pre: Preprocess, name: str, n_boot: int = 500, seed: int = 1) -> dict:
    """Group (session) bootstrap of the median-error gain so overlapping frames are not counted as independent samples."""
    rs = [r for r in records if r.split_role == name]
    if not rs:
        return {"n": 0}
    X, Y, w, _ = matrix(rs)
    Z = pre.transform(X)
    pm, pb = model.predict(Z), baseline.predict(Z)
    Wpx, Hpx = np.array([r.target["W"] for r in rs]), np.array([r.target["H"] for r in rs])
    dm = np.hypot((pm[:, 0] - Y[:, 0]) * Wpx, (pm[:, 1] - Y[:, 1]) * Hpx)
    db = np.hypot((pb[:, 0] - Y[:, 0]) * Wpx, (pb[:, 1] - Y[:, 1]) * Hpx)
    groups = np.array([r.subject_key or r.session_id for r in rs])
    uniq = np.unique(groups)
    rnd = np.random.default_rng(seed)
    gains = []
    for _ in range(n_boot):
        pick = rnd.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([np.flatnonzero(groups == g) for g in pick])
        gains.append(1 - np.median(dm[idx]) / max(1e-9, np.median(db[idx])))
    gains = np.array(gains)
    return {"groups": int(len(uniq)), "medianGain": float(np.median(gains)), "ci95": [float(np.percentile(gains, 2.5)), float(np.percentile(gains, 97.5))], "pGainBelowZero": float(np.mean(gains <= 0)), "note": "group bootstrap over sessions/subjects; not a clinical accuracy claim"}


def limitations(records: list[Record]) -> list[str]:
    srcs = {r.label_source for r in records}
    notes = ["Labels are target-proxy (intended fixation) and calibration targets; no external eye-tracker reference exists, so 'accuracy' here is target-proxy error.",
             "Errors are reported in CSS pixels and % of viewport width; viewing distance/physical screen size were not measured, so no degrees of visual angle.",
             "Saccade latency / pursuit lag accuracy improvements are unverified without an external dynamic gaze reference.",
             "Frames within a window are not independent; counts of windows/sessions/groups are reported alongside frames."]
    if "reference_eyetracker" not in srcs:
        notes.append("reference_eyetracker labels: none.")
    if any(r.subject_link_confidence == "none" for r in records):
        notes.append("Some sessions lack a subject key: session-level split only; cross-person generalisation is not demonstrated.")
    return notes
