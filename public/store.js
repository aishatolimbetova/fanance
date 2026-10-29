// Слой данных: Supabase (вход и база), локальный кэш и очередь изменений на случай офлайна.
// Интерфейс ничего не знает о сети: он меняет массивы в db и вызывает save()/remove().
const sb = supabase.createClient(CONFIG.url, CONFIG.key);

const db = {
  user: null,                          // текущий пользователь Supabase
  tx: [], bud: {}, goals: [], rec: [], // данные в памяти
  queue: [],                           // изменения, которые ещё не дошли до сервера
  status: "ok",                        // ok — всё отправлено, wait — отправляется, off — нет связи
  syncedAt: null,                      // время последней удачной синхронизации
  onStatus: () => {},                  // интерфейс подменяет эти два колбэка
  onError: () => {},
};

// Ключ первичный для каждой таблицы: по нему upsert понимает, вставлять строку или обновлять.
const PK = { tx: "id", goals: "id", recurring: "id", budgets: "user_id,category" };
const COLS = {
  tx: "id,type,category,amount,date,note,created_at",
  budgets: "category,lim",
  goals: "id,name,target,saved,created_at",
  recurring: "id,type,category,amount,note,every,next,created_at",
};

// crypto.randomUUID есть только на https и localhost, поэтому запасной вариант.
const newId = () => crypto.randomUUID ? crypto.randomUUID() :
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

// ---------- Локальное хранилище ----------
const lsKey = name => "ft." + name + "." + db.user.id;
function saveLocal() {
  try {
    localStorage.setItem(lsKey("cache"), JSON.stringify({ tx: db.tx, bud: db.bud, goals: db.goals, rec: db.rec }));
    localStorage.setItem(lsKey("queue"), JSON.stringify(db.queue));
  } catch (e) {}
}
function readLocal() {
  try {
    const c = JSON.parse(localStorage.getItem(lsKey("cache")) || "null");
    if (c) Object.assign(db, { tx: c.tx || [], bud: c.bud || {}, goals: c.goals || [], rec: c.rec || [] });
    db.queue = JSON.parse(localStorage.getItem(lsKey("queue")) || "[]");
  } catch (e) {}
}

// ---------- Разбор ошибок ----------
// Повторять стоит то, что могло не дойти: нет сети, истёк вход, сервер перегружен.
const retryable = r => !navigator.onLine || r.status === 0 || r.status === 401 || r.status === 429 || r.status >= 500;
// Эти коды означают, что таблиц или функции в базе ещё нет — значит, не выполнен schema.sql.
const noSchema = e => ["PGRST205", "PGRST202", "42P01", "42883"].includes(e && e.code);

function setStatus(s) {
  db.status = s;
  if (s === "ok") db.syncedAt = new Date();
  db.onStatus();
}

// ---------- Очередь изменений ----------
// Операция — это простой объект, его можно хранить в localStorage и отправить позже:
// { t: "tx", op: "put", rows: [...] }   — вставить или обновить строки
// { t: "tx", op: "del", match: {...} }  — удалить строки по условию
// { t: "tx", op: "wipe" }               — удалить все строки пользователя (для восстановления из копии)
function runOp(o) {
  const q = sb.from(o.t);
  if (o.op === "put") return q.upsert(o.rows, { onConflict: PK[o.t] });
  if (o.op === "del") return q.delete().match(o.match);
  return q.delete().eq("user_id", db.user.id);
}

let flushTimer, flushing = null;
function push(o) {
  db.queue.push(o);
  saveLocal();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 400); // несколько быстрых правок уйдут одной пачкой
}

function flush() {
  clearTimeout(flushTimer);
  if (flushing) return flushing;
  flushing = (async () => {
    while (db.queue.length && db.user) {
      setStatus("wait");
      const r = await runOp(db.queue[0]);
      if (r.error && (retryable(r) || noSchema(r.error))) {
        setStatus("off");
        if (noSchema(r.error)) db.onError("srv");
        return;
      }
      if (r.error) { console.error(r.error); db.onError("save"); }
      db.queue.shift(); // успешно или безнадёжно — в любом случае убираем из очереди
      saveLocal();
    }
    if (db.user) setStatus("ok");
  })().finally(() => { flushing = null; });
  return flushing;
}

