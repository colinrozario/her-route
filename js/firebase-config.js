/* =========================================================================
   Her Route — Firebase configuration
   -------------------------------------------------------------------------
   PASTE YOUR FIREBASE WEB CONFIG BELOW.

   How to get it (one-time, free, ~3 minutes):
     1. Go to  https://console.firebase.google.com  and click "Add project".
        Name it e.g. "her-route". You can skip Google Analytics.
     2. In the project, click the </> "Web" icon to register a web app
        (nickname e.g. "her-route-web"). Firebase Hosting is optional — skip it.
     3. It shows a "firebaseConfig" object. Copy those values into the object below.
     4. In the left menu open  Build → Firestore Database → Create database.
        Choose a location, then pick "Start in test mode" (fine for now).
     5. Reload the app. You'll see "🔥 Connected — live across all users".

   Until you paste real values, the app runs in local demo mode automatically.
   ========================================================================= */
window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBM5Jxf0TfGRb84sow3UNZZkI6gO0DS4WM",
  authDomain:        "her-route-590a0.firebaseapp.com",
  projectId:         "her-route-590a0",
  storageBucket:     "her-route-590a0.firebasestorage.app",
  messagingSenderId: "1032820984499",
  appId:             "1:1032820984499:web:ba0fd3d89768d85bffbec6",
  measurementId:     "G-6WBWNYFNLY",

  // FCM Web Push — paste your VAPID public key here.
  // Get it at: Firebase Console → Project Settings → Cloud Messaging
  //   → Web Push certificates → Generate key pair  (copy the Key string)
  // Leave as-is until you have a key; FCM token registration is skipped when this is the placeholder.
  vapidKey: "BJ5U3_VKbLx-VZ3iSZHyUMJp3uduEW94ZTGzBwiXKYOfD9a4zl9EgsDWKWo8vWxg7tXZjcU1pJAwN2xmyiBEeDI",

  // App Check — paste your reCAPTCHA v3 site key here.
  // Get one at: https://www.google.com/recaptcha/admin/create
  //   Type: reCAPTCHA v3  |  Domains: her-route-590a0.web.app, localhost
  // Then register it in Firebase Console → App Check → Apps → her-route-web.
  // Leave as-is until you have a key; App Check is skipped when this is the placeholder.
  appCheckSiteKey: "6LcRfiYtAAAAAB_kNDUXUR-MYmyaZ-LiHbi60Mi4",
};
