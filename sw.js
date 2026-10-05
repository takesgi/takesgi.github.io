/* 二等無人航空機操縦士学科試験 — オフライン動作・更新通知・学習リマインダー
 *
 * 2026-10 改修: index.html は「ネット優先（つながらなければ保存済みを表示）」で配信するため、
 * index.html を差し替えるだけで最新版が届きます。VERSION の数字を手で進める必要はありません。
 * VERSION を変えるのは、この sw.js 自体の仕組みを変えたときだけです（画面に更新バーが出ます）。
 */
const VERSION = 'drone2-gakka-v4';
const SHELL   = VERSION + '-shell';
const CFG     = 'drone2-gakka-v3-cfg';   // リマインダー設定の保管場所。名前を変えると設定が消えるので固定
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // 1つ取れなくても全体を失敗させない（旧版は存在しないフォントで導入に失敗していた）
  e.waitUntil(caches.open(SHELL).then(c =>
    Promise.allSettled(CORE.map(u => fetch(u, {cache:'no-cache'}).then(r => { if (r.ok) return c.put(u, r); })))
  ).then(() => { if (!self.registration.active) return self.skipWaiting(); }));  // 初回だけ即有効化
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== CFG).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- 配信 ---------- */
function timeout(ms){ return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 画面本体: ネット優先（4秒で諦めて保存済みを表示）
  if (req.mode === 'navigate') {
    e.respondWith(
      Promise.race([fetch(req, {cache:'no-cache'}), timeout(4000)]).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('./index.html', copy)); }
        return res;
      }).catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }
  // その他: 保存済みを即返し、裏で新しいものに入れ替える
  e.respondWith(
    caches.open(SHELL).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; });
      if (hit) { try { e.waitUntil(net.catch(() => {})); } catch (_) {} return hit; }
      return net;
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
  if (d.type === 'skipWaiting') { self.skipWaiting(); return; }   // 更新バーの「更新する」
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
