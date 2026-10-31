// 공용 저장소 도우미 — Upstash Redis REST API를 fetch로 직접 호출
import { readToken, stillValid, MASTER, AK } from './auth.js';
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

// 모든 API 앞단: 저장소 연결 확인 + 로그인 출입증 확인
// - 보기(GET)는 출입증 서명만 확인해요 (Redis 명령을 쓰지 않아요)
// - 수정(GET 말고 전부)은 관리자만 되고, 저장된 계정과 한 번 더 맞춰 봐요
// 통과하면 req.user = { id, name, role, v }
export async function guard(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) {
    res.status(500).json({ error: '저장소가 연결되지 않았어요. Vercel 프로젝트의 Storage 탭에서 Upstash Redis를 연결한 뒤 다시 배포하세요.' });
    return false;
  }
  const user = readToken(req.headers['x-auth']);
  if (!user) {
    res.status(401).json({ error: '로그인하세요.', locked: true });
    return false;
  }
  req.user = user;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (user.role !== 'admin') {
    res.status(403).json({ error: '보기 전용 계정이라 수정할 수 없어요. 관리자에게 부탁하세요.', readOnly: true });
    return false;
  }
  const raw = user.id === MASTER ? null : await redis('GET', AK.user(user.id));
  if (!stillValid(user, raw)) {
    res.status(401).json({ error: '계정 정보가 바뀌었어요. 다시 로그인하세요.', locked: true });
    return false;
  }
  return true;
}

// 로그인 실패를 접속 주소별로 10분간 세고, 10번을 넘으면 10분 동안 막아요
export async function tooManyFails(req, kind, failed) {
  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim().slice(0, 64);
  const key = `${kind}fail:${ip}`;
  if (!failed) return Number(await redis('GET', key)) > 10;
  const [n] = await pipeline([['INCR', key], ['EXPIRE', key, 600]]);
  return n > 10;
}

export function fail(res, e) {
  if (e instanceof UserError) return res.status(400).json({ error: e.message });
  return res.status(500).json({ error: '서버 오류가 났어요. 잠시 후 다시 시도하세요.' });
}
