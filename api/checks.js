// 날짜별 체크 기록
//   PUT /api/checks  { date: YYYY-MM-DD, tid: 체크리스트 항목ID, done: true|false }
import { K, pipeline, body, guard, fail, isDate, UserError } from '../lib/store.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    if (req.method !== 'PUT') {
      res.setHeader('Allow', 'PUT');
      return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
    }
    const b = body(req);
    const date = String(b.date || '');
    const tid = String(b.tid || '');
    if (!isDate(date)) throw new UserError('날짜가 올바르지 않아요.');
    if (!/^[\w-]{1,40}$/.test(tid)) throw new UserError('항목이 올바르지 않아요.');
    const key = K.checks(date.slice(0, 7));
    const field = `${date}|${tid}`;
    const record = { done: true, at: new Date().toISOString() };
    await pipeline([
      b.done ? ['HSET', key, field, JSON.stringify(record)] : ['HDEL', key, field],
      ['INCR', K.rev],
    ]);
    return res.status(200).json({ ok: true, date, tid, done: Boolean(b.done), at: b.done ? record.at : null });
  } catch (e) {
    return fail(res, e);
  }
}
