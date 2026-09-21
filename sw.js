/* 二等無人航空機操縦士学科試験 — オフライン動作と学習リマインダー */
const VERSION = 'drone2-gakka-v3';
const SHELL   = VERSION + '-shell';
const CFG     = VERSION + '-cfg';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './fonts/jp-400.woff', './fonts/jp-700.woff', './fonts/jp-900.woff',
  './fonts/mono-400.woff', './fonts/mono-700.woff',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== CFG).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- オフライン配信 ---------- */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(hit => hit || fetch(req).catch(() => caches.match('./'))));
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(req, copy));
      return res;
    }))
  );
});

/* ---------- リマインダー設定の保管 ---------- */
const CFG_KEY = './__reminder';
function readCfg(){
  return caches.open(CFG).then(c => c.match(CFG_KEY))
    .then(r => r ? r.json() : null).catch(() => null);
}
function writeCfg(obj){
  return caches.open(CFG).then(c =>
    c.put(CFG_KEY, new Response(JSON.stringify(obj), {headers:{'Content-Type':'application/json'}})));
}

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type !== 'reminder') return;
  e.waitUntil(readCfg().then(prev => writeCfg({
    on: !!d.on,
    time: d.time || '20:00',
    lastDay: d.lastDay || '',
    body: d.body || '今日の学習がまだです。10問だけでも進めましょう。',
    notified: (prev && prev.notified) || ''
  })));
});

/* ---------- アプリを閉じていても届くリマインダー ---------- */
function ymd(dt){
  return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
}
function maybeNotify(){
  return readCfg().then(cfg => {
    if (!cfg || !cfg.on) return;
    const now = new Date(), t = ymd(now);
    if (cfg.notified === t) return;            // 今日はもう通知済み
    if (cfg.lastDay === t) return;             // 今日はもう学習している
    const p = (cfg.time || '20:00').split(':');
    const at = new Date(); at.setHours(+p[0] || 20, +p[1] || 0, 0, 0);
    if (now < at) return;                      // まだ時刻前
    cfg.notified = t;
    return writeCfg(cfg).then(() => self.registration.showNotification('学科試験ドリル', {
      body: cfg.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'drone2-reminder',
      lang: 'ja',
      data: { url: './' }
    }));
  });
}

self.addEventListener('periodicsync', e => {
  if (e.tag === 'study-reminder') e.waitUntil(maybeNotify());
});
self.addEventListener('sync', e => {
  if (e.tag === 'study-reminder') e.waitUntil(maybeNotify());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
