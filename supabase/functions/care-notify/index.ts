// =============================================================================
// care-notify — 카카오 알림톡 발송 디스패처 (Supabase Edge Function)
//
// 동작
//   1) care_claim_due 로 발송 예정 건을 원자적으로 선점 (중복 발송 방지)
//   2) 알림톡 제공사 API로 발송 (기본 Solapi) — 자격증명이 없으면 dry-run(simulated)
//   3) care_mark_sent 으로 결과 기록 (성공 시 복구 토큰 링크는 즉시 폐기)
//
// 인증 (2중)
//   · Supabase 게이트웨이: 유효한 프로젝트 JWT 필요 (verify_jwt = true)
//   · 함수 자체: x-cron-secret 헤더가 Vault의 care_cron_secret 과 일치해야 함
//     → 시크릿을 함수 환경변수로 따로 넣지 않아도 되게 Vault에서 직접 읽는다
//
// 환경변수 (제공사 계약 후 대시보드에서 설정 — 없으면 dry-run 유지)
//   ALIMTALK_PROVIDER       solapi | none            (기본 solapi, 키 없으면 자동 none)
//   SOLAPI_API_KEY          Solapi API Key
//   SOLAPI_API_SECRET       Solapi API Secret
//   ALIMTALK_SENDER         사전 등록된 발신번호 (예: 0212345678)
//   KAKAO_PF_ID             카카오 비즈채널 pfId
//   KAKAO_TEMPLATE_CHECKIN  D1~D6 체크인 템플릿 ID
//   KAKAO_TEMPLATE_REMEASURE D7 재측정 템플릿 ID
//   CARE_LINK_URL           링크 버튼 베이스 URL (예: https://neurolens.vercel.app)
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROVIDER = (Deno.env.get("ALIMTALK_PROVIDER") ?? "solapi").toLowerCase();
const SOLAPI_KEY = Deno.env.get("SOLAPI_API_KEY") ?? "";
const SOLAPI_SECRET = Deno.env.get("SOLAPI_API_SECRET") ?? "";
const SENDER = (Deno.env.get("ALIMTALK_SENDER") ?? "").replace(/\D/g, "");
const PF_ID = Deno.env.get("KAKAO_PF_ID") ?? "";
const TPL_CHECKIN = Deno.env.get("KAKAO_TEMPLATE_CHECKIN") ?? "";
const TPL_REMEASURE = Deno.env.get("KAKAO_TEMPLATE_REMEASURE") ?? "";
const LINK_BASE = (Deno.env.get("CARE_LINK_URL") ?? "").replace(/\/+$/, "");

/** 제공사 자격증명이 모두 있는지 — 하나라도 없으면 dry-run 으로 떨어진다 */
function providerReady(): boolean {
  return PROVIDER === "solapi" && !!(SOLAPI_KEY && SOLAPI_SECRET && SENDER && PF_ID &&
    TPL_CHECKIN && TPL_REMEASURE);
}

async function rpc(fn: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Vault 에 저장된 디스패치 시크릿 (함수/크론이 같은 값을 공유) */
async function cronSecret(): Promise<string> {
  const v = await rpc("care_cron_secret", {}) as string | null;
  return (v ?? "").trim();
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Solapi HMAC-SHA256 인증 헤더 */
async function solapiAuth(): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SOLAPI_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(date + salt));
  return `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${hex(sig)}`;
}

type Job = {
  id: string;
  kind: "checkin" | "remeasure";
  day: number | null;
  phone: string;
  message: string;
  variables: Record<string, string>;
  linkPath: string | null;
  attempts: number;
};

/** 알림톡 1건 발송 → provider 메시지 ID */
async function sendSolapi(job: Job): Promise<string> {
  const link = job.linkPath ? `${LINK_BASE}${job.linkPath}` : LINK_BASE;
  const templateId = job.kind === "remeasure" ? TPL_REMEASURE : TPL_CHECKIN;
  const buttonName = job.kind === "remeasure" ? "재측정 하러 가기" : "체크인 바로가기";

  const payload = {
    message: {
      to: job.phone,
      from: SENDER,
      text: job.message, // 심사 통과 템플릿 본문과 동일해야 함
      kakaoOptions: {
        pfId: PF_ID,
        templateId,
        // 알림톡 발송 실패 시 문자로 대체 발송하지 않음 (동의 범위 밖)
        disableSms: true,
        variables: { ...job.variables, "#{link}": link },
        buttons: [{ buttonName, buttonType: "WL", linkMo: link, linkPc: link }],
      },
    },
  };

  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: await solapiAuth() },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`solapi ${res.status} ${body.slice(0, 300)}`);
  let msgId = "";
  try {
    const j = JSON.parse(body);
    msgId = j.messageId ?? j.groupId ?? "";
  } catch { /* 응답 파싱 실패는 무시 (전송은 성공) */ }
  return msgId;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- 커스텀 인증: Vault 시크릿과 대조 ---
  let expected = "";
  try {
    expected = await cronSecret();
  } catch (e) {
    return json({ error: "secret_unavailable", detail: String(e) }, 500);
  }
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!expected || given.length !== expected.length || given !== expected) {
    return json({ error: "forbidden" }, 403);
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const dryRunOnly = url.searchParams.get("dryRun") === "1";

  // 이전 실행에서 sending 상태로 멈춘 건 정리
  try {
    await rpc("care_requeue_stuck", {});
  } catch { /* 정리 실패는 발송을 막지 않는다 */ }

  let jobs: Job[] = [];
  try {
    jobs = (await rpc("care_claim_due", { p_limit: limit })) as Job[] ?? [];
  } catch (e) {
    return json({ error: "claim_failed", detail: String(e) }, 500);
  }

  const ready = providerReady() && !dryRunOnly;
  const out = {
    claimed: jobs.length, sent: 0, simulated: 0, failed: 0,
    provider: ready ? PROVIDER : "dry-run",
  };

  for (const job of jobs) {
    try {
      if (!ready) {
        // 자격증명 미설정 → 실제 발송 없이 파이프라인만 검증 (내용은 로그로 확인)
        console.log(`[dry-run] ${job.kind} → ${mask(job.phone)}\n${job.message}`);
        await rpc("care_mark_sent", {
          p_id: job.id, p_status: "simulated", p_provider: "dry-run",
          p_error: "제공사 자격증명 미설정 — 실제 발송되지 않았습니다",
        });
        out.simulated++;
      } else {
        const msgId = await sendSolapi(job);
        await rpc("care_mark_sent", {
          p_id: job.id, p_status: "sent", p_provider: PROVIDER, p_msg_id: msgId,
        });
        out.sent++;
      }
    } catch (e) {
      const msg = String(e);
      console.error(`[send failed] ${job.id} ${msg}`);
      await rpc("care_mark_sent", {
        // 3회까지는 재시도 대기(pending), 이후 실패 확정
        p_id: job.id, p_status: job.attempts >= 3 ? "failed" : "pending",
        p_provider: PROVIDER, p_error: msg,
      }).catch(() => {});
      out.failed++;
    }
  }

  return json(out);
});

function mask(p: string): string {
  return p.replace(/^(\d{3})\d+(\d{4})$/, "$1-****-$2");
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
