// Tietovarasto: Supabase (synkronoitu tili) tai paikallinen demotila, jos config.js on tyhjä.
// Molemmilla sama rajapinta, joten app.js ei tiedä kumpaa käytetään.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- muunnokset sovelluksen ja tietokannan kenttien välillä ---------- */
const carToRow = c => ({ id: c.id, make: c.make || null, model: c.model || null, plate: c.plate || null, year: c.year ? +c.year : null,
  fuel: c.fuel || null, engine: c.engine || null, oil_spec: c.oilSpec || null, tires: c.tires || null, vin: c.vin || null,
  oil_km: c.oilKm, oil_months: c.oilMonths, notes: c.notes || null });
const rowToCar = r => ({ id: r.id, make: r.make || "", model: r.model || "", plate: r.plate || "", year: r.year ?? "",
  fuel: r.fuel || "", engine: r.engine || "", oilSpec: r.oil_spec || "", tires: r.tires || "", vin: r.vin || "",
  oilKm: r.oil_km, oilMonths: r.oil_months, notes: r.notes || "", createdAt: r.created_at });
const svcToRow = s => ({ id: s.id, car_id: s.carId, date: s.date, km: s.km, type: s.type, is_oil: !!s.isOil,
  cost: s.cost, place: s.place || null, description: s.description || null });
const rowToSvc = r => ({ id: r.id, carId: r.car_id, date: r.date, km: r.km, type: r.type, isOil: r.is_oil,
  cost: r.cost == null ? null : +r.cost, place: r.place || "", description: r.description || "", createdAt: r.created_at });
const rowToReading = r => ({ id: r.id, carId: r.car_id, date: r.date, km: r.km });

/* ---------- Supabase ---------- */
async function supabaseStore() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const check = ({ data, error }) => { if (error) throw error; return data; };
  return {
    mode: "cloud",
    async user() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },
    onAuth(fn) { sb.auth.onAuthStateChange((_e, session) => fn(session?.user || null)); },
    async signIn(email, password) { check(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) {
      const data = check(await sb.auth.signUp({ email, password }));
      return { needsConfirm: !data.session };
    },
    async resetPassword(email) { check(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async signOut() { await sb.auth.signOut(); },
    async load() {
      const [cars, readings, services] = await Promise.all([
        sb.from("cars").select("*").order("created_at"),
        sb.from("odometer").select("*").order("date"),
        sb.from("services").select("*").order("date", { ascending: false }),
      ]);
      return { cars: check(cars).map(rowToCar), readings: check(readings).map(rowToReading), services: check(services).map(rowToSvc) };
    },
    async saveCar(c) { const id = c.id || uid(); check(await sb.from("cars").upsert(carToRow({ ...c, id }))); return id; },
    async deleteCar(id) { check(await sb.from("cars").delete().eq("id", id)); }, // merkinnät poistuvat cascade-säännöllä
    async addReading(carId, date, km) { check(await sb.from("odometer").insert({ id: uid(), car_id: carId, date, km })); },
    async saveService(s) { const id = s.id || uid(); check(await sb.from("services").upsert(svcToRow({ ...s, id }))); return id; },
    async deleteService(id) { check(await sb.from("services").delete().eq("id", id)); },
  };
}

/* ---------- paikallinen demotila ---------- */
function localStore() {
  const KEY = "autotalli.local.v1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { cars: [], readings: [], services: [] }; } catch { return { cars: [], readings: [], services: [] }; } };
  const write = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  const now = () => new Date().toISOString();
  const upsert = (list, item) => { const i = list.findIndex(x => x.id === item.id); i >= 0 ? (list[i] = { ...list[i], ...item }) : list.push(item); };
  return {
    mode: "local",
    async user() { return { email: null, local: true }; },
    onAuth() {},
    async load() { return read(); },
    async saveCar(c) { const d = read(); const id = c.id || uid(); upsert(d.cars, { createdAt: now(), ...c, id }); write(d); return id; },
    async deleteCar(id) { const d = read(); d.cars = d.cars.filter(x => x.id !== id);
      d.readings = d.readings.filter(x => x.carId !== id); d.services = d.services.filter(x => x.carId !== id); write(d); },
    async addReading(carId, date, km) { const d = read(); d.readings.push({ id: uid(), carId, date, km }); write(d); },
    async saveService(s) { const d = read(); const id = s.id || uid(); upsert(d.services, { createdAt: now(), ...s, id }); write(d); return id; },
    async deleteService(id) { const d = read(); d.services = d.services.filter(x => x.id !== id); write(d); },
  };
}

export async function createStore() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return supabaseStore();
  return localStore();
}
