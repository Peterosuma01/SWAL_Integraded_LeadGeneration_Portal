// ============================================================
// INTEGRATED SERVICE WORKER - Hardware & Homecare
// ============================================================

const CACHE_NAME = 'steelwool-integrated-v1';
const OFFLINE_URL = '/offline.html';

// Files to cache immediately on install
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Additional static assets that should be cached
const STATIC_ASSETS = [
  // CSS and JS from CDN (optional - can be fetched from CDN)
  // Add any local assets here
];

// Install - cache shell files
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll([...PRECACHE, ...STATIC_ASSETS]);
      })
      .then(() => {
        console.log('[Service Worker] Install complete');
        return self.skipWaiting();
      })
  );
});

// Activate - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      const oldCaches = keys.filter(k => k !== CACHE_NAME);
      if (oldCaches.length > 0) {
        console.log('[Service Worker] Cleaning old caches:', oldCaches);
        return Promise.all(
          oldCaches.map(k => caches.delete(k))
        );
      }
      return Promise.resolve();
    })
    .then(() => {
      console.log('[Service Worker] Now controlling all clients');
      return self.clients.claim();
    })
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ============================================
  // DON'T CACHE API CALLS TO APPS SCRIPT
  // Always go to network for these
  // ============================================
  if (url.hostname === 'script.google.com' || 
      url.hostname === 'script.googleusercontent.com') {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Cache successful responses for offline fallback? No - API calls need fresh data
          return res;
        })
        .catch(() => {
          // Return error JSON if API call fails offline
          return new Response(
            JSON.stringify({ 
              success: false, 
              message: 'You are offline. Please reconnect to use this feature.' 
            }),
            { 
              status: 503,
              headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
              } 
            }
          );
        })
    );
    return;
  }

  // ============================================
  // SAME-ORIGIN REQUESTS
  // ============================================
  if (url.origin === location.origin) {
    
    // HTML navigation requests - network first, fallback to cache, then offline page
    if (req.mode === 'navigate' || 
        (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
      event.respondWith(
        fetch(req)
          .then(res => {
            // Cache successful responses for offline fallback
            if (res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(req, copy);
              });
            }
            return res;
          })
          .catch(() => {
            // Try to serve from cache
            return caches.match(req)
              .then(cached => {
                if (cached) return cached;
                // Fallback to offline page
                return caches.match(OFFLINE_URL);
              });
          })
      );
      return;
    }

    // Static assets (images, fonts, etc.) - cache first, then network
    const staticExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff2', '.woff', '.ttf', '.eot'];
    const isStatic = staticExtensions.some(ext => req.url.includes(ext));
    
    if (isStatic || req.url.includes('/icons/') || req.url.includes('/screenshots/')) {
      event.respondWith(
        caches.match(req).then(cached => {
          if (cached) {
            // Return cached, but update in background
            fetch(req).then(res => {
              if (res.ok) {
                caches.open(CACHE_NAME).then(cache => cache.put(req, res));
              }
            }).catch(() => {});
            return cached;
          }
          return fetch(req).then(res => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
            }
            return res;
          });
        })
      );
      return;
    }

    // Other same-origin requests - network first with cache fallback
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok && req.method === 'GET') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ============================================
  // CROSS-ORIGIN REQUESTS
  // ============================================
  // Fonts, CDN resources - try cache first, then network
  if (url.hostname.includes('cdnjs.cloudflare.com') || 
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // All other cross-origin requests - network only with fallback
  event.respondWith(
    fetch(req).catch(() => {
      // Try to serve from cache for known resources
      return caches.match(req);
    })
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    console.log('[Service Worker] Skip waiting activated');
    self.skipWaiting();
  }
  
  if (event.data === 'clearCache') {
    console.log('[Service Worker] Clearing cache');
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        console.log('[Service Worker] Cache cleared');
      })
    );
  }
});

// Handle push notifications (optional)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'New Lead Update';
  const options = {
    body: data.body || 'A new lead has been generated or updated.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || './'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Check if there's already a window/tab open with the target URL
        for (let client of windowClients) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        // If not, open a new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});
