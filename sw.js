// GWJ3 IB 앱(홈 화면 설치)용 서비스 워커
// - 화면(index.html): 항상 서버에서 최신을 받고, 인터넷이 끊겼을 때만 마지막으로 받아둔 화면을 열어요
// - 아이콘 · 글꼴 · 바코드 읽기 프로그램: 한 번 받으면 폰에 보관해서 오프라인에서도 써요
// - 팀 데이터(/api): 여기서는 건드리지 않아요 (화면 쪽에서 받아둔 내용을 따로 관리해요)
const SHELL = 'gwj3-shell-v1';
const STATIC = 'gwj3-static-v1';
const KEEP = [SHELL, STATIC, 'gwj3-data-v1'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

const OFFLINE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GWJ3 IB</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEF2F1;color:#18231F;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;text-align:center;padding:24px}
b{font-size:22px}p{color:#5E6B66}button{margin-top:12px;background:#1F6F5C;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:16px;font-weight:700}</style></head>
<body><div><b>인터넷에 연결되어 있지 않아요</b><p>와이파이나 데이터 연결을 확인한 뒤 다시 열어주세요.</p><button onclick="location.reload()">다시 시도</button></div></body></html>`;

const keepable = url => (url.origin === self.location.origin && (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest'))
  || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate'){
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        // 화면(HTML)만 받아둬요. zip 같은 다운로드 파일이 '/' 자리에 저장되지 않게 해요
        if (r.ok && url.origin === self.location.origin && !url.pathname.startsWith('/api/') && (r.headers.get('content-type') || '').includes('text/html')){
          const c = await caches.open(SHELL); c.put('/', r.clone()).catch(() => {});
        }
        return r;
      } catch {
        const c = await caches.open(SHELL);
        return (await c.match('/')) || new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  if (keepable(url)){
    // 받아둔 게 있으면 바로 쓰고, 뒤에서 새로 받아 바꿔둬요
    e.respondWith((async () => {
      const c = await caches.open(STATIC);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()).catch(() => {}); return r; }).catch(() => hit);
      return hit || net;
    })());
  }
});
