"""Offline checks for the administrator check-in and Mindgaze callback."""
import json
import importlib.util
import pathlib
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import HTTPServer

API_DIR = pathlib.Path(__file__).parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, API_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


care_preview = load("care_preview", "care-preview.py")
callback = load("rcvrslt_admin", "rcvrslt_admin.py")
profile_api = load("gemini_profile", "gemini.py")


class AdminApiTests(unittest.TestCase):
    def test_profile_prompt_uses_only_available_measurements(self):
        prompt = profile_api.build_prompt({"mbti": "ENFP", "big5": [82, None, 74], "jobs": []})
        self.assertIn("개방성 82백분위", prompt)
        self.assertIn("외향성 74백분위", prompt)
        self.assertNotIn("성실성 0백분위", prompt)
        self.assertIn("오늘 내 감정 상태", prompt)

    def test_prompt_does_not_invent_unavailable_fields(self):
        system, prompt = care_preview.build_prompt({
            "checkin": {"moods": ["anxious"], "issue": "career", "energy": 3,
                        "expectation": "yes", "worry": "yes"},
            "signals": {"big5": {"O": 80, "E": 70}, "riasec": {},
                        "gaze": {}, "screening": None},
            "matchedIds": [3, 13],
        })
        facts = json.loads(prompt.split("\n", 1)[1])
        self.assertEqual(facts["검사 결과"]["시선_명시값"], {})
        self.assertEqual(facts["검사 결과"]["정서_선별_명시구간"], "제공되지 않음")
        self.assertEqual([item["번호"] for item in facts["규칙상_일치한_조합"]], [3, 13])
        self.assertIn("진단하거나 치료하지 않는다", system)

    def test_form_callback_escapes_script_and_preserves_run(self):
        server = HTTPServer(("127.0.0.1", 0), callback.handler)
        worker = threading.Thread(target=server.handle_request, daemon=True)
        worker.start()
        run = str(uuid.uuid4())
        result = {"MBTI": "ENFP", "note": "</script><script>alert(1)</script>"}
        data = urllib.parse.urlencode({"resSrvyJson": json.dumps(result)}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/rcvrslt-admin?run={run}",
            data=data, headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                html = response.read().decode("utf-8")
        finally:
            server.server_close()
            worker.join(5)
        self.assertIn(run, html)
        self.assertIn("nlAdminEngineResult", html)
        self.assertIn("\\u003c/script\\u003e", html)
        self.assertNotIn("</script><script>alert(1)</script>", html)


if __name__ == "__main__":
    unittest.main()
