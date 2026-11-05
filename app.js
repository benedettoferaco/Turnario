const sb = supabase.createClient(CONFIG.url, CONFIG.anon);
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RN = { admin: "Account tecnico", director: "Direttore", manager: "Responsabile di reparto", staff: "Addetto" };
const DN = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
let me = null, tab = "home", wk = 0, people = [], deps = [], plan = {}, edits = {}, curWeek = "";
const isMgr = () => ["manager", "director", "admin"].includes(me.role), isTop = () => ["director", "admin"].includes(me.role);
const depOf = (p) => deps.find((d) => d.id === p.department_id) || {};
const show = (h) => ($("#main").innerHTML = h);

// ---- date: le settimane vanno da lunedì a domenica
const mondayOf = (o = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * o); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fmt = (d) => d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
const wkLabel = (o) => fmt(mondayOf(o)) + " – " + fmt(addDays(mondayOf(o), 6));
const longDay = (d) => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const hh = (s) => s.s + "–" + s.e;
const day = (d) => new Date(d).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
// turno -> ore intere (inizio, fine); la fine è sempre in ore, anche a cavallo della mezzanotte
const toHours = (s) => { const a = new Date(s.starts_at), b = new Date(s.ends_at), st = a.getHours(), e = st + Math.round((b - a) / 36e5); return { s: st, e: e > 24 ? e - 24 : e }; };
const dayIdx = (s, o) => { const a = new Date(s.starts_at); return Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - mondayOf(o)) / 864e5); };
const cls = (c) => (!c || c === "R" ? "R" : c.s >= 22 || c.s < 5 ? "N" : c.s < 12 ? "M" : "P");
const part = (c) => (c.s >= 22 || c.s < 5 ? "Notte" : c.s < 12 ? "Mattina" : "Pomeriggio");
const ini = (p) => ((p.first_name || "?")[0] + (p.last_name || "")[0]).toUpperCase();
const soon = (t) => show(`<h2>${t}</h2><div class="card"><b>Arriva nel prossimo aggiornamento</b><p class="mut">Questa sezione c’è già nell’artefatto di prova e verrà collegata all’archivio dati. Le regole nel database sono pronte.</p></div>`);

// ---- accesso
async function login() {
  const err = $("#err"); err.textContent = "Verifico il codice…";
  try {
    const { data, error } = await sb.functions.invoke("login-with-code", { body: { code: $("#code").value } });
    if (error || !data?.token_hash) {
      let m = data?.error;
      if (!m && error?.context?.json) { try { m = (await error.context.json()).error; } catch (_) {} }
      err.textContent = m || ("Funzione non raggiungibile: " + (error?.message || "controlla che login-with-code sia pubblicata"));
      return;
    }
    const r = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    if (r.error) { err.textContent = "Accesso non riuscito: " + r.error.message; return; }
    err.textContent = ""; boot();
  } catch (e) { console.error(e); err.textContent = "Errore: " + e.message; }
}
async function boot() {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) { $("#login").hidden = false; $("#app").hidden = true; return; }
  const { data } = await sb.from("profiles").select("*").eq("id", s.session.user.id).single();
  if (!data) { await sb.auth.signOut(); return boot(); }
  me = data; $("#login").hidden = true; $("#app").hidden = false; curWeek = iso(mondayOf(0));
  document.body.classList.add("dir");
  const { data: d } = await sb.from("departments").select("*").order("id"); deps = d || [];
  go(isTop() ? "dash" : "home");
}

