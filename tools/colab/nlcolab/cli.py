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
    p = sub.add_parser("login"); p.add_argument("email", nargs="?")
    p = sub.add_parser("export"); p.add_argument("raw_dir"); p.add_argument("--since", default=None); p.add_argument("--url", default=DEFAULT_URL); p.add_argument("--anon", default=DEFAULT_ANON); p.add_argument("--session-file", default=None, help="training/.session.json from `nlcolab login`"); p.add_argument("--keep-session", action="store_true")
    p = sub.add_parser("import"); p.add_argument("raw_dir"); p.add_argument("sources", nargs="+")
    for name in ("audit", "snapshot", "train-gaze", "train-rppg", "run"):
        p = sub.add_parser(name); p.add_argument("raw_dir"); p.add_argument("work_dir"); p.add_argument("--allow-synthetic", action="store_true"); p.add_argument("--no-mlp", action="store_true"); p.add_argument("--no-resume", action="store_true"); p.add_argument("--seed", type=int, default=20261008)
    p = sub.add_parser("status"); p.add_argument("work_dir")
    a = ap.parse_args(argv)
    if a.cmd == "fixtures":
        out = subprocess.check_output(["node", str(HERE / "fixtures.cjs"), a.out, f"--sessions={a.sessions}", f"--seed={a.seed}", f"--legacy={a.legacy}"], text=True, encoding="utf-8")
        print(out.strip())
        return 0
    if a.cmd == "login":
        from .login import main as login_main  # noqa: PLC0415
        return login_main([a.email] if a.email else [])
    if a.cmd == "export":
        session_path = Path(a.session_file) if a.session_file else None
        if session_path:
            from .login import load_session  # noqa: PLC0415
            token = load_session(session_path, a.url, a.anon)
        else:
            token = interactive_token(a.url, a.anon)
        known = {}
        idx = Path(a.raw_dir) / "index.json"
        if idx.exists():
            known = {s["id"]: s.get("payload_sha256") for s in load_json(idx).get("sessions", []) if s.get("payload_sha256")}
        try:
            ev = export_authenticated(a.raw_dir, token, a.url, a.anon, since=a.since, known_hashes=known)
        finally:
            del token
            if session_path and not a.keep_session and session_path.exists():
                session_path.unlink()
                print("세션 파일 삭제됨")
        print(json.dumps({k: v for k, v in ev.items() if k != "sessions"}, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "import":
        ev = import_local(a.raw_dir, a.sources)
        print(json.dumps({k: v for k, v in ev.items() if k != "sessions"}, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "status":
        st = Path(a.work_dir) / "state.json"
        print(json.dumps(load_json(st) if st.exists() else {"status": "no-run"}, ensure_ascii=False, indent=2))
        return 0
    from .pipeline import Pipeline  # noqa: PLC0415  (numpy/torch only needed from here on; login/export/import run on plain Python)
    pl = Pipeline(a.raw_dir, a.work_dir, allow_synthetic=a.allow_synthetic, use_mlp=not a.no_mlp, seed=a.seed)
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
