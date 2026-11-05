// IST 리포트 (회송 · 과매입 · 반출)
//   GET /api/report?month=YYYY-MM         → 월 결산 숫자
//   GET /api/report?month=YYYY-MM&xlsx=1  → 엑셀 결산표 (결산 · 회송 · 과매입 · 반출)
// 화면: /report.html
import { guard, fail } from '../lib/store.js';
import { buildIstReport, reportXlsx } from '../lib/ist-report.js';

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    const q = req.query || {};
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