// ---- navigazione: barra laterale per direttore e account tecnico, barra in basso per gli altri
const SIDE = [["dash", "Cruscotto"], ["richieste", "Richieste e cambi turno"], ["cassa", "Chiusure di cassa"], ["bot", "Assistente turni"], ["chat", "Chat"], ["team", "Team"], ["crea", "Creazione profilo"], ["codici", "Profili e codici"], ["profilo", "Profilo"]];
async function badges() {
  const [r, c] = await Promise.all([sb.from("requests").select("id", { count: "exact", head: true }).in("status", ["open", "agreed"]), sb.from("cash_closings").select("id", { count: "exact", head: true }).eq("status", "pending")]);
  [["richieste", r.count], ["cassa", c.count]].forEach(([k, n]) => { const e = $("#b-" + k); if (e) { e.textContent = n || 0; e.hidden = !n; } });
}
const goWeek = (e) => (e === "crea-turni" ? (wk = 1, go("turni")) : go(e));
function sideItems() {
  if (isTop()) return SIDE;
  const casse = depOf(me).name === "Casse";
  return [["home", "Home"], ...(isMgr() ? [["turni", "Turni"], ["bot", "Assistente turni"]] : []), ["richieste", "Richieste e cambi turno"], ...(casse ? [["cassa", me.role === "manager" ? "Chiusure di cassa" : "Cassa"]] : []), ["chat", "Chat"], ["team", "Team"], ["profilo", "Profilo"]];
}
function go(t) {
  tab = t; document.body.classList.remove("open");
  $("#side").innerHTML = `<div class="row" style="flex-wrap:nowrap;margin-bottom:12px"><span class="av">${esc(ini(me))}</span><div><b>${esc(me.first_name)} ${esc(me.last_name)}</b><div class="mut">${RN[me.role]}</div></div></div>` +
    (isMgr() ? `<button class="btn" style="width:100%;margin-bottom:10px" data-t="crea-turni">+ Crea turni</button>` : "") +
    sideItems().map(([k, l]) => `<button class="si ${k === tab ? "on" : ""}" data-t="${k}"><span>${l}</span><span class="tag" id="b-${k}" hidden></span></button>`).join("");
  $("#side").querySelectorAll("button").forEach((b) => (b.onclick = () => goWeek(b.dataset.t)));
  if (isTop()) badges();
  ({ home, dash, turni, team, crea, codici, profilo, richieste: () => soon("Richieste e cambi turno"), cassa: () => soon("Chiusure di cassa"), bot: botPage, chat: () => soon("Chat") })[tab]();
}

// ---- Home (addetti e responsabili)
async function home() {
  const a = mondayOf(0), b = addDays(a, 7), ti = (new Date().getDay() + 6) % 7;
  const [{ data: sh }, { data: nt }] = await Promise.all([
    sb.from("shifts").select("*").eq("profile_id", me.id).gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()).order("starts_at"),
    sb.from("notices").select("*").is("read_at", null).order("created_at", { ascending: false }),
  ]);
  const by = {}; (sh || []).forEach((s) => { by[dayIdx(s, 0)] = toHours(s); });
  const t = by[ti], nx = [...Array(7).keys()].find((i) => i > ti && by[i]);
  show(`<div class="row" style="flex-wrap:nowrap;margin:6px 0 10px"><span class="av">${esc(ini(me))}</span><h2 style="margin:0">Ciao ${esc(me.first_name)}</h2></div>
  ${(nt || []).map((n) => `<div class="card" style="border:2px solid var(--r)"><b>Avviso per te</b><div style="margin-top:6px">${esc(n.body)}</div><button class="alt" data-n="${n.id}" style="margin-top:8px">Ho letto</button></div>`).join("")}
  <div class="card" style="background:var(--${t ? (cls(t) === "P" ? "p" : "m") : "rest"});border-color:transparent"><div class="mut">Oggi, ${longDay(new Date())}</div><div style="font-size:44px;font-weight:800;line-height:1.1">${t ? hh(t) : "Riposo"}</div><div>${t ? part(t) : "Giornata libera"} · ${esc(depOf(me).name || "")}</div></div>
  ${nx !== undefined ? `<div class="card"><div class="mut">Prossimo turno</div><b>${DN[nx]} ${addDays(a, nx).getDate()}</b> · ${part(by[nx])} ${hh(by[nx])}</div>` : ""}
  <div class="row" style="margin-bottom:6px"><button id="nx">Turni della prossima settimana</button></div>
  <h3>La tua settimana</h3><p class="mut" style="margin-top:-4px">${wkLabel(0)}</p>
  ${DN.map((d, i) => `<div class="row card" style="padding:10px;${i === ti ? "border-color:var(--g);border-width:2.5px;" : ""}${i < ti ? "opacity:.55" : ""}"><div style="width:64px"><b>${d}</b><div class="mut">${addDays(a, i).getDate()}</div></div><span class="s ${cls(by[i])}" style="flex:1;padding:10px;font-size:15px;display:block;text-align:center">${by[i] ? part(by[i]) + " " + hh(by[i]) : "Riposo"}</span></div>`).join("")}`);
  $("#nx").onclick = nextView;
  $("#main").querySelectorAll("[data-n]").forEach((b) => (b.onclick = async () => { await sb.from("notices").update({ read_at: new Date().toISOString() }).eq("id", b.dataset.n); home(); }));
}

