"""Gaze residual models: baseline (identity), ridge (closed form), small MLP (torch, optional). ONNX export + Python/ORT parity.

Contract: delta = f(features) in viewport fractions; g_corrected = g_base + delta·(W,H). Standardisation statistics come from the
train split only; missing values → 0 after standardisation with a mask bit appended (manifest.preprocessing.mask = true).
Loss: Huber (robust). Weights: per-window total 1 (frames of one target are not independent) × label-source weight.
Early stopping / hyper-parameters: val split only. The locked test is never read here."""
from __future__ import annotations

import json
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import schema as SCH
from .gaze_dataset import FEATURES, Record

SOURCE_WEIGHT = {"explicit_target_confirmed": 1.0, "calibration_target": 0.8, "instructed_fixation": 0.6, "free_click_weak": 0.0}


@dataclass
class Preprocess:
    features: list[str]
    mean: list[float]
    std: list[float]
    mask: bool = True
    clip: float = 6.0
    version: str = "gaze-pp-1"

    def transform(self, X: np.ndarray) -> np.ndarray:
        Z = (X - np.asarray(self.mean)) / np.asarray(self.std)
        miss = ~np.isfinite(Z)
        Z = np.where(miss, 0.0, Z)
        Z = np.clip(Z, -self.clip, self.clip)
        if self.mask:
            Z = np.concatenate([Z, miss.astype(np.float32)], axis=1)
        return Z.astype(np.float32)

    @property
    def dim(self) -> int:
        return len(self.features) * (2 if self.mask else 1)

    def to_json(self) -> dict:
        return {"features": self.features, "mean": self.mean, "std": self.std, "mask": self.mask, "clip": self.clip, "version": self.version}


def matrix(records: list[Record]) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    X = np.array([[r.features.get(k, float("nan")) for k in FEATURES] for r in records], dtype=np.float64) if records else np.zeros((0, len(FEATURES)))
    Y = np.array([[r.residual["dxFrac"], r.residual["dyFrac"]] for r in records], dtype=np.float64) if records else np.zeros((0, 2))
    w = np.array([r.weight * SOURCE_WEIGHT.get(r.label_source, 0.5) for r in records], dtype=np.float64) if records else np.zeros(0)
    groups = [r.window_id for r in records]
    return X, Y, w, groups


def fit_preprocess(X: np.ndarray) -> Preprocess:
    mean = np.nanmean(X, axis=0) if len(X) else np.zeros(X.shape[1])
    std = np.nanstd(X, axis=0) if len(X) else np.ones(X.shape[1])
    mean = np.where(np.isfinite(mean), mean, 0.0)
    std = np.where(np.isfinite(std) & (std > 1e-6), std, 1.0)
    return Preprocess(list(FEATURES), [float(v) for v in mean], [float(v) for v in std])


# ------------------------------------------------------------------ models
class Identity:
    name = "baseline-engine"
    params = 0

    def predict(self, Z: np.ndarray) -> np.ndarray:
        return np.zeros((len(Z), 2), dtype=np.float32)


class Ridge:
    name = "ridge-residual"

    def __init__(self, lam: float = 1.0):
        self.lam, self.W = lam, None

    def fit(self, Z: np.ndarray, Y: np.ndarray, w: np.ndarray):
        A = np.concatenate([np.ones((len(Z), 1)), Z], axis=1)
        Wd = np.sqrt(np.clip(w, 0, None))[:, None]
        Aw, Yw = A * Wd, Y * Wd
        reg = self.lam * np.eye(A.shape[1]) * max(1.0, w.sum()) / 50.0
        reg[0, 0] = 0.0
        self.W = np.linalg.solve(Aw.T @ Aw + reg, Aw.T @ Yw)
        self.params = int(self.W.size)
        return self

    def predict(self, Z: np.ndarray) -> np.ndarray:
        A = np.concatenate([np.ones((len(Z), 1)), Z], axis=1)
        return (A @ self.W).astype(np.float32)


