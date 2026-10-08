"""Data inventory and per-task eligibility with reasons. Every record stays in the inventory; nothing is silently dropped.

Label grades (schema.LABEL_SOURCES): explicit_target_confirmed (v3 gaze-label), calibration_target (train/internal/fine), free_click_weak,
engine_prediction, unlabeled; reference pairing for rPPG is 'paired' only with a verified sync (uncertainty ≤ threshold), else 'exploratory'."""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import schema as SCH
from .adapter import Session, load_session
from .safe_io import load_json

MIN_LABEL_FRAMES = 4


@dataclass
class Eligibility:
    session_id: str
    code: str | None
    created_at: str | None
    schema: str
    core: float | None
    session_kind: str
    synthetic: bool
    consent: bool
    demo: bool
    outcome: str | None
    subject_key: str | None
    subject_link_confidence: str
    frames: int
    calibration_frames: int
    targets: dict
    labels: dict
    reference: dict
    gaze_status: str
    gaze_reasons: list[str] = field(default_factory=list)
    rppg_status: str = "unlabeled-only"
    rppg_reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    payload_sha256: str | None = None
    annotation_ids: list[str] = field(default_factory=list)
    withdrawn: bool = False


def classify(session: Session, sync_threshold_ms: float = 100.0) -> Eligibility:
    meta = session.meta or {}
    consent = bool(((session.summary or {}).get("consent") or {}).get("research", True))
    demo = bool(meta.get("demo"))
    outcome = meta.get("outcome")
    tcount = Counter(t.kind for t in session.targets)
    labels = session.labels or {}
    lab = (labels.get("summary") or {}) if labels else {}
    valid_labels = [l for l in (labels.get("labels") or []) if l.get("status") == "valid" and len(l.get("frameTimes") or []) >= MIN_LABEL_FRAMES]
    label_info = {"present": bool(labels), "valid": len(valid_labels), "train": sum(1 for l in valid_labels if l.get("role") == "train"), "internal": sum(1 for l in valid_labels if l.get("role") == "internal"), "holdout": sum(1 for l in valid_labels if l.get("role") == "holdout"),
                  "holdoutPipelineUnchanged": (labels.get("holdout") or {}).get("pipelineUnchanged") if labels else None, "summary": lab or None}
    ref = session.reference
    ref_info = {"present": bool(ref), "origin": (ref or {}).get("origin"), "source": (ref or {}).get("source"), "verified": bool((ref or {}).get("verified")), "syncUncertaintyMs": ((ref or {}).get("sync") or {}).get("uncertaintyMs"), "samples": len((ref or {}).get("samples") or []), "annotationId": (ref or {}).get("annotationId"),
                "grade": None}
    if ref:
        unc = ref_info["syncUncertaintyMs"]
        ref_info["grade"] = "paired" if (ref_info["verified"] and isinstance(unc, (int, float)) and 0 <= unc <= sync_threshold_ms) else "exploratory"
    e = Eligibility(session_id=session.session_id or "", code=session.code, created_at=session.created_at, schema=session.schema, core=session.core, session_kind=session.session_kind, synthetic=session.synthetic, consent=consent, demo=demo, outcome=outcome,
                    subject_key=session.subject_key, subject_link_confidence=session.subject_link_confidence, frames=len(session.frames), calibration_frames=len(session.calibration_frames), targets=dict(tcount), labels=label_info, reference=ref_info, gaze_status="", flags=list(session.flags), payload_sha256=session.payload_sha256,
                    annotation_ids=[a.get("id") for a in session.annotations or [] if a.get("id")])
    # --- gaze residual task
    reasons = []
    if demo:
        e.gaze_status = "demo"
    elif not consent:
        e.gaze_status = "no-consent"
    else:
        if not session.calibration_frames:
            reasons.append("no-calibration-frames")
        if not session.targets:
            reasons.append("no-calibration-targets")
        if session.W is None or session.H is None:
            reasons.append("no-screen-size")
        if "legacy-lid-v-no-landmarks" in session.flags:
            reasons.append("legacy-vertical-feature-not-reconstructible")
        if any(t.inferred_backfill for t in session.targets):
            reasons.append("target-windows-inferred-backfill")
        supervised = bool(session.targets) and bool(session.calibration_frames) and session.W is not None
        if label_info["valid"] >= 1:
            supervised = True
        if supervised and not any(r in ("no-calibration-frames", "no-calibration-targets", "no-screen-size", "legacy-vertical-feature-not-reconstructible") for r in reasons):
            e.gaze_status = "eligible"
        elif len(session.frames):
            e.gaze_status = "unlabeled-only"
        else:
            e.gaze_status = "corrupt"
    e.gaze_reasons = reasons
    # --- rPPG quality task
    rr = []
    if demo:
        e.rppg_status = "demo"
    elif not consent:
        e.rppg_status = "no-consent"
    elif not session.pulse_windows:
        rr.append("no-pulse-evidence-windows")
        e.rppg_status = "unlabeled-only"
    elif not ref:
        rr.append("no-reference-heart-rate")
        e.rppg_status = "unlabeled-only"
    elif ref_info["grade"] != "paired":
        rr.append("reference-sync-unverified")
        e.rppg_status = "needs-sync"
    else:
        e.rppg_status = "eligible"
    e.rppg_reasons = rr
    return e