// ---- Cruscotto del direttore
async function dash() {
  const a = mondayOf(0), b = addDays(a, 7), now = new Date().toISOString();
  const [{ data: on }, rq, cl, { data: ws }, { data: pe }, { data: nt }] = await Promise.all([
    sb.from("shifts").select("starts_at,ends_at,profiles(first_name,last_name,department_id)").lte("starts_at", now).gt("ends_at", now),
    sb.from("requests").select("id", { count: "exact", head: true }).in("status", ["open", "agreed"]),
    sb.from("cash_closings").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("shifts").select("profile_id,starts_at,ends_at").gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()),
    sb.from("profiles").select("id,first_name,last_name,department_id,contract_hours").eq("active", true).neq("role", "admin"),
    sb.from("notices").select("*").is("read_at", null),
  ]);
  const nightIds = (pe || []).filter((p) => depOf(p).is_night).map((p) => p.id);
  const uncovered = [...Array(7).keys()].filter((i) => !(ws || []).some((s) => nightIds.includes(s.profile_id) && dayIdx(s, 0) === i)).length;
  const hrs = {}; (ws || []).forEach((s) => { hrs[s.profile_id] = (hrs[s.profile_id] || 0) + (new Date(s.ends_at) - new Date(s.starts_at)) / 36e5; });
  const over = (pe || []).filter((p) => (hrs[p.id] || 0) > p.contract_hours), g = {};
  (on || []).forEach((s) => { const d = (deps.find((x) => x.id === s.profiles.department_id) || {}).name || "—"; (g[d] ||= []).push(`${esc(s.profiles.first_name)} ${esc(s.profiles.last_name)} (${hh(toHours(s))})`); });
  const K = (l, v, sub, k) => `<div class="card kpi" data-go="${k}"><div class="mut">${l}</div><b>${v}</b><div class="mut">${sub}</div></div>`;
  show(`<h2>Buongiorno, ${esc(me.first_name)}</h2><p class="mut" style="margin-top:-4px">${new Date().toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p>
  ${(nt || []).map((n) => `<div class="card" style="border:2px solid var(--r)"><b>Avviso</b><div>${esc(n.body)}</div></div>`).join("")}
  <div class="kpis">${K("In turno ora", (on || []).length, "persone", "dash")}${K("Richieste aperte", rq.count || 0, "da gestire", "richieste")}${K("Chiusure da convalidare", cl.count || 0, "cassa", "cassa")}${K("Notti scoperte", uncovered, "nessun addetto", "turni")}${K("Oltre il massimo ore", over.length, esc(over.map((p) => p.first_name).join(", ")) || "nessuno", "turni")}</div>
  <h3>Azioni rapide</h3><div class="row"><button data-go="crea-turni">Crea turni</button><button class="alt" data-go="richieste">Richieste</button><button class="alt" data-go="cassa">Chiusure</button><button class="alt" data-go="bot">Chiedi all’assistente</button></div>
  <h3>In turno adesso</h3>${Object.keys(g).map((k) => `<div class="card" style="margin-bottom:8px"><b>${esc(k)}</b><div>${g[k].join(", ")}</div></div>`).join("") || `<p class="mut">Nessuno in turno in questo momento.</p>`}`);
  $("#main").querySelectorAll("[data-go]").forEach((e) => (e.onclick = () => goWeek(e.dataset.go)));
}

// ---- Profilo
async function profilo() {
  const a = mondayOf(0), b = addDays(a, 7);
  const { data: sh } = await sb.from("shifts").select("starts_at,ends_at").eq("profile_id", me.id).gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString());
  const w = (sh || []).reduce((x, s) => x + (new Date(s.ends_at) - new Date(s.starts_at)) / 36e5, 0);
  show(`<h2>Il tuo profilo</h2><div class="card" style="text-align:center"><span class="av" style="width:96px;height:96px;font-size:34px">${esc(ini(me))}</span><div class="mut" style="margin-top:6px">Foto profilo · solo visualizzazione</div></div>
  <div class="card row" style="flex-wrap:nowrap"><span class="av">${esc(ini(me))}</span><div><b>${esc(me.first_name)} ${esc(me.last_name)}</b><div class="mut">${esc(me.title || "")} · ${esc(depOf(me).name || "Tecnico")}</div><span class="tag ok">${RN[me.role]}</span>
  ${depOf(me).name === "Casse" && me.role === "staff" ? `<div class="mut">Fondo cassa: <b>€ ${Number(me.cash_float).toFixed(2).replace(".", ",")}</b></div>` : ""}
  ${me.role === "admin" ? "" : `<div class="mut">Ore settimanali: <b>${w}</b> / massimo ${me.contract_hours}</div>`}</div></div>`);
}

