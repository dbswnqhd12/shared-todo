// 할 일 API
//   GET    /api/todos              → 전체 목록
//   POST   /api/todos              → 추가   { text, prio, due }
//   PATCH  /api/todos?id=ID        → 수정   { text?, prio?, due?, done? }
//   DELETE /api/todos?id=ID        → 삭제
//   DELETE /api/todos?done=1       → 완료 항목 모두 삭제
//   POST   /api/todos?id=ID&seen=1 → '확인' 체크 켜기/끄기 { on, name? }  (보기 전용 계정도 돼요)
// 일정마다 by(만든 사람), imgs(사진, api/files.js), seen(확인한 사람 { 키: { n, at } }) 칸이 붙어요
import { del } from '@vercel/blob';
import { K, redis, pipeline, parseHash, body, guard, fail, newId, UserError } from '../lib/store.js';
import { TEAM } from '../lib/auth.js';

// 일정을 지울 때 붙은 사진도 저장소에서 지워요 (실패해도 일정은 지워요)
async function dropImgs(list) {
  const urls = list.flatMap(t => (Array.isArray(t.imgs) ? t.imgs : []).map(f => f.u || f.p)).filter(Boolean);
  if (urls.length) { try { await del(urls); } catch { /* 무시 */ } }
}

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
  const seenReq = req.method === 'POST' && !!req.query?.seen;
  if (!(await guard(req, res, { anyone: seenReq }))) return;
  try {
    const id = req.query?.id ? String(req.query.id) : null;

    if (seenReq) {
      if (!id) throw new UserError('id가 필요해요.');
      const b = body(req);
      // 공용 비밀번호로 들어온 사람은 모두 같은 계정이라, 화면에서 적은 이름으로 구분해요
      let key = req.user.id, name = req.user.name;
      if (req.user.id === TEAM) {
        name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
        if (!name) throw new UserError('확인하려면 이름을 적어 주세요.');
        key = TEAM + ':' + name;
      }
      const raw = await redis('HGET', K.todos, id);
      if (!raw) return res.status(404).json({ error: '이미 삭제된 일정이에요.' });
      const item = JSON.parse(raw);
      const seen = item.seen && typeof item.seen === 'object' ? item.seen : {};
      if (b.on) seen[key] = { n: name, at: new Date().toISOString() };
      else delete seen[key];
      item.seen = seen;
      await pipeline([['HSET', K.todos, id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(200).json({ item });
    }

    if (req.method === 'GET') {
      return res.status(200).json({ items: parseHash(await redis('HGETALL', K.todos)) });
    }

    if (req.method === 'POST') {
      if ((await redis('HLEN', K.todos)) >= MAX_ITEMS) throw new UserError(`할 일은 최대 ${MAX_ITEMS}개까지 저장할 수 있어요.`);
      const item = clean(
        { text: '', prio: 'mid', due: '', ...body(req), done: false },
        { id: newId(), createdAt: new Date().toISOString(), by: { id: req.user.id, n: req.user.name } }
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
        const raw = await redis('HGET', K.todos, id);
        if (raw) { try { await dropImgs([JSON.parse(raw)]); } catch { /* 무시 */ } }
        await pipeline([['HDEL', K.todos, id], ['INCR', K.rev]]);
        return res.status(200).json({ ok: true });
      }
      if (req.query?.done) {
        const doneList = parseHash(await redis('HGETALL', K.todos)).filter(t => t.done);
        const doneIds = doneList.map(t => t.id);
        await dropImgs(doneList);
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
