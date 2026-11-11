// 멍글마을 서비스 워커 — 홈 화면 앱(PWA)용
//  · 페이지: 항상 네트워크 먼저 (새 배포가 바로 보이게). 인터넷이 끊겼을 때만 안내 화면
//  · /assets/ (파일 이름에 해시가 붙은 빌드 파일): 한 번 받으면 기기에 보관해 다음부터 빠르게
//  · API·실시간 연결·업로드 사진은 손대지 않음 (항상 서버로)
const ASSETS = 'mungle-assets-v1';
const SHELL = 'mungle-shell-v1';
const SHELL_FILES = ['/offline.html', '/logo.svg'];
const MAX_ASSETS = 80;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== ASSETS && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(api|socket\.io|uploads)(\/|$)/.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match('/offline.html')) || Response.error()));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      const type = res.headers.get('content-type') || '';
      if (res.ok && !type.includes('text/html')) { await cache.put(req, res.clone()); e.waitUntil(trim(cache)); }
      return res;
    })());
  }
});
