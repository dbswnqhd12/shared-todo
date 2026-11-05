// IST 월간 분석 (회송 · 과매입 · 반출)
//   GET /api/report?month=YYYY-MM → 분석 결과 + 카카오톡용 요약 글(text)
// 화면은 /report.html 에서 봐요.
import { guard, fail } from '../lib/store.js';
import { buildIstReport } from '../lib/ist-report.js';

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    return res.status(200).json(await buildIstReport(String(req.query?.month || '')));
  } catch (e) {
    return fail(res, e);
  }
}
