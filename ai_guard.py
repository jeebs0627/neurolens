"""Shared durable limits for the four public AI summary endpoints. Fail closed."""
import base64
import contextvars
import functools
import hashlib
import hmac
import io
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from http.cookies import SimpleCookie
from urllib.parse import urlsplit
from cryptography.fernet import Fernet, InvalidToken

URL='https://qonoakggniupuxwvzmmw.supabase.co'
KEY='sb_publishable_hl6-Y_kMQelu2DByu4bE4g_V9Ru3jNo'
COOKIE='__Host-nl_ai'
CURRENT=contextvars.ContextVar('nl_ai_request',default=None)

class GuardError(Exception):
    def __init__(self,status,code):
        self.status,self.code=status,code

def secret():
    value=os.environ.get('AI_GUARD_SECRET','')
    if len(value)<40: raise GuardError(503,'ai_guard_unavailable')
    return value

def digest(value):
    return hmac.new(secret().encode(),value.encode(),hashlib.sha256).hexdigest()

def cipher():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256((secret()+':cache').encode()).digest()))

def same_origin(headers):
    host=(headers.get('Host') or '').lower()
    source=urlsplit(headers.get('Origin') or headers.get('Referer') or '')
    if not host or source.netloc.lower()!=host or source.scheme not in ('https','http'):
        raise GuardError(403,'forbidden')
    if os.environ.get('VERCEL') and source.scheme!='https': raise GuardError(403,'forbidden')

def ip_hash(handler):
    value=handler.headers.get('X-Vercel-Forwarded-For') or handler.headers.get('X-Forwarded-For')
    if not value and not os.environ.get('VERCEL'): value=handler.client_address[0]
    if not value: raise GuardError(503,'client_address_unavailable')
    return digest('ip:'+value.split(',')[0].strip())

def rpc(action,session,ip,**kwargs):
    payload={'p_secret':secret(),'p_action':action,'p_session':session,'p_ip':ip,**{'p_'+k:v for k,v in kwargs.items()}}
    request=urllib.request.Request(URL+'/rest/v1/rpc/ai_guard',data=json.dumps(payload).encode(),
        headers={'Content-Type':'application/json','apikey':KEY,'Authorization':'Bearer '+KEY},method='POST')
    try:
        with urllib.request.urlopen(request,timeout=8) as response: result=json.load(response)
    except Exception:
        raise GuardError(503,'ai_guard_unavailable') from None
    if not isinstance(result,dict): raise GuardError(503,'ai_guard_unavailable')
    if 'status' in result: raise GuardError(int(result['status']),result.get('code','ai_guard_unavailable'))
    return result

def cookie_session(headers):
    try:
        cookies=SimpleCookie();cookies.load(headers.get('Cookie',''))
        value=cookies[COOKIE].value
        session,expires,signature=value.split('.')
        uuid.UUID(session)
        if int(expires)<time.time() or int(expires)>time.time()+86460: return None
        if not hmac.compare_digest(signature,digest('session:'+session+'.'+expires)): return None
        return session
    except (KeyError,ValueError): return None

