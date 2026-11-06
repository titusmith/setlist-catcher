// Offline cache so the app opens in a basement with no signal.
// The app's own files are network-first (updates arrive whenever there's signal);
// fonts and the zip library are cache-first.
const CACHE = 'setlist-buddy-v7';
const CORE = ['./', './index.html', './spotify.js', './callback.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    const key = req.mode === 'navigate' ? url.origin + url.pathname : req; // ignore ?code=… on callback
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })));
  }
});

// ---------- notifications ----------
// The helper sends an empty push. The phone then asks the helper what to show.
function settings(){
  return new Promise(res => {
    const r = indexedDB.open('setlist-catcher', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('clips'); };
    r.onerror = () => res({});
    r.onsuccess = () => { try { const g = r.result.transaction('kv').objectStore('kv').get('settings'); g.onsuccess = () => res(g.result || {}); g.onerror = () => res({}); } catch (e) { res({}); } };
  });
}
self.addEventListener('push', e => e.waitUntil((async () => {
  const st = await settings();
  let notices = [];
  if (st.helperUrl && st.subId) {
    try { const r = await fetch(st.helperUrl.replace(/\/+$/, '') + '/notices?sub=' + encodeURIComponent(st.subId)); notices = ((await r.json()).notices) || []; } catch (err) {}
  }
  // Android requires a notification for every push, even if the helper had nothing to say.
  if (!notices.length) notices = [{ title: 'Setlist Buddy', body: 'There’s news about one of your shows. Tap to see it.', showId: null }];
  await Promise.all(notices.map(n => self.registration.showNotification(n.title, {
    body: n.body, icon: 'icon-192.png', badge: 'icon-192.png',
    tag: 'sb-' + (n.showId || 'news') + '-' + (n.kind || 'posted'),
    data: { showId: n.showId, kind: n.kind || 'posted' }
  })));
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const hash = d.showId ? (d.kind === 'reminder' ? '#setlist-' : '#review-') + encodeURIComponent(d.showId) : '';
  const url = self.registration.scope + hash;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open) { if (hash) open.postMessage({ open: hash }); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
