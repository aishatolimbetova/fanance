// Сканер чеков: фото → OCR (Tesseract.js, прямо в браузере) → сумма, дата, товары → расход.
// Разбор текста лежит в receipt.js. Здесь — загрузка фото, подготовка картинки, экран результата.
// Использует глобальные из app.js: $, t, cn, money, pn, esc, isoDay, db, save, newId, render, toast, show, view.
(() => {
"use strict";
if (!$("v-scan")) return;

const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let worker = null, onProg = null, busy = false, items = [], previewUrl = "";

// ---------- Загрузка движка (один раз, по требованию) ----------
const loadScript = src => new Promise((ok, no) => {
  const s = document.createElement("script");
  s.src = src; s.onload = ok; s.onerror = () => no(new Error("script"));
  document.head.appendChild(s);
});
async function getWorker() {
  if (worker) return worker;
  if (!window.Tesseract) await loadScript(TESS);
  const w = await Tesseract.createWorker("rus+eng", 1, { logger: m => onProg && onProg(m) });
  await w.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: "6" });
  return (worker = w);
}

// ---------- Подготовка изображения ----------
// Масштаб до удобного для OCR размера, перевод в серый и выравнивание неравномерного освещения
// (тень от руки, загиб бумаги): каждый пиксель делится на среднюю яркость вокруг него.
function loadImage(file) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => ok({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error("img")); };
    img.src = url;
  });
}
function prepare(img) {
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const k = long > 2600 ? 2600 / long : long < 1400 ? Math.min(2.5, 1800 / long) : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), px = im.data, n = w * h;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) gray[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
  // интегральное изображение для быстрого локального среднего
  const W1 = w + 1, ii = new Uint32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; }
  }
  const r = Math.max(12, Math.round(Math.min(w, h) / 14));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
      const v = (gray[y * w + x] / Math.max(mean, 1) - .45) / .5; // фон ≈ 1 → белый, текст ≈ .3–.6 → тёмный
      const o = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
      const p = (y * w + x) * 4; px[p] = px[p + 1] = px[p + 2] = o; px[p + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  return c;
}

// ---------- Интерфейс ----------
let statusKey = "";
const setStatus = (msg, p) => {
  statusKey = msg || "";
  $("sc-status").textContent = msg ? t(msg) : "";
  $("sc-prog").hidden = p == null;
  if (p != null) $("sc-bar").style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + "%";
};
const num = v => { const n = pn(v); return isFinite(n) ? n : 0; };
const r2 = v => Math.round(v * 100) / 100;

function fillCats(sel) {
  const c = $("sc-cat");
  c.innerHTML = CATS.expense.map(k => `<option value="${k}">${cn(k)}</option>`).join("");
  c.value = sel || "other";
}
function renderItems() {
  $("sc-items").innerHTML = items.length ? items.map((x, i) => `<div class="sc-it">
      <input data-k="name" data-i="${i}" value="${esc(x.name)}" maxlength="60" aria-label="${t("sc_iname")}" placeholder="${t("sc_iname")}">
      <input data-k="price" data-i="${i}" value="${x.price}" inputmode="decimal" aria-label="${t("sc_iprice")}" placeholder="0">
      <button class="del" type="button" data-sdel="${i}" aria-label="×">×</button></div>`).join("")
    : `<p class="sm">${t("sc_none")}</p>`;
  renderSum();
}
function renderSum() {
  const s = r2(items.reduce((a, x) => a + num(x.price), 0)), tot = num($("sc-amt").value);
  const bad = items.length && tot > 0 && Math.abs(s - tot) > .5;
  $("sc-sum").className = "sc-sum sm" + (bad ? " over" : "");
  $("sc-sum").textContent = items.length ? `${t("sc_sum")}: ${money(s)}${bad ? " — " + t("sc_diff") : ""}` : "";
}
function showResult(r, text) {
  $("sc-empty").hidden = true; $("sc-form").hidden = false;
  $("sc-amt").value = r.total || "";
  $("sc-date").value = r.date || isoDay(new Date());
  $("sc-merch").value = r.merchant || "";
  fillCats(r.category);
  items = r.items.map(x => ({ name: x.name, price: x.price }));
  renderItems();
  $("sc-raw").textContent = text.trim();
  const miss = [!r.total && t("amount"), !r.date && t("date")].filter(Boolean);
  const e = $("sc-err");
  e.className = "err info"; e.textContent = miss.length ? `${miss.join(", ")}: ${t("sc_miss")}` : ""; e.hidden = !miss.length;
  $("sc-form").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function reset() {
  items = [];
  $("sc-form").hidden = true; $("sc-empty").hidden = false; $("sc-prev").hidden = true;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; }
  $("sc-img").removeAttribute("src"); setStatus("");
}