def send(handler,status,data,cookie=None):
    body=json.dumps(data,ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header('Content-Type','application/json; charset=utf-8')
    handler.send_header('Cache-Control','no-store')
    if status in (202,429): handler.send_header('Retry-After','2' if status==202 else '60')
    if cookie: handler.send_header('Set-Cookie',cookie)
    handler.send_header('Content-Length',str(len(body)));handler.end_headers();handler.wfile.write(body)

def start_session(handler):
    same_origin(handler.headers)
    session=cookie_session(handler.headers) or str(uuid.uuid4())
    rpc('session',session,ip_hash(handler))
    expires=str(int(time.time())+86400)
    token=session+'.'+expires+'.'+digest('session:'+session+'.'+expires)
    send(handler,200,{'ok':True},COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400')

def user(handler,required=False,admin=False):
    authorization=handler.headers.get('Authorization','')
    if not authorization:
        if required or admin: raise GuardError(401,'login_required')
        return None
    if not authorization.startswith('Bearer ') or len(authorization)>8192: raise GuardError(401,'login_required')
    headers={'apikey':KEY,'Authorization':authorization,'Content-Type':'application/json'}
    try:
        with urllib.request.urlopen(urllib.request.Request(URL+'/auth/v1/user',headers=headers),timeout=8) as response:
            info=json.load(response)
        identifier=str(uuid.UUID(info['id']))
        if admin:
            with urllib.request.urlopen(urllib.request.Request(URL+'/rest/v1/rpc/is_admin',headers=headers,data=b'{}'),timeout=8) as response:
                if json.load(response) is not True: raise GuardError(403,'admin_required')
        return identifier
    except GuardError: raise
    except urllib.error.HTTPError as error:
        raise GuardError(401 if error.code in (400,401,403) else 503,'login_required' if error.code in (400,401,403) else 'auth_unavailable') from None
    except Exception: raise GuardError(503,'auth_unavailable') from None

def upstream(request,timeout=55):
    context=CURRENT.get()
    if context is None: raise GuardError(503,'ai_guard_unavailable')
    remaining=context['deadline']-time.monotonic()
    context['attempt']+=1
    if context['attempt']>4 or remaining<=0: raise GuardError(429,'request_attempt_limit')
    rpc('charge',context['session'],context['ip'],key=context['key'],kind=context['kind'],
        lease=context['lease'],attempt=context['attempt'],user=context['user'])
    return urllib.request.urlopen(request,timeout=min(timeout,max(1,remaining)))

def guarded(kind,max_body):
    def decorate(function):
        @functools.wraps(function)
        def wrapped(handler):
            token=None;original=handler._send;context=None;finished=False
            try:
                same_origin(handler.headers)
                try: length=int(handler.headers.get('Content-Length','0'))
                except ValueError: raise GuardError(400,'invalid_request')
                if not 0<length<=max_body: raise GuardError(413,'invalid_request_length')
                raw=handler.rfile.read(length)
                try: body=json.loads(raw)
                except (ValueError,UnicodeError): raise GuardError(400,'invalid_request')
                if not isinstance(body,dict): raise GuardError(400,'invalid_request')
                who=user(handler,required=kind=='condition',admin=body.get('probe') is True)
                session=cookie_session(handler.headers)
                if not session: raise GuardError(401,'ai_session_required')
                ip=ip_hash(handler)
                key=digest('v1:'+kind+':'+(who or 'guest')+':'+json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False))
                if body.get('probe') is True: key=digest(key+':probe:'+str(uuid.uuid4()))
                lease=str(uuid.uuid4())
                result=rpc('begin',session,ip,key=key,kind=kind,lease=lease)
                if result.get('cached'):
                    try: cached=json.loads(cipher().decrypt(result['cached'].encode(),ttl=86400))
                    except (InvalidToken,ValueError): raise GuardError(503,'cache_unavailable')
                    return send(handler,200,cached)
                context={'session':session,'ip':ip,'key':key,'kind':kind,'lease':lease,'attempt':0,
                    'user':digest('user:'+(who or session)),'deadline':time.monotonic()+75}
                token=CURRENT.set(context)
                def capture(status,data):
                    nonlocal finished
                    if status==200:
                        encrypted=cipher().encrypt(json.dumps(data,ensure_ascii=False).encode()).decode()
                        rpc('finish',session,ip,key=key,kind=kind,lease=lease,cipher=encrypted)
                    else:
                        rpc('fail',session,ip,key=key,kind=kind,lease=lease)
                    finished=True
                    return original(status,data)
                handler._send=capture;handler.rfile=io.BytesIO(raw)
                return function(handler)
            except GuardError as error:
                return send(handler,error.status,{'error':error.code,'code':error.code})
            finally:
                handler._send=original
                if token is not None: CURRENT.reset(token)
                if context and not finished:
                    try: rpc('fail',context['session'],context['ip'],key=context['key'],kind=kind,lease=context['lease'])
                    except GuardError: pass
        return wrapped
    return decorate
