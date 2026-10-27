import { createStore } from "./db.js";
import { todayISO, isOil, currentKm, oilStatus, whenText } from "./logic.js";

const $ = s => document.querySelector(s);
const FUELS = ["Bensiini", "Diesel", "Hybridi", "Ladattava hybridi", "Sähkö", "Kaasu", "Muu"];
const KM_STEPS = [5000, 7500, 10000, 15000, 20000, 30000];
const SERVICE_TYPES = ["Öljynvaihto", "Renkaiden vaihto", "Katsastus", "Määräaikaishuolto", "Jarruhuolto", "Akun vaihto",
  "Jakohihnan vaihto", "Ilmastointihuolto", "Korjaus"];

const state = { user: null, cars: [], readings: [], services: [], view: "list", carId: null, sheet: null, confirm: null, authMode: "in" };
let store;

/* ---------- apurit ---------- */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nbsp = s => s.replace(/[  ]/g, " ");
const fmtKm = n => n == null || n === "" ? "" : nbsp(Math.round(Number(n)).toLocaleString("fi-FI"));
const fmtEur = n => n == null || n === "" ? "" : nbsp(Number(n).toLocaleString("fi-FI", { maximumFractionDigits: 2 })) + " €";
const num = v => { const s = String(v ?? "").replace(/\s/g, "").replace(",", "."); return s === "" || isNaN(+s) ? null : +s; };
const carTitle = c => [c.make, c.model].filter(Boolean).join(" ") || "Nimetön auto";
const curKm = c => currentKm(c.id, state.readings, state.services);
const oil = c => oilStatus(c, state.readings, state.services);
const plate = p => p ? `<span class="plate"><span>${esc(p)}</span></span>` : "";

async function reload() {
  const d = await store.load();
  Object.assign(state, d);
  if (state.view === "car" && !state.cars.find(c => c.id === state.carId)) { state.view = "list"; state.carId = null; }
  render();
}
function errText(err) {
  const m = String(err?.message || err || "");
  if (/Invalid login/i.test(m)) return "Sähköposti tai salasana on väärin.";
  if (/already registered/i.test(m)) return "Tällä sähköpostilla on jo tunnus. Kirjaudu sisään.";
  if (/at least 6/i.test(m)) return "Salasanan pitää olla vähintään 6 merkkiä.";
  if (/Email not confirmed/i.test(m)) return "Vahvista ensin sähköpostiosoite sähköpostiin tulleesta linkistä.";
  if (/fetch|network/i.test(m)) return "Ei yhteyttä palvelimeen. Tarkista verkkoyhteys.";
  return "Jokin meni pieleen: " + m;
}

/* ---------- näkymät ---------- */
function odo(km) {
  if (km == null) return `<span class="muted">Ei mittarilukemaa</span>`;
  const s = String(Math.round(km)).padStart(6, "0");
  return `<span class="odo" aria-label="${fmtKm(km)} kilometriä">${[...s].map((c, i) => `<span class="${i === s.length - 1 ? "last" : ""}">${c}</span>`).join("")}</span><span class="odo-unit">KM</span>`;
}

function oilBlock(car, big) {
  const s = oil(car); if (!s) return "";
  const label = { ok: "Kunnossa", soon: "Pian", late: "Myöhässä", none: "Ei tietoa" }[s.level];
  let text;
  if (s.level === "none") text = `Vaihtoväli ${fmtKm(s.interval)} km. Merkitse viimeisin öljynvaihto, niin muistutus alkaa toimia.`;
  else {
    const parts = [];
    if (s.dueKm != null) parts.push(`Seuraava vaihto <b class="num">${fmtKm(s.dueKm)}</b> km kohdalla` +
      (s.left != null ? (s.left >= 0 ? `, jäljellä <b class="num">${fmtKm(s.left)}</b> km.` : `, ylitetty <b class="num">${fmtKm(-s.left)}</b> km.`) : "."));
    if (s.level === "late") parts.push(`<b>Öljyt kannattaa vaihtaa nyt.</b>`);
    else if (s.est) parts.push(`Vaihto ${whenText(s.est)} <span class="muted">(${s.reason === "km" ? `ajat noin ${fmtKm(s.rate * 30.4)} km/kk` : `${s.months} kk edellisestä vaihdosta`})</span>.`);
    if (big && !s.rate && s.dueKm != null) parts.push(`<span class="muted">Päivitä mittarilukema välillä, niin arvio ajankohdasta tarkentuu.</span>`);
    text = parts.join(" ");
  }
  return `<div class="oil">
    <div class="oil-head"><span class="eyebrow">Öljynvaihto · ${fmtKm(s.interval)} km${s.months ? " / " + s.months + " kk" : ""}</span><span class="pill ${s.level}">${label}</span></div>
    ${s.level !== "none" ? `<div class="bar" role="img" aria-label="Vaihtovälistä käytetty ${Math.round(s.pct * 100)} %"><i class="${s.level}" style="width:${Math.max(3, s.pct * 100)}%"></i></div>` : ""}
    <div class="oil-text">${text}</div></div>`;
}

