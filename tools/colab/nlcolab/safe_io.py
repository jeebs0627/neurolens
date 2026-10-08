"""Safe loaders: size caps, no eval/pickle, gzip bomb guard, zip path traversal guard, NaN-free JSON.

입력 파일(연구 export·annotation CSV·NPZ)은 신뢰하지 않는다. 문자열을 eval 하지 않고, NPZ 는 allow_pickle=False, gzip 해제 크기 상한을 둔다."""
from __future__ import annotations

import gzip
import io
import json
import os
import zipfile
from pathlib import Path
from typing import Any

MAX_JSON_BYTES = 256 * 1024 * 1024       # 세션 JSON 상한 (원본 3~6MB · 넉넉히)
MAX_GUNZIP_BYTES = 512 * 1024 * 1024
MAX_NPZ_MEMBER_BYTES = 1024 * 1024 * 1024
MAX_ROWS = 2_000_000


class UnsafeInput(ValueError):
    pass


def _reject_nan(pairs):
    return dict(pairs)


def load_json(path, max_bytes: int = MAX_JSON_BYTES) -> Any:
    p = Path(path)
    size = p.stat().st_size
    if size > max_bytes:
        raise UnsafeInput(f"{p.name}: {size} bytes exceeds {max_bytes}")
    with open(p, "rb") as f:
        raw = f.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gunzip_limited(raw)
    return json.loads(raw.decode("utf-8"), parse_constant=_bad_constant)


def _bad_constant(name: str):
    raise UnsafeInput(f"non-finite JSON constant {name!r} is not allowed")


def gunzip_limited(data: bytes, limit: int = MAX_GUNZIP_BYTES) -> bytes:
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as g:
        while True:
            chunk = g.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            if out.tell() > limit:
                raise UnsafeInput("gzip payload exceeds decompression limit")
    return out.getvalue()


def sanitize(value: Any) -> Any:
    """Non-finite floats → None (JSON has no NaN/Infinity); numpy scalars/arrays → Python; objects with __dict__ → dict."""
    import math as _m  # noqa: PLC0415
    if isinstance(value, dict):
        return {str(k): sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(v) for v in value]
    if isinstance(value, bool) or value is None or isinstance(value, (str, int)):
        return value
    if isinstance(value, float):
        return value if _m.isfinite(value) else None
    if hasattr(value, "tolist"):
        return sanitize(value.tolist())
    if hasattr(value, "item"):
        return sanitize(value.item())
    if hasattr(value, "__dict__"):
        return sanitize(vars(value))
    return str(value)


def dump_json(path, value: Any, indent: int | None = 2) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(sanitize(value), f, ensure_ascii=False, indent=indent, allow_nan=False, sort_keys=False)
    os.replace(tmp, p)


def load_npz(path):
    """NPZ without pickle and without zip path traversal; member sizes are checked before extraction."""
    import numpy as np  # noqa: PLC0415
    p = Path(path)
    with zipfile.ZipFile(p) as z:
        for info in z.infolist():
            name = info.filename
            if name.startswith("/") or ".." in Path(name).parts or "\\" in name:
                raise UnsafeInput(f"{p.name}: suspicious member path {name!r}")
            if info.file_size > MAX_NPZ_MEMBER_BYTES or (info.compress_size and info.file_size / max(1, info.compress_size) > 400):
                raise UnsafeInput(f"{p.name}: member {name!r} too large or suspicious compression ratio")
    return np.load(p, allow_pickle=False)


def check_rows(n: int, what: str = "rows") -> None:
    if n > MAX_ROWS:
        raise UnsafeInput(f"{what}: {n} exceeds {MAX_ROWS}")
