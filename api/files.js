// 과매입 건에 붙이는 PDF (Vercel Blob · 비공개 저장소)
//   POST   /api/files?id=과매입ID&name=파일이름   본문 = PDF 파일 그대로 (4MB까지) → { item }
//   GET    /api/files?id=과매입ID&p=pathname     → PDF (팀 비밀번호 확인 뒤 스트리밍)
//   DELETE /api/files?id=과매입ID&p=pathname     → { item }
// 파일 목록은 과매입 건(over:items)의 files 칸에 [{ p, u, n, s, at, who }] 로 저장해요.
import { Readable } from 'node:stream';
import { put, get, del } from '@vercel/blob';
import { K, redis, pipeline, guard, fail, UserError } from '../lib/store.js';

const KEY = 'over:items';
const MAX_BYTES = 4 * 1024 * 1024;   // 서버 업로드 한도(4.5MB) 안쪽
const MAX_FILES = 10;
const WHO = ['Tate', 'Charlie', 'V', 'Just', 'Aizen', 'Ayden', 'Lucan', 'Mir'];

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) throw new UserError('파일이 너무 커요. 4MB 이하 PDF만 올릴 수 있어요.');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const cleanName = s => String(s || 'file.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'file.pdf';

async function loadItem(id) {
  const raw = await redis('HGET', KEY, id);
  if (!raw) throw new UserError('이미 삭제된 과매입 건이에요.');
  return JSON.parse(raw);
}
const saveItem = item => pipeline([['HSET', KEY, item.id, JSON.stringify(item)], ['INCR', K.rev]]);

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    const id = String(req.query?.id || '');
    if (!id) throw new UserError('id가 필요해요.');

    if (req.method === 'POST') {
      const item = await loadItem(id);
      const files = Array.isArray(item.files) ? item.files : [];
      if (files.length >= MAX_FILES) throw new UserError(`한 건에 PDF는 ${MAX_FILES}개까지 붙일 수 있어요.`);
      const buf = await readBody(req);
      if (!buf.length) throw new UserError('빈 파일이에요.');
      if (buf.length > MAX_BYTES) throw new UserError('파일이 너무 커요. 4MB 이하 PDF만 올릴 수 있어요.');
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new UserError('PDF 파일만 올릴 수 있어요.');
      let name = cleanName(req.query?.name);
      if (!/\.pdf$/i.test(name)) name += '.pdf';
      const blob = await put(`over/${id}/doc.pdf`, buf, { access: 'private', addRandomSuffix: true, contentType: 'application/pdf' });
      const who = WHO.includes(String(req.query?.who || '')) ? String(req.query.who) : '';
      // 올리는 사이에 다른 칸이 바뀌었을 수 있어서 다시 읽고 붙여요
      const fresh = await loadItem(id);
      fresh.files = [...(Array.isArray(fresh.files) ? fresh.files : []), { p: blob.pathname, u: blob.url, n: name, s: buf.length, at: new Date().toISOString(), who }];
      await saveItem(fresh);
      return res.status(201).json({ item: fresh });
    }

    const p = String(req.query?.p || '');
    if (req.method === 'GET') {
      const item = await loadItem(id);
      const f = (item.files || []).find(x => x.p === p);
      if (!f) return res.status(404).json({ error: '파일을 찾지 못했어요.' });
      const r = await get(f.p, { access: 'private' });
      if (!r || r.statusCode !== 200) return res.status(404).json({ error: '파일을 찾지 못했어요.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.n)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      Readable.fromWeb(r.stream).pipe(res);
      return;
    }

    if (req.method === 'DELETE') {
      const item = await loadItem(id);
      const f = (item.files || []).find(x => x.p === p);
      if (f) {
        try { await del(f.u || f.p); } catch { /* 저장소에서 이미 없어도 목록에서는 빼요 */ }
        item.files = item.files.filter(x => x.p !== p);
        await saveItem(item);
      }
      return res.status(200).json({ item });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return fail(res, e);
  }
}
