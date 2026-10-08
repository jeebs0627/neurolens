"""Digest parity with condition-labels.js (runs node) and schema constant parity."""
import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "colab"))
from nlcolab import canonical as C, schema  # noqa: E402

SAMPLES = [
    {"b": 1, "a": [1.5, 2, None, float("nan"), float("inf")], "c": {"z": True, "y": "한글 ✓", "n": -0.0}},
    {"x": 0.1 + 0.2, "y": 1e-7, "z": 123456789.123456789, "w": 1e21, "v": 1e-10, "u": 12345678901234567890.0, "t": 2.5e-5, "s": 1234.5},
    {"mu": {"u": 0.5}, "sd": {"u": 0.1}, "wx": [640, 300, 0], "quad": False, "keys": ["u"], "resid": None, "drift": {"dx": 0, "dy": 0}},
    [],
    {},
]


def node(expr):
    return subprocess.check_output(["node", "-e", expr], cwd=ROOT, text=True, encoding="utf-8").strip()


class CanonicalParity(unittest.TestCase):
    def test_canonical_and_digest_match_node(self):
        for s in SAMPLES:
            # JSON cannot carry NaN/Infinity to node; pass as sentinel strings and reconstruct there.
            payload = json.dumps(s, allow_nan=True).replace("NaN", '"__nan__"').replace("Infinity", '"__inf__"')
            out = node("const L=require('./condition-labels.js');const fix=v=>v==='__nan__'?NaN:v==='__inf__'?Infinity:Array.isArray(v)?v.map(fix):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,fix(x)])):v;"
                       f"const v=fix({payload});console.log(JSON.stringify({{c:L.canonical(v),d:L.digest(v)}}));")
            got = json.loads(out)
            self.assertEqual(C.canonical(s), got["c"], s)
            self.assertEqual(C.digest(s), got["d"])

    def test_js_number_formatting(self):
        self.assertEqual(C.js_number(1.0), "1")
        self.assertEqual(C.js_number(1e-7), "1e-7")
        self.assertEqual(C.js_number(1e21), "1e+21")
        self.assertEqual(C.js_number(0.3), "0.3")
        self.assertEqual(C.js_number(-0.0), "0")
        self.assertEqual(C.js_number(float("nan")), "null")

    def test_feature_contract_matches_js(self):
        got = json.loads(node("const L=require('./condition-labels.js');console.log(JSON.stringify({a:L.FEATURE_ALLOWLIST,d:L.FEATURE_DENYLIST,v:L.VERSION,s:L.SCHEMA,roles:L.LABEL_ROLES,src:Object.keys(L.LABEL_SOURCES)}))"))
        self.assertEqual(tuple(got["a"]), schema.FEATURE_ALLOWLIST)
        self.assertEqual(tuple(got["d"]), schema.FEATURE_DENYLIST)
        self.assertEqual(got["s"], schema.LABEL_SCHEMA)
        self.assertEqual(tuple(got["roles"]), schema.LABEL_ROLES)
        self.assertEqual(tuple(got["src"]), schema.LABEL_SOURCES)
        gm = json.loads(node("const M=require('./condition-gaze-model.js');console.log(JSON.stringify({m:M.MANIFEST_SCHEMA,r:M.REGISTRY_SCHEMA,e:M.EYE_MODE}))"))
        self.assertEqual(gm["m"], schema.MANIFEST_SCHEMA)
        self.assertEqual(gm["r"], schema.REGISTRY_SCHEMA)
        self.assertEqual(gm["e"], schema.EYE_MODE)


if __name__ == "__main__":
    unittest.main()
