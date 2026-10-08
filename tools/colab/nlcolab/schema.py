"""Shared constants: schema versions, label sources/roles, feature contract, states.

FEATURE_ALLOWLIST / FEATURE_DENYLIST mirror condition-labels.js; tests/test_schema_parity.py checks equality by running node."""
from __future__ import annotations

CANONICAL_SCHEMA = "nl-canonical-session-1"
TRAINING_SCHEMA = "nl-training-record-1"
RESEARCH_SCHEMAS = ("nl-research-1", "nl-research-2", "nl-research-3")
LABEL_SCHEMA = "nl-gaze-label-1"
MANIFEST_SCHEMA = "nl-gaze-residual-manifest-1"
RPPG_MANIFEST_SCHEMA = "nl-rppg-quality-manifest-1"
REGISTRY_SCHEMA = "nl-model-registry-1"
SNAPSHOT_SCHEMA = "nl-dataset-snapshot-1"
SPLIT_SCHEMA = "nl-split-manifest-1"

LABEL_SOURCES = ("reference_eyetracker", "explicit_target_confirmed", "calibration_target", "instructed_fixation", "free_click_weak", "engine_prediction", "unlabeled")
LABEL_ROLES = ("train", "internal", "holdout", "eval_only", "weak", "excluded")

# Browser-available features only. Target/click coordinates, labels, confidences, future frames and time-to-confirm are never inputs.
FEATURE_ALLOWLIST = ("baseX", "baseY", "u", "v", "uLeft", "vLeft", "uRight", "vRight", "qLeft", "qRight", "open", "yaw", "pitch", "cx", "cy", "fw", "blink", "eyeQ", "lag", "eyeMode")
FEATURE_DENYLIST = ("targetX", "targetY", "nx", "ny", "clickX", "clickY", "clientX", "clientY", "labelX", "labelY", "residualX", "residualY", "dwellConfidence", "labelWeight", "labelConfidence", "confirmAt", "timeToConfirm", "futureX", "futureY", "role", "labelSource", "targetId")
EYE_MODE = {"both": 0, "left": 1, "right": 2, "weighted": 3}

# Eligibility statuses per task (inventory)
ELIGIBILITY = ("eligible", "weak-only", "unlabeled-only", "needs-sync", "withdrawn", "corrupt", "demo", "no-consent", "eval-only")
# Batch/run states — 'trained' is never 'active'
RUN_STATES = ("queued", "running", "no_new_eligible_data", "insufficient_data", "insufficient_reference_labels", "failed", "evaluated", "candidate", "approved", "active", "rolled_back")

# Frame columns known to packFrames (any version); scale is read from payload.frames.scale when present.
FRAME_SCALE_V1 = {"ok": 1, "r": 100, "g": 100, "b": 100, "lum": 10, "cx": 1e4, "cy": 1e4, "fw": 1e4, "open": 1e4, "blink": 1e3, "lookV": 1e3, "frown": 1e3, "smile": 1e3, "u": 1e4, "v": 1e4, "yaw": 1e4, "pitch": 1e4, "lag": 1,
                  "faceOk": 1, "eyeOk": 1, "skinOk": 1, "ppgOk": 1, "gazeOk": 1, "skinQ": 1e3, "eyeQ": 1e3, "qLeft": 1e3, "qRight": 1e3, "uLeft": 1e4, "vLeft": 1e4, "uRight": 1e4, "vRight": 1e4, "roiAge": 1, "exposureGain": 100}

# Legacy calibration protocol (condition.html history) used only to back-fill target windows / pursuit metadata with explicit flags.
LEGACY_CAL9 = {"from_ms": 650, "to_ms": 2900}
LEGACY_COLLECT = {"from_ms": 500, "to_ms": 2500}
LEGACY_PURSUIT = {  # core version prefix → (fx, fy, sec); amplitude 0.38/0.34 and lag 120 ms were constant in all versions but never recorded before v3
    "default_pre_2.3": {"fx": 0.12, "fy": 0.08, "sec": 12.5, "ax": 0.38, "ay": 0.34, "lag_ms": 120},
    "2.3": {"fx": 3 / 18, "fy": 2 / 18, "sec": 18, "ax": 0.38, "ay": 0.34, "lag_ms": 120},
}
