/* =========================================================================
   Her Route — app logic
   ========================================================================= */
const { DIMENSIONS, INCIDENTS, PLACE_TYPES, TIME_OPTIONS, COMPANION_OPTIONS, uid } = window.HR;

const KEY_USER   = 'herroute_user';
const KEY_USERS  = 'herroute_users';   // local-mode only mock user store
const KEY_LOC    = 'herroute_loc';     // {lat, lng, label, source: 'gps'|'manual'}

// Fast GPS options — skips high-accuracy GPS radio, uses wifi/cell (< 1 s on most devices).
const FAST_GPS_OPTS = { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 };

/* ---- session helpers (local mode fallback + cross-tab cache) ---- */
const loadUser  = () => JSON.parse(localStorage.getItem(KEY_USER) || 'null');
const loadLoc   = () => { try { return JSON.parse(localStorage.getItem(KEY_LOC) || 'null'); } catch { return null; } };
const saveLoc   = (l) => localStorage.setItem(KEY_LOC, JSON.stringify(l));
const saveUser  = (u) => localStorage.setItem(KEY_USER, JSON.stringify(u));
// local mode only
const loadUsers = () => JSON.parse(localStorage.getItem(KEY_USERS) || '{}');
function saveUsers(u) { localStorage.setItem(KEY_USERS, JSON.stringify(u)); }

/* ---------------- app state ---------------- */
const state = {
  user: null,
  places: [],
  view: 'map',
  typeFilter: 'all',
  search: '',
  selectedId: null,
  map: null,
  markers: null,
  incidentMarkers: null,  // separate Leaflet layer for incident pins
  swReg: null,            // ServiceWorkerRegistration for FCM
  addDraft: null,
  _pinPickerActive: false,
};

/* ---------------- helpers ---------------- */
const $  = (s) => document.querySelector(s);
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mi = (name, cls = '') => `<span class="material-symbols-outlined${cls ? ' ' + cls : ''}">${name}</span>`;
const typeInfo = (k) => PLACE_TYPES.find(t => t.key === k) || { label: k, icon: 'place' };

function safetyColor(s) {
  if (s <= 0) return '#9b96aa';
  if (s >= 4)   return '#16a34a';
  if (s >= 3.2) return '#65a30d';
  if (s >= 2.5) return '#fb923c';
  return '#e53e3e';
}
function safetyWord(s) {
  if (s <= 0) return 'No data';
  if (s >= 4)   return 'Safe';
  if (s >= 3.2) return 'Mostly safe';
  if (s >= 2.5) return 'Caution';
  return 'Be mindful';
}
function timeAgo(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 30) return Math.floor(d) + ' days ago';
  if (d < 60) return '1 month ago';
  return Math.floor(d / 30) + ' months ago';
}

function countUp(el, to, ms = 700) {
  if (!el || !to) return;
  const t0 = performance.now();
  (function step(t) {
    const p = Math.min((t - t0) / ms, 1);
    el.textContent = (to * (1 - (1 - p) ** 3)).toFixed(1);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

// Derived from the place's precomputed snapshot — no report scan needed.
function computeSnapshot(place) {
  const s = place.snapshot || { count: 0, sums: {}, incidentTotal: 0, lastReportAt: null };
  const n = s.count || 0;
  const dimAvgs = {};
  DIMENSIONS.forEach(d => { dimAvgs[d.key] = n ? (s.sums[d.key] || 0) / n : 0; });
  const overall = n ? mean(Object.values(dimAvgs)) : 0;
  const incidentTotal = s.incidentTotal || 0;
  const penalty = Math.min(1.2, (n ? incidentTotal / n : 0) * 0.6);
  const safety = n ? Math.max(1, overall - penalty) : 0;
  const confidence = n >= 10 ? 'High' : n >= 3 ? 'Medium' : n > 0 ? 'Low' : 'None';
  const lastReport = s.lastReportAt ? new Date(s.lastReportAt).getTime() : null;
  return { n, dimAvgs, overall, safety, incidentTotal, confidence, lastReport };
}

function toast(msg) {
  const old = $('.toast'); if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function hideSplash() {
  // Wait for Material Symbols to be ready so icons never flash as raw text.
  await Promise.race([
    document.fonts.load("1em 'Material Symbols Outlined'"),
    new Promise(r => setTimeout(r, 3000)),
  ]).catch(() => {});
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('out');
  setTimeout(() => { el.remove(); document.getElementById('splash-css')?.remove(); }, 380);
}

/* ===================================================================
   AUTH
   =================================================================== */
let authMode = 'login';

function renderAuthMode() {
  $('#auth-title').textContent = authMode === 'login' ? 'Welcome back' : 'Create your account';
  $('#auth-sub').textContent = authMode === 'login'
    ? 'Sign in to see real-time safety ratings near you.'
    : 'Join the community keeping each other informed.';
  $('#name-field').classList.toggle('hidden', authMode === 'login');
  $('#auth-submit').textContent = authMode === 'login' ? 'Sign in' : 'Create account';
  $('#auth-toggle').innerHTML = authMode === 'login'
    ? `New here? <a href="#" id="swap">Create an account</a>`
    : `Already have an account? <a href="#" id="swap">Sign in</a>`;
  $('#swap').onclick = (e) => { e.preventDefault(); authMode = authMode === 'login' ? 'signup' : 'login'; renderAuthMode(); };
}

function _authErrorMsg(code) {
  if (code === 'auth/email-already-in-use')    return 'An account with this email already exists — sign in instead.';
  if (code === 'auth/wrong-password')          return 'Incorrect password. Please try again.';
  if (code === 'auth/invalid-credential')      return 'Incorrect email or password.';
  if (code === 'auth/user-not-found')          return 'No account found — create one first.';
  if (code === 'auth/weak-password')           return 'Password must be at least 6 characters.';
  if (code === 'auth/invalid-email')           return 'Please enter a valid email address.';
  if (code === 'auth/too-many-requests')       return 'Too many attempts — please try again later.';
  if (code === 'auth/network-request-failed')  return 'Network error — check your connection.';
  if (code === 'auth/popup-closed-by-user')    return '';  // user dismissed, no toast needed
  return 'Something went wrong — please try again.';
}

function initAuth() {
  renderAuthMode();
  const pt = $('#pass-toggle');
  if (pt) pt.onclick = () => {
    const inp = $('#auth-pass');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    pt.querySelector('.material-symbols-outlined').textContent = show ? 'visibility_off' : 'visibility';
    pt.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };

  // Email / password form
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim().toLowerCase();
    const pass  = $('#auth-pass').value;
    const name  = $('#auth-name').value.trim();
    if (!email || !pass) return;

    const btn = $('#auth-submit');
    btn.disabled = true;
    btn.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';

    if (Store.mode === 'firebase') {
      try {
        if (authMode === 'signup') {
          if (!name) { toast('Please enter your name'); btn.disabled = false; btn.textContent = 'Create account'; return; }
          const user = await Store.signUp(name, email, pass);
          state.user = user;
          enterApp();
        } else {
          const user = await Store.signIn(email, pass);
          state.user = user;
          enterApp();
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = authMode === 'login' ? 'Sign in' : 'Create account';
        const msg = _authErrorMsg(err.code || '');
        if (msg) toast(msg);
      }
    } else {
      // Local demo mode: keep localStorage mock auth
      const users = loadUsers();
      if (authMode === 'signup') {
        if (!name) { toast('Please enter your name'); btn.disabled = false; btn.textContent = 'Create account'; return; }
        if (users[email]) { toast('Account exists — signing you in'); }
        users[email] = { name: users[email]?.name || name, email, pass, onboarded: users[email] ? users[email].onboarded !== false : false };
        saveUsers(users);
        state.user = { name: users[email].name, email };
      } else {
        if (!users[email]) { toast('No account found — creating one'); users[email] = { name: email.split('@')[0], email, pass, onboarded: false }; saveUsers(users); }
        state.user = { name: users[email].name, email };
      }
      saveUser(state.user);
      enterApp();
    }
  });

  // Google Sign-in
  const googleBtn = $('#auth-google');
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      if (Store.mode !== 'firebase') { toast('Google sign-in requires Firebase mode'); return; }
      googleBtn.disabled = true;
      try {
        const user = await Store.signInGoogle();
        state.user = user;
        enterApp();
      } catch (err) {
        const msg = _authErrorMsg(err.code || '');
        if (msg) toast(msg);
        googleBtn.disabled = false;
      }
    });
  }
}

