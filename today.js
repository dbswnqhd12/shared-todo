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
.td.compact .td-gs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 18px}
@media (max-width:760px){.td.compact .td-gs{grid-template-columns:1fr}}
.td.compact .td-row{grid-template-columns:18px minmax(0,1fr) auto;padding:6px 2px;align-items:center}
.td.compact .td-ck{width:16px;height:16px;margin:0}
.td.compact .td-main{display:flex;gap:8px;min-width:0}
.td.compact .td-act{font-size:13px;white-space:nowrap}
.td.compact .td-ttl{font-size:13px;color:var(--muted)}
.td.compact .td-sub{display:none}
.td.compact .td-more-n{display:block!important;font-size:12px;color:var(--muted);padding:2px}
.td-fold{margin-left:8px;font:inherit;font-size:12px;color:var(--muted);background:none;border:0;cursor:pointer;padding:0}
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

  function render(box, snap, live, opt = {}) {
    if (!document.getElementById('td-css')) { const s = document.createElement('style'); s.id = 'td-css'; s.textContent = CSS; document.head.appendChild(s); }
    const items = (snap && snap.items) || [];
    const marked = items.map(it => ({ ...it, done: isDone(it, live) }));
    const doneN = marked.filter(x => x.done).length;
    let html = `<div class="td${opt.compact ? ' compact' : ''}"><div class="td-head"><h2>Today</h2><span class="td-when">${snap ? esc(when(snap)) : ''}</span>`
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
