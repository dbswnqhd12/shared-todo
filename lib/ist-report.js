// IST 월 결산 — 회송 · 과매입 · 반출을 한 달 단위로 세요.
//   전월 이월: 그달 1일 전에 들어와서 그때까지 안 끝난 건
//   신규:      그달에 들어온 건
//   완료:      그달에 완료한 건
//   남은 건:   그달 말일까지 안 끝난 건 (이번 달이면 오늘 기준)
// 화면(report.html), 엑셀 결산표, 말일 카카오톡 요약이 같은 결과를 써요.
import { pipeline, parseHash, kstToday } from './store.js';
import { makeXlsx } from './xlsx.js';

const TEMP_NAME = { CH: '냉장', AM: '상온', FR: '냉동' };
const METHOD_NAME = { '': '미정', vr: '가상반출', ded: '차감매입', xy: 'XY이동', re: '재진열' };
const STAGE_NAME = { 1: '생성', 2: '포장', 3: '택배접수', 4: '반출완료' };
const TYPES = [
  { key: 'returns', name: '회송', redis: 'ret:items' },
  { key: 'overs', name: '과매입', redis: 'over:items' },
  { key: 'outs', name: '반출', redis: 'out:items' },
];

const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const lastDay = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const ageDays = (from, to) => (isDay(from) ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 864e5)) : '');
const num = v => (v === '' || v == null || !Number.isFinite(+v) ? '' : +v);

export function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

// 한국 시간 기준 오늘이 그달의 마지막 날인지
export function isLastDayKst(today = kstToday()) {
  return lastDay(today.slice(0, 7)) === today;
}

// 종류마다 한 줄 모양 { start(들어온 날), end(완료일), status, 표에 넣을 칸들 }
function normReturns(x) {
  return { start: isDay(x.date) ? x.date : (x.createdAt || '').slice(0, 10), end: x.status === 'done' ? (x.doneAt || '') : '',
    done: x.status === 'done', vendor: x.vendor, name: x.name, barcode: x.barcode, sku: x.sku, qty: num(x.qty),
    detail: [x.reason, TEMP_NAME[x.temp]].filter(Boolean).join(' · '), who: '', state: x.status === 'done' ? '완료' : '대기', note: x.note, raw: x };
}
function normOvers(x) {
  return { start: isDay(x.date) ? x.date : (x.createdAt || '').slice(0, 10), end: x.status === 'done' ? (x.doneAt || '') : '',
    done: x.status === 'done', vendor: x.vendor, name: x.name, barcode: x.barcode, sku: x.sku, qty: num(x.qty),
    detail: METHOD_NAME[x.method || ''] || '', who: x.who || '',
    state: x.status === 'done' ? '완료' : (x.mail ? `대기 (메일 ${x.mail})` : '대기 (메일 전)'), note: x.comm, raw: x };
}
// 반출은 같은 반출그룹번호를 한 건으로 세요. 그룹 안 상품이 다 반출완료여야 완료예요.
function groupOuts(items) {
  const groups = new Map();
  for (const x of items) {
    const k = x.grp || `id:${x.id}`;
    const g = groups.get(k) || { lines: [], stage: 4, start: '', end: '' };
    const st = Math.max(1, Math.min(4, Number(x.stage) || 1));
    g.lines.push(x);
    g.stage = Math.min(g.stage, st);
    const s = isDay(x.cdate) ? x.cdate : (x.createdAt || '').slice(0, 10);
    if (s && (!g.start || s < g.start)) g.start = s;
    if (x.doneAt && x.doneAt > g.end) g.end = x.doneAt;
    groups.set(k, g);
  }
  return [...groups.values()].map(g => {
    if (g.stage < 4) g.end = '';
    g.done = g.stage === 4;
    g.rows = g.lines.map(x => ({ start: g.start, end: g.end, done: g.done, vendor: x.vendor, name: x.name, barcode: x.barcode, sku: '',
      qty: num(x.qty), detail: x.grp ? `그룹 ${x.grp}` : '', who: '', state: STAGE_NAME[g.stage], note: [x.due ? `기한 ${x.due}` : '', x.note].filter(Boolean).join(' · '), raw: x }));
    return g;
  });
}

