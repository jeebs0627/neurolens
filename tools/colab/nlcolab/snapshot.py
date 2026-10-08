"""Immutable dataset snapshots and change detection.

A snapshot pins: eligible record IDs, payload SHA-256s, annotation IDs (label/reference revisions), feature/preprocessing/exporter versions,
collection period, policy version and the raw-file hashes. Two snapshots with the same `hash` mean no eligible data or relevant version changed →
the pipeline ends with `no_new_eligible_data`. Withdrawn sessions (present in an earlier snapshot, absent now) are listed so affected
snapshots/models can be flagged for retraining/retirement (deletion does not propagate automatically to downloaded data or trained models)."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from . import schema as SCH
from .canonical import digest
from .safe_io import dump_json, load_json

FEATURE_VERSION = "gaze-features-2"   # 2: unknown core → legacy vertical axis recomputed from landmarks
EXPORTER_VERSION = "nlcolab-export-1"


def build_snapshot(inventory: dict, raw_hashes: dict[str, str], policy_version: str, extra_versions: dict | None = None) -> dict:
    sessions = [s for s in inventory["sessions"] if not s.get("synthetic")]
    eligible_gaze = sorted(s["session_id"] for s in sessions if s["gaze_status"] == "eligible")
    eligible_rppg = sorted(s["session_id"] for s in sessions if s["rppg_status"] == "eligible")
    body = {"eligibleGaze": eligible_gaze, "eligibleRppg": eligible_rppg, "payloadHashes": {s["session_id"]: s.get("payload_sha256") for s in sessions}, "annotationIds": {s["session_id"]: sorted(s.get("annotation_ids") or []) for s in sessions},
            "rawFileHashes": {k: raw_hashes.get(k) for k in sorted(raw_hashes)}, "versions": {"feature": FEATURE_VERSION, "exporter": EXPORTER_VERSION, "policy": policy_version, "labels": SCH.LABEL_SCHEMA, **(extra_versions or {})}}
    created = [s.get("created_at") for s in sessions if s.get("created_at")]
    snap = {"schema": SCH.SNAPSHOT_SCHEMA, "createdAt": datetime.now(timezone.utc).isoformat(), "hash": digest(body), "counts": {"sessions": len(sessions), "eligibleGaze": len(eligible_gaze), "eligibleRppg": len(eligible_rppg), "groups": len({s.get("subject_key") or s["session_id"] for s in sessions if s["gaze_status"] == "eligible"})},
            "period": {"from": min(created) if created else None, "to": max(created) if created else None}, **body}
    return snap


def diff_snapshots(prev: dict | None, cur: dict) -> dict:
    if not prev:
        return {"first": True, "changed": True, "newGaze": cur["eligibleGaze"], "withdrawn": [], "annotationChanges": [], "versionChanges": []}
    new_gaze = sorted(set(cur["eligibleGaze"]) - set(prev["eligibleGaze"]))
    withdrawn = sorted(set(prev["payloadHashes"]) - set(cur["payloadHashes"]))
    ann = sorted(s for s in cur["annotationIds"] if cur["annotationIds"].get(s) != prev["annotationIds"].get(s))
    ver = sorted(k for k in cur["versions"] if cur["versions"][k] != prev["versions"].get(k))
    hash_changed = sorted(s for s in cur["payloadHashes"] if s in prev["payloadHashes"] and cur["payloadHashes"][s] != prev["payloadHashes"][s])
    changed = cur["hash"] != prev["hash"]
    return {"first": False, "changed": changed, "newGaze": new_gaze, "withdrawn": withdrawn, "annotationChanges": ann, "versionChanges": ver, "payloadHashChanged": hash_changed, "prevHash": prev["hash"], "curHash": cur["hash"]}


def retrain_trigger(diff: dict, policy: dict, new_groups: int) -> tuple[bool, str]:
    P = policy["data_changes_that_trigger_retrain"]
    if diff.get("first"):
        return True, "first-snapshot"
    if not diff["changed"]:
        return False, "no_new_eligible_data"
    if diff["withdrawn"]:
        return True, "withdrawal-affects-previous-snapshot"
    if diff["annotationChanges"]:
        return True, "annotation-revision"
    if diff["versionChanges"]:
        return True, "version-change:" + ",".join(diff["versionChanges"])
    if len(diff["newGaze"]) >= P["minNewEligibleSessions"] and new_groups >= P["minNewGroups"]:
        return True, f"new-eligible-sessions:{len(diff['newGaze'])}"
    return False, f"below-threshold(new={len(diff['newGaze'])},groups={new_groups})"


def load_latest(snap_dir: Path) -> dict | None:
    files = sorted(snap_dir.glob("snapshot-*.json"))
    return load_json(files[-1]) if files else None


def save(snap_dir: Path, snap: dict) -> Path:
    snap_dir.mkdir(parents=True, exist_ok=True)
    p = snap_dir / f"snapshot-{snap['createdAt'].replace(':', '').replace('-', '')[:15]}-{snap['hash'][:12]}.json"
    dump_json(p, snap)
    return p
