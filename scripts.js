// Geovisor de históricos publicados en datos.siata.gov.co.
const NETWORKS = {
  Pluviometrica: { label: 'Lluvia', color: '#0e95ca', measure: 'p1' },
  Nivel: { label: 'Nivel de cauces', color: '#2574b8', measure: 'nivel' },
  Meteorologica: { label: 'Meteorología', color: '#e38e2e', measure: 't' },
  RedCalidadAire: { label: 'Calidad del aire', color: '#a45bbf', measure: '' },
  VelocidadSuperficialCauces: { label: 'Velocidad de cauces', color: '#31a6a0', measure: 'velocidadrio' },
  Disdrometro: { label: 'Disdrómetros', color: '#d55e79', measure: 'p_total' },
  Piranometro: { label: 'Piranómetros', color: '#d9ac2e', measure: '' }
};

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([6.25, -75.57], 11);
L.control.zoom({ position: 'topright' }).addTo(map);

const calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri y colaboradores'
});

const stationLayer = L.layerGroup();
const selectedLayer = L.layerGroup().addTo(map);
const radarLayer = L.layerGroup();
const radarImageLayer = L.layerGroup().addTo(radarLayer);
const rainGaugeLayer = L.layerGroup().addTo(radarLayer);
const forecastLayer = L.layerGroup();
const sectorsLayer = L.layerGroup();
map.createPane('forecastPane');
map.getPane('forecastPane').style.zIndex = 350;
L.control.layers(
  { 'Calles OpenStreetMap': calles, 'Satélite Esri': satelite },
  { 'Radar de lluvia SIATA': radarLayer, 'Probabilidad de lluvia SIATA': forecastLayer,
    'Estaciones SIATA': stationLayer, 'Comunas y corregimientos': sectorsLayer },
  { position: 'topright' }
).addTo(map);

map.on('mousemove', function (event) {
  document.getElementById('coordinates').textContent =
    'Lat ' + event.latlng.lat.toFixed(5) + ' · Lon ' + event.latlng.lng.toFixed(5);
});

const searchInput = document.getElementById('search');
const categoryBox = document.getElementById('categories');
const stationList = document.getElementById('stationList');
const detail = document.getElementById('detail');
const refreshButton = document.getElementById('refresh');
const mapStatus = document.querySelector('.map-status');
const markerRenderer = L.canvas({ padding: 0.5 });

let records = [];
let catalogRecords = [];
let observationRecords = [];
let sectorsData = null;
let forecastBoundaries = null;
let category = 'all';
let selected = null;
let markers = new Map();
let backendAvailable = true;
let detailRequest = 0;
let seriesRequest = 0;
let currentSeries = null;
let currentColumn = null;
let weatherMode = 'radar';
let radarData = null;
let forecastData = null;
let radarRenderToken = 0;
let radarImageStamp = null;
let observationsFailed = false;
let observationsLoaded = false;
let selectedPlace = null;
let placePopup = null;
const layerWanted = { radar: true, forecast: false };
const WEATHER_COLORS = { BAJA: '#61bde6', MEDIA: '#f3ae36', ALTA: '#db445d' };
const radarButton = document.getElementById('radarMode');
const forecastButton = document.getElementById('forecastMode');
const forecastControls = document.getElementById('forecastControls');
const forecastDate = document.getElementById('forecastDate');
const forecastPeriod = document.getElementById('forecastPeriod');
const weatherInfo = document.getElementById('weatherInfo');
const weatherLegend = document.getElementById('weatherLegend');
const weatherZones = document.getElementById('weatherZones');
const weatherSummary = document.getElementById('weatherSummary');
const sidebar = document.getElementById('explorer');
const placeSelect = document.getElementById('placeSelect');
const mobileLayout = window.matchMedia('(max-width: 720px)');

function setPanel(open) {
  const visible = open && mobileLayout.matches;
  document.body.classList.toggle('panel-open', visible);
  document.getElementById('openPanel').setAttribute('aria-expanded', String(visible));
  sidebar.inert = mobileLayout.matches && !visible;
  if (visible) document.getElementById('closePanel').focus();
  requestAnimationFrame(function () { map.invalidateSize(); });
}

function rebuildRecords() {
  const observations = new Map(observationRecords.map(function (item) { return [item.category + ':' + item.station_code, item]; }));
  records = catalogRecords.map(function (record) {
    const observation = observations.get(record.category + ':' + record.station_code);
    if (!observation) return { ...record };
    observations.delete(record.category + ':' + record.station_code);
    return { ...record, lat: observation.lat, lon: observation.lon,
      place: record.place || observation.place, observation: observation };
  });
  observations.forEach(function (observation) {
    records.push({ ...observation, kind: 'live_station', observation: observation, doi: null });
  });
  records.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
  renderCategories();
  renderResults();
  renderRainGauges();
  refreshPlace();
  const recent = observationRecords.filter(function (record) { return record.recent; }).length;
  document.getElementById('liveCount').textContent = observationRecords.length ? recent + ' lecturas recientes' : 'Históricos publicados';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function plain(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric'
  }).format(date);
}

function network(record) {
  return NETWORKS[record.category] || { label: record.category || 'Otros datos', color: '#71889a', measure: '' };
}

function setStatus(message, mode) {
  document.getElementById('statusText').textContent = message;
  mapStatus.classList.toggle('ready', mode === 'ready');
  mapStatus.classList.toggle('error', mode === 'error');
}

