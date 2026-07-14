/* =========================================================================
   Her Route — Firebase configuration TEMPLATE
   =========================================================================
   
   INSTRUCTIONS:
   1. Copy this file: cp js/firebase-config.template.js js/firebase-config.js
   2. Fill in your Firebase config values from Firebase Console
   3. Do NOT commit js/firebase-config.js — it's in .gitignore
   
   ========================================================================= */

window.FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY_HERE",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID",

  // FCM Web Push — Get from Firebase Console → Project Settings → Cloud Messaging
  vapidKey: "YOUR_VAPID_PUBLIC_KEY",

  // App Check — Get from https://www.google.com/recaptcha/admin/create (reCAPTCHA v3)
  appCheckSiteKey: "YOUR_RECAPTCHA_SITE_KEY",
};
