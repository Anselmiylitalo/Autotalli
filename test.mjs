// Laskentalogiikan testit: node test.mjs
import assert from "node:assert/strict";
import { oilStatus, kmPerDay, currentKm, whenText, addMonths } from "./logic.js";

const today = "2026-10-27";
const car = { id: "c1", fuel: "Diesel", oilKm: 15000, oilMonths: 12 };

// Ei öljynvaihtoa → none
assert.equal(oilStatus(car, [], [], today).level, "none");

// Vaihto 140 000 km 1.6.2026, nyt 146 000 km 27.10. → jäljellä 9 000 km
const services = [{ carId: "c1", date: "2026-06-01", km: 140000, isOil: true, type: "Öljynvaihto" }];
const readings = [{ carId: "c1", date: "2026-10-27", km: 146000 }];
let s = oilStatus(car, readings, services, today);
assert.equal(s.dueKm, 155000);
assert.equal(s.left, 9000);
assert.equal(currentKm("c1", readings, services), 146000);
const rate = kmPerDay("c1", readings, services);
assert.ok(rate > 40 && rate < 45, "ajotahti ~41 km/vrk, oli " + rate);
assert.equal(s.level, "ok");
assert.equal(s.reason, "time"); // 9 000 km kestäisi ~219 vrk (3.6.2027), 12 kk raja tulee vastaan ensin (1.6.2027)
assert.equal(s.est, "2027-06-01");
// Kun ajetaan enemmän, kilometrit ratkaisevat
s = oilStatus(car, [{ carId: "c1", date: "2026-07-01", km: 142000 }, { carId: "c1", date: today, km: 150000 }], services, today);
assert.equal(s.reason, "km");

// Kilometrit ylitetty → late
s = oilStatus(car, [{ carId: "c1", date: today, km: 156000 }], services, today);
assert.equal(s.level, "late");
assert.equal(s.left, -1000);

// Aikaraja ylitetty, vaikka kilometrejä on jäljellä → late
s = oilStatus(car, [], [{ carId: "c1", date: "2025-09-01", km: 100000, isOil: true }], today);
assert.equal(s.level, "late");

// Alle 1 500 km jäljellä → soon
s = oilStatus(car, [{ carId: "c1", date: today, km: 154000 }], services, today);
assert.equal(s.level, "soon");

// Sähköauto → ei öljymuistutusta
assert.equal(oilStatus({ ...car, fuel: "Sähkö" }, readings, services, today), null);

assert.equal(addMonths("2026-01-31", 1).slice(0, 7), "2026-03"); // JS:n kuukausiylivuoto, hyväksyttävä arviossa
assert.match(whenText("2027-03-15", today), /maaliskuussa 2027/);
assert.match(whenText("2026-11-20", today), /viikon päästä/);
console.log("Kaikki testit ok");
