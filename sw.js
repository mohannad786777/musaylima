// Service Worker für Offline-Funktionalität
const CACHE_NAME = 'musaylima-v3';
const ASSETS_TO_CACHE = [
  './musaylima.jpeg',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
  './data.json'
];

// Installation - Cache Assets (aber NICHT index.html)
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

// Fetch-Strategie
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // YouTube und externe Ressourcen - immer Netzwerk
  if (url.hostname.includes('youtube') || 
      url.hostname.includes('google') ||
      url.hostname.includes('gstatic')) {
    return;
  }
  
  // HTML-Dateien - NETWORK-FIRST (immer neueste Version)
  if (event.request.destination === 'document' || 
      url.pathname.endsWith('.html') || 
      url.pathname === '/' ||
      url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Erfolg: Cache aktualisieren und Response zurückgeben
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Offline: aus Cache laden
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }
  
  // Andere Dateien (Bilder, JSON, etc.) - CACHE-FIRST
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
        
        // Nicht im Cache - vom Netzwerk holen
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
  );
});

// Nachricht vom Client empfangen
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
