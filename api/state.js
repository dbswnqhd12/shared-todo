// 화면이 쓰는 전체 상태 조회
//   GET /api/state?only=rev                       → { rev }  (변경 확인용, Redis 명령 1개)
//   GET /api/state?months=2026-08,2026-09,2026-10 → { rev, todos, templates, checks, today }
import { K, redis, pipeline, parseHash, guard, fail, kstToday } from '../lib/store.js';

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    if (req.query?.only === 'rev') {
      return res.status(200).json({ rev: Number(await redis('GET', K.rev)) || 0 });
    }
    const months = String(req.query?.months || '')
      .split(',')
      .filter(m => /^\d{4}-\d{2}$/.test(m))
      .slice(0, 3);
    const [rev, todos, templates, ...monthChecks] = await pipeline([
      ['GET', K.rev],
      ['HGETALL', K.todos],
      ['HGETALL', K.templates],
      ...months.map(m => ['HGETALL', K.checks(m)]),
    ]);
    const checks = {};
    for (const flat of monthChecks) {
      for (let i = 0; i < (flat || []).length; i += 2) {
        const [date, tid] = String(flat[i]).split('|');
        try { (checks[date] = checks[date] || {})[tid] = JSON.parse(flat[i + 1]); } catch { /* 건너뜀 */ }
      }
    }
    return res.status(200).json({
      rev: Number(rev) || 0,
      todos: parseHash(todos),
      templates: parseHash(templates),
      checks,
      months,
      today: kstToday(),
    });
  } catch (e) {
    return fail(res, e);
  }
}
