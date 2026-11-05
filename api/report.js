// IST 리포트 (회송 · 과매입 · 반출)
//   GET /api/report?today=1               → 오늘 할 일 (매일 아침 7시 기준 목록, 처음 열 때 만들어요)
//   GET /api/report?today=1&rebuild=1     → 오늘 할 일을 지금 데이터로 다시 만들기
//   GET /api/report?month=YYYY-MM         → 월 결산 숫자
//   GET /api/report?month=YYYY-MM&xlsx=1  → 엑셀 결산표 (결산 · 회송 · 과매입 · 반출)
// 화면: /today.html (오늘 할 일), /report.html (월 결산), IST 탭 맨 위 Today 카드
import { guard, fail } from '../lib/store.js';
import { buildIstReport, reportXlsx } from '../lib/ist-report.js';
import { getToday } from '../lib/ist-today.js';

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    const q = req.query || {};
    if (q.today) return res.status(200).json(await getToday({ rebuild: !!q.rebuild }));
    const rp = await buildIstReport(String(q.month || ''));
    if (q.xlsx) {
      const name = `IST결산_${rp.month.replace('-', '')}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="IST_${rp.month}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
      return res.status(200).send(Buffer.from(reportXlsx(rp)));
    }
    const { _detail, ...out } = rp;
    return res.status(200).json(out);
  } catch (e) {
    return fail(res, e);
  }
}