function filteredRecords() {
  const query = plain(searchInput.value.trim());
  return records.filter(function (record) {
    if (category !== 'all' && record.category !== category) return false;
    return !query || plain([record.name, record.place, record.sector, record.municipality, record.station_code, record.code, record.id].join(' ')).includes(query);
  });
}

function renderCategories() {
  const counts = {};
  records.forEach(function (record) { counts[record.category] = (counts[record.category] || 0) + 1; });
  const categories = [['all', 'Todas las redes', records.length, '#1eafc8']]
    .concat(Object.entries(NETWORKS).map(function ([key, value]) { return [key, value.label, counts[key] || 0, value.color]; }));
  categoryBox.replaceChildren();
  categories.forEach(function ([key, label, count, color]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category' + (key === 'all' ? ' all' : '') + (category === key ? ' active' : '');
    button.style.setProperty('--dot', color);
    button.setAttribute('aria-pressed', String(category === key));
    button.innerHTML = '<span class="dot"></span><span class="label">' + escapeHtml(label) +
      '</span><span class="count">' + count + '</span>';
    button.addEventListener('click', function () {
      category = key;
      if (!map.hasLayer(stationLayer)) map.addLayer(stationLayer);
      renderCategories();
      renderResults();
    });
    categoryBox.appendChild(button);
  });
  document.getElementById('categoryCount').textContent = Object.keys(NETWORKS).length + ' redes';
}

function renderList(list) {
  stationList.replaceChildren();
  if (!list.length) {
    stationList.innerHTML = '<div class="list-message">No hay resultados para este filtro.</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  list.forEach(function (record) {
    const button = document.createElement('button');
    const info = network(record);
    button.type = 'button';
    button.className = 'station-item' + (selected && selected.id === record.id ? ' selected' : '');
    button.style.setProperty('--dot', info.color);
    button.innerHTML = '<span class="station-dot"></span><span><strong>' + escapeHtml(record.name) +
      '</strong><small>' + escapeHtml(record.place || info.label) +
      (record.lat == null ? ' · Sin coordenadas publicadas' : '') + '</small>' +
      (record.observation ? '<small class="station-freshness">' + (record.observation.recent ? '● Lectura reciente' : '◷ Dato anterior') + '</small>' : '') + '</span>';
    button.addEventListener('click', function () { selectRecord(record); });
    fragment.appendChild(button);
  });
  stationList.appendChild(fragment);
}

function renderMarkers(list) {
  stationLayer.clearLayers();
  markers = new Map();
  list.forEach(function (record) {
    if (record.lat == null || record.lon == null) return;
    const info = network(record);
    const active = selected && selected.id === record.id;
    const marker = L.circleMarker([record.lat, record.lon], {
      bubblingMouseEvents: false,
      renderer: markerRenderer,
      radius: active ? 9 : 5,
      color: '#fff', weight: active ? 3 : 1.5,
      fillColor: info.color, fillOpacity: 0.88
    });
    marker.bindTooltip(record.name, { direction: 'top', offset: [0, -6] });
    marker.on('click', function () { selectRecord(record); });
    marker.addTo(stationLayer);
    markers.set(record.id, marker);
  });
  updateMapCount();
}

function renderResults() {
  const list = filteredRecords();
  renderList(list);
  renderMarkers(list);
  document.getElementById('resultCount').textContent = list.length.toLocaleString('es-CO');
  document.getElementById('resultTitle').textContent = category === 'all' ? 'Registros' : NETWORKS[category].label;
}

function datasetUrl(doi) {
  return 'https://datos.siata.gov.co/dataset.xhtml?persistentId=' + encodeURIComponent(doi);
}

function formatStamp(value) {
  if (!value) return 'Fecha no publicada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }).format(date) + ' · Bogotá';
}

function observationMarkup(observation) {
  if (!observation) return '<p class="detail-note">Esta estación tiene información histórica; SIATA no entregó una lectura operativa en esta consulta.</p>';
  return '<section class="live-readings"><h3>Última lectura publicada</h3><p class="reading-date ' +
    (recentObservation(observation) ? '' : 'old-reading') + '">' + escapeHtml(formatStamp(observation.observed_at)) +
    (recentObservation(observation) ? '' : ' · Dato anterior; revisa su fecha') + '</p><div class="reading-grid">' +
    observation.readings.map(function (reading) {
      return '<div><span>' + escapeHtml(reading.label) + '</span><strong>' +
        reading.value.toLocaleString('es-CO', { maximumFractionDigits: 2 }) + '</strong><small>' + escapeHtml(reading.unit) + '</small></div>';
    }).join('') + '</div><a class="source-link" href="' + escapeHtml(observation.source) +
    '" target="_blank" rel="noopener noreferrer">Ver datos operativos originales ↗</a></section>';
}

