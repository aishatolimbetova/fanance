// Локальный сервер для разработки: просто отдаёт файлы из папки public.
// Вход и база данных в Supabase. Единственный API здесь — /api/ai (ИИ-помощник, см. ai.js; нужен ANTHROPIC_API_KEY).
// Сайт можно выложить на любой статический хостинг (Netlify, Vercel, GitHub Pages) без этого файла.
const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");

const ai = require("./ai");

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json",
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/api/ai") return ai.handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} });
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(PUB, path.normalize(p));
  // Не выпускаем запрос за пределы public (защита от путей вида /../server.js).
  if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  const type = MIME[path.extname(f)] || "application/octet-stream";
  // Текстовые файлы сжимаем gzip, если браузер это поддерживает: библиотека Supabase весит 218 КБ, сжатая — около 55 КБ.
  const gzip = /text|javascript|json|svg|manifest/.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache", ...(gzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) });
  const stream = fs.createReadStream(f);
  (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
}).listen(PORT, () => console.log("http://localhost:" + PORT));
