/* =========================================================================
   Her Route — Store (scalable model)
   -------------------------------------------------------------------------
   Data model:
     places/{placeId}                  -> metadata + small `snapshot`
     places/{placeId}/reports/{id}     -> individual reports (denormalised)
     users/{uid}                       -> per-user state (onboarded flag, etc.)

   The map/list only ever read the small place docs (with their snapshot).
   Reports are read lazily (detail view) or via collection-group queries
   (alerts feed, "your contributions"). Snapshots are updated client-side in
   a transaction on write — no Cloud Functions / Blaze plan required.

   Uses Firestore when js/firebase-config.js has real keys; otherwise a
   localStorage demo mirror exposing the same interface.
   ========================================================================= */
const Store = (() => {
  const LOCAL_KEY = 'herroute_places';
  const PING = 'herroute_ping';
  const DIMS = window.HR.DIMENSIONS;
  let mode = 'local';
  let fb = null;          // firebase module refs once loaded
  let emit = () => {};
  let cache = [];         // place metadata (+snapshot); never holds reports in firebase mode

  const seedData = () => window.HR.buildSeedPlaces();
  const snapshotOf = (reports) => window.HR.computeStoredSnapshot(reports);

  // Strip the heavy reports array off a place; keep metadata + snapshot.
  function placeMeta(p, snapshot) {
    return {
      id: p.id, name: p.name, type: p.type, lat: p.lat, lng: p.lng,
      area: p.area || '', createdBy: p.createdBy || 'seed',
      createdAt: p.createdAt || new Date().toISOString(),
      snapshot: snapshot || snapshotOf(p.reports || []),
    };
  }

  // Denormalise a report so alerts/contribution feeds need no extra reads.
  function enrich(report, place) {
    return {
      ...report,
      placeId: place.id,
      placeName: place.name,
      placeType: place.type,
      area: place.area || '',
      incidentCount: report.incidents ? report.incidents.length : 0,
      hasIncident: !!(report.incidents && report.incidents.length),
    };
  }

  /* ---------------- local mode helpers ---------------- */
  function localLoad() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) { const s = seedData(); localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); return s; }
    try { return JSON.parse(raw); } catch { return seedData(); }
  }
  let localPlaces = [];   // full places incl. reports (local mode only)
  function localSave() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(localPlaces));
    localStorage.setItem(PING, Date.now().toString());
  }
  function localEmit() {
    cache = localPlaces.map(p => placeMeta(p));
    emit(cache);
  }

  /* ---------------- init: load Firebase modules ---------------- */
  async function init() {
    const cfg = window.FIREBASE_CONFIG;
    const ready = cfg && cfg.apiKey && !String(cfg.apiKey).startsWith('PASTE');
    if (!ready) { mode = 'local'; return mode; }
    try {
      const [appMod, fsMod, authMod, checkMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js'),
      ]);

      const app = appMod.initializeApp(cfg);

      // ── App Check ────────────────────────────────────────────────────────
      // Protects Firestore from non-browser clients (bots, scrapers, scripts).
      // On localhost a debug token is auto-generated and printed to the console;
      // register it in Firebase Console → App Check → Apps → Manage debug tokens.
      // Skipped entirely when the placeholder site key hasn't been replaced yet.
      const siteKey = cfg.appCheckSiteKey;
      if (siteKey && !String(siteKey).startsWith('PASTE')) {
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isLocal) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        try {
          checkMod.initializeAppCheck(app, {
            provider: new checkMod.ReCaptchaV3Provider(siteKey),
            isTokenAutoRefreshEnabled: true,
          });
          console.info('[Her Route] App Check active' + (isLocal ? ' (debug mode)' : ''));
        } catch (acErr) {
          console.warn('[Her Route] App Check init failed — continuing without it.', acErr);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      fb = {
        app,
        db: fsMod.getFirestore(app),
        auth: authMod.getAuth(app),
        ...fsMod,
        // auth functions (explicit to avoid name collisions with fsMod spread)
        onAuthStateChanged: authMod.onAuthStateChanged,
        createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
        signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
        signInWithPopup: authMod.signInWithPopup,
        GoogleAuthProvider: authMod.GoogleAuthProvider,
        signOutFb: authMod.signOut,
        updateProfile: authMod.updateProfile,
      };
      mode = 'firebase';
    } catch (e) {
      console.error('[Her Route] Firebase failed to load — using local demo mode.', e);
      mode = 'local';
    }
    return mode;
  }

  /* ============================================================
     AUTH (Firebase mode only)
     ============================================================ */

  // Register a callback that fires whenever Firebase auth state changes.
  // Called immediately with the current user (or null) on registration.
  function listenAuth(cb) {
    if (mode !== 'firebase') return;
    const { auth, onAuthStateChanged } = fb;
    onAuthStateChanged(auth, (u) => {
      cb(u ? _fbUserToObj(u) : null);
    });
  }

  function _fbUserToObj(u) {
    return { uid: u.uid, name: u.displayName || u.email.split('@')[0], email: u.email };
  }

  async function signUp(name, email, password) {
    const { auth, createUserWithEmailAndPassword, updateProfile } = fb;
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    // Persist onboarding flag in Firestore so it survives device switches.
    await setUserDoc(cred.user.uid, { onboarded: false, name, email, createdAt: new Date().toISOString() });
    return { uid: cred.user.uid, name, email };
  }

  async function signIn(email, password) {
    const { auth, signInWithEmailAndPassword } = fb;
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return _fbUserToObj(cred.user);
  }

  async function signInGoogle() {
    const { auth, signInWithPopup, GoogleAuthProvider } = fb;
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const u = cred.user;
    // Create user doc for new Google users (existing users get merge: true which is safe).
    const existing = await getUserDoc(u.uid);
    if (!existing) {
      await setUserDoc(u.uid, {
        onboarded: false,
        name: u.displayName || u.email.split('@')[0],
        email: u.email,
        createdAt: new Date().toISOString(),
      });
    }
    return _fbUserToObj(u);
  }

  async function signOut() {
    if (mode !== 'firebase') return;
    const { auth, signOutFb } = fb;
    await signOutFb(auth);
  }

  /* ============================================================
     USER DOC  (onboarding state, preferences)
     ============================================================ */

  async function getUserDoc(uid) {
    if (mode !== 'firebase') return null;
    const { db, doc, getDoc } = fb;
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  }

  async function setUserDoc(uid, data) {
    if (mode !== 'firebase') return;
    const { db, doc, setDoc } = fb;
    await setDoc(doc(db, 'users', uid), data, { merge: true });
  }

  /* ============================================================
     PLACES — viewport-driven spatial loading
     ============================================================
     Firebase mode: start() just registers the callback. The map then calls
     setViewport() which runs geohash range queries for the visible area.
     Places accumulate in _placeMap (LRU-evicted at 2000 entries) so panning
     doesn't clear the screen.

     Local mode: unchanged — all places loaded at once from localStorage.
     ============================================================ */

  const _placeMap = new Map();    // id → place doc (cross-viewport cache)
  let   _vpSubs   = [];           // active Firestore unsubscribe functions
  let   _emitTimer = null;

  function _flushCache() {
    // Evict oldest entries once the in-memory cache grows very large.
    if (_placeMap.size > 2000) {
      const excess = _placeMap.size - 2000;
      let i = 0;
      for (const k of _placeMap.keys()) {
        _placeMap.delete(k);
        if (++i >= excess) break;
      }
    }
    cache = [..._placeMap.values()];
    emit(cache);
  }

  async function start(onPlaces) {
    emit = onPlaces;
    if (mode === 'firebase') {
      // Nothing to do here — map calls setViewport() once it's ready.
      return;
    }
    // Local demo mode: load everything from localStorage.
    localPlaces = localLoad();
    localEmit();
    window.addEventListener('storage', (e) => {
      if (e.key === PING || e.key === LOCAL_KEY) { localPlaces = localLoad(); localEmit(); }
    });
  }

  // Called by the map whenever the viewport changes (debounced in app.js).
  // Cancels previous listeners, starts new geohash range queries for the
  // visible area, and merges results into the shared place cache.
  let _fallbackDone = false;
  async function setViewport(south, west, north, east) {
    if (mode !== 'firebase') return;

    // Cancel previous viewport listeners.
    _vpSubs.forEach(u => u());
    _vpSubs = [];

    const { db, collection, query, where, limit: fsLimit, onSnapshot, getDocs } = fb;
    const { cells } = Geo.cellsForBbox(south, west, north, east);
    let firstFire = true;

    cells.forEach(cell => {
      const q = query(
        collection(db, 'places'),
        where('geohash', '>=', cell),
        where('geohash', '<',  cell + '￿'),
        fsLimit(300)
      );
      const unsub = onSnapshot(
        q,
        (qs) => {
          qs.docs.forEach(d => _placeMap.set(d.id, d.data()));
          // Debounce so multiple simultaneous cell results produce one render.
          clearTimeout(_emitTimer);
          _emitTimer = setTimeout(() => {
            // Graceful fallback: if the first wave of geohash queries returns
            // nothing (existing docs predate the geohash field), load the full
            // collection once so the map isn't blank before migration runs.
            if (firstFire && _placeMap.size === 0 && !_fallbackDone) {
              _fallbackDone = true;
              getDocs(collection(db, 'places')).then(snap => {
                snap.docs.forEach(d => _placeMap.set(d.id, d.data()));
                _flushCache();
              }).catch(console.error);
            } else {
              _flushCache();
            }
            firstFire = false;
          }, 80);
        },
        (err) => console.error('[Her Route] Geo query error:', err)
      );
      _vpSubs.push(unsub);
    });
  }

  /* ---------------- add a brand-new place (with its first report) ---------------- */
  async function addPlace(place) {
    const reports = place.reports || [];
    if (mode === 'firebase') {
      const { db, doc, collection, writeBatch } = fb;
      const batch = writeBatch(db);
      // Always stamp geohash so the place appears in spatial queries.
      const meta = { ...placeMeta(place), geohash: Geo.encode(place.lat, place.lng, 9) };
      batch.set(doc(db, 'places', place.id), meta);
      reports.forEach(r => batch.set(doc(collection(db, 'places', place.id, 'reports'), r.id), enrich(r, place)));
      await batch.commit();
      _placeMap.set(place.id, meta);
      cache = [..._placeMap.values()];
      emit(cache);
    } else {
      localPlaces.push(place);
      localSave();
      localEmit();
    }
  }

  /* ---------------- append a report to an existing place ---------------- */
  async function addReport(placeId, report) {
    if (mode === 'firebase') {
      const { db, doc, collection, runTransaction, serverTimestamp } = fb;
      const meta = cache.find(p => p.id === placeId) || { id: placeId, name: '', type: '', area: '' };
      const enriched = enrich(report, meta);
      await runTransaction(db, async (tx) => {
        const pref = doc(db, 'places', placeId);
        const psnap = await tx.get(pref);
        const data = psnap.data() || {};
        const s = data.snapshot || { count: 0, sums: {}, incidentTotal: 0, lastReportAt: null };
        s.count = (s.count || 0) + 1;
        DIMS.forEach(d => s.sums[d.key] = (s.sums[d.key] || 0) + (report.dimensions[d.key] || 0));
        s.incidentTotal = (s.incidentTotal || 0) + (report.incidents ? report.incidents.length : 0);
        s.lastReportAt = report.createdAt;
        tx.update(pref, { snapshot: s });
        tx.set(doc(collection(db, 'places', placeId, 'reports'), report.id), enriched);
        // Stamp lastReportAt on the user doc so rate-limit rules can check it.
        tx.set(doc(db, 'users', report.userId), { lastReportAt: serverTimestamp() }, { merge: true });
      });
      // optimistic local snapshot bump
      const p = cache.find(x => x.id === placeId);
      if (p) {
        const s = p.snapshot || { count: 0, sums: {}, incidentTotal: 0, lastReportAt: null };
        s.count++; DIMS.forEach(d => s.sums[d.key] = (s.sums[d.key] || 0) + (report.dimensions[d.key] || 0));
        s.incidentTotal += enriched.incidentCount; s.lastReportAt = report.createdAt;
        emit(cache);
      }
    } else {
      const p = localPlaces.find(x => x.id === placeId);
      if (p) { p.reports = [...(p.reports || []), report]; localSave(); localEmit(); }
    }
  }

  /* ---------------- read a place's recent reports (detail view) ---------------- */
  async function getReports(placeId, max = 100) {
    if (mode === 'firebase') {
      const { db, collection, query, orderBy, limit, getDocs } = fb;
      const q = query(collection(db, 'places', placeId, 'reports'), orderBy('createdAt', 'desc'), limit(max));
      const qs = await getDocs(q);
      return qs.docs.map(d => d.data());
    }
    const p = localPlaces.find(x => x.id === placeId);
    return (p ? (p.reports || []) : [])
      .map(r => enrich(r, p))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /* ---------------- recent incidents across all places (alerts feed) ---------------- */
  async function getAlerts(max = 45) {
    if (mode === 'firebase') {
      const { db, collectionGroup, query, where, orderBy, limit, getDocs } = fb;
      const q = query(collectionGroup(db, 'reports'), where('hasIncident', '==', true), orderBy('createdAt', 'desc'), limit(max));
      const qs = await getDocs(q);
      return qs.docs.map(d => d.data());
    }
    const out = [];
    localPlaces.forEach(p => (p.reports || []).forEach(r => { if (r.incidents && r.incidents.length) out.push(enrich(r, p)); }));
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, max);
  }

  /* ---------------- a user's own reports (profile) ---------------- */
  async function getMyReports(userId, max = 100) {
    if (mode === 'firebase') {
      const { db, collectionGroup, query, where, orderBy, limit, getDocs } = fb;
      const q = query(collectionGroup(db, 'reports'), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(max));
      const qs = await getDocs(q);
      return qs.docs.map(d => d.data());
    }
    const out = [];
    localPlaces.forEach(p => (p.reports || []).forEach(r => { if (r.userId === userId) out.push(enrich(r, p)); }));
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, max);
  }

  /* ============================================================
     INCIDENTS — quick location-based alerts
     ============================================================ */

  // Recent incidents globally, newest first (for Alerts tab + map pins).
  async function getRecentIncidents(max = 30) {
    if (mode !== 'firebase') return [];
    const { db, collection, query, orderBy, limit, getDocs } = fb;
    const q = query(collection(db, 'incidents'), orderBy('createdAt', 'desc'), limit(max));
    const qs = await getDocs(q);
    return qs.docs.map(d => d.data());
  }

  // Persist the user's GPS coordinates so the Cloud Function can find nearby users.
  async function setUserLocation(uid, lat, lng) {
    if (mode !== 'firebase') return;
    const { db, doc, setDoc } = fb;
    await setDoc(doc(db, 'users', uid), {
      lat, lng,
      geohash4: Geo.encode(lat, lng, 4),
      locationUpdatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  // Register this browser for FCM Web Push. Stores the token in users/{uid}.
  // Returns the token string, or null if vapidKey is not configured.
  async function setupFcm(uid, swReg) {
    if (mode !== 'firebase') return null;
    const vapidKey = (window.FIREBASE_CONFIG || {}).vapidKey;
    if (!vapidKey || String(vapidKey).startsWith('PASTE')) return null;
    try {
      const msgMod = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js');
      const messaging = msgMod.getMessaging(fb.app);
      const opts = { vapidKey };
      if (swReg) opts.serviceWorkerRegistration = swReg;
      const token = await msgMod.getToken(messaging, opts);
      if (token) await setUserDoc(uid, { fcmToken: token });
      return token || null;
    } catch (e) {
      console.warn('[Her Route] FCM token error:', e.code || e.message);
      return null;
    }
  }

  async function addIncident(incident) {
    if (mode !== 'firebase') {
      console.log('[Her Route] Local mode: incident logged', incident);
      return;
    }
    const { db, doc, collection, setDoc, serverTimestamp } = fb;
    await setDoc(doc(collection(db, 'incidents'), incident.id), incident);
    // Stamp lastReportAt on the user doc so rate-limit rules can check it.
    await setDoc(doc(db, 'users', incident.userId), { lastReportAt: serverTimestamp() }, { merge: true });
  }

  // Calls onNew(incident) for every incident posted within ~radiusKm of lat/lng
  // AFTER the subscription starts (existing incidents are silently ignored).
  // Returns an unsubscribe function.
  function subscribeNearbyIncidents(lat, lng, radiusKm, onNew) {
    if (mode !== 'firebase') return () => {};
    const { db, collection, query, where, limit: fsLimit, onSnapshot } = fb;
    const deg = radiusKm / 111;
    const { cells } = Geo.cellsForBbox(lat - deg, lng - deg * 1.4, lat + deg, lng + deg * 1.4);
    const startTime = new Date().toISOString();
    const seen = new Set();
    const subs = cells.map(cell => {
      const q = query(
        collection(db, 'incidents'),
        where('geohash', '>=', cell),
        where('geohash', '<', cell + '￿'),
        fsLimit(50)
      );
      return onSnapshot(q, (qs) => {
        qs.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const inc = change.doc.data();
          if (!seen.has(inc.id) && inc.createdAt > startTime) {
            seen.add(inc.id);
            onNew(inc);
          }
        });
      }, (err) => console.error('[Her Route] Incident sub error:', err));
    });
    return () => subs.forEach(u => u());
  }

  /* ---------------- wipe back to seed (local only) ---------------- */
  async function reset() {
    if (mode === 'firebase') return; // cloud reset is admin-only (rules forbid client deletes)
    localStorage.removeItem(LOCAL_KEY);
    localPlaces = localLoad();
    localStorage.setItem(PING, Date.now().toString());
    localEmit();
  }

  return {
    init, start, setViewport,
    listenAuth, signUp, signIn, signInGoogle, signOut,
    getUserDoc, setUserDoc,
    addPlace, addReport, getReports, getAlerts, getMyReports,
    getRecentIncidents, setUserLocation, setupFcm,
    addIncident, subscribeNearbyIncidents,
    reset,
    get mode() { return mode; },
  };
})();
window.Store = Store;
