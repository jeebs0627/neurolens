"""Batch pipeline with stage checkpoints (resume after a Colab disconnect) and explicit terminal states.

Stages: audit → snapshot → gaze → rppg → report. Each stage writes its outputs under work_dir and records status in state.json.
States follow schema.RUN_STATES; 'trained' never means 'active'. Synthetic fixtures are excluded unless allow_synthetic=True, and even then
no registry patch is produced (synthetic runs validate code paths only)."""
from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import schema as SCH
from .adapter import load_session
from .baseline import load_baseline, run_baseline
from .canonical import digest
from .evaluate import bootstrap_gain, compare, evaluate_split, limitations
from .export import raw_hashes
from .gaze_dataset import build_records, check_no_leak
from .inventory import build_inventory, inventory_markdown
from .ledger import build_entry
from .release import ROOT, build_manifest, model_card, policy_check, write_candidate
from .rppg_dataset import build_rows
from .safe_io import dump_json, load_json
from .snapshot import build_snapshot, diff_snapshots, load_latest, retrain_trigger, save
from .splits import assign_splits, check_disjoint
from .train_gaze import Identity, choose, matrix, test_vectors, train_candidates
from .train_rppg import train_selector

POLICY_PATH = ROOT / "release_policy.json"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Pipeline:
    def __init__(self, raw_dir: str | Path, work_dir: str | Path, *, allow_synthetic: bool = False, use_mlp: bool = True, seed: int = 20261008, log=print, policy_path: Path = POLICY_PATH, package_exception: dict | None = None):
        self.raw, self.work = Path(raw_dir), Path(work_dir)
        self.work.mkdir(parents=True, exist_ok=True)
        self.allow_synthetic, self.use_mlp, self.seed, self.log = allow_synthetic, use_mlp, seed, log
        # package_exception = {"model": "mlp-residual", "approver": "...", "reason": "..."}: a human-approved policy exception that packages a
        # gate-failing model for SHADOW only (outputs recorded, never applied). The gate result and the approval are written into the manifest.
        self.package_exception = package_exception
        self.policy = load_json(policy_path)
        self.state_path = self.work / "state.json"
        self.state = load_json(self.state_path) if self.state_path.exists() else {"schema": "nl-pipeline-state-1", "runId": digest({"raw": str(self.raw), "at": now()})[:16], "stages": {}, "allowSynthetic": allow_synthetic}

    def _mark(self, stage: str, status: str, **extra):
        self.state["stages"][stage] = {"status": status, "at": now(), **extra}
        self.state["updatedAt"] = now()
        dump_json(self.state_path, self.state)
        self.log(f"[{stage}] {status}" + (f" · {extra.get('reason')}" if extra.get("reason") else ""))

    # ------------------------------------------------------------- stages
    def audit(self) -> dict:
        self._mark("audit", "running")
        inv = build_inventory(self.raw, log=self.log)
        # field evaluation of the browser model on known targets (v3 sessions only; aggregates go to the public ledger without session codes)
        try:
            import subprocess  # noqa: PLC0415
            tool = Path(__file__).resolve().parents[1] / "field_analysis.cjs"
            proc = subprocess.run(["node", str(tool), str(self.raw.resolve() / "sessions"), "--out=" + str((self.work / "field-analysis.json").resolve())], capture_output=True, text=True, encoding="utf-8", timeout=1800, cwd=str(tool.parents[2]))
            if proc.returncode != 0:
                self.log("field analysis failed: " + (proc.stderr or "")[-300:])
        except Exception as e:  # noqa: BLE001
            self.log(f"field analysis skipped: {e}")
        dump_json(self.work / "inventory.json", inv)
        (self.work / "inventory.md").write_text(inventory_markdown(inv), encoding="utf-8")
        self._mark("audit", "evaluated", real=inv["real"]["sessions"], synthetic=inv["synthetic"]["sessions"], eligibleGaze=inv["real"]["gaze"].get("eligible", 0), eligibleRppg=inv["real"]["rppg"].get("eligible", 0))
        return inv

    def snapshot(self, inv: dict | None = None) -> tuple[dict, dict, bool, str]:
        inv = inv or load_json(self.work / "inventory.json")
        self._mark("snapshot", "running")
        snap_inv = inv if not self.allow_synthetic else {**inv, "sessions": [{**s, "synthetic": False} for s in inv["sessions"]]}
        snap = build_snapshot(snap_inv, raw_hashes(self.raw), self.policy["version"], {"allowSynthetic": self.allow_synthetic})
        prev = load_latest(self.work / "snapshots")
        diff = diff_snapshots(prev, snap)
        new_groups = len({s.get("subject_key") or s["session_id"] for s in snap_inv["sessions"] if s["session_id"] in set(diff.get("newGaze", []))})
        trigger, reason = retrain_trigger(diff, self.policy, new_groups)
        path = save(self.work / "snapshots", snap) if (diff.get("first") or diff["changed"]) else None
        dump_json(self.work / "snapshot-diff.json", {**diff, "trigger": trigger, "reason": reason, "snapshotFile": str(path) if path else None})
        if diff.get("withdrawn"):
            self.log(f"withdrawn since previous snapshot: {diff['withdrawn']} → previous snapshot/models using them are flagged in snapshot-diff.json (deletion does not propagate to downloaded data or trained models automatically)")
        self._mark("snapshot", "evaluated" if trigger else "no_new_eligible_data", reason=reason, hash=snap["hash"], counts=snap["counts"])
        return snap, diff, trigger, reason

    def gaze(self, inv: dict | None = None, snap: dict | None = None) -> dict:
        inv = inv or load_json(self.work / "inventory.json")
        snap = snap or load_latest(self.work / "snapshots") or {"hash": "none"}
        self._mark("gaze", "running")
        out = self.work / "gaze"
        out.mkdir(parents=True, exist_ok=True)
        eligible = [s for s in inv["sessions"] if s["gaze_status"] == "eligible" and (self.allow_synthetic or not s.get("synthetic"))]
        if not eligible:
            self._mark("gaze", "insufficient_data", reason="no eligible sessions (see inventory.md)")
            return {"status": "insufficient_data", "reason": "no-eligible-sessions"}
        # baseline reproduction via node for all raw sessions (cached by file)
        bsum = run_baseline(self.raw, out / "baseline", log=self.log)
        records, reports = [], []
        for e in eligible:
            f = self.raw / "sessions" / f"{e['session_id']}.json"
            if not f.exists():
                continue
            s = load_session(load_json(f))
            b = load_baseline(out / "baseline", s.code or e["session_id"]) or load_baseline(out / "baseline", e["session_id"])
            rs, rep = build_records(s, b, contract="add-residual")
            records.extend(rs)
            reports.append(rep)
        check_no_leak(records)
        records, split_manifest = assign_splits(records, seed=self.seed)
        disjoint = check_disjoint(records, split_manifest["groupKey"])
        dump_json(out / "dataset-report.json", {"sessions": reports, "baseline": bsum, "records": len(records), "disjoint": disjoint, "synthetic": self.allow_synthetic})
        dump_json(out / "records.json", [r.__dict__ for r in records], indent=None)
        P = self.policy["gaze_residual"]
        s = split_manifest["splits"]
        if s["train"]["groups"] < 2 or s["val"]["records"] == 0 or s["train"]["windows"] < 20:
            dump_json(out / "split-manifest.json", split_manifest)
            self._mark("gaze", "insufficient_data", reason=f"train groups {s['train']['groups']}, train windows {s['train']['windows']}, val records {s['val']['records']} (policy minimum: {P['minTrainGroups']} groups / {P['minTrainWindows']} windows)")
            return {"status": "insufficient_data", "splits": s}
        train = [r for r in records if r.split_role == "train"]
        val = [r for r in records if r.split_role == "val"]
        results = train_candidates(train, val, out / "models", use_mlp=self.use_mlp, log=self.log)
        chosen, why = choose(results, P["minRelativeGainMedian"])
        # session-grouped k-fold CV on train+val only: a single val split can favour a model by chance (2026-10-08: MLP +14% on val, regressed on holdout)
        try:
            from .cv_select import group_cv  # noqa: PLC0415
            cv = group_cv(records, log=self.log)
            base_cv = cv["table"]["baseline"]["meanMedianPx"]
            cv_name = {"mlp-residual": "mlp_64_32", "ridge-residual": "ridge_all_l1"}.get(chosen)
            if chosen != "baseline-engine" and cv_name in cv["table"] and cv["table"][cv_name]["meanMedianPx"] > base_cv * (1 - P["minRelativeGainMedian"]):
                why = {**why, "cvOverride": f"{chosen} CV {cv['table'][cv_name]['meanMedianPx']}px vs baseline {base_cv}px (needs ≥{int(P['minRelativeGainMedian'] * 100)}% gain)"}
                self.log("group CV does not confirm the val gain → " + why["cvOverride"])
        except Exception as e:  # noqa: BLE001
            cv = {"error": str(e)[:200]}
        pre = results["baseline-engine"].pre
        base = Identity()
        evals = {"baseline": {k: evaluate_split(records, base, pre, k) for k in ("val",)}, "candidates": {}}
        for name, r in results.items():
            if r.model is None or name == "baseline-engine":
                continue
            evals["candidates"][name] = {"val": evaluate_split(records, r.model, pre, "val"), "evalOnly": evaluate_split(records, r.model, pre, "eval_only"), "params": r.params, "parity": r.parity, "onnx": r.onnx, "artifact": r.artifact, "extra": r.extra}
        evals["baseline"]["evalOnly"] = evaluate_split(records, base, pre, "eval_only")
        # locked/temporal test: only for the chosen candidate (and baseline for comparison), access logged
        if chosen != "baseline-engine":
            m = results[chosen].model
            for k in ("locked_test", "temporal_test"):
                evals["candidates"][chosen][k] = evaluate_split(records, m, pre, k, split_manifest, who=f"release-gate:{chosen}")
                evals["baseline"][k] = evaluate_split(records, base, pre, k, split_manifest, who="release-gate:baseline")
            boot = bootstrap_gain(records, m, base, pre, "val")
        else:
            boot = None
        cmp = compare(evals["baseline"]["val"], evals["candidates"][chosen]["val"]) if chosen != "baseline-engine" else None
        dump_json(out / "split-manifest.json", split_manifest)
        # integrity: every training record comes from a session whose baseline was reproduced, and the export verified every payload hash
        used = {r.session_id for r in records}
        index_path = self.raw / "index.json"
        export_ok = (load_json(index_path).get("corrupt", 1) == 0) if index_path.exists() else False
        checks = {"integrity": export_ok and all(r.get("fidelity") != "unavailable" for r in reports if r["session"] in used), "label-provenance": True, "time-alignment": all("needs-sync" not in r.get("skipped", {}) for r in reports), "split-disjoint": disjoint["ok"], "withdrawal": True, "allowlist": True, "schema": True,
                  "subject-link": split_manifest["groupKey"] == "subject_key"}
        status, gate, manifest, card_path = "evaluated", None, None, None
        exc = self.package_exception
        if exc and exc.get("model") in results and results[exc["model"]].model is not None and chosen == "baseline-engine":
            chosen = exc["model"]   # exception packaging of a model the val gate did not even select: still evaluated on locked/temporal below
        if chosen != "baseline-engine":
            r = results[chosen]
            gate = policy_check(self.policy, split_manifest=split_manifest, chosen=chosen, results=results, val_eval=evals["candidates"][chosen]["val"], base_eval=evals["baseline"]["val"], bootstrap=boot, parity=r.parity, onnx_bytes=Path(r.artifact).stat().st_size, params=r.params, checks=checks,
                                locked=(evals["candidates"][chosen].get("locked_test", {}), evals["baseline"].get("locked_test", {})), temporal=(evals["candidates"][chosen].get("temporal_test", {}), evals["baseline"].get("temporal_test", {})))
            if not gate["pass"]:
                import shutil  # noqa: PLC0415
                shutil.rmtree(out / "candidate", ignore_errors=True)   # a previous run's candidate package must not survive a failed gate
                (out / "model-registry.candidate.json").unlink(missing_ok=True)
            # 사람 연결이 없는 자료(세션 단위 분할)로 만든 후보는 shadow 까지만: person-disjoint 평가 없이는 active 불가 (release_policy.requireSubjectLinkForPersonClaims)
            gate["shadowOnly"] = not checks["subject-link"] and bool(self.policy["gaze_residual"].get("requireSubjectLinkForPersonClaims", True))
            use_exception = bool(exc and exc.get("model") == chosen and not gate["pass"])
            if (gate["pass"] or use_exception) and not self.allow_synthetic:
                X, _, _, _ = matrix(val[:5])
                Z = pre.transform(X)
                model_id = f"gaze-residual-{snap['hash'][:8]}-{chosen.split('-')[0]}" + ("-shadowx" if use_exception else "")
                # supports.core = engine that reconstructed the training features (baseline replay), not the sessions' historical versions
                manifest = build_manifest(model_id=model_id, version=datetime.now(timezone.utc).strftime("%Y.%m.%d"), onnx_path=Path(r.artifact), pre=pre.to_json(), contract="add-residual", test_vectors=test_vectors(Z, r.model.predict(Z)), core_versions=[bsum.get("engine")] if bsum.get("engine") else [],
                                          snapshot_hash=snap["hash"], split_hash=split_manifest["groupsHash"], policy=self.policy, opset=r.onnx["opset"], metrics={"val": evals["candidates"][chosen]["val"], "baselineVal": evals["baseline"]["val"], "lockedTest": evals["candidates"][chosen].get("locked_test"), "baselineLockedTest": evals["baseline"].get("locked_test"), "temporalTest": evals["candidates"][chosen].get("temporal_test"), "baselineTemporalTest": evals["baseline"].get("temporal_test"), "evalOnlyHoldout": evals["candidates"][chosen]["evalOnly"], "bootstrap": boot, "compare": cmp, "gate": gate}, limitations=limitations(records), parent=None)
                manifest["release"]["maxState"] = "shadow" if (gate["shadowOnly"] or use_exception) else "active"
                manifest["release"]["maxStateReason"] = ("policy exception: gate failed (" + ", ".join(gate["failed"]) + ") - shadow only, outputs recorded and never applied" if use_exception else "session-level split only (no subjectKey): person-disjoint generalisation not demonstrated -> shadow until a subject-linked prospective evaluation passes" if gate["shadowOnly"] else None)
                if use_exception:
                    manifest["release"]["state"] = "shadow-exception"
                    manifest["release"]["exception"] = {"approver": exc.get("approver"), "reason": exc.get("reason"), "approvedAt": datetime.now(timezone.utc).isoformat(), "gateFailed": gate["failed"], "note": "Human-approved deviation from release_policy. This model regressed on locked/temporal tests; it must never be promoted to active without a passing prospective evaluation."}
                written = write_candidate(out / "candidate", manifest, Path(r.artifact), model_card(manifest, {}), ROOT / "model-registry.json", str(out / "REPORT.md"), "shadow-exception" if use_exception else "candidate")
                status = "candidate" if gate["pass"] else "evaluated"
                card_path = written["dir"]
                if use_exception:
                    self.log(f"policy exception: packaged {chosen} for SHADOW only -> {written['dir']}")
            elif gate["pass"] and self.allow_synthetic:
                status = "evaluated"
                self.log("synthetic run passed the gate numerically; no candidate is registered from synthetic data")
        report = {"schema": "nl-gaze-run-1", "status": status, "chosen": chosen, "why": why, "groupCv": cv, "compare": cmp, "bootstrap": boot, "gate": gate, "evaluations": evals, "splits": s, "splitManifest": split_manifest, "datasetReports": reports, "limitations": limitations(records), "synthetic": self.allow_synthetic, "candidate": card_path, "snapshot": snap["hash"], "engine": bsum.get("engine")}
        dump_json(out / "run.json", report)
        (out / "REPORT.md").write_text(gaze_markdown(report), encoding="utf-8")
        self._mark("gaze", status, chosen=chosen, reason=why.get("reason"), gatePass=bool(gate and gate["pass"]))
        return report

    def rppg(self, inv: dict | None = None) -> dict:
        inv = inv or load_json(self.work / "inventory.json")
        self._mark("rppg", "running")
        out = self.work / "rppg"
        out.mkdir(parents=True, exist_ok=True)
        rows, reps = [], []
        for e in inv["sessions"]:
            if e.get("synthetic") and not self.allow_synthetic:
                continue
            if e["rppg_status"] in ("demo", "no-consent", "corrupt", "withdrawn"):
                continue
            f = self.raw / "sessions" / f"{e['session_id']}.json"
            if not f.exists():
                continue
            rs, rep = build_rows(load_session(load_json(f)))
            rows.extend(rs)
            reps.append(rep)
        res = train_selector(rows, log=self.log)
        res["sessions"] = reps
        res["referenceGrades"] = {"paired": sum(1 for r in reps if r["labelGrade"] == "paired"), "exploratory": sum(1 for r in reps if r["labelGrade"] == "exploratory"), "none": sum(1 for r in reps if r["labelGrade"] is None)}
        res["synthetic"] = self.allow_synthetic
        dump_json(out / "run.json", res)
        dump_json(out / "rows.json", [r.__dict__ for r in rows], indent=None)
        self._mark("rppg", res["status"], pairedSessions=res["pairedSessions"], pairedEpochs=res["pairedEpochs"])
        return res

    def run(self, resume: bool = True) -> dict:
        # one ledger row per batch run: a fresh runId every time run() starts (the work dir is reused across runs)
        self.state["runId"] = digest({"raw": str(self.raw), "at": now()})[:16]
        try:
            st = self.state["stages"]
            inv = load_json(self.work / "inventory.json") if resume and st.get("audit", {}).get("status") == "evaluated" and (self.work / "inventory.json").exists() else self.audit()
            snap, diff, trigger, reason = self.snapshot(inv)
            gaze_done = st.get("gaze", {}).get("status") in ("evaluated", "candidate", "insufficient_data") and st.get("gaze", {}).get("snapshot") == snap["hash"]
            rppg_done = st.get("rppg", {}).get("status") in ("evaluated", "insufficient_reference_labels")
            if not trigger and gaze_done and rppg_done and resume:
                self._mark("run", "no_new_eligible_data", reason=reason)
                return self.state
            if not trigger:
                self.log(f"snapshot unchanged ({reason}) but a previous run did not finish for it → resuming the unfinished stages")
            if not (resume and gaze_done and (self.work / "gaze" / "run.json").exists()):
                self.gaze(inv, snap)
                self.state["stages"]["gaze"]["snapshot"] = snap["hash"]
                dump_json(self.state_path, self.state)
            if not (resume and rppg_done):
                self.rppg(inv)
            self._mark("run", "evaluated", gaze=self.state["stages"]["gaze"]["status"], rppg=self.state["stages"]["rppg"]["status"])
            dump_json(self.work / "ledger-entry.json", build_entry(self.work, self.state))
            self.log("ledger entry written → publish with: python -m nlcolab publish-ledger <work_dir> (non-sensitive aggregates only)")
        except Exception as e:  # noqa: BLE001
            self._mark("run", "failed", reason=str(e)[:300], trace=traceback.format_exc()[-2000:])
            raise
        return self.state


