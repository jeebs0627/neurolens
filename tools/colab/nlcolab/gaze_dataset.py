"""Gaze residual training records: one row per (session, target window, frame) with allowlisted features, baseline and residual target.

Rules
· Inputs come only from FEATURE_ALLOWLIST (checked). Target/click/label/future information lives in `label`/`qc` blocks, never in `features`.
· Baseline g_base per frame comes from the Node engine reproduction (replaySelection preferred: fine points untouched by that fit).
· Windows: v3 gaze labels (explicit_target_confirmed, role train/internal/holdout) and calibration targets (calibration_target, role
  train / internal / holdout-then-refit). Legacy windows are back-filled with flags and excluded from strict evaluation.
· Final gaze-label holdout (role 'holdout') is eval_only: excluded from supervised training export and personal fitting.
· Frames of one window are not independent: each window gets total weight 1 (1/n per frame) and at most MAX_FRAMES per window."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from . import schema as SCH
from .adapter import Session, hidden_overlaps
from .baseline import index_predictions

MAX_FRAMES = 12
MIN_FRAMES = 4
FEATURES = ["baseX", "baseY", "u", "v", "uLeft", "vLeft", "uRight", "vRight", "qLeft", "qRight", "open", "yaw", "pitch", "cx", "cy", "fw", "blink", "eyeQ", "lag", "eyeMode"]
assert all(k in SCH.FEATURE_ALLOWLIST for k in FEATURES)


def region_of(nx: float, ny: float) -> str:
    cx, cy = abs(nx - 0.5), abs(ny - 0.5)
    if cx < 0.17 and cy < 0.17:
        return "center"
    if cx > 0.33 and cy > 0.33:
        return "corner"
    return "periphery"


@dataclass
class Record:
    record_id: str
    session_id: str
    window_id: str
    subject_key: str | None
    subject_link_confidence: str
    created_at: str | None
    label_source: str
    label_role: str
    split_role: str
    features: dict
    base: dict
    target: dict
    residual: dict
    weight: float
    qc: dict
    versions: dict
    synthetic: bool
    tc: float
    tags: dict = field(default_factory=dict)


def _nan(v):
    return v if isinstance(v, (int, float)) and math.isfinite(v) else float("nan")


def features_from(pred: dict, W: float, H: float, contract: str) -> dict:
    bx, by = (pred["ax"], pred["ay"]) if contract == "replace-residual" else (pred["bx"], pred["by"])
    f = {"baseX": bx / W, "baseY": by / H, "u": _nan(pred.get("u")), "v": _nan(pred.get("v")), "uLeft": _nan(pred.get("uLeft")), "vLeft": _nan(pred.get("vLeft")), "uRight": _nan(pred.get("uRight")), "vRight": _nan(pred.get("vRight")),
         "qLeft": _nan(pred.get("qLeft")), "qRight": _nan(pred.get("qRight")), "open": _nan(pred.get("open")), "yaw": _nan(pred.get("yaw")), "pitch": _nan(pred.get("pitch")), "cx": _nan(pred.get("cx")), "cy": _nan(pred.get("cy")), "fw": _nan(pred.get("fw")),
         "blink": _nan(pred.get("blink")), "eyeQ": _nan(pred.get("eyeQ")), "lag": _nan(pred.get("lag")), "eyeMode": float(SCH.EYE_MODE.get(pred.get("mode") or "both", 0))}
    bad = [k for k in f if k not in SCH.FEATURE_ALLOWLIST or k in SCH.FEATURE_DENYLIST]
    if bad:
        raise ValueError("denied feature keys: " + ",".join(bad))
    return f


def _window_records(session: Session, table: dict, fit_name: str, contract: str, *, window_id: str, label_source: str, role: str, split_role: str, tx: float, ty: float, start: float, end: float, qc: dict, max_frames: int = MAX_FRAMES) -> list[Record]:
    W, H = session.W, session.H
    keys = sorted(k for k in table if start <= k <= end)
    rows = [table[k] for k in keys]
    if len(rows) > max_frames:
        step = len(rows) / max_frames
        rows = [rows[int(i * step)] for i in range(max_frames)]
    if len(rows) < MIN_FRAMES:
        return []
    out = []
    w = 1.0 / len(rows)
    nx, ny = tx / W, ty / H
    for r in rows:
        feats = features_from(r, W, H, contract)
        bx, by = (r["ax"], r["ay"]) if contract == "replace-residual" else (r["bx"], r["by"])
        # the browser subtracts the running drift after the model: g = base + delta - drift → target residual = target - (base - drift)
        bx, by = bx - (r.get("driftDx") or 0.0), by - (r.get("driftDy") or 0.0)
        out.append(Record(record_id=f"{session.session_id}:{window_id}:{round(r['tc'])}", session_id=session.session_id or "", window_id=f"{session.session_id}:{window_id}", subject_key=session.subject_key, subject_link_confidence=session.subject_link_confidence, created_at=session.created_at,
                          label_source=label_source, label_role=role, split_role=split_role, features=feats, base={"px": r["px"], "py": r["py"], "ax": r["ax"], "ay": r["ay"], "bx": r["bx"], "by": r["by"], "mode": r.get("mode"), "driftDx": r.get("driftDx", 0), "driftDy": r.get("driftDy", 0), "fit": fit_name},
                          target={"x": tx, "y": ty, "nx": nx, "ny": ny, "region": region_of(nx, ny), "W": W, "H": H}, residual={"dx": tx - bx, "dy": ty - by, "dxFrac": (tx - bx) / W, "dyFrac": (ty - by) / H, "contract": contract}, weight=w,
                          qc={**qc, "framesInWindow": len(rows), "block": r.get("_block")}, versions={"core": (session.meta.get("versions") or {}).get("core"), "camera": (session.meta.get("capture") or {}).get("version"), "schema": session.schema, "feature": r.get("featureSource", "recorded")}, synthetic=session.synthetic, tc=r["tc"]))
    return out


def build_records(session: Session, baseline: dict | None, contract: str = "add-residual", include_legacy_backfill: bool = True) -> tuple[list[Record], dict]:
    """Returns (records, report). Records cover calibration targets and v3 labels; holdout labels are eval_only."""
    report = {"session": session.session_id, "fit": None, "fidelity": (baseline or {}).get("fidelity", "unavailable"), "windows": 0, "records": 0, "skipped": defaultdict(int)}
    if not baseline or session.W is None or session.H is None:
        report["skipped"]["no-baseline-or-screen"] += 1
        return [], report
    table, fit_name = index_predictions(baseline)
    if not table:
        report["skipped"]["no-predictions"] += 1
        return [], report
    report["fit"] = fit_name
    recs: list[Record] = []
    # --- calibration targets (last round only: earlier rounds were discarded by the user)
    last_round = max((t.round for t in session.targets), default=None)
    for t in session.targets:
        if t.round != last_round:
            report["skipped"]["earlier-round"] += 1
            continue
        if t.role == "weak":
            report["skipped"]["weak-click-target"] += 1
            continue
        if t.inferred_backfill and not include_legacy_backfill:
            report["skipped"]["legacy-backfill-excluded"] += 1
            continue
        start = t.sample_start if t.sample_start is not None else (t.onset or 0) + 500
        end = t.sample_end if t.sample_end is not None else (t.onset or 0) + 2500
        if hidden_overlaps(session, start, end):
            report["skipped"]["hidden-overlap"] += 1
            continue
        role = {"train": "train", "internal": "internal", "holdout-then-refit": "fine"}.get(t.role, t.role)
        # fine points are honest only under the selection fit; under the final fit they were refit in → flag
        qc = {"inferredBackfill": t.inferred_backfill, "uncertaintyMs": t.uncertainty_ms, "backfillMethod": t.backfill_method, "fineRefitInFit": role == "fine" and fit_name in ("snapshot", "replayFinal"), "round": t.round, "kind": t.kind}
        rs = _window_records(session, table, fit_name, contract, window_id=f"cal:{t.id}", label_source="calibration_target", role=role, split_role="supervised", tx=t.x, ty=t.y, start=start, end=end, qc=qc)
        if rs:
            report["windows"] += 1
            recs.extend(rs)
        else:
            report["skipped"]["too-few-frames"] += 1
    # --- instructed centre-dot fixations during the test (drift checks): proxy labels spread over the whole session.
    # Only 'instructed-center-fixation' events are used: they are recorded whether or not the engine accepted them, so they are not
    # selected on engine error (implicit fixations before 2026-10-08 were logged only when accepted → biased, excluded).
    for e in ((session.telemetry or {}).get("drift") or []):
        if e.get("source") != "instructed-center-fixation" or not isinstance(e.get("t"), (int, float)) or not isinstance(e.get("measuredDx"), (int, float)):
            continue
        t_end = e["t"]
        start = t_end - (e.get("windowMs") or 1200)
        if hidden_overlaps(session, start, t_end):
            report["skipped"]["instructed-hidden-overlap"] += 1
            continue
        tx = e.get("tx") if isinstance(e.get("tx"), (int, float)) else session.W / 2
        ty = e.get("ty") if isinstance(e.get("ty"), (int, float)) else session.H / 2
        qc = {"inferredBackfill": False, "uncertaintyMs": 0, "engineAccepted": bool(e.get("applied")), "measuredDx": e["measuredDx"], "measuredDy": e.get("measuredDy"), "step": e.get("key"), "minutesFromStart": round(t_end / 60000, 2)}
        rs = _window_records(session, table, fit_name, contract, window_id=f"fix:{round(t_end)}", label_source="instructed_fixation", role="train", split_role="supervised", tx=tx, ty=ty, start=start, end=t_end, qc=qc)
        if rs:
            report["windows"] += 1
            recs.extend(rs)
        else:
            report["skipped"]["instructed-too-few-frames"] += 1

    # --- v3 gaze labels
    if session.labels:
        unchanged = (session.labels.get("holdout") or {}).get("pipelineUnchanged")
        for l in session.labels.get("labels") or []:
            if l.get("status") != "valid":
                report["skipped"]["label-" + str(l.get("status"))] += 1
                continue
            ft = l.get("frameTimes") or []
            if len(ft) < MIN_FRAMES:
                report["skipped"]["label-too-few-frames"] += 1
                continue
            role = l.get("role")
            split_role = "eval_only" if role == "holdout" else "supervised"
            if role == "holdout" and unchanged is False:
                report["skipped"]["holdout-pipeline-changed"] += 1
                continue
            lo, hi = min(ft) - 0.6, max(ft) + 0.6
            qc = {"inferredBackfill": False, "uncertaintyMs": 0, "dwellConfidence": l.get("dwellConfidence"), "attempt": l.get("attempt"), "confirmType": (l.get("confirm") or {}).get("type"), "holdoutPipelineUnchanged": unchanged if role == "holdout" else None}
            rs = _window_records(session, table, fit_name, contract, window_id=f"label:{l['targetId']}:{l.get('attempt', 1)}", label_source="explicit_target_confirmed", role=role, split_role=split_role, tx=l["x"], ty=l["y"], start=lo, end=hi, qc=qc)
            if rs:
                report["windows"] += 1
                recs.extend(rs)
            else:
                report["skipped"]["label-frames-not-in-baseline"] += 1
    report["records"] = len(recs)
    report["skipped"] = dict(report["skipped"])
    return recs, report


def check_no_leak(records: list[Record]) -> None:
    """Training export must never contain eval_only rows and feature keys must be allowlisted."""
    for r in records:
        bad = [k for k in r.features if k not in SCH.FEATURE_ALLOWLIST or k in SCH.FEATURE_DENYLIST]
        if bad:
            raise ValueError(f"{r.record_id}: denied features {bad}")


def supervised(records: list[Record]) -> list[Record]:
    return [r for r in records if r.split_role == "supervised"]


def eval_only(records: list[Record]) -> list[Record]:
    return [r for r in records if r.split_role == "eval_only"]
