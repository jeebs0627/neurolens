import importlib.util
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
api = load("nl2_api_test", ROOT / "api" / "neurolens2.py")
preview = load("nl2_preview_test", ROOT / "tools" / "neurolens2_preview.py")

class AuthTests(unittest.TestCase):
    def test_missing_token(self):
        with self.assertRaises(api.AccessError) as e: api.authorize("", allowed_ids={"admin"})
        self.assertEqual(e.exception.status, 401)
    def test_missing_allowlist(self):
        with self.assertRaises(api.AccessError) as e: api.authorize("Bearer " + "x"*30, allowed_ids=set())
        self.assertEqual(e.exception.status, 503)
    def test_non_admin_and_forged_metadata_denied(self):
        for allowed in ({"admin"}, {"user"}):
            with self.assertRaises(api.AccessError):
                api.authorize("Bearer " + "x"*30, lambda p,*_: {"id":"user","user_metadata":{"role":"admin"}} if p.endswith("user") else False, allowed)
    def test_authenticated_allowlisted_admin(self):
        calls=[]
        def fetch(path, token, body=None):
            calls.append((path,body));return {"id":"admin"} if path.endswith("user") else True
        result=api.authorize("Bearer " + "x"*30, fetch, {"admin"})
        self.assertTrue(result["authorized"])
        self.assertEqual([x[0] for x in calls], ["/auth/v1/user","/rest/v1/rpc/is_admin"])
        self.assertNotIn("admin", result["scope"])
    def test_network_failure_fails_closed(self):
        def fetch(*_): raise TimeoutError()
        with self.assertRaises(api.AccessError) as e: api.authorize("Bearer " + "x"*30, fetch, {"admin"})
        self.assertEqual(e.exception.status,503)
    def test_truthy_rpc_is_not_admin(self):
        with self.assertRaises(api.AccessError): api.authorize("Bearer " + "x"*30, lambda p,*_: {"id":"admin"} if p.endswith("user") else "true", {"admin"})

class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=preview.PreviewServer(0);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls): cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def request(self,path,body=None,headers=None):
        req=urllib.request.Request(self.server.origin+path,data=json.dumps(body).encode() if body is not None else None,headers=headers or {})
        try: response=urllib.request.urlopen(req)
        except urllib.error.HTTPError as error: response=error
        return response.status,response.headers,response.read()
    def test_second_preview_cannot_share_active_port(self):
        with self.assertRaises(OSError):
            duplicate = preview.PreviewServer(self.server.server_port)
            duplicate.server_close()
    def test_separate_preview_ports_cannot_overwrite_login_cookie(self):
        other=preview.PreviewServer(0)
        try:
            self.assertNotEqual(self.server.cookie_name,other.cookie_name)
            self.assertTrue(self.server.cookie_name.endswith(str(self.server.server_port)))
        finally: other.server_close()
    def test_public_shell_and_protected_session(self):
        self.assertEqual(self.request('/neurolens2.html')[0],200)
        self.assertEqual(self.request('/api/neurolens2')[0],401)
    def test_operating_files_and_traversal_inaccessible(self):
        for path in ['/condition.html','/dataset.html','/auth.js','/api/neurolens_dataset','/neurolens2/../auth.js','/neurolens2/%2e%2e/auth.js','/neurolens2/operational-baseline.json','/neurolens2/']:
            self.assertEqual(self.request(path)[0],404,path)
    def test_dns_rebinding_host_rejected(self): self.assertEqual(self.request('/neurolens2.html',headers={'Host':'evil.example'})[0],403)
    def test_cross_origin_ticket_rejected(self):
        self.assertEqual(self.request('/api/neurolens2/bootstrap',{'ticket':self.server.ticket},{'Origin':'https://evil.example','Content-Type':'application/json'})[0],403)
    def test_ticket_single_use_cookie_and_logout(self):
        ticket=self.server.ticket;headers={'Origin':self.server.origin,'Content-Type':'application/json'}
        status,h,_=self.request('/api/neurolens2/bootstrap',{'ticket':ticket},headers)
        self.assertEqual(status,200);cookie=h['Set-Cookie'].split(';')[0]
        self.assertIn('HttpOnly',h['Set-Cookie']);self.assertIn('SameSite=Strict',h['Set-Cookie'])
        self.assertEqual(self.request('/api/neurolens2/bootstrap',{'ticket':ticket},headers)[0],403)
        self.assertEqual(self.request('/api/neurolens2',headers={'Cookie':cookie})[0],200)
        self.request('/api/neurolens2/logout',{},dict(headers,Cookie=cookie))
        self.assertEqual(self.request('/api/neurolens2',headers={'Cookie':cookie})[0],401)

if __name__=='__main__': unittest.main(verbosity=2)