def gaze_markdown(rep: dict) -> str:
    ev = rep["evaluations"]
    def row(name, e):
        return f"| {name} | {e.get('n', 0)} | {e.get('windows', '—')} | {e.get('medianPx', float('nan')):.1f} | {e.get('p95Px', float('nan')):.1f} | {e.get('biasXPx', float('nan')):.1f}/{e.get('biasYPx', float('nan')):.1f} |" if e.get("n") else f"| {name} | 0 | — | — | — | — |"
    lines = ["# 시선 잔차 학습 실행 보고서" + (" (SYNTHETIC · 코드 검증용)" if rep["synthetic"] else ""), "", f"- 상태: **{rep['status']}** · 선택: `{rep['chosen']}` ({rep['why'].get('reason')}) · 스냅샷 `{rep['snapshot']}` · 엔진 {rep['engine']}",
             f"- 분할: " + " · ".join(f"{k} g{v['groups']}/s{v['sessions']}/w{v['windows']}/n{v['records']}" for k, v in rep["splits"].items()), f"- 그룹 키: {rep['splitManifest']['groupKey']} — {rep['splitManifest']['groupKeyNote']}", "",
             "## validation (모델 선택용)", "| 모델 | 프레임 | 창 | 중앙 오차 px | P95 px | 편향 x/y px |", "|---|---|---|---|---|---|", row("baseline-engine", ev["baseline"]["val"]), *[row(k, v["val"]) for k, v in ev["candidates"].items()], ""]
    if rep["compare"]:
        c = rep["compare"]
        lines += [f"- 중앙 오차 상대 개선: {c['medianGain'] * 100:.1f}% · P95 비율 {c['p95Ratio']:.2f} · 악화 영역 {c['worseRegions']} · 표본 부족 영역 {c['sparseRegions']}"]
    if rep["bootstrap"]:
        b = rep["bootstrap"]
        lines += [f"- 그룹 bootstrap 개선 중앙값 {b['medianGain'] * 100:.1f}% (95% CI {b['ci95'][0] * 100:.1f}~{b['ci95'][1] * 100:.1f}%, 그룹 {b['groups']})"]
    ch = rep["chosen"]
    if ch in ev["candidates"]:
        for k in ("locked_test", "temporal_test"):
            if ev["candidates"][ch].get(k, {}).get("n"):
                lines += [f"- {k}: 모델 중앙 {ev['candidates'][ch][k]['medianPx']:.1f}px vs baseline {ev['baseline'][k]['medianPx']:.1f}px (접근 기록은 split-manifest.json)"]
    eo = ev["baseline"].get("evalOnly", {})
    lines += ["", f"## 최종 holdout(eval_only · 라벨 수집 모드 마지막 블록): baseline 중앙 {eo.get('medianPx', float('nan')):.1f}px (n={eo.get('n', 0)})" + (f" · 선택 모델 {ev['candidates'][ch]['evalOnly'].get('medianPx', float('nan')):.1f}px" if ch in ev["candidates"] and ev["candidates"][ch]["evalOnly"].get("n") else ""), "4~6개 표적만으로 사용자·기기 전반 일반화를 주장하지 않는다.", ""]
    if rep["gate"]:
        lines += ["## release policy", f"- pass: {rep['gate']['pass']} · 실패 항목: {rep['gate']['failed']}", ""]
    lines += ["## 한계", *[f"- {l}" for l in rep["limitations"]], "", "## 세션별 데이터 보고", "| 세션 | fidelity | fit | 창 | 레코드 | 제외 |", "|---|---|---|---|---|---|", *[f"| {r['session']} | {r['fidelity']} | {r['fit']} | {r['windows']} | {r['records']} | {json.dumps(r['skipped'], ensure_ascii=False)} |" for r in rep["datasetReports"]], ""]
    return "\n".join(lines) + "\n"
