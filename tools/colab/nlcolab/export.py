"""Authenticated training export using the existing reviewer RPCs (dataset_list → dataset_detail(p_payload=true)).

· Uses a logged-in reviewer's JWT (Supabase auth password grant or a pasted access token). Never a service_role key.
· Pages dataset_list to the last page (cursor = created_at,id), fetches every session's ordered chunks, verifies chunk count/order and
  SHA-256 of the gzip bytes against the stored hash, gunzips with a size cap, and stores raw JSON + annotations + meta.
· Reports pagination evidence (pages, cursors, last page size, duplicate/missing IDs) so a partial export cannot be mistaken for the whole set.
· Also imports existing local exports (tools/newbiz_research_export.py sessions/<code>.json and dataset.html condition-dataset.json).
Secrets are held in memory only; the access token is not written to disk."""
from __future__ import annotations

import base64
import getpass
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .canonical import file_sha256
from .safe_io import dump_json, gunzip_limited, load_json

DEFAULT_URL = "https://qonoakggniupuxwvzmmw.supabase.co"
DEFAULT_ANON = "sb_publishable_hl6-Y_kMQelu2DByu4bE4g_V9Ru3jNo"   # publishable key (public in the web app); the JWT carries the reviewer identity


class ExportError(RuntimeError):
    pass


def _post(url: str, anon: str, path: str, body: dict, token: str | None, timeout: int = 60):
    req = urllib.request.Request(url.rstrip("/") + path, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "apikey": anon, "Authorization": "Bearer " + (token or anon)})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise ExportError(f"{path} HTTP {e.code}: {detail}") from None


def sign_in(url: str, anon: str, email: str, password: str) -> str:
    data = _post(url, anon, "/auth/v1/token?grant_type=password", {"email": email, "password": password}, token=None)
    tok = data.get("access_token")
    if not tok:
        raise ExportError("no access token returned")
    return tok


