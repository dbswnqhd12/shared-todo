// IST Today 목록 그리기 — IST 탭 맨 위 카드(index.html)와 Today 화면(today.html)이 같이 써요.
// IstToday.render(box, snap, live, { limit, onOpen, more })
//   snap: /api/report?today=1 결과 { date, at, items }
//   live: { ret, over, out } 지금 데이터 (끝났는지 확인용, 없으면 null)
(() => {
  const CSS = `
.td{background:var(--paper);border-radius:14px;padding:16px 18px}
.td-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin-bottom:6px}
.td-head h2{margin:0;font-size:18px;letter-spacing:-.01em}
.td-head .td-when{font-size:13px;color:var(--muted)}
.td-head .td-prog{margin-left:auto;font-size:13px;font-weight:600;color:var(--accent);font-variant-numeric:tabular-nums}
.td-bar{height:5px;background:var(--accent-soft);border-radius:3px;overflow:hidden;margin:4px 0 10px}
.td-bar i{display:block;height:100%;background:var(--accent);transition:width .3s}
.td-g{margin-top:10px}
.td-g h3{margin:0 0 4px;font-size:13px;color:var(--muted);font-weight:600;display:flex;gap:6px}
.td-g h3 b{color:var(--ink);font-weight:600}
.td-row{display:grid;grid-template-columns:20px 1fr auto;gap:2px 10px;align-items:start;padding:8px 4px;border-top:1px solid var(--line);cursor:pointer;border-radius:6px}
.td-row:hover{background:var(--accent-soft)}
.td-ck{width:18px;height:18px;border-radius:50%;border:2px solid var(--line);margin-top:2px;display:grid;place-items:center}
.td-row.done .td-ck{background:var(--accent);border-color:var(--accent)}
.td-row.done .td-ck::after{content:"";width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg) translate(-1px,-1px)}
.td-main{min-width:0}
.td-act{font-weight:700;font-size:14px}
.td-ttl{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-sub{font-size:12px;color:var(--muted)}
.td-row.done .td-act,.td-row.done .td-ttl{color:var(--muted);text-decoration:line-through}
.td-tag{font-size:12px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);white-space:nowrap}
.td-tag.hot{background:var(--high-soft,#F6E1DB);color:var(--high)}
.td-more{display:inline-block;margin-top:6px;font-size:13px;font-weight:600;color:var(--accent);background:none;border:0;padding:4px 0;cursor:pointer;text-decoration:none}
.td-fold{margin-left:8px;font:inherit;font-size:12px;color:var(--muted);background:none;border:0;cursor:pointer;padding:0}
.tc{background:var(--paper);border-radius:16px;padding:18px 20px}
.tc-top{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.tc-ring{--p:0;width:52px;height:52px;flex:none;border-radius:50%;background:conic-gradient(var(--accent) calc(var(--p)*1%),var(--accent-soft) 0);display:grid;place-items:center}
.tc-ring span{width:40px;height:40px;border-radius:50%;background:var(--paper);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.tc-ttl{min-width:0}
.tc-ttl h2{margin:0;font-size:19px;letter-spacing:-.01em}
.tc-ttl p{margin:1px 0 0;font-size:13px;color:var(--muted)}
.tc-all{margin-left:auto;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none;white-space:nowrap}
.tc-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.tc-tile{border:0;text-align:left;font:inherit;color:inherit;background:var(--bg);border-radius:12px;padding:12px 14px;cursor:pointer;display:flex;flex-direction:column;gap:2px;min-width:0}
.tc-tile:hover{outline:2px solid var(--accent-soft)}
.tc-tile.hot{background:var(--high-soft,#F6E1DB)}
.tc-tile .k{font-size:13px;font-weight:600;color:var(--muted)}
.tc-tile .n{font-size:28px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.tc-tile .n small{font-size:13px;font-weight:600;color:var(--muted);margin-left:2px}
.tc-tile .h{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-tile.hot .h{color:var(--high);font-weight:600}
.tc-tile.clear .n{color:var(--accent)}
.tc-list{margin-top:14px}
.tc-list h3{margin:0 0 4px;font-size:13px;font-weight:600;color:var(--muted)}
.tc-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 4px;border-top:1px solid var(--line);cursor:pointer;border-radius:6px}
.tc-row:hover{background:var(--accent-soft)}
.tc-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);white-space:nowrap}
.tc-txt{min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-txt b{font-weight:700;margin-right:6px}
.tc-txt span{color:var(--muted)}
.tc-done{margin-top:10px;font-size:13px;color:var(--muted)}
@media (max-width:600px){.tc{padding:16px}.tc-tiles{gap:8px}.tc-tile{padding:10px 11px}.tc-tile .n{font-size:24px}}
.td-empty{color:var(--muted);font-size:14px;padding:6px 0}
`;
  const GROUPS = [['out', '반출'], ['over', '과매입'], ['ret', '회송']];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function isDone(it, live) {
    if (!live) return false;
    const list = live[it.t];
    if (!list) return false;
    const map = new Map(list.map(x => [x.id, x]));
    if (it.t === 'out') return it.ids.every(id => { const x = map.get(id); return !x || (Number(x.stage) || 1) > it.stage; });
    const x = map.get(it.ids[0]);
    if (!x || x.status === 'done') return true;
    return it.t === 'over' && !it.mail && !!x.mail;   // '메일 보내기'는 메일 발송일이 들어가면 끝
  }

  function when(snap) {
    const d = new Date(snap.date + 'T12:00:00Z');
    const w = '일월화수목금토'[d.getUTCDay()];
    return `${Number(snap.date.slice(5, 7))}월 ${Number(snap.date.slice(8))}일 (${w}) 아침 7시 기준`;
  }

  // IST 탭 맨 위 카드: 남은 건수 타일 3개 + 먼저 할 일 몇 개
  const RANK_HOT = x => /지남|오늘/.test(x.tag || '');
  function renderCard(box, snap, live, opt) {
    const items = (snap && snap.items) || [];
    const marked = items.map(it => ({ ...it, done: isDone(it, live) }));
    const doneN = marked.filter(x => x.done).length;
    const pct = items.length ? Math.round(doneN / items.length * 100) : 100;
    const left = marked.filter(x => !x.done);
    const tile = (t, name) => {
      const g = left.filter(x => x.t === t);
      const hot = g.filter(RANK_HOT);
      let hint = '';
      if (t === 'out') hint = hot.length ? [g.filter(x => /지남/.test(x.tag)).length && `기한 지남 ${g.filter(x => /지남/.test(x.tag)).length}`, g.filter(x => x.tag === '오늘 기한').length && `오늘 기한 ${g.filter(x => x.tag === '오늘 기한').length}`].filter(Boolean).join(' · ') : (g.length ? '진행 중인 반출그룹' : '');
      if (t === 'over') { const m = g.filter(x => !x.mail).length; hint = m ? `메일 전 ${m}` : (g.length ? '처리할 것' : ''); }
      if (t === 'ret') { const o = g.filter(x => x.tag).length; hint = o ? `7일 넘음 ${o}` : (g.length ? '대기 중' : ''); }
      if (!g.length) hint = '오늘 할 일 없음';
      const warn = hot.length || (t !== 'out' && g.some(x => x.tag));
      return `<button type="button" class="tc-tile${hot.length ? ' hot' : ''}${g.length ? '' : ' clear'}" data-t="${t}"><span class="k">${name}</span><span class="n">${g.length}<small>건</small></span><span class="h">${esc(hint)}</span></button>`;
    };
    const rank = x => (/지남/.test(x.tag) ? 0 : x.tag === '오늘 기한' ? 1 : x.tag ? 2 : 3);
    const order = { out: 0, over: 1, ret: 2 };
    const first = [...left].sort((a, b) => rank(a) - rank(b) || order[a.t] - order[b.t]).slice(0, opt.limit || 4);
    const NAME = { out: '반출', over: '과매입', ret: '회송' };
    let html = `<div class="tc"><div class="tc-top"><div class="tc-ring" style="--p:${pct}"><span>${pct}%</span></div>`
      + `<div class="tc-ttl"><h2>Today</h2><p>${snap ? esc(when(snap)) : ''} · ${items.length ? `${items.length}건 중 ${doneN}건 끝` : '할 일 없음'}</p></div>`
      + (opt.more ? `<a class="tc-all" href="${opt.more}" target="_blank" rel="noopener">전체 보기 →</a>` : '') + `</div>`
      + `<div class="tc-tiles">${tile('out', '반출')}${tile('over', '과매입')}${tile('ret', '회송')}</div>`;
    if (first.length) html += `<div class="tc-list"><h3>먼저 할 일</h3>` + first.map(x => `<div class="tc-row" data-t="${x.t}" role="button" tabindex="0"><span class="tc-chip">${NAME[x.t]}</span>`
      + `<div class="tc-txt"><b>${esc(x.action)}</b><span>${esc(x.title)}</span></div>`
      + (x.tag ? `<span class="td-tag${RANK_HOT(x) ? ' hot' : ''}">${esc(x.tag)}</span>` : '<span></span>') + `</div>`).join('') + `</div>`;
    else if (items.length) html += `<p class="tc-done">오늘 할 일을 다 끝냈어요.</p>`;
    html += `</div>`;
    box.innerHTML = html;
    if (opt.onOpen) box.querySelectorAll('.tc-row, .tc-tile').forEach(r => {
      r.onclick = () => opt.onOpen(r.dataset.t);
      r.onkeydown = e => { if (e.key === 'Enter') opt.onOpen(r.dataset.t); };
    });
  }

  function render(box, snap, live, opt = {}) {
    if (!document.getElementById('td-css')) { const s = document.createElement('style'); s.id = 'td-css'; s.textContent = CSS; document.head.appendChild(s); }
    if (opt.compact) return renderCard(box, snap, live, opt);
    const items = (snap && snap.items) || [];
    const marked = items.map(it => ({ ...it, done: isDone(it, live) }));
    const doneN = marked.filter(x => x.done).length;
    let html = `<div class="td"><div class="td-head"><h2>Today</h2><span class="td-when">${snap ? esc(when(snap)) : ''}</span>`
      + (items.length ? `<span class="td-prog">${doneN} / ${items.length} 완료</span>` : '') + `</div>`
      + (items.length ? `<div class="td-bar"><i style="width:${Math.round(doneN / items.length * 100)}%"></i></div>` : '');
    if (!items.length) html += `<p class="td-empty">오늘 처리할 IST 업무가 없어요.</p>`;
    let hidden = 0;
    html += `<div class="td-gs">`;
    for (const [t, name] of GROUPS) {
      const g = marked.filter(x => x.t === t).sort((a, b) => a.done - b.done);
      if (!g.length) continue;
      const left = g.filter(x => !x.done).length;
      const show = opt.limit ? g.slice(0, opt.limit) : g;
      hidden += g.length - show.length;
      html += `<section class="td-g"><h3>${name} <b>${left}건 남음</b>${left < g.length ? ` · ${g.length - left}건 완료` : ''}</h3>`
        + show.map(x => `<div class="td-row${x.done ? ' done' : ''}" data-t="${x.t}" role="button" tabindex="0"><span class="td-ck" aria-label="${x.done ? '완료' : '할 일'}"></span>`
          + `<div class="td-main"><div class="td-act">${esc(x.action)}</div><div class="td-ttl">${esc(x.title)}</div>${x.sub ? `<div class="td-sub">${esc(x.sub)}</div>` : ''}</div>`
          + `${x.tag ? `<span class="td-tag${/지남|오늘/.test(x.tag) ? ' hot' : ''}">${esc(x.tag)}</span>` : '<span></span>'}</div>`).join('')
        + (g.length > show.length ? `<div class="td-sub td-more-n" style="padding:4px">+ ${g.length - show.length}건 더</div>` : '')
        + `</section>`;
    }
    html += `</div>`;
    if (opt.more) html += `<a class="td-more" href="${opt.more}" target="_blank" rel="noopener">${hidden ? `전체 ${items.length}건 크게 보기` : 'Today 화면으로 크게 보기'} →</a>`;
    html += `</div>`;
    box.innerHTML = html;
    if (opt.onOpen) box.querySelectorAll('.td-row').forEach(r => {
      r.onclick = () => opt.onOpen(r.dataset.t);
      r.onkeydown = e => { if (e.key === 'Enter') opt.onOpen(r.dataset.t); };
    });
  }

  window.IstToday = { render, isDone };
})();
