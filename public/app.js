// Интерфейс: отрисовка экранов и обработка действий пользователя.
// Данные лежат в объекте db (store.js), тексты — в L (i18n.js).

// ---------- Общие помощники ----------
const $ = id => document.getElementById(id);
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

let lang = L[pref("ft.lang", "ru")] ? pref("ft.lang", "ru") : "ru";
let theme = pref("ft.theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
let profile = {}, pcolor = "lime", photo = ""; // профиль пользователя и выбранный цвет аватара
let current = pref("ft.view", "dash");  // открытая вкладка
let type = "expense";                   // тип операции в форме
let editId = null;                      // id операции, которую сейчас правим
let view = new Date(); view.setDate(1); // выбранный месяц (всегда первое число)
let lastDeleted = null, toastTimer, undoFn = null;

const t = k => L[lang][k] || k;
const cn = c => t("c_" + c);
const money = n => new Intl.NumberFormat(t("loc"), { maximumFractionDigits: 0 }).format(Math.round(n)) + " ₸";
const pad = n => String(n).padStart(2, "0");
const ym = d => d.getFullYear() + "-" + pad(d.getMonth() + 1);
const isoDay = d => ym(d) + "-" + pad(d.getDate());
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const pn = v => parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
const pc = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const prevM = (d, n = 1) => new Date(d.getFullYear(), d.getMonth() - n, 1);
const daysIn = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const byDate = (a, b) => b.date.localeCompare(a.date) || String(b.created_at || "").localeCompare(String(a.created_at || ""));
const empty = () => `<p class="empty">${t("noops")}</p>`;

const mfull = d => lang === "kk" ? KM[d.getMonth()] + " " + d.getFullYear() : cap(d.toLocaleDateString(t("loc"), { month: "long", year: "numeric" }));
const mshort = d => lang === "kk" ? KS[d.getMonth()] : d.toLocaleDateString(t("loc"), { month: "short" });
const dlabel = d => lang === "kk" ? `${d.getDate()} ${KM[d.getMonth()].toLowerCase()}, ${KD[d.getDay()]}` : d.toLocaleDateString(t("loc"), { day: "numeric", month: "long", weekday: "short" });

// Цвета категорий выдаются по месту в рейтинге, а не по названию:
// первая — лайм, дальше ступени зелёного, синий и серый (палитра Wise, переменные --r1…--r7).
const RANK = ["var(--r1)", "var(--r2)", "var(--r3)", "var(--r4)", "var(--r5)", "var(--r6)", "var(--r7)"];

// Итоги за месяц: все операции, расходы по категориям, сумма доходов и расходов.
// Операции раскладываются по месяцам один раз за отрисовку, итоги месяца считаются при первом запросе.
// Без этого каждый блок заново перебирал бы все операции (график, анализ, цели — больше десяти раз).
let months = null;
function monthSums(d) {
  if (!months) {
    months = {};
    for (const x of db.tx) (months[x.date.slice(0, 7)] = months[x.date.slice(0, 7)] || { a: [] }).a.push(x);
  }
  const k = ym(d), m = months[k] = months[k] || { a: [] };
  if (!m.by) {
    m.a.sort(byDate);
    m.by = {}; m.inc = 0; m.exp = 0;
    for (const x of m.a) {
      if (x.type === "income") m.inc += x.amount;
      else { m.exp += x.amount; m.by[x.category] = (m.by[x.category] || 0) + x.amount; }
    }
  }
  return m;
}

// ---------- Отрисовка ----------
function render() {
  months = null; // данные могли измениться — разложить операции заново
  $("mname").textContent = mfull(view);
  const c = monthSums(view);
  renderHero(c);
  renderChart();
  renderCats(c);
  renderLists(c);
  renderBudgets(c.by);
  renderAlerts(c);
  renderInsights(c);
  renderGoals();
  renderRec();
  renderReport(c);
  renderProfile();
  if (window.scanRefresh) scanRefresh();
}

function renderHero(c) {
  $("bal").textContent = money(c.inc - c.exp);
  $("inc").textContent = money(c.inc);
  $("exp").textContent = money(c.exp);
  const days = ym(view) === ym(new Date()) ? new Date().getDate() : daysIn(view);
  const big = c.a.filter(x => x.type === "expense").sort((a, b) => b.amount - a.amount)[0];
  $("st").textContent = c.exp ? `${t("avg")}: ${money(c.exp / days)}` + (big ? ` · ${t("big")}: ${money(big.amount)} (${cn(big.category)})` : "") : "";
  $("tkno").textContent = c.a.length;
  $("tkm").textContent = mfull(view);
  $("hello").textContent = db.user ? t("hi") + ", " + nameOf() : "";
}

function renderChart() {
  const ms = [];
  for (let i = 5; i >= 0; i--) {
    const d = prevM(view, i), s = monthSums(d);
    ms.push({ d, i: s.inc, e: s.exp, now: i === 0 });
  }
  const mx = Math.max(1, ...ms.flatMap(x => [x.i, x.e]));
  $("chart").innerHTML = ms.map(x => `<div class="c${x.now ? " now" : ""}" title="${t("inc")}: ${money(x.i)} · ${t("exp")}: ${money(x.e)}">
    <div class="bars"><i class="bi" style="height:${x.i / mx * 100}%"></i><i class="be" style="height:${x.e / mx * 100}%"></i></div>
    <span>${mshort(x.d)}</span></div>`).join("");
}

function renderCats(c) {
  const rows = Object.entries(c.by).sort((a, b) => b[1] - a[1]);
  let acc = 0;
  const stops = rows.map(([, v], i) => { const s = acc; acc += v / c.exp * 100; return `${RANK[i]} ${s}% ${acc}%`; });
  $("donut").style.background = rows.length ? `conic-gradient(${stops.join(",")})` : "var(--line)";
  $("dtot").textContent = money(c.exp);
  $("legend").innerHTML = rows.length ? rows.map(([k, v], i) => `<li><span class="sw" style="background:${RANK[i]}"></span>${cn(k)}<span class="n">${money(v)}</span><span class="p">${Math.round(v / c.exp * 100)}%</span></li>`).join("")
    : `<li class="empty">${t("noexp")}</li>`;
}

function row(x) {
  const inc = x.type === "income";
  return `<div class="row">
    <span class="ic${inc ? " in" : ""}" aria-hidden="true">${esc(cn(x.category).charAt(0).toUpperCase())}</span>
    <div class="t" data-edit="${x.id}" role="button" tabindex="0"><b>${cn(x.category)}</b>${x.note ? `<span>${esc(x.note)}</span>` : ""}</div>
    <div class="s${inc ? " p" : ""}">${inc ? "+" : "−"}${money(x.amount)}</div>
    <button class="del" type="button" data-id="${x.id}" aria-label="×">×</button></div>`;
}
// Операции, сгруппированные по дням с подзаголовком-датой.
function grouped(a) {
  if (!a.length) return empty();
  const g = {};
  a.forEach(x => (g[x.date] = g[x.date] || []).push(x));
  return Object.entries(g).map(([d, r]) => `<div class="dh">${dlabel(new Date(d + "T00:00"))}</div>` + r.map(row).join("")).join("");
}

function renderLists(c) {
  $("recent").innerHTML = c.a.length ? c.a.slice(0, 5).map(row).join("") : empty();
  const q = $("q").value.trim().toLowerCase(), ft = $("ft").value;
  $("all").innerHTML = grouped(c.a.filter(x => (ft === "all" || x.type === ft) &&
    (!q || (x.note || "").toLowerCase().includes(q) || cn(x.category).toLowerCase().includes(q))));
}

function renderBudgets(by) {
  // Пока человек вводит лимит, не перерисовываем — иначе поле потеряет фокус.
  if (document.activeElement && document.activeElement.classList.contains("lim")) return;
  $("bgrid").innerHTML = CATS.expense.map(c => {
    const l = db.bud[c] || 0, s = by[c] || 0, o = l && s > l;
    return `<div class="card">
      <div class="bh">${cn(c)}</div>
      <label class="fld"><span>${t("lim")}</span><input class="lim" data-c="${c}" type="number" min="0" inputmode="decimal" value="${l || ""}" placeholder="0"></label>
      <div class="trk"><i class="${o ? "over" : ""}" style="width:${l ? Math.min(100, s / l * 100) : 0}%"></i></div>
      <div class="sm${o ? " over" : ""}">${money(s)} ${t("spent")}${l ? ` · ${money(Math.abs(l - s))} ${t(o ? "over" : "left")}` : ""}</div></div>`;
  }).join("");
}

// Предупреждения о бюджете: от 80% лимита — мятное, от 100% — красное.
function renderAlerts(c) {
  $("alerts").innerHTML = CATS.expense.map(k => {
    const l = db.bud[k] || 0, s = c.by[k] || 0;
    if (!l || s < l * .8) return "";
    return `<div class="alert${s >= l ? " red" : ""}"><b>${cn(k)}</b> — ${t(s >= l ? "al100" : "al80")}<span>${money(s)} / ${money(l)}</span></div>`;
  }).join("");
}

function renderInsights(c) {
  const p = monthSums(prevM(view)), o = [];
  const top = Object.entries(c.by).sort((a, b) => b[1] - a[1])[0];
  if (top) o.push(`<li>${t("i_top")}: <b>${cn(top[0])}</b> · ${money(top[1])}</li>`);
  // Изменение к прошлому месяцу; меньше 5% не показываем, чтобы не шуметь.
  const chg = (label, a, b, bad) => {
    const q = pc(a, b);
    if (q === null || Math.abs(q) < 5) return;
    o.push(`<li class="${(q > 0) === bad ? "up" : "dn"}">${label}: ${q > 0 ? "▲" : "▼"} ${Math.abs(q)}% ${t("i_vs")}</li>`);
  };
  chg(t("exp"), c.exp, p.exp, true);
  chg(t("inc"), c.inc, p.inc, false);
  Object.keys(c.by).forEach(k => chg(cn(k), c.by[k], p.by[k], true));
  $("ins").innerHTML = o.join("") || `<li class="sm">${t("noexp")}</li>`;

  // Прогноз: для текущего месяца — расход в день × дней в месяце; на следующий — среднее за 3 месяца.
  const now = new Date(), cur = ym(view) === ym(now);
  let h = "", fc = c.exp;
  if (cur && c.exp > 0) {
    fc = c.exp / now.getDate() * daysIn(view);
    const few = now.getDate() < 7 || c.a.filter(x => x.type === "expense").length < 5;
    h = `<div class="sm">${t("f_now")}</div><b class="fc-n">${money(fc)}</b>
      <div class="trk"><i style="width:${Math.min(100, c.exp / fc * 100)}%"></i></div>
      ${few ? `<div class="sm"><span class="flag">!</span>${t("f_low")}</div>` : ""}`;
  }
  const vs = [2, 1, 0].map(i => i === 0 ? fc : monthSums(prevM(view, i)).exp).filter(v => v > 0);
  if (vs.length) h += `<div class="sm fc-next">${t("f_next")}: <b>${money(vs.reduce((a, b) => a + b, 0) / vs.length)}</b></div>`;
  $("fc").innerHTML = h;
}

function renderGoals() {
  // Средние накопления за последние 3 месяца — чтобы оценить срок достижения цели.
  const ms = [0, 1, 2].map(i => monthSums(prevM(view, i))).filter(m => m.inc || m.exp);
  const avg = ms.length ? ms.reduce((s, m) => s + m.inc - m.exp, 0) / ms.length : 0;
  $("glist").innerHTML = db.goals.length ? db.goals.map(g => {
    const p = Math.min(100, g.saved / g.target * 100), left = Math.max(0, g.target - g.saved);
    const eta = left && avg > 0 ? `${t("g_eta")} ${Math.ceil(left / avg)} ${t("g_mo")}` : "";
    return `<div class="card goal">
      <div class="bh">${esc(g.name)}<span class="pct">${Math.round(p)}%</span></div>
      <div class="trk"><i style="width:${p}%"></i></div>
      <div class="sm">${money(g.saved)} / ${money(g.target)} · ${t("left")}: ${money(left)}</div>
      ${eta ? `<div class="sm">${eta}</div>` : ""}
      <div class="r2"><input class="gin" data-g="${g.id}" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="${t("g_put")}"><button class="btn" type="button" data-gadd="${g.id}">${t("g_put")}</button></div>
      <button class="del corner" type="button" data-gdel="${g.id}" aria-label="×">×</button></div>`;
  }).join("") : empty();
}

function renderRec() {
  // Недельный платёж в пересчёте на месяц: 52 недели / 12 месяцев.
  const tot = db.rec.filter(r => r.type === "expense").reduce((s, r) => s + r.amount * (r.every === "weekly" ? 52 / 12 : 1), 0);
  $("rtot").innerHTML = `${t("r_total")}: <b>${money(tot)}</b>`;
  $("rlist").innerHTML = db.rec.length ? db.rec.map(r => `<div class="row">
    <div class="t"><b>${cn(r.category)}</b><span>${r.note ? esc(r.note) + " · " : ""}${t(r.every === "weekly" ? "r_w" : "r_m")} · ${t("r_next")}: ${r.next}</span></div>
    <div class="s${r.type === "income" ? " p" : ""}">${r.type === "income" ? "+" : "−"}${money(r.amount)}</div>
    <button class="del" type="button" data-rdel="${r.id}" aria-label="×">×</button></div>`).join("") : empty();
}

function renderReport(c) {
  const rate = c.inc ? Math.round((c.inc - c.exp) / c.inc * 100) : 0;
  const top = c.a.filter(x => x.type === "expense").sort((a, b) => b.amount - a.amount).slice(0, 5);
  const rows = Object.entries(c.by).sort((a, b) => b[1] - a[1]);
  $("rep").innerHTML = `<h2 class="rep-h">${t("rp_title")} — <em>${mfull(view)}</em></h2>
    <div class="kp">
      <div><span class="lbl">${t("inc")}</span><b>${money(c.inc)}</b></div>
      <div><span class="lbl">${t("exp")}</span><b>${money(c.exp)}</b></div>
      <div><span class="lbl">${t("rp_saved")}</span><b>${money(c.inc - c.exp)}</b><span class="sm">${rate}% ${t("rp_rate")}</span></div>
    </div>
    <h3 class="lbl">${t("rp_cat")}</h3>
    <table class="tb">${rows.map(([k, v]) => `<tr><td>${cn(k)}</td><td>${Math.round(v / c.exp * 100)}%</td><td>${money(v)}</td></tr>`).join("")}</table>
    <h3 class="lbl">${t("rp_top")}</h3>
    <table class="tb">${top.map(x => `<tr><td>${x.date}</td><td>${cn(x.category)}${x.note ? " · " + esc(x.note) : ""}</td><td>${money(x.amount)}</td></tr>`).join("")}</table>`;
}

// Строка состояния синхронизации в подвале.
function renderSync() {
  const q = db.queue.length, at = db.syncedAt;
  $("sync").dataset.s = db.status;
  $("sync").textContent = db.status === "wait" ? t("s_wait")
    : db.status === "off" ? t("s_off") + (q ? ` · ${q} ${t("s_q")}` : "")
    : t("s_ok") + (at ? " " + pad(at.getHours()) + ":" + pad(at.getMinutes()) : "");
}

// ---------- Язык, тема, вкладки ----------
function fillCats() {
  $("cat").innerHTML = CATS[type].map(c => `<option value="${c}">${cn(c)}</option>`).join("");
  $("tE").setAttribute("aria-pressed", type === "expense");
  $("tI").setAttribute("aria-pressed", type === "income");
}
function rcats() {
  $("rcat").innerHTML = CATS[$("rtype").value].map(c => `<option value="${c}">${cn(c)}</option>`).join("");
}
function i18n() {
  document.documentElement.lang = lang;
  document.title = t("app");
  document.querySelectorAll("[data-i]").forEach(e => e.textContent = t(e.dataset.i));
  document.querySelectorAll("[data-p]").forEach(e => e.placeholder = t(e.dataset.p));
  $("lang").value = $("lang2").value = lang;
  $("ftitle").textContent = t(editId ? "edit_op" : "new_op");
  $("sub").textContent = t(editId ? "save" : "add");
  $("vtitle").textContent = t("n_" + current);
  const c = $("cat").value;
  fillCats();
  if (c) $("cat").value = c;
  rcats();
  renderSync();
  applyTheme();
  // Заголовок лендинга: каждое слово выезжает снизу по очереди.
  const lt = document.querySelector(".land-title");
  lt.innerHTML = lt.textContent.trim().split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(" ");
}
const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0c1a02" : "#ffffff";
  ["theme", "theme2"].forEach(id => { const b = $(id); b.innerHTML = theme === "dark" ? SUN : MOON; b.title = t("theme"); b.setAttribute("aria-label", t("theme")); });
  document.querySelectorAll("[data-th]").forEach(b => b.setAttribute("aria-pressed", b.dataset.th === theme));
}
const setTheme = v => { theme = v; setPref("ft.theme", theme); applyTheme(); };
const setLang = v => { lang = v; setPref("ft.lang", lang); i18n(); render(); };
function show(v) {
  current = $("v-" + v) ? v : "dash";
  setPref("ft.view", current);
  document.querySelectorAll("[data-v]").forEach(b => b.setAttribute("aria-current", b.dataset.v === current ? "page" : "false"));
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + current));
  $("vtitle").textContent = t("n_" + current);
  document.querySelector(".period").hidden = current === "prof" || current === "scan";
}