def build_inventory(raw_dir: str | Path, withdrawn_ids: set[str] | None = None, log=print) -> dict:
    raw = Path(raw_dir)
    rows, errors = [], []
    for f in sorted((raw / "sessions").glob("*.json")):
        try:
            obj = load_json(f)
            if "payload" not in obj:
                rows.append(Eligibility(session_id=obj.get("id") or f.stem, code=obj.get("code"), created_at=obj.get("created_at"), schema="summary-only", core=None, session_kind="unknown", synthetic=False, consent=True, demo=False, outcome=(obj.get("audit") or {}).get("outcome"), subject_key=None, subject_link_confidence="none", frames=0, calibration_frames=0, targets={}, labels={"present": False, "valid": 0}, reference={"present": False}, gaze_status="unlabeled-only", gaze_reasons=["summary-only-no-raw-payload"], rppg_status="unlabeled-only", rppg_reasons=["summary-only-no-raw-payload"]))
                continue
            s = load_session(obj)
            e = classify(s)
            if withdrawn_ids and e.session_id in withdrawn_ids:
                e.withdrawn = True
                e.gaze_status = e.rppg_status = "withdrawn"
            rows.append(e)
        except Exception as ex:  # noqa: BLE001
            errors.append({"file": f.name, "error": str(ex)[:200]})
            rows.append(Eligibility(session_id=f.stem, code=None, created_at=None, schema="?", core=None, session_kind="unknown", synthetic=False, consent=True, demo=False, outcome=None, subject_key=None, subject_link_confidence="none", frames=0, calibration_frames=0, targets={}, labels={"present": False, "valid": 0}, reference={"present": False}, gaze_status="corrupt", gaze_reasons=[str(ex)[:120]], rppg_status="corrupt"))
    real = [r for r in rows if not r.synthetic]
    synth = [r for r in rows if r.synthetic]

    def counts(group):
        return {"sessions": len(group), "gaze": dict(Counter(r.gaze_status for r in group)), "rppg": dict(Counter(r.rppg_status for r in group)), "sessionKind": dict(Counter(r.session_kind for r in group)),
                "subjectKeys": len({r.subject_key for r in group if r.subject_key}), "subjectLink": dict(Counter(r.subject_link_confidence for r in group)), "labelSessions": sum(1 for r in group if r.labels.get("valid")),
                "validLabels": sum(r.labels.get("valid", 0) for r in group), "holdoutLabels": sum(r.labels.get("holdout", 0) for r in group), "referencePaired": sum(1 for r in group if r.reference.get("grade") == "paired"), "referenceExploratory": sum(1 for r in group if r.reference.get("grade") == "exploratory"),
                "gazeReasons": dict(Counter(x for r in group for x in r.gaze_reasons)), "rppgReasons": dict(Counter(x for r in group for x in r.rppg_reasons)), "schemas": dict(Counter(r.schema for r in group)), "cores": dict(Counter(str(r.core) for r in group))}
    inv = {"schema": "nl-inventory-1", "rawDir": str(raw), "total": len(rows), "real": counts(real), "synthetic": counts(synth), "errors": errors, "sessions": [asdict(r) for r in rows],
           "labelGrades": {"explicit_target_confirmed": sum(r.labels.get("valid", 0) for r in real), "calibration_target_sessions": sum(1 for r in real if r.targets), "free_click_weak": "recorded in telemetry.inputs; excluded from primary training/evaluation", "reference_eyetracker": 0,
                           "note": "proxy and calibration labels are not independent eye-tracker ground truth; rPPG 'paired' requires verified sync ≤100 ms"},
           "note": "All records are listed, including ineligible ones with reasons. Synthetic fixtures are separated and never counted as human data."}
    log(f"inventory: {len(real)} real sessions ({inv['real']['gaze'].get('eligible', 0)} gaze-eligible, {inv['real']['rppg'].get('eligible', 0)} rppg-eligible), {len(synth)} synthetic")
    return inv