class MLP:
    """D → 64 → 32 → 2, ReLU, weight decay, optional dropout; trained with Huber loss and val early stopping (torch)."""
    name = "mlp-residual"

    def __init__(self, hidden=(64, 32), dropout: float = 0.05, weight_decay: float = 1e-4, lr: float = 2e-3, max_epochs: int = 300, patience: int = 25, seed: int = 7, batch: int = 256):
        self.cfg = dict(hidden=list(hidden), dropout=dropout, weight_decay=weight_decay, lr=lr, max_epochs=max_epochs, patience=patience, seed=seed, batch=batch)
        self.net, self.history, self.params = None, [], 0

    def _build(self, dim: int):
        import torch  # noqa: PLC0415
        torch.manual_seed(self.cfg["seed"])
        layers, d = [], dim
        for h in self.cfg["hidden"]:
            layers += [torch.nn.Linear(d, h), torch.nn.ReLU()]
            if self.cfg["dropout"] > 0:
                layers.append(torch.nn.Dropout(self.cfg["dropout"]))
            d = h
        layers.append(torch.nn.Linear(d, 2))
        self.net = torch.nn.Sequential(*layers)
        self.params = sum(p.numel() for p in self.net.parameters())

    def fit(self, Z: np.ndarray, Y: np.ndarray, w: np.ndarray, Zv: np.ndarray | None = None, Yv: np.ndarray | None = None, wv: np.ndarray | None = None):
        import torch  # noqa: PLC0415
        self._build(Z.shape[1])
        X_t, Y_t, w_t = torch.tensor(Z, dtype=torch.float32), torch.tensor(Y, dtype=torch.float32), torch.tensor(w / max(1e-9, w.mean()), dtype=torch.float32)
        opt = torch.optim.AdamW(self.net.parameters(), lr=self.cfg["lr"], weight_decay=self.cfg["weight_decay"])
        huber = torch.nn.HuberLoss(reduction="none", delta=0.05)
        best, best_state, bad = math.inf, None, 0
        g = torch.Generator().manual_seed(self.cfg["seed"])
        for epoch in range(self.cfg["max_epochs"]):
            self.net.train()
            perm = torch.randperm(len(X_t), generator=g)
            for i in range(0, len(perm), self.cfg["batch"]):
                idx = perm[i:i + self.cfg["batch"]]
                opt.zero_grad()
                loss = (huber(self.net(X_t[idx]), Y_t[idx]).sum(1) * w_t[idx]).mean()
                loss.backward()
                opt.step()
            self.net.eval()
            with torch.no_grad():
                if Zv is not None and len(Zv):
                    pv = self.net(torch.tensor(Zv, dtype=torch.float32)).numpy()
                    val = float(np.average(np.hypot(pv[:, 0] - Yv[:, 0], pv[:, 1] - Yv[:, 1]), weights=wv if wv is not None else None))
                else:
                    val = float((huber(self.net(X_t), Y_t).sum(1) * w_t).mean())
            self.history.append({"epoch": epoch, "val": val})
            if val < best - 1e-6:
                best, bad, best_state = val, 0, {k: v.detach().clone() for k, v in self.net.state_dict().items()}
            else:
                bad += 1
                if bad >= self.cfg["patience"]:
                    break
        if best_state:
            self.net.load_state_dict(best_state)
        self.net.eval()
        self.best_val = best
        return self

    def predict(self, Z: np.ndarray) -> np.ndarray:
        import torch  # noqa: PLC0415
        self.net.eval()
        with torch.no_grad():
            return self.net(torch.tensor(Z, dtype=torch.float32)).numpy().astype(np.float32)

    def export_onnx(self, path: str | Path, dim: int, opset: int = 17) -> dict:
        import torch  # noqa: PLC0415
        self.net.eval()
        dummy = torch.zeros(1, dim, dtype=torch.float32)
        torch.onnx.export(self.net, dummy, str(path), input_names=["x"], output_names=["delta"], opset_version=opset, dynamo=False, dynamic_axes={"x": {0: "batch"}, "delta": {0: "batch"}})
        return {"opset": opset, "input": {"name": "x", "shape": [1, dim]}, "output": {"name": "delta", "shape": [1, 2], "units": "viewport-fraction"}}