function selectRecord(record) {
  selected = record;
  selectedLayer.clearLayers();
  if (record.lat != null && record.lon != null) {
    L.circleMarker([record.lat, record.lon], {
      radius: 9, color: '#fff', weight: 3, fillColor: network(record).color, fillOpacity: 1
    }).bindTooltip(record.name, { direction: 'top' }).addTo(selectedLayer);
  }
  detailRequest += 1;
  currentSeries = null;
  currentColumn = null;
  renderResults();
  const info = network(record);
  const hasHistory = record.doi && !['live_station', 'station_metadata'].includes(record.kind);
  setPanel(false);
  detail.hidden = false;
  detail.innerHTML = `
    <div class="detail-top"><div><p class="eyebrow">ESTACIÓN SIATA</p><h2>${escapeHtml(record.name)}</h2></div>
      <button id="closeDetail" class="close-detail" type="button" aria-label="Cerrar ficha">×</button></div>
    <span class="type-pill" style="--dot:${info.color}"><i></i>${escapeHtml(info.label)}</span>
    <div id="liveSection">${observationMarkup(record.observation)}</div>
    <div class="detail-meta">
      <div><span>Ubicación</span><strong>${escapeHtml(record.place || 'No indicada')}</strong></div>
      <div><span>Coordenadas</span><strong>${record.lat == null ? 'No publicadas' : record.lat.toFixed(5) + ', ' + record.lon.toFixed(5)}</strong></div>
      <div><span>Publicado</span><strong>${escapeHtml(formatDate(record.published_at))}</strong></div>
      <div><span>Identificador</span><strong>${escapeHtml(record.station_code || record.code || record.doi)}</strong></div>
    </div>
    ${hasHistory ? '<h3>Serie histórica</h3><p class="detail-note">Archivos del repositorio; su fecha puede ser anterior a la lectura operativa.</p>' : ''}
    <div id="dataSection" class="chart-message">${hasHistory ? 'Consultando archivos oficiales…' : 'No hay un archivo histórico individual vinculado a esta estación.'}</div>
    ${record.doi ? `<a class="source-link" href="${datasetUrl(record.source_doi || record.doi)}" target="_blank" rel="noopener noreferrer">Ver ficha en datos.siata.gov.co ↗</a>` : ''}
    ${record.source_doi ? `<br><a class="source-link" href="${datasetUrl(record.doi)}" target="_blank" rel="noopener noreferrer">Ver histórico de PM2.5 ↗</a>` : ''}
  `;
  document.getElementById('closeDetail').addEventListener('click', closeDetail);
  requestAnimationFrame(function () { map.invalidateSize(); });
  if (record.lat != null) map.flyTo([record.lat, record.lon], Math.max(map.getZoom(), 13), { duration: 0.55 });
  if (hasHistory && backendAvailable) loadDataset(record, detailRequest);
  else if (hasHistory) document.getElementById('dataSection').textContent = 'La consulta de series no está disponible en este momento. Revisa tu conexión e intenta actualizar.';
}

function closeDetail() {
  selected = null;
  selectedLayer.clearLayers();
  detailRequest += 1;
  detail.hidden = true;
  renderResults();
  requestAnimationFrame(function () { map.invalidateSize(); });
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al consultar la fuente');
  return data;
}

function bogotaDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(function (part) { return [part.type, part.value]; }));
  return { date: value.year + '-' + value.month + '-' + value.day, hour: Number(value.hour) };
}

function weatherLegendItems(items) {
  weatherLegend.innerHTML = items.map(function ([label, color]) {
    return '<span class="legend-item"><i class="legend-swatch" style="--swatch:' + color + '"></i>' + label + '</span>';
  }).join('');
}