// Короткое сообщение внизу экрана; с кнопкой «Отменить», если передан undo.
function toast(msg, undo) {
  $("tmsg").textContent = msg;
  undoFn = undo || null;
  $("undo").hidden = !undo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").hidden = true, undo ? 5000 : 7000);
}


// ---------- Профиль ----------
const profKey = () => "ft.prof." + db.user.id;
const nameOf = () => (profile.name || (db.user ? db.user.email.split("@")[0] : "")).trim();
function initials() {
  const w = (profile.name || "").trim().split(/\s+/).filter(Boolean);
  if (w.length) return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  return db.user ? db.user.email.slice(0, 2).toUpperCase() : "";
}

// Индекс финансового здоровья, 0–100: накопления за 3 месяца (40), соблюдение лимитов (25),
// прогресс по целям (15) и регулярность записей (20).
function health() {
  const now = new Date(), ms = [0, 1, 2].map(i => monthSums(prevM(now, i))), act = ms.filter(m => m.inc || m.exp);
  const inc = act.reduce((s, m) => s + m.inc, 0), exp = act.reduce((s, m) => s + m.exp, 0);
  const save = Math.round(Math.max(0, Math.min(1, (inc ? (inc - exp) / inc : 0) / .2)) * 40);
  const lim = CATS.expense.filter(c => db.bud[c]), ok = lim.filter(c => (ms[0].by[c] || 0) <= db.bud[c]).length;
  const bud = lim.length ? Math.round(ok / lim.length * 25) : 8;
  const gp = db.goals.length ? db.goals.reduce((s, g) => s + Math.min(1, g.saved / g.target), 0) / db.goals.length : 0;
  const goal = db.goals.length ? Math.round(gp * 15) : 4;
  const reg = Math.round(act.length / 3 * 20);
  const parts = [["h_save", save, 40, "tip_save"], ["h_bud", bud, 25, "tip_bud"], ["h_goal", goal, 15, "tip_goal"], ["h_reg", reg, 20, "tip_reg"]];
  return { parts, score: save + bud + goal + reg };
}

