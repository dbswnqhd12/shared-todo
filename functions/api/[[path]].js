// Cloudflare Pages용 두 번째 주소에서 쓰는 중계
// - 화면 파일(index.html 등)은 Cloudflare가 직접 보내고, 팀 데이터(/api)는 원래 Vercel 서버로 그대로 넘겨요
// - 그래서 데이터 · 비밀번호 · 저장소는 지금 그대로예요 (Vercel 쪽은 아무것도 안 바뀌어요)
const ORIGIN = 'https://shared-todo-beta.vercel.app';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = ORIGIN + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  const r = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
}
