"""CLI: python -m nlcolab <command> … (Colab notebooks call these commands; everything is re-runnable from a terminal).

commands
  fixtures  <out> [--sessions N --seed S --legacy L]   synthetic sessions via node tools/colab/fixtures.cjs (tests only)
  export    <raw_dir> [--since YYYY-MM-DD]              authenticated reviewer export (JWT prompt; token from NL_ACCESS_TOKEN if set)
  import    <raw_dir> <files/dirs…>                     import local research_export sessions / dataset.html exports
  audit     <raw_dir> <work_dir>                        inventory + eligibility report
  snapshot  <raw_dir> <work_dir>                        immutable snapshot + change detection
  train-gaze <raw_dir> <work_dir> [--allow-synthetic --no-mlp]
  train-rppg <raw_dir> <work_dir> [--allow-synthetic]
  run       <raw_dir> <work_dir> [--allow-synthetic --no-mlp --no-resume]   whole batch with checkpoints
  status    <work_dir>"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .export import DEFAULT_ANON, DEFAULT_URL, export_authenticated, import_local, interactive_token, raw_hashes  # stdlib only
from .safe_io import load_json

HERE = Path(__file__).resolve().parents[1]


def main(argv=None):
    ap = argparse.ArgumentParser(prog="nlcolab")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("fixtures"); p.add_argument("out"); p.add_argument("--sessions", type=int, default=6); p.add_argument("--seed", type=int, default=1); p.add_argument("--legacy", type=int, default=2)
    p = sub.add_parser("export"); p.add_argument("raw_dir"); p.add_argument("--since", default=None); p.add_argument("--url", default=DEFAULT_URL); p.add_argument("--anon", default=DEFAULT_ANON); p.add_argument("--email", default=None, help="reviewer e-mail (password is asked with getpass; nothing is stored)")
    p = sub.add_parser("import"); p.add_argument("raw_dir"); p.add_argument("sources", nargs="+")
    for name in ("audit", "snapshot", "train-gaze", "train-rppg", "run"):
        p = sub.add_parser(name); p.add_argument("raw_dir"); p.add_argument("work_dir"); p.add_argument("--allow-synthetic", action="store_true"); p.add_argument("--no-mlp", action="store_true"); p.add_argument("--no-resume", action="store_true"); p.add_argument("--seed", type=int, default=20261008)
        p.add_argument("--exception-model", default=None, help="human-approved policy exception: package this model for SHADOW only even if the gate fails"); p.add_argument("--exception-approver", default=None); p.add_argument("--exception-reason", default=None)
    p = sub.add_parser("status"); p.add_argument("work_dir")
    p = sub.add_parser("publish-ledger"); p.add_argument("work_dir"); p.add_argument("--ledger", default=None, help="repo training-ledger.json (default: <repo>/training-ledger.json)")
    a = ap.parse_args(argv)
    if a.cmd == "fixtures":
        out = subprocess.check_output(["node", str(HERE / "fixtures.cjs"), a.out, f"--sessions={a.sessions}", f"--seed={a.seed}", f"--legacy={a.legacy}"], text=True, encoding="utf-8")
        print(out.strip())
        return 0
    if a.cmd == "export":
        # Credentials live only in this process: password via getpass, access token in memory, nothing written to disk.
        token = interactive_token(a.url, a.anon, email=a.email)
        known = {}
        idx = Path(a.raw_dir) / "index.json"
        if idx.exists():
            known = {s["id"]: s.get("payload_sha256") for s in load_json(idx).get("sessions", []) if s.get("payload_sha256")}
        try:
            ev = export_authenticated(a.raw_dir, token, a.url, a.anon, since=a.since, known_hashes=known)
        finally:
            del token
        print(json.dumps({k: v for k, v in ev.items() if k != "sessions"}, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "import":
        ev = import_local(a.raw_dir, a.sources)
        print(json.dumps({k: v for k, v in ev.items() if k != "sessions"}, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "publish-ledger":
        from .ledger import build_entry, publish  # noqa: PLC0415
        work = Path(a.work_dir)
        state = load_json(work / "state.json")
        entry = build_entry(work, state)
        ledger_path = Path(a.ledger) if a.ledger else HERE.parents[1] / "training-ledger.json"
        led = publish(entry, ledger_path)
        print(json.dumps({"ledger": str(ledger_path), "runs": len(led["runs"]), "latest": {k: entry[k] for k in ("runId", "at", "status")}, "gaze": (entry.get("gaze") or {}).get("status"), "rppg": (entry.get("rppg") or {}).get("status")}, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "status":
        st = Path(a.work_dir) / "state.json"
        print(json.dumps(load_json(st) if st.exists() else {"status": "no-run"}, ensure_ascii=False, indent=2))
        return 0
    from .pipeline import Pipeline  # noqa: PLC0415  (numpy/torch only needed from here on; login/export/import run on plain Python)
    exc = {"model": a.exception_model, "approver": a.exception_approver, "reason": a.exception_reason} if getattr(a, "exception_model", None) else None
    if exc and not (exc["approver"] and exc["reason"]):
        ap.error("--exception-model requires --exception-approver and --exception-reason")
    pl = Pipeline(a.raw_dir, a.work_dir, allow_synthetic=a.allow_synthetic, use_mlp=not a.no_mlp, seed=a.seed, package_exception=exc)
    if a.cmd == "audit":
        pl.audit()
    elif a.cmd == "snapshot":
        pl.snapshot()
    elif a.cmd == "train-gaze":
        pl.gaze()
    elif a.cmd == "train-rppg":
        pl.rppg()
    elif a.cmd == "run":
        pl.run(resume=not a.no_resume)
    print(json.dumps(pl.state["stages"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