async function scan(file) {
  if (busy) return;
  if (!file || !/^image\//.test(file.type || "image/")) { toast(t("sc_notimg")); return; }
  busy = true;
  $("sc-pick").disabled = $("sc-cam").disabled = true;
  $("sc-prev").hidden = false; $("sc-form").hidden = true; $("sc-empty").hidden = false;
  try {
    setStatus("sc_prep", 0.02);
    const { img, url } = await loadImage(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = url; $("sc-img").src = url;
    await new Promise(r => setTimeout(r, 30)); // даём браузеру показать превью до тяжёлой обработки
    const canvas = prepare(img);
    onProg = m => {
      const st = String(m.status || ""), p = m.progress || 0;
      if (/core|initializing tesseract/.test(st)) setStatus("sc_load", .05 + p * .15);
      else if (/language|initializing api/.test(st)) setStatus("sc_lang", .2 + p * .25);
      else if (/recognizing/.test(st)) setStatus("sc_read", .45 + p * .55);
    };
    setStatus("sc_load", .05);
    const w = await getWorker();
    const { data } = await w.recognize(canvas);
    const r = Receipt.parse(data.text, new Date());
    showResult(r, data.text);
    setStatus("sc_done");
    $("sc-prog").hidden = true;
  } catch (err) {
    console.error("Receipt scan:", err);
    worker = null;
    setStatus("sc_fail");
    $("sc-prog").hidden = true;
  } finally {
    busy = false;
    $("sc-pick").disabled = $("sc-cam").disabled = false;
    onProg = null;
  }
}

function saveExpense() {
  const err = $("sc-err"), a = num($("sc-amt").value), dt = $("sc-date").value;
  err.className = "err";
  if (!(a > 0)) { err.textContent = t("e_amt"); err.hidden = false; $("sc-amt").focus(); return; }
  if (!dt) { err.textContent = t("e_date"); err.hidden = false; return; }
  err.hidden = true;
  const names = items.map(x => x.name.trim()).filter(Boolean), shop = $("sc-merch").value.trim();
  const note = (shop + (names.length ? (shop ? ": " : "") + names.join(", ") : "")).slice(0, 120);
  const x = { id: newId(), type: "expense", amount: r2(a), category: $("sc-cat").value, date: dt, note, created_at: new Date().toISOString() };
  db.tx.push(x);
  save("tx", x);
  view = new Date(dt + "T00:00"); view.setDate(1); // переходим к месяцу чека, чтобы операция была видна
  reset();
  render();
  toast(t("sc_saved"));
}

// ---------- События ----------
const pick = () => $("sc-file").click();
$("sc-pick").onclick = pick;
$("sc-drop").onclick = pick;
$("sc-drop").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
$("sc-cam").onclick = () => $("sc-cfile").click();
$("sc-file").onchange = $("sc-cfile").onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) scan(f); };

const drop = $("sc-drop");
["dragenter", "dragover"].forEach(ev => $("v-scan").addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => $("v-scan").addEventListener(ev, e => { e.preventDefault(); if (ev === "drop" || e.target === drop) drop.classList.remove("over"); }));
$("v-scan").addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) scan(f); });
// Ctrl+V: вставка скриншота или фото из буфера
document.addEventListener("paste", e => {
  if (!$("v-scan").classList.contains("on")) return;
  const f = [...(e.clipboardData ? e.clipboardData.files : [])].find(x => /^image\//.test(x.type));
  if (f) scan(f);
});

$("sc-items").addEventListener("input", e => {
  const el = e.target, i = +el.dataset.i;
  if (items[i]) { items[i][el.dataset.k] = el.value; renderSum(); }
});
$("sc-items").addEventListener("click", e => {
  const b = e.target.closest("[data-sdel]");
  if (b) { items.splice(+b.dataset.sdel, 1); renderItems(); }
});
$("sc-add").onclick = () => {
  items.push({ name: "", price: "" }); renderItems();
  const f = $("sc-items").querySelectorAll('input[data-k="name"]'); f[f.length - 1].focus();
};
$("sc-amt").addEventListener("input", renderSum);
$("sc-save").onclick = saveExpense;
$("sc-reset").onclick = reset;

// app.js вызывает при смене языка и перерисовке: обновить названия категорий и подписи
window.scanRefresh = () => {
  if ($("sc-form").hidden) return;
  const c = $("sc-cat").value; fillCats(c); renderItems();
};
const baseRefresh = window.scanRefresh;
window.scanRefresh = () => { if (statusKey) $("sc-status").textContent = t(statusKey); baseRefresh(); };
})();