function renderAuth() {
  const up = state.authMode === "up";
  $("#view").innerHTML = `<form class="panel auth stack" id="authForm">
    <h2>${up ? "Luo tunnus" : "Kirjaudu sisään"}</h2>
    <p class="muted">${up ? "Tunnuksella autosi ja huoltosi ovat samat puhelimessa ja tietokoneella." : "Kirjaudu, niin näet autosi kaikilla laitteillasi."}</p>
    <label>Sähköposti<input id="aEmail" type="email" autocomplete="email" required></label>
    <label>Salasana<input id="aPass" type="password" autocomplete="${up ? "new-password" : "current-password"}" minlength="6" required></label>
    <p class="err" id="aErr" hidden></p><p class="ok-msg" id="aOk" hidden></p>
    <div class="row"><button class="btn-primary" type="submit">${up ? "Luo tunnus" : "Kirjaudu"}</button>
      <button type="button" class="btn-ghost" data-act="authswap">${up ? "Minulla on jo tunnus" : "Luo uusi tunnus"}</button></div>
    ${up ? "" : `<button type="button" class="btn-ghost small" data-act="forgot" style="align-self:flex-start">Unohtuiko salasana?</button>`}
  </form>`;
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const email = $("#aEmail").value.trim(), pass = $("#aPass").value;
    const err = $("#aErr"), ok = $("#aOk"); err.hidden = ok.hidden = true;
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      if (up) {
        const r = await store.signUp(email, pass);
        if (r.needsConfirm) { ok.textContent = "Tunnus luotu. Vahvista sähköpostiosoite sähköpostiin tulleesta linkistä ja kirjaudu sitten sisään."; ok.hidden = false; state.authMode = "in"; }
      } else await store.signIn(email, pass);
    } catch (x) { err.textContent = errText(x); err.hidden = false; }
    finally { if (btn) btn.disabled = false; }
  };
}

function renderList() {
  const order = { late: 0, soon: 1, none: 2, ok: 3 };
  const cars = [...state.cars].sort((a, b) => (order[oil(a)?.level] ?? 4) - (order[oil(b)?.level] ?? 4));
  $("#view").innerHTML = `<div class="stack">
    <div class="row between"><h2>${state.cars.length ? `Autot (${state.cars.length})` : "Ei vielä autoja"}</h2>
      <button class="btn-primary" data-act="newcar">+ Lisää auto</button></div>
    ${state.cars.length ? `<div class="cards">${cars.map(c => `
      <article class="card" tabindex="0" role="button" data-open="${c.id}" aria-label="Avaa ${esc(carTitle(c))}">
        <div class="card-top"><div><h3>${esc(carTitle(c))}</h3>
          <div class="sub">${[c.year, c.fuel, c.engine].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</div></div>${plate(c.plate)}</div>
        <div>${odo(curKm(c))}</div>
        ${oilBlock(c, false)}
      </article>`).join("")}</div>`
    : `<div class="empty">Lisää ensimmäinen auto: merkki, malli, rekisterinumero, mittarilukema ja öljynvaihtoväli. Jos kerrot milloin öljyt viimeksi vaihdettiin, sovellus laskee seuraavan vaihdon heti.</div>`}
  </div>`;
}

