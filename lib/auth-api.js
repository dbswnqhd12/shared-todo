// 로그인 · 사람 관리 — /api/state?auth=1 로 들어와요
// (Vercel 무료 요금제는 서버 파일이 12개까지라 state.js가 같이 받아요)
//   POST   ?auth=1&login=1   → 로그인 { id, pw }  (아이디를 비우면 공용 팀 비밀번호로 보기 전용 로그인)
//                                → { token, me }
//   GET    ?auth=1             → { me }
//   GET    ?auth=1&users=1     → { users, team }          (관리자)
//   POST   ?auth=1             → 사람 추가 { id, name, pw, role }  (관리자)
//   PATCH  ?auth=1&id=ID       → 이름 · 등급 · 비밀번호 변경 { name?, role?, pw? }  (관리자)
//   DELETE ?auth=1&id=ID       → 사람 삭제  (관리자)
//   PUT    ?auth=1             → 공용 팀 비밀번호 로그인 허용/막기 { teamOff }  (관리자)
// 등급이나 비밀번호가 바뀌면 그 사람의 예전 출입증은 바로 못 써요 (버전 v가 올라가요)
import { redis, pipeline, body, guard, fail, tooManyFails, UserError } from './store.js';
import { AK, MASTER, TEAM, ROLES, masterVer, makeToken, hashPw, checkPw, sameText, publicUser } from './auth.js';

const MAX_USERS = 100;
const cleanId = v => String(v ?? '').trim().toLowerCase();
const ID_RE = /^[a-z0-9가-힣._-]{2,20}$/;

function cleanName(v, fallback) {
  const t = String(v ?? '').trim().slice(0, 20);
  return t || fallback;
}
function cleanPw(v) {
  const p = String(v ?? '');
  if (p.length < 4 || p.length > 64) throw new UserError('비밀번호는 4~64자로 정하세요.');
  return p;
}
async function loadUser(id) {
  const raw = await redis('GET', AK.user(id));
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
const saveUser = u => redis('SET', AK.user(u.id), JSON.stringify(u));
const view = u => ({ id: u.id, name: u.name, role: u.role, at: u.at || '' });

async function login(req, res) {
  if (await tooManyFails(req, 'login', false)) {
    return res.status(429).json({ error: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도하세요.' });
  }
  const b = body(req);
  const id = cleanId(b.id), pw = String(b.pw ?? '');
  let user = null;
  if (!pw) throw new UserError('비밀번호를 입력하세요.');
  if (!id) {
    const team = process.env.TEAM_PASSWORD;
    if (team && sameText(pw, team)) {
      const rec = (await loadUser(TEAM)) || { v: 0 };
      if (rec.off) return res.status(403).json({ error: '공용 비밀번호 로그인은 막혀 있어요. 관리자에게 개인 아이디를 받으세요.' });
      user = { id: TEAM, name: '공용', role: 'member', v: rec.v || 0 };
    }
  } else if (id === MASTER) {
    const edit = process.env.EDIT_PASSWORD;
    if (edit && sameText(pw, edit)) user = { id: MASTER, name: '관리자', role: 'admin', v: masterVer() };
  } else {
    const rec = await loadUser(id);
    if (rec && checkPw(pw, rec)) user = rec;
  }
  if (!user) {
    await tooManyFails(req, 'login', true);
    return res.status(401).json({ error: '아이디나 비밀번호가 틀렸어요.' });
  }
  return res.status(200).json({ token: makeToken(user), me: publicUser(user) });
}

export default async function authHandler(req, res) {
  try {
    if (req.method === 'POST' && req.query?.login) {
      res.setHeader('Cache-Control', 'no-store');
      return await login(req, res);
    }
    if (!(await guard(req, res))) return;
    const me = req.user;

    if (req.method === 'GET' && !req.query?.users) return res.status(200).json({ me: publicUser(me) });
    if (me.role !== 'admin') return res.status(403).json({ error: '관리자만 할 수 있어요.', readOnly: true });

    if (req.method === 'GET') {
      const ids = (await redis('SMEMBERS', AK.ids)) || [];
      const raws = ids.length ? await redis('MGET', ...ids.map(AK.user), AK.user(TEAM)) : [await redis('GET', AK.user(TEAM))];
      const team = (() => { try { return JSON.parse(raws.pop() || 'null'); } catch { return null; } })();
      const users = raws.map(r => { try { return view(JSON.parse(r)); } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, 'ko') : a.role === 'admin' ? -1 : 1));
      return res.status(200).json({ users, team: { off: !!team?.off, allowed: !!process.env.TEAM_PASSWORD } });
    }

    if (req.method === 'POST') {
      const b = body(req);
      const id = cleanId(b.id);
      if (!ID_RE.test(id)) throw new UserError('아이디는 2~20자의 한글 · 영어 소문자 · 숫자로 정하세요.');
      if (id === MASTER) throw new UserError('admin은 비상용 아이디라 쓸 수 없어요.');
      if ((await redis('SCARD', AK.ids)) >= MAX_USERS) throw new UserError(`사람은 최대 ${MAX_USERS}명까지 추가할 수 있어요.`);
      const u = {
        id,
        name: cleanName(b.name, id),
        role: ROLES.includes(b.role) ? b.role : 'member',
        v: 1,
        at: new Date().toISOString(),
        ...hashPw(cleanPw(b.pw)),
      };
      const [ok] = await pipeline([['SET', AK.user(id), JSON.stringify(u), 'NX'], ['SADD', AK.ids, id]]);
      if (ok !== 'OK') throw new UserError('이미 있는 아이디예요.');
      return res.status(201).json({ user: view(u) });
    }

    if (req.method === 'PATCH') {
      const id = cleanId(req.query?.id);
      const u = id && id !== TEAM ? await loadUser(id) : null;
      if (!u) return res.status(404).json({ error: '이미 삭제된 사람이에요.' });
      const b = body(req);
      let bump = false;
      if ('name' in b) u.name = cleanName(b.name, u.name);
      if ('role' in b && ROLES.includes(b.role) && b.role !== u.role) {
        if (id === me.id) throw new UserError('내 등급은 다른 관리자가 바꿔야 해요.');
        u.role = b.role; bump = true;
      }
      if (b.pw) { Object.assign(u, hashPw(cleanPw(b.pw))); bump = true; }
      if (bump) u.v = (u.v || 0) + 1;
      await saveUser(u);
      return res.status(200).json({ user: view(u), ...(id === me.id ? { token: makeToken(u), me: publicUser(u) } : {}) });
    }

    if (req.method === 'DELETE') {
      const id = cleanId(req.query?.id);
      if (!id || id === TEAM) throw new UserError('id가 필요해요.');
      if (id === me.id) throw new UserError('내 계정은 다른 관리자가 지워야 해요.');
      await pipeline([['DEL', AK.user(id)], ['SREM', AK.ids, id]]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT') {
      const off = !!body(req).teamOff;
      const rec = (await loadUser(TEAM)) || { v: 0 };
      // 막을 때 버전을 올려서, 이미 공용으로 들어와 있던 기기도 내보내요
      const next = { role: 'member', off, v: off && !rec.off ? (rec.v || 0) + 1 : (rec.v || 0) };
      await redis('SET', AK.user(TEAM), JSON.stringify(next));
      return res.status(200).json({ team: { off, allowed: !!process.env.TEAM_PASSWORD } });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE, PUT');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
