// El mapa puede abrirse sin conexión; los datos meteorológicos requieren la fuente en línea.
const CACHE = 'aburra-shell-v14';
const SHELL = [
  '/', '/index.html', '/styles.css?v=14', '/scripts.js?v=14', '/coverage.js?v=14', '/pwa.js?v=14',
  '/manifest.webmanifest', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/images/layers.png', '/vendor/leaflet/images/layers-2x.png',
  '/vendor/leaflet/images/marker-icon.png', '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png',
  '/data/forecast_zones.geojson', '/data/medellin_sectors.geojson', '/data/siata_catalog.json',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png'
];
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key.startsWith('aburra-shell-') && key !== CACHE; })
      .map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (event) {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', function (event) {
  const request = event.request;
  const url = new URL(request.url);
  // Nunca guardar radar, observaciones o pronósticos, ni descargar teselas para uso sin conexión.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(function () { return caches.match('/'); }));
    return;
  }
  if (!SHELL.includes(url.pathname + url.search)) return;
  // El catálogo local se renueva cuando hay conexión; los archivos versionados son estables.
  if (url.pathname === '/data/siata_catalog.json') {
    event.respondWith(fetch(request).then(function (response) {
      if (response.ok) event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.put(request, response.clone()); }));
      return response;
    }).catch(function () { return caches.match(request); }));
    return;
  }
  event.respondWith(caches.match(request).then(function (cached) { return cached || fetch(request); }));
});
