// IST 반출 내역 (한 줄 = 상품 하나 · 같은 반출그룹번호끼리 화면에서 묶어요)
//   GET    /api/outs              → { rev, today, items }  (진행 중 전부 + 최근 180일 안에 완료된 건)
//   POST   /api/outs              → 추가 { grp, ext, cdate, due, vendor, addr, phone, name, barcode, qty, box, tote, note }
//                                  여러 건 한꺼번에: { items: [ … ] } (최대 500건)
//   PATCH  /api/outs?id=ID        → 수정 (바꿀 칸만) · stage 1~4 · com2 · com3
//   PUT    /api/outs              → 여러 건 한꺼번에 바꾸기 { ids:[…], stage?, com2?, com3? } (같은 그룹 한 번에)
//   DELETE /api/outs?id=ID        → 삭제
// 단계: 1 생성 → 2 포장 → 3 택배접수 → 4 반출완료 (4로 가면 완료일 doneAt이 오늘로 들어가요)
import { K, redis, pipeline, parseHash, body, guard, fail, newId, kstToday, isDate, UserError } from '../lib/store.js';

const KEY = 'out:items';
const MAX_ITEMS = 5000;
const KEEP_DONE_DAYS = 180;
const TEXT = { grp: 40, ext: 40, vendor: 80, addr: 200, phone: 40, name: 150, barcode: 40, tote: 40, note: 300 };
const DATES = ['cdate', 'due'];

function clean(input, base) {
  const out = { ...base };
  for (const [k, max] of Object.entries(TEXT)) {
    if (k in input) out[k] = String(input[k] ?? '').replace(/\t/g, ' ').trim().slice(0, max);
  }
  for (const k of DATES) {
    if (k in input) {
      const d = String(input[k] || '');
      if (d && !isDate(d)) throw new UserError('날짜가 올바르지 않아요.');
      out[k] = d;
    }
  }
  for (const k of ['qty', 'box']) {
    if (k in input) {
      const s = String(input[k] ?? '').replace(/,/g, '').trim();
      if (!s) { out[k] = ''; continue; }
      const q = Number(s);
      if (!Number.isFinite(q) || q < 0 || q > 1e6) throw new UserError((k === 'qty' ? '수량' : '박스수량') + '은 숫자로 적어 주세요.');
      out[k] = Math.round(q * 100) / 100;
    }
  }
  for (const k of ['com2', 'com3']) if (k in input) out[k] = !!input[k];
  if (!out.grp && !out.vendor && !out.name) throw new UserError('반출그룹번호 · 업체명 · 상품명 중 하나는 적어 주세요.');
  return out;
}

function setStage(item, stage, today) {
  const s = Math.max(1, Math.min(4, Math.round(+stage) || 1));
  if (s === 4) { if (!(item.stage === 4 && item.doneAt)) item.doneAt = today; }
  else delete item.doneAt;
  item.stage = s;
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
      const items = parseHash(flat).filter(t => t.stage !== 4 || !t.doneAt || t.doneAt >= from);
      return res.status(200).json({ rev: Number(rev) || 0, today, items });
    }

    if (req.method === 'POST') {
      const count = await redis('HLEN', KEY);
      const b = body(req);
      const now = Date.now();
      const base = { cdate: today, due: '', com2: false, com3: false };
      if (Array.isArray(b.items)) {
        if (!b.items.length || b.items.length > 500) throw new UserError('한 번에 1~500건까지 올릴 수 있어요.');
        if (count + b.items.length > MAX_ITEMS) throw new UserError('저장할 수 있는 반출 건 수를 넘었어요.');
        const seen = new Set();
        const items = b.items.map((x, i) => {
          let nid; do nid = newId(); while (seen.has(nid)); seen.add(nid);
          const it = clean({ ...base, ...x }, { id: nid, stage: 1, createdAt: new Date(now + i).toISOString() });
          setStage(it, x.stage || 1, today);
          if (it.stage === 4 && isDate(String(x.doneAt || ''))) it.doneAt = x.doneAt;
          return it;
        });
        await pipeline([['HSET', KEY, ...items.flatMap(it => [it.id, JSON.stringify(it)])], ['INCR', K.rev]]);
        return res.status(201).json({ count: items.length });
      }
      if (count >= MAX_ITEMS) throw new UserError('저장할 수 있는 반출 건 수를 넘었어요. 오래된 완료 건을 지워 주세요.');
      const item = clean({ ...base, ...b }, { id: newId(), stage: 1, createdAt: new Date(now).toISOString() });
      await pipeline([['HSET', KEY, item.id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(201).json({ item });
    }

    if (req.method === 'PATCH') {
      if (!id) throw new UserError('id가 필요해요.');
      const raw = await redis('HGET', KEY, id);
      if (!raw) return res.status(404).json({ error: '이미 삭제된 반출 건이에요.' });
      const b = body(req);
      const patch = {};
      for (const k of [...Object.keys(TEXT), ...DATES, 'qty', 'box', 'com2', 'com3']) if (k in b) patch[k] = b[k];
      let item = clean(patch, JSON.parse(raw));
      if ('stage' in b) item = setStage(item, b.stage, today);
      await pipeline([['HSET', KEY, id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(200).json({ item });
    }

    if (req.method === 'PUT') {
      const b = body(req);
      const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 200) : [];
      if (!ids.length) throw new UserError('바꿀 반출 건을 골라 주세요.');
      const raws = await redis('HMGET', KEY, ...ids);
      const cmds = [], items = [];
      raws.forEach(raw => {
        if (!raw) return;
        let item = JSON.parse(raw);
        for (const k of ['com2', 'com3']) if (k in b) item[k] = !!b[k];
        if ('stage' in b) item = setStage(item, b.stage, today);
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
