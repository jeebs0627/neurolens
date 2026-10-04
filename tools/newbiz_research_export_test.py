"""Offline v1/v2 export tests; no database credentials or numpy needed."""
import json
import math
import pathlib
import subprocess
import unittest
from newbiz_research_export import decode_frames, FRAME_SCALE


class DecodeTests(unittest.TestCase):
    def test_legacy_frames(self):
        arr = decode_frames({"t": [0], "ok": [1], "r": [12500], "rr": [[100] * 9]})
        self.assertEqual(arr["r"], [125])
        self.assertEqual(arr["rr"], [[1] * 9])

    def test_v2_partial_roi_roundtrip_from_browser_packer(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        data = subprocess.check_output(["node", "-e", "const R=require('./newbiz-research.js');console.log(JSON.stringify({scales:R.FRAME_COLS,frames:R.packFrames([{t:1,faceOk:true,ppgOk:false,rr:[null,[1,2,3],null],rq:[0,.4,0],source:'observed',qLeft:.8}])}));"], cwd=root)
        packed = json.loads(data)
        self.assertEqual(packed["scales"], FRAME_SCALE)
        arr = decode_frames(packed["frames"])
        self.assertTrue(math.isnan(arr["rr"][0][0]))
        self.assertEqual(arr["rr"][0][3:6], [1, 2, 3])
        self.assertEqual(arr["faceOk"], [1])
        self.assertEqual(arr["ppgOk"], [0])
        self.assertEqual(arr["qLeft"], [.8])
        self.assertEqual(arr["rq"], [[0, .4, 0]])
        self.assertEqual(arr["source"], ["observed"])
        self.assertEqual(arr["reason"], [""])

    def test_whole_missing_roi_and_empty_session(self):
        self.assertTrue(all(math.isnan(v) for v in decode_frames({"t": [0], "rr": [None]})["rr"][0]))
        self.assertEqual(decode_frames({"t": [], "rr": []})["rr"], [])


if __name__ == "__main__":
    unittest.main()
