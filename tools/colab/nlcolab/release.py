"""Release candidate: policy gate, manifest (nl-gaze-residual-manifest-1), test vectors, hashes, model card, registry patch.

The registry patch only ever adds a `candidates[]` entry and a history event; it never sets `active`/`shadow`. Promotion is a separate
human edit of model-registry.json (recorded approver, report path, previous active, rollback target)."""
from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import schema as SCH
from .canonical import digest, file_sha256
from .safe_io import dump_json, load_json

ROOT = Path(__file__).resolve().parents[3]


def git_head() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:  # noqa: BLE001
        return None


def environment() -> dict:
    env = {"python": sys.version.split()[0], "platform": platform.platform()}
    for mod in ("numpy", "torch", "onnx", "onnxruntime", "sklearn", "scipy"):
        try:
            env[mod] = __import__(mod).__version__
        except Exception:  # noqa: BLE001
            env[mod] = None
    return env


def policy_check(policy: dict, *, split_manifest: dict, chosen: str, results: dict, val_eval: dict, base_eval: dict, bootstrap: dict | None, parity: dict | None, onnx_bytes: int, params: int, checks: dict, locked: tuple[dict, dict] | None = None, temporal: tuple[dict, dict] | None = None) -> dict:
    P = policy["gaze_residual"]
    out = {}
    # held-out session/time tests: the fixed candidate must not regress (read once at the gate; access is logged in the split manifest)
    def no_regress(pair, limit_key):
        if not pair or not pair[0].get("n") or not pair[1].get("n"):
            return None
        return (pair[0]["medianPx"] - pair[1]["medianPx"]) / max(1e-9, pair[1]["medianPx"]) <= P.get(limit_key, 0.0)
    lt, tt = no_regress(locked, "maxLockedTestRegression"), no_regress(temporal, "maxTemporalTestRegression")
    out["locked-test-no-regression"] = bool(lt) if lt is not None else False
    out["temporal-test-no-regression"] = bool(tt) if tt is not None else False
    s = split_manifest["splits"]
    out["minTrainGroups"] = s["train"]["groups"] >= P["minTrainGroups"]
    out["minValGroups"] = s["val"]["groups"] >= P["minValGroups"]
    out["minLockedTestGroups"] = s["locked_test"]["groups"] >= P["minLockedTestGroups"]
    out["minTrainWindows"] = s["train"]["windows"] >= P["minTrainWindows"]
    gain = 1 - val_eval["medianPx"] / max(1e-9, base_eval["medianPx"]) if val_eval.get("n") and base_eval.get("n") else -1
    out["val-gain"] = gain >= P["minRelativeGainMedian"]
    out["p95"] = bool(val_eval.get("n")) and val_eval["p95Px"] <= base_eval["p95Px"] * P["maxP95Ratio"]
    out["coverage"] = bool(val_eval.get("n")) and (base_eval["windows"] - val_eval["windows"]) / max(1, base_eval["windows"]) * 100 <= P["maxCoverageDropPp"]
    out["bootstrap"] = bool(bootstrap) and bootstrap.get("ci95", [-1])[0] >= P["bootstrapGainCiLowerAtLeast"]
    out["parity"] = bool(parity and parity.get("ok"))
    out["size"] = onnx_bytes <= P["maxOnnxBytes"] and params <= P["maxParams"]
    for k in ("integrity", "label-provenance", "time-alignment", "split-disjoint", "withdrawal", "allowlist", "schema"):
        out[k] = bool(checks.get(k))
    out["chosenIsLearned"] = chosen != "baseline-engine"
    out["subject-link"] = bool(checks.get("subject-link"))   # informational: decides shadow-only, not pass/fail
    required = P["requiredChecks"] + ["minTrainGroups", "minValGroups", "minLockedTestGroups", "minTrainWindows", "bootstrap", "chosenIsLearned"]
    failed = [k for k in required if not out.get(k)]
    return {"policyVersion": policy["version"], "checks": out, "failed": failed, "pass": not failed, "valGain": gain}


