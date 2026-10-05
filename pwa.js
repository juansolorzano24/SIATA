(function () {
  const install = document.getElementById('installApp');
  const help = document.getElementById('installDialog');
  const notice = document.getElementById('networkNotice');
  const update = document.getElementById('appUpdate');
  let deferredInstall = null;
  let registration = null;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  function connectionStatus() {
    notice.hidden = navigator.onLine;
    notice.textContent = 'Sin conexión. El radar, el pronóstico y las lecturas actuales no están disponibles.';
  }
  connectionStatus();
  window.addEventListener('online', connectionStatus);
  window.addEventListener('offline', connectionStatus);
  document.getElementById('installHelp').addEventListener('click', function () { help.showModal(); });
  if (!standalone && window.matchMedia('(max-width: 720px)').matches) install.hidden = false;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstall = event;
    if (!standalone) install.hidden = false;
  });
  install.addEventListener('click', async function () {
    if (!deferredInstall) { help.showModal(); return; }
    await deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    install.hidden = true;
  });
  window.addEventListener('appinstalled', function () { install.hidden = true; deferredInstall = null; });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then(function (value) {
    registration = value;
    if (registration.waiting) update.hidden = false;
    registration.addEventListener('updatefound', function () {
      const worker = registration.installing;
      if (worker) worker.addEventListener('statechange', function () {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) update.hidden = false;
      });
    });
  }).catch(function () { /* El visor en línea sigue disponible si falla el registro. */ });
  update.addEventListener('click', function () {
    if (registration && registration.waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', function () { window.location.reload(); }, { once: true });
      registration.waiting.postMessage('ACTIVATE_UPDATE');
    }
  });
})();