function renderProfile() {
  if (!db.user) return;
  const now = new Date(), cur = monthSums(now);
  const initialsText = initials();
  ["pav", "meav"].forEach(id => {
    const el = $(id);
    el.className = "av " + (id === "pav" ? "big " : "sm ") + "c-" + (profile.color || "lime") + (photo ? " has-photo" : "");
    el.textContent = photo ? "" : initialsText;
    el.style.backgroundImage = photo ? `url(${photo})` : "";
    el.style.backgroundSize = photo ? "cover" : ""; el.style.backgroundPosition = photo ? "center" : "";
  });
  $("pdel").disabled = !photo;
  $("pname").textContent = nameOf();
  $("pmail").textContent = db.user.email;
  const since = db.user.since ? new Date(db.user.since) : null;
  $("ptags").innerHTML = [profile.job, profile.city, since && !isNaN(since) ? `${t("p_since")} ${mfull(since)}` : ""]
    .filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join("");

  // Общая статистика за всё время.
  const keys = [...new Set(db.tx.map(x => x.date.slice(0, 7)))];
  const inc = db.tx.reduce((s, x) => s + (x.type === "income" ? x.amount : 0), 0);
  const exp = db.tx.reduce((s, x) => s + (x.type === "expense" ? x.amount : 0), 0);
  let best = null;
  keys.forEach(k => { const d = new Date(k + "-01T00:00"), m = monthSums(d), v = m.inc - m.exp; if (!best || v > best.v) best = { d, v }; });
  let streak = 0;
  for (let i = monthSums(now).a.length ? 0 : 1; i < 36 && monthSums(prevM(now, i)).a.length; i++) streak++;
  const rate = inc ? Math.round((inc - exp) / inc * 100) : 0;
  const st = [["p_ops", db.tx.length], ["p_months", keys.length], ["p_saved", money(inc - exp)], ["p_rate", rate + "%"],
    ["p_avg", money(keys.length ? exp / keys.length : 0)], ["p_best", best ? mfull(best.d) : "—"]];
  $("pstats").innerHTML = st.map(([k, v]) => `<div><span class="lbl">${t(k)}</span><b>${v}</b></div>`).join("");

  // Финансовое здоровье и подсказка по самому слабому пункту.
  const h = health(), weak = h.parts.slice().sort((a, b) => a[1] / a[2] - b[1] / b[2])[0];
  const lvl = h.score >= 80 ? "h_great" : h.score >= 60 ? "h_good" : h.score >= 40 ? "h_mid" : "h_low";
  const goal = profile.goal || 0, got = cur.inc - cur.exp;
  $("pscore").innerHTML = `<h2 class="lbl">${t("h_title")}</h2>
    <div class="score-h"><div class="ring" style="--p:${h.score}"><b>${h.score}</b></div>
      <div class="score-t"><strong>${t(lvl)}</strong><span class="sm">${h.score} / 100</span></div></div>
    <div class="parts">${h.parts.map(([k, v, m]) => `<div class="part"><div><span>${t(k)}</span><b>${v} / ${m}</b></div><div class="trk"><i style="width:${v / m * 100}%"></i></div></div>`).join("")}</div>
    ${h.score < 100 ? `<p class="tip">${t(weak[3])}</p>` : ""}
    ${goal > 0 ? `<div class="target"><span class="lbl">${t("p_target")}</span><b>${money(Math.max(0, got))} / ${money(goal)}</b>
      <div class="trk"><i style="width:${Math.min(100, Math.max(0, got) / goal * 100)}%"></i></div></div>` : ""}`;

  // Достижения.
  const last3 = [0, 1, 2].map(i => monthSums(prevM(now, i)));
  const A = [
    ["ac_first", db.tx.length >= 1], ["ac_ten", db.tx.length >= 10], ["ac_fifty", db.tx.length >= 50],
    ["ac_budget", Object.keys(db.bud).length > 0], ["ac_goal", db.goals.length > 0],
    ["ac_done", db.goals.some(g => g.saved >= g.target)], ["ac_rec", db.rec.length > 0],
    ["ac_saver", last3.some(m => m.inc && (m.inc - m.exp) / m.inc >= .2)], ["ac_streak", streak >= 3],
  ];
  $("pcnt").textContent = A.filter(x => x[1]).length + " / " + A.length;
  $("pach").innerHTML = A.map(([k, on]) => `<div class="a${on ? " on" : ""}"><i aria-hidden="true">${on ? "✓" : "·"}</i>${t(k)}</div>`).join("");

  // Форма: не трогаем поля, пока человек в них печатает.
  document.querySelectorAll("[data-lg]").forEach(b => b.setAttribute("aria-pressed", b.dataset.lg === lang));
  document.querySelectorAll("[data-th]").forEach(b => b.setAttribute("aria-pressed", b.dataset.th === theme));
  if (!$("pform").contains(document.activeElement)) {
    $("pn").value = profile.name || ""; $("pc").value = profile.city || ""; $("pj").value = profile.job || "";
    $("pg").value = profile.goal || ""; pcolor = profile.color || "lime";
  }
  document.querySelectorAll("[data-av]").forEach(b => b.setAttribute("aria-pressed", b.dataset.av === pcolor));
}
// Фото профиля: ужимаем до 256×256 и храним на устройстве (в метаданные аккаунта не кладём — они попадают в токен входа).
const photoKey = () => "ft.photo." + db.user.id;
function fitPhoto(file) {
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
      const m = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
      URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", .85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(); };
    img.src = url;
  });
}
$("pupl").onclick = $("pcam").onclick = () => $("pfile").click();
$("pfile").onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = "";
  if (!f || !db.user) return;
  try { photo = await fitPhoto(f); setPref(photoKey(), photo); render(); toast(t("p_photo_ok")); }
  catch (err) { toast(t("p_photo_err")); }
};
$("pdel").onclick = () => {
  if (!db.user) return;
  photo = ""; try { localStorage.removeItem(photoKey()); } catch (e) {}
  render();
};
$("psw").addEventListener("click", e => {
  const b = e.target.closest("[data-av]");
  if (!b) return;
  pcolor = b.dataset.av;
  document.querySelectorAll("[data-av]").forEach(x => x.setAttribute("aria-pressed", x.dataset.av === pcolor));
});
document.addEventListener("click", e => {
  const th = e.target.closest("[data-th]"), lg = e.target.closest("[data-lg]");
  if (th) setTheme(th.dataset.th);
  if (lg) setLang(lg.dataset.lg);
});
$("pform").onsubmit = e => {
  e.preventDefault();
  profile = { name: $("pn").value.trim().slice(0, 40), city: $("pc").value.trim().slice(0, 40), job: $("pj").value.trim().slice(0, 40),
    goal: Math.max(0, pn($("pg").value) || 0), color: pcolor, ts: Date.now() };
  setPref(profKey(), profile);
  sb.auth.updateUser({ data: { profile } }).catch(() => {}); // копия в аккаунте, чтобы профиль был на всех устройствах
  render();
  toast(t("p_saved_ok"));
};