/* ===================================================================
   NAVIGATION
   =================================================================== */
function setView(view, dir = 'forward') {
  state.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active', 'from-back'));
  const navMap = { map: 'view-map', explore: 'view-explore', add: 'view-add', profile: 'view-profile', detail: 'view-detail', alerts: 'view-detail' };
  const viewEl = $('#' + navMap[view]);
  viewEl.classList.add('active');
  if (dir === 'back') viewEl.classList.add('from-back');
  document.querySelectorAll('.bottomnav button').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  $('.content').scrollTop = 0;

  if (view === 'map')      setTimeout(() => state.map && state.map.invalidateSize(), 50);
  if (view === 'explore')  renderExplore();
  if (view === 'add')      renderAddForm();
  if (view === 'profile')  renderProfile();
  if (view === 'alerts')   renderAlerts();
}

function initNav() {
  document.querySelectorAll('.bottomnav button').forEach(btn => {
    btn.addEventListener('click', () => {
      const dest = btn.dataset.nav;
      const pinOverlay = $('#pin-overlay');
      if (pinOverlay && !pinOverlay.classList.contains('hidden')) {
        closePinPicker();
        if (dest !== 'add') state.addDraft = null;
      } else if (state.view === 'add' && dest !== 'add') {
        state.addDraft = null;
      }
      setView(dest);
    });
  });
}

/* ===================================================================
   MAP
   =================================================================== */
