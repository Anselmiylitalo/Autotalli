import { createStore } from "./db.js";
import { todayISO, isOil, currentKm, oilStatus, whenText } from "./logic.js";

const $ = s => document.querySelector(s);
const FUELS = ["Bensiini", "Diesel", "Hybridi", "Ladattava hybridi", "Sähkö", "Kaasu", "Muu"];
const KM_STEPS = [5000, 7500, 10000, 15000, 20000, 30000];
const SERVICE_TYPES = ["Öljynvaihto", "Renkaiden vaihto", "Katsastus", "Määräaikaishuolto", "Jarruhuolto", "Akun vaihto",
  "Jakohihnan vaihto", "Ilmastointihuolto", "Korjaus"];

const state = { user: null, cars: [], readings: [], services: [], view: "list", carId: null, sheet: null, confirm: null, authMode: "in",
  svc: { car: "all", year: "all", q: "", sort: "date", dir: "desc" } };
let store;

/* ---------- apurit ---------- */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nbsp = s => s.replace(/[  ]/g, " ");
const fmtKm = n => n == null || n === "" ? "" : nbsp(Math.round(Number(n)).toLocaleString("fi-FI"));
const fmtEur = n => { if (n == null || n === "") return ""; const v = Number(n), whole = Number.isInteger(v);
  return nbsp(v.toLocaleString("fi-FI", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })) + " €"; };
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
  if (/bucket not found|photo_path|row-level security/i.test(m)) return "Kuvien tallennusta ei ole vielä otettu käyttöön tietokannassa (aja kuvien SQL-koodi Supabasessa).";
  if (/kuva/i.test(m)) return m;
  return "Jokin meni pieleen: " + m;
}

/* ---------- kuvat ---------- */
// Pienentää kuvan pitkältä sivultaan enintään 1600 px:n JPEGiksi, jotta lataus on nopea myös mobiiliverkossa.
async function resizeImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Kuvaa ei voitu avata. Kokeile toista kuvaa.")); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = Object.assign(document.createElement("canvas"), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error("Kuvan käsittely epäonnistui.")), "image/jpeg", 0.82));
  } finally { URL.revokeObjectURL(url); }
}
const CAR_SVG = `<svg viewBox="0 0 240 110" aria-hidden="true"><path d="M18 78c0-9 5-14 14-16l30-7 26-21c6-5 12-7 20-7h50c9 0 15 3 21 9l20 19 18 4c8 2 13 8 13 16v9c0 4-3 6-6 6h-14a24 24 0 0 0-47 0H82a24 24 0 0 0-47 0H24c-4 0-6-2-6-6z" fill="currentColor" opacity=".9"/><circle cx="58" cy="86" r="17" fill="currentColor"/><circle cx="183" cy="86" r="17" fill="currentColor"/><circle cx="58" cy="86" r="7" fill="var(--track)"/><circle cx="183" cy="86" r="7" fill="var(--track)"/><path d="M98 33h34v22H74zM142 33h22c5 0 9 2 12 5l15 17h-49z" fill="var(--track)"/></svg>`;
function carPhoto(c, cls) {
  return c.photoUrl
    ? `<div class="photo ${cls}"><img src="${esc(c.photoUrl)}" alt="${esc(carTitle(c))}" loading="lazy"></div>`
    : `<div class="photo ${cls} placeholder">${CAR_SVG}</div>`;
}
const fileInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
document.body.append(fileInput);
fileInput.onchange = async () => {
  const f = fileInput.files[0]; fileInput.value = "";
  const c = state.cars.find(x => x.id === state.carId); if (!f || !c) return;
  const st = $("#photoStatus"); if (st) st.textContent = "Tallennetaan kuvaa…";
  try { await store.setPhoto(c, await resizeImage(f)); await reload(); }
  catch (err) { const s = $("#photoStatus"); if (s) s.textContent = errText(err); }
};

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

