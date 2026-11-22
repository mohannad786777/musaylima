// Service Worker für Offline-Funktionalität
const CACHE_NAME = 'musaylima-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './musaylima.jpeg',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
  './data.json'
];

// Installation - Cache alle wichtigen Dateien
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache geöffnet');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Aktivierung - Alte Caches löschen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Alter Cache gelöscht:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - Cache-First für lokale Dateien, Network-First für externe
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // YouTube und externe Ressourcen - immer Netzwerk
  if (url.hostname.includes('youtube') || 
      url.hostname.includes('google') ||
      url.hostname.includes('gstatic')) {
    return;
  }
  
  // Lokale Dateien - Cache-First
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Im Hintergrund aktualisieren
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone());
              });
            }
          }).catch(() => {});
          return cachedResponse;
        }
        
        // Nicht im Cache - vom Netzwerk holen und cachen
        return fetch(event.request).then(networkResponse => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          
          return networkResponse;
        });
      })
      .catch(() => {
        // Offline und nicht im Cache
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      })
  );
});

// Nachricht vom Client empfangen (z.B. für Cache-Update)
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