// City name for a coordinate (Nominatim). Cached by geohash-5 cell (~5 km) to
// avoid repeat network calls when the user pans small distances.
const _geoCache = new Map();
async function cityLabelFor(lat, lng) {
  const key = Geo.encode(lat, lng, 5);
  if (_geoCache.has(key)) return _geoCache.get(key);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`);
    const a = (await r.json()).address || {};
    const label = a.city || a.town || a.village || a.state_district || a.state || '';
    _geoCache.set(key, label);
    return label;
  } catch { return ''; }
}

function updateCityPill() {
  const loc = loadLoc();
  const el = $('#city-pill-label');
  if (el) el.textContent = (loc && loc.label) || 'Set your city';
}

function setLocation(lat, lng, label, source, zoom) {
  saveLoc({ lat, lng, label, source });
  if (state.map) state.map.setView([lat, lng], zoom);
  updateCityPill();
}

function initMap() {
  // start at the user's last known/chosen location; fall back to all-India view
  const saved = loadLoc();
  const start = saved ? [[saved.lat, saved.lng], 12] : [window.HR.MAP_CENTER, window.HR.MAP_ZOOM];
  state.map = L.map('map', { zoomControl: true }).setView(start[0], start[1]);
  state.map.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(state.map);
  state.markers = L.layerGroup().addTo(state.map);
  state.incidentMarkers = L.layerGroup().addTo(state.map);
  renderMarkers();
  updateCityPill();

  // Re-query Firestore whenever the visible area changes.
  state.map.on('moveend', _triggerViewport);
  state.map.on('zoomend', _triggerViewport);

  if ((!saved || saved.source !== 'manual') && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        state.map.setView([lat, lng], 13);
        const label = await cityLabelFor(lat, lng);
        saveLoc({ lat, lng, label, source: 'gps' });
        updateCityPill();
        if (state.user?.uid) Store.setUserLocation(state.user.uid, lat, lng).catch(() => {});
      },
      () => {},
      FAST_GPS_OPTS
    );
  }

  $('#city-pill').addEventListener('click', openCityModal);
  $('#sos-btn').addEventListener('click', openIncidentOverlay);
  $('#cancel-incident').addEventListener('click', closeIncidentOverlay);
  $('#submit-incident').addEventListener('click', submitIncident);
  $('#cancel-pin').addEventListener('click', () => { closePinPicker(); setView('add'); });
  $('#confirm-pin').addEventListener('click', confirmPinPick);

  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Location not supported'); return; }
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        state.map.setView(ll, 15);
        L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#0096cc', fillOpacity: 1 })
          .addTo(state.markers).bindPopup('You are here').openPopup();
        const label = await cityLabelFor(ll[0], ll[1]);
        saveLoc({ lat: ll[0], lng: ll[1], label, source: 'gps' });
        updateCityPill();
        if (state.user?.uid) Store.setUserLocation(state.user.uid, ll[0], ll[1]).catch(() => {});
      },
      () => toast('Could not get location (allow permission / use https)'),
      FAST_GPS_OPTS
    );
  });
}

/* ---------------- city switcher ---------------- */
function closeCityModal() { $('#city-modal').classList.add('hidden'); }

function openCityModal() {
  const m = $('#city-modal');
  m.innerHTML = `
    <div class="city-sheet">
      <div class="sheet-head">
        <h3>${mi('travel_explore')} Explore a city</h3>
        <button class="icon-btn" id="city-close" aria-label="Close">${mi('close')}</button>
      </div>
      <p class="helper">Check how safe places feel anywhere in India — search a city or locality.</p>
      <div class="field">
        <label for="city-q">City / locality</label>
        <input id="city-q" type="text" placeholder="e.g. Mumbai, Hyderabad, Jaipur…" autocomplete="off" />
      </div>
      <button class="btn" id="city-go">${mi('search')} Search</button>
      <div class="ob-results" id="city-results"></div>
      <button class="btn ghost" id="city-gps" style="margin-top:10px">${mi('my_location')} Back to my current location</button>
    </div>`;
  m.classList.remove('hidden');
  m.onclick = (e) => { if (e.target === m) closeCityModal(); };
  $('#city-close').onclick = closeCityModal;

  $('#city-gps').onclick = () => {
    closeCityModal();
    if (!navigator.geolocation) { toast('Location not supported'); return; }
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const label = await cityLabelFor(lat, lng);
        setLocation(lat, lng, label, 'gps', 13);
        if (state.user?.uid) Store.setUserLocation(state.user.uid, lat, lng).catch(() => {});
      },
      () => toast('Could not get location (allow permission)'),
      FAST_GPS_OPTS
    );
  };

  const run = async () => {
    const q = $('#city-q').value.trim();
    if (!q) return;
    const box = $('#city-results');
    box.innerHTML = '<div class="helper">Searching…</div>';
    let results = [];
    try { results = await Onboarding.searchCity(q); } catch {}
    if (!results.length) { box.innerHTML = '<div class="helper">No matches — try a bigger area or check spelling.</div>'; return; }
    box.innerHTML = results.map((r, i) =>
      `<button type="button" class="ob-result" data-i="${i}">${mi('place')}<span>${esc(r.display_name.split(',').slice(0, 3).join(', '))}</span></button>`).join('');
    box.querySelectorAll('.ob-result').forEach(b => b.onclick = () => {
      const r = results[Number(b.dataset.i)];
      const label = r.name || r.display_name.split(',')[0];
      setLocation(parseFloat(r.lat), parseFloat(r.lon), label, 'manual', 12);
      closeCityModal();
      setView('map');
      toast(`Exploring ${label}`);
    });
  };
  $('#city-go').onclick = run;
  $('#city-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  $('#city-q').focus();
}

function renderMarkers() {
  if (!state.markers) return;
  state.markers.clearLayers();
  state.places.forEach(p => {
    const s = computeSnapshot(p);
    const color = safetyColor(s.safety);
    const icon = L.divIcon({
      className: 'hr-pin',
      html: `<span class="material-symbols-outlined" style="color:${color}">location_on</span>`,
      iconSize: [40, 40], iconAnchor: [20, 38], popupAnchor: [0, -34],
    });
    L.marker([p.lat, p.lng], { icon }).bindPopup(`
      <div class="map-pop">
        <b>${esc(p.name)}</b>
        <div class="row">${esc(p.area || '')} · ${typeInfo(p.type).label}</div>
        <div class="row"><b style="color:${color}">${s.n ? s.safety.toFixed(1) + '/5 · ' + safetyWord(s.safety) : 'No ratings yet'}</b></div>
        ${s.incidentTotal ? `<div class="row" style="color:var(--caution)">${s.incidentTotal} concern${s.incidentTotal === 1 ? '' : 's'} flagged</div>` : ''}
        <button onclick="window.openDetail('${p.id}')">View details</button>
      </div>`).addTo(state.markers);
  });
}

/* ===================================================================
   EXPLORE
   =================================================================== */
function skeletonCard() {
  return `<div class="card skeleton-card" aria-hidden="true">
    <div class="score-badge sk-fill sk-pulse" style="background:var(--container-high)"></div>
    <div class="card-body">
      <div class="sk-fill sk-pulse" style="height:15px;width:58%;border-radius:8px;margin-bottom:9px"></div>
      <div class="sk-fill sk-pulse" style="height:11px;width:36%;border-radius:6px;margin-bottom:13px"></div>
      <div style="display:flex;gap:7px">
        <div class="sk-fill sk-pulse" style="height:22px;width:70px;border-radius:999px"></div>
        <div class="sk-fill sk-pulse" style="height:22px;width:50px;border-radius:999px"></div>
      </div>
    </div>
  </div>`;
}

function renderTypeChips() {
  const chips = $('#type-chips');
  const all = [{ key: 'all', label: 'All', icon: 'public' }, ...PLACE_TYPES];
  chips.innerHTML = all.map(t =>
    `<button class="chip ${state.typeFilter === t.key ? 'active' : ''}" data-type="${t.key}">${mi(t.icon)} ${t.label}</button>`
  ).join('');
  chips.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    state.typeFilter = c.dataset.type; renderExplore();
  });
}

function renderExplore() {
  renderTypeChips();
  const el = $('#explore-list');

  if (!state.places.length) {
    el.innerHTML = [1, 2, 3, 4].map(skeletonCard).join('');
    return;
  }

  const q = state.search.toLowerCase();
  const list = state.places
    .filter(p => state.typeFilter === 'all' || p.type === state.typeFilter)
    .filter(p => !q || p.name.toLowerCase().includes(q) || (p.area || '').toLowerCase().includes(q))
    .map(p => ({ p, s: computeSnapshot(p) }))
    .sort((a, b) => b.s.safety - a.s.safety);

  if (!list.length) { el.innerHTML = `<div class="empty">${mi('search_off')}No places found.<br>Try another search, or add one with the ＋ button.</div>`; return; }
  el.innerHTML = list.map(({ p, s }) => placeCard(p, s)).join('');
  el.querySelectorAll('.card').forEach(c => c.onclick = () => openDetail(c.dataset.id));
}

function placeCard(p, s) {
  const color = safetyColor(s.safety);
  return `
    <div class="card fade-in" data-id="${p.id}">
      <div class="score-badge" style="background:${color}">
        <span class="num">${s.n ? s.safety.toFixed(1) : '–'}</span><span class="of">/ 5</span>
      </div>
      <div class="card-body">
        <h3>${mi(typeInfo(p.type).icon)} ${esc(p.name)}</h3>
        <div class="meta">${esc(p.area || '')} · ${typeInfo(p.type).label} · ${s.n} report${s.n === 1 ? '' : 's'}</div>
        <div class="card-tags">
          <span class="tag conf-${s.confidence}">${s.confidence === 'None' ? 'No data' : s.confidence + ' confidence'}</span>
          ${s.incidentTotal ? `<span class="tag alert">${mi('info')} ${s.incidentTotal} flagged</span>` : ''}
          <span class="tag">${safetyWord(s.safety)}</span>
        </div>
      </div>
    </div>`;
}

/* ===================================================================
   DETAIL
   =================================================================== */
window.openDetail = openDetail;
async function openDetail(id) {
  state.selectedId = id;
  const p = state.places.find(x => x.id === id);
  if (!p) return;
  const s = computeSnapshot(p);
  const color = safetyColor(s.safety);

  const dims = DIMENSIONS.map(d => {
    const v = s.dimAvgs[d.key];
    return `<div class="dim-row">
      <div class="dlabel">${mi(d.icon)} ${d.label}</div>
      <div class="bar"><span style="width:0;background:${safetyColor(v)}" data-w="${v ? (v / 5 * 100).toFixed(1) + '%' : '0%'}"></span></div>
      <div class="dval">${v ? v.toFixed(1) : '–'}</div>
    </div>`;
  }).join('');

  $('#view-detail').innerHTML = `
    <div class="detail-hero">
      <button class="back" id="detail-back">${mi('arrow_back')} Back</button>
      <div class="detail-top">
        <div class="ring" style="background:${color}">
          <span class="num">${s.n ? s.safety.toFixed(1) : '–'}</span><span class="lbl">${safetyWord(s.safety)}</span>
        </div>
        <div>
          <h2>${mi(typeInfo(p.type).icon)} ${esc(p.name)}</h2>
          <div class="meta">${esc(p.area || '')} · ${typeInfo(p.type).label}</div>
          <div class="card-tags" style="margin-top:8px">
            <span class="tag conf-${s.confidence}">${s.confidence === 'None' ? 'No data' : s.confidence + ' confidence'}</span>
            <span class="tag">${s.n} report${s.n === 1 ? '' : 's'}</span>
            ${s.lastReport ? `<span class="tag">Updated ${timeAgo(new Date(s.lastReport).toISOString())}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="snapshot-strip">
        <div class="snap-pill">Flagged<b style="color:${s.incidentTotal ? 'var(--caution)' : 'var(--safe)'}">${s.incidentTotal}</b></div>
        <div class="snap-pill">Confidence<b>${s.confidence === 'None' ? '–' : s.confidence}</b></div>
        <div class="snap-pill">Total reports<b>${s.n}</b></div>
      </div>
    </div>

    <div class="pad">
      <button class="btn" id="rate-this">${mi('add')} Rate this place</button>
      <div class="divider"></div>
      <div class="section-title">Location snapshot</div>
      ${dims}
      <div class="divider"></div>
      <div class="section-title">What women flagged</div>
      <div id="detail-incidents"><div class="helper">Loading…</div></div>
      <div class="divider"></div>
      <div class="section-title">Reviews from women</div>
      <div id="detail-reviews"><div class="helper">Loading…</div></div>
      <div class="divider"></div>
      <div class="section-title" id="detail-history-title">Rating history</div>
      <div id="detail-history"><div class="helper">Loading…</div></div>
    </div>`;

  $('#detail-back').onclick = () => setView('explore', 'back');
  $('#rate-this').onclick = () => { state.addDraft = { placeId: p.id }; setView('add'); };
  setView('detail');

  // Animate score ring count-up and dimension bars on next paint
  requestAnimationFrame(() => {
    if (s.n) countUp($('#view-detail .ring .num'), s.safety);
    requestAnimationFrame(() => {
      document.querySelectorAll('#view-detail .bar span[data-w]').forEach(span => {
        span.style.width = span.dataset.w;
      });
    });
  });

  let reports = [];
  try { reports = await Store.getReports(id, 100); } catch (e) { console.error(e); }
  if (state.selectedId !== id) return;

  const incCount = {};
  reports.forEach(r => (r.incidents || []).forEach(k => incCount[k] = (incCount[k] || 0) + 1));
  const incKeys = Object.keys(incCount).sort((a, b) => incCount[b] - incCount[a]);
  const incEl = $('#detail-incidents');
  if (incEl) incEl.innerHTML = incKeys.length
    ? `<div class="incident-grid">` + incKeys.map(k => {
        const info = INCIDENTS.find(i => i.key === k);
        return `<div class="inc-stat">${mi(info.icon)} ${info.label} <b>×${incCount[k]}</b></div>`;
      }).join('') + `</div>`
    : `<div class="no-incidents">${mi('check_circle', 'fill')} No incidents reported here yet.</div>`;

  const reviewsHtml = reports.filter(r => r.review).map(r => reviewCard(r)).join('');
  const revEl = $('#detail-reviews');
  if (revEl) revEl.innerHTML = reviewsHtml || `<div class="empty">No written reviews yet.</div>`;

  const histTitle = $('#detail-history-title');
  if (histTitle) histTitle.textContent = `Rating history (${reports.length})`;
  const histEl = $('#detail-history');
  const sortedHistory = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (histEl) histEl.innerHTML = sortedHistory.length
    ? sortedHistory.map(ratingHistoryCard).join('')
    : `<div class="empty">${mi('history')} No ratings yet.</div>`;
}

function reviewCard(r) {
  const stars = (() => {
    const avg = mean(Object.values(r.dimensions));
    const full = Math.round(avg);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  })();
  const incLine = (r.incidents && r.incidents.length)
    ? `<div class="inc-line">${mi('info')} ${r.incidents.map(k => INCIDENTS.find(i => i.key === k)?.label).join(', ')}</div>` : '';
  return `<div class="review">
    <div class="head">
      <div class="who"><span class="avatar">${esc((r.userName || '?')[0])}</span>${esc(r.userName || 'Anonymous')}</div>
      <div class="when">${timeAgo(r.createdAt)}</div>
    </div>
    <div class="stars">${stars}</div>
    <p>${esc(r.review)}</p>
    <div class="ctx">
      <span>${mi('schedule')} ${esc(r.context.time)}</span>
      <span>${mi('group')} ${esc(r.context.companions)}</span>
      <span>${mi('event')} ${new Date(r.context.date).toLocaleDateString()}</span>
    </div>
    ${incLine}
  </div>`;
}

function ratingHistoryCard(r) {
  const avg = mean(Object.values(r.dimensions));
  const full = Math.round(avg);
  const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
  const color = safetyColor(avg);
  const visitDate = r.context?.date
    ? new Date(r.context.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '';
  const concerns = (r.incidents || []).map(k => {
    const info = INCIDENTS.find(i => i.key === k);
    return info ? `<span class="tag">${mi(info.icon)} ${info.label}</span>` : '';
  }).join('');
  return `<div class="rh-item fade-in">
    <div class="rh-top">
      <span class="avatar rh-av">${esc((r.userName || '?')[0])}</span>
      <div class="rh-info">
        <div class="rh-namerow">
          <span class="rh-name">${esc(r.userName || 'Anonymous')}</span>
          <span class="rh-when">${timeAgo(r.createdAt)}</span>
        </div>
        <div class="rh-ctx">
          ${r.context?.time ? `<span>${mi('schedule')} ${esc(r.context.time)}</span>` : ''}
          ${r.context?.companions ? `<span>${mi('group')} ${esc(r.context.companions)}</span>` : ''}
          ${visitDate ? `<span>${mi('event')} ${visitDate}</span>` : ''}
          ${r.quick ? `<span>${mi('bolt')} Quick rating</span>` : ''}
        </div>
      </div>
      <div class="rh-score-col">
        <span class="rh-num" style="color:${color}">${avg.toFixed(1)}</span>
        <span class="rh-stars" style="color:${color}">${stars}</span>
      </div>
    </div>
    ${concerns ? `<div class="rh-concerns">${concerns}</div>` : ''}
  </div>`;
}

/* ===================================================================
   ALERTS  (merged feed: quick incidents + place-based incident reports)
   =================================================================== */
async function renderAlerts() {
  $('#view-detail').innerHTML = `
    <div class="detail-hero alerts-hero">
      <h2>${mi('campaign', 'fill')} What's been shared</h2>
      <div class="meta">Recent experiences from women in the area</div>
    </div>
    <div class="pad" id="alerts-list"><div class="helper">Loading…</div></div>`;

  let placeReports = [], quickIncidents = [];
  try {
    [placeReports, quickIncidents] = await Promise.all([
      Store.getAlerts(25),
      Store.getRecentIncidents(20),
    ]);
  } catch (e) { console.error(e); }
  if (state.view !== 'alerts') return;

  // Merge and sort newest first
  const merged = [
    ...placeReports.map(r  => ({ ...r,  _src: 'report'   })),
    ...quickIncidents.map(i => ({ ...i,  _src: 'incident' })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const incTag = (k) => {
    const info = INCIDENTS.find(i => i.key === k);
    return info ? `<span class="tag alert">${mi(info.icon)} ${info.label}</span>` : '';
  };

  const items = merged.map(item => {
    if (item._src === 'incident') {
      return `<div class="card fade-in inc-alert-card">
        <div class="score-badge" style="background:#fff3e0;color:#e65100">${mi('chat_bubble')}</div>
        <div class="card-body">
          <h3>Shared nearby</h3>
          <div class="meta">${timeAgo(item.createdAt)} · ${esc(item.userName || 'Someone nearby')}</div>
          <div class="card-tags">${(item.types || []).map(incTag).join('')}</div>
          ${item.note ? `<div class="meta" style="margin-top:5px;font-style:italic">"${esc(item.note)}"</div>` : ''}
        </div>
      </div>`;
    }
    return `<div class="card fade-in" data-id="${item.placeId}">
      <div class="score-badge" style="background:#fdecea;color:#c62828">${mi('place')}</div>
      <div class="card-body">
        <h3>${mi(typeInfo(item.placeType).icon)} ${esc(item.placeName || 'A place')}</h3>
        <div class="meta">${esc(item.area || '')} · ${timeAgo(item.createdAt)} · ${esc(item.context ? item.context.time : '')}</div>
        <div class="card-tags">${(item.incidents || []).map(incTag).join('')}</div>
      </div>
    </div>`;
  }).join('');

  const el = $('#alerts-list');
  if (el) {
    el.innerHTML = items || `<div class="empty">${mi('check_circle', 'fill')}Nothing shared recently — all quiet nearby.</div>`;
    el.querySelectorAll('.card[data-id]').forEach(c => c.onclick = () => openDetail(c.dataset.id));
  }
}

/* ===================================================================
   PIN PICKER
   =================================================================== */
function openPinPicker() {
  $('#pin-overlay').classList.remove('hidden');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (state.map) state.map.setView([pos.coords.latitude, pos.coords.longitude], 17); },
      () => { const loc = loadLoc(); if (loc && state.map) state.map.setView([loc.lat, loc.lng], 15); },
      FAST_GPS_OPTS
    );
  } else {
    const loc = loadLoc();
    if (loc && state.map) state.map.setView([loc.lat, loc.lng], 15);
  }
}

function closePinPicker() {
  $('#pin-overlay').classList.add('hidden');
  state._pinPickerActive = false;
}

async function confirmPinPick() {
  const { lat, lng } = state.map.getCenter();
  state.addDraft = state.addDraft || {};
  state.addDraft.newLoc = [lat, lng];

  closePinPicker();

  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`
    );
    const data = await r.json();
    const addr = data.address || {};
    const name = addr.amenity || addr.shop || addr.building || '';
    const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.city || addr.town || '';
    if (name && !state.addDraft.npName) state.addDraft.npName = name;
    state.addDraft.npArea = area;
    state.addDraft.newLocLabel = [name || addr.road || '', area].filter(Boolean).join(', ')
      || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    state.addDraft.newLocLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  setView('add');
}

/* ===================================================================
   ADD RATING
   =================================================================== */
function renderAddForm() {
  const draft = state.addDraft || {};
  const placeOptions = state.places
    .slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `<option value="${p.id}" ${draft.placeId === p.id ? 'selected' : ''}>${esc(p.name)} — ${esc(p.area || '')}</option>`).join('');

  $('#add-container').innerHTML = `
    <div class="add-head"><h2>Rate a place</h2></div>
    <p class="helper">Your honest experience helps other women decide where to go.</p>

    <div class="field">
      <label>Which place?</label>
      <select id="place-select">
        <option value="__new__">➕ Add a new place…</option>
        ${placeOptions}
      </select>
    </div>

    <div id="new-place-fields" class="hidden">
      <div class="field">
        <label>Place name</label>
        <input id="np-name" placeholder="e.g. Jayanagar Metro Station" value="${esc(draft.npName || '')}" />
      </div>
      <div class="field">
        <label>Type of place</label>
        <select id="np-type">${PLACE_TYPES.map(t => `<option value="${t.key}" ${draft.npType === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Location on map</label>
        <button type="button" class="pin-drop-btn" id="np-pin-btn">
          ${mi('location_on', 'fill')} ${draft.newLoc ? 'Change pinned location' : 'Drop a pin on the map'}
        </button>
        <div id="np-loc-preview" class="loc-preview ${draft.newLoc ? '' : 'hidden'}">
          ${mi('location_on', 'fill')} <span id="np-loc-label">${esc(draft.newLocLabel || '')}</span>
          <button type="button" class="loc-clear" id="np-loc-clear" aria-label="Clear location">×</button>
        </div>
      </div>
    </div>

    <div class="divider"></div>
    <div class="section-title">Rate the safety</div>
    <div id="dim-stars"></div>

    <div class="divider"></div>
    <div class="section-title">Any concerns? (tap all that apply)</div>
    <div class="check-grid" id="incidents"></div>

    <div class="divider"></div>
    <div class="section-title">Context</div>
    <div class="field"><label>Time of visit</label><div class="seg" id="seg-time"></div></div>
    <div class="field"><label>Who were you with?</label><div class="seg" id="seg-comp"></div></div>
    <div class="field"><label>Date of visit</label><input type="date" id="visit-date" /></div>

    <div class="field"><label>Your review</label>
      <textarea id="review-text" rows="3" placeholder="Describe how the place felt…"></textarea>
    </div>

    <button class="btn" id="submit-rating">Post rating</button>
    <p class="helper" style="text-align:center;margin-top:12px">Posted live to everyone on <span class="brandname">her route</span>.</p>
  `;

  // dimension star ratings (1–5 per dimension, default 3)
  const DIM_STAR_COLORS = ['#e53e3e','#fb923c','#eab308','#65a30d','#16a34a'];
  $('#dim-stars').innerHTML = DIMENSIONS.map(d => `
    <div class="dim-star-row">
      <div class="dim-star-label">${mi(d.icon)} ${d.label}</div>
      <div class="dim-stars-wrap" data-dim="${d.key}" data-val="3">
        ${[1,2,3,4,5].map(n => `<button type="button" class="dim-star${n <= 3 ? ' on' : ''}" data-v="${n}">${mi('star')}</button>`).join('')}
      </div>
    </div>`).join('');
  $('#dim-stars').querySelectorAll('.dim-stars-wrap').forEach(group => {
    const btns = group.querySelectorAll('.dim-star');
    const applyVal = (v) => {
      group.dataset.val = v;
      btns.forEach(b => {
        const on = Number(b.dataset.v) <= v;
        b.classList.toggle('on', on);
        b.style.color = on ? DIM_STAR_COLORS[v - 1] : '';
      });
    };
    applyVal(3);
    btns.forEach(b => b.onclick = () => applyVal(Number(b.dataset.v)));
  });

  // incidents
  $('#incidents').innerHTML = INCIDENTS.map(i => `
    <label class="check" data-inc="${i.key}"><input type="checkbox" value="${i.key}" /> ${mi(i.icon)} ${i.label}</label>`).join('');
  $('#incidents').querySelectorAll('.check').forEach(c => {
    const cb = c.querySelector('input');
    cb.onchange = () => c.classList.toggle('on', cb.checked);
  });

  // segmented controls
  const buildSeg = (id, opts, def) => {
    const seg = $(id);
    seg.dataset.value = def;
    seg.innerHTML = opts.map(o => `<button type="button" class="${o === def ? 'on' : ''}" data-v="${o}">${o}</button>`).join('');
    seg.querySelectorAll('button').forEach(b => b.onclick = () => {
      seg.dataset.value = b.dataset.v;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    });
  };
  buildSeg('#seg-time', TIME_OPTIONS, 'Evening');
  buildSeg('#seg-comp', COMPANION_OPTIONS, 'Alone');
  $('#visit-date').value = new Date().toISOString().slice(0, 10);

  // new-place toggle
  const sel = $('#place-select');
  const toggleNew = () => $('#new-place-fields').classList.toggle('hidden', sel.value !== '__new__');
  sel.onchange = toggleNew;
  if (!draft.placeId) sel.value = '__new__';
  toggleNew();

  // Open map pin picker
  $('#np-pin-btn').onclick = () => {
    state.addDraft = state.addDraft || {};
    state.addDraft.npName = $('#np-name').value;
    state.addDraft.npType = $('#np-type').value;
    state._pinPickerActive = true;
    setView('map');
    openPinPicker();
  };

  // Clear pinned location
  $('#np-loc-clear').onclick = () => {
    if (state.addDraft) { state.addDraft.newLoc = null; state.addDraft.newLocLabel = ''; }
    $('#np-loc-preview').classList.add('hidden');
    $('#np-pin-btn').innerHTML = `${mi('location_on', 'fill')} Drop a pin on the map`;
  };

  $('#submit-rating').onclick = () => submitRating(() => (state.addDraft && state.addDraft.newLoc) || null);
}

async function submitRating(getLoc) {
  const sel = $('#place-select');
  const btn = $('#submit-rating');

  const dimensions = {};
  $('#dim-stars').querySelectorAll('.dim-stars-wrap').forEach(g => { dimensions[g.dataset.dim] = Number(g.dataset.val); });
  const incidents = [...$('#incidents').querySelectorAll('input:checked')].map(c => c.value);
  const visitDate = $('#visit-date').value ? new Date($('#visit-date').value).toISOString() : new Date().toISOString();

  // Use UID (Firebase mode) or email (local mode) as the user identifier.
  const userId = state.user.uid || state.user.email;

  const report = {
    id: uid(),
    userId,
    userName: state.user.name,
    dimensions,
    incidents,
    context: { time: $('#seg-time').dataset.value, companions: $('#seg-comp').dataset.value, date: visitDate },
    review: $('#review-text').value.trim(),
    createdAt: new Date().toISOString(),
  };

  let placeId;
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    if (sel.value === '__new__') {
      const name = $('#np-name').value.trim();
      if (!name) { toast('Please enter the place name'); btn.disabled = false; btn.textContent = 'Post rating'; return; }
      const loc = getLoc();
      if (!loc) { toast('Please drop a pin on the map first'); btn.disabled = false; btn.textContent = 'Post rating'; return; }
      placeId = uid();
      await Store.addPlace({
        id: placeId, name, type: $('#np-type').value,
        area: (state.addDraft && state.addDraft.npArea) || '',
        lat: loc[0], lng: loc[1], createdBy: userId, reports: [report],
      });
    } else {
      const place = state.places.find(p => p.id === sel.value);
      if (!place) { toast('Select a place'); btn.disabled = false; btn.textContent = 'Post rating'; return; }
      placeId = place.id;
      await Store.addReport(placeId, report);
    }
    toast('Thanks! Your rating is live ✨');
    state.addDraft = null;
    openDetail(placeId);
  } catch (e) {
    console.error(e);
    toast('Could not post — please try again');
    btn.disabled = false; btn.textContent = 'Post rating';
  }
}

/* ===================================================================
   PROFILE
   =================================================================== */
async function renderProfile() {
  const userId = state.user.uid || state.user.email;

  $('#view-profile').innerHTML = `
    <div class="profile-head">
      <div class="big-avatar">${esc(state.user.name[0].toUpperCase())}</div>
      <h2>${esc(state.user.name)}</h2>
      <div class="email">${esc(state.user.email)}</div>
      <div class="stat-row">
        <div class="stat-box"><b id="stat-ratings">–</b><span>Ratings</span></div>
        <div class="stat-box"><b id="stat-incidents">–</b><span>Moments shared</span></div>
        <div class="stat-box"><b>${state.places.length}</b><span>Places live</span></div>
      </div>
    </div>
    <div class="pad">
      <div class="section-title">Your contributions</div>
      <div id="profile-contribs"><div class="helper">Loading…</div></div>
      <div class="divider"></div>
      ${Store.mode === 'firebase' ? '' : `<button class="btn secondary" id="reset-demo">${mi('refresh')} Reset demo data</button>`}
      <button class="btn ghost" id="logout" style="margin-top:10px">${mi('logout')} Log out</button>
    </div>`;

  $('#logout').onclick = async () => {
    await Store.signOut();
    localStorage.removeItem(KEY_USER);
    location.reload();
  };
  const resetBtn0 = $('#reset-demo');
  if (resetBtn0) resetBtn0.onclick = async () => {
    if (confirm('Reset all places and ratings back to the demo seed data?')) {
      await Store.reset(); toast('Demo data reset'); setView('map');
    }
  };

  let myReports = [];
  try { myReports = await Store.getMyReports(userId, 100); } catch (e) { console.error(e); }
  if (state.view !== 'profile') return;

  const incidentsFlagged = myReports.reduce((sum, r) => sum + (r.incidentCount || 0), 0);
  const sr = $('#stat-ratings'); if (sr) sr.textContent = myReports.length;
  const si = $('#stat-incidents'); if (si) si.textContent = incidentsFlagged;

  const contribs = $('#profile-contribs');
  if (contribs) {
    contribs.innerHTML = myReports.length
      ? myReports.map(r => {
          const avg = mean(Object.values(r.dimensions));
          return `<div class="card" data-id="${r.placeId}">
            <div class="score-badge" style="background:${safetyColor(avg)}">
              <span class="num">${avg.toFixed(1)}</span><span class="of">/ 5</span>
            </div>
            <div class="card-body">
              <h3>${mi(typeInfo(r.placeType).icon)} ${esc(r.placeName || 'A place')}</h3>
              <div class="meta">${timeAgo(r.createdAt)} · ${esc(r.context ? r.context.time : '')}</div>
              ${r.review ? `<div class="meta" style="margin-top:4px">"${esc(r.review)}"</div>` : ''}
            </div>
          </div>`;
        }).join('')
      : `<div class="empty">${mi('rate_review')}You haven't rated anywhere yet.<br>Tap the ＋ button to add your first rating.</div>`;
    contribs.querySelectorAll('.card').forEach(c => c.onclick = () => openDetail(c.dataset.id));
  }
}

/* ===================================================================
   INCIDENT REPORTING — drop a pin, alert nearby women
   =================================================================== */
let _incidentSub = null;

function openIncidentOverlay() {
  if (state.view !== 'map') setView('map');
  const overlay = $('#incident-overlay');
  overlay.classList.remove('hidden');

  // Populate incident type chips (reuse INCIDENTS list from data.js)
  const typesEl = $('#inc-types');
  typesEl.innerHTML = INCIDENTS.map(i =>
    `<label class="check" data-inc="${i.key}">
       <input type="checkbox" value="${i.key}" /> ${mi(i.icon)} ${i.label}
     </label>`
  ).join('');
  typesEl.querySelectorAll('.check').forEach(c => {
    const cb = c.querySelector('input');
    cb.onchange = () => {
      c.classList.toggle('on', cb.checked);
      const any = typesEl.querySelectorAll('input:checked').length > 0;
      $('#submit-incident').disabled = !any;
    };
  });
  $('#inc-note').value = '';
  $('#submit-incident').disabled = true;
  $('#submit-incident').innerHTML = `${mi('campaign')} Share with nearby women`;

  // Pan to current GPS location so pin starts at a sensible place
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (state.map) state.map.setView([pos.coords.latitude, pos.coords.longitude], 16); },
      () => {},
      FAST_GPS_OPTS
    );
  }
}

