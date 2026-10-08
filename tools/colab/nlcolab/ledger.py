"""Public training ledger (training-ledger.json, deployed): one entry per batch run with non-sensitive aggregates only.

Contains: run id, time, snapshot hash, policy/engine versions, data counts (sessions, eligible, label sessions, subjects, windows, records,
split sizes), per-model metrics on val/locked/temporal (median/p95 px, n), gate result, rPPG status, field telemetry of the browser model
(mode counts, latency, shadow agreement) and limitations. Never: session IDs, participant codes, subject keys, raw samples, tokens.
The dashboard (dataset-training.js) reads this file; 'improvement' is strictly the change of the same metric between runs."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .safe_io import dump_json, load_json

SCHEMA = "nl-training-ledger-1"
FORBIDDEN_KEYS = {"session_id", "sessionId", "code", "subject_key", "subjectKey", "record_id", "window_id", "samples", "frames", "token", "access_token", "email"}


def _m(e: dict | None) -> dict | None:
    if not e or not e.get("n"):
        return None
    return {"n": e["n"], "windows": e.get("windows"), "medianPx": round(e["medianPx"], 1), "p95Px": round(e["p95Px"], 1), "medianPctW": round(e.get("medianPctW", 0), 2), "biasXPx": round(e.get("biasXPx", 0), 1), "biasYPx": round(e.get("biasYPx", 0), 1),
            "byRegion": {k: round(v["medianPx"], 1) for k, v in (e.get("byRegion") or {}).items() if v.get("n")}}


def build_entry(work: Path, state: dict) -> dict:
    inv = load_json(work / "inventory.json") if (work / "inventory.json").exists() else {}
    gaze = load_json(work / "gaze" / "run.json") if (work / "gaze" / "run.json").exists() else None
    rppg = load_json(work / "rppg" / "run.json") if (work / "rppg" / "run.json").exists() else None
    diff = load_json(work / "snapshot-diff.json") if (work / "snapshot-diff.json").exists() else {}
    real = inv.get("real", {})
    entry = {"runId": state.get("runId"), "at": datetime.now(timezone.utc).isoformat(), "snapshot": (state.get("stages", {}).get("snapshot") or {}).get("hash"), "policyVersion": None, "engine": gaze.get("engine") if gaze else None, "status": (state.get("stages", {}).get("run") or {}).get("status"),
             "data": {"sessions": real.get("sessions"), "eligibleGaze": real.get("gaze", {}).get("eligible", 0), "labelSessions": real.get("labelSessions", 0), "validLabels": real.get("validLabels", 0), "holdoutLabels": real.get("holdoutLabels", 0), "subjects": real.get("subjectKeys", 0), "referencePaired": real.get("referencePaired", 0), "referenceExploratory": real.get("referenceExploratory", 0), "schemas": real.get("schemas"), "newSinceLast": len(diff.get("newGaze", []) or []), "withdrawnSinceLast": len(diff.get("withdrawn", []) or [])},
             "gaze": None, "rppg": None, "field": inv.get("fieldTelemetry"), "limitations": (gaze or {}).get("limitations"), "notes": []}
    if gaze:
        ev = gaze["evaluations"]
        models = {}
        for name, c in ev["candidates"].items():
            models[name] = {"params": c.get("params"), "val": _m(c.get("val")), "lockedTest": _m(c.get("locked_test")), "temporalTest": _m(c.get("temporal_test")), "evalOnly": _m(c.get("evalOnly")), "parity": (c.get("parity") or {}).get("ok")}
        entry["gaze"] = {"status": gaze["status"], "chosen": gaze["chosen"], "why": gaze["why"].get("reason"), "splits": {k: {"groups": v["groups"], "sessions": v["sessions"], "windows": v["windows"], "records": v["records"]} for k, v in gaze["splits"].items()}, "groupKey": gaze["splitManifest"]["groupKey"],
                         "baseline": {"val": _m(ev["baseline"].get("val")), "lockedTest": _m(ev["baseline"].get("locked_test")), "temporalTest": _m(ev["baseline"].get("temporal_test")), "evalOnly": _m(ev["baseline"].get("evalOnly"))}, "models": models,
                         "gate": {"pass": gaze["gate"]["pass"], "failed": gaze["gate"]["failed"], "shadowOnly": gaze["gate"].get("shadowOnly"), "valGain": round(gaze["gate"].get("valGain", 0), 4)} if gaze.get("gate") else None, "bootstrap": gaze.get("bootstrap"), "candidate": Path(gaze["candidate"]).name if gaze.get("candidate") else None, "synthetic": gaze.get("synthetic", False)}
        entry["policyVersion"] = (gaze.get("gate") or {}).get("policyVersion")
    if rppg:
        entry["rppg"] = {"status": rppg["status"], "pairedSessions": rppg.get("pairedSessions"), "pairedEpochs": rppg.get("pairedEpochs"), "exploratoryRows": rppg.get("exploratoryRows"), "val": rppg.get("val", {}).get("model") if rppg.get("val") else None, "engineVal": rppg.get("val", {}).get("engine") if rppg.get("val") else None, "coverage": rppg.get("val", {}).get("modelCoverage") if rppg.get("val") else None}
    _assert_public(entry)
    return entry


def _assert_public(value, path="entry"):
    if isinstance(value, dict):
        for k, v in value.items():
            if k in FORBIDDEN_KEYS:
                raise ValueError(f"ledger must not contain {path}.{k}")
            _assert_public(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value[:50]):
            _assert_public(v, f"{path}[{i}]")


def publish(entry: dict, ledger_path: Path) -> dict:
    ledger = load_json(ledger_path) if ledger_path.exists() else {"schema": SCHEMA, "runs": [], "note": "Public aggregates of training batch runs (no participant data). Improvement = change of the same metric between runs under the same policy; one run shows no trend."}
    if ledger.get("schema") != SCHEMA:
        raise ValueError("ledger schema mismatch")
    ledger["runs"] = [r for r in ledger["runs"] if r.get("runId") != entry["runId"]] + [entry]
    ledger["runs"].sort(key=lambda r: r["at"])
    ledger["updatedAt"] = entry["at"]
    dump_json(ledger_path, ledger)
    return ledger