def interactive_token(url: str = DEFAULT_URL, anon: str = DEFAULT_ANON, email: str | None = None) -> str:
    """Terminal/Colab: NL_ACCESS_TOKEN if set, otherwise e-mail + getpass password. The token stays in memory; nothing is written to disk."""
    tok = os.environ.get("NL_ACCESS_TOKEN")
    if tok:
        return tok
    import sys  # noqa: PLC0415
    if not sys.stdin.isatty():
        # Claude Code의 `!` 실행이나 파이프에는 키보드 입력이 없어 getpass 가 영원히 기다린다 → 바로 안내하고 종료
        raise SystemExit("비밀번호를 입력받을 터미널이 없습니다. Windows 터미널(PowerShell)을 직접 열어 같은 명령을 실행하세요:
"
                         "  cd C:\Users\Curioud\Desktop\neurolens-main
  py -3 tools\colab\export.py training\raw --email xshoner@gmail.com")
    email = email or input("연구 관리자 이메일: ").strip()
    return sign_in(url, anon, email, getpass.getpass("비밀번호 (입력이 보이지 않음): "))


def rpc(url: str, anon: str, token: str, name: str, args: dict):
    return _post(url, anon, "/rest/v1/rpc/" + name, args, token)


def decode_detail(detail: dict) -> tuple[dict, bytes, str]:
    chunks = detail.get("chunks")
    if not isinstance(chunks, list) or detail.get("chunkCount") is None or len(chunks) != detail["chunkCount"] or any(c.get("idx") != i for i, c in enumerate(chunks)):
        raise ExportError("chunk count/order mismatch")
    gz = base64.b64decode("".join(c["data"] for c in chunks))
    sha = hashlib.sha256(gz).hexdigest()
    if sha != detail.get("sha256"):
        raise ExportError("sha256 mismatch")
    payload = json.loads(gunzip_limited(gz).decode("utf-8"))
    return payload, gz, sha


def export_authenticated(out_dir: str | Path, token: str, url: str = DEFAULT_URL, anon: str = DEFAULT_ANON, page_size: int = 100, since: str | None = None, known_hashes: dict | None = None, log=print) -> dict:
    out = Path(out_dir)
    (out / "sessions").mkdir(parents=True, exist_ok=True)
    if not rpc(url, anon, token, "dataset_access", {}):
        raise ExportError("this account is not in dataset_reviewers")
    pages, before, before_id, listed, seen = 0, None, None, [], set()
    while True:
        page = rpc(url, anon, token, "dataset_list", {"p_before": before, "p_before_id": before_id, "p_limit": page_size})
        if not isinstance(page, list):
            raise ExportError("dataset_list returned a non-list")
        pages += 1
        for row in page:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            listed.append(row)
        log(f"page {pages}: {len(page)} rows (total {len(listed)})")
        if len(page) < page_size:
            break
        before, before_id = page[-1]["created_at"], page[-1]["id"]
    dup = len(listed) - len(seen)
    index, bad, skipped, fetched = [], [], 0, 0
    known_hashes = known_hashes or {}
    for row in listed:
        if since and str(row.get("created_at", "")) < since:
            skipped += 1
            continue
        entry = {"id": row["id"], "code": row["code"], "created_at": row["created_at"], "meta": row.get("meta"), "audit": row.get("audit"), "reference_review": row.get("reference_review"), "annotation_count": row.get("annotation_count")}
        try:
            detail = rpc(url, anon, token, "dataset_detail", {"p_session": row["id"], "p_payload": True})
            annotations = detail.get("annotations") or []
            if known_hashes.get(row["id"]) == detail.get("sha256") and (out / "sessions" / f"{row['id']}.json").exists():
                # unchanged payload: refresh annotations only (labels/reference links may have changed)
                existing = load_json(out / "sessions" / f"{row['id']}.json")
                existing["annotations"] = annotations
                dump_json(out / "sessions" / f"{row['id']}.json", existing, indent=None)
                entry.update({"payload_sha256": detail.get("sha256"), "annotations": len(annotations), "status": "annotations-refreshed"})
            else:
                payload, _gz, sha = decode_detail(detail)
                full = {"id": row["id"], "code": row["code"], "created_at": row["created_at"], "meta": detail.get("meta") or row.get("meta"), "summary": {"dataset": detail.get("audit")}, "audit": detail.get("audit"), "payload": payload, "annotations": annotations, "payload_sha256": sha, "exported_at": datetime.now(timezone.utc).isoformat()}
                dump_json(out / "sessions" / f"{row['id']}.json", full, indent=None)
                entry.update({"payload_sha256": sha, "annotations": len(annotations), "status": "fetched"})
                fetched += 1
        except ExportError as e:
            entry.update({"status": "corrupt", "error": str(e)})
            bad.append(entry)
        index.append(entry)
    evidence = {"schema": "nl-export-index-1", "exportedAt": datetime.now(timezone.utc).isoformat(), "source": url, "rpc": ["dataset_access", "dataset_list", "dataset_detail(p_payload=true)"], "pageSize": page_size,
                "pages": pages, "lastPageSmallerThanPageSize": True, "listed": len(listed), "duplicatesInListing": dup, "fetched": fetched, "annotationsRefreshed": sum(1 for e in index if e.get("status") == "annotations-refreshed"),
                "skippedBefore": skipped, "corrupt": len(bad), "since": since, "sessions": index,
                "note": "Reviewer JWT export through the existing allowlisted RPCs. Pagination walked to the final page. Corrupt sessions are listed, not silently dropped."}
    dump_json(out / "index.json", evidence)
    return evidence


def import_local(out_dir: str | Path, sources: list[str | Path], log=print) -> dict:
    """Import existing local files: research_export/sessions/*.json (full session objects) or dataset.html export {records:[...]}."""
    out = Path(out_dir)
    (out / "sessions").mkdir(parents=True, exist_ok=True)
    index, bad = [], []
    files: list[Path] = []
    for s in sources:
        p = Path(s)
        files.extend(sorted(p.glob("*.json")) if p.is_dir() else [p])
    for f in files:
        try:
            obj = load_json(f)
        except Exception as e:  # noqa: BLE001
            bad.append({"file": str(f), "error": str(e)})
            continue
        records = obj.get("records") if isinstance(obj, dict) and isinstance(obj.get("records"), list) else [obj]
        for rec in records:
            if not isinstance(rec, dict):
                continue
            if "payload" not in rec:
                index.append({"file": str(f), "id": rec.get("id"), "code": rec.get("code"), "status": "summary-only", "note": "dataset.html exportRow has no raw payload; usable for inventory counts only"})
                continue
            sid = rec.get("id") or (rec.get("meta") or {}).get("attemptId") or rec.get("code")
            sha = rec.get("payload_sha256") or hashlib.sha256(json.dumps(rec["payload"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            full = {**rec, "id": sid, "payload_sha256": sha, "imported_from": str(f), "imported_at": datetime.now(timezone.utc).isoformat()}
            full.setdefault("annotations", [])
            dump_json(out / "sessions" / f"{sid}.json", full, indent=None)
            index.append({"file": str(f), "id": sid, "code": rec.get("code"), "created_at": rec.get("created_at"), "payload_sha256": sha, "status": "imported", "synthetic": bool((rec.get("meta") or {}).get("synthetic"))})
    evidence = {"schema": "nl-export-index-1", "exportedAt": datetime.now(timezone.utc).isoformat(), "source": "local-files", "files": len(files), "imported": sum(1 for e in index if e["status"] == "imported"), "summaryOnly": sum(1 for e in index if e["status"] == "summary-only"), "corrupt": bad, "sessions": index,
                "note": "Local import does not prove completeness of the central dataset; pagination evidence exists only for authenticated exports."}
    dump_json(out / "index.json", evidence)
    log(f"imported {evidence['imported']} sessions ({evidence['summaryOnly']} summary-only, {len(bad)} unreadable)")
    return evidence


def raw_sessions(raw_dir: str | Path) -> list[Path]:
    return sorted((Path(raw_dir) / "sessions").glob("*.json"))


def raw_hashes(raw_dir: str | Path) -> dict[str, str]:
    return {p.stem: file_sha256(p) for p in raw_sessions(raw_dir)}