function setWeatherMode(mode) {
  weatherMode = mode;
  const forecast = mode === 'forecast';
  layerWanted[mode] = true;
  layerWanted[forecast ? 'radar' : 'forecast'] = false;
  radarButton.classList.toggle('active', !forecast);
  forecastButton.classList.toggle('active', forecast);
  radarButton.setAttribute('aria-pressed', String(!forecast));
  forecastButton.setAttribute('aria-pressed', String(forecast));
  forecastControls.hidden = !forecast;
  weatherZones.hidden = !forecast;
  document.getElementById('mobileRadar').classList.toggle('active', !forecast);
  document.getElementById('mobileForecast').classList.toggle('active', forecast);
  document.getElementById('mobileRadar').setAttribute('aria-pressed', String(!forecast));
  document.getElementById('mobileForecast').setAttribute('aria-pressed', String(forecast));
  if (forecast) {
    if (map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
    if (forecastData) renderForecast();
    else weatherInfo.textContent = 'Consultando el pronóstico de SIATA…';
  } else {
    if (map.hasLayer(forecastLayer)) map.removeLayer(forecastLayer);
    if (radarData) renderRadar();
    else weatherInfo.textContent = 'Consultando el radar de SIATA…';
  }
}

function rainReading(record) {
  const observation = record.observation;
  const reading = observation && observation.readings.find(function (item) { return item.field === 'acumulado_15min'; });
  return reading ? reading.value : null;
}

function recentObservation(observation) {
  if (!observation || !observation.recent || !observation.observed_at || observationsFailed || !navigator.onLine) return false;
  return Date.now() - new Date(observation.observed_at).getTime() <= (observation.category === 'RedCalidadAire' ? 90 : 20) * 60 * 1000;
}

function rainLabel(record) {
  const value = rainReading(record);
  if (value === null) return 'Sin lectura operativa';
  return value.toLocaleString('es-CO', { maximumFractionDigits: 2 }) + ' mm / 15 min' +
    (recentObservation(record.observation) ? '' : ' · dato anterior');
}

function renderRainGauges() {
  rainGaugeLayer.clearLayers();
  records.filter(function (record) { return record.category === 'Pluviometrica' && record.lat != null; }).forEach(function (record) {
    const value = rainReading(record);
    const fresh = recentObservation(record.observation);
    const color = !fresh || value === null ? '#7a8a95' : value > 0 ? '#006ed5' : '#ffffff';
    const marker = L.circleMarker([record.lat, record.lon], {
      bubblingMouseEvents: false,
      radius: value > 0 && fresh ? 7 : 5, color: fresh ? '#154766' : '#687987',
      weight: 1.5, fillColor: color, fillOpacity: 1, dashArray: fresh ? null : '2 2'
    });
    marker.bindTooltip(escapeHtml(record.name) + '<br><strong>' + escapeHtml(rainLabel(record)) + '</strong>', { direction: 'top' });
    marker.on('click', function () { selectRecord(record); });
    marker.addTo(rainGaugeLayer);
  });
  updateMapCount();
  if (weatherMode === 'radar') radarMessage();
}

function updateMapCount() {
  const visible = new Set();
  if (map.hasLayer(stationLayer)) filteredRecords().filter(function (record) { return record.lat != null; }).forEach(function (record) { visible.add(record.id); });
  if (map.hasLayer(radarLayer)) records.filter(function (record) { return record.category === 'Pluviometrica' && record.lat != null; }).forEach(function (record) { visible.add(record.id); });
  document.getElementById('mapCount').textContent = visible.size.toLocaleString('es-CO');
}

function radarMessage(imageError) {
  if (weatherMode !== 'radar') return;
  const rain = records.filter(function (record) { return record.category === 'Pluviometrica'; });
  const recent = rain.filter(function (record) { return recentObservation(record.observation) && rainReading(record) !== null; });
  const wet = recent.filter(function (record) { return rainReading(record) > 0; });
  const available = radarData && radarData.available && Date.now() - new Date(radarData.observed_at).getTime() <= 30 * 60 * 1000;
  weatherSummary.textContent = available && !imageError ? 'Radar · ' + formatStamp(radarData.observed_at) + ' · ' +
    (observationsLoaded ? wet.length + ' pluviómetros con lluvia' : 'Consultando pluviómetros…') :
    'Radar no disponible · ' + recent.length + ' pluviómetros recientes';
  weatherInfo.innerHTML = (available && !imageError ? 'Barrido completo: ' + escapeHtml(formatStamp(radarData.observed_at)) +
    '. Radar sobre toda Medellín, sin recortes por comuna. Los colores muestran ecos del radar; las zonas sin color no confirman ausencia de lluvia. ' +
    '<a href="' + escapeHtml(radarData.source) + '" target="_blank" rel="noopener noreferrer">Imagen original ↗</a>' :
    (imageError ? 'No fue posible cargar el barrido de SIATA.' : 'SIATA no entregó un barrido reciente.')) +
    '<br>' + (observationsLoaded ? recent.length + ' pluviómetros con lectura reciente; ' + wet.length + (wet.length === 1 ? ' registra' : ' registran') + ' lluvia en 15 min. ' : 'Consultando los pluviómetros… ') +
    'Los puntos blancos registran 0 mm; los grises no tienen una lectura reciente confirmada. Toca un punto para ver su fecha.';
  weatherLegendItems([['Radar: menor reflectividad', '#3464dc'], ['Mayor reflectividad', '#db445d'],
    ['Pluviómetro con lluvia', '#006ed5'], ['0 mm / 15 min', '#ffffff'], ['Sin lectura reciente', '#7a8a95']]);
}

function renderRadar() {
  if (weatherMode !== 'radar') return;
  if (layerWanted.radar && !map.hasLayer(radarLayer)) map.addLayer(radarLayer);
  renderRainGauges();
  if (!radarData || !radarData.available || Date.now() - new Date(radarData.observed_at).getTime() > 30 * 60 * 1000) {
    ++radarRenderToken;
    radarImageLayer.clearLayers();
    radarImageStamp = null;
    radarMessage();
    return;
  }
  if (radarImageStamp === radarData.observed_at) { radarMessage(); return; }
  const token = ++radarRenderToken;
  const stamp = radarData.observed_at;
  const overlay = L.imageOverlay(radarData.image + '?stamp=' + encodeURIComponent(stamp), radarData.bounds, {
    opacity: 0.72, interactive: false, attribution: 'Radar: AMVA–SIATA'
  });
  overlay.once('load', function () {
    if (token !== radarRenderToken) { radarImageLayer.removeLayer(overlay); return; }
    radarImageLayer.eachLayer(function (layer) { if (layer !== overlay) radarImageLayer.removeLayer(layer); });
    radarImageStamp = stamp;
    radarMessage();
    refreshPlace();
  });
  overlay.once('error', function () {
    radarImageLayer.removeLayer(overlay);
    if (token === radarRenderToken) { radarImageLayer.clearLayers(); radarImageStamp = null; radarMessage(true); }
  });
  overlay.addTo(radarImageLayer);
  radarMessage();
}

function forecastValue(zone) {
  const day = zone.days.find(function (item) { return item.date === forecastDate.value; });
  const value = day && day.periods[forecastPeriod.value];
  return WEATHER_COLORS[value] ? value : null;
}

function renderForecast() {
  if (weatherMode !== 'forecast' || !forecastData) return;
  forecastLayer.clearLayers();
  const today = bogotaDate().date;
  if (!forecastDate.value || forecastDate.value < today) {
    weatherInfo.textContent = 'SIATA no tiene un pronóstico vigente para la fecha seleccionada.';
    weatherLegend.replaceChildren();
    weatherZones.replaceChildren();
    if (map.hasLayer(forecastLayer)) map.removeLayer(forecastLayer);
    return;
  }
  const zones = forecastData.zones.map(function (zone) { return { zone: zone, value: forecastValue(zone) }; })
    .filter(function (item) { return item.value; });
  const named = Object.fromEntries(zones.map(function (item) { return [plain(item.zone.name), item]; }));
  L.geoJSON(forecastData.boundaries, {
    pane: 'forecastPane',
    style: function (feature) {
      const name = plain(feature.properties.name);
      const item = named[name];
      return { color: item ? WEATHER_COLORS[item.value] : '#8ca8b6', weight: 1.5,
        fillColor: item ? WEATHER_COLORS[item.value] : '#b9d2dc', fillOpacity: item ? 0.72 : 0.14 };
    },
    onEachFeature: function (feature, layer) {
      const item = named[plain(feature.properties.name)];
      layer.bindTooltip(escapeHtml(feature.properties.name) + ': ' + (item ? item.value.toLowerCase() : 'sin pronóstico vigente'), { sticky: true });
      layer.on('click', function (event) { showPlace(event.latlng); });
    }
  }).addTo(forecastLayer);
  if (layerWanted.forecast && !map.hasLayer(forecastLayer)) map.addLayer(forecastLayer);
  const countHigh = zones.filter(function (item) { return item.value === 'ALTA'; }).length;
  const updates = zones.map(function (item) { return item.zone.updated_at; }).filter(Boolean).sort();
  const update = updates.length ? updates[0] : 'sin fecha';
  const countMedium = zones.filter(function (item) { return item.value === 'MEDIA'; }).length;
  const allLow = zones.length > 0 && countHigh === 0 && countMedium === 0;
  weatherInfo.innerHTML = (allLow ? 'SIATA indica probabilidad BAJA en todas las zonas para este periodo. Prueba otra fecha o periodo para ver el pronóstico futuro. ' :
    'Pronóstico: ' + countHigh + (countHigh === 1 ? ' zona' : ' zonas') + ' en ALTA y ' + countMedium + ' en MEDIA. ') +
    'Actualización más antigua: ' + escapeHtml(update) + ' (Bogotá). Cobertura: polígonos oficiales de las zonas de pronóstico. ' +
    '<a href="https://siata.gov.co/portalWeb" target="_blank" rel="noopener noreferrer">Pronóstico SIATA ↗</a>';
  weatherLegendItems([['Baja', WEATHER_COLORS.BAJA], ['Media', WEATHER_COLORS.MEDIA], ['Alta', WEATHER_COLORS.ALTA]]);
  weatherSummary.textContent = 'Pronóstico · ' + forecastDate.value + ' · ' + forecastPeriod.value + ' · ' + countHigh + ' zonas en alta';
  weatherZones.innerHTML = zones.sort(function (a, b) {
    return ['ALTA', 'MEDIA', 'BAJA'].indexOf(a.value) - ['ALTA', 'MEDIA', 'BAJA'].indexOf(b.value);
  }).map(function (item) {
    return '<div class="weather-zone" style="--zone:' + WEATHER_COLORS[item.value] + '"><span>' +
      escapeHtml(item.zone.name) + '</span><strong>' + item.value + '</strong></div>';
  }).join('');
  updateMapCount();
  refreshPlace();
}

async function loadRadar(force) {
  const suffix = force ? '?refresh=1' : '';
  try {
    radarData = await fetchJson('/api/radar' + suffix);
    renderRadar();
  } catch (error) {
    radarData = null;
    radarImageStamp = null;
    radarImageLayer.clearLayers();
    radarMessage(true);
  }
}

async function loadForecast(force) {
  try {
    forecastData = await fetchJson('/api/forecast' + (force ? '?refresh=1' : ''));
    const today = bogotaDate();
    const dates = [...new Set(forecastData.zones.flatMap(function (zone) {
      return zone.days.map(function (day) { return day.date; });
    }))].filter(function (date) { return date >= today.date; }).sort();
    const previous = forecastDate.value;
    forecastDate.replaceChildren();
    dates.forEach(function (date) {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = date === today.date ? 'Hoy · ' + date : formatDate(date + 'T12:00:00-05:00');
      forecastDate.appendChild(option);
    });
    forecastDate.value = dates.includes(previous) ? previous : (dates.includes(today.date) ? today.date : dates[0] || '');
    if (!forecastPeriod.dataset.initialized) {
      forecastPeriod.value = today.hour < 6 ? 'madrugada' : today.hour < 12 ? 'mañana' :
        today.hour < 18 ? 'tarde' : 'noche';
      forecastPeriod.dataset.initialized = '1';
    }
    renderForecast();
  } catch (error) {
    forecastData = null;
    forecastLayer.clearLayers();
    if (weatherMode === 'forecast') {
      weatherInfo.textContent = 'No fue posible consultar el pronóstico de SIATA.';
      weatherSummary.textContent = 'Pronóstico no disponible · intenta actualizar';
      weatherLegend.replaceChildren();
      weatherZones.replaceChildren();
    }
  }
}

async function loadObservations(force) {
  try {
    const data = await fetchJson('/api/observations' + (force ? '?refresh=1' : ''));
    observationRecords = data.stations;
    observationsFailed = false;
    observationsLoaded = true;
    rebuildRecords();
    if (selected) {
      const fresh = records.find(function (record) { return record.id === selected.id; });
      if (fresh) { selected = fresh; const live = document.getElementById('liveSection'); if (live) live.innerHTML = observationMarkup(fresh.observation); }
    }
  } catch (error) {
    observationsFailed = true;
    observationsLoaded = true;
    renderRainGauges();
    refreshPlace();
    document.getElementById('liveCount').textContent = 'Lecturas operativas sin confirmar';
  }
}

radarButton.addEventListener('click', function () { setWeatherMode('radar'); });
forecastButton.addEventListener('click', function () { setWeatherMode('forecast'); });
forecastDate.addEventListener('change', renderForecast);
forecastPeriod.addEventListener('change', renderForecast);
map.on('overlayadd', function (event) {
  if (event.layer === radarLayer && weatherMode !== 'radar') setWeatherMode('radar');
  if (event.layer === forecastLayer && weatherMode !== 'forecast') setWeatherMode('forecast');
  updateMapCount();
});
map.on('overlayremove', function (event) {
  if (event.layer === radarLayer) layerWanted.radar = false;
  if (event.layer === forecastLayer) layerWanted.forecast = false;
  updateMapCount();
});

async function loadGeography() {
  try {
    const [sectors, zones] = await Promise.all([fetchJson('/data/medellin_sectors.geojson'), fetchJson('/data/forecast_zones.geojson')]);
    sectorsData = sectors;
    forecastBoundaries = zones;
    sectors.features.forEach(function (feature, index) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = feature.properties.name;
      placeSelect.appendChild(option);
    });
    L.geoJSON(sectors, {
      style: { color: '#284d66', weight: 1, fillOpacity: 0, dashArray: '4 4' },
      onEachFeature: function (feature, layer) {
        layer.bindTooltip(escapeHtml(feature.properties.name), { sticky: true });
        layer.on('click', function (event) { showPlace(event.latlng, feature); });
      }
    }).addTo(sectorsLayer);
  } catch (error) { placeSelect.disabled = true; }
}

