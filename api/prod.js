// 생산성 탭: 마지막으로 올린 worker_history 분석 결과 (팀 공용, 다음 파일이 올라오면 교체)
//   GET /api/prod → { snap }  (없으면 snap: null)
//   PUT /api/prod → { snap }  저장 (이전 것은 덮어씀)
//   ?kind=rpt = Productivity Report (서버 파일 수를 늘리지 않으려고 같이 써요)
//     GET  ?kind=rpt[&date=YYYY-MM-DD] → { date, dates, wh, tr, plan, rev }  (날짜를 안 주면 가장 최근 날짜)
//     PUT  ?kind=rpt  { part:'wh'|'plan', date, data } 또는 { part:'tr', data }
//       wh = 작업자 이력 합계 (날짜별), plan = 계획 · 인원 입력 (날짜별), tr = 이관현황 (하차 날짜별로 합쳐서 최근 14일)
import { redis, pipeline, body, guard, fail, UserError } from '../lib/store.js';

const KEY = 'prod-snapshot';
const MAX_BYTES = 3_000_000;

const RPT_DATES = 'rpt-dates', RPT_TR = 'rpt-tr', RPT_KEEP = 60, RPT_TR_DAYS = 14;
const rptKey = (part, date) => `rpt-${part}:${date}`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parse = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

async function report(req, res) {
  if (req.method === 'GET') {
    const [dates, rev] = await pipeline([['SMEMBERS', RPT_DATES], ['GET', 'rev']]);
    const list = (dates || []).filter(d => DAY.test(d)).sort().reverse();
    const q = String(req.query?.date || '');
    const date = DAY.test(q) ? q : (list[0] || '');
    if (!date) return res.status(200).json({ date: '', dates: list, wh: null, tr: null, plan: null, rev: Number(rev) || 0 });
    const [wh, plan, tr] = await pipeline([['GET', rptKey('wh', date)], ['GET', rptKey('plan', date)], ['GET', RPT_TR]]);
    return res.status(200).json({ date, dates: list, wh: parse(wh), plan: parse(plan), tr: parse(tr), rev: Number(rev) || 0 });
  }
  if (req.method === 'PUT') {
    const b = body(req), part = String(b.part || ''), data = b.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UserError('저장할 내용이 올바르지 않아요.');
    const at = Date.now();
    if (part === 'tr') {
      if (!data.days || typeof data.days !== 'object') throw new UserError('저장할 이관현황이 올바르지 않아요.');
      const old = parse(await redis('GET', RPT_TR)) || { days: {} };
      const days = { ...(old.days || {}), ...data.days };
      const keep = Object.keys(days).filter(d => DAY.test(d)).sort().slice(-RPT_TR_DAYS);
      const tr = { v: 1, file: String(data.file || '').slice(0, 200), at, days: Object.fromEntries(keep.map(d => [d, days[d]])) };
      const json = JSON.stringify(tr);
      if (json.length > MAX_BYTES) throw new UserError('이관현황이 너무 커서 저장을 못 했어요.');
      const [, rev] = await pipeline([['SET', RPT_TR, json], ['INCR', 'rev']]);
      return res.status(200).json({ ok: true, at, rev });
    }
    const date = String(b.date || '');
    if (!DAY.test(date)) throw new UserError('리포트 날짜가 올바르지 않아요.');
    if (part === 'wh') {
      if (!data.mh || typeof data.mh !== 'object' || !Array.isArray(data.people)) throw new UserError('저장할 작업자 이력 계산이 올바르지 않아요.');
    } else if (part !== 'plan') throw new UserError('알 수 없는 종류예요.');
    const json = JSON.stringify({ ...data, file: String(data.file || '').slice(0, 200), at });
    if (json.length > MAX_BYTES) throw new UserError('파일이 너무 커서 공유 저장을 못 했어요.');
    const [, , rev, all] = await pipeline([['SET', rptKey(part, date), json], ['SADD', RPT_DATES, date], ['INCR', 'rev'], ['SMEMBERS', RPT_DATES]]);
    const old = (all || []).sort().slice(0, Math.max(0, (all || []).length - RPT_KEEP));
    if (old.length) await pipeline([['SREM', RPT_DATES, ...old], ['DEL', ...old.flatMap(d => [rptKey('wh', d), rptKey('plan', d)])]]);
    return res.status(200).json({ ok: true, at, rev });
  }
  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
}

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.query?.kind === 'rpt') return await report(req, res);
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
