// IST 월 결산 (회송 · 과매입 · 반출)
//   GET /api/report?month=YYYY-MM          → 결산 숫자 + 카카오톡용 요약 글(text)
//   GET /api/report?month=YYYY-MM&xlsx=1   → 엑셀 결산표 (결산 · 완료 내역 · 남은 내역)
// 화면은 /report.html 에서 봐요.
import { guard, fail } from '../lib/store.js';
import { buildIstReport, reportXlsx } from '../lib/ist-report.js';

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    const rp = await buildIstReport(String(req.query?.month || ''));
    if (req.query?.xlsx) {
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
