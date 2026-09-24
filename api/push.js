// 푸시 알림 구독 관리
//   GET    /api/push              → { publicKey }  (브라우저 구독에 필요한 공개키)
//   POST   /api/push              → 구독 저장     { subscription }
//   POST   /api/push?test=1       → 구독 저장 + 이 기기로 테스트 알림
//   DELETE /api/push              → 구독 해제     { subscription }
import { redis, body, guard, fail, UserError } from '../lib/store.js';
import { vapidConfig, sendPush, subId } from '../lib/push.js';

const SUBS = 'push-subs';
const MAX_SUBS = 300;
// 실제 브라우저 푸시 서버로만 보냄 (엉뚱한 주소로 요청이 나가지 않게)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

function cleanSub(sub) {
  let host = '';
  try { host = new URL(sub?.endpoint).hostname; } catch { host = ''; }
  const ok = sub && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://') && sub.endpoint.length < 1000
    && PUSH_HOSTS.test(host)
    && typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length < 200
    && typeof sub.keys?.auth === 'string' && sub.keys.auth.length < 100;
  if (!ok) throw new UserError('알림 구독 정보가 올바르지 않아요.');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    const cfg = vapidConfig();
    if (req.method === 'GET') return res.status(200).json({ publicKey: cfg ? cfg.publicKey : null });
    if (!cfg) return res.status(503).json({ error: '알림 기능이 아직 설정되지 않았어요.' });

    const sub = cleanSub(body(req).subscription);
    const id = subId(sub.endpoint);

    if (req.method === 'POST') {
      if ((await redis('HLEN', SUBS)) >= MAX_SUBS && !(await redis('HEXISTS', SUBS, id))) {
        throw new UserError('알림 받는 기기가 너무 많아요.');
      }
      const rec = { ...sub, createdAt: new Date().toISOString() };
      await redis('HSET', SUBS, id, JSON.stringify(rec));
      if (req.query?.test) {
        const r = await sendPush(rec, { title: 'GWJ3 IB 알림 켜짐', body: '조 체크리스트를 모두 끝내면 이렇게 알려 드려요.', tag: 'test', url: '/' }, cfg);
        if (r.gone) await redis('HDEL', SUBS, id);
        return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { error: '테스트 알림을 보내지 못했어요. 알림 허용을 확인하세요.' });
      }
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await redis('HDEL', SUBS, id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
