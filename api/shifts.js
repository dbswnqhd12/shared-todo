// 조별 체크리스트 항목(매일 반복) 관리
//   POST   /api/shifts            → 항목 추가 { shift: day|eve|night, text }
//   PATCH  /api/shifts?id=ID      → 이름 변경 { text }
//   DELETE /api/shifts?id=ID      → 오늘부터 빼기 (지난 날짜 기록은 그대로 남음)
//   GET    /api/shifts?verify=1   → 편집 비밀번호 확인
// 모든 요청은 헤더 x-edit-key 가 Vercel 환경변수 EDIT_PASSWORD 와 같아야 해요.
import { K, redis, pipeline, body, guard, fail, kstToday, newId, SHIFTS, UserError } from '../lib/store.js';

const MAX_TEMPLATES = 200;

const MAX_FAILS = 10;          // 10분 동안 이만큼 틀리면 잠시 막음
const FAIL_WINDOW_SEC = 600;

// 편집 비밀번호 확인 (틀린 횟수는 접속 주소별로 10분간 셈)
async function editGuard(req, res) {
  const pw = process.env.EDIT_PASSWORD;
  if (!pw) {
    res.status(403).json({ error: '편집 비밀번호가 아직 설정되지 않았어요.', editLocked: true });
    return false;
  }
  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim().slice(0, 64);
  const failKey = `editfail:${ip}`;
  let given = '';
  try { given = decodeURIComponent(req.headers['x-edit-key'] || ''); } catch { given = ''; }
  if (given && given === pw) return true;
  if (given) {
    const [fails] = await pipeline([['INCR', failKey], ['EXPIRE', failKey, FAIL_WINDOW_SEC]]);
    if (fails > MAX_FAILS) {
      res.status(429).json({ error: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도하세요.', editLocked: true });
      return false;
    }
  }
  res.status(403).json({ error: given ? '편집 비밀번호가 틀렸어요.' : '편집 비밀번호를 입력하세요.', editLocked: true });
  return false;
}

function cleanText(v) {
  const t = String(v ?? '').trim().slice(0, 120);
  if (!t) throw new UserError('항목 내용을 입력하세요.');
  return t;
}

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    if (!(await editGuard(req, res))) return;
    const id = req.query?.id ? String(req.query.id) : null;

    if (req.method === 'GET' && req.query?.verify) {
      return res.status(200).json({ ok: true });
    }

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

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
