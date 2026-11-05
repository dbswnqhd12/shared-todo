// IST 월간 분석 — 회송 · 과매입 · 반출을 한 달 단위로 정리해요.
// 화면(report.html)과 말일 카카오톡 요약이 같은 결과를 써요.
import { pipeline, parseHash, kstToday } from './store.js';

const RET_KEY = 'ret:items', OVER_KEY = 'over:items', OUT_KEY = 'out:items';
const TEMP_NAME = { CH: '냉장', AM: '상온', FR: '냉동' };
const METHOD_NAME = { '': '미정', vr: '가상반출', ded: '차감매입', xy: 'XY이동', re: '재진열' };
const STAGE_NAME = { 1: '생성', 2: '포장', 3: '택배접수', 4: '반출완료' };

const inMonth = (d, m) => typeof d === 'string' && d.slice(0, 7) === m;
const num = v => (Number.isFinite(+v) ? +v : 0);
const round = v => Math.round(v * 100) / 100;
const ageDays = (d, today) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 864e5) : 0);

// 많은 순으로 상위 n개 [{ name, count, qty }]
function top(list, keyFn, n = 5) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x) || '(없음)';
    const e = m.get(k) || { name: k, count: 0, qty: 0 };
    e.count++; e.qty = round(e.qty + num(x.qty));
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.qty - a.qty).slice(0, n);
}

export function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

// 한국 시간 기준 오늘이 그달의 마지막 날인지
export function isLastDayKst(today = kstToday()) {
  const t = new Date(Date.parse(today) + 864e5).toISOString().slice(0, 10);
  return t.slice(0, 7) !== today.slice(0, 7);
}

function returnsPart(items, m, today) {
  const made = items.filter(x => inMonth(x.date, m));
  const done = items.filter(x => x.status === 'done' && inMonth(x.doneAt, m));
  const wait = items.filter(x => x.status !== 'done');
  const leads = done.filter(x => x.date && x.doneAt).map(x => ageDays(x.date, x.doneAt));
  return {
    made: made.length, madeQty: round(made.reduce((s, x) => s + num(x.qty), 0)),
    done: done.length,
    madeDone: made.filter(x => x.status === 'done').length,
    wait: wait.length,
    waitOld: wait.filter(x => ageDays(x.date, today) >= 7).length,
    avgDays: leads.length ? round(leads.reduce((s, v) => s + v, 0) / leads.length) : null,
    byReason: top(made, x => x.reason),
    byVendor: top(made, x => x.vendor),
    byTemp: top(made, x => TEMP_NAME[x.temp] || '미정', 3),
    oldest: wait.filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
      .map(x => ({ date: x.date, vendor: x.vendor, name: x.name, days: ageDays(x.date, today) })),
  };
}

function oversPart(items, m, today) {
  const made = items.filter(x => inMonth(x.date, m));
  const done = items.filter(x => x.status === 'done' && inMonth(x.doneAt, m));
  const wait = items.filter(x => x.status !== 'done');
  return {
    made: made.length, madeQty: round(made.reduce((s, x) => s + num(x.qty), 0)),
    done: done.length,
    madeDone: made.filter(x => x.status === 'done').length,
    wait: wait.length,
    waitNoMail: wait.filter(x => !x.mail).length,
    waitOld: wait.filter(x => ageDays(x.date, today) >= 7).length,
    byMethod: top(made, x => METHOD_NAME[x.method || ''] || '미정'),
    byWho: top(made, x => x.who || '미정', 8),
    byVendor: top(made, x => x.vendor),
  };
}

function outsPart(items, m, today) {
  // 같은 반출그룹번호끼리 한 건으로 셉니다 (번호가 없으면 줄 하나가 한 건)
  const groups = new Map();
  for (const x of items) {
    const k = x.grp || `id:${x.id}`;
    const g = groups.get(k) || { grp: x.grp, vendor: x.vendor, cdate: x.cdate, due: x.due, stage: 4, doneAt: '', lines: 0, qty: 0 };
    g.lines++; g.qty = round(g.qty + num(x.qty));
    g.stage = Math.min(g.stage, num(x.stage) || 1);
    if (x.doneAt && x.doneAt > g.doneAt) g.doneAt = x.doneAt;
    if (x.cdate && (!g.cdate || x.cdate < g.cdate)) g.cdate = x.cdate;
    if (x.due && (!g.due || x.due < g.due)) g.due = x.due;
    if (!g.vendor) g.vendor = x.vendor;
    groups.set(k, g);
  }
  const all = [...groups.values()];
  const made = all.filter(g => inMonth(g.cdate, m));
  const done = all.filter(g => g.stage === 4 && inMonth(g.doneAt, m));
  const open = all.filter(g => g.stage < 4);
  const late = open.filter(g => g.due && g.due < today);
  const byStage = [1, 2, 3].map(s => ({ name: STAGE_NAME[s], count: open.filter(g => g.stage === s).length }));
  return {
    made: made.length, madeLines: made.reduce((s, g) => s + g.lines, 0),
    done: done.length, doneLines: done.reduce((s, g) => s + g.lines, 0),
    open: open.length, late: late.length, byStage,
    byVendor: top(made.map(g => ({ ...g, qty: g.qty })), g => g.vendor),
    lateList: late.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5)
      .map(g => ({ grp: g.grp, vendor: g.vendor, due: g.due, stage: STAGE_NAME[g.stage] })),
  };
}

// month: 'YYYY-MM' (없으면 이번 달)
export async function buildIstReport(month) {
  const today = kstToday();
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : today.slice(0, 7);
  const [r, o, x] = await pipeline([['HGETALL', RET_KEY], ['HGETALL', OVER_KEY], ['HGETALL', OUT_KEY]]);
  const ret = parseHash(r), over = parseHash(o), out = parseHash(x);
  const pm = prevMonth(m);
  const report = {
    month: m, today, prev: pm,
    returns: returnsPart(ret, m, today),
    overs: oversPart(over, m, today),
    outs: outsPart(out, m, today),
    last: { returns: returnsPart(ret, pm, today).made, overs: oversPart(over, pm, today).made, outs: outsPart(out, pm, today).made },
  };
  report.text = kakaoText(report);
  return report;
}

const diff = (now, before) => (before ? ` (${now - before >= 0 ? '+' : ''}${now - before})` : '');

// 카카오톡 "나에게 보내기" 텍스트 템플릿은 200자까지라 핵심 숫자만 넣어요
export function kakaoText(rp) {
  const mo = Number(rp.month.slice(5));
  const R = rp.returns, O = rp.overs, X = rp.outs;
  const lines = [
    `[GWJ3 IB] ${mo}월 IST 결산`,
    `회송 ${R.made}건${diff(R.made, rp.last.returns)} · 완료 ${R.done} · 대기 ${R.wait}`,
    `과매입 ${O.made}건${diff(O.made, rp.last.overs)} · 완료 ${O.done} · 대기 ${O.wait}`,
    `반출 ${X.made}건${diff(X.made, rp.last.outs)} · 완료 ${X.done} · 진행 ${X.open}${X.late ? ` (기한지남 ${X.late})` : ''}`,
  ];
  if (R.byReason[0] && R.byReason[0].name !== '(없음)') lines.push(`회송 최다 사유: ${R.byReason[0].name} ${R.byReason[0].count}건`);
  const t = lines.join('\n');
  return t.length > 200 ? t.slice(0, 199) + '…' : t;
}