function renderCar() {
  const c = state.cars.find(x => x.id === state.carId);
  if (!c) { state.view = "list"; return renderList(); }
  const list = state.services.filter(s => s.carId === c.id)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.km || 0) - (a.km || 0));
  const total = list.reduce((s, e) => s + (e.cost || 0), 0);
  const facts = [["Merkki", c.make], ["Malli", c.model], ["Vuosimalli", c.year], ["Polttoaine", c.fuel], ["Moottori", c.engine],
    ["Moottoriöljy", c.oilSpec], ["Öljynvaihtoväli", c.fuel === "Sähkö" ? "" : `${fmtKm(c.oilKm || 15000)} km${c.oilMonths ? " tai " + c.oilMonths + " kk" : ""}`],
    ["Renkaat", c.tires], ["VIN", c.vin], ["Huollot yhteensä", total ? fmtEur(total) : ""]].filter(f => f[1]);
  const conf = state.confirm;
  $("#view").innerHTML = `<div class="stack" style="gap:18px">
    <button class="btn-ghost back" data-act="back">← Kaikki autot</button>
    <div class="detail-head"><div><div class="eyebrow">${esc([c.year, c.fuel].filter(Boolean).join(" · ")) || "Auto"}</div>
      <h2 style="font-size:1.9rem">${esc(carTitle(c))}</h2></div>
      <div class="row">${plate(c.plate)}${odo(curKm(c))}</div></div>
    <section class="panel">${oilBlock(c, true)}
      <div class="row">${c.fuel !== "Sähkö" ? `<button class="btn-primary" data-act="oil">Öljyt vaihdettu</button>` : ""}<button data-act="km">Päivitä mittarilukema</button></div></section>
    <section class="panel"><div class="row between"><h3>Perustiedot</h3><button data-act="editcar">Muokkaa</button></div>
      ${facts.length ? `<dl class="facts">${facts.map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join("")}</dl>` : `<p class="muted">Ei lisätietoja.</p>`}
      ${c.notes ? `<p class="desc">${esc(c.notes)}</p>` : ""}</section>
    <section class="panel"><div class="row between"><h3>Huoltohistoria</h3><button data-act="svc">+ Lisää huolto</button></div>
      ${list.length ? `<ul class="entries">${list.map(e => {
        const [y, m, d] = (e.date || "").split("-");
        return `<li class="entry ${isOil(e) ? "oilrow" : ""}">
        <div class="stamp">${y ? `<div class="d">${+d}.${+m}.</div><div class="y">${y}</div>` : `<div class="d">—</div>`}</div>
        <div><h3>${esc(e.type || "Huolto")}</h3>
          <div class="meta">${e.km != null ? `<span><span class="num">${fmtKm(e.km)}</span> km</span>` : ""}${e.cost != null ? `<span class="num">${fmtEur(e.cost)}</span>` : ""}${e.place ? `<span>${esc(e.place)}</span>` : ""}</div>
          ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ""}
          <div class="row"><button data-edit="${e.id}">Muokkaa</button>${conf === e.id
            ? `<button class="btn-danger" data-del="${e.id}">Vahvista poisto</button><button data-act="nodel">Peru</button>`
            : `<button data-ask="${e.id}">Poista</button>`}</div>
        </div></li>`; }).join("")}</ul>` : `<p class="muted">Ei vielä merkintöjä.</p>`}</section>
    <div class="row">${conf === "car"
      ? `<span>Poistetaanko auto ja sen ${list.length} merkintää?</span><button class="btn-danger" data-act="delcar">Poista auto</button><button data-act="nodel">Peru</button>`
      : `<button class="btn-danger" data-act="askcar">Poista auto</button>`}</div>
  </div>`;
}

function render() {
  $("#storeNote").textContent = store?.mode === "local" ? "Demotila: tiedot vain tässä selaimessa" : (state.user?.email || "");
  $("#menuBtn").hidden = !state.user;
  if (!state.user) { state.sheet = null; renderSheet(); return renderAuth(); }
  renderSheet();
  state.view === "car" ? renderCar() : renderList();
}

