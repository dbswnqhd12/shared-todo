// GWJ3 IB 앱(홈 화면 설치)용 서비스 워커
// 아무것도 저장(캐시)하지 않아요. 항상 최신 화면을 서버에서 받아오고,
// 인터넷이 끊겼을 때만 "연결을 확인하세요" 화면을 보여줘요.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const OFFLINE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GWJ3 IB</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEF2F1;color:#18231F;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;text-align:center;padding:24px}
b{font-size:22px}p{color:#5E6B66}button{margin-top:12px;background:#1F6F5C;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:16px;font-weight:700}</style></head>
<body><div><b>인터넷에 연결되어 있지 않아요</b><p>와이파이나 데이터 연결을 확인한 뒤 다시 열어주세요.</p><button onclick="location.reload()">다시 시도</button></div></body></html>`;
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;   // 화면 이동만 챙기고, 데이터 요청은 그대로 둬요
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
