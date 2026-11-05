// 이메일로 엑셀 결산표 보내기 (Resend, 무료 — 도메인 없이도 가입한 본인 메일로는 보낼 수 있어요)
// 설정은 결산 화면(report.html)의 '메일 설정'에서 저장해요 (Redis mail:config).
// Vercel 환경 변수 RESEND_API_KEY · REPORT_EMAIL 이 있으면 그쪽이 먼저예요.
//   REPORT_FROM  보내는 사람 (기본: GWJ3 IB <onboarding@resend.dev>)
import { redis } from './store.js';

const CONF_KEY = 'mail:config';

export async function mailConfig() {
  let c = {};
  try { c = JSON.parse((await redis('GET', CONF_KEY)) || '{}'); } catch { c = {}; }
  const key = process.env.RESEND_API_KEY || c.key || '';
  const to = String(process.env.REPORT_EMAIL || c.to || '').split(',').map(s => s.trim()).filter(Boolean);
  return { key, to, ready: !!(key && to.length) };
}

export async function saveMailConfig({ key, to }) {
  const old = await mailConfig();
  const email = String(to || '').trim();
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) throw new Error('받을 메일 주소가 올바르지 않아요.');
  const k = String(key || '').trim() || old.key;   // 키를 비워 두면 전에 넣은 키를 그대로 써요
  if (!/^re_[A-Za-z0-9_-]{10,}$/.test(k)) throw new Error('Resend API 키는 re_ 로 시작해요.');
  await redis('SET', CONF_KEY, JSON.stringify({ key: k, to: email, at: Date.now() }));
}

// 받는 주소는 화면에 가려서 보여 줘요 (ab***@gmail.com)
export const mask = to => to.map(a => a.replace(/^(.{2}).*(@.*)$/, '$1***$2'));

export async function sendMail({ subject, text, html, filename, file }) {
  const c = await mailConfig();
  if (!c.ready) throw new Error('메일 설정이 아직 없어요.');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.REPORT_FROM || 'GWJ3 IB <onboarding@resend.dev>',
      to: c.to, subject, text, html,
      attachments: file ? [{ filename, content: Buffer.from(file).toString('base64') }] : undefined,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('메일 보내기 오류: ' + (d.message || d.error || r.status));
  return d.id;
}