function refreshPlace() {
  if (selectedPlace && placePopup && map.hasLayer(placePopup)) showPlace(selectedPlace.latlng, selectedPlace.sector);
}

function showPlace(latlng, chosenSector) {
  const sector = chosenSector || (sectorsData && SiataCoverage.find(sectorsData, latlng.lat, latlng.lng));
  const boundary = (forecastData && forecastData.boundaries) || forecastBoundaries;
  const zoneFeature = boundary && SiataCoverage.find(boundary, latlng.lat, latlng.lng);
  const zone = zoneFeature && forecastData && forecastData.zones.find(function (item) { return item.name === zoneFeature.properties.name; });
  const value = zone && forecastValue(zone);
  const day = zone && zone.days.find(function (item) { return item.date === forecastDate.value; });
  const nearby = records.filter(function (record) { return record.category === 'Pluviometrica' && record.lat != null; })
    .map(function (record) { return { record: record, distance: map.distance(latlng, [record.lat, record.lon]) / 1000 }; })
    .sort(function (a, b) { return a.distance - b.distance; }).slice(0, 4);
  const local = sector ? records.filter(function (record) { return record.category === 'Pluviometrica' && record.lat != null && SiataCoverage.contains(sector, [record.lon, record.lat]); }) : [];
  const recent = local.filter(function (record) { return recentObservation(record.observation) && rainReading(record) !== null; });
  const wet = recent.filter(function (record) { return rainReading(record) > 0; });
  const covered = radarData && radarData.available && Date.now() - new Date(radarData.observed_at).getTime() <= 30 * 60 * 1000 &&
    L.latLngBounds(radarData.bounds).contains(latlng) && radarImageStamp === radarData.observed_at;
  const popup = document.createElement('div');
  popup.className = 'place-popup';
  popup.innerHTML = '<h3>' + escapeHtml(sector ? sector.properties.name : 'Lluvia en este lugar') + '</h3>' +
    '<p>' + (covered ? 'Este lugar está dentro del barrido completo de radar: ' + escapeHtml(formatStamp(radarData.observed_at)) + '.' : 'No hay un barrido reciente confirmado para esta ubicación.') + '</p>' +
    (sector ? '<p>' + (observationsLoaded ? '<strong>' + recent.length + '</strong> de ' + local.length + ' pluviómetros del sector con lectura reciente; <strong>' + wet.length + '</strong> registran lluvia en 15 min.' : 'Consultando los pluviómetros del sector…') + '</p>' : '') +
    '<p><strong>Probabilidad: ' + (value ? value.toLowerCase() : 'sin pronóstico vigente') + '</strong>' +
    (zone ? '<br>' + escapeHtml(zone.name) + ' · ' + escapeHtml(forecastDate.value + ' · ' + forecastPeriod.value) : '') +
    (day && day.temperature_min != null && day.temperature_max != null ? '<br>Temperatura prevista: ' + escapeHtml(day.temperature_min) + '–' + escapeHtml(day.temperature_max) + ' °C' : '') + '</p>' +
    '<h4>Pluviómetros más cercanos</h4>' + nearby.map(function (item, index) {
      return '<button type="button" data-nearby="' + index + '"><strong>' + escapeHtml(item.record.name) + '</strong><span>' +
        escapeHtml(rainLabel(item.record)) + ' · ' + item.distance.toFixed(1) + ' km</span><small>' +
        escapeHtml(formatStamp(item.record.observation && item.record.observation.observed_at)) + '</small></button>';
    }).join('') + '<small class="place-note">Las lecturas son puntuales. Un espacio sin color en el radar no confirma ausencia de lluvia.</small>';
  popup.querySelectorAll('button').forEach(function (button) {
    button.addEventListener('click', function () { map.closePopup(); selectRecord(nearby[Number(button.dataset.nearby)].record); });
  });
  placePopup = L.popup({ maxWidth: Math.max(160, Math.min(330, map.getSize().x - 90)), maxHeight: Math.max(160, map.getSize().y - 220),
    autoPanPaddingTopLeft: [15, 120], autoPanPaddingBottomRight: [15, 35]
  }).setLatLng(latlng).setContent(popup).openOn(map);
  selectedPlace = { latlng: latlng, sector: sector };
}

