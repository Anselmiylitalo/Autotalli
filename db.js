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
  oilKm: r.oil_km, oilMonths: r.oil_months, notes: r.notes || "", photoPath: r.photo_path || null, createdAt: r.created_at });
const svcToRow = s => ({ id: s.id, car_id: s.carId, date: s.date, km: s.km, type: s.type, is_oil: !!s.isOil,
  cost: s.cost, place: s.place || null, description: s.description || null });
const rowToSvc = r => ({ id: r.id, carId: r.car_id, date: r.date, km: r.km, type: r.type, isOil: r.is_oil,
  cost: r.cost == null ? null : +r.cost, place: r.place || "", description: r.description || "", createdAt: r.created_at });
const rowToReading = r => ({ id: r.id, carId: r.car_id, date: r.date, km: r.km });

/* ---------- Supabase ---------- */
async function supabaseStore() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const check = ({ data, error }) => { if (error) throw error; return data; };
  const BUCKET = "car-photos";
  const urlCache = new Map(); // polku → allekirjoitettu osoite, jottei kuvia ladata joka päivityksellä uudelleen
  async function signPhotos(cars) {
    const need = cars.map(c => c.photoPath).filter(p => p && !urlCache.has(p));
    if (need.length) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 24 * 7);
      if (!error) for (const x of data || []) if (x.signedUrl) urlCache.set(x.path, x.signedUrl);
    }
    for (const c of cars) c.photoUrl = c.photoPath ? urlCache.get(c.photoPath) || null : null;
  }
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
      const carList = check(cars).map(rowToCar);
      await signPhotos(carList);
      return { cars: carList, readings: check(readings).map(rowToReading), services: check(services).map(rowToSvc) };
    },
    /** Tallentaa auton kuvan (jo pienennetty JPEG) käyttäjän omaan kansioon ja poistaa vanhan. */
    async setPhoto(car, blob) {
      const { data: { user } } = await sb.auth.getUser();
      const path = `${user.id}/${car.id}-${Date.now()}.jpg`;
      check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false }));
      check(await sb.from("cars").update({ photo_path: path }).eq("id", car.id));
      if (car.photoPath) await sb.storage.from(BUCKET).remove([car.photoPath]);
    },
    async removePhoto(car) {
      check(await sb.from("cars").update({ photo_path: null }).eq("id", car.id));
      if (car.photoPath) await sb.storage.from(BUCKET).remove([car.photoPath]);
    },
    async saveCar(c) { const id = c.id || uid(); check(await sb.from("cars").upsert(carToRow({ ...c, id }))); return id; },
    async deleteCar(id, photoPath) { // merkinnät poistuvat cascade-säännöllä
      check(await sb.from("cars").delete().eq("id", id));
      if (photoPath) await sb.storage.from(BUCKET).remove([photoPath]);
    },
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
    async load() { const d = read(); for (const c of d.cars) c.photoUrl = c.photoData || null; return d; },
    async setPhoto(car, blob) {
      const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
      const d = read(); upsert(d.cars, { id: car.id, photoData: dataUrl }); write(d);
    },
    async removePhoto(car) { const d = read(); upsert(d.cars, { id: car.id, photoData: null }); write(d); },
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
