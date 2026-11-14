// Cloudflare Pages용 두 번째 주소에서 쓰는 중계
// - 화면 파일(index.html 등)은 Cloudflare가 직접 보내고, 팀 데이터(/api)는 원래 Vercel 서버로 그대로 넘겨요
// - 그래서 데이터 · 비밀번호 · 저장소는 지금 그대로예요 (Vercel 쪽은 아무것도 안 바뀌어요)
const ORIGIN = 'https://gwj3-ib.vercel.app';
// 브랜치 미리보기(<브랜치>.shared-todo-7tm.pages.dev)는 같은 브랜치의 Vercel 미리보기 서버로 넘겨요
// 그래야 회사 PC에서도 바뀐 서버 기능까지 미리 볼 수 있어요 (실제 주소는 그대로 ORIGIN)
function originFor(host) {
  const m = /^([a-z0-9-]+)\.shared-todo-7tm\.pages\.dev$/.exec(host);
  if (!m || /^[0-9a-f]{8}$/.test(m[1])) return ORIGIN;
  return `https://shared-todo-git-${m[1]}-dbswnqhd12.vercel.app`;
}
// Cloudflare가 붙인 머리글은 빼고 보내요 (Vercel이 다른 프록시를 거친 요청으로 보고 막지 않게)
const DROP = /^(host|cf-|x-forwarded-|x-real-ip|cdn-loop|content-length$)/i;

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const headers = new Headers();
  for (const [k, v] of request.headers) if (!DROP.test(k)) headers.set(k, v);
  try {
    const r = await fetch(originFor(url.hostname) + url.pathname + url.search, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
    });
    const out = new Headers(r.headers);
    out.delete('content-encoding'); out.delete('content-length');
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e) {
    return Response.json({ error: '원래 서버에 연결하지 못했어요 (중계 오류: ' + (e && e.message || e) + ')' }, { status: 502 });
  }
}