// ---------- Форма операции ----------
function resetForm() {
  editId = null;
  $("amount").value = $("note").value = "";
  $("cancel").hidden = true;
  $("err").hidden = true;
  $("sub").textContent = t("add");
  $("ftitle").textContent = t("new_op");
}
function submitForm() {
  const err = $("err"), dt = $("date").value, a = pn($("amount").value);
  if (!(a > 0)) { err.textContent = t("e_amt"); err.hidden = false; $("amount").focus(); return; }
  if (!dt) { err.textContent = t("e_date"); err.hidden = false; return; }
  const fields = { type, amount: Math.round(a * 100) / 100, category: $("cat").value, date: dt, note: $("note").value.trim() };
  let x = editId && db.tx.find(y => y.id === editId);
  if (x) Object.assign(x, fields);
  else { x = { id: newId(), ...fields, created_at: new Date().toISOString() }; db.tx.push(x); }
  save("tx", x);
  // Переходим к месяцу операции, чтобы её сразу было видно.
  view = new Date(dt + "T00:00"); view.setDate(1);
  resetForm();
  $("amount").focus();
  render();
}
function startEdit(id) {
  const x = db.tx.find(y => y.id === id);
  if (!x) return;
  editId = x.id;
  type = x.type;
  fillCats();
  $("cat").value = x.category;
  $("amount").value = x.amount;
  $("date").value = x.date;
  $("note").value = x.note || "";
  $("sub").textContent = t("save");
  $("ftitle").textContent = t("edit_op");
  $("cancel").hidden = false;
  $("err").hidden = true;
  show("dash");
  $("form").scrollIntoView({ behavior: "smooth", block: "center" });
  $("amount").focus({ preventScroll: true });
}

