// 아주 작은 .xlsx 만들기 (외부 라이브러리 없이, 압축 없는 zip) — 서버용, 시트 여러 개
// sheets: [{ name, rows: [[칸, …], …], widths: [숫자, …], head: 머리줄 번호(0부터, 없으면 -1) }]
// 칸은 값이거나 { v, s: { b, size, color, fill, align, border, num, pct } }
export function makeXlsx(sheets) {
  const X = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], borders = ['<border/>'], xfs = [];
  const idx = (arr, x) => { let i = arr.indexOf(x); if (i < 0) { arr.push(x); i = arr.length - 1; } return i; };
  const thin = '<color rgb="FFC9D1DD"/>';
  const sty = o => {
    o = o || {};
    const f = idx(fonts, `<font>${o.b ? '<b/>' : ''}<sz val="${o.size || 10}"/>${o.color ? `<color rgb="FF${o.color}"/>` : ''}<name val="맑은 고딕"/></font>`);
    const fi = o.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fill}"/></patternFill></fill>`) : 0;
    const bo = o.border ? idx(borders, `<border><left style="thin">${thin}</left><right style="thin">${thin}</right><top style="thin">${thin}</top><bottom style="thin">${thin}</bottom><diagonal/></border>`) : 0;
    const al = o.align ? `<alignment horizontal="${o.align}" vertical="center"/>` : '';
    const nf = o.pct ? 9 : o.num ? 3 : 0;
    return idx(xfs, `<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${bo}" applyFont="1"${fi ? ' applyFill="1"' : ''}${bo ? ' applyBorder="1"' : ''}${nf ? ' applyNumberFormat="1"' : ''}${al ? ` applyAlignment="1">${al}</xf>` : '/>'}`);
  };
  sty(null);
  const HEAD = { b: 1, color: 'FFFFFF', fill: '2557A7', align: 'center', border: 1 };
  const BODY = sty({ border: 1 }), BODYNUM = sty({ border: 1, num: 1 });

  const sheetXml = sh => {
    const head = sh.head ?? 0;
    const cell = (v, r, c) => {
      let st;
      if (v && typeof v === 'object') { st = sty(v.s); v = v.v; }
      else if (r === head) st = sty(HEAD);
      else if (r > head && head >= 0) st = typeof v === 'number' ? BODYNUM : BODY;
      else st = 0;
      const ref = colName(c) + (r + 1), s = st ? ` s="${st}"` : '';
      if (v === '' || v == null) return st ? `<c r="${ref}"${s}/>` : '';
      return typeof v === 'number' && isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${X(v)}</t></is></c>`;
    };
    const last = sh.rows.length, wide = Math.max(1, ...sh.rows.map(r => r.length));
    const filter = head >= 0 && last > head + 1 && sh.filter !== false;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${sh.grid === false ? ' showGridLines="0"' : ''}>${head >= 0 && sh.freeze !== false ? `<pane ySplit="${head + 1}" topLeftCell="A${head + 2}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews>`
      + `<cols>${(sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`
      + sh.rows.map((r, ri) => `<row r="${ri + 1}"${ri === head ? ' ht="20" customHeight="1"' : ''}>${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('')
      + `</sheetData>${filter ? `<autoFilter ref="A${head + 1}:${colName(wide - 1)}${last}"/>` : ''}</worksheet>`;
  };

  const n = sheets.length;
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
  ];
  const sheetFiles = sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]);   // 스타일을 다 모은 뒤에 styles.xml을 써요
  files.push(['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`], ...sheetFiles);

  const enc = new TextEncoder();
  const crcT = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const parts = [], central = []; let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), c = crc(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    const local = Uint8Array.from([...u32(0x04034b50), ...common]);
    parts.push(local, nb, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += local.length + nb.length + data.length;
  }
  const cs = central.reduce((s, b) => s + b.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cs), ...u32(off), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}