/* ---------- lomakkeet ---------- */
function intervalSelect(val) {
  const v = val || 15000, custom = !KM_STEPS.includes(v);
  return `<label>Öljynvaihtoväli<select id="fOilKm">${KM_STEPS.map(k => `<option value="${k}" ${k === v ? "selected" : ""}>${fmtKm(k)} km</option>`).join("")}
    <option value="custom" ${custom ? "selected" : ""}>Muu…</option></select></label>
    <label id="customWrap" ${custom ? "" : "hidden"}>Oma väli (km)<input id="fOilKmCustom" class="num" inputmode="numeric" value="${custom ? v : ""}"></label>`;
}

function renderSheet() {
  const h = $("#sheetHost"), s = state.sheet;
  if (!s) { h.innerHTML = ""; return; }
  const c = state.cars.find(x => x.id === state.carId);
  let body = "";
  if (s.type === "settings") {
    body = `<h2>Asetukset</h2>
      <p>${store.mode === "local" ? "Demotila: tiedot tallentuvat vain tähän selaimeen. Lisää Supabase-tiedot config.js-tiedostoon, niin saat synkronoinnin." : `Kirjautuneena: <b>${esc(state.user.email)}</b>`}</p>
      <div class="row"><button type="button" data-act="export">Lataa varmuuskopio (JSON)</button>
      ${store.mode === "cloud" ? `<button type="button" class="btn-danger" data-act="signout">Kirjaudu ulos</button>` : ""}</div>`;
    h.innerHTML = `<div class="sheet">${body}<div class="row"><button type="button" class="btn-ghost" data-act="close">Sulje</button></div></div>`;
    return;
  }
  if (s.type === "car") {
    const x = s.edit ? c : {}; const m = x.oilMonths === undefined || x.oilMonths === null ? (s.edit ? 0 : 12) : x.oilMonths;
    body = `<h2>${s.edit ? "Muokkaa autoa" : "Lisää auto"}</h2><div class="grid">
      <label>Merkki<input id="fMake" value="${esc(x.make)}" placeholder="Skoda" autocomplete="off"></label>
      <label>Malli<input id="fModel" value="${esc(x.model)}" placeholder="Octavia" autocomplete="off"></label>
      <label>Rekisterinumero<input id="fPlate" value="${esc(x.plate)}" placeholder="ABC-123" autocapitalize="characters" autocomplete="off"></label>
      <label>Vuosimalli<input id="fYear" class="num" inputmode="numeric" value="${esc(x.year)}" placeholder="2017"></label>
      <label>Polttoaine<select id="fFuel">${FUELS.map(f => `<option ${f === (x.fuel || "Bensiini") ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label>Moottori<input id="fEngine" value="${esc(x.engine)}" placeholder="1.6 TDI 85 kW"></label>
      <label>Moottoriöljy<input id="fOilSpec" value="${esc(x.oilSpec)}" placeholder="5W-30, 4,3 l"></label>
      <label>Renkaat<input id="fTires" value="${esc(x.tires)}" placeholder="205/55 R16"></label>
      <label>VIN<input id="fVin" value="${esc(x.vin)}" autocapitalize="characters"></label>
      ${s.edit ? "" : `<label>Mittarilukema nyt (km)<input id="fKm" class="num" inputmode="numeric"></label>`}
      ${intervalSelect(x.oilKm)}
      <label>Tai viimeistään<select id="fOilMonths">${[[6, "6 kk"], [12, "12 kk"], [18, "18 kk"], [24, "24 kk"], [0, "Ei aikarajaa"]]
        .map(([v, t]) => `<option value="${v}" ${v === (m || 0) ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${s.edit ? "" : `<div class="group-title">Edellinen öljynvaihto (vapaaehtoinen)</div>
      <label>Mittarilukema (km)<input id="fLastKm" class="num" inputmode="numeric"></label>
      <label>Päivämäärä<input id="fLastDate" type="date"></label>`}
      <label class="full">Muistiinpanot<textarea id="fNotes" rows="2">${esc(x.notes)}</textarea></label></div>`;
  } else if (s.type === "km") {
    body = `<h2>Päivitä mittarilukema</h2><p class="muted">${esc(carTitle(c))}, nyt ${fmtKm(curKm(c)) || "–"} km</p><div class="grid">
      <label>Mittarilukema (km)<input id="fKm" class="num" inputmode="numeric"></label>
      <label>Päivämäärä<input id="fDate" type="date" value="${todayISO()}"></label></div>`;
  } else {
    const e = s.edit ? state.services.find(x => x.id === s.edit) : {}; const isOilForm = s.type === "oil";
    body = `<h2>${s.edit ? "Muokkaa merkintää" : isOilForm ? "Öljyt vaihdettu" : "Lisää huolto"}</h2><div class="grid">
      ${isOilForm ? "" : `<label class="full">Toimenpide<input id="fType" list="types" value="${esc(e.type)}" placeholder="Renkaiden vaihto"></label>
      <datalist id="types">${SERVICE_TYPES.map(t => `<option value="${t}">`).join("")}</datalist>`}
      <label>Päivämäärä<input id="fDate" type="date" value="${e.date || todayISO()}"></label>
      <label>Mittarilukema (km)<input id="fKm" class="num" inputmode="numeric" value="${e.km ?? (isOilForm ? curKm(c) ?? "" : "")}"></label>
      <label>Hinta (€)<input id="fCost" class="num" inputmode="decimal" value="${e.cost ?? ""}"></label>
      <label>Paikka<input id="fPlace" value="${esc(e.place)}" placeholder="Korjaamo tai itse"></label>
      <label class="full">Lisätiedot<input id="fDesc" value="${esc(e.description)}" placeholder="${isOilForm ? esc(c?.oilSpec || "Öljy ja suodatin") : ""}"></label></div>`;
  }
  h.innerHTML = `<form class="sheet" id="sheet">${body}<p class="err" id="fErr" hidden></p>
    <div class="row"><button class="btn-primary" type="submit">Tallenna</button><button type="button" class="btn-ghost" data-act="close">Peru</button></div></form>`;
  const sel = $("#fOilKm"); if (sel) sel.onchange = () => { $("#customWrap").hidden = sel.value !== "custom"; };
  $("#sheet").onsubmit = submitSheet;
  h.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fail(msg) { const e = $("#fErr"); e.textContent = msg; e.hidden = false; }

async function submitSheet(ev) {
  ev.preventDefault();
  const s = state.sheet, val = id => ($(id)?.value ?? "").trim();
  const btn = ev.submitter; if (btn) btn.disabled = true;
  try {
    if (s.type === "car") {
      const make = val("#fMake"), model = val("#fModel");
      if (!make && !model) return fail("Anna vähintään merkki tai malli.");
      const oilKm = $("#fOilKm").value === "custom" ? num(val("#fOilKmCustom")) : +$("#fOilKm").value;
      if (!oilKm || oilKm < 500) return fail("Anna öljynvaihtoväli kilometreinä, esimerkiksi 12 000.");
      const car = { ...(s.edit ? state.cars.find(x => x.id === state.carId) : {}),
        make, model, plate: val("#fPlate").toUpperCase(), year: val("#fYear"), fuel: $("#fFuel").value, engine: val("#fEngine"),
        oilSpec: val("#fOilSpec"), tires: val("#fTires"), vin: val("#fVin").toUpperCase(), oilKm, oilMonths: +$("#fOilMonths").value, notes: val("#fNotes") };
      const id = await store.saveCar(car);
      if (!s.edit) {
        const km = num(val("#fKm"));
        if (km != null) await store.addReading(id, todayISO(), km);
        const lk = num(val("#fLastKm")), ld = val("#fLastDate");
        if (lk != null || ld) await store.saveService({ carId: id, isOil: true, type: "Öljynvaihto", date: ld || todayISO(), km: lk, cost: null, place: "", description: "" });
        state.view = "car"; state.carId = id;
      }
    } else if (s.type === "km") {
      const km = num(val("#fKm")); if (km == null) return fail("Anna mittarilukema.");
      await store.addReading(state.carId, val("#fDate") || todayISO(), km);
    } else {
      const isOilForm = s.type === "oil", prev = s.edit ? state.services.find(x => x.id === s.edit) : null;
      const type = isOilForm ? "Öljynvaihto" : val("#fType") || "Huolto";
      const svc = { id: s.edit || undefined, carId: state.carId, isOil: isOilForm || /öljynvaihto/i.test(type), type, date: val("#fDate") || todayISO(),
        km: num(val("#fKm")), cost: num(val("#fCost")), place: val("#fPlace"), description: val("#fDesc"), createdAt: prev?.createdAt };
      if (isOilForm && svc.km == null) return fail("Anna mittarilukema, jotta seuraava vaihto voidaan laskea.");
      await store.saveService(svc);
    }
    state.sheet = null;
    await reload();
  } catch (err) { fail(errText(err)); }
  finally { if (btn) btn.disabled = false; }
}

/* ---------- tapahtumat ---------- */
document.addEventListener("click", async e => {
  const card = e.target.closest("[data-open]"), b = e.target.closest("button");
  if (card && !b) { state.view = "car"; state.carId = card.dataset.open; state.confirm = null; state.sheet = null; render(); scrollTo(0, 0); return; }
  if (!b) return;
  const a = b.dataset.act;
  try {
    if (a === "authswap") { state.authMode = state.authMode === "up" ? "in" : "up"; renderAuth(); }
    else if (a === "forgot") {
      const email = $("#aEmail").value.trim(), err = $("#aErr"), ok = $("#aOk"); err.hidden = ok.hidden = true;
      if (!email) { err.textContent = "Kirjoita ensin sähköpostiosoitteesi."; err.hidden = false; return; }
      await store.resetPassword(email); ok.textContent = "Lähetimme salasanan palautuslinkin sähköpostiisi."; ok.hidden = false;
    }
    else if (a === "newcar") { state.sheet = { type: "car" }; renderSheet(); }
    else if (a === "editcar") { state.sheet = { type: "car", edit: true }; renderSheet(); }
    else if (a === "oil" || a === "km" || a === "svc") { state.sheet = { type: a }; renderSheet(); }
    else if (a === "close") { state.sheet = null; renderSheet(); }
    else if (a === "back") { state.view = "list"; state.carId = null; state.sheet = null; state.confirm = null; render(); }
    else if (a === "nodel") { state.confirm = null; render(); }
    else if (a === "askcar") { state.confirm = "car"; render(); }
    else if (a === "delcar") { const id = state.carId; state.view = "list"; state.carId = null; state.confirm = null; await store.deleteCar(id); await reload(); }
    else if (a === "signout") { state.sheet = null; await store.signOut(); }
    else if (a === "export") exportBackup();
    else if (b.dataset.ask) { state.confirm = b.dataset.ask; render(); }
    else if (b.dataset.del) { state.confirm = null; await store.deleteService(b.dataset.del); await reload(); }
    else if (b.dataset.edit) {
      const en = state.services.find(x => x.id === b.dataset.edit);
      state.sheet = { type: en && en.isOil && en.type === "Öljynvaihto" ? "oil" : "svc", edit: b.dataset.edit }; renderSheet();
    }
  } catch (err) { alert(errText(err)); }
});
document.addEventListener("keydown", e => {
  const c = e.target.closest?.("[data-open]");
  if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.click(); }
});
$("#menuBtn").onclick = () => { state.sheet = { type: "settings" }; renderSheet(); };

function exportBackup() {
  const data = { exported: new Date().toISOString(), cars: state.cars, readings: state.readings, services: state.services };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `autotalli-${todayISO()}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- käynnistys ---------- */
(async () => {
  try {
    store = await createStore();
    state.user = await store.user();
    store.onAuth(async u => {
      const changed = (u?.id || null) !== (state.user?.id || null);
      state.user = u;
      if (!u) { Object.assign(state, { cars: [], readings: [], services: [], view: "list", carId: null }); render(); }
      else if (changed) await reload();
    });
    if (state.user) await reload(); else render();
  } catch (err) {
    $("#view").innerHTML = `<div class="empty">${esc(errText(err))}</div>`;
  }
  // Päivitä näkymä kun sovellus palaa taustalta (esim. toinen laite on muuttanut tietoja).
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.user && !state.sheet) reload().catch(() => {}); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
