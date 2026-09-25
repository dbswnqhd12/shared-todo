// 시프트 교대 인수인계
//   GET /api/handover?date=YYYY-MM-DD → { rev, date, global, day }
//   PUT /api/handover  { date, field, value }  (value 가 null 이나 '' 면 삭제)
// 날짜별 칸: 챔버별 이관 현황 (PLT 칸, 냉동 챔버 차량번호, 비고, 프리팩)
import { K, redis, pipeline, body, guard, fail, isDate, UserError } from '../lib/store.js';

const dayKey = d => `ho:${d}`;
const KEEP_SEC = 60 * 60 * 24 * 400;   // 날짜별 기록은 약 400일 보관
const MAX_FIELDS = 600;

const COLS = 'pre|c1g|c1m|c2g|c2m|c3g|c3m|c5|c6|c7';
const ROWS = 'ilban|rocket|wm|iwit|direct';
const DAY_FIELD = new RegExp(`^(cell:(${ROWS}):(${COLS})|note:(${COLS})|car:(c5|c6|c7)|ppq:(sr|egg|bread|perilla))$`);

function cleanValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') {
    const s = String(v);
    if (s.length > 2000) throw new UserError('내용이 너무 길어요. 2000자 이하로 적어 주세요.');
    return s;
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length > 10) throw new UserError('저장할 수 없는 값이에요.');
    const out = {};
    for (const k of keys) {
      const x = v[k];
      if (!/^\w{1,20}$/.test(k) || (x !== null && typeof x !== 'string' && typeof x !== 'number')) throw new UserError('저장할 수 없는 값이에요.');
      const s = x === null ? '' : String(x);
      if (s.length > 1000) throw new UserError('내용이 너무 길어요. 1000자 이하로 적어 주세요.');
      out[k] = s;
    }
    return out;
  }
  throw new UserError('저장할 수 없는 값이에요.');
}

function parseHash(flat) {
  const o = {};
  for (let i = 0; i < (flat || []).length; i += 2) {
    try { o[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* 건너뜀 */ }
  }
  return o;
}

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (req.method === 'GET') {
      const date = String(req.query?.date || '');
      if (!isDate(date)) throw new UserError('날짜가 올바르지 않아요.');
      const [rev, d] = await pipeline([['GET', K.rev], ['HGETALL', dayKey(date)]]);
      return res.status(200).json({ rev: Number(rev) || 0, date, global: {}, day: parseHash(d) });
    }

    if (req.method === 'PUT') {
      const b = body(req);
      const field = String(b.field || '');
      const date = String(b.date || '');
      if (!isDate(date)) throw new UserError('날짜가 올바르지 않아요.');
      if (!DAY_FIELD.test(field)) throw new UserError('저장할 수 없는 칸이에요.');
      const key = dayKey(date);
      const v = cleanValue(b.value);
      const remove = v === null || v === '';
      if (!remove && (await redis('HLEN', key)) >= MAX_FIELDS && !(await redis('HEXISTS', key, field))) {
        throw new UserError('더 이상 추가할 수 없어요. 안 쓰는 줄을 지워 주세요.');
      }
      const cmds = [
        remove ? ['HDEL', key, field] : ['HSET', key, field, JSON.stringify(v)],
        ['EXPIRE', key, KEEP_SEC],
        ['INCR', K.rev],
      ];
      const out = await pipeline(cmds);
      return res.status(200).json({ ok: true, rev: out[out.length - 1] });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
