/* =========================================================================
 * NeuroLens Auth — Supabase 이메일 회원가입/로그인 + 검사결과 저장 공통 모듈
 *
 * 사용하는 페이지는 아래 순서로 로드해야 합니다:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
 *   <script src="supabase-config.js"></script>
 *   <script src="auth.js"></script>
 *
 * DB 스키마 및 RLS 정책은 SUPABASE_SETUP.md 참고.
 * ========================================================================= */
(function () {
'use strict';

var cfg = window.NL_SUPABASE || {};
var configured = !!(cfg.url && cfg.anonKey
  && cfg.url.indexOf('YOUR-PROJECT') < 0
  && cfg.anonKey.indexOf('YOUR_') !== 0);

var client = null;
if (configured && window.supabase && window.supabase.createClient) {
  try { client = window.supabase.createClient(cfg.url, cfg.anonKey); } catch (e) { console.error('Supabase init 실패:', e); }
}

function noClient() { return Promise.reject(new Error('Supabase가 설정되지 않았습니다. supabase-config.js를 확인하세요.')); }

window.NLAuth = {
  /** supabase-config.js가 채워져 있고 클라이언트가 살아있는지 */
  enabled: !!client,
  client: client,

  /* ---------- 인증 ---------- */

  /** 현재 로그인 사용자 (없으면 null) */
  getUser: function () {
    if (!client) return Promise.resolve(null);
    return client.auth.getSession().then(function (r) {
      return (r.data && r.data.session && r.data.session.user) || null;
    });
  },

  /** 로그인 상태 변화 구독 — cb(user|null) 즉시 1회 + 변경 시마다 호출 */
  onAuth: function (cb) {
    if (!client) { cb(null); return; }
    this.getUser().then(cb);
    client.auth.onAuthStateChange(function (_ev, session) {
      cb((session && session.user) || null);
    });
  },

  /** 이메일 회원가입 — {user, session, needConfirm} */
  signUp: function (email, password, name) {
    if (!client) return noClient();
    return client.auth.signUp({
      email: email, password: password,
      options: { data: { name: name || '' } },
    }).then(function (r) {
      if (r.error) throw r.error;
      return {
        user: r.data.user, session: r.data.session,
        needConfirm: !r.data.session, // 세션이 없으면 이메일 인증 대기 상태
      };
    });
  },

  /** 이메일 로그인 */
  signIn: function (email, password) {
    if (!client) return noClient();
    return client.auth.signInWithPassword({ email: email, password: password })
      .then(function (r) { if (r.error) throw r.error; return r.data.user; });
  },

  signOut: function () {
    if (!client) return Promise.resolve();
    return client.auth.signOut();
  },

  /** 내 프로필 (profiles 행) — {id, email, name, role, created_at} | null */
  getProfile: function () {
    if (!client) return Promise.resolve(null);
    return this.getUser().then(function (u) {
      if (!u) return null;
      return client.from('profiles').select('*').eq('id', u.id).maybeSingle()
        .then(function (r) { return r.data || null; });
    });
  },

  isAdmin: function () {
    return this.getProfile().then(function (p) { return !!(p && p.role === 'admin'); });
  },

  /* ---------- 검사 결과 ---------- */

  /** 검사 결과 저장 → 저장된 행 id (비로그인/실패 시 null) */
  saveResult: function (result) {
    if (!client) return Promise.resolve(null);
    return this.getUser().then(function (u) {
      if (!u) return null;
      var p = (result && result['시험자정보']) || {};
      return client.from('test_results').insert({
        user_id: u.id,
        name: p['시험자명'] || '',
        mbti: String(result.MBTI || ''),
        holland: String(((result['직업흥미유형'] || {})['유형']) || ''),
        result: result,
      }).select('id').single().then(function (r) {
        if (r.error) { console.error('결과 저장 실패:', r.error); return null; }
        return r.data.id;
      });
    });
  },

  /** 내 검사 내역 (최신순, 리포트 본문 제외) */
  myResults: function () {
    if (!client) return Promise.resolve([]);
    return this.getUser().then(function (u) {
      if (!u) return [];
      return client.from('test_results')
        .select('id, created_at, name, mbti, holland')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    });
  },

  /** 결과 1건 (본인 것 또는 admin) — 행 전체 | null */
  getResult: function (id) {
    if (!client || !id) return Promise.resolve(null);
    return client.from('test_results').select('*').eq('id', id).maybeSingle()
      .then(function (r) { return r.data || null; });
  },

  /* ---------- 관리자 (RLS의 is_admin() 정책으로 접근 제어) ---------- */

  adminListProfiles: function () {
    if (!client) return Promise.resolve([]);
    return client.from('profiles').select('*').order('created_at', { ascending: false })
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  },

  adminListResults: function () {
    if (!client) return Promise.resolve([]);
    return client.from('test_results')
      .select('id, user_id, created_at, name, mbti, holland')
      .order('created_at', { ascending: false })
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  },
};
})();
