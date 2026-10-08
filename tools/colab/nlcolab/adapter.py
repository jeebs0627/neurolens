"""Decode research session JSON (nl-research-1/2/3) into a canonical view.

Canonical session clock: payload.t0-relative milliseconds. `payload.frames` and `payload.telemetry.calibrationFrames` each carry their own
`t0` (absolute performance.now origin) and are converted; landmarks/targets/pursuit/labels/reference are already payload.t0-relative.
Historical gaps are filled only with explicit, version-specific legacy fallbacks and flagged — never presented as recorded values.
The original JSON is never modified; this module produces a derived view (schema CANONICAL_SCHEMA)."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

from . import schema as SCH

NAN = float("nan")


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def core_version(meta: dict) -> float | None:
    m = re.search(r"core\s+(\d+(?:\.\d+)?)", str((meta or {}).get("versions", {}).get("core") or ""))
    return float(m.group(1)) if m else None


# ---------------------------------------------------------------- frames
def decode_frames(F: dict | None, payload_t0: float | None) -> list[dict]:
    """Column-major packed frames → list of dicts with absolute `t` and canonical `tc`. Missing values → NaN, flags → bool."""
    if not F or not isinstance(F.get("t"), list):
        return []
    scale = F.get("scale") or SCH.FRAME_SCALE_V1
    origin = F.get("t0") if _finite(F.get("t0")) else 0.0
    base = payload_t0 if _finite(payload_t0) else origin
    n = len(F["t"])
    cols = {k: F[k] for k, s in scale.items() if k in F and k not in ("rr", "rq") and isinstance(F[k], list)}
    out = []
    for i in range(n):
        t = origin + F["t"][i]
        f: dict[str, Any] = {"i": i, "t": t, "tc": t - base}
        for k, arr in cols.items():
            v = arr[i] if i < len(arr) else None
            f[k] = NAN if v is None else v / scale[k]
        for k in ("faceOk", "eyeOk", "skinOk", "ppgOk", "gazeOk", "ok"):
            if k in f:
                f[k] = bool(f[k]) if _finite(f[k]) else False
        rr = F.get("rr", [None] * n)[i] if "rr" in F else None
        f["rr"] = [NAN if v is None else v / 100 for v in (rr or [None] * 9)]
        rq = F.get("rq", [None] * n)[i] if "rq" in F else None
        f["rq"] = [NAN if v is None else v / 1e3 for v in (rq or [None] * 3)]
        for k in ("clockSource", "source", "reason"):
            f[k] = (F.get(k) or [None] * n)[i] if k in F else None
        out.append(f)
    return out


def decode_samples(rows: list, columns: list[str]) -> list[dict]:
    """Gaze samples [t,x,y,rx,ry,blink,quality_x1000,eyeMode,inferenceLagMs,(px,py,sx,sy,bx,by)] → dicts (t is payload.t0-relative)."""
    out = []
    for r in rows or []:
        d = {}
        for j, c in enumerate(columns):
            v = r[j] if j < len(r) else None
            if c == "quality_x1000":
                d["q"] = NAN if v is None else v / 1e3
            elif c == "blink":
                d["bl"] = bool(v)
            elif c == "eyeMode":
                d["mode"] = v
            elif c == "inferenceLagMs":
                d["lag"] = NAN if v is None else v
            else:
                d[c] = NAN if v is None else v
        out.append(d)
    return out


# ---------------------------------------------------------------- targets / pursuit
@dataclass
class Target:
    id: str
    round: int
    kind: str
    role: str
    x: float
    y: float
    onset: float | None
    offset: float | None
    sample_start: float | None
    sample_end: float | None
    inferred_backfill: bool
    uncertainty_ms: float
    backfill_method: str | None = None
    samples: int | None = None
    kept: int | None = None


def _targets(cal: dict | None, flags: list[str]) -> tuple[list[Target], list[dict]]:
    if not cal:
        return [], []
    if isinstance(cal.get("targetsV2"), list) and cal["targetsV2"]:
        T = [Target(t.get("id"), t.get("round") or 1, t.get("kind"), t.get("role"), t.get("x"), t.get("y"), t.get("onset"), t.get("offset"), t.get("sampleStart"), t.get("sampleEnd"), False, 0.0, None, t.get("samples"), t.get("kept")) for t in cal["targetsV2"]]
        return T, list(cal.get("rounds") or [])
    raw = cal.get("targets") or []
    if not raw:
        return [], []
    flags.append("targets-v1-inferred-windows")
    rounds, rnd, prev, val_count = [], 0, None, {}
    rows = [{"i": i, "t": x[0], "x": x[1], "y": x[2], "kind": x[3]} for i, x in enumerate(raw)]
    for r in rows:
        if r["kind"] == "fix9" and prev != "fix9":
            rnd += 1
            val_count[rnd] = 0
            rounds.append({"round": rnd, "start": r["t"], "end": None, "inferred": True})
        r["round"] = max(1, rnd)
        prev = r["kind"]
        if rounds:
            rounds[-1]["end"] = r["t"] + 3000
    T = []
    for i, r in enumerate(rows):
        nxt = rows[i + 1]["t"] if i + 1 < len(rows) else r["t"] + 3000
        kind = r["kind"]
        if kind == "fix9":
            role, frm, to, method = "train", SCH.LEGACY_CAL9["from_ms"], SCH.LEGACY_CAL9["to_ms"], "cal9:+650..+2900|next"
        elif kind == "zone":
            role, frm, to, method = "internal", SCH.LEGACY_COLLECT["from_ms"], SCH.LEGACY_COLLECT["to_ms"], "calCollect:+500..+2500|next"
        else:
            val_count[r["round"]] = val_count.get(r["round"], 0) + 1
            if val_count[r["round"]] <= 4:
                role = "internal"
            else:
                role, kind = "holdout-then-refit", "fine"
            frm, to, method = SCH.LEGACY_COLLECT["from_ms"], SCH.LEGACY_COLLECT["to_ms"], "calCollect:+500..+2500|next"
        T.append(Target(f"C{i + 1:02d}", r["round"], kind, role, r["x"], r["y"], r["t"], min(nxt, r["t"] + to), r["t"] + frm, min(nxt, r["t"] + to), True, 300.0, method))
    return T, rounds


def _pursuit(cal: dict | None, core: float | None, flags: list[str]) -> dict | None:
    pu = (cal or {}).get("pursuit")
    if not pu:
        return None
    legacy = SCH.LEGACY_PURSUIT["2.3"] if (core is not None and core >= 2.3) else SCH.LEGACY_PURSUIT["default_pre_2.3"]
    path = str(pu.get("path") or "")
    m = re.search(r"sin\(2pi\*([0-9.]+)\*t\)\)", path)
    n = re.search(r"sin\(2pi\*([0-9.]+)\*t\+pi/2\)", path)
    if _finite(pu.get("fx")):
        fx, fy, src = pu["fx"], pu["fy"], "recorded"
    elif m and n:
        fx, fy, src = float(m.group(1)), float(n.group(1)), "parsed-from-path"
    else:
        fx, fy, src = legacy["fx"], legacy["fy"], ("unknown-core-assumed-legacy" if core is None else "legacy-table")
    sec = pu["sec"] if _finite(pu.get("sec")) else legacy["sec"]
    if src != "recorded":
        flags.append("pursuit-frequency-" + src)
    if not _finite(pu.get("lagMs")):
        flags.append("pursuit-lag-assumed")
    return {"t0": pu.get("t0"), "sec": sec, "W": pu.get("W"), "H": pu.get("H"), "fx": fx, "fy": fy, "ax": pu.get("ax", legacy["ax"]), "ay": pu.get("ay", legacy["ay"]), "phaseY": pu.get("phaseY", math.pi / 2),
            "lagMs": pu.get("lagMs", legacy["lag_ms"]), "sampleFrom": pu.get("sampleFrom", 1000), "sampleTo": pu.get("sampleTo", sec * 1000), "weight": pu.get("weight", 0.5), "round": pu.get("round"),
            "sources": {"frequency": src, "lag": "recorded" if _finite(pu.get("lagMs")) else "legacy-assumed-120ms", "amplitude": "recorded" if _finite(pu.get("ax")) else "legacy-constant"}}


# ---------------------------------------------------------------- reference
def effective_reference(payload: dict, annotations: list[dict]) -> dict | None:
    """Latest valid reference link: annotation CSV (kind=reference, body.reference.samples) wins over payload.reference (BLE). History kept."""
    notes = sorted([n for n in annotations or [] if n.get("kind") == "reference" and (n.get("body") or {}).get("reference", {}).get("samples")], key=lambda n: str(n.get("created_at")))
    if notes:
        last = notes[-1]
        ref = dict(last["body"]["reference"])
        ref.setdefault("source", "annotation-csv")
        ref["annotationId"] = last.get("id")
        ref["comparison"] = last["body"].get("comparison")
        ref["history"] = [{"id": n.get("id"), "at": n.get("created_at"), "status": (n["body"].get("comparison") or {}).get("status")} for n in notes]
        ref["origin"] = "annotation"
        return ref
    pr = payload.get("reference")
    if pr and pr.get("samples"):
        ref = dict(pr)
        ref.setdefault("source", "ble-heart-rate")
        ref["annotationId"] = None
        ref["history"] = []
        ref["origin"] = "payload"
        return ref
    return None


# ---------------------------------------------------------------- session
@dataclass
class Session:
    code: str | None
    session_id: str | None
    schema: str
    core: float | None
    meta: dict
    summary: dict
    annotations: list
    W: float | None
    H: float | None
    t0: float
    frames: list[dict]
    calibration_frames: list[dict]
    targets: list[Target]
    rounds: list[dict]
    pursuit: dict | None
    reference: dict | None
    labels: dict | None
    calibration: dict | None
    snapshot: dict | None
    digests: dict | None
    pulse_windows: list[dict]
    samples: dict
    hidden: list
    telemetry: dict | None
    flags: list[str] = field(default_factory=list)
    payload_sha256: str | None = None
    created_at: str | None = None
    synthetic: bool = False

    @property
    def session_kind(self) -> str:
        return self.meta.get("sessionKind") or ("gaze-label" if self.labels else "condition")

    @property
    def subject_key(self) -> str | None:
        return self.meta.get("subjectKey")

    @property
    def subject_link_confidence(self) -> str:
        if self.meta.get("subjectKey"):
            return "device-key" if str(self.meta.get("subjectKeySource", "")).startswith("browser-local") else str(self.meta.get("subjectKeySource") or "device-key")
        return "none"


def load_session(obj: dict) -> Session:
    full = obj if isinstance(obj, dict) and "payload" in obj else {"payload": obj, "meta": (obj or {}).get("meta") or {}}
    p = full.get("payload") or {}
    meta = full.get("meta") or {}
    if not _finite(p.get("t0")):
        raise ValueError("payload.t0 missing")
    flags: list[str] = []
    schema = p.get("schema") or "nl-research-1"
    if schema not in SCH.RESEARCH_SCHEMAS:
        flags.append("unknown-research-schema:" + str(schema))
    core = core_version(meta)
    frames = decode_frames(p.get("frames"), p["t0"])
    cf_raw = (p.get("telemetry") or {}).get("calibrationFrames")
    cal_frames = decode_frames(cf_raw, p["t0"]) if cf_raw and _finite(cf_raw.get("t0")) else []
    if not cf_raw:
        flags.append("no-calibration-frames")
    cal = p.get("calibration")
    W = (cal or {}).get("screen", {}).get("w") if cal else None
    H = (cal or {}).get("screen", {}).get("h") if cal else None
    if W is None:
        W, H = (meta.get("screen") or {}).get("vw"), (meta.get("screen") or {}).get("vh")
    targets, rounds = _targets(cal, flags)
    pursuit = _pursuit(cal, core, flags)
    if core is not None and core < 2.3:
        flags.append("vertical-feature-recomputed-from-landmarks" if (p.get("landmarks") or {}).get("rows") else "legacy-lid-v-no-landmarks")
    cols = p.get("sampleColumns") or ["t", "x", "y", "rx", "ry", "blink"]
    samples = {}
    pur = p.get("pursuit") or {}
    if pur.get("circle"):
        samples["circle"] = decode_samples(pur["circle"].get("s"), cols)
    for i, lv in enumerate(pur.get("levels") or []):
        samples[f"level{i}"] = decode_samples(lv.get("s"), cols)
    for i, tr in enumerate(p.get("freeview") or []):
        samples[f"freeview{i}"] = decode_samples(tr.get("s"), cols)
    for i, tr in enumerate(p.get("saccade") or []):
        samples[f"saccade{i}"] = decode_samples(tr.get("s"), cols)
    pulse = ((p.get("pulseEvidence") or {}).get("windows")) or []
    return Session(code=full.get("code") or meta.get("attemptId"), session_id=full.get("id") or meta.get("attemptId"), schema=schema, core=core, meta=meta, summary=full.get("summary") or {}, annotations=full.get("annotations") or [],
                   W=W, H=H, t0=p["t0"], frames=frames, calibration_frames=cal_frames, targets=targets, rounds=rounds, pursuit=pursuit, reference=effective_reference(p, full.get("annotations") or []),
                   labels=p.get("gazeLabels"), calibration=cal, snapshot=(cal or {}).get("snapshot"), digests=(cal or {}).get("digests"), pulse_windows=pulse, samples=samples, hidden=p.get("hidden") or [],
                   telemetry=p.get("telemetry"), flags=flags, payload_sha256=full.get("payload_sha256") or full.get("sha256"), created_at=full.get("created_at"), synthetic=bool(meta.get("synthetic")) or bool(full.get("synthetic")))


def hidden_overlaps(session: Session, a: float, b: float, pre: float = 500, post: float = 1500) -> bool:
    for h in session.hidden or []:
        hs, he = (h[0], h[1]) if isinstance(h, list) else (h.get("start"), h.get("end"))
        if hs is None:
            continue
        he = he if he is not None else float("inf")
        if a <= he + post and b >= hs - pre:
            return True
    return False
