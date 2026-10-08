"""End-to-end pipeline tests on synthetic fixtures (node fixtures.cjs). Validates code paths, shapes and refusal states — not human accuracy."""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "colab"))
from nlcolab import schema as SCH  # noqa: E402
from nlcolab.adapter import load_session  # noqa: E402
from nlcolab.export import import_local  # noqa: E402
from nlcolab.gaze_dataset import build_records, eval_only, supervised  # noqa: E402
from nlcolab.inventory import classify  # noqa: E402
from nlcolab.pipeline import Pipeline  # noqa: E402
from nlcolab.release import policy_check, registry_patch  # noqa: E402
from nlcolab.rppg_dataset import build_rows, paired_rows  # noqa: E402
from nlcolab.safe_io import UnsafeInput, load_json  # noqa: E402
from nlcolab.baseline import load_baseline  # noqa: E402

TMP = pathlib.Path(tempfile.mkdtemp(prefix="nlcolab-"))


def fixtures(n=8, seed=100, legacy=2):
    d = TMP / f"fx-{n}-{seed}"
    if not d.exists():
        subprocess.check_call(["node", str(ROOT / "tools" / "colab" / "fixtures.cjs"), str(d), f"--sessions={n}", f"--seed={seed}", f"--legacy={legacy}"], cwd=ROOT)
    return d


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx = fixtures()
        cls.raw = TMP / "raw"
        import_local(cls.raw, [cls.fx / "sessions"], log=lambda *_: None)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TMP, ignore_errors=True)

    def test_import_marks_synthetic_and_inventory_separates_it(self):
        pl = Pipeline(self.raw, TMP / "work-a", log=lambda *_: None)
        inv = pl.audit()
        self.assertEqual(inv["real"]["sessions"], 0, "synthetic fixtures must not count as real data")
        self.assertEqual(inv["synthetic"]["sessions"], 8)
        self.assertGreaterEqual(inv["synthetic"]["gaze"].get("eligible", 0), 6)
        self.assertTrue((TMP / "work-a" / "inventory.md").exists())
        # real-data path with no eligible sessions ends in insufficient_data, never a model
        rep = pl.gaze(inv)
        self.assertEqual(rep["status"], "insufficient_data")

    def test_classification_reasons_and_labels(self):
        rows = sorted((self.raw / "sessions").glob("*.json"))
        v3 = [load_session(load_json(f)) for f in rows]
        kinds = {s.schema for s in v3}
        self.assertEqual(kinds, {"nl-research-3", "nl-research-2"})
        e3 = classify(next(s for s in v3 if s.schema == "nl-research-3"))
        self.assertEqual(e3.gaze_status, "eligible")
        reasons = {}
        for l in (next(s for s in v3 if s.schema == "nl-research-3").labels or {}).get("labels", []):
            for r in l.get("rejectReasons") or []:
                reasons[r] = reasons.get(r, 0) + 1
        self.assertGreaterEqual(e3.labels["valid"], 20, f"reject reasons: {reasons}")
        self.assertEqual(e3.labels["holdoutPipelineUnchanged"], True)
        e2 = classify(next(s for s in v3 if s.schema == "nl-research-2"))
        self.assertIn("target-windows-inferred-backfill", e2.gaze_reasons)
        self.assertEqual(e2.labels["valid"], 0)
        with_ref = next(s for s in v3 if s.reference)
        self.assertEqual(classify(with_ref).rppg_status, "needs-sync", "BLE receipt-time reference is exploratory until a researcher verifies sync")

    def test_gaze_pipeline_on_synthetic_trains_evaluates_and_never_registers(self):
        pl = Pipeline(self.raw, TMP / "work-b", allow_synthetic=True, log=lambda *_: None)
        inv = pl.audit()
        snap, diff, trigger, reason = pl.snapshot(inv)
        self.assertTrue(trigger and reason == "first-snapshot")
        rep = pl.gaze(inv, snap)
        self.assertIn(rep["status"], ("evaluated", "insufficient_data"))
        self.assertTrue(rep["synthetic"])
        self.assertIsNone(rep["candidate"], "synthetic runs never write a registry candidate")
        if rep["status"] == "evaluated":
            self.assertIn("ridge-residual", rep["evaluations"]["candidates"])
            r = rep["evaluations"]["candidates"]["ridge-residual"]
            self.assertTrue(r["parity"]["ok"], r["parity"])
            self.assertEqual(r["onnx"]["output"]["units"], "viewport-fraction")
            if "mlp-residual" in rep["evaluations"]["candidates"]:
                m = rep["evaluations"]["candidates"]["mlp-residual"]
                self.assertTrue(m["parity"]["ok"]); self.assertLessEqual(m["params"], 50000)
            self.assertTrue((TMP / "work-b" / "gaze" / "REPORT.md").exists())
            sm = rep["splitManifest"]
            self.assertEqual(sm["splits"]["eval_only"]["records"] > 0, True, "final gaze-label holdout is reported as eval_only")
            self.assertTrue(all(x["split"] in ("locked_test", "temporal_test") for x in sm["access_log"]))
        # re-running the snapshot with unchanged data → no_new_eligible_data
        snap2, diff2, trigger2, reason2 = pl.snapshot(inv)
        self.assertFalse(trigger2); self.assertEqual(reason2, "no_new_eligible_data"); self.assertEqual(snap2["hash"], snap["hash"])

    def test_records_exclude_holdout_from_supervised_and_features_are_allowlisted(self):
        work = TMP / "work-b"
        f = next(p for p in sorted((self.raw / "sessions").glob("*.json")) if load_json(p)["payload"]["schema"] == "nl-research-3")
        s = load_session(load_json(f))
        b = load_baseline(work / "gaze" / "baseline", s.code)
        self.assertIsNotNone(b, "baseline reproduction present from the pipeline run")
        recs, rep = build_records(s, b)
        self.assertGreater(len(recs), 100)
        sup, ev = supervised(recs), eval_only(recs)
        self.assertTrue(all(r.label_role != "holdout" for r in sup))
        self.assertTrue(all(r.label_role == "holdout" and r.label_source == "explicit_target_confirmed" for r in ev))
        self.assertGreaterEqual(len({r.window_id for r in ev}), 4)
        for r in recs[:50]:
            self.assertTrue(set(r.features) <= set(SCH.FEATURE_ALLOWLIST))
            self.assertFalse(set(r.features) & set(SCH.FEATURE_DENYLIST))
            self.assertAlmostEqual(sum(x.weight for x in recs if x.window_id == r.window_id), 1.0, places=6)
        self.assertEqual(rep["fit"], "replaySelection", "honest fit: fine points untouched by the selection model")
        # residual target is target minus engine base (add-residual contract)
        r0 = recs[0]
        self.assertAlmostEqual(r0.residual["dx"], r0.target["x"] - r0.base["bx"], places=6)

    def test_rppg_rows_and_insufficient_reference_labels(self):
        pl = Pipeline(self.raw, TMP / "work-c", allow_synthetic=True, log=lambda *_: None)
        inv = pl.audit()
        res = pl.rppg(inv)
        self.assertEqual(res["status"], "insufficient_reference_labels")
        self.assertEqual(res["pairedSessions"], 0)
        self.assertGreater(res["referenceGrades"]["exploratory"], 0, "BLE references exist but are exploratory (unverified sync)")
        self.assertIn("IBI/HRV", res["hrvNote"])
        # inject a verified reference annotation → paired rows appear, candidates carry no reference features
        f = next(p for p in sorted((self.raw / "sessions").glob("*.json")) if load_json(p)["payload"].get("reference"))
        obj = load_json(f)
        ref = dict(obj["payload"]["reference"]); ref["verified"] = True; ref["sync"] = {"offsetMs": 0, "driftPpm": 0, "uncertaintyMs": 20, "method": "fixture shared marker"}
        obj["annotations"] = [{"id": "ann-1", "kind": "reference", "created_at": "2026-10-08T00:00:00Z", "body": {"reference": ref, "comparison": {"status": "paired"}}}]
        s = load_session(obj)
        self.assertEqual(s.reference["origin"], "annotation")
        rows, rep = build_rows(s)
        pr = paired_rows(rows)
        self.assertGreater(len(pr), 0, rep)
        self.assertTrue(all(r.ref_bpm is not None and r.abs_error is not None for r in pr))
        self.assertFalse(any(k in r.features for r in pr for k in ("ref_bpm", "abs_error", "referenceBpm")))
        self.assertTrue(all(r.causal for r in pr))

    def test_release_gate_and_registry_patch_never_activate(self):
        policy = load_json(ROOT / "release_policy.json")
        sm = {"splits": {"train": {"groups": 10, "windows": 200}, "val": {"groups": 3}, "locked_test": {"groups": 3}}}
        base = {"n": 100, "medianPx": 50.0, "p95Px": 120.0, "windows": 40}
        good = {"n": 100, "medianPx": 44.0, "p95Px": 118.0, "windows": 40}
        checks = {k: True for k in ("integrity", "label-provenance", "time-alignment", "split-disjoint", "withdrawal", "allowlist", "schema")}
        held = ({"n": 50, "medianPx": 45.0}, {"n": 50, "medianPx": 50.0})
        g = policy_check(policy, split_manifest=sm, chosen="ridge-residual", results={}, val_eval=good, base_eval=base, bootstrap={"ci95": [0.02, 0.2]}, parity={"ok": True}, onnx_bytes=1000, params=100, checks=checks, locked=held, temporal=held)
        self.assertTrue(g["pass"], g["failed"])
        regress = policy_check(policy, split_manifest=sm, chosen="ridge-residual", results={}, val_eval=good, base_eval=base, bootstrap={"ci95": [0.02, 0.2]}, parity={"ok": True}, onnx_bytes=1000, params=100, checks=checks, locked=({"n": 50, "medianPx": 52.0}, {"n": 50, "medianPx": 50.0}), temporal=held)
        self.assertFalse(regress["pass"]); self.assertIn("locked-test-no-regression", regress["failed"])
        bad = policy_check(policy, split_manifest=sm, chosen="ridge-residual", results={}, val_eval={**good, "medianPx": 49.0}, base_eval=base, bootstrap={"ci95": [-0.1, 0.2]}, parity={"ok": False}, onnx_bytes=1000, params=100, checks={**checks, "withdrawal": False}, locked=held, temporal=held)
        self.assertFalse(bad["pass"]); self.assertTrue({"val-gain", "bootstrap", "parity", "withdrawal"} <= set(bad["failed"]))
        reg_path = TMP / "registry.json"
        reg_path.write_text(json.dumps({"schema": SCH.REGISTRY_SCHEMA, "active": None, "shadow": None, "candidates": [], "history": []}), encoding="utf-8")
        man = {"id": "gaze-residual-test", "kind": "gaze-residual", "version": "1", "sha256": "a" * 64, "createdAt": "2026-10-08T00:00:00Z"}
        patched = registry_patch(reg_path, man, "REPORT.md", "candidate")
        self.assertIsNone(patched["active"]); self.assertIsNone(patched["shadow"]); self.assertEqual(patched["candidates"][0]["state"], "candidate")

    def test_ledger_entry_is_public_aggregates_only(self):
        from nlcolab.ledger import build_entry, publish, FORBIDDEN_KEYS
        work = TMP / "work-b"
        if not (work / "state.json").exists():
            self.skipTest("gaze run not available")
        entry = build_entry(work, load_json(work / "state.json"))
        text = json.dumps(entry, ensure_ascii=False)
        self.assertNotIn("SYN-", text, "no session codes in the public ledger")
        self.assertFalse(any(k in text for k in ("record_id", "subject_key", "access_token")))
        self.assertEqual(entry["data"]["sessions"], 0, "synthetic sessions are not counted as real data")
        led = publish(entry, TMP / "ledger.json"); led2 = publish(entry, TMP / "ledger.json")
        self.assertEqual(len(led2["runs"]), 1, "re-publishing the same run replaces, never duplicates")
        self.assertEqual(led["schema"], "nl-training-ledger-1")
        self.assertTrue(FORBIDDEN_KEYS)

    def test_safe_io_rejects_non_finite_json_and_zip_traversal(self):
        p = TMP / "bad.json"
        p.write_text('{"a": NaN}', encoding="utf-8")
        with self.assertRaises(UnsafeInput):
            load_json(p)
        import zipfile
        from nlcolab.safe_io import load_npz
        z = TMP / "bad.npz"
        with zipfile.ZipFile(z, "w") as zf:
            zf.writestr("../evil.npy", b"x" * 10)
        with self.assertRaises(UnsafeInput):
            load_npz(z)


if __name__ == "__main__":
    unittest.main()