def inventory_markdown(inv: dict) -> str:
    r = inv["real"]
    lines = ["# 데이터 인벤토리 (자동 생성)", "", f"- 원시 디렉터리: `{inv['rawDir']}`", f"- 실측 세션: {r['sessions']} · 합성 fixture: {inv['synthetic']['sessions']} (분리 집계)", "",
             "## 시선 잔차 과제 적격성 (실측)", "| 상태 | 세션 |", "|---|---|", *[f"| {k} | {v} |" for k, v in sorted(r["gaze"].items())], "",
             "### 제외·주의 사유", *([f"- {k}: {v}" for k, v in sorted(r["gazeReasons"].items())] or ["- 없음"]), "",
             "## rPPG 기준 오차 선택기 적격성 (실측)", "| 상태 | 세션 |", "|---|---|", *[f"| {k} | {v} |" for k, v in sorted(r["rppg"].items())], "",
             "### 제외·주의 사유", *([f"- {k}: {v}" for k, v in sorted(r["rppgReasons"].items())] or ["- 없음"]), "",
             "## 라벨 등급", f"- explicit_target_confirmed (라벨 수집 모드, 유효 표적): {inv['labelGrades']['explicit_target_confirmed']} · 라벨 세션 {r['labelSessions']} · holdout 표적 {r['holdoutLabels']}",
             f"- calibration_target 세션: {inv['labelGrades']['calibration_target_sessions']}", f"- reference_eyetracker: {inv['labelGrades']['reference_eyetracker']} (외부 시선 추적기 없음)", f"- 기준 심박 paired(검증 동기화): {r['referencePaired']} · exploratory: {r['referenceExploratory']}",
             "", "## 참가자 연결", f"- subjectKey 보유 세션: {sum(v for k, v in r['subjectLink'].items() if k != 'none')} · 연결 없음: {r['subjectLink'].get('none', 0)} · 고유 키 {r['subjectKeys']}",
             "- subjectKey 는 브라우저 로컬 무작위 값(기기 수준 가명)이다. 과거 세션은 연결이 없어 사람 단위 분리를 보장하지 않는다 → person-disjoint 성능을 주장하지 않는다.", "",
             "## 스키마·엔진 버전", f"- 스키마: {r['schemas']}", f"- core: {r['cores']}", "", f"- 읽기 오류: {len(inv['errors'])}", "", "_proxy·calibration 라벨은 독립 시선 정답이 아니다. 요약 지표만 남은 세션은 프레임 학습 자료로 복원하지 않는다._"]
    return "\n".join(lines) + "\n"