function count(units, m, cut) {
  const S = `${m}-01`, E = cut;
  const open = u => u.start && u.start <= E && (!u.done || !u.end || u.end > E);
  return {
    carry: units.filter(u => u.start && u.start < S && (!u.done || !u.end || u.end >= S)).length,
    added: units.filter(u => u.start && u.start >= S && u.start <= E).length,
    done: units.filter(u => u.done && u.end && u.end >= S && u.end <= E).length,
    left: units.filter(open).length,
    doneRows: units.filter(u => u.done && u.end && u.end >= S && u.end <= E).flatMap(u => u.rows || [u]),
    leftRows: units.filter(open).flatMap(u => u.rows || [u]),
  };
}

// month: 'YYYY-MM' (없으면 지난달)
export async function buildIstReport(month) {
  const today = kstToday();
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : prevMonth(today.slice(0, 7));
  const end = lastDay(m);
  const cut = end < today ? end : today;   // 이번 달이면 오늘까지
  const raw = await pipeline(TYPES.map(t => ['HGETALL', t.redis]));
  const units = {
    returns: parseHash(raw[0]).map(normReturns),
    overs: parseHash(raw[1]).map(normOvers),
    outs: groupOuts(parseHash(raw[2])),
  };
  const parts = {};
  for (const t of TYPES) parts[t.key] = count(units[t.key], m, cut);
  const rp = {
    month: m, today, cut, partial: cut !== end,
    rows: TYPES.map(t => ({ key: t.key, name: t.name, carry: parts[t.key].carry, added: parts[t.key].added, done: parts[t.key].done, left: parts[t.key].left })),
  };
  rp.total = ['carry', 'added', 'done', 'left'].reduce((o, k) => (o[k] = rp.rows.reduce((s, r) => s + r[k], 0), o), { name: '합계' });
  rp.text = kakaoText(rp);
  rp._detail = { parts };   // 엑셀용 (화면 응답에는 안 보내요)
  return rp;
}

export function kakaoText(rp) {
  const mo = Number(rp.month.slice(5));
  const lines = [`[GWJ3 IB] ${mo}월 IST 결산${rp.partial ? ` (${rp.cut.slice(5).replace('-', '/')} 기준)` : ''}`];
  for (const r of rp.rows) lines.push(`${r.name} 완료 ${r.done} · 남음 ${r.left}`);
  lines.push(`합계 완료 ${rp.total.done} · 남음 ${rp.total.left}`);
  return lines.join('\n');
}

