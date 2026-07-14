/* =========================================================================
   Her Route — new-user onboarding
   -------------------------------------------------------------------------
   Gated flow shown once after signup, before the app unlocks:
     1. detect location (or manual city search via Nominatim)
     2. quick-rate your current locality (required)
     3. quick-rate popular places nearby from OpenStreetMap/Overpass
        (skip allowed per place; at least MIN_RATED required)
   Quick ratings are stored as normal reports with the star value applied
   to all 8 dimensions and flagged `quick: true`.
   ========================================================================= */
const Onboarding = (() => {
  const HR = window.HR;
  const MIN_RATED = 3;
  const STAR_WORDS = ['Not comfortable', 'A bit uneasy', 'Okay', 'Mostly comfortable', 'Very comfortable'];
  const STAR_COLORS = ['#fb923c', '#fb923c', '#65a30d', '#65a30d', '#16a34a'];

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mi = (name, cls = '') => `<span class="material-symbols-outlined${cls ? ' ' + cls : ''}">${name}</span>`;
  const $o = (s) => document.querySelector('#onboard ' + s);

  let ctx = null;        // { user, getPlaces, markDone }
  const O = {
    center: null,        // [lat, lng] — user position, Overpass search centre
    locality: null,      // { name, area, lat, lng } from reverse geocode / city search
    localityStars: 0,
    deck: [], idx: 0, pass: 1,
    ratings: [],         // { cand, stars }
    skipped: [],
  };

  /* ---------------- tiny geo helpers ---------------- */
  function distKm(a1, o1, a2, o2) {
    const R = 6371, dA = (a2 - a1) * Math.PI / 180, dO = (o2 - o1) * Math.PI / 180;
    const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dO / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function timeBucket() {
    const h = new Date().getHours();
    return h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
  }

  /* ---------------- external lookups (free, no keys) ---------------- */
  async function reverseGeocode(lat, lng) {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`);
    const j = await r.json();
    const a = j.address || {};
    const name = j.name || a.suburb || a.neighbourhood || a.city_district || a.town || a.city || 'Your area';
    const city = a.city || a.town || a.village || a.state_district || a.state || '';
    // use the matched area's own centroid, not the user's exact position (privacy)
    return { name, area: city, lat: parseFloat(j.lat) || lat, lng: parseFloat(j.lon) || lng };
  }

  async function searchCity(q) {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=in&q=${encodeURIComponent(q)}`);
    return r.json();
  }

  function classify(tags) {
    if (tags.shop === 'mall') return ['mall', 3];
    if (tags.shop === 'department_store') return ['shop', 2];
    if (tags.amenity === 'marketplace') return ['shop', 2.5];
    if (tags.amenity === 'bus_station') return ['transport', 3];
    if (tags.railway === 'station') return ['transport', 3];
    if (tags.leisure === 'park') return ['park', 1.5];
    return null;
  }

  // Tried in order — public Overpass instances differ in load and uptime.
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  async function fetchPopularPlaces(lat, lng, radiusKm) {
    // bbox is much faster than around: on busy public instances; parks are
    // restricted to wikidata-tagged ones (the notable/popular ones).
    const dLat = radiusKm / 111, dLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
    const b = `["name"](${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng});`;
    const q = `[out:json][timeout:25];(
      nwr["shop"="mall"]${b}
      nwr["shop"="department_store"]${b}
      nwr["amenity"="marketplace"]${b}
      nwr["leisure"="park"]["wikidata"]${b}
      nwr["amenity"="bus_station"]${b}
      nwr["railway"="station"]${b}
    );out center 150;`;
    let j = null;
    for (const ep of OVERPASS_ENDPOINTS) {
      try {
        // GET, not POST — overpass-api.de's frontend rejects some POSTs with 406
        const r = await fetch(ep + '?data=' + encodeURIComponent(q));
        if (!r.ok) continue;
        const data = await r.json();
        if (!data.elements?.length && /error/i.test(data.remark || '')) continue; // silent server-side timeout
        j = data;
        break;
      } catch (e) { console.warn('[onboarding] Overpass endpoint failed:', ep, e); }
    }
    if (!j) throw new Error('All Overpass endpoints failed');
    const seen = new Set();
    const out = [];
    (j.elements || []).forEach(el => {
      const tags = el.tags || {};
      const cls = classify(tags);
      const plat = el.lat ?? el.center?.lat, plng = el.lon ?? el.center?.lon;
      if (!cls || !tags.name || plat == null) return;
      // mistag guard: real malls/dept stores are buildings (ways); skip
      // point-mapped ones unless they're notable enough to have a wikidata id
      if ((tags.shop === 'mall' || tags.shop === 'department_store') && el.type === 'node' && !tags.wikidata) return;
      const key = tags.name.trim().toLowerCase();
      if (seen.has(key) || key === (O.locality?.name || '').toLowerCase()) return;
      seen.add(key);
      const dist = distKm(lat, lng, plat, plng);
      // popularity heuristic: notable on Wikipedia/Wikidata > busy category > nearby
      const score = cls[1] + (tags.wikidata ? 3 : 0) + (tags.wikipedia ? 1 : 0) + Math.max(0, 1.5 - dist / 5);
      out.push({ name: tags.name.trim(), type: cls[0], lat: plat, lng: plng, dist, score });
    });
    out.sort((a, b) => b.score - a.score);
    // keep variety: at most 5 of any one type, 15 total
    const perType = {}, deck = [];
    for (const c of out) {
      if (deck.length >= 15) break;
      perType[c.type] = (perType[c.type] || 0) + 1;
      if (perType[c.type] <= 5) deck.push(c);
    }
    return deck;
  }

  /* ---------------- report building & posting ---------------- */
  function buildReport(stars) {
    const dimensions = {};
    HR.DIMENSIONS.forEach(d => dimensions[d.key] = stars);
    return {
      id: HR.uid(),
      userId: ctx.user.uid || ctx.user.email,
      userName: ctx.user.name,
      dimensions,
      incidents: [],
      context: { time: timeBucket(), companions: 'Alone', date: new Date().toISOString() },
      review: '',
      quick: true,
      createdAt: new Date().toISOString(),
    };
  }

  function findExisting(cand) {
    const norm = (s) => s.trim().toLowerCase();
    return ctx.getPlaces().find(p => {
      const d = distKm(p.lat, p.lng, cand.lat, cand.lng);
      if (d > 0.3) return false;
      const a = norm(p.name), b = norm(cand.name);
      return d < 0.05 || a.includes(b) || b.includes(a);
    });
  }

  async function postAll() {
    const entries = [{ cand: { ...O.locality, type: 'locality' }, stars: O.localityStars },
                     ...O.ratings.map(r => ({ cand: { ...r.cand, area: O.locality.area }, stars: r.stars }))];
    let posted = 0;
    for (const e of entries) {
      try {
        const report = buildReport(e.stars);
        const existing = findExisting(e.cand);
        if (existing) await Store.addReport(existing.id, report);
        else await Store.addPlace({
          id: HR.uid(), name: e.cand.name, type: e.cand.type, area: e.cand.area || '',
          lat: e.cand.lat, lng: e.cand.lng, createdBy: ctx.user.uid || ctx.user.email, reports: [report],
        });
        posted++;
      } catch (err) { console.error('[onboarding] post failed:', err); }
    }
    return posted;
  }

  /* ---------------- shared UI pieces ---------------- */
  function shell(pct, stepline, body) {
    document.querySelector('#onboard').innerHTML = `
      <div class="ob-wrap">
        <div class="ob-progress"><span style="width:${pct}%"></span></div>
        <div class="ob-stepline">${stepline}</div>
        <div class="ob-body">${body}</div>
        <div class="ob-signout">Wrong account? <a href="#" id="ob-signout">Sign out</a></div>
      </div>`;
    $o('#ob-signout').onclick = async (e) => {
      e.preventDefault();
      if (window.Store) await window.Store.signOut().catch(() => {});
      localStorage.removeItem('herroute_user');
      location.reload();
    };
  }

  function starsHtml() {
    return `
      <div class="ob-stars" role="radiogroup" aria-label="How safe does this place feel, 1 to 5">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-v="${n}" role="radio" aria-checked="false" aria-label="${n} out of 5 — ${STAR_WORDS[n - 1]}">${mi('star')}</button>`).join('')}
      </div>
      <div class="ob-star-word">Tap a star to rate</div>`;
  }

  // wires the star group inside the current screen; calls onPick(value)
  function wireStars(onPick) {
    const group = $o('.ob-stars');
    group.querySelectorAll('button').forEach(b => b.onclick = () => {
      const v = Number(b.dataset.v);
      group.querySelectorAll('button').forEach(x => {
        const on = Number(x.dataset.v) <= v;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        x.style.color = on ? STAR_COLORS[v - 1] : '';
      });
      const word = $o('.ob-star-word');
      word.textContent = STAR_WORDS[v - 1];
      word.style.color = STAR_COLORS[v - 1];
      onPick(v);
    });
  }

  function spinnerScreen(pct, stepline, title, sub) {
    shell(pct, stepline, `
      <div class="ob-hero">
        <div class="ob-spin" aria-hidden="true"></div>
        <h2>${title}</h2>
        <p class="sub">${sub}</p>
      </div>`);
  }

  /* ---------------- steps ---------------- */
  function stepIntro() {
    shell(5, 'Getting started', `
      <div class="ob-hero">
        <div class="big-ico">${mi('travel_explore')}</div>
        <h2>Hi ${esc(ctx.user.name)}! Let's set up <span class="brandname">her route</span></h2>
        <p class="sub">Rate how safe your locality and a few popular spots in your city feel — it takes about 2 minutes and helps every woman who checks them after you.</p>
      </div>
      <div class="ob-foot">
        <button class="btn" id="ob-detect">${mi('my_location')} Detect my location</button>
        <button class="btn ghost" id="ob-manual">Enter my city instead</button>
      </div>`);
    $o('#ob-detect').onclick = stepDetect;
    $o('#ob-manual').onclick = () => stepManualCity();
  }

  function stepDetect() {
    if (!navigator.geolocation) { stepManualCity('Location is not supported on this device.'); return; }
    spinnerScreen(12, 'Step 1 of 3 · Your location', 'Finding you…', 'Allow location access when your browser asks.');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        O.center = [pos.coords.latitude, pos.coords.longitude];
        try {
          O.locality = await reverseGeocode(O.center[0], O.center[1]);
        } catch {
          O.locality = { name: 'My locality', area: '', lat: O.center[0], lng: O.center[1] };
        }
        stepLocality();
      },
      () => stepManualCity('We couldn\'t get your location — search for your city or locality instead.'),
      { timeout: 12000 }
    );
  }

  function stepManualCity(note) {
    shell(12, 'Step 1 of 3 · Your location', `
      <div class="ob-hero">
        <div class="big-ico">${mi('location_city')}</div>
        <h2>Where are you?</h2>
        <p class="sub">${note ? esc(note) : 'Search for your locality or city.'}</p>
      </div>
      <div class="field">
        <label for="ob-city-q">Locality / city</label>
        <input id="ob-city-q" type="text" placeholder="e.g. Indiranagar, Bengaluru" autocomplete="off" />
      </div>
      <button class="btn" id="ob-city-go">${mi('search')} Search</button>
      <div class="ob-results" id="ob-city-results"></div>
      <div class="ob-foot">
        <button class="btn ghost" id="ob-retry">${mi('my_location')} Try my location again</button>
      </div>`);
    $o('#ob-retry').onclick = stepDetect;
    const run = async () => {
      const q = $o('#ob-city-q').value.trim();
      if (!q) return;
      const box = $o('#ob-city-results');
      box.innerHTML = '<div class="helper">Searching…</div>';
      let results = [];
      try { results = await searchCity(q); } catch {}
      if (!results.length) { box.innerHTML = '<div class="helper">No matches — try a bigger area or check spelling.</div>'; return; }
      box.innerHTML = results.map((r, i) =>
        `<button type="button" class="ob-result" data-i="${i}">${mi('place')}<span>${esc(r.display_name.split(',').slice(0, 3).join(', '))}</span></button>`).join('');
      box.querySelectorAll('.ob-result').forEach(b => b.onclick = () => {
        const r = results[Number(b.dataset.i)];
        const a = r.address || {};
        O.center = [parseFloat(r.lat), parseFloat(r.lon)];
        O.locality = {
          name: r.name || r.display_name.split(',')[0],
          area: a.city || a.town || a.state_district || a.state || '',
          lat: O.center[0], lng: O.center[1],
        };
        stepLocality();
      });
    };
    $o('#ob-city-go').onclick = run;
    $o('#ob-city-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  }

  function stepLocality() {
    shell(30, 'Step 2 of 3 · Your locality', `
      <div class="ob-card">
        <div class="ob-place-ico">${mi('home_pin', 'fill')}</div>
        <h2>${esc(O.locality.name)}</h2>
        <div class="ob-meta">${esc(O.locality.area || 'Your locality')}</div>
        <button class="btn ghost" id="ob-change-loc" style="font-size:13px;min-height:36px;width:auto;padding:6px 14px;margin-top:6px">
          ${mi('edit_location')} Not your home locality? Change it
        </button>
        <p class="sub" style="margin-top:12px">How safe does this locality feel for you as a woman?</p>
        ${starsHtml()}
        <p style="font-size:11px;color:var(--outline);margin-top:10px">${mi('lock')} Only the neighbourhood name is stored — never your exact address.</p>
      </div>
      <div class="ob-foot">
        <button class="btn" id="ob-next" disabled>Next</button>
      </div>`);
    $o('#ob-change-loc').onclick = () => stepManualCity('Enter your home locality or neighbourhood to rate it.');
    wireStars(v => { O.localityStars = v; $o('#ob-next').disabled = false; });
    $o('#ob-next').onclick = stepFetchDeck;
  }

  async function stepFetchDeck() {
    spinnerScreen(38, 'Step 3 of 3 · Popular places', 'Finding popular places near you…', 'Malls, markets, stations and parks other women ask about.');
    O.deck = [];
    try {
      O.deck = await fetchPopularPlaces(O.center[0], O.center[1], 7);
      if (O.deck.length < 10) O.deck = await fetchPopularPlaces(O.center[0], O.center[1], 15);
    } catch (e) { console.error('[onboarding] Overpass failed:', e); }
    O.idx = 0; O.pass = 1; O.ratings = []; O.skipped = [];
    O.total = O.deck.length;
    if (!O.deck.length) { stepSave(); return; } // nothing found — locality rating alone is fine
    stepCard();
  }

  function effMin() { return Math.min(MIN_RATED, O.total); }

  function stepCard() {
    if (O.idx >= O.deck.length) {
      if (O.ratings.length >= effMin() || O.pass >= 2 || !O.skipped.length) { stepSave(); return; }
      // second pass over skipped cards until the minimum is met
      O.deck = O.skipped; O.skipped = []; O.idx = 0; O.pass = 2;
    }
    const c = O.deck[O.idx];
    const t = HR.PLACE_TYPES.find(x => x.key === c.type) || { label: c.type, icon: 'place' };
    const pct = 40 + Math.round(50 * (O.idx / O.deck.length));
    const need = Math.max(0, effMin() - O.ratings.length);
    shell(pct, `Step 3 of 3 · Place ${O.idx + 1} of ${O.deck.length}${O.pass > 1 ? ' (second look)' : ''}`, `
      <div class="ob-card">
        <div class="ob-place-ico">${mi(t.icon, 'fill')}</div>
        <h2>${esc(c.name)}</h2>
        <div class="ob-meta">${t.label} · ${c.dist < 1 ? Math.round(c.dist * 1000) + ' m' : c.dist.toFixed(1) + ' km'} away</div>
        <p class="sub" style="margin-top:10px">Been here? How safe did it feel?</p>
        ${starsHtml()}
      </div>
      <div class="ob-foot">
        <button class="btn" id="ob-next" disabled>Next</button>
        <button class="btn ghost" id="ob-skip">I haven't been here</button>
        ${O.ratings.length >= effMin() ? `<button class="btn secondary" id="ob-finish">${mi('check')} Finish setup</button>` : `<div class="helper" style="text-align:center">Rate at least ${need} more place${need === 1 ? '' : 's'} to finish</div>`}
      </div>`);
    let stars = 0;
    wireStars(v => { stars = v; $o('#ob-next').disabled = false; });
    $o('#ob-next').onclick = () => { O.ratings.push({ cand: c, stars }); O.idx++; stepCard(); };
    $o('#ob-skip').onclick = () => { O.skipped.push(c); O.idx++; stepCard(); };
    const fin = $o('#ob-finish');
    if (fin) fin.onclick = stepSave;
  }

  async function stepSave() {
    spinnerScreen(95, 'Almost done', 'Saving your ratings…', 'Sharing them live with the her route community.');
    const posted = await postAll();
    shell(100, 'All set', `
      <div class="ob-hero">
        <div class="big-ico" style="background:linear-gradient(135deg,var(--safe),var(--tertiary))">${mi('celebration')}</div>
        <h2>You're all set!</h2>
        <p class="sub">${posted} rating${posted === 1 ? '' : 's'} shared. Every place you rated now helps other women decide where to go.</p>
      </div>
      <div class="ob-foot">
        <button class="btn" id="ob-enter">${mi('explore')} Start exploring</button>
      </div>`);
    $o('#ob-enter').onclick = () => {
      // hand the detected location to the map (same key app.js reads)
      localStorage.setItem('herroute_loc', JSON.stringify({
        lat: O.center[0], lng: O.center[1],
        label: O.locality.area || O.locality.name, source: 'gps',
      }));
      ctx.markDone();
      document.querySelector('#onboard').classList.add('hidden');
    };
  }

  /* ---------------- entry ---------------- */
  function begin(context) {
    ctx = context;
    document.querySelector('#onboard').classList.remove('hidden');
    stepIntro();
  }

  return { begin, fetchPopularPlaces, searchCity };
})();
window.Onboarding = Onboarding;
