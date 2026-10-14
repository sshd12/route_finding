import type { Coordinate } from './routing';

export function validCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== 'object') return false;
  const p = value as Coordinate;
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
export function distance(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
/** Preserve all geometry vertices; subdivide each segment to at most spacing meters. */
export function resample(shape: Coordinate[], spacing: number) {
  if (shape.length < 2 || !shape.every(validCoordinate) || !Number.isFinite(spacing) || spacing < 5 || spacing > 100) throw new Error('Invalid route geometry or sampling interval (5–100 m).');
  const points = [shape[0]], segmentDistances: number[] = [];
  for (let i = 1; i < shape.length; i++) {
    const a = shape[i - 1], b = shape[i], length = distance(a, b);
    if (length < .001) continue;
    const count = Math.ceil(length / spacing);
    if (points.length + count > 50000) throw new Error('Elevation profile exceeds 50,000 samples.');
    for (let j = 1; j <= count; j++) {
      points.push({ lat: a.lat + (b.lat - a.lat) * j / count, lng: a.lng + (b.lng - a.lng) * j / count });
      segmentDistances.push(length / count);
    }
  }
  if (!segmentDistances.length) throw new Error('Route has zero length.');
  return { points, segmentDistances, distance: segmentDistances.reduce((a, b) => a + b, 0) };
}
export function decodePolyline(encoded: string, precision = 6): Coordinate[] {
  let index = 0, lat = 0, lng = 0;
  const read = () => {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid encoded route geometry.');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid encoded route geometry.');
      result |= (byte & 31) << shift; shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  const points: Coordinate[] = [];
  while (index < encoded.length) {
    lat += read(); lng += read();
    points.push({ lat: lat / 10 ** precision, lng: lng / 10 ** precision });
  }
  if (points.length < 2 || !points.every(validCoordinate)) throw new Error('Invalid encoded route geometry.');
  return points;
}
export function geometryKey(shape: Coordinate[]) {
  return shape.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';');
}
export const SF_BOUNDS = { south: 37.708, west: -122.515, north: 37.833, east: -122.35 };
export function inStudyBounds(p: Coordinate) {
  return p.lat >= SF_BOUNDS.south && p.lat <= SF_BOUNDS.north && p.lng >= SF_BOUNDS.west && p.lng <= SF_BOUNDS.east;
}