def ridge_to_onnx(model: Ridge, path: str | Path, dim: int, opset: int = 17) -> dict:
    """Ridge = Gemm; exported directly so the browser contract is identical for both candidates."""
    import onnx  # noqa: PLC0415
    from onnx import TensorProto, helper, numpy_helper  # noqa: PLC0415
    Wm = model.W[1:].astype(np.float32)   # dim×2
    b = model.W[0].astype(np.float32)
    node = helper.make_node("Gemm", ["x", "W", "b"], ["delta"], alpha=1.0, beta=1.0)
    graph = helper.make_graph([node], "ridge_residual", [helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", dim])], [helper.make_tensor_value_info("delta", TensorProto.FLOAT, ["batch", 2])],
                              initializer=[numpy_helper.from_array(Wm, "W"), numpy_helper.from_array(b, "b")])
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", opset)], producer_name="nlcolab")
    m.ir_version = 8
    onnx.checker.check_model(m)
    onnx.save(m, str(path))
    return {"opset": opset, "input": {"name": "x", "shape": [1, dim]}, "output": {"name": "delta", "shape": [1, 2], "units": "viewport-fraction"}}


def onnx_parity(path: str | Path, Z: np.ndarray, expected: np.ndarray, tol_abs: float = 1e-5, tol_rel: float = 1e-4) -> dict:
    import onnxruntime as ort  # noqa: PLC0415
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    t0 = time.perf_counter()
    out = np.concatenate([sess.run(None, {name: Z[i:i + 1].astype(np.float32)})[0] for i in range(len(Z))]) if len(Z) else np.zeros((0, 2), np.float32)
    ms = (time.perf_counter() - t0) * 1000 / max(1, len(Z))
    diff = np.abs(out - expected)
    ok = bool(np.all(diff <= tol_abs + tol_rel * np.abs(expected)))
    return {"ok": ok, "maxAbsDiff": float(diff.max()) if len(diff) else 0.0, "perRowMs": ms, "rows": int(len(Z)), "tolerance": {"abs": tol_abs, "rel": tol_rel}, "ort": ort.__version__}


def test_vectors(Z: np.ndarray, pred: np.ndarray, n: int = 5) -> list[dict]:
    idx = np.linspace(0, max(0, len(Z) - 1), num=min(n, len(Z)), dtype=int) if len(Z) else []
    return [{"input": [float(v) for v in Z[i]], "output": [float(v) for v in pred[i]]} for i in idx]


# ------------------------------------------------------------------ training driver
@dataclass
class TrainResult:
    name: str
    params: int
    val: dict
    train: dict
    model: object
    pre: Preprocess
    onnx: dict | None = None
    parity: dict | None = None
    artifact: str | None = None
    extra: dict = field(default_factory=dict)


def _err(pred: np.ndarray, Y: np.ndarray, w: np.ndarray, Wpx: np.ndarray, Hpx: np.ndarray) -> dict:
    if not len(Y):
        return {"n": 0}
    ex, ey = (pred[:, 0] - Y[:, 0]) * Wpx, (pred[:, 1] - Y[:, 1]) * Hpx
    d = np.hypot(ex, ey)
    order = np.argsort(d)
    cw = np.cumsum(w[order]) / max(1e-12, w.sum())
    q = lambda p: float(d[order][min(len(d) - 1, int(np.searchsorted(cw, p)))])
    return {"n": int(len(d)), "medianPx": q(0.5), "meanPx": float(np.average(d, weights=w)), "rmsePx": float(math.sqrt(np.average(d ** 2, weights=w))), "p90Px": q(0.9), "p95Px": q(0.95), "biasXPx": float(np.average(ex, weights=w)), "biasYPx": float(np.average(ey, weights=w)),
            "medianPctW": float(q(0.5) / np.average(Wpx, weights=w) * 100)}


def train_candidates(train: list[Record], val: list[Record], out_dir: str | Path, use_mlp: bool = True, ridge_lambdas=(0.1, 1.0, 10.0), log=print) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    Xtr, Ytr, wtr, _ = matrix(train)
    Xv, Yv, wv, _ = matrix(val)
    pre = fit_preprocess(Xtr)
    Ztr, Zv = pre.transform(Xtr), pre.transform(Xv)
    Wtr, Htr = np.array([r.target["W"] for r in train]), np.array([r.target["H"] for r in train])
    Wv, Hv = np.array([r.target["W"] for r in val]), np.array([r.target["H"] for r in val])
    results = {}
    base = Identity()
    results["baseline-engine"] = TrainResult("baseline-engine", 0, _err(base.predict(Zv), Yv, wv, Wv, Hv), _err(base.predict(Ztr), Ytr, wtr, Wtr, Htr), base, pre)
    best_ridge = None
    for lam in ridge_lambdas:
        r = Ridge(lam).fit(Ztr, Ytr, wtr)
        v = _err(r.predict(Zv), Yv, wv, Wv, Hv)
        if best_ridge is None or v.get("medianPx", math.inf) < best_ridge[1].get("medianPx", math.inf):
            best_ridge = (r, v, lam)
    r, v, lam = best_ridge
    path = out / "ridge.onnx"
    onnx_meta = ridge_to_onnx(r, path, pre.dim)
    tr_ridge = TrainResult("ridge-residual", r.params, v, _err(r.predict(Ztr), Ytr, wtr, Wtr, Htr), r, pre, onnx_meta, onnx_parity(path, Zv[:200], r.predict(Zv[:200])), str(path), {"lambda": lam})
    results["ridge-residual"] = tr_ridge
    if use_mlp:
        try:
            import torch  # noqa: F401,PLC0415
            m = MLP().fit(Ztr, Ytr, wtr, Zv, Yv, wv)
            path = out / "mlp.onnx"
            onnx_meta = m.export_onnx(path, pre.dim)
            results["mlp-residual"] = TrainResult("mlp-residual", m.params, _err(m.predict(Zv), Yv, wv, Wv, Hv), _err(m.predict(Ztr), Ytr, wtr, Wtr, Htr), m, pre, onnx_meta, onnx_parity(path, Zv[:200], m.predict(Zv[:200])), str(path), {"epochs": len(m.history), "bestVal": m.best_val, "config": m.cfg})
        except ImportError:
            log("torch not installed: MLP skipped (ridge/baseline only). pip install torch to enable.")
            results["mlp-skipped"] = TrainResult("mlp-skipped", 0, {"n": 0, "reason": "torch-missing"}, {"n": 0}, None, pre)
    for k, v in results.items():
        log(f"{k}: val median {v.val.get('medianPx', float('nan')):.1f}px p95 {v.val.get('p95Px', float('nan')):.1f}px (n={v.val.get('n', 0)}, params={v.params})")
    return results


def choose(results: dict, min_rel_gain: float = 0.05) -> tuple[str, dict]:
    """Pick on val only: a learned model must beat the baseline median error by ≥ min_rel_gain and not worsen P95 by more than 10 %.
    Ridge is preferred over the MLP unless the MLP improves the median by a further ≥ 3 % (small data: simpler wins ties)."""
    base = results["baseline-engine"].val
    if not base.get("n"):
        return "baseline-engine", {"reason": "no-validation-data"}
    cands = []
    for name in ("ridge-residual", "mlp-residual"):
        r = results.get(name)
        if not r or not r.val.get("n") or (r.parity and not r.parity["ok"]):
            continue
        gain = 1 - r.val["medianPx"] / max(1e-9, base["medianPx"])
        p95ok = r.val["p95Px"] <= base["p95Px"] * 1.10
        cands.append((name, gain, p95ok, r))
    ok = [c for c in cands if c[1] >= min_rel_gain and c[2]]
    if not ok:
        return "baseline-engine", {"reason": "no-candidate-meets-val-gain", "candidates": {c[0]: {"gain": c[1], "p95ok": c[2]} for c in cands}}
    ridge = next((c for c in ok if c[0] == "ridge-residual"), None)
    mlp = next((c for c in ok if c[0] == "mlp-residual"), None)
    if ridge and mlp and mlp[1] - ridge[1] < 0.03:
        return "ridge-residual", {"reason": "mlp-gain-not-material-over-ridge", "gains": {"ridge": ridge[1], "mlp": mlp[1]}}
    best = max(ok, key=lambda c: c[1])
    return best[0], {"reason": "best-val-gain", "gains": {c[0]: c[1] for c in ok}}