// ---- turni: creati settimana per settimana, con sole ore
async function weekCreated(o) {
  const { data } = await sb.from("week_plans").select("department_id").eq("week_start", iso(mondayOf(o)));
  if (!data) return false;
  return isTop() ? data.length > 0 : data.some((r) => r.department_id === me.department_id);
}
async function nextView() {
  if (!(await weekCreated(1))) return alert("I turni ancora non sono stati creati.");
  const a = mondayOf(1), b = addDays(a, 7);
  const { data: sh } = await sb.from("shifts").select("*").eq("profile_id", me.id).gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()).order("starts_at");
  show(`<h2>Turni della prossima settimana</h2><p class="mut">${wkLabel(1)}</p>${(sh || []).map((s) => `<div class="card row"><b style="width:90px">${day(s.starts_at)}</b><span>${hh(toHours(s))}</span></div>`).join("") || `<p class="mut">Nessun turno per te questa settimana.</p>`}<button class="alt" id="back">Indietro</button>`);
  $("#back").onclick = () => go(isTop() ? "dash" : "home");
}
let brush = null, hist = [], pending = null;
const len2 = (c) => (c.e > c.s ? c.e - c.s : c.e + 24 - c.s);
const BR = [["6-14", { s: 6, e: 14 }], ["14-22", { s: 14, e: 22 }], ["22-6", { s: 22, e: 6 }], ["R", "R"]];
async function loadWeek() {
  const a = mondayOf(wk), b = addDays(a, 7); plan = {};
  const [{ data: sh }, { data: pe }, { data: wp }] = await Promise.all([
    sb.from("shifts").select("*").gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()),
    sb.from("profiles").select("id,first_name,last_name,department_id,role,contract_hours").eq("active", true).neq("role", "admin"),
    sb.from("week_plans").select("department_id").eq("week_start", iso(a)),
  ]);
  people = (pe || []).sort((x, y) => x.department_id - y.department_id || x.last_name.localeCompare(y.last_name));
  (sh || []).forEach((s) => { const i = dayIdx(s, wk); ((plan[s.profile_id] ||= {})[i] ||= { ...toHours(s), ids: [] }).ids.push(s.id); });
  return (wp || []).length > 0;
}
async function turni() {
  const created = await loadWeek(); edits = pending || {}; pending = null; hist = [];
  show(`<h2>Turni</h2><div class="chips"><button class="${wk === 0 ? "on" : ""}" id="w0">Questa settimana</button><button class="${wk === 1 ? "on" : ""}" id="w1">Turni della prossima settimana</button></div>
  <p class="mut">${wkLabel(wk)} · ${wk === 1 && !created ? "Turni ancora da creare: dopo il salvataggio diventano visibili al personale." : "Scegli un orario in alto e tocca le caselle: si imposta subito."}</p>
  <div class="chips" id="brush"></div>
  <div class="row" style="margin-bottom:10px"><button class="alt" id="un">Annulla ultima modifica</button><button class="alt" id="cp">Copia settimana scorsa</button><button class="alt" id="cl">Svuota</button><button class="alt" id="as">Chiedi all’assistente</button></div>
  <div class="tw"><table id="grid"></table></div><button id="sv" style="margin-top:12px">Salva settimana</button>`);
  $("#w0").onclick = () => { wk = 0; turni(); }; $("#w1").onclick = () => { wk = 1; turni(); }; $("#sv").onclick = saveWeek;
  $("#un").onclick = undo; $("#cp").onclick = copyPrev; $("#cl").onclick = clearAll; $("#as").onclick = () => go("bot");
  drawBrush(); grid();
}
function drawBrush() {
  $("#brush").innerHTML = `<button class="${brush === null ? "on" : ""}" data-b="">Scegli ogni volta</button>` + BR.map(([k, v]) => `<button class="${brush === k ? "on" : ""}" data-b="${k}">${v === "R" ? "Riposo" : v.s + "–" + v.e}</button>`).join("");
  $("#brush").querySelectorAll("button").forEach((b) => (b.onclick = () => { brush = b.dataset.b || null; drawBrush(); }));
}
const pushHist = () => hist.push(JSON.stringify(edits));
function undo() { if (!hist.length) return; edits = JSON.parse(hist.pop()); grid(); }
const cur = (pid, i) => edits[pid + "|" + i] ?? plan[pid]?.[i] ?? null;
function okFor(p, v) { return v === "R" || !!depOf(p).is_night || (v.e > v.s && v.e <= 22); }
function applyCell(pid, i, v, quiet) {
  const p = people.find((x) => x.id === pid);
  if (!okFor(p, v)) { if (!quiet) alert("Fuori dal reparto Notte i turni finiscono entro le 22."); return false; }
  edits[pid + "|" + i] = v; return true;
}
function rowH(pid) { let h = 0; for (let i = 0; i < 7; i++) { const c = cur(pid, i); if (c && c !== "R") h += len2(c); } return h; }
function grid() {
  const a = mondayOf(wk), nightP = people.filter((p) => depOf(p).is_night);
  $("#grid").innerHTML = `<tr><th>Persona</th>${DN.map((d, i) => `<th>${d}<br><span class="mut">${addDays(a, i).getDate()}</span></th>`).join("")}<th>Ore</th></tr>` +
    people.map((p) => { const h = rowH(p.id); return `<tr><td><b class="nm" data-r="${p.id}" style="cursor:pointer">${esc(p.first_name)} ${esc(p.last_name)}</b><div class="mut">${esc(depOf(p).name)}</div></td>${DN.map((_, i) => { const c = cur(p.id, i), ch = (p.id + "|" + i) in edits;
      return `<td><button class="s can ${cls(c)} ${ch ? "chg" : ""}" data-p="${p.id}" data-i="${i}">${c === "R" ? "Riposo" : c ? hh(c) : "—"}</button></td>`; }).join("")}<td style="${h > p.contract_hours ? "color:var(--r);font-weight:800" : ""}">${h}/${p.contract_hours}</td></tr>`; }).join("") +
    (nightP.length ? `<tr><td><b>Notte (1–2)</b></td>${DN.map((_, i) => { const n = nightP.filter((p) => cls(cur(p.id, i)) === "N").length; return `<td style="${n < 1 ? "color:var(--r);font-weight:800" : ""}">${n}</td>`; }).join("")}<td></td></tr>` : "");
  $("#grid").querySelectorAll(".s").forEach((b) => (b.onclick = () => cellTap(b.dataset.p, +b.dataset.i)));
  $("#grid").querySelectorAll(".nm").forEach((b) => (b.onclick = () => fillRow(b.dataset.r)));
}
function cellTap(pid, i) {
  if (brush === null) return openCell(pid, i);
  pushHist(); applyCell(pid, i, BR.find(([k]) => k === brush)[1]); grid();
}
function fillRow(pid) {
  if (brush === null) return alert("Scegli prima un orario in alto: verrà messo su tutta la riga.");
  pushHist(); let bad = false; for (let i = 0; i < 7; i++) if (!applyCell(pid, i, BR.find(([k]) => k === brush)[1], true)) bad = true;
  if (bad) alert("Fuori dal reparto Notte i turni finiscono entro le 22."); grid();
}
async function copyPrev() {
  const a = mondayOf(wk - 1), b = addDays(a, 7);
  const { data } = await sb.from("shifts").select("*").gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString());
  if (!(data || []).length) return alert("La settimana scorsa non ha turni da copiare.");
  pushHist(); (data || []).forEach((s) => { if (people.find((p) => p.id === s.profile_id)) applyCell(s.profile_id, dayIdx(s, wk - 1), toHours(s), true); }); grid();
}
function clearAll() { if (!confirm("Mettere tutti in riposo per questa settimana?")) return; pushHist(); people.forEach((p) => { for (let i = 0; i < 7; i++) edits[p.id + "|" + i] = "R"; }); grid(); }
function openCell(pid, i) {
  const p = people.find((x) => x.id === pid), night = !!depOf(p).is_night, c = cur(pid, i), v = c && c !== "R" ? c : { s: 6, e: 14 };
  const opts = (lo, hi, sel) => { let o = ""; for (let h = lo; h <= hi; h++) o += `<option value="${h}" ${h === sel ? "selected" : ""}>${h}</option>`; return o; };
  const pre = [[6, 14], [14, 22], ...(night ? [[22, 6]] : [])];
  $("#dlg").innerHTML = `<b>${esc(p.first_name)} ${esc(p.last_name)}</b><div class="mut">${DN[i]} ${addDays(mondayOf(wk), i).getDate()}</div>
  <div class="row" style="margin:10px 0">${pre.map(([s, e]) => `<button class="alt" data-s="${s}" data-e="${e}">${s}–${e}</button>`).join("")}</div>
  <div class="row"><label style="flex:1">Dalle ore<select id="hs">${opts(0, 23, v.s)}</select></label><label style="flex:1">Alle ore<select id="he">${opts(1, night ? 24 : 22, Math.min(v.e, night ? 24 : 22))}</select></label></div>
  <p class="mut">${night ? "Reparto Notte: si può lavorare di notte." : "Fuori dal reparto Notte i turni finiscono entro le 22."}</p>
  <div class="row"><button id="ok">Imposta</button><button class="alt" id="rest">Riposo</button><button class="alt" id="no">Annulla</button></div>`;
  const set = (val) => { pushHist(); if (applyCell(pid, i, val)) { $("#dlg").close(); grid(); } };
  $("#dlg").querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => set({ s: +b.dataset.s, e: +b.dataset.e })));
  $("#ok").onclick = () => { const s = +$("#hs").value, e = +$("#he").value; if (e <= s && !night) return alert("L’ora di fine deve essere dopo quella di inizio."); set({ s, e }); };
  $("#rest").onclick = () => set("R"); $("#no").onclick = () => $("#dlg").close();
  $("#dlg").showModal();
}
async function saveWeek() {
  const mon = mondayOf(wk), errs = [], depsDone = new Set();
  for (const k of Object.keys(edits)) {
    const [pid, di] = k.split("|"), v = edits[k], c = plan[pid]?.[di], p = people.find((x) => x.id === pid);
    if (c?.ids?.length) { const r = await sb.from("shifts").delete().in("id", c.ids); if (r.error) { errs.push(r.error.message); continue; } }
    if (v !== "R") {
      const d = addDays(mon, +di), st = new Date(d); st.setHours(v.s, 0, 0, 0);
      const en = new Date(v.e > v.s ? d : addDays(d, 1)); en.setHours(v.e, 0, 0, 0);
      const r = await sb.from("shifts").insert({ profile_id: pid, starts_at: st.toISOString(), ends_at: en.toISOString(), created_by: me.id });
      if (r.error) errs.push(`${p.first_name} ${DN[di]}: ${r.error.message}`); else depsDone.add(p.department_id);
    }
  }
  Object.keys(plan).forEach((pid) => { const p = people.find((x) => x.id === pid); if (p) depsDone.add(p.department_id); });
  if (depsDone.size) await sb.from("week_plans").upsert([...depsDone].map((d) => ({ week_start: iso(mon), department_id: d, created_by: me.id })), { onConflict: "week_start,department_id" });
  alert(errs.length ? "Alcuni turni non sono stati salvati:\n" + errs.join("\n") : "Turni salvati.");
  turni();
}

