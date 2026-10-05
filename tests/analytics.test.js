const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../analytics.js'), 'utf8');
const configuration = { enabled: true, website_id: 'a20dd303-7898-469d-8614-21b988fe0389',
  script_url: 'https://cloud.umami.is/script.js', domains: ['siata.onrender.com'] };

async function start(options = {}) {
  const elements = {};
  for (const id of ['privacyHelp', 'privacyDialog', 'analyticsStatus', 'analyticsPreference']) {
    elements[id] = { handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; }, showModal() {} };
  }
  const scripts = [];
  const events = {};
  const context = {
    URL, Promise, navigator: options.navigator || {},
    location: { hostname: options.hostname || 'siata.onrender.com', protocol: options.protocol || 'https:' },
    localStorage: { getItem() { return options.optedOut ? '1' : null; }, setItem() {} },
    document: { getElementById(id) { return elements[id]; },
      createElement() { return { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }; },
      head: { appendChild(script) { scripts.push(script); } } },
    window: { addEventListener(name, handler) { events[name] = handler; } },
    fetch: async () => { if (options.fetchFails) throw new Error('offline');
      return { ok: true, json: async () => options.configuration || configuration }; }
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, scripts, elements, events };
}

test('Una apertura genera solo una vista y elimina parámetros, coordenadas y rutas de referencia', async () => {
  const state = await start();
  assert.equal(state.scripts.length, 1);
  const script = state.scripts[0];
  assert.equal(script.attributes['data-auto-track'], 'false');
  assert.equal(script.attributes['data-do-not-track'], 'true');
  let views = 0;
  state.context.window.umami = { track() { views++; return Promise.resolve(); } };
  script.onload();
  assert.equal(views, 1);
  const payload = state.context.window.aburraBeforeAnalyticsSend('event', {
    website: configuration.website_id, url: '/?search=estacion#6.2,-75.5',
    referrer: 'https://example.org/private/path?secret=value', title: 'consulta', data: { lat: 6.2 }, id: 'someone'
  });
  assert.equal(payload.url, '/');
  assert.equal(payload.referrer, 'https://example.org');
  assert.equal(payload.data, undefined);
  assert.equal(payload.id, undefined);
  assert.equal(state.context.window.aburraBeforeAnalyticsSend('event', { name: 'click' }), false);
  assert.equal(state.context.window.aburraBeforeAnalyticsSend('identify', {}), false);
  state.elements.analyticsPreference.handlers.click();
  assert.equal(state.context.window.aburraBeforeAnalyticsSend('event', {}), false);
  state.elements.analyticsPreference.handlers.click();
  assert.equal(views, 1);
});

test('Privacidad, entorno local, falta de configuración y fallos no cargan el proveedor', async () => {
  for (const options of [{ optedOut: true }, { navigator: { doNotTrack: '1' } },
    { navigator: { globalPrivacyControl: true } }, { hostname: '127.0.0.1', protocol: 'http:' },
    { configuration: { enabled: false } }, { configuration: { ...configuration, script_url: 'https://evil.example/script.js' } },
    { fetchFails: true }]) {
    const state = await start(options);
    assert.equal(state.scripts.length, 0, JSON.stringify(options));
  }
});

test('La exclusión en otra pestaña bloquea envíos ya preparados', async () => {
  const state = await start();
  state.events.storage({ key: 'aburra-statistics-disabled', newValue: '1' });
  assert.equal(state.context.window.aburraBeforeAnalyticsSend('event', {}), false);
});
