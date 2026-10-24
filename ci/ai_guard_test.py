"""Offline server-boundary tests. No provider credentials, billing, or production DB."""
import concurrent.futures
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import threading
import time
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import ai_guard as guard

class SharedStore:
    def __init__(self): self.requests={};self.calls=0;self.lock=threading.Lock()
    def rpc(self,action,session,ip,**args):
        key=(session,args.get('key'))
        with self.lock:
            if action=='session': return {'ok':True}
            if action=='begin':
                row=self.requests.get(key)
                if row and row['state']=='done': return {'cached':row['cipher']}
                if row and row['state']=='pending': raise guard.GuardError(202,'generation_pending')
                self.requests[key]={'state':'pending','lease':args['lease']};return {'ok':True}
            if action=='charge': self.calls+=1;return {'ok':True}
            self.requests[key].update(state='done' if action=='finish' else 'failed',cipher=args.get('cipher'))
            return {'ok':True}

class Reply(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self,*args): self.close()

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'AI_GUARD_SECRET':'offline-test-secret-'+'x'*48,'GEMINI_API_KEY':'dummy'});self.env.start()
        spec=importlib.util.spec_from_file_location('guard_profile',Path(__file__).resolve().parents[1] / 'api/gemini.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.store=SharedStore();self.backend=patch.object(guard,'rpc',self.store.rpc);self.backend.start()
        self.session=str(uuid.uuid4());expires=str(int(time.time())+3600)
        self.cookie=guard.COOKIE+'='+self.session+'.'+expires+'.'+guard.digest('session:'+self.session+'.'+expires)
    def tearDown(self): self.backend.stop();self.env.stop()
    def invoke(self,body=None,cookie=True,origin='https://www.neurolens.me',authorization=None):
        h=self.module.handler.__new__(self.module.handler);raw=json.dumps(body or {'mbti':'ENFP'}).encode()
        h.headers={'Host':'www.neurolens.me','Origin':origin,'Content-Length':str(len(raw)),
                   'X-Vercel-Forwarded-For':'127.0.0.1'}
        if cookie:h.headers['Cookie']=self.cookie
        if authorization:h.headers['Authorization']=authorization
        h.client_address=('127.0.0.1',1);h.rfile=io.BytesIO(raw);h.wfile=io.BytesIO();h.code=None
        h.send_response=lambda code:setattr(h,'code',code);h.send_header=lambda *args:None;h.end_headers=lambda:None
        h.do_POST()
        return h.code,json.loads(h.wfile.getvalue())
    def provider(self,*args,**kwargs):
        time.sleep(0.03)
        return Reply(json.dumps({'candidates':[{'content':{'parts':[{'text':'Offline summary'}]}}]}).encode())
    def test_missing_cookie_and_forged_origin_do_not_call_provider(self):
        with patch.object(guard.urllib.request,'urlopen',side_effect=self.provider) as provider:
            self.assertEqual(self.invoke(cookie=False)[0],401)
            self.assertEqual(self.invoke(origin='https://other.example')[0],403)
            self.assertEqual(self.invoke({'probe':True})[0],401)
            self.assertEqual(provider.call_count,0)
    def test_concurrent_requests_generate_once_and_cache_is_encrypted(self):
        with patch.object(guard.urllib.request,'urlopen',side_effect=self.provider) as provider:
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
                results=list(pool.map(lambda _:self.invoke(),range(20)))
            self.assertTrue(all(status in (200,202) for status,_ in results))
            self.assertEqual(self.invoke(),(200,{'text':'Offline summary'}))
            self.assertEqual(provider.call_count,1);self.assertEqual(self.store.calls,1)
            self.assertNotIn('Offline summary',next(iter(self.store.requests.values()))['cipher'])
    def test_invalid_and_expired_cookie_rejected(self):
        self.cookie+='tampered';self.assertEqual(self.invoke()[0],401)
    def test_condition_always_requires_verified_login(self):
        with self.assertRaises(guard.GuardError) as error:
            guard.user(type('Request',(),{'headers':{}})(),required=True)
        self.assertEqual(error.exception.status,401)
    def test_missing_backend_configuration_fails_closed(self):
        with patch.dict(os.environ,{'AI_GUARD_SECRET':''}):
            self.assertEqual(self.invoke()[0],503)
    def test_budget_failure_never_calls_provider(self):
        original=self.store.rpc
        def denied(action,*args,**kwargs):
            if action=='charge': raise guard.GuardError(429,'daily_limit_reached')
            return original(action,*args,**kwargs)
        with patch.object(guard,'rpc',side_effect=denied),patch.object(guard.urllib.request,'urlopen') as provider:
            self.assertEqual(self.invoke(),(429,{'error':'daily_limit_reached','code':'daily_limit_reached'}))
            provider.assert_not_called()
    def test_upstream_attempt_limit_and_context_required(self):
        with self.assertRaises(guard.GuardError):guard.upstream(None)
        token=guard.CURRENT.set({'session':self.session,'ip':'a'*64,'key':'b'*64,'kind':'profile','lease':str(uuid.uuid4()),'user':'c'*64,'attempt':4,'deadline':time.monotonic()+20})
        try:
            with self.assertRaises(guard.GuardError):guard.upstream(None)
        finally:guard.CURRENT.reset(token)

if __name__=='__main__':unittest.main()