$("form").onsubmit = e => { e.preventDefault(); submitForm(); };
$("cancel").onclick = resetForm;
$("tE").onclick = () => { type = "expense"; fillCats(); };
$("tI").onclick = () => { type = "income"; fillCats(); };

// Клик по строке операции — правка, по крестику — удаление с возможностью отмены.
document.addEventListener("click", e => {
  const ed = e.target.closest("[data-edit]");
  if (ed) return startEdit(ed.dataset.edit);
  const b = e.target.closest(".del[data-id]");
  if (!b) return;
  const i = db.tx.findIndex(x => x.id === b.dataset.id);
  if (i < 0) return;
  lastDeleted = db.tx.splice(i, 1)[0];
  remove("tx", { id: lastDeleted.id });
  render();
  toast(t("deleted"), () => { db.tx.push(lastDeleted); save("tx", lastDeleted); lastDeleted = null; render(); });
});
document.addEventListener("keydown", e => {
  const ed = e.target.closest && e.target.closest("[data-edit]");
  if (ed && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); startEdit(ed.dataset.edit); }
});
$("undo").onclick = () => { if (undoFn) undoFn(); undoFn = null; $("toast").hidden = true; };

// ---------- Операции: фильтр, CSV, резервная копия ----------
// Поиск и фильтр меняют только списки — остальные блоки не перерисовываем.
$("q").oninput = $("ft").onchange = () => renderLists(monthSums(view));

