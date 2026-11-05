// IST 월 결산 (회송 · 과매입 · 반출) + 말일 카카오톡 보내기
//   GET  /api/report?month=YYYY-MM          → 결산 숫자 + 카카오톡용 요약 글(text)
//   GET  /api/report?month=YYYY-MM&xlsx=1   → 엑셀 결산표 (결산 · 회송 · 과매입 · 반출)
//   GET  /api/report?dl=TOKEN               → 카톡 버튼으로 엑셀 받기 (비밀번호 없이, 31일 동안만)
//   GET  /api/report?kakao=status           → 카카오 연결 상태
//   GET  /api/report?kakao=start            → 카카오 로그인 주소 (연결하기)
//   GET  /api/report?code=…&state=…         → 카카오 로그인에서 돌아오는 곳
//   POST /api/report?kakao=send&month=…     → 지금 카톡으로 보내 보기
//   GET  /api/report?cron=1                 → Vercel 예약 실행 (매일 저녁 8시, 말일에만 보내고 다른 날은 카카오 연결만 유지)
// 화면은 /report.html 에서 봐요.
import { guard, fail, redis, kstToday } from '../lib/store.js';
import { buildIstReport, reportXlsx, isLastDayKst } from '../lib/ist-report.js';
import { PUBLIC_URL, kakaoReady, randomToken, startUrl, finishLogin, status, sendToMe, keepAlive } from '../lib/kakao.js';

const DL_DAYS = 31;

function sendXlsx(res, rp) {
  const name = `IST결산_${rp.month.replace('-', '')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="IST_${rp.month}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
  return res.status(200).send(Buffer.from(reportXlsx(rp)));
}

// 결산을 만들어 카톡으로 보내요: 요약 글 + [엑셀 받기] [결산표 보기]
async function sendReport(req, month) {
  // 미리보기 배포에서 시험할 때는 버튼도 미리보기 주소로 (실제 사이트는 회사 PC에서도 열리는 주소로)
  const base = process.env.VERCEL_ENV === 'preview' ? `https://${req.headers.host}` : PUBLIC_URL;
  const rp = await buildIstReport(month);
  const tok = randomToken();
  await redis('SET', `report:dl:${tok}`, rp.month, 'EX', DL_DAYS * 86400);
  await sendToMe(rp.text, [
    { title: '엑셀 받기', url: `${base}/api/report?dl=${tok}` },
    { title: '결산표 보기', url: `${base}/report.html?month=${rp.month}` },
  ]);
  return rp;
}

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
      const rp = await sendReport(req, today.slice(0, 7));
      return res.status(200).json({ sent: true, month: rp.month });
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
    if (q.kakao === 'status') return res.status(200).json(await status());
    if (q.kakao === 'start') {
      if (!kakaoReady()) return res.status(400).json({ error: 'Vercel 환경 변수에 KAKAO_REST_KEY가 아직 없어요.' });
      return res.status(200).json({ url: await startUrl(req) });
    }
    if (q.kakao === 'send') {
      if (req.method !== 'POST') return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
      const rp = await sendReport(req, String(q.month || ''));
      return res.status(200).json({ sent: true, month: rp.month });
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
    if (/카카오|kakao/i.test(e.message)) return res.status(400).json({ error: e.message });
    return fail(res, e);
  }
}
