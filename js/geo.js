/* =========================================================================
   Her Route — Geohash utilities
   -------------------------------------------------------------------------
   Provides:
     Geo.encode(lat, lng, precision)   → geohash string
     Geo.cellsForBbox(s, w, n, e)      → { cells: string[], precision: int }
     Geo.distKm(lat1, lng1, lat2, lng2)→ number

   Used by Store.setViewport() to translate a Leaflet map viewport into a set
   of Firestore geohash range queries, so only nearby places are loaded.
   No external dependencies.
   ========================================================================= */
const Geo = (() => {
  const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

  // Standard geohash encoding (alternates longitude / latitude bits).
  function encode(lat, lng, precision = 9) {
    let idx = 0, bit = 0, even = true, hash = '';
    let s = -90, n = 90, w = -180, e = 180;
    while (hash.length < precision) {
      if (even) {
        const m = (w + e) / 2;
        if (lng >= m) { idx = (idx << 1) | 1; w = m; } else { idx <<= 1; e = m; }
      } else {
        const m = (s + n) / 2;
        if (lat >= m) { idx = (idx << 1) | 1; s = m; } else { idx <<= 1; n = m; }
      }
      even = !even;
      if (++bit === 5) { hash += B32[idx]; bit = 0; idx = 0; }
    }
    return hash;
  }

  // Haversine distance in kilometres.
  function distKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Pick cell precision based on viewport diagonal.
  // Geohash cell sizes (approx):  2→1250km  3→156km  4→39km  5→4.9km  6→1.2km  7→153m
  function _precision(diagKm) {
    if (diagKm > 2500) return 2;
    if (diagKm > 600)  return 3;
    if (diagKm > 120)  return 4;
    if (diagKm > 25)   return 5;
    if (diagKm > 5)    return 6;
    return 7;
  }

  // Sample a 5×5 grid across the viewport and return the unique geohash cells
  // that cover it.  Each cell becomes one Firestore range query:
  //   where('geohash', '>=', cell).where('geohash', '<', cell + '￿')
  function cellsForBbox(south, west, north, east) {
    const diagKm = distKm(south, west, north, east);
    const precision = _precision(diagKm);
    const cells = new Set();
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        cells.add(encode(
          south + (north - south) * i / 4,
          west  + (east  - west)  * j / 4,
          precision
        ));
      }
    }
    return { cells: [...cells], precision };
  }

  return { encode, distKm, cellsForBbox };
})();
window.Geo = Geo;
