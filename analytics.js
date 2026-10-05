(function () {
  'use strict';
  const preferenceKey = 'aburra-statistics-disabled';
  const privacyButton = document.getElementById('privacyHelp');
  const dialog = document.getElementById('privacyDialog');
  const status = document.getElementById('analyticsStatus');
  const preferenceButton = document.getElementById('analyticsPreference');
  let configuration;
  let optedOut = false;
  let trackerLoaded = false;
  let trackerReady = false;
  let pageViewRecorded = false;
  try { optedOut = localStorage.getItem(preferenceKey) === '1'; } catch (_) { /* Almacenamiento opcional. */ }

  function browserBlocksStatistics() {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  }

  function allowed() {
    return configuration && configuration.enabled && location.protocol === 'https:' &&
      configuration.domains.includes(location.hostname) && !optedOut && !browserBlocksStatistics();
  }

  function renderPreference() {
    if (status) {
      status.textContent = browserBlocksStatistics() ? 'Tu navegador solicita no participar en las estadísticas.' :
        optedOut ? 'Las estadísticas están desactivadas en este navegador.' :
        !configuration ? 'No se ha podido confirmar la disponibilidad de las estadísticas.' :
        !configuration.enabled ? 'Las estadísticas de visitas todavía no están activadas.' :
        'Las estadísticas están habilitadas. Algunos navegadores o bloqueadores pueden impedir su registro.';
    }
    if (preferenceButton) {
      preferenceButton.disabled = browserBlocksStatistics();
      preferenceButton.textContent = optedOut ? 'Permitir estadísticas en este navegador' : 'No participar en las estadísticas';
    }
  }

  // Se ejecuta antes de cada envío, incluso si la preferencia cambia después de cargar el script.
  window.aburraBeforeAnalyticsSend = function (type, payload) {
    if (!allowed() || type !== 'event' || payload.name) return false;
    const sanitized = Object.assign({}, payload);
    sanitized.url = '/';
    sanitized.title = 'Lluvia Valle de Aburrá';
    try { sanitized.referrer = payload.referrer ? new URL(payload.referrer).origin : ''; }
    catch (_) { sanitized.referrer = ''; }
    // Solo visitas: no registrar búsquedas, coordenadas, fichas ni eventos personalizados.
    delete sanitized.data;
    delete sanitized.name;
    delete sanitized.id;
    return sanitized;
  };

  function recordView() {
    if (pageViewRecorded || !trackerReady || !allowed()) return;
    pageViewRecorded = true;
    Promise.resolve(window.umami.track()).catch(function () { /* El mapa no depende de las estadísticas. */ });
  }

  function loadTracker() {
    if (!allowed()) return;
    if (trackerLoaded) { recordView(); return; }
    trackerLoaded = true;
    const script = document.createElement('script');
    script.defer = true;
    script.src = configuration.script_url;
    script.setAttribute('data-website-id', configuration.website_id);
    script.setAttribute('data-host-url', 'https://gateway.umami.is');
    script.setAttribute('data-domains', configuration.domains.join(','));
    script.setAttribute('data-auto-track', 'false');
    script.setAttribute('data-exclude-search', 'true');
    script.setAttribute('data-exclude-hash', 'true');
    script.setAttribute('data-do-not-track', 'true');
    script.setAttribute('data-before-send', 'aburraBeforeAnalyticsSend');
    script.onload = function () {
      trackerReady = !!(window.umami && typeof window.umami.track === 'function');
      recordView();
    };
    document.head.appendChild(script);
  }

  if (privacyButton && dialog) privacyButton.addEventListener('click', function () {
    renderPreference();
    dialog.showModal();
  });
  if (preferenceButton) preferenceButton.addEventListener('click', function () {
    optedOut = !optedOut;
    try { localStorage.setItem(preferenceKey, optedOut ? '1' : '0'); } catch (_) { /* Mantener la elección durante esta sesión. */ }
    renderPreference();
    loadTracker();
  });
  window.addEventListener('storage', function (event) {
    if (event.key === preferenceKey) {
      optedOut = event.newValue === '1';
      renderPreference();
      loadTracker();
    }
  });

  fetch('/api/analytics/config', { cache: 'no-store', credentials: 'same-origin' })
    .then(function (response) { if (!response.ok) throw new Error('Estadísticas no disponibles'); return response.json(); })
    .then(function (config) {
      // La URL externa es fija: el servidor no puede redirigir el script a otro proveedor.
      if (config.enabled && (config.script_url !== 'https://cloud.umami.is/script.js' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(config.website_id) ||
          !Array.isArray(config.domains))) throw new Error('Configuración no válida');
      configuration = config;
      renderPreference();
      loadTracker();
    })
    .catch(function () { renderPreference(); });
}());
