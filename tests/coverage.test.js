const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const coverage = require('../coverage.js');
const load = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../data/', name), 'utf8'));
const zones = load('forecast_zones.geojson');
const sectors = load('medellin_sectors.geojson');

test('El Poblado, Belén y Guayabal tienen zona de pronóstico completa', () => {
  for (const [name, lat, lon] of [
    ['El Poblado', 6.20661, -75.56616],
    ['El Poblado', 6.19, -75.56],
    ['Belén', 6.232, -75.611],
    ['Guayabal', 6.215262, -75.586992]
  ]) {
    assert.equal(coverage.find(sectors, lat, lon).properties.name, name);
    assert.equal(coverage.find(zones, lat, lon).properties.name, 'Medellín Centro');
  }
});
test('Santa Elena y Palmitas usan sus zonas correspondientes', () => {
  assert.equal(coverage.find(zones, 6.256, -75.498).properties.name, 'Medellín Oriente');
  assert.equal(coverage.find(zones, 6.344, -75.685).properties.name, 'Palmitas');
  assert.equal(coverage.find(zones, 6.19, -75.647).properties.name, 'Medellín Occidente');
  assert.equal(coverage.find(zones, 4.7, -74.1), null);
});
test('Los huecos de un polígono no se presentan como cobertura', () => {
  const feature = { geometry: { type: 'Polygon', coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]
  ] } };
  assert.equal(coverage.contains(feature, [0.5, 0.5]), true);
  assert.equal(coverage.contains(feature, [2, 2]), false);
});
