// 카카오톡 "나에게 보내기" — 연결한 카카오 계정의 '나와의 채팅'으로 메시지를 보내요 (무료)
// Vercel 환경 변수:
//   KAKAO_REST_KEY       카카오 개발자 앱의 REST API 키 (필수)
//   KAKAO_CLIENT_SECRET  앱에서 Client Secret을 켰을 때만
//   PUBLIC_URL           카톡 버튼이 여는 주소 (기본: 회사 PC에서도 열리는 Cloudflare 주소)
import { randomBytes } from 'node:crypto';
import { redis, pipeline } from './store.js';

const TOKEN_KEY = 'kakao:token';
export const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://shared-todo-7tm.pages.dev').replace(/\/$/, '');
export const kakaoReady = () => !!process.env.KAKAO_REST_KEY;
export const randomToken = (n = 18) => randomBytes(n).toString('base64url');

// 카카오 로그인 뒤 돌아오는 주소 (카카오 앱의 Redirect URI에 똑같이 등록해야 해요)
export const redirectUri = req => `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/report`;

export async function startUrl(req) {
  const state = randomToken(12);
  await redis('SET', `kakao:state:${state}`, '1', 'EX', 600);
  const q = new URLSearchParams({ client_id: process.env.KAKAO_REST_KEY, redirect_uri: redirectUri(req), response_type: 'code', scope: 'talk_message', state });
  return 'https://kauth.kakao.com/oauth/authorize?' + q;
}

async function tokenCall(params) {
  const p = new URLSearchParams({ client_id: process.env.KAKAO_REST_KEY, ...params });
  if (process.env.KAKAO_CLIENT_SECRET) p.set('client_secret', process.env.KAKAO_CLIENT_SECRET);
  const r = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: p });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('카카오 토큰 오류: ' + (d.error_description || d.error || r.status));
  return d;
}

function save(d, old = {}) {
  const now = Date.now();
  const t = {
    access: d.access_token,
    accessExp: now + (d.expires_in || 21599) * 1000,
    refresh: d.refresh_token || old.refresh,                 // 리프레시 토큰은 만료가 가까울 때만 새로 와요
    refreshExp: d.refresh_token ? now + (d.refresh_token_expires_in || 5184000) * 1000 : old.refreshExp,
    at: old.at || now,
  };
  return redis('SET', TOKEN_KEY, JSON.stringify(t)).then(() => t);
}

// 카카오 로그인에서 돌아왔을 때: state 확인 → 토큰 받아 저장
export async function finishLogin(req, code, state) {
  const [ok] = await pipeline([['GET', `kakao:state:${state}`], ['DEL', `kakao:state:${state}`]]);
  if (!ok) throw new Error('연결 요청이 오래됐어요. 결산 화면에서 다시 눌러 주세요.');
  const d = await tokenCall({ grant_type: 'authorization_code', redirect_uri: redirectUri(req), code });
  await save(d, { at: Date.now() });
}

export async function status() {
  const raw = await redis('GET', TOKEN_KEY);
  if (!raw) return { ready: kakaoReady(), connected: false };
  const t = JSON.parse(raw);
  return { ready: kakaoReady(), connected: true, refreshExp: t.refreshExp || null };
}

async function accessToken() {
  const raw = await redis('GET', TOKEN_KEY);
  if (!raw) throw new Error('카카오톡이 아직 연결되지 않았어요.');
  const t = JSON.parse(raw);
  if (t.access && t.accessExp > Date.now() + 60e3) return t.access;
  if (!t.refresh) throw new Error('카카오 연결이 끊겼어요. 다시 연결해 주세요.');
  return (await save(await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh }), t)).access;
}

// 매일 예약 실행 때 불러요: 리프레시 토큰이 한 달 안에 끝나면 미리 새로 받아 연결이 안 끊기게 해요
// (카카오는 남은 기간이 한 달 아래일 때만 새 리프레시 토큰을 줘요)
export async function keepAlive() {
  const raw = await redis('GET', TOKEN_KEY);
  if (!raw || !kakaoReady()) return false;
  const t = JSON.parse(raw);
  if (!t.refresh || (t.refreshExp && t.refreshExp - Date.now() > 30 * 864e5)) return false;
  await save(await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh }), t);
  return true;
}

// 텍스트 메시지 + 버튼 최대 2개 [{ title, url }]
export async function sendToMe(text, buttons) {
  const access = await accessToken();
  const link = u => ({ web_url: u, mobile_web_url: u });
  const tpl = {
    object_type: 'text',
    text: text.length > 200 ? text.slice(0, 199) + '…' : text,
    link: link(buttons[0]?.url || PUBLIC_URL),
    buttons: buttons.slice(0, 2).map(b => ({ title: b.title, link: link(b.url) })),
  };
  const r = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ template_object: JSON.stringify(tpl) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.result_code !== 0) throw new Error('카카오톡 보내기 오류: ' + (d.msg || r.status));
}