function closeIncidentOverlay() {
  $('#incident-overlay').classList.add('hidden');
}

async function submitIncident() {
  const types = [...$('#inc-types').querySelectorAll('input:checked')].map(c => c.value);
  if (!types.length) { toast('Select at least one incident type'); return; }

  const note  = ($('#inc-note').value || '').trim().slice(0, 280);
  const { lat, lng } = state.map.getCenter();
  const btn   = $('#submit-incident');
  btn.disabled = true;
  btn.innerHTML = `${mi('hourglass_empty')} Sending…`;

  try {
    const incident = {
      id:        uid(),
      lat, lng,
      geohash:   Geo.encode(lat, lng, 9),
      types,
      note,
      userId:    state.user.uid || state.user.email,
      userName:  state.user.name,
      createdAt: new Date().toISOString(),
    };
    await Store.addIncident(incident);
    closeIncidentOverlay();
    toast('Shared — nearby women will see this');
    // Good moment to request notification permission (user gesture unlocks the prompt).
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') setupFcmPush();
      });
    } else if (Notification.permission === 'granted') {
      setupFcmPush();
    }
  } catch (e) {
    console.error(e);
    toast('Could not send alert — please try again');
    btn.disabled = false;
    btn.innerHTML = `${mi('campaign')} Send alert to nearby women`;
  }
}

