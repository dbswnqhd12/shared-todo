// 공용 저장소 도우미 — Upstash Redis REST API를 fetch로 직접 호출
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const K = {
  todos: 'shared-todos',
  templates: 'shift-templates',
  rev: 'rev',                       // 쓰기마다 1씩 증가 → 화면은 이 값만 확인해서 명령 수를 아낌
  checks: month => `checks:${month}`, // 월별 해시, 필드 = "YYYY-MM-DD|항목ID"
};
export const SHIFTS = ['day', 'eve', 'night'];

async function call(path, payload) {
  const r = await fetch(URL_ + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `Redis error ${r.status}`);
  return data;
}

export async function redis(...command) {
  return (await call('', command)).result;
}

export async function pipeline(commands) {
  const data = await call('/pipeline', commands);
  return data.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

export function parseHash(flat) {
  const out = [];
  for (let i = 0; i < (flat || []).length; i += 2) {
    try { out.push(JSON.parse(flat[i + 1])); } catch { /* 손상된 항목은 건너뜀 */ }
  }
  return out;
}

export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export class UserError extends Error {}

// 모든 API 앞단: 저장소 연결 확인 + (설정돼 있으면) 팀 비밀번호 확인
// 틀린 비밀번호는 접속 주소별로 10분간 세고, 10번을 넘으면 10분 동안 막아요.
export async function guard(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) {
    res.status(500).json({ error: '저장소가 연결되지 않았어요. Vercel 프로젝트의 Storage 탭에서 Upstash Redis를 연결한 뒤 다시 배포하세요.' });
    return false;
  }
  const pw = process.env.TEAM_PASSWORD;
  if (!pw) return true;
  let given = '';
  try { given = decodeURIComponent(req.headers['x-team-key'] || ''); } catch { given = ''; }
  if (given && given === pw) return true;
  if (given) {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim().slice(0, 64);
    const failKey = `teamfail:${ip}`;
    const [fails] = await pipeline([['INCR', failKey], ['EXPIRE', failKey, 600]]);
    if (fails > 10) {
      res.status(429).json({ error: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도하세요.', locked: true });
      return false;
    }
  }
  res.status(401).json({ error: given ? '비밀번호가 틀렸어요.' : '팀 비밀번호를 입력하세요.', locked: true });
  return false;
}

export function fail(res, e) {
  if (e instanceof UserError) return res.status(400).json({ error: e.message });
  return res.status(500).json({ error: '서버 오류가 났어요. 잠시 후 다시 시도하세요.' });
}