// ---- assistente turni: ti chiede di cosa hai bisogno e prepara una proposta, che poi controlli e salvi
const SHT = { M: { s: 6, e: 14 }, P: { s: 14, e: 22 }, N: { s: 22, e: 6 } }, SHN = { M: "mattina", P: "pomeriggio", N: "notte" };
const norm = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const DFULL = ["lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato", "domenica"], DABB = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
const dayList = (x) => [...new Set(x.split(/[^a-z]+/).map((t) => (DFULL.indexOf(t) >= 0 ? DFULL.indexOf(t) : DABB.indexOf(t))).filter((i) => i >= 0))].sort();
let bot = { log: [], step: "", a: {} };
const say = (t, chips = []) => bot.log.push({ r: "bot", t, chips });
function botReset() { bot = { log: [], step: "week", a: {} }; say("Ciao! Ti aiuto a creare i turni, solo a ore. Per quale settimana?", ["Questa settimana", "Prossima settimana"]); }
function botPage() {
  if (!bot.log.length) botReset();
  const last = bot.log[bot.log.length - 1], chips = last.r === "bot" ? last.chips : [];
  show(`<h2>Assistente turni</h2><div class="msgs" style="background:var(--rest);border-radius:10px;padding:10px;max-height:calc(100vh - 360px)">${bot.log.map((m) => `<div class="b ${m.r === "me" ? "me" : ""}">${m.t}</div>`).join("")}</div>
  ${chips.length ? `<div class="chips">${chips.map((c) => `<button data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
  <div class="row" style="flex-wrap:nowrap"><input id="bi" placeholder="Scrivi qui la tua risposta" style="flex:1" autocomplete="off"><button id="bs">Invia</button></div>
  <button class="alt" id="br" style="margin-top:8px">Ricomincia</button>`);
  $("#main").querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => botIn(b.dataset.c)));
  $("#bs").onclick = () => botIn($("#bi").value); $("#bi").onkeydown = (e) => e.key === "Enter" && botIn($("#bi").value); $("#br").onclick = () => { botReset(); botPage(); };
  const m = $(".msgs"); if (m) m.scrollTop = m.scrollHeight;
}
async function botIn(t) {
  t = String(t || "").trim(); if (!t) return; bot.log.push({ r: "me", t: esc(t) }); const x = norm(t), a = bot.a;
  if (/ricomincia/.test(x)) { botReset(); return botPage(); }
  if (bot.step === "week") {
    wk = /prossim/.test(x) ? 1 : 0; await loadWeek(); a.wk = wk;
    const dl = isTop() ? deps.filter((d) => d.name !== "Direzione") : [depOf(me)];
    if (dl.length === 1) { a.dep = dl[0]; return askNeed(0); }
    bot.step = "dep"; say("Per quale reparto?", dl.map((d) => d.name));
  } else if (bot.step === "dep") {
    const d = deps.find((d) => norm(d.name) === x || x.includes(norm(d.name)));
    if (!d) say("Non riconosco il reparto. Scrivi il nome o scegli un pulsante.", deps.filter((d) => d.name !== "Direzione").map((d) => d.name)); else { a.dep = d; return askNeed(0); }
  } else if (bot.step.startsWith("need")) {
    const k = a.keys[+bot.step.slice(4)], n = parseInt(x.replace(/[^0-9]/g, ""), 10);
    if (isNaN(n) || n > 9) say("Scrivi un numero, per esempio 2.", ["0", "1", "2", "3", "4"]); else { (a.need ||= {})[k] = n; return askNeed(+bot.step.slice(4) + 1); }
  } else if (bot.step === "days") {
    let d = /tutti|ogni giorno|sette/.test(x) ? [0, 1, 2, 3, 4, 5, 6] : /lun\w*\s*(-|a|–)\s*sab/.test(x) ? [0, 1, 2, 3, 4, 5] : /lun\w*\s*(-|a|–)\s*ven/.test(x) ? [0, 1, 2, 3, 4] : dayList(x);
    if (!d.length) say("Non ho capito i giorni. Scegli un pulsante o scrivi i giorni, per esempio «lun mar mer».", ["Tutti i giorni", "Lunedì–Sabato", "Lunedì–Venerdì"]);
    else { a.days = d; bot.step = "un"; say("Qualcuno non può lavorare in certi giorni? Scrivi il nome e i giorni, separando le persone con un punto e virgola (per esempio: «Giulia mer gio; Luca sab»). Oppure scegli Nessuno.", ["Nessuno"]); }
  } else if (bot.step === "un") {
    const team = people.filter((p) => p.department_id === a.dep.id && p.role === "staff"); a.un = {};
    if (!/^nessun/.test(x)) x.split(";").forEach((seg) => { const p = team.find((p) => seg.includes(norm(p.first_name))); const dd = dayList(seg); if (p) dd.forEach((i) => (a.un[p.id] ||= new Set()).add(i)); });
    return botBuild();
  } else if (bot.step === "done") {
    if (/tabella|apri/.test(x)) return go("turni"); say("Per aprire la proposta scegli «Apri la tabella», oppure scrivi «ricomincia».", ["Apri la tabella", "Ricomincia"]);
  }
  botPage();
}
function askNeed(i) {
  const a = bot.a; a.keys = a.dep.is_night ? ["N"] : ["M", "P"];
  if (i >= a.keys.length) { bot.step = "days"; say("In quali giorni serve questa copertura?", ["Tutti i giorni", "Lunedì–Sabato", "Lunedì–Venerdì"]); return botPage(); }
  bot.step = "need" + i; const k = a.keys[i], sh = SHT[k];
  say(`Quante persone servono di <b>${SHN[k]}</b> (${sh.s}–${sh.e}) in ${esc(a.dep.name)}?`, k === "N" ? ["1", "2"] : ["0", "1", "2", "3", "4"]); botPage();
}
function botBuild() {
  const a = bot.a, team = people.filter((p) => p.department_id === a.dep.id && p.role === "staff"), hours = {}, work = {}, gaps = [];
  team.forEach((p) => { hours[p.id] = 0; work[p.id] = Array(7).fill(null); });
  const restOk = (row, d, sh) => { const pv = row[d - 1]; if (!pv) return true; const end = pv.e <= pv.s ? pv.e : pv.e - 24; return sh.s - end >= 11; };
  const streakOk = (row, d) => { let n = 0; for (let i = d - 1; i >= 0 && row[i]; i--) n++; return n < 6; };
  for (let d = 0; d < 7; d++) { if (!a.days.includes(d)) continue;
    for (const k of a.keys) { const need = a.need[k] || 0, sh = SHT[k];
      const cand = team.filter((p) => !work[p.id][d] && !(a.un[p.id] || new Set()).has(d) && hours[p.id] + len2(sh) <= p.contract_hours && restOk(work[p.id], d, sh) && streakOk(work[p.id], d))
        .sort((x, y) => hours[x.id] - hours[y.id] || x.last_name.localeCompare(y.last_name));
      cand.slice(0, need).forEach((p) => { work[p.id][d] = sh; hours[p.id] += len2(sh); });
      if (cand.length < need) gaps.push(`${DN[d]} ${SHN[k]}: ${need - cand.length === 1 ? "manca 1 persona" : "mancano " + (need - cand.length) + " persone"}`); } }
  const ed = {}; team.forEach((p) => { for (let d = 0; d < 7; d++) ed[p.id + "|" + d] = work[p.id][d] || "R"; });
  pending = ed; bot.step = "done";
  say(`Ecco la proposta per <b>${esc(a.dep.name)}</b>, ${wkLabel(a.wk)}:<br>${team.map((p) => `${esc(p.first_name)} ${esc(p.last_name)}: <b>${hours[p.id]}</b> ore su ${p.contract_hours}`).join("<br>")}${gaps.length ? `<br><br><b>Da sistemare:</b><br>${gaps.join("<br>")}` : "<br><br>Tutta la copertura richiesta è assegnata."}<br><br>Rispetto 11 ore di riposo tra i turni, al massimo 6 giorni di fila e le ore da contratto. Aprila nella tabella per ritoccarla e poi salvala.`, ["Apri la tabella", "Ricomincia"]);
  botPage();
}

