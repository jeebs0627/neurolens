"""Group (session) k-fold model selection on train+val only. The locked/temporal tests are read once, for the single selected config.

Configs cover ridge strengths, small/regularised MLPs and feature subsets (with/without the baseline coordinate, which can let a model
memorise screen-position offsets of particular sessions). Selection metric: mean over folds of the median pixel error; ties → simpler."""
from __future__ import annotations

import math
import random
from collections import defaultdict

import numpy as np

from .gaze_dataset import FEATURES, Record
from .train_gaze import MLP, Ridge, SOURCE_WEIGHT, fit_preprocess


def _xyw(records, feats):
    X = np.array([[r.features.get(k, float("nan")) for k in feats] for r in records], dtype=np.float64)
    Y = np.array([[r.residual["dxFrac"], r.residual["dyFrac"]] for r in records], dtype=np.float64)
    w = np.array([r.weight * SOURCE_WEIGHT.get(r.label_source, 0.5) for r in records], dtype=np.float64)
    WH = np.array([[r.target["W"], r.target["H"]] for r in records], dtype=np.float64)
    return X, Y, w, WH


def _pre(X, feats):
    from .train_gaze import Preprocess  # noqa: PLC0415
    p = fit_preprocess(X)
    return Preprocess(list(feats), p.mean, p.std)


def _median_px(pred, Y, WH):
    d = np.hypot((pred[:, 0] - Y[:, 0]) * WH[:, 0], (pred[:, 1] - Y[:, 1]) * WH[:, 1])
    return float(np.median(d)) if len(d) else math.nan


NO_BASE = [k for k in FEATURES if k not in ("baseX", "baseY")]
EYE_ONLY = ["u", "v", "uLeft", "vLeft", "uRight", "vRight", "qLeft", "qRight", "open", "eyeMode"]
POSE = ["yaw", "pitch", "cx", "cy", "fw"]
CONFIGS = {
    "baseline": ("identity", None, None),
    "ridge_all_l1": ("ridge", FEATURES, {"lam": 1.0}),
    "ridge_all_l10": ("ridge", FEATURES, {"lam": 10.0}),
    "ridge_all_l100": ("ridge", FEATURES, {"lam": 100.0}),
    "ridge_nobase_l10": ("ridge", NO_BASE, {"lam": 10.0}),
    "ridge_pose_l10": ("ridge", POSE + ["baseX", "baseY"], {"lam": 10.0}),
    "mlp_64_32": ("mlp", FEATURES, {}),
    "mlp_small_reg": ("mlp", FEATURES, {"hidden": (16, 8), "dropout": 0.2, "weight_decay": 1e-2}),
    "mlp_nobase_small": ("mlp", NO_BASE, {"hidden": (16, 8), "dropout": 0.2, "weight_decay": 1e-2}),
}


def build(kind, feats, kw):
    if kind == "ridge":
        return Ridge(kw.get("lam", 1.0))
    if kind == "mlp":
        return MLP(**kw)
    return None


def fit_predict(kind, feats, kw, tr, te):
    if kind == "identity":
        return np.zeros((len(te), 2), np.float32), None
    Xtr, Ytr, wtr, _ = _xyw(tr, feats)
    Xte, _, _, _ = _xyw(te, feats)
    pre = _pre(Xtr, feats)
    m = build(kind, feats, kw)
    Ztr, Zte = pre.transform(Xtr), pre.transform(Xte)
    if kind == "mlp":
        m.fit(Ztr, Ytr, wtr)   # no inner val: fixed epochs with patience on training loss
    else:
        m.fit(Ztr, Ytr, wtr)
    return m.predict(Zte), (m, pre)


def group_cv(records: list[Record], k: int = 5, seed: int = 11, log=print) -> dict:
    pool = [r for r in records if r.split_role in ("train", "val")]
    groups = sorted({r.subject_key or r.session_id for r in pool})
    random.Random(seed).shuffle(groups)
    folds = [set(groups[i::k]) for i in range(k)]
    scores = defaultdict(list)
    for i, fg in enumerate(folds):
        te = [r for r in pool if (r.subject_key or r.session_id) in fg]
        tr = [r for r in pool if (r.subject_key or r.session_id) not in fg]
        if not te or not tr:
            continue
        _, Yte, _, WH = _xyw(te, FEATURES)
        for name, (kind, feats, kw) in CONFIGS.items():
            pred, _ = fit_predict(kind, feats or FEATURES, kw or {}, tr, te)
            scores[name].append(_median_px(pred, Yte, WH))
    table = {n: {"meanMedianPx": round(float(np.mean(v)), 1), "folds": [round(x, 1) for x in v], "winsVsBaseline": int(sum(1 for a, b in zip(v, scores["baseline"]) if a < b))} for n, v in scores.items()}
    order = sorted(table, key=lambda n: (table[n]["meanMedianPx"], 0 if n == "baseline" else 1 if n.startswith("ridge") else 2))
    best = order[0]
    log("group CV (train+val only): " + ", ".join(f"{n} {table[n]['meanMedianPx']}" for n in order))
    return {"k": k, "groups": len(groups), "table": table, "selected": best}


def holdout_once(records: list[Record], name: str, manifest: dict | None = None) -> dict:
    """Fit the selected config on train+val, evaluate once on locked_test and temporal_test (access logged)."""
    kind, feats, kw = CONFIGS[name]
    pool = [r for r in records if r.split_role in ("train", "val")]
    out = {}
    for split in ("locked_test", "temporal_test"):
        te = [r for r in records if r.split_role == split]
        if not te:
            continue
        if manifest is not None:
            from datetime import datetime, timezone  # noqa: PLC0415
            manifest.setdefault("access_log", []).append({"at": datetime.now(timezone.utc).isoformat(), "split": split, "by": f"cv-selected:{name}", "records": len(te)})
        _, Yte, _, WH = _xyw(te, FEATURES)
        pred, _ = fit_predict(kind, feats or FEATURES, kw or {}, pool, te)
        base = np.zeros_like(pred)
        out[split] = {"model": round(_median_px(pred, Yte, WH), 1), "baseline": round(_median_px(base, Yte, WH), 1), "n": len(te)}
    return out
