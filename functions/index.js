/**
 * Her Route — Cloud Function: notifyNearbyUsers
 *
 * Fires whenever a new document is written to the `incidents` collection.
 * Finds all users within 5 km who have an FCM token stored, and sends
 * them a Web Push notification via Firebase Cloud Messaging.
 *
 * Requirements:
 *   - Firebase project on Blaze (pay-as-you-go) plan
 *   - Run: firebase init functions  (from the her-route/ directory)
 *   - Run: firebase deploy --only functions
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging }      = require('firebase-admin/messaging');

initializeApp();

const INCIDENT_LABELS = {
  staring:           'Unwanted Staring',
  catcalling:        'Catcalling',
  verbal:            'Verbal Harassment',
  followed:          'Being Followed',
  physical:          'Physical Harassment',
  intimidation:      'Intimidation / Threatening',
  theft:             'Theft / Pickpocketing',
  transportIncident: 'Unsafe Transport Experience',
};

// Standard geohash encode — mirrors js/geo.js
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohashEncode(lat, lng, precision) {
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

function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.notifyNearbyUsers = onDocumentCreated('incidents/{incidentId}', async (event) => {
  const incident = event.data.data();
  const { lat, lng, types = [], userName = 'A user', userId } = incident;

  const db        = getFirestore();
  const messaging = getMessaging();

  // Query only users whose stored geohash4 cell neighbours the incident cell.
  // geohash precision 4 ≈ 40 km cells — then we distance-filter to 5 km exactly.
  // This replaces a full-collection scan with a bounded geohash range query.
  const cell = geohashEncode(lat, lng, 4);
  const snap = await db.collection('users')
    .where('geohash4', '>=', cell)
    .where('geohash4', '<',  cell + '￿')
    .where('fcmToken', '!=', '')
    .get();

  const tokens = [];
  snap.docs.forEach(doc => {
    const u = doc.data();
    if (!u.fcmToken || u.lat == null || u.lng == null) return;
    if (doc.id === userId) return;                          // don't notify the poster
    if (distKm(lat, lng, u.lat, u.lng) <= 5) tokens.push(u.fcmToken);
  });

  if (!tokens.length) return;

  const typeText = types.map(k => INCIDENT_LABELS[k] || k).join(', ') || 'Incident';

  // FCM multicast is capped at 500 tokens per call — batch if needed.
  for (let i = 0; i < tokens.length; i += 500) {
    await messaging.sendEachForMulticast({
      tokens: tokens.slice(i, i + 500),
      notification: {
        title: '⚠️ Safety alert near you — her route',
        body:  `${typeText} reported by ${userName}`,
      },
      webpush: {
        notification: {
          icon:               'https://her-route-590a0.web.app/assets/icon.png',
          badge:              'https://her-route-590a0.web.app/assets/icon.png',
          tag:                'her-route-incident',
          vibrate:            [200, 100, 200],
          requireInteraction: false,
        },
        fcm_options: { link: 'https://her-route-590a0.web.app' },
      },
    });
  }

  console.log(`[Her Route] Push sent to ${tokens.length} nearby user(s) for incident ${event.params.incidentId}`);
});
