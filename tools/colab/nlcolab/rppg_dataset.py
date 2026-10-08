"""rPPG candidate-quality dataset: per (session, fixed 10 s epoch, candidate) rows with observable features and reference-error labels.

· Reference pairing follows condition-dataset.js compare(): fixed disjoint 10 s epochs from the first recorded frame, reference coverage ≥ 0.8
  (quality==1, gaps ≤ 2.5 s not bridged), reference aligned with session_ms = reference_ms·(1+drift_ppm/1e6)+offset_ms.
· Labels exist only when the reference is 'paired' (verified sync, uncertainty ≤ 100 ms); 'exploratory' references produce rows tagged
  label_grade='exploratory' that are excluded from training/promotion and shown separately.
· Candidates come from payload.pulseEvidence.windows[].alternatives (roi/method/bpm/snr/period/weight/pixelQ/recovered) — every candidate the
  engine actually produced, accepted or rejected. Non-existent candidates get no row (never a low error).
· Causality: windows accepted via temporal continuity ('tracked'/'accumulated-weak-evidence') used neighbouring windows; those rows are tagged
  causal=False and excluded from the real-time model. Features never include the reference HR or the error.
· Epochs with a valid reference but no candidate stay in the denominator (coverage) as `missing_output` rows."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .adapter import Session

EPOCH_MS = 10000
TOL_BPM = 5.0
SYNC_MAX_MS = 100.0
ROIS = ("forehead", "cheek-1", "cheek-2", "aggregate", "combined")
METHODS = ("pos", "chrom", "green")


def align(samples: list[dict], sync: dict | None) -> list[dict]:
    off = (sync or {}).get("offsetMs", 0) or 0
    drift = (sync or {}).get("driftPpm", 0) or 0
    return [{**s, "t": s["t"] * (1 + drift / 1e6) + off} for s in samples]


def interval_reference(samples: list[dict], start: float, end: float) -> tuple[float | None, float]:
    area = ms = 0.0
    for i in range(1, len(samples)):
        a, b = samples[i - 1], samples[i]
        dt = b["t"] - a["t"]
        if a.get("quality") != 1 or b.get("quality") != 1 or dt <= 0 or dt > 2500:
            continue
        lo, hi = max(start, a["t"]), min(end, b["t"])
        if hi <= lo:
            continue
        val = lambda t: a["bpm"] + (b["bpm"] - a["bpm"]) * (t - a["t"]) / dt
        area += (val(lo) + val(hi)) / 2 * (hi - lo)
        ms += hi - lo
    return (area / ms if ms else None), (ms / (end - start) if end > start else 0.0)


@dataclass
class CandidateRow:
    row_id: str
    session_id: str
    epoch_id: str
    epoch_start: float
    window_id: str
    roi: str
    method: str
    features: dict
    bpm: float
    ref_bpm: float | None
    abs_error: float | None
    within_tol: bool | None
    label_grade: str
    causal: bool
    engine_selected: bool
    window_usable: bool
    synthetic: bool
    tags: dict = field(default_factory=dict)


def frame_stats(session: Session, start: float, end: float) -> dict:
    fr = [f for f in session.frames if start <= f["tc"] <= end]
    if len(fr) < 2:
        return {"fps": float("nan"), "intervalP95": float("nan"), "lum": float("nan"), "lumJumps": 0, "headMotion": float("nan"), "skinQ": float("nan")}
    dts = [b["tc"] - a["tc"] for a, b in zip(fr, fr[1:]) if b["tc"] > a["tc"]]
    lum = [f["lum"] for f in fr if math.isfinite(f.get("lum", float("nan")))]
    jumps = sum(1 for a, b in zip(lum, lum[1:]) if abs(b - a) > 12)
    pose = [f for f in fr if all(math.isfinite(f.get(k, float("nan"))) for k in ("cx", "cy", "fw")) and f["fw"] > 0]
    motion = [math.hypot(b["cx"] - a["cx"], b["cy"] - a["cy"]) / b["fw"] * 100 for a, b in zip(pose, pose[1:])]
    skin = [f["skinQ"] for f in fr if math.isfinite(f.get("skinQ", float("nan")))]
    return {"fps": (len(fr) - 1) * 1000 / max(1e-9, fr[-1]["tc"] - fr[0]["tc"]), "intervalP95": sorted(dts)[int(0.95 * (len(dts) - 1))] if dts else float("nan"), "lum": sum(lum) / len(lum) if lum else float("nan"), "lumJumps": jumps,
            "headMotion": (sorted(motion)[int(0.95 * (len(motion) - 1))] if motion else float("nan")), "skinQ": sum(skin) / len(skin) if skin else float("nan")}


def build_rows(session: Session) -> tuple[list[CandidateRow], dict]:
    report = {"session": session.session_id, "epochs": 0, "epochsWithReference": 0, "epochsMissingOutput": 0, "rows": 0, "labelGrade": None, "reason": None}
    wins = session.pulse_windows or []
    if not wins:
        report["reason"] = "no-pulse-evidence"
        return [], report
    ref = session.reference
    grade = None
    samples = []
    if ref and ref.get("samples"):
        unc = (ref.get("sync") or {}).get("uncertaintyMs")
        grade = "paired" if ref.get("verified") and isinstance(unc, (int, float)) and 0 <= unc <= SYNC_MAX_MS else "exploratory"
        samples = align(ref["samples"], ref.get("sync"))
        samples.sort(key=lambda s: s["t"])
    report["labelGrade"] = grade
    if not session.frames:
        report["reason"] = "no-frames"
        return [], report
    start0, end0 = session.frames[0]["tc"], session.frames[-1]["tc"]
    rows: list[CandidateRow] = []
    t = start0
    while t + EPOCH_MS <= end0 + 1:
        epoch_id = f"{session.session_id}:e{int(round(t))}"
        report["epochs"] += 1
        ref_bpm, cov = (interval_reference(samples, t, t + EPOCH_MS) if samples else (None, 0.0))
        has_ref = ref_bpm is not None and cov >= 0.8
        if has_ref:
            report["epochsWithReference"] += 1
        inside = [w for w in wins if isinstance(w.get("start"), (int, float)) and w["start"] >= t - 0.01 and w.get("end", w["start"]) <= t + EPOCH_MS + 0.01]
        if not inside:
            if has_ref:
                report["epochsMissingOutput"] += 1
                rows.append(CandidateRow(f"{epoch_id}:missing", session.session_id or "", epoch_id, t, "", "none", "none", {}, float("nan"), ref_bpm, None, None, grade or "none", True, False, False, session.synthetic, {"missing_output": True}))
            t += EPOCH_MS
            continue
        fs = frame_stats(session, t, t + EPOCH_MS)
        for w in inside:
            causal = (w.get("status") not in ("tracked",)) and w.get("reason") not in ("temporal-continuity", "accumulated-weak-evidence")
            sel_bpm = w.get("bpm")
            alts = w.get("alternatives") or []
            if not alts:
                alts = [{"roi": (w.get("regions") or ["aggregate"])[0], "method": (w.get("methods") or ["pos"])[0], "bpm": w.get("bpm"), "snr": w.get("snr"), "period": w.get("period"), "weight": w.get("confidence"), "pixelQ": None, "recovered": w.get("recovered")}]
            for k, a in enumerate(alts):
                if not isinstance(a.get("bpm"), (int, float)) or not math.isfinite(a["bpm"]):
                    continue
                others = [b["bpm"] for b in alts if b is not a and isinstance(b.get("bpm"), (int, float))]
                feats = {"snr": a.get("snr"), "period": a.get("period"), "weight": a.get("weight"), "pixelQ": a.get("pixelQ"), "recovered": a.get("recovered"), "guided": 1.0 if a.get("guided") else 0.0,
                         "windowSec": w.get("windowSec"), "fs": w.get("fs"), "winSnr": w.get("snr"), "winPeriod": w.get("period"), "agreement": w.get("agreement"), "spatialCoherence": w.get("spatialCoherence"), "nRegions": w.get("n"), "spread": w.get("spread"),
                         "disagreement": (sum(abs(a["bpm"] - o) for o in others) / len(others)) if others else 0.0, "nCandidates": len(alts), "candidateBpm": a["bpm"], "bpmMinusWindow": (a["bpm"] - sel_bpm) if isinstance(sel_bpm, (int, float)) else float("nan"),
                         **{f"roi_{r}": 1.0 if a.get("roi") == r else 0.0 for r in ROIS}, **{f"method_{m}": 1.0 if a.get("method") == m else 0.0 for m in METHODS}, **fs}
                err = abs(a["bpm"] - ref_bpm) if has_ref else None
                rows.append(CandidateRow(f"{epoch_id}:{w.get('start')}:{k}", session.session_id or "", epoch_id, t, f"{session.session_id}:w{w.get('start')}", a.get("roi") or "?", a.get("method") or "?", feats, a["bpm"], ref_bpm if has_ref else None, err, (err <= TOL_BPM) if err is not None else None,
                                         grade if has_ref else "none", causal, bool(isinstance(sel_bpm, (int, float)) and abs(a["bpm"] - sel_bpm) <= 1.5 and w.get("usable")), bool(w.get("usable")), session.synthetic, {"status": w.get("status"), "reason": w.get("reason")}))
        t += EPOCH_MS
    report["rows"] = len(rows)
    return rows, report


def paired_rows(rows: list[CandidateRow], causal_only: bool = True) -> list[CandidateRow]:
    return [r for r in rows if r.label_grade == "paired" and r.abs_error is not None and (r.causal or not causal_only)]


def exploratory_rows(rows: list[CandidateRow]) -> list[CandidateRow]:
    return [r for r in rows if r.label_grade == "exploratory" and r.abs_error is not None]
