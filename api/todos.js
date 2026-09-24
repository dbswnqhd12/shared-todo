// 할 일 API
//   GET    /api/todos              → 전체 목록
//   POST   /api/todos              → 추가   { text, prio, due }
//   PATCH  /api/todos?id=ID        → 수정   { text?, prio?, due?, done? }
//   DELETE /api/todos?id=ID        → 삭제
//   DELETE /api/todos?done=1       → 완료 항목 모두 삭제
import { K, redis, pipeline, parseHash, body, guard, fail, newId, UserError } from '../lib/store.js';

const MAX_ITEMS = 500;
const PRIOS = ['high', 'mid', 'low'];

function clean(input, base = {}) {
  const out = { ...base };
  if ('text' in input) {
    const t = String(input.text ?? '').trim().slice(0, 200);
    if (!t) throw new UserError('할 일 내용을 입력하세요.');
    out.text = t;
  }
  if ('prio' in input) out.prio = PRIOS.includes(input.prio) ? input.prio : 'mid';
  if ('due' in input) out.due = /^\d{4}-\d{2}-\d{2}$/.test(input.due || '') ? input.due : '';
  if ('done' in input) out.done = Boolean(input.done);
  return out;
}

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    const id = req.query?.id ? String(req.query.id) : null;

    if (req.method === 'GET') {
      return res.status(200).json({ items: parseHash(await redis('HGETALL', K.todos)) });
    }

    if (req.method === 'POST') {
      if ((await redis('HLEN', K.todos)) >= MAX_ITEMS) throw new UserError(`할 일은 최대 ${MAX_ITEMS}개까지 저장할 수 있어요.`);
      const item = clean(
        { text: '', prio: 'mid', due: '', ...body(req), done: false },
        { id: newId(), createdAt: new Date().toISOString() }
      );
      await pipeline([['HSET', K.todos, item.id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(201).json({ item });
    }

    if (req.method === 'PATCH') {
      if (!id) throw new UserError('id가 필요해요.');
      const raw = await redis('HGET', K.todos, id);
      if (!raw) return res.status(404).json({ error: '이미 삭제된 항목이에요.' });
      const b = body(req);
      const patch = {};
      for (const k of ['text', 'prio', 'due', 'done']) if (k in b) patch[k] = b[k];
      const item = clean(patch, JSON.parse(raw));
      await pipeline([['HSET', K.todos, id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(200).json({ item });
    }

    if (req.method === 'DELETE') {
      if (id) {
        await pipeline([['HDEL', K.todos, id], ['INCR', K.rev]]);
        return res.status(200).json({ ok: true });
      }
      if (req.query?.done) {
        const doneIds = parseHash(await redis('HGETALL', K.todos)).filter(t => t.done).map(t => t.id);
        if (doneIds.length) await pipeline([['HDEL', K.todos, ...doneIds], ['INCR', K.rev]]);
        return res.status(200).json({ ok: true, removed: doneIds.length });
      }
      throw new UserError('id 또는 done=1이 필요해요.');
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
