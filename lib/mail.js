// 이메일로 엑셀 결산표 보내기 (Resend, 무료 — 도메인 없이도 가입한 본인 메일로는 보낼 수 있어요)
// Vercel 환경 변수:
//   RESEND_API_KEY  Resend에서 만든 API 키
//   REPORT_EMAIL    받을 메일 주소 (Resend에 가입한 메일. 여러 개는 쉼표로 — 도메인 인증 뒤에만)
//   REPORT_FROM     보내는 사람 (기본: GWJ3 IB <onboarding@resend.dev>)
export const mailReady = () => !!(process.env.RESEND_API_KEY && process.env.REPORT_EMAIL);
const to = () => String(process.env.REPORT_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);

// 받는 주소는 화면에 가려서 보여 줘요 (ab***@gmail.com)
export const mailTo = () => to().map(a => a.replace(/^(.{2}).*(@.*)$/, '$1***$2'));

export async function sendMail({ subject, text, html, filename, file }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.REPORT_FROM || 'GWJ3 IB <onboarding@resend.dev>',
      to: to(), subject, text, html,
      attachments: file ? [{ filename, content: Buffer.from(file).toString('base64') }] : undefined,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('메일 보내기 오류: ' + (d.message || d.error || r.status));
  return d.id;
}
