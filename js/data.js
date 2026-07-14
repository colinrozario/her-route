/* =========================================================================
   Her Route — data layer
   Defines rating dimensions, incident types, place types, and seed data.
   Exposes everything on window.HR for app.js to consume.
   ========================================================================= */

/* Wrapped in an IIFE so these names don't collide with app.js's globals.
   Everything is shared with the rest of the app through window.HR below. */
(function () {

/* ---- Rating dimensions (1–5 sliders). icon = Material Symbols name ---- */
const DIMENSIONS = [
  { key: 'lighting',     label: 'Lighting Quality',             icon: 'lightbulb' },
  { key: 'visibility',   label: 'Visibility / Open Sightlines',  icon: 'visibility' },
  { key: 'crowd',        label: 'Crowd Level',                  icon: 'groups' },
  { key: 'security',     label: 'Security Presence',            icon: 'local_police' },
  { key: 'transport',    label: 'Transport Accessibility',      icon: 'directions_bus' },
  { key: 'cleanliness',  label: 'Cleanliness & Maintenance',    icon: 'cleaning_services' },
  { key: 'dayComfort',   label: 'Daytime Comfort',              icon: 'light_mode' },
  { key: 'nightComfort', label: 'Nighttime Comfort',            icon: 'dark_mode' },
];

/* ---- Incident types (checkboxes). icon = Material Symbols name ---- */
const INCIDENTS = [
  { key: 'staring',          label: 'Unwanted Staring',              icon: 'visibility' },
  { key: 'catcalling',       label: 'Catcalling',                    icon: 'chat_bubble' },
  { key: 'verbal',           label: 'Verbal Harassment',             icon: 'record_voice_over' },
  { key: 'followed',         label: 'Being Followed',                icon: 'directions_walk' },
  { key: 'physical',         label: 'Physical Harassment',           icon: 'back_hand' },
  { key: 'intimidation',     label: 'Intimidation / Threatening',    icon: 'sentiment_dissatisfied' },
  { key: 'theft',            label: 'Theft / Pickpocketing',         icon: 'backpack' },
  { key: 'transportIncident',label: 'Unsafe Transport Experience',   icon: 'commute' },
];

/* ---- Place categories. icon = Material Symbols name ---- */
const PLACE_TYPES = [
  { key: 'locality',  label: 'Locality',          icon: 'home_pin' },
  { key: 'street',    label: 'Street',            icon: 'edit_road' },
  { key: 'park',      label: 'Park',              icon: 'park' },
  { key: 'mall',      label: 'Mall',              icon: 'shopping_bag' },
  { key: 'shop',      label: 'Shop / Market',     icon: 'storefront' },
  { key: 'transport', label: 'Transport Hub',     icon: 'commute' },
  { key: 'cafe',      label: 'Café / Restaurant', icon: 'local_cafe' },
];

/* ---- Context options ---- */
const TIME_OPTIONS = ['Morning', 'Afternoon', 'Evening', 'Night'];
const COMPANION_OPTIONS = ['Alone', 'With Friends', 'With Family'];

/* ---- Sample content for seeded reports ---- */
const NAMES = ['Aanya','Priya','Meera','Sara','Riya','Diya','Kavya','Ananya','Isha','Neha','Tara','Pooja','Sneha','Aditi','Naina','Zoya','Maya','Anjali'];

const REVIEWS_GOOD = [
  'Felt completely at ease walking around here, even on my own.',
  'Well lit and plenty of people about — would happily come back in the evening.',
  'Security was visible and the whole area felt looked after.',
  'Comfortable space, good visibility, never felt watched.',
  'Easy to get an auto/cab and the main road is busy in a good way.',
  'Clean, open and calm. One of my go-to spots.',
];
const REVIEWS_MIXED = [
  'Fine during the day but I would not linger here after dark.',
  'Mostly okay, though a couple of stretches feel a bit isolated.',
  'Busy and generally fine, just keep your bag close.',
  'Decent lighting on the main road but the side lanes are dim.',
  'Comfortable with friends, less so alone late at night.',
];
const REVIEWS_BAD = [
  'Got stared at and followed for a bit — left quickly.',
  'Poorly lit and isolated after sunset, avoid going alone.',
  'Felt unsafe near the bus stand, lots of unwanted attention.',
  'No security around and the lanes are very quiet at night.',
  'Would not recommend after dark, kept getting catcalled.',
];

/* ---- Seed place definitions (Bengaluru — easy to change in README) ---- */
const SEED_DEFS = [
  { name: 'Cubbon Park', type: 'park', lat: 12.9763, lng: 77.5929, area: 'Central Bengaluru',
    base: { lighting: 3, visibility: 5, crowd: 4, security: 4, transport: 4, cleanliness: 4, dayComfort: 5, nightComfort: 2 }, count: 16, incidentRate: 0.07, pool: ['staring','catcalling'] },
  { name: 'MG Road', type: 'street', lat: 12.9756, lng: 77.6068, area: 'MG Road',
    base: { lighting: 4, visibility: 4, crowd: 5, security: 4, transport: 5, cleanliness: 4, dayComfort: 5, nightComfort: 4 }, count: 22, incidentRate: 0.10, pool: ['staring','catcalling','theft'] },
  { name: 'Indiranagar 100ft Road', type: 'locality', lat: 12.9719, lng: 77.6412, area: 'Indiranagar',
    base: { lighting: 4, visibility: 4, crowd: 4, security: 4, transport: 4, cleanliness: 4, dayComfort: 5, nightComfort: 4 }, count: 18, incidentRate: 0.08, pool: ['staring','catcalling'] },
  { name: 'Koramangala 5th Block', type: 'locality', lat: 12.9352, lng: 77.6245, area: 'Koramangala',
    base: { lighting: 4, visibility: 4, crowd: 4, security: 3, transport: 4, cleanliness: 4, dayComfort: 5, nightComfort: 3 }, count: 15, incidentRate: 0.12, pool: ['staring','catcalling','followed'] },
  { name: 'Kempegowda Bus Station (Majestic)', type: 'transport', lat: 12.9774, lng: 77.5710, area: 'Majestic',
    base: { lighting: 3, visibility: 2, crowd: 5, security: 3, transport: 5, cleanliness: 2, dayComfort: 3, nightComfort: 1 }, count: 20, incidentRate: 0.30, pool: ['staring','catcalling','followed','theft','transportIncident','intimidation'] },
  { name: 'Phoenix Marketcity', type: 'mall', lat: 12.9975, lng: 77.6960, area: 'Whitefield',
    base: { lighting: 5, visibility: 5, crowd: 4, security: 5, transport: 4, cleanliness: 5, dayComfort: 5, nightComfort: 5 }, count: 19, incidentRate: 0.03, pool: ['staring'] },
  { name: 'Brigade Road', type: 'street', lat: 12.9719, lng: 77.6079, area: 'Brigade Road',
    base: { lighting: 4, visibility: 3, crowd: 5, security: 3, transport: 4, cleanliness: 3, dayComfort: 4, nightComfort: 3 }, count: 17, incidentRate: 0.18, pool: ['staring','catcalling','theft','followed'] },
  { name: 'Lalbagh Botanical Garden', type: 'park', lat: 12.9507, lng: 77.5848, area: 'Lalbagh',
    base: { lighting: 3, visibility: 4, crowd: 4, security: 4, transport: 4, cleanliness: 5, dayComfort: 5, nightComfort: 2 }, count: 13, incidentRate: 0.06, pool: ['staring'] },
  { name: 'Electronic City Phase 1', type: 'locality', lat: 12.8452, lng: 77.6602, area: 'Electronic City',
    base: { lighting: 3, visibility: 3, crowd: 3, security: 3, transport: 3, cleanliness: 3, dayComfort: 4, nightComfort: 2 }, count: 12, incidentRate: 0.14, pool: ['staring','followed','transportIncident'] },
  { name: 'KR Market', type: 'shop', lat: 12.9617, lng: 77.5806, area: 'KR Market',
    base: { lighting: 2, visibility: 2, crowd: 5, security: 2, transport: 4, cleanliness: 2, dayComfort: 3, nightComfort: 1 }, count: 14, incidentRate: 0.28, pool: ['staring','catcalling','theft','intimidation','followed'] },
  { name: 'UB City Mall', type: 'mall', lat: 12.9719, lng: 77.5959, area: 'Vittal Mallya Road',
    base: { lighting: 5, visibility: 5, crowd: 3, security: 5, transport: 4, cleanliness: 5, dayComfort: 5, nightComfort: 5 }, count: 11, incidentRate: 0.02, pool: ['staring'] },
  { name: 'Church Street', type: 'street', lat: 12.9753, lng: 77.6033, area: 'Church Street',
    base: { lighting: 4, visibility: 4, crowd: 4, security: 4, transport: 4, cleanliness: 4, dayComfort: 5, nightComfort: 4 }, count: 16, incidentRate: 0.09, pool: ['staring','catcalling'] },
];

/* ---- Helpers ---- */
function uid() {
  return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Small deterministic RNG so seed data looks the same on every load.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genReports(seedNum, def) {
  const rnd = mulberry32(seedNum * 7919 + 13);
  const reports = [];
  const avgBase = Object.values(def.base).reduce((a, b) => a + b, 0) / DIMENSIONS.length;

  for (let i = 0; i < def.count; i++) {
    const dims = {};
    DIMENSIONS.forEach(d => {
      let v = def.base[d.key] + (Math.round(rnd() * 2) - 1); // jitter ±1
      dims[d.key] = Math.max(1, Math.min(5, v));
    });

    const incidents = [];
    def.pool.forEach(k => { if (rnd() < def.incidentRate) incidents.push(k); });

    const daysAgo = Math.floor(rnd() * 75);
    const date = new Date(Date.now() - daysAgo * 86400000);

    let pool = REVIEWS_MIXED;
    if (avgBase >= 4) pool = rnd() < 0.75 ? REVIEWS_GOOD : REVIEWS_MIXED;
    else if (avgBase < 3) pool = rnd() < 0.7 ? REVIEWS_BAD : REVIEWS_MIXED;
    const review = pool[Math.floor(rnd() * pool.length)];

    reports.push({
      id: uid(),
      userId: 'seed',
      userName: NAMES[Math.floor(rnd() * NAMES.length)],
      dimensions: dims,
      incidents,
      context: {
        time: TIME_OPTIONS[Math.floor(rnd() * TIME_OPTIONS.length)],
        companions: COMPANION_OPTIONS[Math.floor(rnd() * COMPANION_OPTIONS.length)],
        date: date.toISOString(),
      },
      review,
      createdAt: date.toISOString(),
    });
  }
  return reports;
}

function buildSeedPlaces() {
  return SEED_DEFS.map((def, i) => ({
    id: 'seed-' + i,
    name: def.name,
    type: def.type,
    lat: def.lat,
    lng: def.lng,
    area: def.area,
    createdBy: 'seed',
    // geohash stored at precision 9 for spatial queries; Geo is loaded before data.js
    geohash: (window.Geo ? window.Geo.encode(def.lat, def.lng, 9) : ''),
    reports: genReports(i + 1, def),
  }));
}

/* Precomputed snapshot stored on each place doc so the map/list never have to
   read the (potentially huge) reports subcollection. Sums + count let us derive
   exact averages cheaply; incidentTotal is monotonic and time-independent. */
function computeStoredSnapshot(reports) {
  const sums = {};
  DIMENSIONS.forEach(d => sums[d.key] = 0);
  let incidentTotal = 0;
  let lastReportAt = null;
  (reports || []).forEach(r => {
    DIMENSIONS.forEach(d => sums[d.key] += (r.dimensions[d.key] || 0));
    incidentTotal += (r.incidents ? r.incidents.length : 0);
    if (!lastReportAt || r.createdAt > lastReportAt) lastReportAt = r.createdAt;
  });
  return { count: (reports || []).length, sums, incidentTotal, lastReportAt };
}

window.HR = {
  DIMENSIONS, INCIDENTS, PLACE_TYPES, TIME_OPTIONS, COMPANION_OPTIONS,
  buildSeedPlaces, computeStoredSnapshot, uid,
  // fallback view when the user's location is unknown: all of India
  MAP_CENTER: [22.35, 78.45],
  MAP_ZOOM: 5,
};

})();