// Публичные функции для интерфейса.
const withUser = rows => rows.map(r => ({ ...r, user_id: db.user.id }));
const save = (t, ...rows) => { push({ t, op: "put", rows: withUser(rows) }); };
const remove = (t, match) => { push({ t, op: "del", match }); };
function setBudget(category, lim) {
  if (lim > 0) { db.bud[category] = lim; save("budgets", { category, lim }); }
  else { delete db.bud[category]; remove("budgets", { category }); }
}
// Полная замена данных из резервной копии.
function replaceAll(d) {
  Object.assign(db, d);
  for (const t of ["tx", "budgets", "goals", "recurring"]) push({ t, op: "wipe" });
  if (d.tx.length) push({ t: "tx", op: "put", rows: withUser(d.tx) });
  const b = Object.entries(d.bud).map(([category, lim]) => ({ category, lim }));
  if (b.length) push({ t: "budgets", op: "put", rows: withUser(b) });
  if (d.goals.length) push({ t: "goals", op: "put", rows: withUser(d.goals) });
  if (d.rec.length) push({ t: "recurring", op: "put", rows: withUser(d.rec) });
}

// ---------- Загрузка с сервера ----------
// Supabase отдаёт не больше 1000 строк за раз, поэтому читаем страницами.
async function selectAll(t) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from(t).select(COLS[t]).range(from, from + 999);
    if (r.error) return r;
    out.push(...r.data);
    if (r.data.length < 1000) return { data: out };
  }
}
const nums = (row, ...keys) => { keys.forEach(k => row[k] = Number(row[k])); return row; };

// Возвращает "ok", "off" (показаны данные из кэша), "srv" (нет таблиц) или "err".
async function load() {
  await flush();
  if (db.queue.length) return "off"; // свои правки ещё не отправлены — не затираем их данными сервера
  // Лимиты и цели читаем сразу, а операции и платежи — после функции регулярных платежей,
  // потому что она создаёт операции и сдвигает даты платежей. Всё, что можно, идёт параллельно.
  const after = sb.rpc("apply_recurring").then(() => Promise.all([selectAll("tx"), selectAll("recurring")]));
  const [[txR, recR], budR, goalR] = await Promise.all([after, selectAll("budgets"), selectAll("goals")]);
  const res = [txR, budR, goalR, recR];
  for (const r of res) if (r.error) {
    if (retryable(r)) { setStatus("off"); return "off"; }
    return noSchema(r.error) ? "srv" : "err";
  }
  const [tx, bud, goals, rec] = res.map(r => r.data);
  db.tx = tx.map(x => nums(x, "amount"));
  db.bud = Object.fromEntries(bud.map(b => [b.category, Number(b.lim)]));
  db.goals = goals.map(g => nums(g, "target", "saved"));
  db.rec = rec.map(r => nums(r, "amount"));
  saveLocal();
  setStatus("ok");
  return "ok";
}

addEventListener("online", () => db.user && flush());

// ---------- Вход ----------
// Переводим ошибки Supabase Auth в ключи текстов из i18n.js (e_creds, e_exists и т.д.).
function authErr(e) {
  const c = (e && e.code) || "";
  if (c === "invalid_credentials") return "creds";
  if (c === "email_not_confirmed") return "unconf";
  if (c === "user_already_exists" || c === "email_exists") return "exists";
  if (c === "weak_password" || c === "email_address_invalid" || c === "validation_failed") return "bad";
  if (c === "over_email_send_rate_limit") return "mail";        // встроенная почта Supabase: пара писем в час
  if (c === "email_address_not_authorized") return "mailauth";  // без своего SMTP письма идут только участникам проекта
  if ((e && e.status === 429) || c.startsWith("over_")) return "many";
  return "net";
}
async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? authErr(error) : null;
}
// При включённом подтверждении почты сессия не выдаётся сразу — нужно перейти по ссылке из письма.
async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return authErr(error);
  if (data.user && data.user.identities && !data.user.identities.length) return "exists";
  return data.session ? null : "check";
}
async function signOut() {
  // Кэш стираем, только если всё дошло до сервера: иначе неотправленные правки уйдут при следующем входе.
  if (db.user) { await flush(); if (!db.queue.length) try { localStorage.removeItem(lsKey("cache")); localStorage.removeItem(lsKey("queue")); } catch (e) {} }
  await sb.auth.signOut({ scope: "local" });
}
