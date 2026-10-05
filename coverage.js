/* Consulta los polígonos oficiales. También se usa desde Node en las pruebas. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiataCoverage = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function onSegment(point, a, b) {
    const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
    return Math.abs(cross) < 1e-10 && point[0] >= Math.min(a[0], b[0]) - 1e-10 &&
      point[0] <= Math.max(a[0], b[0]) + 1e-10 && point[1] >= Math.min(a[1], b[1]) - 1e-10 &&
      point[1] <= Math.max(a[1], b[1]) + 1e-10;
  }
  function inRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (onSegment(point, a, b)) return true;
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function contains(feature, point) {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] :
      geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    return polygons.some(function (rings) {
      return inRing(point, rings[0]) && !rings.slice(1).some(function (ring) { return inRing(point, ring); });
    });
  }
  function find(collection, lat, lon) {
    if (!collection) return null;
    // Palmitas está al final y prevalece sobre la zona amplia de Occidente.
    return [...collection.features].reverse().find(function (feature) { return contains(feature, [lon, lat]); }) || null;
  }
  return { contains: contains, find: find };
});
