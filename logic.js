// Puhtaat laskentafunktiot: mittarilukemat, ajotahti ja öljynvaihdon arvio.
// Ei riippuvuuksia selaimeen, joten näitä voi testata Nodella (test.mjs).

export const MON_IN = ["tammikuussa","helmikuussa","maaliskuussa","huhtikuussa","toukokuussa","kesäkuussa",
  "heinäkuussa","elokuussa","syyskuussa","lokakuussa","marraskuussa","joulukuussa"];

export const todayISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const toDate = iso => new Date(iso + "T12:00:00Z");
export const days = (a, b) => (toDate(b) - toDate(a)) / 864e5;
export const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + Math.round(n)); return d.toISOString().slice(0, 10); };
export const addMonths = (iso, n) => { const d = toDate(iso); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export const isOil = s => s.isOil === true || /öljynvaihto/i.test(s.type || "");

/** Kaikki auton mittarilukemat (erilliset päivitykset + huoltomerkinnät) aikajärjestyksessä. */
export function readingsFor(carId, readings, services) {
  const r = [];
  for (const x of readings) if (x.carId === carId && x.date && x.km != null) r.push({ date: x.date, km: +x.km });
  for (const s of services) if (s.carId === carId && s.date && s.km != null) r.push({ date: s.date, km: +s.km });
  return r.sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
}

export function currentKm(carId, readings, services) {
  const r = readingsFor(carId, readings, services);
  return r.length ? Math.max(...r.map(x => x.km)) : null;
}

/** Keskimääräinen ajomäärä km/vrk viimeisen ~18 kk lukemista. Null jos dataa liian vähän. */
export function kmPerDay(carId, readings, services) {
  const r = readingsFor(carId, readings, services);
  if (r.length < 2) return null;
  const last = r[r.length - 1];
  const since = addDays(last.date, -540);
  const first = r.find(x => x.date >= since) || r[0];
  const span = days(first.date, last.date), diff = last.km - first.km;
  return span >= 21 && diff > 0 ? diff / span : null;
}

/**
 * Öljynvaihdon tila. level: ok | soon | late | none. Sähköautolle null.
 * Ajankohta-arvio on aikaisempi kahdesta: kilometrien (ajotahdin mukaan) tai aikarajan täyttyminen.
 */
export function oilStatus(car, readings, services, today = todayISO()) {
  if (car.fuel === "Sähkö") return null;
  const interval = car.oilKm || 15000, months = car.oilMonths ?? 12;
  const oils = services.filter(s => s.carId === car.id && isOil(s))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.km || 0) - (a.km || 0));
  const last = oils[0];
  if (!last) return { level: "none", interval, months };
  const cur = currentKm(car.id, readings, services);
  const dueKm = last.km != null ? last.km + interval : null;
  const left = dueKm != null && cur != null ? dueKm - cur : null;
  const rate = kmPerDay(car.id, readings, services);
  const byKm = left != null && rate ? addDays(today, Math.max(0, left) / rate) : null;
  const byTime = months && last.date ? addMonths(last.date, months) : null;
  let est = null, reason = "";
  if (byKm && (!byTime || byKm <= byTime)) { est = byKm; reason = "km"; }
  else if (byTime) { est = byTime; reason = "time"; }
  const late = (left != null && left < 0) || (byTime && byTime < today);
  const soon = !late && ((left != null && left < 1500) || (est && days(today, est) < 45));
  const used = last.km != null && cur != null ? (cur - last.km) / interval : null;
  const usedT = byTime ? days(last.date, today) / Math.max(1, days(last.date, byTime)) : null;
  const pct = Math.max(0, Math.min(1, Math.max(used ?? 0, usedT ?? 0)));
  return { level: late ? "late" : soon ? "soon" : "ok", last, dueKm, left, est, reason, pct, interval, months, rate, byTime };
}

export function whenText(iso, today = todayISO()) {
  const d = days(today, iso);
  if (d <= 0) return "nyt";
  if (d <= 10) return "noin viikon sisällä";
  if (d <= 60) return `noin ${Math.round(d / 7)} viikon päästä`;
  const dt = toDate(iso);
  return `arviolta ${MON_IN[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