/* ---------- haku ---------- */
// Vertailu ilman kirjainkokoa, välilyöntejä ja viivoja, jotta "abc123" löytää kilven "ABC-123".
const norm = s => String(s ?? "").toLowerCase().replace(/[\s\-_.]/g, "");
const OIL_WORDS = { ok: "kunnossa", soon: "pian", late: "myöhässä", none: "eitietoa" };
function matches(c, q) {
  const hay = norm([c.make, c.model, c.plate, c.year, c.fuel, c.engine, c.oilSpec, c.tires, c.vin, c.notes,
    OIL_WORDS[oil(c)?.level] || ""].join(" "));
  // Jokaisen hakusanan pitää löytyä: "skoda 2017" löytää vain vuoden 2017 Skodat.
  return q.split(/\s+/).filter(Boolean).every(w => hay.includes(norm(w)));
}
function carCard(c) {
  return `<article class="card" tabindex="0" role="button" data-open="${c.id}" aria-label="Avaa ${esc(carTitle(c))}">
    ${carPhoto(c, "card-photo")}
    <div class="card-top"><div><h3>${esc(carTitle(c))}</h3>
      <div class="sub">${[c.year, c.fuel, c.engine].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</div></div>${plate(c.plate)}</div>
    <div>${odo(curKm(c))}</div>
    ${oilBlock(c, false)}
  </article>`;
}
// Päivittää vain korttialueen, jotta hakukenttä pitää fokuksen ja näppäimistö pysyy auki kirjoittaessa.
function renderCards() {
  const host = $("#cardsHost"); if (!host) return;
  const order = { late: 0, soon: 1, none: 2, ok: 3 };
  const q = (state.query || "").trim();
  const cars = [...state.cars].sort((a, b) => (order[oil(a)?.level] ?? 4) - (order[oil(b)?.level] ?? 4))
    .filter(c => !q || matches(c, q));
  $("#searchCount").textContent = q ? `${cars.length} / ${state.cars.length}` : "";
  $("#searchClear").hidden = !state.query;
  host.innerHTML = cars.length ? `<div class="cards">${cars.map(carCard).join("")}</div>`
    : `<div class="empty">Haulla ”${esc(q)}” ei löytynyt autoja. Kokeile esimerkiksi merkkiä, mallia tai rekisterinumeroa.
       <div class="row" style="margin-top:10px"><button class="small" data-act="clearsearch">Tyhjennä haku</button></div></div>`;
}

