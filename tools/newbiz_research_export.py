# -*- coding: utf-8 -*-
"""NewBiz 연구 데이터 내려받기 (연구자 전용, 로컬에서 실행) — service_role 경로 (관리자 전용).

    set SUPABASE_URL=https://qonoakggniupuxwvzmmw.supabase.co
    set SUPABASE_SERVICE_ROLE_KEY=...        # Supabase 대시보드 → Settings → API → service_role (절대 커밋·배포 금지)
    python tools/newbiz_research_export.py --out research_export [--since 2026-10-01] [--npz] [--page-size 500]

출력:
  research_export/sessions.csv           세션당 1행: 메타·체크인·영역 점수·지표 값·QC (표 분석용 요약 — 학습용 원자료가 아님)
  research_export/sessions/<code>.json   세션별 전체: id · meta + summary + payload(복원된 시계열) + annotations(기준 CSV·검토 이력)
  research_export/frames/<code>.npz      (--npz, numpy 필요) frames + calibrationFrames + landmarks 를 실수 배열로 복원
  research_export/export_index.json      페이지 수·마지막 페이지 크기·중복/불일치 세션 — 전체 범위를 읽었다는 근거
무결성: 조각을 이어 붙인 gzip 의 sha256 을 업로드 시 기록값과 대조한다. 불일치 세션은 건너뛰고 보고한다.
페이지네이션: PostgREST 는 기본 1,000행 상한이 있으므로 Range 헤더로 끝까지 읽는다(마지막 페이지가 page-size 보다 작을 때 종료).
권장: 학습용 내보내기는 service_role 대신 연구 관리자 JWT 를 쓰는 `python -m nlcolab export` (tools/colab) 를 사용한다.
"""
import argparse
import base64
import csv
import gzip
import hashlib
import json
import os
import pathlib
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

FRAME_SCALE = {"ok": 1, "r": 100, "g": 100, "b": 100, "lum": 10, "cx": 1e4, "cy": 1e4, "fw": 1e4, "open": 1e4, "blink": 1e3, "lookV": 1e3,
               "frown": 1e3, "smile": 1e3, "u": 1e4, "v": 1e4, "yaw": 1e4, "pitch": 1e4, "lag": 1,
               "faceOk": 1, "eyeOk": 1, "skinOk": 1, "ppgOk": 1, "gazeOk": 1, "skinQ": 1e3, "eyeQ": 1e3,
               "qLeft": 1e3, "qRight": 1e3, "uLeft": 1e4, "vLeft": 1e4, "uRight": 1e4, "vRight": 1e4,
               "roiAge": 1, "exposureGain": 100}


def decode_frames(frames):
    """Decode both schemas; missing ROI components retain their positions as NaN."""
    scales = frames.get("scale", FRAME_SCALE)
    value = lambda v, scale: float("nan") if v is None else v / scale
    arrs = {k: [value(v, scale) for v in frames[k]]
            for k, scale in scales.items() if k in frames and k not in ("rr", "rq")}
    arrs["t_ms"] = frames["t"]
    arrs["rr"] = [[value(v, 100) for v in ([None] * 9 if row is None else row)] for row in frames["rr"]]
    if "rq" in frames:
        arrs["rq"] = [[value(v, 1e3) for v in ([None] * 3 if row is None else row)] for row in frames["rq"]]
    for key in ("source", "reason", "clockSource"):
        if key in frames:
            arrs[key] = [v or "" for v in frames[key]]
    return arrs


