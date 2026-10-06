/* Hydrox 45 service worker (T6). Hand-written per docs/API.md:
 *  - precache nothing at install beyond "/"
 *  - navigations: network first, cached "/" as the offline fallback
 *  - hashed "/assets/*": cache first
 *  - push → show the payload { title, body, url, tag }
 *  - notificationclick → focus an open client or open `url`
 *  - skipWaiting + clients.claim so an update applies on the next open
 */
const CACHE = 'hydrox45-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(SHELL, { cache: 'reload' })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(SHELL, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
  // Everything else (/api/*, manifest, icons, sw.js) goes straight to the network.
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Hydrox 45', body: '', url: '/', tag: undefined };
  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch {
      payload.body = event.data.text();
    }
  }
  const options = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/' },
  };
  if (payload.tag) {
    options.tag = payload.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Hydrox 45', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          if ('navigate' in client && client.url !== target) {
            return client.navigate(target).then((c) => (c || client).focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
