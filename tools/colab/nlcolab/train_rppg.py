"""rPPG candidate error model: predicts expected |HR_k − HR_ref| per candidate; selection = lowest expected error among valid candidates,
abstain when all exceed the threshold. Compared against the engine's own selection and an oracle (research upper bound only).

Insufficient paired reference labels → status 'insufficient_reference_labels' and no model (collection/alignment/QC paths remain).
HR-only references never yield IBI/HRV labels (no 60000/HR beat times)."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from .rppg_dataset import CandidateRow, TOL_BPM, paired_rows

MIN_SESSIONS = 6
MIN_EPOCHS = 60
FEATURE_ORDER = ["snr", "period", "weight", "pixelQ", "recovered", "guided", "windowSec", "fs", "winSnr", "winPeriod", "agreement", "spatialCoherence", "nRegions", "spread", "disagreement", "nCandidates", "candidateBpm", "bpmMinusWindow",
                 "roi_forehead", "roi_cheek-1", "roi_cheek-2", "roi_aggregate", "roi_combined", "method_pos", "method_chrom", "method_green", "fps", "intervalP95", "lum", "lumJumps", "headMotion", "skinQ"]
FORBIDDEN = {"ref_bpm", "abs_error", "within_tol", "referenceBpm", "error"}


def matrix(rows: list[CandidateRow]) -> tuple[np.ndarray, np.ndarray]:
    for r in rows[:1]:
        bad = FORBIDDEN & set(r.features)
        if bad:
            raise ValueError(f"forbidden features {bad}")
    X = np.array([[float(r.features.get(k)) if isinstance(r.features.get(k), (int, float)) and math.isfinite(float(r.features.get(k))) else float("nan") for k in FEATURE_ORDER] for r in rows], dtype=np.float64) if rows else np.zeros((0, len(FEATURE_ORDER)))
    y = np.array([r.abs_error for r in rows], dtype=np.float64) if rows else np.zeros(0)
    return X, y


@dataclass
class Standardizer:
    mean: list[float]
    std: list[float]

    def transform(self, X):
        Z = (X - np.asarray(self.mean)) / np.asarray(self.std)
        miss = ~np.isfinite(Z)
        Z = np.where(miss, 0.0, np.clip(Z, -6, 6))
        return np.concatenate([Z, miss.astype(np.float64)], axis=1)


def fit_standardizer(X):
    m, s = np.nanmean(X, axis=0), np.nanstd(X, axis=0)
    return Standardizer([float(v) if math.isfinite(v) else 0.0 for v in m], [float(v) if math.isfinite(v) and v > 1e-6 else 1.0 for v in s])


class RidgeError:
    name = "ridge-error"

    def __init__(self, lam=1.0):
        self.lam, self.W = lam, None

    def fit(self, Z, y):
        A = np.concatenate([np.ones((len(Z), 1)), Z], 1)
        reg = self.lam * np.eye(A.shape[1])
        reg[0, 0] = 0
        self.W = np.linalg.solve(A.T @ A + reg, A.T @ np.log1p(y))
        return self

    def predict(self, Z):
        A = np.concatenate([np.ones((len(Z), 1)), Z], 1)
        return np.expm1(A @ self.W).clip(0, None)


def group_split(rows: list[CandidateRow], seed=3, val_frac=0.25, test_frac=0.25):
    sessions = sorted({r.session_id for r in rows})
    rnd = np.random.default_rng(seed)
    rnd.shuffle(sessions)
    n = len(sessions)
    test, val = set(sessions[:int(round(n * test_frac))]), set(sessions[int(round(n * test_frac)):int(round(n * (test_frac + val_frac)))])
    split = {}
    for r in rows:
        split[r.row_id] = "test" if r.session_id in test else "val" if r.session_id in val else "train"
    return split


def select_per_epoch(rows: list[CandidateRow], expected: dict[str, float], threshold: float = TOL_BPM * 2) -> list[dict]:
    """Per epoch: choose the candidate with the lowest expected error; abstain when the minimum exceeds the threshold."""
    by_epoch = defaultdict(list)
    for r in rows:
        by_epoch[r.epoch_id].append(r)
    out = []
    for ep, rs in by_epoch.items():
        cands = [r for r in rs if not r.tags.get("missing_output")]
        ref = next((r.ref_bpm for r in rs if r.ref_bpm is not None), None)
        if not cands:
            out.append({"epoch": ep, "abstain": True, "reason": "no-candidate", "ref": ref, "engine": None, "oracle": None, "model": None})
            continue
        best = min(cands, key=lambda r: expected[r.row_id])
        eng = next((r for r in cands if r.engine_selected), None)
        oracle = min(cands, key=lambda r: r.abs_error if r.abs_error is not None else math.inf)
        out.append({"epoch": ep, "abstain": expected[best.row_id] > threshold, "reason": None, "ref": ref, "model": {"bpm": best.bpm, "err": best.abs_error, "expected": expected[best.row_id], "roi": best.roi, "method": best.method},
                    "engine": {"bpm": eng.bpm, "err": eng.abs_error} if eng else None, "oracle": {"err": oracle.abs_error} if oracle.abs_error is not None else None})
    return out


def summarize(sel: list[dict]) -> dict:
    def stats(errs):
        e = np.array([x for x in errs if x is not None and math.isfinite(x)])
        if not len(e):
            return {"n": 0}
        return {"n": int(len(e)), "mae": float(e.mean()), "rmse": float(math.sqrt((e ** 2).mean())), "p95": float(np.percentile(e, 95)), "within5": float((e <= TOL_BPM).mean())}
    with_ref = [s for s in sel if s["ref"] is not None]
    answered = [s for s in with_ref if not s["abstain"] and s["model"]]
    engine = [s for s in with_ref if s["engine"]]
    rc = []
    for thr in (2.5, 5, 7.5, 10, 15):
        use = [s for s in with_ref if s["model"] and s["model"]["expected"] <= thr]
        rc.append({"expectedErrorMax": thr, "coverage": len(use) / max(1, len(with_ref)), **stats([s["model"]["err"] for s in use])})
    return {"referenceEpochs": len(with_ref), "modelCoverage": len(answered) / max(1, len(with_ref)), "model": stats([s["model"]["err"] for s in answered]), "engineCoverage": len(engine) / max(1, len(with_ref)), "engine": stats([s["engine"]["err"] for s in engine]),
            "oracle": {**stats([s["oracle"]["err"] for s in with_ref if s["oracle"]]), "note": "research upper bound; not an operable model"}, "riskCoverage": rc, "abstained": sum(1 for s in with_ref if s["abstain"])}


def train_selector(rows: list[CandidateRow], log=print) -> dict:
    pr = paired_rows(rows)
    sessions = {r.session_id for r in pr}
    epochs = {r.epoch_id for r in pr}
    base = {"schema": "nl-rppg-selector-run-1", "pairedRows": len(pr), "pairedSessions": len(sessions), "pairedEpochs": len(epochs), "exploratoryRows": sum(1 for r in rows if r.label_grade == "exploratory" and r.abs_error is not None), "minSessions": MIN_SESSIONS, "minEpochs": MIN_EPOCHS,
            "hrvNote": "HR-only reference: IBI/HRV labels are not derived; beat-dependent metrics stay unverified"}
    if len(sessions) < MIN_SESSIONS or len(epochs) < MIN_EPOCHS:
        log(f"rPPG selector: insufficient paired reference labels ({len(sessions)} sessions, {len(epochs)} epochs)")
        return {**base, "status": "insufficient_reference_labels", "model": None}
    split = group_split(pr)
    tr = [r for r in pr if split[r.row_id] == "train"]
    va = [r for r in pr if split[r.row_id] == "val"]
    te = [r for r in pr if split[r.row_id] == "test"]
    Xtr, ytr = matrix(tr)
    st = fit_standardizer(Xtr)
    best = None
    for lam in (0.3, 1.0, 3.0, 10.0):
        m = RidgeError(lam).fit(st.transform(Xtr), ytr)
        Xv, yv = matrix(va)
        pv = m.predict(st.transform(Xv))
        mae = float(np.abs(pv - yv).mean()) if len(yv) else math.inf
        if best is None or mae < best[1]:
            best = (m, mae, lam)
    m, val_mae, lam = best
    def run(rows_):
        X, _ = matrix(rows_)
        exp = dict(zip([r.row_id for r in rows_], m.predict(st.transform(X)))) if rows_ else {}
        return summarize(select_per_epoch(rows_, exp))
    out = {**base, "status": "evaluated", "model": {"kind": "ridge-error(log1p)", "lambda": lam, "features": FEATURE_ORDER, "standardizer": {"mean": st.mean, "std": st.std}, "coefficients": m.W.tolist()}, "val": {"expectedErrorMae": val_mae, **run(va)}, "test": run(te), "split": {"train": len(tr), "val": len(va), "test": len(te)}}
    log(f"rPPG selector: val coverage {out['val']['modelCoverage']:.2f} MAE {out['val']['model'].get('mae', float('nan')):.2f} vs engine MAE {out['val']['engine'].get('mae', float('nan')):.2f}")
    return out