def build_manifest(*, model_id: str, version: str, onnx_path: Path, pre: dict, contract: str, test_vectors: list[dict], core_versions: list[str], snapshot_hash: str, split_hash: str, policy: dict, opset: int, metrics: dict, limitations: list[str], parent: str | None, kind: str = "gaze-residual") -> dict:
    sha = file_sha256(onnx_path)
    dim = len(pre["features"]) * (2 if pre.get("mask") else 1)
    man = {"schema": SCH.MANIFEST_SCHEMA, "kind": kind, "id": model_id, "version": version, "parent": parent, "createdAt": datetime.now(timezone.utc).isoformat(), "sha256": sha, "bytes": onnx_path.stat().st_size, "contract": contract,
           "features": pre["features"], "preprocessing": {"version": pre.get("version", "gaze-pp-1"), "mean": pre["mean"], "std": pre["std"], "mask": bool(pre.get("mask", True)), "clip": pre.get("clip", 6.0), "missing": "0 after standardisation + mask bit"},
           "input": {"name": "x", "shape": [1, dim], "dtype": "float32"}, "output": {"name": "delta", "shape": [1, 2], "dtype": "float32", "units": "viewport-fraction", "apply": "g_corrected = g_base + delta * (viewportW, viewportH); then existing drift subtraction"},
           "opset": opset, "runtime": {"export": "torch.onnx / onnx helper", "browser": "onnxruntime-web (wasm default)"}, "supports": {"core": core_versions, "labelsVersion": "gaze-label-1", "eyeModes": ["both", "left", "right", "weighted"], "browsers": ["chromium-desktop (tested)", "others: unverified"], "maxOpset": 17},
           "guard": policy["gaze_residual"]["guard"], "tolerance": policy["gaze_residual"]["parityTolerance"], "testVectors": test_vectors, "training": {"commit": git_head(), "exporterCommit": git_head(), "datasetSnapshot": snapshot_hash, "splitManifest": split_hash, "environment": environment(), "policyVersion": policy["version"]},
           "evaluation": metrics, "limitations": limitations, "release": {"state": "candidate", "approvedBy": None, "approvedAt": None, "previousActive": None, "rollbackTo": "baseline-engine"},
           "signing": {"status": "unsigned", "note": "SHA-256 verifies transport integrity only; no signing key exists in this project — document the trusted deployment path or add an approved signing step before active use"}}
    man["packageSha256"] = digest({k: v for k, v in man.items() if k != "packageSha256"})
    return man


def model_card(man: dict, run: dict) -> str:
    ev = man.get("evaluation", {})
    lines = [f"# Model card · {man['id']} v{man['version']}", "", f"- 종류: {man['kind']} · 계약: `{man['contract']}` · 출력 단위: {man['output']['units']}", f"- SHA-256: `{man['sha256']}` · 크기 {man['bytes']} bytes · opset {man['opset']}",
             f"- 학습 commit: `{man['training']['commit']}` · 데이터셋 snapshot: `{man['training']['datasetSnapshot']}` · split: `{man['training']['splitManifest']}`", f"- 상태: **{man['release']['state']}** (trained ≠ active · 승인 전)", "",
             "## 평가 (표적 proxy 오차 · 외부 시선 추적기 정확도가 아님)", "```json", json.dumps(ev, ensure_ascii=False, indent=2)[:4000], "```", "", "## 한계", *[f"- {l}" for l in man.get("limitations", [])], "",
             "## 지원 범위", f"- core: {man['supports']['core']} · 브라우저: {man['supports']['browsers']}", "", f"_정책 {man['training']['policyVersion']} · 생성 {man['createdAt']}_"]
    return "\n".join(lines) + "\n"


def registry_patch(registry_path: Path, man: dict, report_path: str, run_status: str) -> dict:
    reg = load_json(registry_path) if registry_path.exists() else {"schema": SCH.REGISTRY_SCHEMA, "active": None, "shadow": None, "candidates": [], "history": []}
    rel = man.get("release") or {}
    entry = {"id": man["id"], "kind": man["kind"], "version": man["version"], "url": f"models/gaze/{man['id']}/model.onnx", "manifestUrl": f"models/gaze/{man['id']}/manifest.json", "sha256": man["sha256"], "state": rel.get("state", "candidate"), "maxState": rel.get("maxState", "active"), "createdAt": man["createdAt"], "report": report_path, "approvedBy": (rel.get("exception") or {}).get("approver"), "exception": rel.get("exception")}
    reg["candidates"] = [c for c in reg.get("candidates", []) if c.get("id") != man["id"]] + [entry]
    reg.setdefault("history", []).append({"at": man["createdAt"], "event": "candidate-registered", "id": man["id"], "state": run_status, "actor": "nlcolab", "note": "active/shadow unchanged; promotion requires human approval + shadow + canary"})
    reg["updatedAt"] = man["createdAt"]
    return reg


def write_candidate(out_dir: Path, man: dict, onnx_src: Path, card: str, registry_path: Path | None, report_path: str, run_status: str) -> dict:
    dest = out_dir / "models" / "gaze" / man["id"]
    dest.mkdir(parents=True, exist_ok=True)
    data = onnx_src.read_bytes()
    (dest / "model.onnx").write_bytes(data)
    dump_json(dest / "manifest.json", man)
    (dest / "MODEL_CARD.md").write_text(card, encoding="utf-8")
    patch = registry_patch(registry_path, man, report_path, run_status) if registry_path else None
    if patch is not None:
        dump_json(out_dir / "model-registry.candidate.json", patch)
    return {"dir": str(dest), "sha256": man["sha256"], "registryPatch": str(out_dir / "model-registry.candidate.json") if patch else None, "note": "copy models/gaze/<id>/ and the registry patch into the repo in a reviewed commit; this step does not deploy or activate"}
