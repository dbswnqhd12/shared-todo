// 화면이 쓰는 전체 상태 조회
//   GET /api/state?only=rev                       → { rev }  (변경 확인용, Redis 명령 1개 · 계정 확인도 같이 해요)
//   GET /api/state?months=2026-08,2026-09,2026-10 → { rev, todos, templates, checks, today }
import { K, redis, pipeline, parseHash, guard, fail, kstToday } from '../lib/store.js';
import { AK, MASTER, stillValid, publicUser } from '../lib/auth.js';

// 지운 계정 · 등급이 바뀐 계정은 여기서 걸러서 다시 로그인하게 해요
function kicked(req, res, raw) {
  if (stillValid(req.user, raw)) return false;
  res.status(401).json({ error: '계정 정보가 바뀌었어요. 다시 로그인하세요.', locked: true });
  return true;
}

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    if (req.query?.only === 'rev') {
      const master = req.user.id === MASTER;
      const [rev, raw] = master ? [await redis('GET', K.rev), null] : await redis('MGET', K.rev, AK.user(req.user.id));
      if (kicked(req, res, raw)) return;
      return res.status(200).json({ rev: Number(rev) || 0 });
    }
    const months = String(req.query?.months || '')
      .split(',')
      .filter(m => /^\d{4}-\d{2}$/.test(m))
      .slice(0, 3);
    const [userRaw, rev, todos, templates, ...monthChecks] = await pipeline([
      ['GET', AK.user(req.user.id)],
      ['GET', K.rev],
      ['HGETALL', K.todos],
      ['HGETALL', K.templates],
      ...months.map(m => ['HGETALL', K.checks(m)]),
    ]);
    if (kicked(req, res, req.user.id === MASTER ? null : userRaw)) return;
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
      me: publicUser(req.user),
    });
  } catch (e) {
    return fail(res, e);
  }
}
