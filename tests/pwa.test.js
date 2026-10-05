const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('La PWA nunca intercepta datos actuales o teselas externas para guardarlos', () => {
  const events = {};
  const self = { location: { origin: 'https://visor.example' }, addEventListener: (name, handler) => { events[name] = handler; } };
  const sandbox = { self, URL, caches: { match: () => Promise.resolve('interfaz') }, fetch: () => { throw new Error('No debería llamar a fetch'); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8'), sandbox);
  for (const suffix of ['/api/radar', '/api/radar/image?stamp=x', '/api/observations', '/api/forecast', '/api/series?file=1']) {
    let intercepted = false;
    events.fetch({ request: { method: 'GET', url: 'https://visor.example' + suffix }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, suffix);
  }
  let intercepted = false;
  events.fetch({ request: { method: 'GET', url: 'https://tile.openstreetmap.org/12/1/1.png' }, respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});
