# -*- coding: utf-8 -*-
"""NewBiz 연구 데이터 내려받기 (연구자 전용, 로컬에서 실행).

    set SUPABASE_URL=https://qonoakggniupuxwvzmmw.supabase.co
    set SUPABASE_SERVICE_ROLE_KEY=...        # Supabase 대시보드 → Settings → API → service_role (절대 커밋·배포 금지)
    python tools/newbiz_research_export.py --out research_export [--since 2026-10-01] [--npz]

출력:
  research_export/sessions.csv           세션당 1행: 메타·체크인·영역 점수·지표 값·QC (표 분석용)
  research_export/sessions/<code>.json   세션별 전체: meta + summary + payload(복원된 시계열)
  research_export/frames/<code>.npz      (--npz, numpy 필요) 프레임 시계열을 실수 배열로 복원 — 딥러닝 입력용
무결성: 조각을 이어 붙인 gzip 의 sha256 을 업로드 시 기록값과 대조한다. 불일치 세션은 건너뛰고 보고한다.
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

FRAME_SCALE = {"ok": 1, "r": 100, "g": 100, "b": 100, "lum": 10, "cx": 1e4, "cy": 1e4, "fw": 1e4, "open": 1e4, "blink": 1e3,
               "frown": 1e3, "smile": 1e3, "u": 1e4, "v": 1e4, "yaw": 1e4, "pitch": 1e4, "lag": 1}


def rest(url, key, path, params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}/rest/v1/{path}?{q}", headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="research_export")
    ap.add_argument("--since", default=None, help="YYYY-MM-DD (created_at 이후)")
    ap.add_argument("--npz", action="store_true")
    a = ap.parse_args()
    url, key = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.")
    out = pathlib.Path(a.out)
    (out / "sessions").mkdir(parents=True, exist_ok=True)
    params = {"select": "id,code,created_at,completed_at,consent,meta,summary,chunk_count,payload_bytes,payload_sha256", "status": "eq.complete", "order": "created_at.asc"}
    if a.since:
        params["created_at"] = f"gte.{a.since}"
    sessions = rest(url, key, "newbiz_research_sessions", params)
    rows, bad = [], []
    for s in sessions:
        chunks = rest(url, key, "newbiz_research_chunks", {"select": "idx,data", "session_id": f"eq.{s['id']}", "order": "idx.asc"})
        if len(chunks) != s["chunk_count"]:
            bad.append((s["code"], "조각 수 불일치")); continue
        gz = base64.b64decode("".join(c["data"] for c in chunks))
        if hashlib.sha256(gz).hexdigest() != s["payload_sha256"]:
            bad.append((s["code"], "sha256 불일치")); continue
        payload = json.loads(gzip.decompress(gz).decode("utf-8"))
        full = {"code": s["code"], "created_at": s["created_at"], "consent": s["consent"], "meta": s["meta"], "summary": s["summary"], "payload": payload}
        (out / "sessions" / f"{s['code']}.json").write_text(json.dumps(full, ensure_ascii=False), encoding="utf-8")
        if a.npz:
            import numpy as np  # noqa: PLC0415
            (out / "frames").mkdir(exist_ok=True)
            F = payload["frames"]
            arrs = {k: np.array([np.nan if v is None else v / FRAME_SCALE[k] for v in F[k]], dtype=np.float32) for k in FRAME_SCALE if k in F}
            arrs["t_ms"] = np.array(F["t"], dtype=np.int64)
            arrs["rr"] = np.array([[np.nan] * 9 if v is None else [x / 100 for x in v] for v in F["rr"]], dtype=np.float32)
            if payload.get("landmarks"):
                L = payload["landmarks"]
                arrs["lm_t_ms"] = np.array([r[0] for r in L["rows"]], dtype=np.int64)
                arrs["lm_xy"] = np.array([r[1:] for r in L["rows"]], dtype=np.float32).reshape(len(L["rows"]), -1, 2) / L["scale"]
                arrs["lm_idx"] = np.array(L["idx"], dtype=np.int32)
            np.savez_compressed(out / "frames" / f"{s['code']}.npz", **arrs)
        sm, mt = s["summary"], s["meta"]
        row = {"code": s["code"], "created_at": s["created_at"], "mode": mt.get("mode"), "fps": mt.get("fps"), "browser": (mt.get("client") or {}).get("browser"),
               "os": (mt.get("client") or {}).get("os"), "local_hour": mt.get("localHour"), "core": (mt.get("versions") or {}).get("core"), "battery": (mt.get("versions") or {}).get("battery"),
               "type": (sm.get("integrated") or {}).get("code"), "qc_grade": (sm.get("qc") or {}).get("grade"), "calib_err": (sm.get("calibration") or {}).get("errPct")}
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
    cols = sorted({k for r in rows for k in r}, key=lambda c: (not c in ("code", "created_at"), c))
    with open(out / "sessions.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
    print(f"완료 {len(rows)}건 → {out}" + (f" · 건너뜀 {len(bad)}건: {bad}" if bad else ""))


if __name__ == "__main__":
    main()
