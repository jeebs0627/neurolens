'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {PGlite}=require(process.env.DATASET_PGLITE_PATH||'@electric-sql/pglite');
(async()=>{
 const db=new PGlite(),secret='offline-test-secret-'.repeat(4),hash=value=>createHash('sha256').update(value).digest('hex');
 try{
  await db.exec('create role anon;create role authenticated;grant usage on schema public to anon,authenticated;');
  const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261024_ai_call_guard.sql'),'utf8');
  await db.exec(migration);await db.exec(migration);
  await db.query('insert into public.ai_guard_config(secret_sha256,daily_limit) values($1,3)',[hash(secret)]);
  const sid=randomUUID(),ip=hash('ip'),key=hash('request'),lease=randomUUID();
  const call=async(action,overrides={})=>{
   const args={p_secret:secret,p_action:action,p_session:sid,p_ip:ip,p_key:key,p_kind:'profile',p_lease:lease,p_attempt:1,p_user:hash('user'),...overrides};
   return (await db.query(`select public.ai_guard(${Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')}) as value`,Object.values(args))).rows[0].value;
  };
  await db.exec('set role anon;');
  await assert.rejects(db.query('select * from public.ai_guard_config'));
  await assert.rejects(db.query('select * from public.ai_guard_requests'));
  await assert.rejects(call('session',{p_secret:'wrong-secret-that-is-long-enough-to-pass-the-length-test'}));
  assert.equal((await call('begin')).status,401);
  assert.equal((await call('session')).ok,true);
  assert.equal((await call('begin')).ok,true);
  assert.equal((await call('begin')).status,202);
  assert.equal((await call('charge')).ok,true);
  assert.equal((await call('charge')).ok,true); // A retried reservation does not double count.
  assert.equal((await call('charge',{p_attempt:2})).ok,true);
  assert.equal((await call('charge',{p_attempt:3})).ok,true);
  assert.equal((await call('charge',{p_attempt:4})).code,'daily_limit_reached');
  assert.equal((await call('finish',{p_cipher:'encrypted-fixture'})).ok,true);
  assert.equal((await call('begin')).cached,'encrypted-fixture');
  assert.equal((await call('finish',{p_lease:randomUUID(),p_cipher:'wrong'})).status,409);
  await db.exec('reset role;');
  assert.equal((await db.query('select count(*)::int as n from public.ai_guard_calls')).rows[0].n,3);
  await db.exec('update public.ai_guard_config set daily_limit=300;truncate public.ai_guard_calls;');
  // Independent request/session identities share the same global budget.
  const jobs=Array.from({length:320},(_,i)=>({p_session:randomUUID(),p_ip:hash('ip-'+i),p_key:hash('request-'+i),p_lease:randomUUID(),p_user:hash('user-'+i)}));
  await db.exec('set role anon;');
  const results=await Promise.all(jobs.map(async args=>{await call('session',args);await call('begin',args);return call('charge',args);}));
  assert.equal(results.filter(x=>x.ok).length,300);
  assert.equal(results.filter(x=>x.code==='daily_limit_reached').length,20);
  console.log('PASS secret-only RPC; private tables; session authentication; deduplication; encrypted-cache storage; stale lease denial; exactly 300/320 concurrent calls permitted');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
