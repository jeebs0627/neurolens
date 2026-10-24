/* Isolated PostgreSQL/WASM tests. Never connects to production or reads real user data. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.DATASET_PGLITE_PATH||'@electric-sql/pglite');
const root=path.join(__dirname,'..');
const user='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002',admin='10000000-0000-0000-0000-000000000003';
(async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    const setup=fs.readFileSync(path.join(root,'SUPABASE_SETUP.md'),'utf8').match(/```sql\s*([\s\S]*?)```/)[1];
    await db.exec(setup);
    const can=async(role,column)=>(await db.query("select has_column_privilege($1,'public.profiles',$2,'UPDATE') as allowed",[role,column])).rows[0].allowed;
    assert.equal(await can('authenticated','role'),false);
    assert.equal(await can('authenticated','name'),true);
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
      ($1,'user@example.invalid','{"name":"User","role":"admin"}'),
      ($2,'other@example.invalid','{"name":"Other"}'),
      ($3,'admin@example.invalid','{"name":"Admin"}')`,[user,other,admin]);
    await db.query("update public.profiles set role='admin' where id=$1",[admin]);
    const signIn=async id=>{await db.exec('reset role;set role authenticated;');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
    const isAdmin=async()=>(await db.query('select public.is_admin() as value')).rows[0].value;
    await signIn(user);assert.equal(await isAdmin(),false);
    console.log('PASS fresh setup and signup metadata cannot create administrator privileges');

    // Reproduce the old broad grant (including a leftover column grant), only in this fixture.
    await db.exec('reset role;grant update on public.profiles to public,anon,authenticated;grant update(role) on public.profiles to authenticated;');
    await signIn(user);await db.query("update public.profiles set role='admin' where id=$1",[user]);
    assert.equal(await isAdmin(),true);
    await db.exec('reset role;');await db.query("update public.profiles set role='user' where id=$1",[user]);
    const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261024_profile_role_hardening.sql'),'utf8');
    await db.exec(migration);await db.exec(migration);
    for(const column of ['id','email','role','created_at'])assert.equal(await can('authenticated',column),false,column);
    assert.equal(await can('anon','name'),false);assert.equal(await can('anon','role'),false);
    assert.equal(await can('service_role','role'),true);
    await signIn(user);
    await db.query('update public.profiles set name=$1 where id=$2',['Updated name',user]);
    assert.equal((await db.query('select name from public.profiles where id=$1',[user])).rows[0].name,'Updated name');
    const denied=async(sql,args)=>assert.rejects(db.query(sql,args),e=>e.code==='42501');
    await denied("update public.profiles set role='admin' where id=$1",[user]);
    await denied("update public.profiles set name='Changed',role='admin' where id=$1",[user]);
    await denied("update public.profiles set email='changed@example.invalid' where id=$1",[user]);
    await denied('update public.profiles set id=$1 where id=$2',[other,user]);
    await denied('update public.profiles set created_at=now() where id=$1',[user]);
    assert.equal((await db.query("update public.profiles set name='Other changed' where id=$1 returning id",[other])).rows.length,0);
    assert.equal((await db.query('select * from public.profiles')).rows.length,1);
    assert.equal(await isAdmin(),false);
    await db.query("insert into public.test_results(user_id,result) values($1,'{}')",[user]);
    await denied("insert into public.test_results(user_id,result) values($1,'{}')",[other]);
    assert.equal((await db.query('select * from public.test_results')).rows.length,1);
    await signIn(admin);assert.equal(await isAdmin(),true);
    assert.equal((await db.query('select * from public.profiles')).rows.length,3);
    assert.equal((await db.query('select * from public.test_results')).rows.length,1);
    await denied("update public.profiles set role='admin' where id=$1",[user]);
    await db.exec('reset role;set role anon;');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await denied("update public.profiles set name='Anonymous' where id=$1",[user]);
    await db.exec('reset role;set role service_role;');
    await db.query("update public.profiles set role='admin' where id=$1",[other]);
    await db.exec('reset role;');
    await db.query("update public.profiles set role='user' where id=$1",[other]);
    assert.deepEqual((await db.query('select role,count(*)::int as n from public.profiles group by role order by role')).rows,
      [{role:'admin',n:1},{role:'user',n:2}]);
    console.log('PASS legacy escalation reproduced and blocked; migration reruns safely; own-name edits, result saving, owner isolation, existing admin reads and server role maintenance preserved');
  }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
