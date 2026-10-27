# Autotalli – huoltokirja

Verkkosovellus autojen perustiedoille, huoltohistorialle ja öljynvaihtomuistutukselle.
Toimii selaimessa ja iPhonen kotinäytöllä kuin oma sovellus. Tiedot synkronoituvat laitteiden välillä Supabasen kautta.

## Mitä sovellus tekee

- Autot rekisterinumeroineen ja perustietoineen (merkki, malli, vuosimalli, polttoaine, moottori, öljylaatu, renkaat, VIN).
- Oma öljynvaihtoväli jokaiselle autolle (5 000–30 000 km tai oma arvo) ja aikaraja (esim. 12 kk).
- Arvio seuraavasta öljynvaihdosta: kilometrilukema, jäljellä olevat kilometrit ja ajankohta ajotahtisi perusteella.
- Huoltohistoria hintoineen.
- Varmuuskopio JSON-tiedostoon.

## Käyttöönotto

### 1. Supabase (tietokanta ja kirjautuminen, ilmainen)

1. Luo tili osoitteessa https://supabase.com ja tee uusi projekti (alueeksi esim. *North EU (Stockholm)*).
2. Avaa **SQL Editor → New query**, liitä tiedoston `supabase/schema.sql` sisältö ja paina **Run**.
3. Avaa **Project Settings → API** ja kopioi
   - *Project URL*
   - *anon public* -avain
4. Liitä ne tiedostoon `config.js`:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
   Anon-avain on tarkoitettu julkiseksi; tiedot suojaa tietokannan käyttöoikeussääntö (jokainen näkee vain omat autonsa).
5. **Authentication → URL Configuration**: aseta *Site URL* sovelluksesi osoitteeksi, kun se on julkaistu (vaihe 3).
   Jos et halua vahvistaa sähköpostia tunnusta luodessa, kytke pois **Authentication → Providers → Email → Confirm email**.

### 2. GitHub

Vie kansion sisältö GitHub-repositorioon (esim. `autotalli`).

### 3. Netlify (julkaisu, ilmainen)

1. https://app.netlify.com → **Add new site → Import an existing project → GitHub** ja valitse repositorio.
2. Build command: tyhjä. Publish directory: `.` (asetus on valmiina `netlify.toml`-tiedostossa).
3. Deploy. Saat osoitteen tyyliin `https://autotalli-xyz.netlify.app`.

Jokainen GitHubiin viety muutos julkaistaan automaattisesti. Vercel toimii samalla tavalla.

### 4. iPhone

1. Avaa sovelluksen osoite **Safarissa**.
2. Paina jakonappia → **Lisää Koti-valikkoon**.
3. Avaa sovellus kotinäytön kuvakkeesta ja kirjaudu.

## Kehitys omalla koneella

Ilman Supabase-tietoja sovellus käynnistyy **demotilassa** ja tallentaa tiedot vain selaimeen.

```bash
python3 -m http.server 8080
# avaa http://localhost:8080
```

Laskentalogiikan testit: `node test.mjs`

Kun julkaiset muutoksia, nosta `sw.js`-tiedoston `CACHE`-versiota, jotta puhelimet hakevat uuden version varmasti.

## Tiedostot

| Tiedosto | Sisältö |
|---|---|
| `index.html` | Sivun runko ja PWA-asetukset |
| `app.js` | Näkymät, lomakkeet ja kirjautuminen |
| `logic.js` | Mittarilukemat, ajotahti ja öljynvaihdon arvio |
| `db.js` | Supabase-yhteys ja paikallinen demotila |
| `config.js` | Supabase-osoite ja -avain |
| `styles.css` | Ulkoasu (vaalea ja tumma teema) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Kotinäyttösovellus ja välimuisti |
| `supabase/schema.sql` | Tietokantataulut ja käyttöoikeudet |
