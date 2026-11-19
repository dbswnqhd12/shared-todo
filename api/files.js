// 첨부 파일 (Vercel Blob · 비공개 저장소)
// ① 과매입 건에 붙이는 PDF
//   POST   /api/files?id=과매입ID&name=파일이름   본문 = PDF 파일 그대로 (4MB까지) → { item }
//   GET    /api/files?id=과매입ID&p=pathname     → PDF (팀 비밀번호 확인 뒤 스트리밍)
//   DELETE /api/files?id=과매입ID&p=pathname     → { item }
//   파일 목록은 과매입 건(over:items)의 files 칸에 [{ p, u, n, s, at, who }] 로 저장해요.
// ② 달력 일정(할 일)에 붙이는 사진 — 위와 같고 kind=todo 를 붙여요
//   POST   /api/files?kind=todo&id=일정ID       본문 = JPG · PNG · WEBP 그대로 (4MB까지) → { item }
//   GET    /api/files?kind=todo&id=일정ID&p=…   → 사진
//   DELETE /api/files?kind=todo&id=일정ID&p=…   → { item }
//   사진 목록은 일정(shared-todos)의 imgs 칸에 [{ p, u, s, at, by }] 로 저장해요.
import { Readable } from 'node:stream';
import { put, get, del } from '@vercel/blob';
import { K, redis, pipeline, guard, fail, UserError } from '../lib/store.js';

const KEY = 'over:items';
const MAX_BYTES = 4 * 1024 * 1024;   // 서버 업로드 한도(4.5MB) 안쪽
const MAX_FILES = 10;
const WHO = ['Tate', 'Charlie', 'V', 'Just', 'Aizen', 'Ayden', 'Lucan', 'Mir'];
const MAX_IMGS = 6;
// 사진 종류는 파일 앞부분(매직 넘버)으로 확인해요
function imgType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return ['image/png', 'png'];
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return ['image/webp', 'webp'];
  return null;
}

async function loadTodo(id) {
  const raw = await redis('HGET', K.todos, id);
  if (!raw) throw new UserError('이미 삭제된 일정이에요.');
  return JSON.parse(raw);
}
const saveTodo = item => pipeline([['HSET', K.todos, item.id, JSON.stringify(item)], ['INCR', K.rev]]);

async function todoImages(req, res, id) {
  const p = String(req.query?.p || '');
  if (req.method === 'POST') {
    const item = await loadTodo(id);
    if ((item.imgs || []).length >= MAX_IMGS) throw new UserError(`한 일정에 사진은 ${MAX_IMGS}장까지 붙일 수 있어요.`);
    const buf = await readBody(req);
    if (!buf.length) throw new UserError('빈 파일이에요.');
    if (buf.length > MAX_BYTES) throw new UserError('사진이 너무 커요. 4MB 이하만 올릴 수 있어요.');
    const t = imgType(buf);
    if (!t) throw new UserError('사진(JPG · PNG · WEBP)만 올릴 수 있어요.');
    const blob = await put(`todo/${id}/img.${t[1]}`, buf, { access: 'private', addRandomSuffix: true, contentType: t[0] });
    const fresh = await loadTodo(id);
    fresh.imgs = [...(Array.isArray(fresh.imgs) ? fresh.imgs : []), { p: blob.pathname, u: blob.url, s: buf.length, at: new Date().toISOString(), by: req.user.name }];
    await saveTodo(fresh);
    return res.status(201).json({ item: fresh });
  }
  if (req.method === 'GET') {
    const item = await loadTodo(id);
    const f = (item.imgs || []).find(x => x.p === p);
    if (!f) return res.status(404).json({ error: '사진을 찾지 못했어요.' });
    const r = await get(f.p, { access: 'private' });
    if (!r || r.statusCode !== 200) return res.status(404).json({ error: '사진을 찾지 못했어요.' });
    const ext = (f.p.match(/\.(jpg|png|webp)$/) || [])[1] || 'jpg';
    res.setHeader('Content-Type', ext === 'jpg' ? 'image/jpeg' : 'image/' + ext);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    Readable.fromWeb(r.stream).pipe(res);
    return;
  }
  if (req.method === 'DELETE') {
    const item = await loadTodo(id);
    const f = (item.imgs || []).find(x => x.p === p);
    if (f) {
      try { await del(f.u || f.p); } catch { /* 저장소에서 이미 없어도 목록에서는 빼요 */ }
      item.imgs = item.imgs.filter(x => x.p !== p);
      await saveTodo(item);
    }
    return res.status(200).json({ item });
  }
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
}

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
    if (req.query?.kind === 'todo') return await todoImages(req, res, id);

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
