// 생산성 탭: 마지막으로 올린 worker_history 분석 결과 (팀 공용, 다음 파일이 올라오면 교체)
//   GET /api/prod → { snap }  (없으면 snap: null)
//   PUT /api/prod → { snap }  저장 (이전 것은 덮어씀)
import { pipeline, body, guard, fail, UserError } from '../lib/store.js';

const KEY = 'prod-snapshot';
const MAX_BYTES = 3_000_000;

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method === 'GET') {
      const [raw, rev] = await pipeline([['GET', KEY], ['GET', 'rev']]);
      let snap = null;
      try { snap = raw ? JSON.parse(raw) : null; } catch { snap = null; }
      return res.status(200).json({ snap, rev: Number(rev) || 0 });
    }
    if (req.method === 'PUT') {
      const s = body(req).snap;
      if (!s || typeof s !== 'object' || !Array.isArray(s.emps) || !Array.isArray(s.stow) || !Array.isArray(s.seen)) throw new UserError('저장할 분석 결과가 올바르지 않아요.');
      const snap = { v: 1, file: String(s.file || '').slice(0, 200), dates: (Array.isArray(s.dates) ? s.dates : []).map(String).slice(0, 31),
        emps: s.emps, stow: s.stow, seen: s.seen, at: Date.now() };
      const json = JSON.stringify(snap);
      if (json.length > MAX_BYTES) throw new UserError('파일이 너무 커서 공유 저장을 못 했어요.');
      const [, rev] = await pipeline([['SET', KEY, json], ['INCR', 'rev']]);
      return res.status(200).json({ ok: true, at: snap.at, rev });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) { return fail(res, e); }
}