map.on('click', function (event) { showPlace(event.latlng); });
map.on('popupopen', function () { document.body.classList.add('place-open'); });
map.on('popupclose', function () { document.body.classList.remove('place-open'); });
placeSelect.addEventListener('change', function () {
  setPanel(false);
  if (placeSelect.value === '') { map.closePopup(); map.setView([6.25, -75.57], 11); return; }
  const feature = sectorsData.features[Number(placeSelect.value)];
  const bounds = L.geoJSON(feature).getBounds();
  map.fitBounds(bounds, { padding: [35, 45], maxZoom: 14, animate: false });
  showPlace(bounds.getCenter(), feature);
});

async function loadDataset(record, token) {
  try {
    const data = await fetchJson('/api/dataset?doi=' + encodeURIComponent(record.doi));
    if (token !== detailRequest) return;
    const section = document.getElementById('dataSection');
    const tabular = data.files.filter(function (file) { return file.tabular; });
    if (!tabular.length) {
      section.textContent = 'Este conjunto no incluye archivos tabulares para graficar. Consulta su ficha oficial.';
      return;
    }
    section.className = '';
    section.innerHTML = `
      <label for="fileSelect">Archivo publicado</label><select id="fileSelect"></select>
      <label for="metricSelect">${record.kind === 'air_station' ? 'Estación en el archivo' : 'Variable'}</label><select id="metricSelect" disabled><option>Consultando…</option></select>
      <div class="chart-box"><canvas id="seriesChart" aria-label="Gráfica de la serie histórica"></canvas>
        <div id="chartMessage" class="chart-message">Cargando mediciones…</div></div>
      <p id="reading" class="reading"></p>
      <a id="fileLink" class="file-link" target="_blank" rel="noopener noreferrer">Descargar archivo original ↗</a>`;
    const fileSelect = document.getElementById('fileSelect');
    tabular.forEach(function (file) {
      const option = document.createElement('option');
      option.value = String(file.id);
      option.textContent = file.name;
      fileSelect.appendChild(option);
    });
    fileSelect.addEventListener('change', function () {
      const file = tabular.find(function (item) { return String(item.id) === fileSelect.value; });
      loadSeries(file, record, token);
    });
    loadSeries(tabular[0], record, token);
  } catch (error) {
    if (token === detailRequest) document.getElementById('dataSection').textContent = error.message;
  }
}

