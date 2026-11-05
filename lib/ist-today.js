// IST Today — 매일 아침 7시(한국 시간) 기준으로 오늘 처리할 회송 · 과매입 · 반출을 뽑아 둬요.
// 7시가 지나 처음 열 때 그날 목록을 만들어 저장하고(ist:today), 그날은 같은 목록을 보여 줘요.
// 화면은 목록에 있는 건이 지금 끝났는지를 실제 데이터로 확인해서 체크 표시를 해요.
import { redis, pipeline, parseHash } from './store.js';

const KEY = 'ist:today';
const HOUR = 7;
const NEXT = { 1: '포장하기', 2: '택배접수 하기', 3: '반출완료 처리' };

const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const dayOf = d => d.toISOString().slice(0, 10);
const addDays = (iso, n) => dayOf(new Date(Date.parse(iso) + n * 864e5));
const age = (from, today) => (/^\d{4}-\d{2}-\d{2}$/.test(from || '') ? Math.max(0, Math.round((Date.parse(today) - Date.parse(from)) / 864e5)) : 0);

export function buildList(ret, over, out, today) {
  const items = [];
  // 반출: 같은 반출그룹번호끼리 한 건, 가장 늦은 단계 기준으로 다음 할 일
  const groups = new Map();
  for (const x of out) {
    const k = x.grp || `id:${x.id}`;
    const g = groups.get(k) || { ids: [], grp: x.grp || '', vendor: '', due: '', stage: 4, cdate: '', n: 0 };
    g.ids.push(x.id); g.n++;
    g.stage = Math.min(g.stage, Math.max(1, Math.min(4, Number(x.stage) || 1)));
    if (!g.vendor) g.vendor = x.vendor || '';
    if (x.due && (!g.due || x.due < g.due)) g.due = x.due;
    if (x.cdate && (!g.cdate || x.cdate < g.cdate)) g.cdate = x.cdate;
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    if (g.stage >= 4) continue;
    let tag = '', rank = 3;
    if (g.due && g.due < today) { tag = `기한 ${age(g.due, today)}일 지남`; rank = 0; }
    else if (g.due === today) { tag = '오늘 기한'; rank = 1; }
    else if (g.due === addDays(today, 1)) { tag = '내일 기한'; rank = 2; }
    items.push({ t: 'out', ids: g.ids, stage: g.stage, rank, tag, due: g.due, since: g.cdate,
      title: [g.vendor, g.grp].filter(Boolean).join(' · ') || '반출', sub: `상품 ${g.n}개`, action: NEXT[g.stage] });
  }
  // 과매입: 메일 전이면 메일부터, 보냈으면 처리
  for (const x of over) {
    if (x.status === 'done') continue;
    const d = age(x.date, today);
    items.push({ t: 'over', ids: [x.id], mail: !!x.mail, rank: d >= 7 ? 2 : 3, tag: d >= 7 ? `${d}일째` : '', since: x.date || '',
      title: [x.vendor, x.name].filter(Boolean).join(' · '), sub: [x.qty ? `${x.qty}개` : '', x.who].filter(Boolean).join(' · '),
      action: x.mail ? '처리하기' : '메일 보내기' });
  }
  // 회송: 대기 건 (오래된 순)
  for (const x of ret) {
    if (x.status === 'done') continue;
    const d = age(x.date, today);
    items.push({ t: 'ret', ids: [x.id], rank: d >= 7 ? 2 : 3, tag: d >= 7 ? `${d}일째` : '', since: x.date || '',
      title: [x.vendor, x.name].filter(Boolean).join(' · ') || x.barcode || '회송', sub: [x.reason, x.qty ? `${x.qty}개` : ''].filter(Boolean).join(' · '),
      action: '회송 처리' });
  }
  const order = { out: 0, over: 1, ret: 2 };
  items.sort((a, b) => order[a.t] - order[b.t] || a.rank - b.rank || String(a.due || '9').localeCompare(String(b.due || '9')) || String(a.since).localeCompare(String(b.since)));
  return items;
}

async function make(today) {
  const [r, o, x] = await pipeline([['HGETALL', 'ret:items'], ['HGETALL', 'over:items'], ['HGETALL', 'out:items']]);
  const snap = { date: today, at: new Date().toISOString(), items: buildList(parseHash(r), parseHash(o), parseHash(x), today) };
  await redis('SET', KEY, JSON.stringify(snap), 'EX', 3 * 86400);
  return snap;
}

// 오늘 7시 이후면 오늘 목록, 7시 전이면 어제 목록 (없으면 바로 만들어요)
export async function getToday({ rebuild = false } = {}) {
  const now = kstNow(), today = dayOf(now);
  const target = now.getUTCHours() >= HOUR ? today : addDays(today, -1);
  let snap = null;
  try { snap = JSON.parse((await redis('GET', KEY)) || 'null'); } catch { snap = null; }
  if (rebuild || !snap || snap.date < target) snap = await make(target);
  return snap;
}