function renderList() {
  const has = state.cars.length > 0;
  $("#view").innerHTML = `<div class="stack">
    <div class="row between"><h2>${has ? `Autot (${state.cars.length})` : "Ei vielä autoja"}</h2>
      <button class="btn-primary" data-act="newcar">+ Lisää auto</button></div>
    ${has ? `<div class="search">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="search" type="search" placeholder="Hae merkillä, mallilla tai rekisterinumerolla" value="${esc(state.query || "")}"
          autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Hae autoja">
        <span class="search-count num" id="searchCount" aria-live="polite"></span>
        <button type="button" class="search-clear" id="searchClear" data-act="clearsearch" aria-label="Tyhjennä haku" hidden>×</button>
      </div>
      <div id="cardsHost"></div>`
    : `<div class="empty">Lisää ensimmäinen auto: merkki, malli, rekisterinumero, mittarilukema ja öljynvaihtoväli. Jos kerrot milloin öljyt viimeksi vaihdettiin, sovellus laskee seuraavan vaihdon heti.</div>`}
  </div>`;
  const input = $("#search");
  if (input) {
    input.oninput = () => { state.query = input.value; renderCards(); };
    input.onkeydown = e => {
      if (e.key === "Escape") { input.value = ""; state.query = ""; renderCards(); }
      if (e.key === "Enter") input.blur(); // sulkee iPhonen näppäimistön
    };
  }
  renderCards();
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
  queueMicrotask(() => { state.photoMsg = null; });
  $("#view").innerHTML = `<div class="stack" style="gap:18px">
    <button class="btn-ghost back" data-act="back">← Kaikki autot</button>
    <div class="stack" style="gap:8px">${carPhoto(c, "hero-photo")}
      <div class="row"><button class="small" data-act="photo">${c.photoUrl ? "Vaihda kuva" : "Lisää kuva"}</button>
      ${c.photoUrl ? `<button class="small btn-ghost" data-act="rmphoto">Poista kuva</button>` : ""}<span class="note" id="photoStatus" role="status">${esc(state.photoMsg || "")}</span></div></div>
    <div class="detail-head"><div><div class="eyebrow">${esc([c.year, c.fuel].filter(Boolean).join(" · ")) || "Auto"}</div>
      <h2 style="font-size:1.9rem">${esc(carTitle(c))}</h2></div>
      <div class="row">${plate(c.plate)}${odo(curKm(c))}</div></div>
    <section class="panel">${oilBlock(c, true)}
      <div class="row">${c.fuel !== "Sähkö" ? `<button class="btn-primary" data-act="oil">Öljyt vaihdettu</button>` : ""}<button data-act="km">Päivitä mittarilukema</button></div></section>
    <section class="panel"><div class="row between"><h3>Perustiedot</h3><button data-act="editcar">Muokkaa</button></div>
      ${facts.length ? `<dl class="facts">${facts.map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join("")}</dl>` : `<p class="muted">Ei lisätietoja.</p>`}
      ${c.notes ? `<p class="desc">${esc(c.notes)}</p>` : ""}</section>
    <section class="panel"><div class="row between"><h3>Huoltohistoria</h3><div class="row">${list.length ? `<button class="btn-ghost" data-act="astable">Taulukkona</button>` : ""}<button data-act="svc">+ Lisää huolto</button></div></div>
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
  $("#nav").hidden = !state.user;
  if (!state.user) { state.sheet = null; renderSheet(); return renderAuth(); }
  $("#navList").setAttribute("aria-current", state.view !== "services" ? "page" : "false");
  $("#navServices").setAttribute("aria-current", state.view === "services" ? "page" : "false");
  renderSheet();
  state.view === "car" ? renderCar() : state.view === "services" ? renderServices() : renderList();
}

/* ---------- huoltotaulukko ---------- */
const COLS = [
  { key: "date", label: "Pvm" }, { key: "car", label: "Auto", cls: "car-col" }, { key: "type", label: "Työ" },
  { key: "km", label: "km", num: true, wide: true }, { key: "place", label: "Tekijä", wide: true },
  { key: "description", label: "Lisätiedot", wide: true }, { key: "cost", label: "Hinta", num: true },
];
const shortDate = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-"); return `${+d}.${+m}.${y}`; };
const carLabel = c => c ? (c.plate || carTitle(c)) : "Poistettu auto";

function filteredServices() {
  const f = state.svc, carById = Object.fromEntries(state.cars.map(c => [c.id, c]));
  const words = f.q.trim().split(/\s+/).filter(Boolean).map(norm);
  const rows = state.services.filter(s =>
    (f.car === "all" || s.carId === f.car) &&
    (f.year === "all" || (s.date || "").startsWith(f.year)) &&
    (!words.length || (() => { const c = carById[s.carId] || {};
      const hay = norm([s.type, s.place, s.description, c.make, c.model, c.plate, s.date, shortDate(s.date)].join(" "));
      return words.every(w => hay.includes(w)); })()));
  const val = s => f.sort === "car" ? carLabel(carById[s.carId]).toLowerCase()
    : f.sort === "cost" || f.sort === "km" ? (s[f.sort] ?? -Infinity) : String(s[f.sort] || "").toLowerCase();
  const dir = f.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => { const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.date || "").localeCompare(a.date || ""); });
  return { rows, carById };
}

function renderServices() {
  const f = state.svc;
  if (f.car !== "all" && !state.cars.find(c => c.id === f.car)) f.car = "all";
  const years = [...new Set(state.services.map(s => (s.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  if (f.year !== "all" && !years.includes(f.year)) f.year = "all";
  $("#view").innerHTML = `<div class="stack">
    <div class="row between"><h2>Huollot</h2>
      <div class="row"><button data-act="csv" ${state.services.length ? "" : "disabled"}>Lataa CSV</button>
      <button class="btn-primary" data-act="svc-any" ${state.cars.length ? "" : "disabled"}>+ Lisää huolto</button></div></div>
    <div class="filters">
      <label>Auto<select id="sfCar"><option value="all">Kaikki autot</option>
        ${state.cars.map(c => `<option value="${c.id}" ${f.car === c.id ? "selected" : ""}>${esc(carTitle(c))}${c.plate ? " · " + esc(c.plate) : ""}</option>`).join("")}</select></label>
      <label>Vuosi<select id="sfYear"><option value="all">Kaikki vuodet</option>
        ${years.map(y => `<option ${f.year === y ? "selected" : ""}>${y}</option>`).join("")}</select></label>
      <label class="grow">Haku<input id="sfQ" type="search" value="${esc(f.q)}" placeholder="Työ, tekijä tai lisätieto" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></label>
    </div>
    <div id="svcSummary"></div>
    <div id="svcTable"></div>
  </div>`;
  $("#sfCar").onchange = e => { f.car = e.target.value; renderServiceData(); };
  $("#sfYear").onchange = e => { f.year = e.target.value; renderServiceData(); };
  const q = $("#sfQ");
  q.oninput = () => { f.q = q.value; renderServiceData(); };
  q.onkeydown = e => { if (e.key === "Enter") q.blur(); };
  renderServiceData();
}

// Päivittää vain yhteenvedon ja taulukon, jotta suodattimet pitävät fokuksen.
function renderServiceData() {
  const f = state.svc, { rows, carById } = filteredServices();
  const total = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const priced = rows.filter(r => r.cost != null).length;
  const thisYear = todayISO().slice(0, 4);
  const yearTotal = rows.filter(r => (r.date || "").startsWith(thisYear)).reduce((s, r) => s + (r.cost || 0), 0);
  // Kulut vuosittain (enintään 6 viimeisintä vuotta) suodatuksen mukaan
  const byYear = {};
  for (const r of rows) { const y = (r.date || "").slice(0, 4); if (y) byYear[y] = (byYear[y] || 0) + (r.cost || 0); }
  const yearList = Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  const maxY = Math.max(1, ...yearList.map(y => y[1]));
  $("#svcSummary").innerHTML = state.services.length ? `<section class="panel summary">
    <div class="kpis">
      <div><dt>Huoltoja</dt><dd class="num">${rows.length}</dd></div>
      <div><dt>Kulut yhteensä</dt><dd class="num">${fmtEur(total) || "0 €"}</dd></div>
      ${f.year === "all" ? `<div><dt>Kulut ${thisYear}</dt><dd class="num">${fmtEur(yearTotal) || "0 €"}</dd></div>` : ""}
      <div><dt>Keskihinta</dt><dd class="num">${priced ? fmtEur(Math.round(total / priced)) : "–"}</dd></div>
    </div>
    ${yearList.length > 1 ? `<div class="years" aria-label="Kulut vuosittain">${yearList.map(([y, v]) => `
      <div class="yrow"><span class="num">${y}</span><span class="ybar"><i style="width:${Math.max(2, v / maxY * 100)}%"></i></span><span class="num">${fmtEur(v) || "0 €"}</span></div>`).join("")}</div>` : ""}
  </section>` : "";

  if (!state.services.length) {
    $("#svcTable").innerHTML = `<div class="empty">Ei vielä huoltoja. ${state.cars.length ? "Lisää ensimmäinen huolto napista ”+ Lisää huolto”." : "Lisää ensin auto Autot-välilehdeltä."}</div>`;
    return;
  }
  if (!rows.length) {
    $("#svcTable").innerHTML = `<div class="empty">Valinnoilla ei löytynyt huoltoja. <div class="row" style="margin-top:10px"><button class="small" data-act="svc-reset">Näytä kaikki</button></div></div>`;
    return;
  }
  const arrow = k => f.sort === k ? (f.dir === "asc" ? " ↑" : " ↓") : "";
  $("#svcTable").innerHTML = `<div class="table-wrap"><table class="svc-table">
    <thead><tr>${COLS.map(c => `<th class="${c.num ? "r" : ""} ${c.wide ? "wide" : ""} ${c.cls || ""}" aria-sort="${f.sort === c.key ? (f.dir === "asc" ? "ascending" : "descending") : "none"}">
      <button type="button" class="th-btn" data-sort="${c.key}">${c.label}${arrow(c.key)}</button></th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => { const c = carById[r.carId];
      const sub = [r.km != null ? `${fmtKm(r.km)} km` : "", r.place].filter(Boolean).map(esc).join(" · ");
      return `<tr data-row="${r.id}" tabindex="0" class="${isOil(r) ? "oilrow" : ""}">
        <td class="num nowrap date-cell">${shortDate(r.date)}<span class="m-only"><span class="car-chip">${esc(carLabel(c))}</span></span></td>
        <td class="car-col"><span class="car-chip">${esc(carLabel(c))}</span></td>
        <td class="work"><span class="wtitle">${esc(r.type || "Huolto")}</span>${sub ? `<span class="m-only sub">${sub}</span>` : ""}${r.description ? `<span class="m-only sub desc-sm">${esc(r.description)}</span>` : ""}</td>
        <td class="num r wide nowrap">${r.km != null ? fmtKm(r.km) : "–"}</td>
        <td class="wide">${esc(r.place) || "–"}</td>
        <td class="wide desc-cell">${esc(r.description) || ""}</td>
        <td class="num r nowrap">${r.cost != null ? fmtEur(r.cost) : "–"}</td></tr>`; }).join("")}</tbody>
    <tfoot><tr><td><b>Yhteensä</b></td><td class="car-col"></td><td> <span class="muted">${rows.length} huoltoa</span></td>
      <td class="wide"></td><td class="wide"></td><td class="wide"></td><td class="num r nowrap"><b>${fmtEur(total) || "0 €"}</b></td></tr></tfoot>
  </table></div>
  <p class="note">Avaa huolto muokattavaksi napauttamalla riviä. Lajittele napauttamalla sarakkeen otsikkoa.</p>`;
}

function exportCsv() {
  const { rows, carById } = filteredServices();
  const cell = v => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [["Päivämäärä", "Auto", "Rekisterinumero", "Työ", "Mittarilukema (km)", "Tekijä", "Lisätiedot", "Hinta (€)"].join(";")];
  for (const r of rows) { const c = carById[r.carId] || {};
    lines.push([shortDate(r.date), carTitle(c), c.plate, r.type, r.km ?? "", r.place, r.description,
      r.cost != null ? String(r.cost).replace(".", ",") : ""].map(cell).join(";")); }
  // BOM + puolipiste-erotin: aukeaa suoraan suomenkielisessä Excelissä ääkkösineen.
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `huollot-${todayISO()}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const c = state.cars.find(x => x.id === (s.carId || state.carId));
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
      ${s.edit ? "" : `<label class="full">Kuva autosta (vapaaehtoinen)<input id="fPhoto" type="file" accept="image/*"></label>`}
      <label class="full">Muistiinpanot<textarea id="fNotes" rows="2">${esc(x.notes)}</textarea></label></div>`;
  } else if (s.type === "km") {
    body = `<h2>Päivitä mittarilukema</h2><p class="muted">${esc(carTitle(c))}, nyt ${fmtKm(curKm(c)) || "–"} km</p><div class="grid">
      <label>Mittarilukema (km)<input id="fKm" class="num" inputmode="numeric"></label>
      <label>Päivämäärä<input id="fDate" type="date" value="${todayISO()}"></label></div>`;
  } else {
    const e = s.edit ? state.services.find(x => x.id === s.edit) : {}; const isOilForm = s.type === "oil";
    const pickCar = state.view === "services";
    body = `<h2>${s.edit ? "Muokkaa merkintää" : isOilForm ? "Öljyt vaihdettu" : "Lisää huolto"}</h2><div class="grid">
      ${pickCar ? `<label class="full">Auto<select id="fCar">${state.cars.map(x => `<option value="${x.id}" ${x.id === (e.carId || s.carId) ? "selected" : ""}>${esc(carTitle(x))}${x.plate ? " · " + esc(x.plate) : ""}</option>`).join("")}</select></label>` : ""}
      ${isOilForm ? "" : `<label class="full">Toimenpide<input id="fType" list="types" value="${esc(e.type)}" placeholder="Renkaiden vaihto"></label>
      <datalist id="types">${SERVICE_TYPES.map(t => `<option value="${t}">`).join("")}</datalist>`}
      <label>Päivämäärä<input id="fDate" type="date" value="${e.date || todayISO()}"></label>
      <label>Mittarilukema (km)<input id="fKm" class="num" inputmode="numeric" value="${e.km ?? (isOilForm ? curKm(c) ?? "" : "")}"></label>
      <label>Hinta (€)<input id="fCost" class="num" inputmode="decimal" value="${e.cost ?? ""}"></label>
      <label>Tekijä<input id="fPlace" list="places" value="${esc(e.place)}" placeholder="Korjaamo tai itse"></label>
      <datalist id="places">${[...new Set(state.services.map(x => x.place).filter(Boolean))].map(p => `<option value="${esc(p)}">`).join("")}</datalist>
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
      delete car.photoUrl;
      const id = await store.saveCar(car);
      if (!s.edit) {
        const photo = $("#fPhoto")?.files?.[0];
        if (photo) {
          try { await store.setPhoto({ id }, await resizeImage(photo)); }
          catch (err) { state.photoMsg = "Auto tallennettiin, mutta kuva ei: " + errText(err); }
        }
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
      const carId = $("#fCar")?.value || s.carId || state.carId;
      const svc = { id: s.edit || undefined, carId, isOil: isOilForm || /öljynvaihto/i.test(type), type, date: val("#fDate") || todayISO(),
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
  const row = e.target.closest("tr[data-row]");
  if (row && !b) { const en = state.services.find(x => x.id === row.dataset.row);
    if (en) { state.sheet = { type: en.isOil && en.type === "Öljynvaihto" ? "oil" : "svc", edit: en.id, carId: en.carId }; renderSheet(); } return; }
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
    else if (a === "delcar") { const id = state.carId, pp = state.cars.find(x => x.id === id)?.photoPath; state.view = "list"; state.carId = null; state.confirm = null; await store.deleteCar(id, pp); await reload(); }
    else if (a === "nav-list") { state.view = "list"; state.carId = null; state.sheet = null; state.confirm = null; render(); scrollTo(0, 0); }
    else if (a === "nav-services") { state.view = "services"; state.carId = null; state.sheet = null; state.confirm = null; render(); scrollTo(0, 0); }
    else if (a === "astable") { state.svc.car = state.carId; state.svc.year = "all"; state.svc.q = ""; state.view = "services"; state.carId = null; state.sheet = null; render(); scrollTo(0, 0); }
    else if (a === "svc-any") { state.sheet = { type: "svc", carId: state.svc.car !== "all" ? state.svc.car : state.cars[0]?.id }; renderSheet(); }
    else if (a === "svc-reset") { Object.assign(state.svc, { car: "all", year: "all", q: "" }); renderServices(); }
    else if (a === "csv") exportCsv();
    else if (b.dataset.sort) { const k = b.dataset.sort, f = state.svc;
      if (f.sort === k) f.dir = f.dir === "asc" ? "desc" : "asc"; else { f.sort = k; f.dir = k === "date" || k === "cost" || k === "km" ? "desc" : "asc"; }
      renderServiceData(); }
    else if (a === "clearsearch") { state.query = ""; renderList(); $("#search")?.focus(); }
    else if (a === "photo") fileInput.click();
    else if (a === "rmphoto") { const c = state.cars.find(x => x.id === state.carId); await store.removePhoto(c); await reload(); }
    else if (a === "signout") { state.sheet = null; await store.signOut(); }
    else if (a === "export") exportBackup();
    else if (b.dataset.ask) { state.confirm = b.dataset.ask; render(); }
    else if (b.dataset.del) { state.confirm = null; await store.deleteService(b.dataset.del); await reload(); }
    else if (b.dataset.edit) {
      const en = state.services.find(x => x.id === b.dataset.edit);
      state.sheet = { type: en && en.isOil && en.type === "Öljynvaihto" ? "oil" : "svc", edit: b.dataset.edit, carId: en?.carId }; renderSheet();
    }
  } catch (err) { alert(errText(err)); }
});
document.addEventListener("keydown", e => {
  const c = e.target.closest?.("[data-open], tr[data-row]");
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
