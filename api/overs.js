// IST 과매입 내역
//   GET    /api/overs              → { rev, today, items }  (대기 전부 + 최근 180일 안에 완료된 건)
//   POST   /api/overs              → 추가 { sku, barcode, name, qty, vendor, date, who, mail, comm, method }
//                                    여러 건 한꺼번에: { items: [ … ] } (최대 500건, 기존 엑셀 옮길 때)
//   PATCH  /api/overs?id=ID        → 수정 (바꿀 칸만) · status: 'wait' | 'done'
//   DELETE /api/overs?id=ID        → 삭제
// 완료로 바꾸면 완료일(doneAt)이 오늘(한국 시간)로 들어가고, 대기로 되돌리면 지워져요.
import { K, redis, pipeline, parseHash, body, guard, fail, newId, kstToday, isDate, UserError } from '../lib/store.js';

const KEY = 'over:items';
const MAX_ITEMS = 5000;
const KEEP_DONE_DAYS = 180;
const WHO = ['Tate', 'Charlie', 'V', 'Just', 'Aizen', 'Ayden', 'Lucan', 'Mir'];
const METHODS = ['', 'vr', 'ded', 'xy', 're'];   // 미정 · 가상반출 · 차감매입 · XY이동 · 재진열
const TEXT = { sku: 40, barcode: 40, name: 150, vendor: 80, comm: 200 };

function clean(input, base) {
  const out = { ...base };
  for (const [k, max] of Object.entries(TEXT)) {
    if (k in input) out[k] = String(input[k] ?? '').trim().slice(0, max);
  }
  if ('date' in input) {
    const d = String(input.date || '');
    if (!isDate(d)) throw new UserError('생성일자가 올바르지 않아요.');
    out.date = d;
  }
  if ('mail' in input) {
    const d = String(input.mail || '');
    if (d && !isDate(d)) throw new UserError('메일 발송일이 올바르지 않아요.');
    out.mail = d;
  }
  if ('who' in input) out.who = WHO.includes(input.who) ? input.who : '';
  if ('method' in input) out.method = METHODS.includes(input.method) ? input.method : '';
  if ('qty' in input) {
    const q = Number(String(input.qty ?? '').replace(/,/g, ''));
    if (!Number.isFinite(q) || q <= 0 || q > 1e6) throw new UserError('수량을 숫자로 적어 주세요.');
    out.qty = Math.round(q * 100) / 100;
  }
  if (!out.name) throw new UserError('상품명을 적어 주세요.');
  if (!out.vendor) throw new UserError('업체명을 적어 주세요.');
  if (!(out.qty > 0)) throw new UserError('수량을 적어 주세요.');
  return out;
}

function setStatus(item, status, today) {
  if (status === 'done') { if (!(item.status === 'done' && item.doneAt)) item.doneAt = today; item.status = 'done'; }
  else { item.status = 'wait'; delete item.doneAt; }
  return item;
}

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    const id = req.query?.id ? String(req.query.id) : null;
    const today = kstToday();

    if (req.method === 'GET') {
      const [rev, flat] = await pipeline([['GET', K.rev], ['HGETALL', KEY]]);
      const from = new Date(Date.parse(today) - KEEP_DONE_DAYS * 864e5).toISOString().slice(0, 10);
      const items = parseHash(flat).filter(t => t.status !== 'done' || !t.doneAt || t.doneAt >= from);
      return res.status(200).json({ rev: Number(rev) || 0, today, items });
    }

    if (req.method === 'POST') {
      const count = await redis('HLEN', KEY);
      const b = body(req);
      const now = Date.now();
      const base = { date: today, who: '', mail: '', comm: '', method: '', sku: '', barcode: '' };
      if (Array.isArray(b.items)) {
        if (!b.items.length || b.items.length > 500) throw new UserError('한 번에 1~500건까지 올릴 수 있어요.');
        if (count + b.items.length > MAX_ITEMS) throw new UserError('저장할 수 있는 과매입 건 수를 넘었어요.');
        const seen = new Set();
        const items = b.items.map((x, i) => {
          let nid; do nid = newId(); while (seen.has(nid)); seen.add(nid);
          const it = clean({ ...base, ...x }, { id: nid, status: 'wait', createdAt: new Date(now + i).toISOString() });
          if (x.status === 'done') { it.status = 'done'; it.doneAt = isDate(String(x.doneAt || '')) ? x.doneAt : today; }
          return it;
        });
        await pipeline([['HSET', KEY, ...items.flatMap(it => [it.id, JSON.stringify(it)])], ['INCR', K.rev]]);
        return res.status(201).json({ count: items.length });
      }
      if (count >= MAX_ITEMS) throw new UserError('저장할 수 있는 과매입 건 수를 넘었어요. 오래된 완료 건을 지워 주세요.');
      const item = clean({ ...base, ...b }, { id: newId(), status: 'wait', createdAt: new Date(now).toISOString() });
      await pipeline([['HSET', KEY, item.id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(201).json({ item });
    }

    if (req.method === 'PATCH') {
      if (!id) throw new UserError('id가 필요해요.');
      const raw = await redis('HGET', KEY, id);
      if (!raw) return res.status(404).json({ error: '이미 삭제된 과매입 건이에요.' });
      const b = body(req);
      const patch = {};
      for (const k of [...Object.keys(TEXT), 'date', 'mail', 'who', 'method', 'qty']) if (k in b) patch[k] = b[k];
      let item = clean(patch, JSON.parse(raw));
      if (b.status === 'done' || b.status === 'wait') item = setStatus(item, b.status, today);
      await pipeline([['HSET', KEY, id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(200).json({ item });
    }

    if (req.method === 'DELETE') {
      if (!id) throw new UserError('id가 필요해요.');
      await pipeline([['HDEL', KEY, id], ['INCR', K.rev]]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
