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
  document.body.classList.toggle("dir", isTop());
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
function go(t) {
  tab = t; document.body.classList.remove("open");
  if (isTop()) {
    $("#side").innerHTML = `<div class="row" style="flex-wrap:nowrap;margin-bottom:12px"><span class="av">${esc(ini(me))}</span><div><b>${esc(me.first_name)} ${esc(me.last_name)}</b><div class="mut">${RN[me.role]}</div></div></div>
      <button class="btn" style="width:100%;margin-bottom:10px" data-t="crea-turni">+ Crea turni</button>` +
      SIDE.map(([k, l]) => `<button class="si ${k === tab ? "on" : ""}" data-t="${k}"><span>${l}</span><span class="tag" id="b-${k}" hidden></span></button>`).join("");
    $("#side").querySelectorAll("button").forEach((b) => (b.onclick = () => goWeek(b.dataset.t)));
    badges();
  } else {
    const items = [["home", "Home"], ...(isMgr() ? [["turni", "Turni"]] : []), ["team", "Team"], ["profilo", "Profilo"]];
    $("#nav").innerHTML = items.map(([k, l]) => `<button class="${k === tab ? "on" : ""}" data-t="${k}">${l}</button>`).join("");
    $("#nav").querySelectorAll("button").forEach((b) => (b.onclick = () => go(b.dataset.t)));
  }
  ({ home, dash, turni, team, crea, codici, profilo, richieste: () => soon("Richieste e cambi turno"), cassa: () => soon("Chiusure di cassa"), bot: () => soon("Assistente turni"), chat: () => soon("Chat") })[tab]();
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
async function turni() {
  const a = mondayOf(wk), b = addDays(a, 7); edits = {}; plan = {};
  const [{ data: sh }, { data: pe }, { data: wp }] = await Promise.all([
    sb.from("shifts").select("*").gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()),
    sb.from("profiles").select("id,first_name,last_name,department_id,role").eq("active", true).neq("role", "admin"),
    sb.from("week_plans").select("department_id").eq("week_start", iso(a)),
  ]);
  people = (pe || []).sort((x, y) => x.department_id - y.department_id || x.last_name.localeCompare(y.last_name));
  (sh || []).forEach((s) => { const i = dayIdx(s, wk); ((plan[s.profile_id] ||= {})[i] ||= { ...toHours(s), ids: [] }).ids.push(s.id); });
  const created = (wp || []).length > 0;
  show(`<h2>Turni</h2><div class="chips"><button class="${wk === 0 ? "on" : ""}" id="w0">Questa settimana</button><button class="${wk === 1 ? "on" : ""}" id="w1">Turni della prossima settimana</button></div>
  <p class="mut">${wkLabel(wk)} · ${wk === 1 && !created ? "Turni ancora da creare: dopo il salvataggio diventano visibili al personale." : "Tocca una casella per cambiare l’orario (solo ore intere)."}</p>
  <div class="tw"><table id="grid"></table></div><button id="sv" style="margin-top:12px">Salva settimana</button>`);
  $("#w0").onclick = () => { wk = 0; turni(); }; $("#w1").onclick = () => { wk = 1; turni(); }; $("#sv").onclick = saveWeek;
  grid();
}
const cur = (pid, i) => edits[pid + "|" + i] ?? plan[pid]?.[i] ?? null;
function grid() {
  const a = mondayOf(wk);
  $("#grid").innerHTML = `<tr><th>Persona</th>${DN.map((d, i) => `<th>${d}<br><span class="mut">${addDays(a, i).getDate()}</span></th>`).join("")}</tr>` +
    people.map((p) => `<tr><td><b>${esc(p.first_name)} ${esc(p.last_name)}</b><div class="mut">${esc(depOf(p).name)}</div></td>${DN.map((_, i) => { const c = cur(p.id, i), ch = (p.id + "|" + i) in edits;
      return `<td><button class="s can ${cls(c)} ${ch ? "chg" : ""}" data-p="${p.id}" data-i="${i}">${c === "R" ? "Riposo" : c ? hh(c) : "—"}</button></td>`; }).join("")}</tr>`).join("");
  $("#grid").querySelectorAll(".s").forEach((b) => (b.onclick = () => openCell(b.dataset.p, +b.dataset.i)));
}
function openCell(pid, i) {
  const p = people.find((x) => x.id === pid), night = !!depOf(p).is_night, c = cur(pid, i), v = c && c !== "R" ? c : { s: 6, e: 14 };
  const opts = (lo, hi, sel) => { let o = ""; for (let h = lo; h <= hi; h++) o += `<option value="${h}" ${h === sel ? "selected" : ""}>${h}</option>`; return o; };
  const pre = [[6, 14], [14, 22], ...(night ? [[22, 6]] : [])];
  $("#dlg").innerHTML = `<b>${esc(p.first_name)} ${esc(p.last_name)}</b><div class="mut">${DN[i]} ${addDays(mondayOf(wk), i).getDate()}</div>
  <div class="row" style="margin:10px 0">${pre.map(([s, e]) => `<button class="alt" data-s="${s}" data-e="${e}">${s}–${e}</button>`).join("")}</div>
  <div class="row"><label style="flex:1">Dalle ore<select id="hs">${opts(0, 23, v.s)}</select></label><label style="flex:1">Alle ore<select id="he">${opts(1, night ? 24 : 22, Math.min(v.e, night ? 24 : 22))}</select></label></div>
  <p class="mut">${night ? "Reparto Notte: si può lavorare di notte." : "Fuori dal reparto Notte i turni finiscono entro le 22."}</p>
  <div class="row"><button id="ok">Imposta</button><button class="alt" id="rest">Riposo</button><button class="alt" id="no">Annulla</button></div>`;
  const set = (val) => { edits[pid + "|" + i] = val; $("#dlg").close(); grid(); };
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
$("#menu").onclick = () => document.body.classList.toggle("open"); $("#scrim").onclick = () => document.body.classList.remove("open");
// Passata la mezzanotte di domenica la pagina si aggiorna: la settimana prossima diventa quella corrente e la nuova prossima è vuota.
const tick = () => { if (!me) return; const k = iso(mondayOf(0)); if (k !== curWeek) { curWeek = k; wk = 0; go(tab); } };
setInterval(tick, 60000); document.addEventListener("visibilitychange", tick);
boot();