async function loadSeries(file, record, token) {
  const seriesToken = ++seriesRequest;
  currentSeries = null;
  const message = document.getElementById('chartMessage');
  const metricSelect = document.getElementById('metricSelect');
  message.textContent = 'Cargando mediciones…';
  document.getElementById('fileLink').href = 'https://datos.siata.gov.co/api/access/datafile/' + file.id;
  try {
    const data = await fetchJson('/api/series?file=' + file.id);
    if (token !== detailRequest || seriesToken !== seriesRequest || !document.getElementById('metricSelect')) return;
    currentSeries = data;
    metricSelect.replaceChildren();
    if (!data.columns.length) {
      metricSelect.disabled = true;
      message.textContent = 'No hay valores numéricos en los últimos registros de este archivo.';
      document.getElementById('reading').textContent = '';
      return;
    }
    data.columns.forEach(function (column) {
      const option = document.createElement('option');
      option.value = column;
      option.textContent = column;
      metricSelect.appendChild(option);
    });
    const preferred = record.code || network(record).measure;
    metricSelect.value = data.columns.includes(preferred) ? preferred : data.columns[0];
    metricSelect.disabled = false;
    metricSelect.onchange = function () { currentColumn = metricSelect.value; drawSeries(record); };
    currentColumn = metricSelect.value;
    drawSeries(record);
  } catch (error) {
    if (token === detailRequest && seriesToken === seriesRequest && message) {
      message.textContent = error.message;
      metricSelect.disabled = true;
    }
  }
}

function drawSeries(record) {
  if (!currentSeries || !currentColumn || !document.getElementById('seriesChart')) return;
  const canvas = document.getElementById('seriesChart');
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(200, canvas.clientWidth);
  const height = 180;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const values = currentSeries.values[currentColumn] || [];
  const valid = values.map(function (value, index) { return { value: value, index: index }; })
    .filter(function (point) { return point.value != null; });
  const message = document.getElementById('chartMessage');
  if (valid.length < 2) {
    message.textContent = 'No hay suficientes mediciones para esta estación en el archivo seleccionado.';
    document.getElementById('reading').textContent = '';
    return;
  }
  message.textContent = '';
  const min = Math.min.apply(null, valid.map(function (point) { return point.value; }));
  const max = Math.max.apply(null, valid.map(function (point) { return point.value; }));
  const spread = max - min || 1;
  const left = 34, right = width - 9, top = 12, bottom = height - 29;
  const x = function (index) { return left + index / Math.max(1, values.length - 1) * (right - left); };
  const y = function (value) { return bottom - (value - min) / spread * (bottom - top); };
  context.strokeStyle = '#dce7ed';
  context.lineWidth = 1;
  [top, (top + bottom) / 2, bottom].forEach(function (line) {
    context.beginPath(); context.moveTo(left, line); context.lineTo(right, line); context.stroke();
  });
  context.fillStyle = '#79909c';
  context.font = '10px Segoe UI, Arial';
  context.textAlign = 'right';
  context.fillText(max.toFixed(1), left - 5, top + 4);
  context.fillText(min.toFixed(1), left - 5, bottom + 3);
  context.textAlign = 'left';
  context.fillText((currentSeries.times[0] || '').slice(5, 16), left, height - 9);
  context.textAlign = 'right';
  context.fillText((currentSeries.times.at(-1) || '').slice(5, 16), right, height - 9);
  context.strokeStyle = network(record).color;
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.beginPath();
  valid.forEach(function (point, index) {
    if (index === 0) context.moveTo(x(point.index), y(point.value));
    else context.lineTo(x(point.index), y(point.value));
  });
  context.stroke();
  const last = valid[valid.length - 1];
  context.fillStyle = network(record).color;
  context.beginPath(); context.arc(x(last.index), y(last.value), 3.5, 0, Math.PI * 2); context.fill();
  const label = record.kind === 'air_station' ? 'PM2.5' : currentColumn;
  document.getElementById('reading').innerHTML = '<strong>' + last.value.toLocaleString('es-CO', { maximumFractionDigits: 2 }) +
    '</strong> ' + escapeHtml(label) + ' · ' + escapeHtml(currentSeries.times[last.index] || '') +
    '<br>Últimos ' + values.length + ' registros del archivo; unidad según documentación de SIATA.';
}