// Render a single red incident marker on the map.
function addIncidentMarker(incident) {
  if (!state.incidentMarkers) return;
  const types = (incident.types || [])
    .map(k => INCIDENTS.find(i => i.key === k)?.label).filter(Boolean).join(', ');
  const icon = L.divIcon({
    className: 'inc-map-pin',
    html: `<span class="material-symbols-outlined" style="color:#fb923c;font-size:26px;font-variation-settings:'FILL' 1">campaign</span>`,
    iconSize: [30, 30], iconAnchor: [15, 26], popupAnchor: [0, -22],
  });
  L.marker([incident.lat, incident.lng], { icon })
    .bindPopup(`<div class="map-pop">
      <b>${esc(types || 'Something was shared here')}</b>
      <div class="row">${timeAgo(incident.createdAt)}</div>
      ${incident.note ? `<div class="row">${esc(incident.note)}</div>` : ''}
      <div class="row" style="opacity:.65">Shared by ${esc(incident.userName || 'Anonymous')}</div>
    </div>`)
    .addTo(state.incidentMarkers);
}

// Fetch the last 30 incidents and add pins for all of them.
async function loadRecentIncidentMarkers() {
  if (Store.mode !== 'firebase') return;
  try {
    const incidents = await Store.getRecentIncidents(30);
    incidents.forEach(addIncidentMarker);
  } catch (e) { console.error('[Her Route] Incident marker load:', e); }
}

