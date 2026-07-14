/* Her Route — Service Worker
   Handles Firebase Cloud Messaging background push so users are notified
   of nearby incidents even when the app tab is closed. */

importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyBM5Jxf0TfGRb84sow3UNZZkI6gO0DS4WM',
  authDomain:        'her-route-590a0.firebaseapp.com',
  projectId:         'her-route-590a0',
  storageBucket:     'her-route-590a0.firebasestorage.app',
  messagingSenderId: '1032820984499',
  appId:             '1:1032820984499:web:ba0fd3d89768d85bffbec6',
});

const messaging = firebase.messaging();

// Called by FCM when a push arrives while the tab is in the background or closed.
messaging.onBackgroundMessage((payload) => {
  const n     = payload.notification || {};
  const title = n.title || 'her route · heads up';
  const body  = n.body  || 'A woman shared something nearby';
  self.registration.showNotification(title, {
    body,
    icon:    '/assets/icon.png',
    badge:   '/assets/icon.png',
    tag:     'her-route-incident',
    vibrate: [200, 100, 200],
    requireInteraction: false,
    data: payload.data || {},
  });
});

self.addEventListener('install',  ()  => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    })
  );
});
