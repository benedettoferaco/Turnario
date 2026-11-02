const sb = supabase.createClient(CONFIG.url, CONFIG.anon);
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RN = { admin: "Account tecnico", director: "Direttore", manager: "Responsabile di reparto", staff: "Addetto" };
const hm = (d) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const day = (d) => new Date(d).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
let me = null, tab = "home";
const isMgr = () => ["manager", "director", "admin"].includes(me.role), isTop = () => ["director", "admin"].includes(me.role);

function weekRange() { const n = new Date(); n.setHours(0, 0, 0, 0); n.setDate(n.getDate() - ((n.getDay() + 6) % 7)); const e = new Date(n); e.setDate(e.getDate() + 7); return [n, e]; }

async function login() {
  $("#err").textContent = "";
  const { data, error } = await sb.functions.invoke("login-with-code", { body: { code: $("#code").value } });
  if (error || !data?.token_hash) { $("#err").textContent = "Codice non valido o scaduto."; return; }
  const r = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
  if (r.error) { $("#err").textContent = "Accesso non riuscito. Riprova."; return; }
  boot();
}
async function boot() {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) { $("#login").hidden = false; $("#app").hidden = true; return; }
  const { data } = await sb.from("profiles").select("*").eq("id", s.session.user.id).single();
  if (!data) { await sb.auth.signOut(); return boot(); }
  me = data; $("#login").hidden = true; $("#app").hidden = false; go("home");
}
function go(t) {
  tab = t;
  const items = [["home", "Home"], ...(isMgr() ? [["turni", "Turni"]] : []), ["team", "Team"], ...(isTop() ? [["crea", "Crea profilo"], ["codici", "Profili e codici"]] : [])];
  $("#nav").innerHTML = items.map(([k, l]) => `<button class="${k === tab ? "on" : ""}" data-t="${k}">${l}</button>`).join("");
  $("#nav").querySelectorAll("button").forEach((b) => (b.onclick = () => go(b.dataset.t)));
  ({ home, turni, team, crea, codici })[tab]();
}
const show = (h) => ($("#main").innerHTML = h);

async function home() {
  const [a, b] = weekRange();
  const [{ data: sh }, { data: nt }] = await Promise.all([
    sb.from("shifts").select("*").eq("profile_id", me.id).gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()).order("starts_at"),
    sb.from("notices").select("*").is("read_at", null).order("created_at", { ascending: false }),
  ]);
  show(`<h2>Ciao ${esc(me.first_name)}</h2><p class="mut">${RN[me.role]}</p>
  ${(nt || []).map((n) => `<div class="card" style="border-color:var(--r)"><b>Avviso</b><div>${esc(n.body)}</div><button class="alt" data-n="${n.id}">Ho letto</button></div>`).join("")}
  <h2>La tua settimana</h2>${(sh || []).map((s) => `<div class="card row"><b style="width:90px">${day(s.starts_at)}</b><span>${hm(s.starts_at)}–${hm(s.ends_at)}</span></div>`).join("") || `<p class="mut">Nessun turno questa settimana.</p>`}`);
  $("#main").querySelectorAll("[data-n]").forEach((b) => (b.onclick = async () => { await sb.from("notices").update({ read_at: new Date().toISOString() }).eq("id", b.dataset.n); home(); }));
}
async function turni() {
  const [a, b] = weekRange();
  const [{ data: sh }, { data: pe }] = await Promise.all([
    sb.from("shifts").select("*,profiles(first_name,last_name)").gte("starts_at", a.toISOString()).lt("starts_at", b.toISOString()).order("starts_at"),
    sb.from("profiles").select("id,first_name,last_name").eq("active", true).order("last_name"),
  ]);
  show(`<h2>Turni della settimana</h2><div class="tw"><table><tr><th>Persona</th><th>Giorno</th><th>Orario</th></tr>${(sh || []).map((s) => `<tr><td>${esc(s.profiles.first_name)} ${esc(s.profiles.last_name)}</td><td>${day(s.starts_at)}</td><td>${hm(s.starts_at)}–${hm(s.ends_at)}</td></tr>`).join("")}</table></div>
  <h2>Nuovo turno</h2><div class="card"><label>Persona<select id="p">${(pe || []).map((p) => `<option value="${p.id}">${esc(p.first_name)} ${esc(p.last_name)}</option>`).join("")}</select></label>
  <label>Giorno<input id="d" type="date"></label><div class="row"><label style="flex:1">Inizio<input id="s" type="time" step="1800"></label><label style="flex:1">Fine<input id="e" type="time" step="1800"></label></div>
  <p class="mut">Fuori dal reparto Notte nessun turno può finire dopo le 22:00.</p><button id="add">Salva turno</button></div>`);
  $("#add").onclick = async () => {
    const d = $("#d").value, s = $("#s").value, e = $("#e").value; if (!d || !s || !e) return alert("Compila giorno, inizio e fine.");
    let end = new Date(`${d}T${e}`); const start = new Date(`${d}T${s}`); if (end <= start) end.setDate(end.getDate() + 1);
    const { error } = await sb.from("shifts").insert({ profile_id: $("#p").value, starts_at: start.toISOString(), ends_at: end.toISOString(), created_by: me.id });
    if (error) alert(error.message); else turni();
  };
}
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
  <button id="ok" style="margin-top:12px">Crea</button><p class="mut">Alla creazione l’app invia all’e-mail un codice di accesso monouso e il link dell’app.</p></div>`);
  $("#ok").onclick = async () => {
    const { data, error } = await sb.functions.invoke("invite-user", { body: { first_name: $("#n").value, last_name: $("#c").value, contract_hours: $("#h").value, email: $("#m").value, role: $("#r").value, department: $("#d").value } });
    let msg = data?.error; if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = "Operazione non riuscita"; } }
    alert(msg ? msg : data.sent ? "Profilo creato: e-mail inviata." : "Profilo creato. L’e-mail non è stata inviata: il codice è in «Profili e codici».");
    if (!msg) go("codici");
  };
}
async function codici() {
  const { data } = await sb.from("invites").select("code_plain,expires_at,used_at,profiles(first_name,last_name,email)").order("expires_at", { ascending: false });
  show(`<h2>Profili e codici</h2><div class="card"><div class="mut">Link dell’app</div><b>${esc(location.origin + location.pathname)}</b></div>${(data || []).map((i) => `<div class="card"><b>${esc(i.profiles.first_name)} ${esc(i.profiles.last_name)}</b><div class="mut">${esc(i.profiles.email)}</div>
  ${i.used_at ? `<div class="mut">Codice già usato</div>` : `<div>Codice: <b style="font-family:monospace;letter-spacing:1px">${esc(i.code_plain)}</b></div><div class="mut">Scade il ${day(i.expires_at)}</div>`}</div>`).join("")}`);
}

$("#go").onclick = login; $("#code").onkeydown = (e) => e.key === "Enter" && login();
$("#code").oninput = (e) => {
  const v = e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12);
  e.target.value = v.match(/.{1,4}/g)?.join("-") || "";
};
v.slice(0, 4) + "-" + v.slice(4) : v; };
$("#out").onclick = async () => { await sb.auth.signOut(); me = null; boot(); };
boot();
