// 개인 로그인 · 등급(관리자 / 일반)
// - 사람마다 아이디 · 비밀번호로 로그인하고, 서버가 서명한 출입증(토큰)을 받아요
// - 관리자: 보기 + 모든 수정, 사람 관리 / 일반: 보기만
// - 출입증은 서명만 확인해서 Redis 명령을 아껴요. 수정 요청과 변경 확인(state)할 때만 저장된 계정과 맞춰 봐요
// - 공용 팀 비밀번호(TEAM_PASSWORD)로 들어오면 '공용' 일반 계정이 돼요 (관리자가 막을 수 있어요)
// - 아이디 admin + 편집 비밀번호(EDIT_PASSWORD)는 항상 관리자로 들어가는 비상 열쇠예요
import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET = 'gwj3-auth|' + (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '');
const TOKEN_DAYS = 180;

export const MASTER = 'admin';
export const TEAM = '_team';
export const AK = {
  user: id => `user:${id}`,
  ids: 'user-ids',
};
export const ROLES = ['admin', 'member'];

const b64 = s => Buffer.from(s).toString('base64url');
const sig = s => createHmac('sha256', SECRET).update(s).digest('base64url');

// 비상 열쇠 출입증의 버전: 편집 비밀번호가 바뀌면 예전 출입증은 못 써요
export const masterVer = () => sig('master|' + (process.env.EDIT_PASSWORD || '')).slice(0, 10);

export function makeToken(u) {
  const body = b64(JSON.stringify({ u: u.id, n: u.name, r: u.role, v: u.v, e: Date.now() + TOKEN_DAYS * 864e5 }));
  return body + '.' + sig(body);
}

export function readToken(t) {
  const [body, s] = String(t || '').split('.');
  if (!body || !s) return null;
  const want = Buffer.from(sig(body)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.u || !(p.e > Date.now())) return null;
    return { id: p.u, name: p.n || p.u, role: ROLES.includes(p.r) ? p.r : 'member', v: p.v };
  } catch { return null; }
}

export function hashPw(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(pw), salt, 32).toString('hex') };
}
export function checkPw(pw, rec) {
  if (!rec?.salt || !rec?.hash) return false;
  const a = Buffer.from(hashPw(pw, rec.salt).hash, 'hex'), b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// 저장된 계정(JSON 문자열 또는 null)과 출입증이 아직 맞는지
//   공용 계정은 저장된 게 없으면 기본값(허용, 버전 0)
export function stillValid(user, raw) {
  if (user.id === MASTER) return user.v === masterVer();
  let rec = null;
  try { rec = raw ? JSON.parse(raw) : null; } catch { rec = null; }
  if (user.id === TEAM) rec = rec || { role: 'member', v: 0 };
  if (!rec || rec.off) return false;
  return rec.v === user.v && rec.role === user.role;
}

export const publicUser = u => ({ id: u.id, name: u.name, role: u.role });
