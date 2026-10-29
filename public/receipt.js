/* Разбор текста чека (после OCR): сумма, дата, магазин, товары, категория.
   Чистые функции без DOM — работают и в браузере (window.Receipt), и в Node (для проверки). */
(function (root) {
"use strict";

const MONTHS = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
  қаң: 1, ақп: 2, нау: 3, сәу: 4, мам: 5, мау: 6, шіл: 7, там: 8, қыр: 9, қаз: 10, қар: 11, жел: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Регулярка «слово целиком» без lookbehind (в Cyrillic \b не работает). Слова с \p{L}* на конце считаются префиксами.
const kw = list => new RegExp("(?:^|[^\\p{L}])(?:" + list.join("|") + ")(?![\\p{L}])", "iu");

const TOTAL_HI = kw(["итого\\s*к\\s*оплате", "к\\s*оплате", "к\\s*получению", "итого", "итог", "total\\s*due", "amount\\s*due", "total", "жиыны", "жиынтығы", "барлығы", "төлеуге"]);
const TOTAL_LO = kw(["всего", "сумма\\s*чека", "сумма\\s*покупки", "сумма", "сомасы", "jiyny"]);
const TOTAL_BAD = kw(["ндс\\p{L}*", "vat", "ққс", "сдач\\p{L}*", "қайтарым", "налич\\p{L}*", "безнал\\p{L}*", "карт[аойыеу]", "card", "visa", "mastercard", "скидк\\p{L}*", "бонус\\p{L}*", "bonus", "получено", "внесено", "оплачено", "округл\\p{L}*", "без\\s*ндс"]);
const NOISE = kw([
  "итог\\p{L}*", "всего", "ндс\\p{L}*", "vat", "ққс", "сдач\\p{L}*", "налич\\p{L}*", "безнал\\p{L}*", "карт[аойыеу]", "visa", "mastercard",
  "чек\\p{L}*", "касс\\p{L}*", "ккм", "фискальн\\p{L}*", "фп", "фд", "рнм", "знм", "инн", "иин", "бин", "bin", "тел\\p{L}*", "адрес", "смена", "смен[аы]",
  "www", "http\\p{L}*", "спасибо", "благодар\\p{L}*", "приход", "продажа", "кассир\\p{L}*", "оператор", "время", "дата", "date", "номер", "офд", "ofd", "qr", "сайт",
  "e-?mail", "скидк\\p{L}*", "бонус\\p{L}*", "округл\\p{L}*", "оплат\\p{L}*", "платеж\\p{L}*", "получено", "сумма", "наименование", "кол-?во", "цена", "тауар", "атауы",
  "сомасы", "жиыны", "total", "subtotal", "change", "cash", "tax", "receipt", "thank\\p{L}*", "кабинет\\p{L}*", "проверить", "check\\p{L}*", "ресторан\\s*№",
]);

const ADDR = /(?:^|\s)(?:г|ул|пр|пр-т|мкр|д|дом|кв|оф|к|стр)\.\s*|(?:улица|проспект|микрорайон|бульвар)\s/iu;

const CATS = [
  ["transport", ["азс", "бензин", "топлив\\p{L}*", "дизел\\p{L}*", "газ\\s*азс", "gas\\p{L}*", "petrol", "fuel", "helios", "sinooil", "qazaqoil", "shell", "такси", "taxi", "yandex\\p{L}*", "indrive", "onay", "автобус\\p{L}*", "метро", "парков\\p{L}*", "мойка", "авто\\p{L}*"]],
  ["health", ["аптек\\p{L}*", "apteka", "pharm\\p{L}*", "фарм\\p{L}*", "клиник\\p{L}*", "лекарств\\p{L}*", "медицин\\p{L}*", "стоматолог\\p{L}*", "analiz", "анализ\\p{L}*", "витамин\\p{L}*", "дәріхана"]],
  ["fun", ["кино", "cinema", "cinemax", "chaplin", "театр", "караоке", "боулинг", "bowling", "клуб", "парк\\s*развлечен\\p{L}*", "игр\\p{L}*", "steam", "netflix", "билет\\p{L}*", "концерт"]],
  ["home", ["коммунал\\p{L}*", "жкх", "электроэнерг\\p{L}*", "алсеко", "alseco", "водоканал", "отопление", "аренд\\p{L}*", "мебел\\p{L}*", "ikea", "леруа", "leroy", "стройматериал\\p{L}*", "хозтовар\\p{L}*", "сантехник\\p{L}*", "интернет", "beeline", "kcell", "tele2", "altel", "казахтелеком"]],
  ["food", ["магнум", "magnum", "small", "смолл", "galmart", "галмарт", "ramstore", "рамстор", "анвар", "anvar", "арбуз", "дастархан", "супермаркет\\p{L}*", "гипермаркет\\p{L}*", "продукт\\p{L}*", "кафе", "cafe", "coffee", "кофе", "кофейня", "ресторан\\p{L}*", "restaurant", "пицц\\p{L}*", "pizza", "бургер\\p{L}*", "burger", "kfc", "dodo", "додо", "subway", "суши", "sushi", "столов\\p{L}*", "пекарн\\p{L}*", "булоч\\p{L}*", "хлеб\\p{L}*", "молок\\p{L}*", "мясо", "мяс\\p{L}*", "овощ\\p{L}*", "фрукт\\p{L}*", "bar", "бар", "доставка\\s*еды", "wolt", "glovo", "chocofood", "starbucks", "tomo", "kaspi\\s*магазин"]],
  ["shop", ["одежд\\p{L}*", "обув\\p{L}*", "zara", "lcw", "waikiki", "sulpak", "сулпак", "technodom", "технодом", "mechta", "мечта", "dns", "shop", "магазин\\p{L}*", "маркет", "market", "mall", "молл", "аксессуар\\p{L}*", "электроника", "косметик\\p{L}*", "парфюм\\p{L}*", "летуаль", "подарк\\p{L}*"]],
];
const CAT_RE = CATS.map(([c, w]) => [c, kw(w)]);

// ---------- Числа ----------
// Частые ошибки OCR в числах: O→0, l/I→1, S→5, B→8, Z→2. Правим только «числоподобные» слова, где уже есть цифра.
function fixDigits(s) {
  return s.replace(/\S+/g, tok => {
    if (!/\d/.test(tok) || !/^[0-9OoОSBZlI.,:\/\-]+$/.test(tok)) return tok;
    const last = tok.length - 1;
    return tok.replace(/[OoО]/g, "0").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/[lI]/g, (c, i) => (i === last ? c : "1"));
  });
}

const NUM_G = /\d{1,3}(?:[  ]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?/g;

function parseNum(tok) {
  let s = tok.replace(/[  ]/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");            // 1.234 или 1,234,567 — тысячи
  else if (s.includes(".") && s.includes(",")) s = s.replace(s.indexOf(".") < s.indexOf(",") ? /\./g : /,/g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

// Убираем из строки даты, время, проценты и телефоны — чтобы они не принимались за цены.
function stripNoise(line) {
  const blank = m => " ".repeat(m.length); // длина сохраняется, чтобы позиции совпадали с исходной строкой
  return line
    .replace(/\d{1,2}\s+\p{L}{3,}\.?\s+\d{4}/gu, blank)
    .replace(/\d{1,4}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, blank)
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, blank)
    .replace(/\d+(?:[.,]\d+)?\s*%/g, blank)
    .replace(/[+]?\d[\d\- ()]{9,}\d/g, m => (/[.,]\d{1,2}\s*$/.test(m) ? m : blank(m)));
}
function nums(line) {
  const out = [], s = stripNoise(line);
  let m; NUM_G.lastIndex = 0;
  while ((m = NUM_G.exec(s))) { const v = parseNum(m[0]); if (isFinite(v) && m[0].replace(/\D/g, "").length < 9) out.push({ v, i: m.index, e: m.index + m[0].length, raw: m[0] }); }
  return { s, list: out };
}

// ---------- Дата ----------
function validDate(y, m, d, now) {
  if (y < 100) y += 2000;
  if (y < 2015 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  if (dt.getTime() > now.getTime() + 2 * 864e5) return null; // из будущего — скорее всего ошибка распознавания
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
function findDate(lines, now) {
  const cands = [];
  lines.forEach((raw, idx) => {
    const line = fixDigits(raw), hint = /дата|date|время|уақыт|күні|time/i.test(raw);
    let m, d;
    const r1 = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?!\d)/g;
    while ((m = r1.exec(line))) {
      let a = +m[1], b = +m[2];
      if (b > 12 && a <= 12) [a, b] = [b, a];
      if ((d = validDate(+m[3], b, a, now))) cands.push({ d, hint, idx });
    }
    const r2 = /(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?!\d)/g;
    while ((m = r2.exec(line))) if ((d = validDate(+m[1], +m[2], +m[3], now))) cands.push({ d, hint, idx });
    const r3 = /(\d{1,2})\s+([A-Za-zА-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ]{3,})\.?\s+(\d{4})/g;
    while ((m = r3.exec(line))) {
      const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (mo && (d = validDate(+m[3], mo, +m[1], now))) cands.push({ d, hint, idx });
    }
  });
  if (!cands.length) return "";
  return (cands.find(c => c.hint) || cands[0]).d;
}

// ---------- Итоговая сумма ----------
function findTotal(lines) {
  const cands = [];
  lines.forEach((raw, i) => {
    const line = fixDigits(raw);
    if (TOTAL_BAD.test(line) && !/к\s*оплате/i.test(line)) return;
    const pri = TOTAL_HI.test(line) ? 3 : TOTAL_LO.test(line) ? 2 : 0;
    if (!pri) return;
    let { list } = nums(line);
    if (!list.length) for (let k = 1; k <= 2 && i + k < lines.length && !list.length; k++) list = nums(fixDigits(lines[i + k])).list;
    if (!list.length) return;
    cands.push({ v: list[list.length - 1].v, pri, i });
  });
  if (!cands.length) return { v: 0, i: -1 };
  const best = Math.max(...cands.map(c => c.pri));
  const top = cands.filter(c => c.pri === best);
  return top.reduce((a, c) => (c.v > a.v || (c.v === a.v && c.i > a.i) ? c : a));
}

// ---------- Товары ----------
const LETTERS = s => (s.match(/\p{L}/gu) || []).length;
function cleanName(s) {
  return s.replace(/^[\s\d]{1,3}[.)\-]\s+/, "").replace(/^\d{1,2}\s+(?=\p{L})/u, "").replace(/\s+[xх×*]\s*$/i, "").replace(/[=:;|_~.\s-]+$/g, "").replace(/\s{2,}/g, " ").trim();
}
function findItems(lines, endIdx, total) {
  const end = endIdx >= 0 ? endIdx : lines.length, items = [];
  // «Копеечный» чек: большинство строк с числами в конце имеют ,00 — тогда целые числа в конце названия подозрительны.
  const ends = lines.slice(0, end).filter(l => !NOISE.test(l) && !ADDR.test(l)).map(l => {
    const { s: z, list } = nums(fixDigits(l)), x = list[list.length - 1];
    return x && z.slice(x.e).replace(/[\s.,:;₸]/g, "") === "" ? x : null;
  }).filter(Boolean);
  const decStyle = ends.length >= 3 && ends.filter(x => /[.,]\d{1,2}$/.test(x.raw)).length / ends.length >= .6;
  let pending = "";
  const push = (name, price, qty) => {
    name = cleanName(name);
    if (LETTERS(name) < 2 || name.length < 2 || !(price > 0) || NOISE.test(name)) return false;
    if (total && price > total * 1.001) return false;
    items.push({ name: name.slice(0, 60), price: Math.round(price * 100) / 100, qty: qty || 1 });
    return true;
  };
  for (let i = 0; i < end; i++) {
    const line = fixDigits(lines[i]).replace(/[₸〒]|(?:^|\s)(?:тг|kzt|тенге)\b\.?/gi, " ").trim();
    if (!line) { continue; }
    const { s, list } = nums(line);
    const text = s.replace(/\s+/g, " ").trim();
    const noisy = NOISE.test(line);
    // «2 x 450,00 900,00» — количество и цена на отдельной строке под названием
    if (pending && list.length && LETTERS(text) <= 3 && /[xх×*]/i.test(text)) {
      const n = list.length, eq = /=/.test(text);
      let qty = 1, sum = list[n - 1].v;
      if (n >= 3 || (n === 2 && eq)) qty = list[0].v;
      else if (n === 2) { qty = list[0].v; sum = list[0].v * list[1].v; }
      push(pending, sum, qty > 0 && qty < 1000 ? qty : 1);
      pending = ""; continue;
    }
    if (noisy) { pending = ""; continue; }
    if (!list.length) { pending = LETTERS(text) >= 3 ? text : ""; continue; }
    if (ADDR.test(line)) { pending = ""; continue; }
    // «Молоко 1л 2 x 450,00 900,00» / «АИ-92 35.2 л x 275.00 9 680,00»: название, затем количество × цена, затем сумма.
    const qm = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:шт|л|кг|г|гр|м|мл|pcs|l|kg)?\s*[xх×*]\s*(\d+(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?)/i.exec(s);
    if (qm) {
      const q = parseNum(qm[1]), u = parseNum(qm[2]), qe = qm.index + qm[0].length;
      const after = list.filter(x => x.i >= qe), sum = after.length ? after[after.length - 1].v : q * u;
      if (push(line.slice(0, qm.index) || pending, sum, q > 0 && q < 1000 ? q : 1)) pending = ""; else pending = "";
      continue;
    }
    // Хвост строки — цена. Название — всё, что слева от неё.
    const last = list[list.length - 1];
    if (s.slice(last.e).replace(/[\s.,:;()\\/|-]/g, "") !== "") { pending = LETTERS(text) >= 3 ? line : ""; continue; }
    // Если в чеке цены с копейками, а здесь целое число и следом идёт строка «только цифры», то это часть названия (например «100г» → «1001»).
    if (decStyle && !/[.,]\d{1,2}$/.test(last.raw) && LETTERS(text) >= 3 && i + 1 < end) {
      const nx = nums(fixDigits(lines[i + 1]));
      if (nx.list.length && LETTERS(nx.s) <= 3) { pending = line; continue; }
    }
    const start = last.i, qty = 1;
    let name = line.slice(0, start).replace(/\s*[xх×*=]\s*$/i, "").trim();
    if (!name && pending) name = pending;
    push(name, last.v, qty); pending = "";
  }
  return items;
}

// ---------- Магазин и категория ----------
function findMerchant(lines) {
  for (const raw of lines.slice(0, 8)) {
    const l = raw.replace(/["«»“”']/g, "").replace(/\s+/g, " ").trim();
    if (LETTERS(l) < 3 || NOISE.test(l) || /\d{6,}/.test(l)) continue;
    return l.slice(0, 40);
  }
  return "";
}
function guessCategory(text) {
  for (const [c, re] of CAT_RE) if (re.test(text)) return c;
  return "other";
}

// OCR на фото часто добавляет одинокие символы по краям строки (края бумаги, тени). Пока пробелы ещё не схлопнуты,
// убираем одиночный знак после широкого пробела в конце и перед широким пробелом в начале.
function cleanLine(l) {
  return l.replace(/[|\\_~`]+/g, " ")
    .replace(/\s{3,}[^\p{L}\s]\s*$/u, "")
    .replace(/^\s*[^\p{L}\d\s]\s{2,}/u, "")
    .replace(/^\s*\d\s{3,}(?=\S)/, "")
    .replace(/\s+/g, " ").trim();
}

function parse(text, now) {
  now = now || new Date();
  const lines = String(text || "").split(/\r?\n/).map(cleanLine).filter(Boolean);
  const date = findDate(lines, now);
  const tot = findTotal(lines);
  const items = findItems(lines, tot.i, tot.v);
  const itemsSum = Math.round(items.reduce((s, x) => s + x.price, 0) * 100) / 100;
  let total = tot.v;
  if (!total && items.length) total = itemsSum;
  const merchant = findMerchant(lines);
  return { total, date, merchant, items, itemsSum, category: guessCategory(merchant + "\n" + items.map(x => x.name).join("\n")), lines };
}

const api = { parse, parseNum, fixDigits, findDate, findTotal, findItems, guessCategory };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Receipt = api;
})(typeof window !== "undefined" ? window : globalThis);
