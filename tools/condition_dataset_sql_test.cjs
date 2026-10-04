/* Run against isolated PostgreSQL/WASM, never the production database.
 * Install @electric-sql/pglite in a temp prefix and set DATASET_PGLITE_PATH if needed.
 * Crypto stubs test authorization/control flow only, not cryptographic primitives. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.DATASET_PGLITE_PATH||'@electric-sql/pglite');
(async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select decode(left(repeat(md5(random()::text),10),n*2),'hex') $$;
      create function extensions.digest(t text,algorithm text) returns bytea language sql as $$ select decode(md5(t)||md5(t),'hex') $$;
      grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    for(const f of ['20261003_newbiz_research.sql','20261004_condition_dataset.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',f),'utf8'));
    const user='10000000-0000-0000-0000-000000000001',reviewer='10000000-0000-0000-0000-000000000002',attempt='20000000-0000-0000-0000-000000000001',token='a'.repeat(48);
    await db.exec(`insert into auth.users values('${user}'),('${reviewer}');insert into public.dataset_reviewers values('${reviewer}',now());set role anon;`);
    const call=async(fn,args)=>db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args);
    const begin=()=>call('dataset_research_begin',[attempt,token,{research:true},{attemptId:attempt,demo:false},{dataset:{schema:'condition-dataset-1',attemptId:attempt}}]);
    await assert.rejects(call('dataset_list',[]));await assert.rejects(db.query('select * from public.newbiz_research_sessions'));
    const first=(await begin()).rows[0].value,again=(await begin()).rows[0].value;assert.equal(first.session_id,again.session_id);
    await assert.rejects(call('dataset_research_begin',[attempt,'b'.repeat(48),{research:true},{attemptId:attempt},{dataset:{schema:'condition-dataset-1',attemptId:attempt}}]));
    await assert.rejects(call('dataset_research_begin',[attempt,token,{research:false},{attemptId:attempt},{dataset:{schema:'condition-dataset-1',attemptId:attempt}}]));
    await call('newbiz_research_chunk',[first.session_id,token,0,'test']);await call('newbiz_research_finish',[first.session_id,token,1,4,'a'.repeat(64)]);
    assert.equal((await begin()).rows[0].value.status,'complete');
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${user}';`);
    assert.equal((await call('dataset_access',[])).rows[0].value,false);await assert.rejects(call('dataset_detail',[first.session_id]));await assert.rejects(call('dataset_list',[]));await assert.rejects(db.query(`insert into public.dataset_reviewers(user_id) values('${user}')`));
    await db.exec(`set request.jwt.claim.sub='${reviewer}';`);
    assert.equal((await call('dataset_access',[])).rows[0].value,true);const list=(await call('dataset_list',[])).rows[0].value;assert.equal(list.length,1);assert.equal(list[0].token_hash,undefined);
    await call('dataset_annotate',[first.session_id,'action',{note:'fixture',status:'reviewing'}]);
    const detail=(await call('dataset_detail',[first.session_id,true])).rows[0].value;assert.equal(detail.annotations.length,1);assert.equal(detail.chunks.length,1);assert.equal(detail.token_hash,undefined);
    await db.exec('reset role;set role anon;');await assert.rejects(call('dataset_annotate',[first.session_id,'action',{}]));await call('newbiz_research_withdraw',[first.session_id,token]);
    await db.exec('reset role;');assert.equal((await db.query('select count(*)::int as n from public.dataset_annotations')).rows[0].n,0);
    await db.exec('set role anon;');
    const legacyAttempt='20000000-0000-0000-0000-000000000003',meta={attemptId:legacyAttempt},summary={dataset:{schema:'condition-dataset-1',attemptId:legacyAttempt}};
    const legacy=(await call('newbiz_research_begin',[{research:true},meta,summary])).rows[0].value;
    await call('newbiz_research_chunk',[legacy.session_id,legacy.upload_token,0,'test']);await call('newbiz_research_finish',[legacy.session_id,legacy.upload_token,1,4,'b'.repeat(64)]);
    const adopted=(await call('dataset_research_begin',[legacyAttempt,legacy.upload_token,{research:true},meta,summary])).rows[0].value;assert.equal(adopted.session_id,legacy.session_id);assert.equal(adopted.status,'complete');
    console.log('PASS PostgreSQL migrations, anonymous writes, idempotent retry, private reviewer allowlist, admin reads, append-only notes, withdrawal cascade');
  }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
