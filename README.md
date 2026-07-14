# 🛡️ Her Route

A women's safety app where women rate how safe they feel at real places — shops, malls,
parks, streets, localities — so others can decide where to go. Ratings, incident reports
and reviews are shared with everyone on the app in real time.

Mobile-first responsive web app. No build step, no API keys, no billing.

## Features
- **Interactive map** (Leaflet + OpenStreetMap) with places colour-coded by safety
  (🟢 safe · 🟠 caution · 🔴 risk) and "find my location".
- **Explore** list with search + category filters (locality, street, park, mall, shop,
  transport hub, café), sorted safest-first.
- **8 rating dimensions** (1–5): Lighting, Visibility, Crowd, Security Presence,
  Transport Access, Cleanliness, Daytime Comfort, Nighttime Comfort.
- **Incident reporting** checkboxes: staring, catcalling, verbal/physical harassment,
  being followed, intimidation, theft, unsafe transport.
- **Context** on every report: time of visit, who you were with, date of visit.
- **Location snapshot** per place: per-dimension scores, overall safety score,
  recent incident count, report recency, and a **confidence level** (Low/Medium/High)
  based on how many reports exist.
- **Reviews** feed from women, **Alerts** tab showing recent incidents.
- **Real-time** updates across open browser tabs (mock of cross-user sync).
- Mocked email sign-up/login (stored locally on the device).

## Run it
Geolocation and live updates work best when served over `localhost`. From this folder:

```powershell
# Option A — Python (most machines have it)
python -m http.server 5173
# then open http://localhost:5173

# Option B — Node
npx serve -l 5173
```

You can also just double-click `index.html` — everything works except "find my
location", which browsers only allow on `localhost`/https.

**Try real-time:** open the site in two browser tabs, post a rating in one, watch the
other update instantly.

## Change the city
Seed data is Bengaluru. Edit `js/data.js`:
- `MAP_CENTER` / `MAP_ZOOM` at the bottom set the starting map view.
- `SEED_DEFS` is the list of seeded places (name, type, lat/lng, area, vibe).

To wipe and re-seed, use **You → Reset demo data** in the app.

## Next step: real cross-user backend
Today data lives in `localStorage` (per browser). To make ratings shared across all
users on real devices, swap the storage functions in `js/app.js`
(`loadPlaces` / `savePlaces`) for **Firebase Firestore** real-time listeners — the rest
of the app already re-renders on data change, so it's a contained change.

## Files
```
her-route/
├─ index.html        # markup + screens
├─ css/styles.css    # mobile-first styling
└─ js/
   ├─ data.js        # dimensions, incidents, place types, seed data
   └─ app.js         # auth, map, explore, detail, add-rating, profile, alerts
```