// Subscribe to new incidents nearby and surface them as toast + browser notification.
// Only incidents posted AFTER the subscription starts trigger alerts.
function startIncidentAlerts() {
  if (_incidentSub) { _incidentSub(); _incidentSub = null; }
  const loc = loadLoc();
  if (!loc || Store.mode !== 'firebase') return;

  _incidentSub = Store.subscribeNearbyIncidents(loc.lat, loc.lng, 5, (incident) => {
    const myId = state.user?.uid || state.user?.email;
    if (incident.userId === myId) return;
    const types = (incident.types || [])
      .map(k => INCIDENTS.find(i => i.key === k)?.label).filter(Boolean).join(', ');
    toast(`Heads up nearby: ${types || 'Something was shared'}`);
    _showNotification('her route · heads up', types || 'A woman shared something nearby');
    addIncidentMarker(incident); // also pin it on the map in real-time
  });
}

// Shows a browser notification via the service worker (works in background tabs).
// True offline push (browser closed) is handled by FCM + the Cloud Function.
function _showNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: '/assets/icon.png', badge: '/assets/icon.png',
                 tag: 'her-route-incident', vibrate: [200, 100, 200], requireInteraction: false };
  if (state.swReg) {
    state.swReg.showNotification(title, opts).catch(() => new Notification(title, opts));
  } else {
    new Notification(title, opts);
  }
}