async function loadCatalog(force) {
  setStatus('Consultando catálogo de SIATA…', 'loading');
  try {
    let catalog;
    try {
      catalog = await fetchJson('/api/catalog' + (force ? '?refresh=1' : ''));
      backendAvailable = true;
    } catch (apiError) {
      const fallback = await fetch('data/siata_catalog.json');
      if (!fallback.ok) throw apiError;
      catalog = await fallback.json();
      backendAvailable = false;
    }
    catalogRecords = catalog.records;
    rebuildRecords();
    const date = formatDate(catalog.fetched_at);
    const mode = !backendAvailable ? 'Catálogo guardado · consulta operativa sin conexión' :
      catalog.stale ? 'Catálogo guardado · SIATA no respondió' :
        catalog.dataset_count + ' datasets · consulta ' + date;
    setStatus(mode, backendAvailable && !catalog.stale ? 'ready' : 'error');
  } catch (error) {
    setStatus('No se pudo cargar el catálogo de SIATA', 'error');
    stationList.innerHTML = '<div class="list-message">' + escapeHtml(error.message) + '</div>';
  }
}

searchInput.addEventListener('input', renderResults);
refreshButton.addEventListener('click', async function () {
  refreshButton.disabled = true;
  try { await Promise.allSettled([loadCatalog(true), loadRadar(true), loadForecast(true), loadObservations(true)]); }
  finally { refreshButton.disabled = false; }
});
document.getElementById('openPanel').addEventListener('click', function () { setPanel(true); });
document.getElementById('closePanel').addEventListener('click', function () { setPanel(false); document.getElementById('openPanel').focus(); });
document.getElementById('panelBackdrop').addEventListener('click', function () { setPanel(false); });
document.getElementById('mobileRadar').addEventListener('click', function () { setWeatherMode('radar'); setPanel(false); });
document.getElementById('mobileForecast').addEventListener('click', function () { setWeatherMode('forecast'); setPanel(false); });
document.getElementById('mobileStations').addEventListener('click', function () {
  map.addLayer(stationLayer);
  setPanel(true);
  searchInput.focus();
});
weatherSummary.addEventListener('click', function () { sidebar.scrollTop = 0; setPanel(true); });
document.getElementById('homeView').addEventListener('click', function () {
  placeSelect.value = '';
  map.closePopup();
  closeDetail();
  map.setView([6.25, -75.57], 11);
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') { setPanel(false); closeDetail(); map.closePopup(); }
  if (event.key === 'Tab' && document.body.classList.contains('panel-open')) {
    const items = [...sidebar.querySelectorAll('button, input, select, a')].filter(function (item) { return !item.disabled && item.getClientRects().length; });
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
mobileLayout.addEventListener('change', function () { setPanel(false); });
setPanel(false);
window.addEventListener('resize', function () {
  map.invalidateSize();
  if (selected && currentSeries) drawSeries(selected);
});
window.addEventListener('offline', function () {
  observationsFailed = true;
  radarData = null;
  renderRadar();
  forecastLayer.clearLayers();
  forecastData = null;
  if (weatherMode === 'forecast') weatherSummary.textContent = 'Sin conexión · pronóstico no disponible';
});
window.addEventListener('online', function () { loadRadar(false); loadObservations(false); loadForecast(false); loadCatalog(false); });
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && navigator.onLine) { loadRadar(false); loadObservations(false); loadForecast(false); }
});
loadGeography();
loadCatalog(false);
loadRadar(false);
loadForecast(false);
loadObservations(false);
setInterval(function () { if (!document.hidden && navigator.onLine) { loadRadar(false); loadObservations(false); } }, 5 * 60 * 1000);
setInterval(function () { if (!document.hidden && navigator.onLine) loadForecast(false); }, 30 * 60 * 1000);
setInterval(function () { if (!document.hidden && navigator.onLine) loadCatalog(false); }, 60 * 60 * 1000);
setInterval(function () {
  if (radarData && Date.now() - new Date(radarData.observed_at).getTime() > 30 * 60 * 1000) renderRadar();
  renderRainGauges();
  if (selected && document.getElementById('liveSection')) document.getElementById('liveSection').innerHTML = observationMarkup(selected.observation);
}, 60 * 1000);
