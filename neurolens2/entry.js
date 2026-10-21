const URL='https://qonoakggniupuxwvzmmw.supabase.co',KEY='sb_publishable_hl6-Y_kMQelu2DByu4bE4g_V9Ru3jNo',STORAGE='neurolens2-auth-v1';
const $=id=>document.getElementById(id);let session=null,app=null,leaseTimer=null,verification=null;
try{session=JSON.parse(sessionStorage.getItem(STORAGE)||'null');}catch{}
const messages={'admin-allowlist-not-configured':'서버에 2.0 관리자 허용 목록이 아직 설정되지 않았습니다. 로컬 실행기로 테스트하거나 배포 환경의 NEUROLENS2_ADMIN_IDS를 설정하세요.',
  'administrator-required':'이 계정은 IN MIND 2.0 테스트 관리자로 허용되지 않았습니다.','authentication-required':'관리자 계정으로 로그인하세요.','invalid-session':'세션이 만료되었습니다. 다시 로그인하세요.','authorization-unavailable':'서버에서 접근 권한을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'};
function remember(value){session=value;try{if(value)sessionStorage.setItem(STORAGE,JSON.stringify(value));else sessionStorage.removeItem(STORAGE);}catch{}}
async function tokenRequest(kind,body){const response=await fetch(URL+'/auth/v1/token?grant_type='+kind,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw Error('로그인 정보를 확인하세요.');remember({...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in});}
async function checkAccess(){
  if(session&&session.expires_at*1000<Date.now()+30000){try{await tokenRequest('refresh_token',{refresh_token:session.refresh_token});}catch(e){remember(null);throw e;}}
  const response=await fetch('/api/neurolens2',{credentials:'same-origin',headers:session?{Authorization:'Bearer '+session.access_token}:{},cache:'no-store',signal:AbortSignal.timeout(28000)});
  let data;try{data=await response.json();}catch{throw Error('2.0 인증 서버에 연결하지 못했습니다. 전용 로컬 실행기 또는 Vercel 배포 환경에서 실행하세요.');}
  if(!response.ok||data.authorized!==true)throw Error(messages[data.error]||'접근 권한을 확인하지 못했습니다.');return data;
}
function verify(){if(!verification)verification=checkAccess().finally(()=>{verification=null;});return verification;}
async function logout(){clearInterval(leaseTimer);await app?.destroy();app=null;remember(null);try{await fetch('/api/neurolens2/logout',{method:'POST',credentials:'same-origin'});}catch{}$('app').hidden=true;$('auth').hidden=false;$('password').value='';$('auth-status').textContent='연구 세션을 종료했습니다. 로컬 접속은 실행기에서 새 주소를 발급받으세요.';}
async function enter(){const access=await verify();const module=await import('./app.js');app=await module.mount({access,verify,logout});$('auth').hidden=true;$('app').hidden=false;
  leaseTimer=setInterval(async()=>{try{await verify();}catch(e){await logout();$('auth-status').textContent=e.message;}},Math.min(120,access.leaseSeconds||120)*1000);}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-button').disabled=true;$('auth-status').textContent='관리자 권한 확인 중…';try{await tokenRequest('password',{email:$('email').value.trim(),password:$('password').value});$('password').value='';await enter();}catch(e){remember(null);$('auth-status').textContent=e.message;$('auth-status').classList.add('error');}finally{$('login-button').disabled=false;}});
try{const fragment=new URLSearchParams(location.hash.slice(1));const ticket=fragment.get('local-ticket');if(ticket){history.replaceState(null,'',location.pathname);const r=await fetch('/api/neurolens2/bootstrap',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});if(!r.ok)throw Error('로컬 입장 주소가 만료되었거나 이미 사용되었습니다. 실행기를 다시 실행하세요.');}await enter();}
catch(e){$('auth-status').textContent=e.message;}
