"""Leak-free splits: group (subject if linkable, else session) + temporal holdout, fixed before any scaler/model fitting.

· group key: subject_key when every record of the pool has one, otherwise session_id (then subject leakage is possible and is reported).
· temporal_test: the newest sessions (by created_at) are reserved so a model is not tuned only to the past.
· locked_test is for the release gate; every access is appended to the split manifest's access_log (evaluate.py).
· eval_only rows (final gaze-label holdout) never enter train/val; they are reported separately.
Manifest (SPLIT_SCHEMA) records seed, group key, per-split groups/sessions/windows/records and the record-ID hash."""
from __future__ import annotations

import random
from collections import Counter, defaultdict
from datetime import datetime, timezone

from . import schema as SCH
from .canonical import digest
from .gaze_dataset import Record


def group_key(records: list[Record]) -> tuple[str, str]:
    if records and all(r.subject_key for r in records):
        return "subject_key", "subject-level (device pseudonym)"
    return "session_id", "session-level: subject leakage possible for sessions without subjectKey"


def assign_splits(records: list[Record], seed: int = 20261008, val_frac: float = 0.2, test_frac: float = 0.2, temporal_frac: float = 0.2) -> tuple[list[Record], dict]:
    sup = [r for r in records if r.split_role == "supervised"]
    ev = [r for r in records if r.split_role == "eval_only"]
    key, key_note = group_key(sup)
    groups = sorted({getattr(r, key) for r in sup})
    rnd = random.Random(seed)
    rnd.shuffle(groups)
    # temporal holdout: newest groups by max created_at
    created = defaultdict(str)
    for r in sup:
        g = getattr(r, key)
        created[g] = max(created[g], r.created_at or "")
    by_time = sorted(groups, key=lambda g: created[g])
    n_temporal = int(round(len(groups) * temporal_frac)) if len(groups) >= 5 else 0
    temporal = set(by_time[len(by_time) - n_temporal:]) if n_temporal else set()
    rest = [g for g in groups if g not in temporal]
    n_test = int(round(len(rest) * test_frac)) if len(rest) >= 3 else 0
    n_val = int(round(len(rest) * val_frac)) if len(rest) >= 3 else max(0, min(1, len(rest) - 1))
    test = set(rest[:n_test])
    val = set(rest[n_test:n_test + n_val])
    train = set(rest[n_test + n_val:])
    for r in sup:
        g = getattr(r, key)
        r.split_role = "temporal_test" if g in temporal else "locked_test" if g in test else "val" if g in val else "train"
    for r in ev:
        r.split_role = "eval_only"

    def summary(name):
        rs = [r for r in records if r.split_role == name]
        return {"groups": len({getattr(r, key) for r in rs}), "sessions": len({r.session_id for r in rs}), "windows": len({r.window_id for r in rs}), "records": len(rs), "labelSources": dict(Counter(r.label_source for r in rs)), "regions": dict(Counter(r.target["region"] for r in rs))}
    manifest = {"schema": SCH.SPLIT_SCHEMA, "createdAt": datetime.now(timezone.utc).isoformat(), "seed": seed, "groupKey": key, "groupKeyNote": key_note, "fractions": {"val": val_frac, "test": test_frac, "temporal": temporal_frac},
                "splits": {k: summary(k) for k in ("train", "val", "locked_test", "temporal_test", "eval_only")}, "recordIdsHash": digest(sorted(r.record_id for r in records)), "groupsHash": digest({k: sorted(g for g in groups if g in s) for k, s in (("train", train), ("val", val), ("locked_test", test), ("temporal_test", temporal))}),
                "access_log": [], "note": "Model selection and early stopping use val only. locked_test is read at the release gate and every read is logged. eval_only = final gaze-label holdout (report only)."}
    return records, manifest


def check_disjoint(records: list[Record], key: str) -> dict:
    seen = defaultdict(set)
    for r in records:
        if r.split_role in ("train", "val", "locked_test", "temporal_test"):
            seen[getattr(r, key)].add(r.split_role)
    overlaps = {g: sorted(s) for g, s in seen.items() if len(s) > 1}
    windows = defaultdict(set)
    for r in records:
        windows[r.window_id].add(r.split_role)
    w_over = [w for w, s in windows.items() if len(s) > 1]
    return {"groupOverlaps": overlaps, "windowOverlaps": w_over, "ok": not overlaps and not w_over}
