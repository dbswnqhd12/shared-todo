// 공유 투두리스트 API (Vercel Serverless Function)
// 저장소: Upstash Redis (Vercel Marketplace 무료 플랜) — REST API를 fetch로 직접 호출
//
//   GET    /api/todos              → 전체 목록
//   POST   /api/todos              → 추가   { text, prio, due }
//   PATCH  /api/todos?id=ID        → 수정   { text?, prio?, due?, done? }
//   DELETE /api/todos?id=ID        → 삭제
//   DELETE /api/todos?done=1       → 완료 항목 모두 삭제

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'shared-todos';
const MAX_ITEMS = 500;
const PRIOS = ['high', 'mid', 'low'];

async function redis(...command) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `Redis error ${r.status}`);
  return data.result;
}

async function readAll() {
  const flat = (await redis('HGETALL', KEY)) || [];
  const items = [];
  for (let i = 0; i < flat.length; i += 2) {
    try { items.push(JSON.parse(flat[i + 1])); } catch { /* 손상된 항목은 건너뜀 */ }
  }
  return items;
}

function clean(input, base = {}) {
  const out = { ...base };
  if ('text' in input) {
    const t = String(input.text ?? '').trim().slice(0, 200);
    if (!t) throw new Error('할 일 내용을 입력하세요.');
    out.text = t;
  }
  if ('prio' in input) out.prio = PRIOS.includes(input.prio) ? input.prio : 'mid';
  if ('due' in input) out.due = /^\d{4}-\d{2}-\d{2}$/.test(input.due || '') ? input.due : '';
  if ('done' in input) out.done = Boolean(input.done);
  return out;
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!URL_ || !TOKEN) {
    return res.status(500).json({
      error: '저장소가 연결되지 않았어요. Vercel 프로젝트의 Storage 탭에서 Upstash Redis를 연결한 뒤 다시 배포하세요.',
    });
  }

  try {
    const id = req.query?.id ? String(req.query.id) : null;

    if (req.method === 'GET') {
      return res.status(200).json({ items: await readAll() });
    }

    if (req.method === 'POST') {
      const count = await redis('HLEN', KEY);
      if (count >= MAX_ITEMS) return res.status(400).json({ error: `할 일은 최대 ${MAX_ITEMS}개까지 저장할 수 있어요.` });
      const item = clean(
        { text: '', prio: 'mid', due: '', ...body(req), done: false },
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString() }
      );
      await redis('HSET', KEY, item.id, JSON.stringify(item));
      return res.status(201).json({ item });
    }

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id가 필요해요.' });
      const raw = await redis('HGET', KEY, id);
      if (!raw) return res.status(404).json({ error: '이미 삭제된 항목이에요.' });
      const b = body(req);
      const patch = {};
      for (const k of ['text', 'prio', 'due', 'done']) if (k in b) patch[k] = b[k];
      const item = clean(patch, JSON.parse(raw));
      await redis('HSET', KEY, id, JSON.stringify(item));
      return res.status(200).json({ item });
    }

    if (req.method === 'DELETE') {
      if (id) {
        await redis('HDEL', KEY, id);
        return res.status(200).json({ ok: true });
      }
      if (req.query?.done) {
        const doneIds = (await readAll()).filter(t => t.done).map(t => t.id);
        if (doneIds.length) await redis('HDEL', KEY, ...doneIds);
        return res.status(200).json({ ok: true, removed: doneIds.length });
      }
      return res.status(400).json({ error: 'id 또는 done=1이 필요해요.' });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    const msg = e.message || '';
    const userError = msg.includes('입력하세요');
    return res.status(userError ? 400 : 500).json({ error: userError ? msg : '서버 오류가 났어요. 잠시 후 다시 시도하세요.' });
  }
}
