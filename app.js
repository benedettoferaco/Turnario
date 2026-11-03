const sb = supabase.createClient(CONFIG.url, CONFIG.anon);
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RN = { admin: "Account tecnico", director: "Direttore", manager: "Responsabile di reparto", staff: "Addetto" };
const DN = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
let me = null, tab = "home", wk = 0, people = [], deps = [], plan = {}, edits = {}, curWeek = "";
const isMgr = () => ["manager", "director", "admin"].includes(me.role), isTop = () => ["director", "admin"].includes(me.role);

// ---- date: le settimane vanno da lunedì a domenica
const mondayOf = (o = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * o); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fmt = (d) => d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
const wkLabel = (o) => fmt(mondayOf(o)) + " – " + fmt(addDays(mondayOf(o), 6));
const hh = (s) => (s.s) + "–" + (s.e);
const hm = (d) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const day = (d) => new Date(d).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
// turno -> ore intere (inizio, fine); fine > 24 significa il giorno dopo
const toHours = (s) => { const a = new Date(s.starts_at), b = new Date(s.ends_at), st = a.getHours(), e = st + Math.round((b - a) / 36e5); return { s: st, e: e > 24 ? e - 24 : e }; };
const dayIdx = (s, o) => Math.round((new Date(new Date(s.starts_at).getFullYear(), new Date(s.starts_at).getMonth(), new Date(s.starts_at).getDate()) - mondayOf(o)) / 864e5);

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
  document.body.classList.toggle("side", isTop());
  const { data: d } = await sb.from("departments").select("*").order("id"); deps = d || [];
  go("home");
}

// ---- navigazione: barra laterale per direttore e account tecnico, barra in basso per gli altri
function go(t) {
  tab = t; document.body.classList.remove("open");
  const items = [["home", "Home"], ...(isMgr() ? [["turni", "Turni"]] : []), ["team", "Team"], ...(isTop() ? [["crea", "Crea profilo"], ["codici", "Profili e codici"]] : [])];
  if (isTop()) {
    $("#side").innerHTML = `<div style="margin-bottom:12px"><b>${esc(me.first_name)} ${esc(me.last_name)}</b><div class="mut">${RN[me.role]}</div></div>
      <button class="si big" data-t="crea-turni">+ Crea turni</button>` + items.map(([k, l]) => `<button class="si ${k === tab ? "on" : ""}" data-t="${k}">${l}</button>`).join("");
    $("#side").querySelectorAll("button").forEach((b) => (b.onclick = () => (b.dataset.t === "crea-turni" ? (wk = 1, go("turni")) : go(b.dataset.t))));
  } else {
    $("#nav").innerHTML = items.map(([k, l]) => `<button class="${k === tab ? "on" : ""}" data-t="${k}">${l}</button>`).join("");
    $("#nav").querySelectorAll("button").forEach((b) => (b.onclick = () => go(b.dataset.t)));
  }
  ({ home, turni, team, crea, codici })[tab]();
}
const show = (h) => ($("#main").innerHTML = h);

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
  $("#back").onclick = () => go("home");
}
async function home() {
  const a = mondayOf(0), b = addDays(a, 7);
  const [{ data: sh }, { data: nt }] = await Promise.all([
    sb.from("shifts").select("*").eq("profile_id", me.id).gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()).order("starts_at"),
    sb.from("notices").select("*").is("read_at", null).order("created_at", { ascending: false }),
  ]);
  show(`<h2>Ciao ${esc(me.first_name)}</h2><p class="mut">${RN[me.role]}</p>
  ${(nt || []).map((n) => `<div class="card" style="border-color:var(--r)"><b>Avviso</b><div>${esc(n.body)}</div><button class="alt" data-n="${n.id}">Ho letto</button></div>`).join("")}
  <h2>La tua settimana</h2><p class="mut">${wkLabel(0)}</p>${(sh || []).map((s) => `<div class="card row"><b style="width:90px">${day(s.starts_at)}</b><span>${hh(toHours(s))}</span></div>`).join("") || `<p class="mut">Nessun turno questa settimana.</p>`}
  <button id="nx">Turni della prossima settimana</button>`);
  $("#nx").onclick = nextView;
  $("#main").querySelectorAll("[data-n]").forEach((b) => (b.onclick = async () => { await sb.from("notices").update({ read_at: new Date().toISOString() }).eq("id", b.dataset.n); home(); }));
}
const depOf = (p) => deps.find((d) => d.id === p.department_id) || {};
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
  show(`<h2>Turni</h2><div class="chips"><button class="${wk === 0 ? "" : "alt"}" id="w0">Questa settimana</button><button class="${wk === 1 ? "" : "alt"}" id="w1">Turni della prossima settimana</button></div>
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
      return `<td><button class="cell ${ch ? "chg" : ""} ${c === "R" || !c ? "rest" : ""}" data-p="${p.id}" data-i="${i}">${c === "R" ? "Riposo" : c ? hh(c) : "—"}</button></td>`; }).join("")}</tr>`).join("");
  $("#grid").querySelectorAll(".cell").forEach((b) => (b.onclick = () => openCell(b.dataset.p, +b.dataset.i)));
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
  const mon = mondayOf(wk), errs = [], depsDone = new Set(); let n = 0;
  for (const k of Object.keys(edits)) {
    const [pid, di] = k.split("|"), v = edits[k], c = plan[pid]?.[di], p = people.find((x) => x.id === pid);
    if (c?.ids?.length) { const r = await sb.from("shifts").delete().in("id", c.ids); if (r.error) { errs.push(r.error.message); continue; } }
    if (v !== "R") {
      const d = addDays(mon, +di), st = new Date(d); st.setHours(v.s, 0, 0, 0);
      const en = new Date(v.e > v.s ? d : addDays(d, 1)); en.setHours(v.e, 0, 0, 0);
      const r = await sb.from("shifts").insert({ profile_id: pid, starts_at: st.toISOString(), ends_at: en.toISOString(), created_by: me.id });
      if (r.error) errs.push(`${p.first_name} ${DN[di]}: ${r.error.message}`); else { n++; depsDone.add(p.department_id); }
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
$("#out").onclick = async () => { await sb.auth.signOut(); me = null; document.body.classList.remove("side"); boot(); };
$("#menu").onclick = () => document.body.classList.toggle("open"); $("#scrim").onclick = () => document.body.classList.remove("open");
// Passata la mezzanotte di domenica la pagina si aggiorna: la settimana prossima diventa quella corrente e la nuova prossima è vuota.
const tick = () => { if (!me) return; const k = iso(mondayOf(0)); if (k !== curWeek) { curWeek = k; wk = 0; go(tab); } };
setInterval(tick, 60000); document.addEventListener("visibilitychange", tick);
boot();