function download(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("csv").onclick = () => {
  const r = [["date", "type", "category", "amount", "note"],
    ...db.tx.slice().sort(byDate).map(x => [x.date, x.type, cn(x.category), x.amount, (x.note || "").replace(/"/g, '""')])];
  // ﻿ в начале — чтобы Excel правильно открыл кириллицу.
  download("expenses.csv", "﻿" + r.map(a => a.map(v => `"${v}"`).join(",")).join("\n"), "text/csv");
};
$("bk").onclick = () => download("expenses-backup.json", JSON.stringify({ version: 2, tx: db.tx, bud: db.bud, goals: db.goals, rec: db.rec }), "application/json");
$("imp").onclick = () => $("file").click();

// Проверка строк из файла копии: принимаем и старый формат (числовые id), и новый.
const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const okType = s => s === "income" || s === "expense";
const uuidRe = /^[0-9a-f-]{36}$/i;
const fixId = id => uuidRe.test(id) ? id : newId();
const stamp = x => x.created_at || new Date(+x.id > 1e12 ? +x.id : Date.now()).toISOString();
function parseBackup(d) {
  const tx = (d.tx || []).filter(x => okType(x.type) && pn(x.amount) > 0 && okDate(x.date)).map(x => ({
    id: fixId(x.id), type: x.type, category: String(x.category).slice(0, 30), amount: pn(x.amount),
    date: x.date, note: String(x.note || "").slice(0, 120), created_at: stamp(x) }));
  const bud = {};
  Object.entries(d.bud || {}).forEach(([c, l]) => { if (pn(l) > 0) bud[String(c).slice(0, 30)] = pn(l); });
  const goals = (d.goals || []).filter(g => g.name && pn(g.target) > 0).map(g => ({
    id: fixId(g.id), name: String(g.name).slice(0, 60), target: pn(g.target), saved: Math.max(0, pn(g.saved) || 0), created_at: stamp(g) }));
  const rec = (d.rec || []).filter(r => okType(r.type) && pn(r.amount) > 0 && okDate(r.next) && ["weekly", "monthly"].includes(r.every)).map(r => ({
    id: fixId(r.id), type: r.type, category: String(r.category).slice(0, 30), amount: pn(r.amount),
    note: String(r.note || "").slice(0, 120), every: r.every, next: r.next, created_at: stamp(r) }));
  return { tx, bud, goals, rec };
}
$("file").onchange = e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!Array.isArray(d.tx)) return;
      replaceAll(parseBackup(d));
      render();
    } catch (x) { console.error(x); }
  };
  fr.readAsText(f);
};

// ---------- Бюджет ----------
$("bgrid").addEventListener("change", e => {
  const c = e.target.dataset.c;
  if (!c) return;
  setBudget(c, pn(e.target.value) || 0);
  e.target.blur();
  render();
});

// ---------- Цели ----------
$("gadd").onclick = () => {
  const n = $("gname").value.trim(), a = pn($("gtar").value), e = $("gerr");
  if (!n || !(a > 0)) { e.textContent = t("e_amt"); e.hidden = false; return; }
  e.hidden = true;
  const g = { id: newId(), name: n, target: a, saved: 0, created_at: new Date().toISOString() };
  db.goals.push(g);
  save("goals", g);
  $("gname").value = $("gtar").value = "";
  render();
};
$("glist").addEventListener("click", e => {
  const a = e.target.dataset.gadd, d = e.target.dataset.gdel;
  if (a) {
    const g = db.goals.find(x => x.id === a), v = pn(document.querySelector(`.gin[data-g="${a}"]`).value);
    if (g && v > 0) { g.saved += v; save("goals", g); render(); }
  }
  if (d) { db.goals = db.goals.filter(x => x.id !== d); remove("goals", { id: d }); render(); }
});

// ---------- Регулярные платежи ----------
$("rtype").onchange = rcats;
$("radd").onclick = async () => {
  const a = pn($("ramt").value), d = $("rdate").value, e = $("rerr");
  if (!(a > 0) || !d) { e.textContent = t(a > 0 ? "e_date" : "e_amt"); e.hidden = false; return; }
  e.hidden = true;
  const r = { id: newId(), type: $("rtype").value, category: $("rcat").value, amount: a, note: $("rnote").value.trim(),
    every: $("revery").value, next: d, created_at: new Date().toISOString() };
  db.rec.push(r);
  save("recurring", r);
  $("ramt").value = $("rnote").value = "";
  render();
  // Сразу отправляем и перечитываем: если первая дата уже наступила, сервер создаст операции.
  await load();
  render();
};
$("rlist").addEventListener("click", e => {
  const d = e.target.dataset.rdel;
  if (d) { db.rec = db.rec.filter(r => r.id !== d); remove("recurring", { id: d }); render(); }
});

// ---------- Отчёт ----------
$("pdf").onclick = () => print();

// ---------- Шапка ----------
$("prev").onclick = () => { view = prevM(view); render(); };
$("next").onclick = () => { view = prevM(view, -1); render(); };
$("lang").onchange = $("lang2").onchange = e => setLang(e.target.value);
$("theme").onclick = $("theme2").onclick = () => setTheme(theme === "dark" ? "light" : "dark");
document.querySelectorAll("[data-v]").forEach(b => b.onclick = () => show(b.dataset.v));

// ---------- Вход и выход ----------
function authMsg(k) {
  const e = $("aerr");
  e.textContent = t("e_" + k);
  e.classList.toggle("info", k === "check");
  e.hidden = false;
}
async function authGo(kind) {
  const email = $("aemail").value.trim().toLowerCase(), pw = $("apass").value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pw.length < 6) return authMsg("bad");
  // Пока ждём ответа, нажатая кнопка пишет «Подождите…» — видно, что запрос ушёл.
  const btn = $(kind === "login" ? "alogin" : "areg");
  $("aerr").hidden = true;
  $("alogin").disabled = $("areg").disabled = true;
  btn.textContent = t("busy");
  const k = await (kind === "login" ? signIn : signUp)(email, pw);
  $("alogin").disabled = $("areg").disabled = false;
  btn.textContent = t(kind === "login" ? "login" : "reg");
  if (k) return authMsg(k);
  $("aerr").hidden = true;
  $("apass").value = "";
}
const openForm = () => { $("aform").hidden = false; $("aemail").focus(); };
$("aopen").onclick = $("aopen2").onclick = openForm;
$("aopen3").onclick = () => { $("auth").scrollTo({ top: 0, behavior: "smooth" }); openForm(); };
if ($("apause")) $("apause").onclick = () => { const on = $("apause").getAttribute("aria-pressed") !== "true"; $("apause").setAttribute("aria-pressed", on); $("auth").classList.toggle("paused", on); };
// Блоки лендинга появляются при прокрутке.
{
  const els = document.querySelectorAll(".rv");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { root: $("auth"), threshold: .2 });
    els.forEach(e => io.observe(e));
  } else els.forEach(e => e.classList.add("in"));
}
$("alogin").onclick = () => authGo("login");
$("areg").onclick = () => authGo("register");
$("auth").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") authGo("login"); });
$("eye").onclick = () => {
  const i = $("apass"), on = i.type === "password";
  i.type = on ? "text" : "password";
  $("eye").setAttribute("aria-pressed", on);
};
$("out").onclick = () => signOut();