// Register this browser with FCM and store the token so the Cloud Function
// can include this device in proximity fan-out when incidents are posted.
async function setupFcmPush() {
  if (!state.user?.uid) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  await Store.setupFcm(state.user.uid, state.swReg);
}

// Returns the SW registration (null if not supported). Stored in state.swReg.
async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); }
  catch (e) { console.warn('[Her Route] SW registration failed:', e); return null; }
}

/* ===================================================================
   BOOT
   =================================================================== */
function refreshAll() {
  // Map is always initialised before places arrive (done in enterApp).
  if (state.map) renderMarkers();
  if (state.view === 'explore') renderExplore();
  if (state.view === 'detail' && state.selectedId) openDetail(state.selectedId);
  if (state.view === 'alerts') renderAlerts();
  if (state.view === 'profile') renderProfile();
}

// Debounced wrapper called on Leaflet moveend / zoomend.
let _vpTimer = null;
function _triggerViewport() {
  clearTimeout(_vpTimer);
  _vpTimer = setTimeout(() => {
    if (!state.map) return;
    const b = state.map.getBounds();
    Store.setViewport(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  }, 400);
}

async function enterApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  initNav();

  const search = $('#search');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    let _st = null;
    search.addEventListener('input', () => {
      clearTimeout(_st);
      _st = setTimeout(() => { state.search = search.value; renderExplore(); }, 120);
    });
  }

  setView('map');

  // Register the store callback (no Firestore listeners started yet in firebase mode).
  await Store.start((places) => { state.places = places; refreshAll(); });

  // Initialise the map now (it needs to exist before viewport queries fire).
  initMap();
  state.swReg = await initServiceWorker();
  startIncidentAlerts();
  loadRecentIncidentMarkers(); // paint historical incident pins on the map
  if (Notification.permission === 'granted') setupFcmPush();

  toast(Store.mode === 'firebase'
    ? '🔥 Connected — live across all users'
    : '💾 Local demo mode (add Firebase keys to go live)');

  // Kick off the first viewport query using the map's initial bounds.
  if (Store.mode === 'firebase' && state.map) {
    const b = state.map.getBounds();
    Store.setViewport(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  }

  // Onboarding gate: new users must rate their locality + a few places before the app unlocks.
  let needsOnboarding = false;
  if (Store.mode === 'firebase' && state.user.uid) {
    try {
      const userDoc = await Store.getUserDoc(state.user.uid);
      needsOnboarding = !userDoc || userDoc.onboarded === false;
    } catch (e) {
      console.warn('[Her Route] Could not read user doc:', e);
    }
  } else if (Store.mode === 'local') {
    const acct = loadUsers()[state.user.email];
    needsOnboarding = acct && acct.onboarded === false;
  }

  if (needsOnboarding && window.Onboarding) {
    Onboarding.begin({
      user: state.user,
      getPlaces: () => state.places,
      markDone: async () => {
        if (Store.mode === 'firebase' && state.user.uid) {
          await Store.setUserDoc(state.user.uid, { onboarded: true });
        } else {
          const users = loadUsers();
          if (users[state.user.email]) { users[state.user.email].onboarded = true; saveUsers(users); }
        }
        const loc = loadLoc();
        if (loc && state.map) state.map.setView([loc.lat, loc.lng], 13);
        updateCityPill();
      },
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initAuth();
  await Store.init();

  if (Store.mode === 'firebase') {
    // listenAuth fires once immediately with the current user (or null).
    // We call enterApp() first (hides auth, shows map shell) then fade the splash
    // so users never see a raw auth-form flash on returning visits.
    Store.listenAuth((fbUser) => {
      if (fbUser && !state.user) {
        state.user = fbUser;
        enterApp();
      }
      hideSplash();
    });
    // Safety net: reveal auth form if onAuthStateChanged stalls for > 5 s.
    setTimeout(hideSplash, 5000);
  } else {
    // Local demo mode: auth state is instant (localStorage).
    state.user = loadUser();
    if (state.user) enterApp();
    hideSplash();
  }
});
