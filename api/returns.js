// IST 회송 내역
//   GET    /api/returns              → { rev, today, items }  (대기 전부 + 최근 120일 안에 완료된 건)
//   POST   /api/returns              → 추가   { date, vendor, po, sku, barcode, name, reason, temp, qty, note }
//                                      여러 건 한꺼번에: { items: [ {…, status, doneAt}, … ] } (최대 500건, 기존 엑셀 옮길 때)
//   PATCH  /api/returns?id=ID        → 수정   (위 칸 중 바꿀 것만)
//   PUT    /api/returns              → 상태 한꺼번에 바꾸기 { ids: [...], status: 'wait' | 'done' }
//   DELETE /api/returns?id=ID        → 삭제
// 완료로 바꾸면 완료일(doneAt)이 오늘(한국 시간)로 들어가고, 대기로 되돌리면 지워져요.
import { K, redis, pipeline, parseHash, body, guard, fail, newId, kstToday, isDate, UserError } from '../lib/store.js';

const KEY = 'ret:items';
const MAX_ITEMS = 5000;
const KEEP_DONE_DAYS = 120;
const TEMPS = ['CH', 'AM', 'FR'];   // 냉장(CHILLED) · 상온(AMBIENT) · 냉동(FROZEN)
const TEXT = { vendor: 80, po: 40, sku: 40, barcode: 40, name: 150, reason: 80, note: 300 };

function clean(input, base) {
  const out = { ...base };
  for (const [k, max] of Object.entries(TEXT)) {
    if (k in input) out[k] = String(input[k] ?? '').trim().slice(0, max);
  }
  if ('date' in input) {
    const d = String(input.date || '');
    if (!isDate(d)) throw new UserError('하차일이 올바르지 않아요.');
    out.date = d;
  }
  if ('temp' in input) out.temp = TEMPS.includes(input.temp) ? input.temp : '';
  if ('qty' in input) {
    const q = Number(String(input.qty ?? '').replace(/,/g, ''));
    if (!Number.isFinite(q) || q < 0 || q > 1e6) throw new UserError('수량을 숫자로 적어 주세요.');
    out.qty = Math.round(q * 100) / 100;
  }
  if (!out.vendor) throw new UserError('업체명을 적어 주세요.');
  if (!out.name) throw new UserError('상품명을 적어 주세요.');
  if (!out.reason) throw new UserError('회송사유를 적어 주세요.');
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
      if ((await redis('HLEN', KEY)) >= MAX_ITEMS) throw new UserError('저장할 수 있는 회송 건 수를 넘었어요. 오래된 완료 건을 지워 주세요.');
      const b = body(req);
      if (Array.isArray(b.items)) {
        if (!b.items.length || b.items.length > 500) throw new UserError('한 번에 1~500건까지 올릴 수 있어요.');
        const now = new Date().toISOString();
        const seen = new Set();
        const items = b.items.map((x, i) => {
          let id; do id = newId(); while (seen.has(id)); seen.add(id);
          const it = clean({ date: today, temp: '', qty: 0, ...x }, { id, status: 'wait', createdAt: now });
          // 옮겨 온 건은 '오늘 입력한 회송'에 섞이지 않도록 하차일을 입력일로 둬요.
          it.createdAt = new Date(Date.parse(it.date + 'T00:00:00+09:00') + i).toISOString();
          if (x.status === 'done') { it.status = 'done'; if (isDate(String(x.doneAt || ''))) it.doneAt = x.doneAt; }
          return it;
        });
        if ((await redis('HLEN', KEY)) + items.length > MAX_ITEMS) throw new UserError('저장할 수 있는 회송 건 수를 넘었어요.');
        const args = items.flatMap(it => [it.id, JSON.stringify(it)]);
        await pipeline([['HSET', KEY, ...args], ['INCR', K.rev]]);
        return res.status(201).json({ count: items.length });
      }
      const item = clean({ date: today, temp: '', qty: 0, ...b }, { id: newId(), status: 'wait', createdAt: new Date().toISOString() });
      await pipeline([['HSET', KEY, item.id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(201).json({ item });
    }

    if (req.method === 'PATCH') {
      if (!id) throw new UserError('id가 필요해요.');
      const raw = await redis('HGET', KEY, id);
      if (!raw) return res.status(404).json({ error: '이미 삭제된 회송 건이에요.' });
      const b = body(req);
      const patch = {};
      for (const k of [...Object.keys(TEXT), 'date', 'temp', 'qty']) if (k in b) patch[k] = b[k];
      let item = clean(patch, JSON.parse(raw));
      if (b.status === 'done' || b.status === 'wait') item = setStatus(item, b.status, today);
      await pipeline([['HSET', KEY, id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(200).json({ item });
    }

    if (req.method === 'PUT') {
      const b = body(req);
      const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 500) : [];
      if (!ids.length) throw new UserError('바꿀 회송 건을 골라 주세요.');
      if (b.status !== 'done' && b.status !== 'wait') throw new UserError('상태가 올바르지 않아요.');
      const raws = await redis('HMGET', KEY, ...ids);
      const cmds = [], items = [];
      raws.forEach(raw => {
        if (!raw) return;
        const item = setStatus(JSON.parse(raw), b.status, today);
        items.push(item);
        cmds.push(['HSET', KEY, item.id, JSON.stringify(item)]);
      });
      if (cmds.length) await pipeline([...cmds, ['INCR', K.rev]]);
      return res.status(200).json({ items });
    }

    if (req.method === 'DELETE') {
      if (!id) throw new UserError('id가 필요해요.');
      await pipeline([['HDEL', KEY, id], ['INCR', K.rev]]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, PUT, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
