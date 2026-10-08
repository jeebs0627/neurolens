"""Canonical JSON + SHA-256, byte-identical to condition-labels.js `canonical()`/`digest()`.

규칙: 키 정렬 · 공백 없음 · 실수는 소수 9자리 반올림 뒤 JS `String(number)` 형식 · NaN/Inf → null · None → null · 불리언 true/false.
JS 숫자 형식 모사: 정수값은 지수 없이('1', 큰 값은 1e21 이상에서 지수), 그 밖은 Python repr 과 같되 지수는 'e-7'/'e+21' 형식(JS 는 '1e-7', '1e+21').
Node 와의 일치는 tools/colab/tests/test_canonical.py 가 실제 node 실행으로 검증한다."""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any


def js_number(v: float) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if not math.isfinite(v):
        return "null"
    r = round(v * 1e9) / 1e9
    if r == 0:
        return "0"
    if r == int(r) and abs(r) < 1e16:
        return str(int(r))
    s = repr(float(r))
    # Python: '1e-07', '1.5e+21', '1.2345678901234567e+19' ; JS: '1e-7', '1.5e+21', '12345678901234570000' (shortest digits, zero padded below 1e21)
    if "e" in s:
        mant, exp = s.split("e")
        sign = "-" if exp.startswith("-") else "+"
        e = int(exp.lstrip("+-").lstrip("0") or "0")
        if sign == "+" and e < 21:
            neg = mant.startswith("-")
            digits = mant.lstrip("-").replace(".", "")
            intpart_len = (mant.lstrip("-").find(".") if "." in mant else len(mant.lstrip("-"))) + e
            return ("-" if neg else "") + digits.ljust(intpart_len, "0")
        if sign == "-" and e <= 6:
            return format(r, "f").rstrip("0").rstrip(".")
        return f"{mant}e{sign}{e}"
    if r == int(r):
        return str(int(r))
    return s


def canonical(value: Any) -> str:
    def walk(v: Any) -> str:
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, (int, float)):
            return js_number(float(v)) if isinstance(v, float) or abs(int(v)) >= 1e21 else str(int(v))
        if isinstance(v, str):
            return json.dumps(v, ensure_ascii=False)
        if isinstance(v, (list, tuple)):
            return "[" + ",".join(walk(x) for x in v) + "]"
        if isinstance(v, dict):
            keys = sorted(k for k in v.keys() if v[k] is not _UNDEFINED)
            return "{" + ",".join(json.dumps(str(k), ensure_ascii=False) + ":" + walk(v[k]) for k in keys) + "}"
        if hasattr(v, "tolist"):
            return walk(v.tolist())
        return "null"
    return walk(value)


_UNDEFINED = object()


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def digest(value: Any) -> str:
    return sha256_hex(canonical(value))


def file_sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
