// IST 월 결산 (회송 · 과매입 · 반출) + 말일 자동 보내기 (이메일 엑셀 첨부 · 카카오톡)
//   GET  /api/report?month=YYYY-MM          → 결산 숫자 + 카카오톡용 요약 글(text)
//   GET  /api/report?month=YYYY-MM&xlsx=1   → 엑셀 결산표 (결산 · 회송 · 과매입 · 반출)
//   GET  /api/report?dl=TOKEN               → 카톡 버튼으로 엑셀 받기 (비밀번호 없이, 31일 동안만)
//   GET  /api/report?kakao=status           → 카카오 연결 상태
//   GET  /api/report?kakao=start            → 카카오 로그인 주소 (연결하기)
//   GET  /api/report?code=…&state=…         → 카카오 로그인에서 돌아오는 곳
//   POST /api/report?kakao=send&month=…     → 지금 보내 보기 (설정된 메일 · 카톡 모두)
//   GET  /api/report?cron=1                 → Vercel 예약 실행 (매일 저녁 8시, 말일에만 보내고 다른 날은 카카오 연결만 유지)
// 화면은 /report.html 에서 봐요.
import { guard, fail, redis, kstToday } from '../lib/store.js';
import { buildIstReport, reportXlsx, isLastDayKst } from '../lib/ist-report.js';
import { mailReady, mailTo, sendMail } from '../lib/mail.js';
import { PUBLIC_URL, kakaoReady, randomToken, startUrl, finishLogin, status, sendToMe, keepAlive } from '../lib/kakao.js';

const DL_DAYS = 31;

function sendXlsx(res, rp) {
  const name = `IST결산_${rp.month.replace('-', '')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="IST_${rp.month}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
  return res.status(200).send(Buffer.from(reportXlsx(rp)));
}

// 결산을 만들어 보내요: 이메일(엑셀 첨부)과 카카오톡(요약 + [엑셀 받기] 버튼) 중 설정된 곳으로
async function sendReport(req, month) {
  // 미리보기 배포에서 시험할 때는 링크도 미리보기 주소로 (실제 사이트는 회사 PC에서도 열리는 주소로)
  const base = process.env.VERCEL_ENV === 'preview' ? `https://${req.headers.host}` : PUBLIC_URL;
  const rp = await buildIstReport(month);
  const view = `${base}/report.html?month=${rp.month}`;
  const sent = [], errors = [];
  if (mailReady()) {
    const mo = Number(rp.month.slice(5));
    const esc = v => String(v).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const td = 'style="padding:6px 12px;border:1px solid #D5DBE4;text-align:right"';
    const html = `<div style="font-family:'Malgun Gothic',sans-serif;font-size:14px;color:#18202C">
      <p><b>${rp.month.slice(0, 4)}년 ${mo}월 IST 결산</b>${rp.partial ? ` (${rp.cut} 기준)` : ''}</p>
      <table style="border-collapse:collapse"><tr style="background:#2557A7;color:#fff"><th style="padding:6px 12px">구분</th><th style="padding:6px 12px">전월 이월</th><th style="padding:6px 12px">신규</th><th style="padding:6px 12px">완료</th><th style="padding:6px 12px">남은 건</th></tr>
      ${[...rp.rows, rp.total].map(r => `<tr><td ${td.replace('right', 'left')}>${esc(r.name)}</td><td ${td}>${r.carry}</td><td ${td}>${r.added}</td><td ${td}>${r.done}</td><td ${td}>${r.left}</td></tr>`).join('')}</table>
      <p>자세한 내역은 첨부한 엑셀에 있어요 (결산 · 회송 · 과매입 · 반출 시트).<br><a href="${view}">사이트에서 결산표 보기</a></p></div>`;
    try {
      await sendMail({ subject: `[GWJ3 IB] ${mo}월 IST 결산`, text: rp.text, html, filename: `IST결산_${rp.month.replace('-', '')}.xlsx`, file: reportXlsx(rp) });
      sent.push('mail');
    } catch (e) { errors.push(e.message); }
  }
  if ((await status()).connected) {
    try {
      const tok = randomToken();
      await redis('SET', `report:dl:${tok}`, rp.month, 'EX', DL_DAYS * 86400);
      await sendToMe(rp.text, [{ title: '엑셀 받기', url: `${base}/api/report?dl=${tok}` }, { title: '결산표 보기', url: view }]);
      sent.push('kakao');
    } catch (e) { errors.push(e.message); }
  }
  if (!sent.length) throw new SendError(errors[0] || '보낼 곳이 아직 설정되지 않았어요.');
  return { month: rp.month, sent, errors };
}
class SendError extends Error {}

const page = (res, msg) => res.status(302).setHeader('Location', '/report.html?kakao=' + encodeURIComponent(msg)).end();

export default async function handler(req, res) {
  const q = req.query || {};
  try {
    // 카톡 버튼으로 엑셀 받기 — 링크 자체가 열쇠라 비밀번호를 묻지 않아요
    if (q.dl) {
      res.setHeader('Cache-Control', 'no-store');
      const month = await redis('GET', `report:dl:${String(q.dl).slice(0, 64)}`);
      if (!month) return res.status(410).send('링크가 만료됐어요. 사이트의 IST 결산 화면에서 엑셀을 받아 주세요.');
      return sendXlsx(res, await buildIstReport(month));
    }
    // 말일 예약 실행 (Vercel이 CRON_SECRET을 붙여서 불러요)
    if (q.cron) {
      if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
      const today = kstToday();
      if (!isLastDayKst(today)) return res.status(200).json({ skipped: '말일이 아니에요', today, renewed: await keepAlive().catch(() => false) });
      return res.status(200).json(await sendReport(req, today.slice(0, 7)));
    }
    // 카카오 로그인에서 돌아옴
    if (q.code && q.state) {
      try { await finishLogin(req, String(q.code), String(q.state)); return page(res, 'ok'); }
      catch (e) { return page(res, e.message); }
    }
    if (q.error && q.state) return page(res, '카카오 연결을 취소했어요.');
  } catch (e) {
    return fail(res, e);
  }

  if (!(await guard(req, res))) return;
  try {
    if (q.kakao === 'status') return res.status(200).json({ ...(await status()), mail: mailReady(), mailTo: mailTo() });
    if (q.kakao === 'start') {
      if (!kakaoReady()) return res.status(400).json({ error: 'Vercel 환경 변수에 KAKAO_REST_KEY가 아직 없어요.' });
      return res.status(200).json({ url: await startUrl(req) });
    }
    if (q.kakao === 'send') {
      if (req.method !== 'POST') return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
      return res.status(200).json(await sendReport(req, String(q.month || '')));
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    const rp = await buildIstReport(String(q.month || ''));
    if (q.xlsx) return sendXlsx(res, rp);
    const { _detail, ...out } = rp;
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof SendError || /카카오|kakao/i.test(e.message)) return res.status(400).json({ error: e.message });
    return fail(res, e);
  }
}
