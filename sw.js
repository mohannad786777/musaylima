// Service Worker für Offline-Funktionalität
const CACHE_NAME = 'musaylima-v7';
const STATIC_ASSETS = [
  './musaylima.jpeg',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
  './search-worker.js',
  './version.json'
];

// Data cache - separate cache for large data file
const DATA_CACHE_NAME = 'musaylima-data-v1';

// Installation - Cache static assets only (NOT data.json - it's too large)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
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
          if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
            console.log('Old cache deleted:', cacheName);
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
      url.hostname.includes('gstatic') ||
      url.hostname.includes('fonts')) {
    return;
  }
  
  // data.json.gz - CACHE-FIRST mit Background Update (Stale-While-Revalidate)
  if (url.pathname.endsWith('data.json.gz') || url.pathname.endsWith('data.json')) {
    // Mit ?v=<version>: neue Datenversion -> immer vom Netz holen und als einzige Kopie cachen
    if (url.searchParams.has('v')) {
      const baseKey = new Request(url.origin + url.pathname);
      event.respondWith(
        fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(DATA_CACHE_NAME).then(cache => cache.put(baseKey, copy));
          }
          return networkResponse;
        }).catch(() => caches.open(DATA_CACHE_NAME).then(cache => cache.match(baseKey)))
      );
      return;
    }
    event.respondWith(
      caches.open(DATA_CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const fetchPromise = fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => null);
          
          // Return cached version immediately, update in background
          return cachedResponse || fetchPromise;
        });
      })
    );
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
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }
  
  // Andere Dateien (Bilder, etc.) - CACHE-FIRST
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
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
