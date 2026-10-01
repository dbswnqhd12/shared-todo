// 프리팩 · 버퍼존 탭: 마지막으로 올린 WMS 재고 엑셀을 정리한 결과 (팀 공용, 다음 파일이 올라오면 교체)
//   GET /api/prepack[?kind=buffer] → { snap, rev }  (없으면 snap: null)
//   PUT /api/prepack[?kind=buffer] → { at, rev }    저장 (이전 것은 덮어씀)
//   kind 없음 = 프리팩, kind=buffer = 버퍼존 (서버 파일 수를 늘리지 않으려고 같이 써요)
// snap.rows 한 줄 = [분류, 로케이션, 상품명, 수량, 제조일, 유통기한, SKU ID, 바코드, LPN]
import { pipeline, body, guard, fail, UserError } from '../lib/store.js';

const KEYS = { prepack: 'prepack-snapshot', buffer: 'buffer-snapshot' };
const CATS = ['bread', 'perilla', 'sr', 'egg', 'etc'];
const MAX_ROWS = 5000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const txt = (v, n) => String(v ?? '').trim().slice(0, n);
const day = v => (DAY.test(String(v || '')) ? String(v) : '');

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    const kind = String(req.query?.kind || 'prepack');
    const KEY = Object.hasOwn(KEYS, kind) ? KEYS[kind] : '';
    if (!KEY) throw new UserError('알 수 없는 종류예요.');
    if (req.method === 'GET') {
      const [raw, rev] = await pipeline([['GET', KEY], ['GET', 'rev']]);
      let snap = null;
      try { snap = raw ? JSON.parse(raw) : null; } catch { snap = null; }
      return res.status(200).json({ snap, rev: Number(rev) || 0 });
    }
    if (req.method === 'PUT') {
      const s = body(req).snap;
      if (!s || typeof s !== 'object' || !Array.isArray(s.rows)) throw new UserError('저장할 분류 결과가 올바르지 않아요.');
      if (s.rows.length > MAX_ROWS) throw new UserError(`한 번에 ${MAX_ROWS}줄까지 올릴 수 있어요.`);
      const rows = s.rows.map(r => {
        if (!Array.isArray(r)) throw new UserError('저장할 분류 결과가 올바르지 않아요.');
        const q = Number(r[3]);
        return [CATS.includes(r[0]) ? r[0] : 'etc', txt(r[1], 60), txt(r[2], 200), Number.isFinite(q) ? Math.round(q * 100) / 100 : 0,
          day(r[4]), day(r[5]), txt(r[6], 30), txt(r[7], 40), txt(r[8], 40)];
      });
      const snap = { v: 1, file: txt(s.file, 200), total: Math.max(0, Math.round(Number(s.total) || 0)), rows, at: Date.now() };
      const [, rev] = await pipeline([['SET', KEY, JSON.stringify(snap)], ['INCR', 'rev']]);
      return res.status(200).json({ ok: true, at: snap.at, rev });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) { return fail(res, e); }
}
