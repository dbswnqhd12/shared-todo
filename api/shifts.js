// 조별 체크리스트 항목(매일 반복) 관리
//   POST   /api/shifts            → 항목 추가 { shift: day|eve|night, text }
//   PATCH  /api/shifts?id=ID      → 이름 변경 { text }
//   DELETE /api/shifts?id=ID      → 오늘부터 빼기 (지난 날짜 기록은 그대로 남음)
import { K, redis, pipeline, body, guard, fail, kstToday, newId, SHIFTS, UserError } from '../lib/store.js';

const MAX_TEMPLATES = 200;

function cleanText(v) {
  const t = String(v ?? '').trim().slice(0, 120);
  if (!t) throw new UserError('항목 내용을 입력하세요.');
  return t;
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    const id = req.query?.id ? String(req.query.id) : null;

    if (req.method === 'POST') {
      const b = body(req);
      if (!SHIFTS.includes(b.shift)) throw new UserError('조를 선택하세요.');
      if ((await redis('HLEN', K.templates)) >= MAX_TEMPLATES) throw new UserError(`체크리스트 항목은 최대 ${MAX_TEMPLATES}개까지 만들 수 있어요.`);
      const item = {
        id: newId(),
        shift: b.shift,
        text: cleanText(b.text),
        start: kstToday(),
        end: '',
        createdAt: new Date().toISOString(),
      };
      await pipeline([['HSET', K.templates, item.id, JSON.stringify(item)], ['INCR', K.rev]]);
      return res.status(201).json({ item });
    }

    if (req.method === 'PATCH' || req.method === 'DELETE') {
      if (!id) throw new UserError('id가 필요해요.');
      const raw = await redis('HGET', K.templates, id);
      if (!raw) return res.status(404).json({ error: '이미 삭제된 항목이에요.' });
      const item = JSON.parse(raw);

      if (req.method === 'PATCH') {
        item.text = cleanText(body(req).text);
        await pipeline([['HSET', K.templates, id, JSON.stringify(item)], ['INCR', K.rev]]);
        return res.status(200).json({ item });
      }

      const today = kstToday();
      if (item.start >= today) {
        // 오늘 만든 항목은 기록이 없으니 완전히 삭제
        await pipeline([['HDEL', K.templates, id], ['INCR', K.rev]]);
      } else {
        // 지난 날짜 기록은 남기고 오늘부터 목록에서 빠짐
        item.end = today;
        await pipeline([['HSET', K.templates, id, JSON.stringify(item)], ['INCR', K.rev]]);
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
