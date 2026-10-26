// Spendwise service worker: makes the app installable and lets the app shell open offline.
// It never caches API responses, so money data is always live (or clearly unavailable offline).
const CACHE = 'spendwise-shell-v3';
// Batch 12Q: what another app shared to Spendwise, kept until the Share page picks it up.
const SHARED = 'spendwise-shared';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/theme-init.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARED).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Share target: a payment message or a receipt photo shared from another app arrives as a form POST to /share.
// It is put aside here and the app opens /share to read it, so nothing is lost if you're not signed in yet.
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARED);
  const text = ['title', 'text', 'url'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v.trim()).join('\n');
  await cache.put('/shared/text', new Response(text));
  const file = form.get('receipt');
  if (file && typeof file !== 'string' && file.size) await cache.put('/shared/file', new Response(file, { headers: { 'content-type': file.type || 'image/jpeg' } }));
  else await cache.delete('/shared/file');
  return Response.redirect('/share?received=1', 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share') {
    event.respondWith(receiveShare(request));
    return;
  }
  // Only this site's own GET requests; the API (and anything cross-origin) goes straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Pages: network first, so a new deploy shows at once; the cached shell is the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Built assets have content hashes in their names, so a cached copy is never stale.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })),
    );
  }
});

// Budget alerts and reminders sent by the Spendwise server (Web Push). The payload is JSON:
// { title, body, url, tag }. A newer message with the same tag replaces the older one.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Spendwise', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

// Tapping a notification focuses an open Spendwise tab (moving it to the page) or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      return tab.navigate(target).catch(() => null);
    }
    return self.clients.openWindow(target);
  })());
});