def rest(url, key, path, params, rng=None):
    q = urllib.parse.urlencode(params)
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    if rng is not None:
        headers["Range-Unit"] = "items"
        headers["Range"] = f"{rng[0]}-{rng[1]}"
    req = urllib.request.Request(f"{url}/rest/v1/{path}?{q}", headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def paged(fetch, page_size):
    """Read every page with Range headers; returns (rows, evidence). `fetch(rng)` returns one page."""
    rows, pages, start = [], 0, 0
    while True:
        page = fetch((start, start + page_size - 1))
        pages += 1
        rows.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    ids = [r.get("id") for r in rows]
    return rows, {"pages": pages, "pageSize": page_size, "rows": len(rows), "lastPageRows": len(page), "duplicates": len(ids) - len(set(ids)), "complete": len(page) < page_size}


def frames_to_npz(payload):
    import numpy as np  # noqa: PLC0415
    out = {}

    def pack(prefix, F):
        if not F or not F.get("t"):
            return
        arrs = {k: np.array(v, dtype=str if k in ("source", "reason", "clockSource") else np.int64 if k == "t_ms" else np.float32) for k, v in decode_frames(F).items()}
        arrs["rr"] = arrs["rr"].reshape(-1, 9)
        if "rq" in arrs:
            arrs["rq"] = arrs["rq"].reshape(-1, 3)
        for k, v in arrs.items():
            out[f"{prefix}{k}"] = v
        out[f"{prefix}t0"] = np.array([F.get("t0", 0)], dtype=np.float64)
    pack("", payload["frames"])
    cf = (payload.get("telemetry") or {}).get("calibrationFrames")
    if cf:
        pack("cal_", cf)
    L = payload.get("landmarks")
    if L and L.get("rows"):
        out["lm_t_ms"] = np.array([r[0] for r in L["rows"]], dtype=np.int64)
        out["lm_xy"] = np.array([r[1:] for r in L["rows"]], dtype=np.float32).reshape(len(L["rows"]), -1, 2) / L["scale"]
        out["lm_idx"] = np.array(L["idx"], dtype=np.int32)
    out["payload_t0"] = np.array([payload.get("t0", 0)], dtype=np.float64)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="research_export")
    ap.add_argument("--since", default=None, help="YYYY-MM-DD (created_at 이후)")
    ap.add_argument("--npz", action="store_true")
    ap.add_argument("--page-size", type=int, default=500)
    a = ap.parse_args()
    url, key = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.")
    out = pathlib.Path(a.out)
    (out / "sessions").mkdir(parents=True, exist_ok=True)
    params = {"select": "id,code,created_at,completed_at,consent,meta,summary,chunk_count,payload_bytes,payload_sha256", "status": "eq.complete", "order": "created_at.asc,id.asc"}
    if a.since:
        params["created_at"] = f"gte.{a.since}"
    sessions, evidence = paged(lambda rng: rest(url, key, "newbiz_research_sessions", params, rng), a.page_size)
    rows, bad = [], []
    for s in sessions:
        chunks, _ = paged(lambda rng: rest(url, key, "newbiz_research_chunks", {"select": "idx,data", "session_id": f"eq.{s['id']}", "order": "idx.asc"}, rng), 64)
        if len(chunks) != s["chunk_count"] or any(c["idx"] != i for i, c in enumerate(chunks)):
            bad.append((s["code"], "조각 수/순서 불일치")); continue
        gz = base64.b64decode("".join(c["data"] for c in chunks))
        if hashlib.sha256(gz).hexdigest() != s["payload_sha256"]:
            bad.append((s["code"], "sha256 불일치")); continue
        payload = json.loads(gzip.decompress(gz).decode("utf-8"))
        annotations, _ = paged(lambda rng: rest(url, key, "dataset_annotations", {"select": "id,created_at,kind,body", "session_id": f"eq.{s['id']}", "order": "created_at.asc"}, rng), 200)
        full = {"id": s["id"], "code": s["code"], "created_at": s["created_at"], "consent": s["consent"], "meta": s["meta"], "summary": s["summary"], "payload": payload, "annotations": annotations, "payload_sha256": s["payload_sha256"]}
        (out / "sessions" / f"{s['code']}.json").write_text(json.dumps(full, ensure_ascii=False), encoding="utf-8")
        if a.npz:
            import numpy as np  # noqa: PLC0415
            (out / "frames").mkdir(exist_ok=True)
            np.savez_compressed(out / "frames" / f"{s['code']}.npz", **frames_to_npz(payload))
        sm, mt = s["summary"], s["meta"]
        row = {"code": s["code"], "created_at": s["created_at"], "mode": mt.get("mode"), "session_kind": mt.get("sessionKind", "condition"), "fps": mt.get("fps"), "browser": (mt.get("client") or {}).get("browser"),
               "os": (mt.get("client") or {}).get("os"), "local_hour": mt.get("localHour"), "core": (mt.get("versions") or {}).get("core"), "battery": (mt.get("versions") or {}).get("battery"),
               "type": (sm.get("integrated") or {}).get("code"), "qc_grade": (sm.get("qc") or {}).get("grade"), "calib_err": (sm.get("calibration") or {}).get("errPct"), "gaze_labels_valid": ((sm.get("gazeLabels") or {}).get("valid")), "annotations": len(annotations)}
        for k, v in (sm.get("checkin") or {}).items():
            if k != "phq":
                row[f"checkin_{k}"] = v
        for k, d in (sm.get("domains") or {}).items():
            row[f"dom_{k}"] = d.get("score"); row[f"dom_{k}_conf"] = d.get("confidence")
        for i in sm.get("indicators") or []:
            row[f"ind_{i['key']}"] = i.get("value"); row[f"ind_{i['key']}_r"] = i.get("r")
        if sm.get("phq"):
            row["phq2"], row["phq8"] = sm["phq"].get("phq2"), sm["phq"].get("phq8")
        rows.append(row)
    cols = sorted({k for r in rows for k in r}, key=lambda c: (c not in ("code", "created_at"), c))
    with open(out / "sessions.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
    (out / "export_index.json").write_text(json.dumps({"exportedAt": datetime.now(timezone.utc).isoformat(), "sessions": evidence, "written": len(rows), "skipped": bad, "note": "sessions.csv is a summary; sessions/*.json hold the raw payload + annotations. Pagination walked to the last page (complete=true)."}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"완료 {len(rows)}건 → {out} · 페이지 {evidence['pages']} (마지막 {evidence['lastPageRows']}행, 중복 {evidence['duplicates']})" + (f" · 건너뜀 {len(bad)}건: {bad}" if bad else ""))


if __name__ == "__main__":
    main()
