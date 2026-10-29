// Service worker: офлайн-режим для Tarvriqo.
// Стратегия: сначала сеть (всегда свежая версия после деплоя), при отсутствии сети — копия из кэша.
// Запросы к /api/ и к другим сайтам (Supabase, Gemini, шрифты) не трогаем.
const CACHE = "tarvriqo-v1"; // при крупных изменениях поменяйте на v2, v3...
const SHELL = [
  "./", "index.html", "styles.css", "config.js", "i18n.js", "store.js", "app.js",
  "receipt.js", "scanner.js", "scene.js", "support.js", "vendor/supabase.js",
  "icon.svg", "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Каждый файл добавляем отдельно: если один не загрузился, остальные всё равно сохранятся.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
      )
  );
});
