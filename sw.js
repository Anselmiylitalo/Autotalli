// Service worker: pitää sovelluksen rungon välimuistissa, jotta se aukeaa nopeasti ja ilman verkkoa.
// Nosta versiota aina kun julkaiset muutoksia.
const CACHE = "autotalli-v5";
const SHELL = ["./", "index.html", "styles.css", "app.js", "logic.js", "db.js", "config.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase ja fontit suoraan verkosta
  // Verkko ensin, välimuisti varalla: muutokset näkyvät heti kun verkko on käytössä.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