// ---- team, profili, codici
async function team() {
  const [{ data: dp }, { data: pe }] = await Promise.all([sb.from("departments").select("*").order("id"), sb.from("directory").select("*").order("last_name")]);
  show(`<h2>Team</h2>${(dp || []).map((d) => { const l = (pe || []).filter((p) => p.department_id === d.id); return l.length ? `<div class="card"><b>${esc(d.name)}</b>${l.map((p) => `<div>${esc(p.first_name)} ${esc(p.last_name)} <span class="mut">· ${esc(p.title || RN[p.role])}</span></div>`).join("")}</div>` : ""; }).join("")}`);
}
async function crea() {
  const { data: dp } = await sb.from("departments").select("name").neq("name", "Direzione").order("id");
  show(`<h2>Creazione profilo</h2><div class="card"><label>Nome<input id="n"></label><label>Cognome<input id="c"></label>
  <label>Ore da contratto (a settimana)<input id="h" type="number" min="1" max="60"></label><label>E-mail<input id="m" type="email" autocapitalize="none"></label>
  <label>Ruolo<select id="r"><option value="staff">Addetto</option><option value="manager">Responsabile di reparto</option></select></label>
  <label>Reparto<select id="d">${(dp || []).map((d) => `<option>${esc(d.name)}</option>`).join("")}</select></label>
  <button id="ok" style="margin-top:12px">Crea</button><p class="mut">Alla creazione l’app genera un codice di accesso riutilizzabile, che trovi in «Profili e codici».</p></div>`);
  $("#ok").onclick = async () => {
    const { data, error } = await sb.functions.invoke("invite-user", { body: { first_name: $("#n").value, last_name: $("#c").value, contract_hours: $("#h").value, email: $("#m").value, role: $("#r").value, department: $("#d").value } });
    let msg = data?.error; if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = "Operazione non riuscita"; } }
    alert(msg ? msg : data.sent ? "Profilo creato: e-mail inviata." : "Profilo creato. Il codice è in «Profili e codici».");
    if (!msg) go("codici");
  };
}
async function codici() {
  const { data } = await sb.from("invites").select("code_plain,profiles(first_name,last_name,email)").order("code_plain");
  show(`<h2>Profili e codici</h2><div class="card"><div class="mut">Link dell’app</div><b>${esc(location.origin + location.pathname)}</b></div>${(data || []).map((i) => `<div class="card"><b>${esc(i.profiles.first_name)} ${esc(i.profiles.last_name)}</b><div class="mut">${esc(i.profiles.email)}</div>
  <div>Codice: <b style="font-family:monospace;letter-spacing:1px">${esc(i.code_plain)}</b></div><div class="mut">Valido sempre, riutilizzabile</div></div>`).join("")}`);
}

$("#go").onclick = login; $("#code").onkeydown = (e) => e.key === "Enter" && login();
$("#out").onclick = async () => { await sb.auth.signOut(); me = null; document.body.classList.remove("dir"); boot(); };
const wide = () => window.matchMedia("(min-width:900px)").matches;
$("#menu").onclick = () => {
  if (wide()) { const c = document.body.classList.toggle("collapsed"); try { localStorage.setItem("side", c ? "0" : "1"); } catch (_) {} }
  else document.body.classList.toggle("open");
};
$("#scrim").onclick = () => document.body.classList.remove("open");
const toHome = () => me && go(isTop() ? "dash" : "home");
$("#homebtn").onclick = toHome; $("#logo").onclick = toHome;
try { if (localStorage.getItem("side") === "0") document.body.classList.add("collapsed"); } catch (_) {}
// Passata la mezzanotte di domenica la pagina si aggiorna: la settimana prossima diventa quella corrente e la nuova prossima è vuota.
const tick = () => { if (!me) return; const k = iso(mondayOf(0)); if (k !== curWeek) { curWeek = k; wk = 0; go(tab); } };
setInterval(tick, 60000); document.addEventListener("visibilitychange", tick);
boot();