// 엑셀 결산표: 결산 · 완료 내역 · 남은 내역
export function reportXlsx(rp) {
  const mo = Number(rp.month.slice(5)), y = rp.month.slice(0, 4);
  const T = { v: `${y}년 ${mo}월 IST 결산`, s: { b: 1, size: 14 } };
  const sub = { v: `집계 기간 ${rp.month}-01 ~ ${rp.cut}${rp.partial ? ' (진행 중인 달)' : ''} · 만든 날 ${rp.today} · 반출은 반출그룹 기준`, s: { color: '5E6776' } };
  const C = { border: 1, align: 'center' }, CN = { border: 1, num: 1 }, CB = { border: 1, num: 1, b: 1, fill: 'DDE6F4' };
  const H = v => ({ v, s: { b: 1, color: 'FFFFFF', fill: '2557A7', align: 'center', border: 1 } });
  const rate = r => (r.carry + r.added ? r.done / (r.carry + r.added) : 0);
  const sum = [
    [T], [sub], [],
    [H('구분'), H('전월 이월'), H(`${mo}월 신규`), H(`${mo}월 완료`), H('남은 건 (월말)'), H('완료율')],
    ...rp.rows.map(r => [{ v: r.name, s: C }, { v: r.carry, s: CN }, { v: r.added, s: CN }, { v: r.done, s: CN }, { v: r.left, s: CN }, { v: rate(r), s: { border: 1, pct: 1 } }]),
    [{ v: '합계', s: { ...C, b: 1, fill: 'DDE6F4' } }, { v: rp.total.carry, s: CB }, { v: rp.total.added, s: CB }, { v: rp.total.done, s: CB }, { v: rp.total.left, s: CB }, { v: rate(rp.total), s: { border: 1, pct: 1, b: 1, fill: 'DDE6F4' } }],
    [],
    [{ v: '전월 이월 + 신규 − 완료 = 남은 건 (중간에 지운 건은 빠져요)', s: { color: '5E6776' } }],
  ];
  const parts = rp._detail.parts;
  // 종류마다 시트 하나: 위에는 완료한 건, 아래에는 남은 건
  const COLS = {
    returns: [['하차일', 11, u => u.start], ['업체', 18, u => u.raw.vendor], ['PO', 14, u => u.raw.po], ['SKU', 12, u => u.raw.sku], ['바코드', 16, u => u.raw.barcode],
      ['상품명', 40, u => u.raw.name], ['사유', 14, u => u.raw.reason], ['온도', 6, u => TEMP_NAME[u.raw.temp] || ''], ['수량', 8, u => num(u.raw.qty)], ['비고', 28, u => u.raw.note]],
    overs: [['생성일', 11, u => u.start], ['업체', 18, u => u.raw.vendor], ['SKU', 12, u => u.raw.sku], ['바코드', 16, u => u.raw.barcode], ['상품명', 40, u => u.raw.name],
      ['수량', 8, u => num(u.raw.qty)], ['담당', 9, u => u.raw.who], ['메일 발송일', 11, u => u.raw.mail], ['처리 방법', 10, u => METHOD_NAME[u.raw.method || ''] || ''], ['코멘트', 28, u => u.raw.comm]],
    outs: [['반출그룹', 14, u => u.raw.grp], ['생성일', 11, u => u.start], ['기한', 11, u => u.raw.due], ['업체', 18, u => u.raw.vendor], ['상품명', 40, u => u.raw.name],
      ['바코드', 16, u => u.raw.barcode], ['수량', 8, u => num(u.raw.qty)], ['박스수량', 8, u => num(u.raw.box)], ['집품토트', 14, u => u.raw.tote], ['비고', 28, u => u.raw.note]],
  };
  const SEC = { b: 1, size: 12, color: '2557A7' };
  const typeSheet = t => {
    const cols = COLS[t.key], p = parts[t.key], r = rp.rows.find(x => x.key === t.key);
    const byStart = (a, b) => String(a.start).localeCompare(String(b.start));
    const done = [...p.doneRows].sort((a, b) => String(a.end).localeCompare(String(b.end)) || byStart(a, b));
    const left = [...p.leftRows].sort(byStart);
    const head = first => [H(first), H('상태'), ...cols.map(c => H(c[0]))];
    const line = (u, first, state) => [first, state, ...cols.map(c => c[2](u) ?? '')].map((v, i) => ({ v: v ?? '', s: i === 0 || i === 1 ? C : (typeof v === 'number' ? CN : { border: 1 }) }));
    const unit = t.key === 'outs' ? '그룹' : '건';
    const rows = [
      [{ v: `${y}년 ${mo}월 ${t.name}`, s: { b: 1, size: 14 } }],
      [{ v: `완료 ${r.done}${unit} · 남은 건 ${r.left}${unit} (전월 이월 ${r.carry} · 신규 ${r.added})`, s: { color: '5E6776' } }],
      [],
      [{ v: `완료한 건 (${r.done}${unit}${t.key === 'outs' ? ` · 상품 ${done.length}줄` : ''})`, s: SEC }],
      head('완료일'),
      ...(done.length ? done.map(u => line(u, u.end, u.state)) : [[{ v: '없음', s: { color: '5E6776' } }]]),
      [],
      [{ v: `남은 건 (${r.left}${unit}${t.key === 'outs' ? ` · 상품 ${left.length}줄` : ''}) · ${rp.cut} 기준`, s: SEC }],
      head('경과일'),
      // 지난달 결산에서 그 뒤에 끝난 건은 '그 뒤 완료'로 적어요
      ...(left.length ? left.map(u => line(u, ageDays(u.start, rp.cut), u.done ? `대기 → ${u.end} 완료` : u.state)) : [[{ v: '없음', s: { color: '5E6776' } }]]),
    ];
    return { name: t.name, rows, widths: [10, 16, ...cols.map(c => c[1])], head: -1 };
  };
  return makeXlsx([
    { name: '결산', rows: sum, widths: [16, 12, 12, 12, 15, 10], head: -1, grid: false },
    ...TYPES.map(typeSheet),
  ]);
}