// Показать данные пользователя из кэша — мгновенно, без сети.
function openUser(user) {
  db.user = { id: user.id, email: user.email, since: user.created_at || (pref("ft.last", null) || {}).since };
  setPref("ft.last", db.user);
  profile = pref(profKey(), {});
  photo = pref(photoKey(), "");
  readLocal();
  $("auth").hidden = true;
  render();
}
// Supabase подтвердил вход: если ещё не показали — показываем кэш, затем один раз подтягиваем свежие данные.
let syncedFor = null;
async function enter(user) {
  if (!db.user || db.user.id !== user.id) openUser(user);
  // Профиль хранится и в метаданных аккаунта Supabase (таблицы не нужны): берём более свежую копию.
  const rp = user.user_metadata && user.user_metadata.profile;
  if (rp && (rp.ts || 0) > (profile.ts || 0)) { profile = rp; setPref(profKey(), profile); render(); }
  if (syncedFor === user.id) return; // о сессии сообщают много раз (обновление токена и т.п.)
  syncedFor = user.id;
  const r = await load();
  if (r === "srv") toast(t("e_srv"));
  render();
}
function leave() {
  syncedFor = null;
  Object.assign(db, { user: null, tx: [], bud: {}, goals: [], rec: [], queue: [] });
  profile = {}; photo = "";
  try { localStorage.removeItem("ft.last"); } catch (e) {}
  resetForm();
  $("auth").hidden = false;
  render();
}
db.onStatus = renderSync;
db.onError = k => toast(t("e_" + k));

sb.auth.onAuthStateChange((event, session) => {
  // setTimeout: внутри этого колбэка Supabase не рекомендует вызывать свои же методы.
  if (session && session.user) return setTimeout(() => enter(session.user));
  if (event === "SIGNED_OUT") return leave();
  // Сессии нет. Без сети её и не проверить — оставляем данные из кэша; в сети — просим войти.
  if (event === "INITIAL_SESSION" && (navigator.onLine || !db.user)) leave();
});

// Вернулись на вкладку — подтягиваем изменения с другого устройства, но не чаще раза в 30 секунд.
let lastPull = 0;
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !db.user || !navigator.onLine || Date.now() - lastPull < 30000) return;
  lastPull = Date.now();
  if ((await load()) === "ok") render();
});

// ---------- Запуск ----------
$("date").value = $("rdate").value = isoDay(new Date());
applyTheme();
show(current);
i18n();
// Кто входил в прошлый раз — сразу показываем его данные из кэша, не дожидаясь ответа Supabase.
const last = pref("ft.last", null);
if (last) openUser(last); else render();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
