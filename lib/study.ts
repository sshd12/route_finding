import { distance, geometryKey, SF_BOUNDS, validCoordinate } from './geo';
import { metrics, spearman, type Coordinate, type Route } from './routing';
import type { RouteRequest, RouteResult } from './contracts';
type Polygon = number[][][];
export type Boundary = { polygons: Polygon[]; source: unknown };
export type StudyOptions = { seed: number; count: number; spacings: number[]; minDistance: number; maxDistance: number; graph: boolean; uphill: number; downhill: number };
export type StudyRecord = { pair: number; start: Coordinate; end: Coordinate; spacing: number; result?: RouteResult; error?: string };
export type StudyDataset = { schemaVersion: 1; createdAt: string; options: StudyOptions; boundary: unknown; samplingFrame: typeof SF_BOUNDS; records: StudyRecord[]; limitations: string[] };
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function parseBoundary(input: unknown): Boundary {
  const polygons: Polygon[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid GeoJSON boundary.');
    const object = value as { type: string; geometry?: unknown; features?: unknown[]; coordinates?: Polygon | Polygon[] };
    if (object.type === 'FeatureCollection' && Array.isArray(object.features)) { object.features.forEach(visit); return; }
    if (object.type === 'Feature') { visit(object.geometry); return; }
    const shapes = object.type === 'Polygon' ? [object.coordinates] : object.type === 'MultiPolygon' ? object.coordinates : null;
    if (!Array.isArray(shapes)) throw new Error('Boundary must contain only Polygon or MultiPolygon geometry.');
    for (const polygon of shapes as Polygon[]) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Invalid boundary rings.');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || p.length < 2 || !validCoordinate({ lng: p[0], lat: p[1] }))) throw new Error('Boundary coordinates must use WGS84 longitude, latitude.');
        if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) throw new Error('Boundary rings must be closed.');
      }
      polygons.push(polygon);
    }
  };
  visit(input);
  if (!polygons.length) throw new Error('Empty geographic boundary.');
  return { polygons, source: input };
}
export function insideBoundary(point: Coordinate, boundary: Boundary) {
  const inRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > point.lat) !== (yj > point.lat) && point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return boundary.polygons.some(polygon => inRing(polygon[0]) && !polygon.slice(1).some(inRing));
}
export function samplePairs(boundary: Boundary, options: StudyOptions) {
  if (![options.uphill, options.downhill].every(v => Number.isFinite(v) && v >= 0) || options.uphill > 30 || options.downhill > 15 || typeof options.graph !== 'boolean') throw new Error('Invalid study search parameters.');
  if (!Number.isInteger(options.seed) || !Number.isInteger(options.count) || options.count < 1 || options.count > 50 || !Number.isFinite(options.minDistance) || !Number.isFinite(options.maxDistance) || options.minDistance < 10 || options.maxDistance > 15000 || options.minDistance >= options.maxDistance || !options.spacings.length || options.spacings.length > 5 || options.spacings.some(s => !Number.isFinite(s) || s < 5 || s > 100) || new Set(options.spacings).size !== options.spacings.length) throw new Error('Invalid study parameters. Use 1–50 pairs, unique intervals of 5–100 m, and endpoint distances of 10 m–15 km.');
  const vertices = boundary.polygons.flatMap(p => p[0]);
  const south = Math.max(SF_BOUNDS.south, Math.min(...vertices.map(p => p[1]))), north = Math.min(SF_BOUNDS.north, Math.max(...vertices.map(p => p[1])));
  const west = Math.max(SF_BOUNDS.west, Math.min(...vertices.map(p => p[0]))), east = Math.min(SF_BOUNDS.east, Math.max(...vertices.map(p => p[0])));
  if (south >= north || west >= east) throw new Error('Boundary does not intersect the San Francisco study bounding box.');
  const rng = random(options.seed), pairs: { start: Coordinate; end: Coordinate }[] = [];
  const draw = () => ({ lat: south + (north - south) * rng(), lng: west + (east - west) * rng() });
  for (let attempts = 0; pairs.length < options.count && attempts < 100000; attempts++) {
    const start = draw(), end = draw(), d = distance(start, end);
    if (insideBoundary(start, boundary) && insideBoundary(end, boundary) && d >= options.minDistance && d <= options.maxDistance) pairs.push({ start, end });
  }
  if (pairs.length !== options.count) throw new Error('Cannot sample the requested pairs within this boundary and distance limits.');
  return pairs;
}
export async function runStudy(boundary: Boundary, options: StudyOptions, route: (request: RouteRequest) => Promise<RouteResult>, progress?: (completed: number, total: number) => void, signal?: AbortSignal): Promise<StudyDataset> {
  const pairs = samplePairs(boundary, options), records: StudyRecord[] = [];
  for (const [pair, endpoints] of pairs.entries()) for (const spacing of options.spacings) {
    signal?.throwIfAborted();
    const record: StudyRecord = { pair, ...endpoints, spacing };
    try { record.result = await route({ ...endpoints, spacing, uphill: options.uphill, downhill: options.downhill, graph: options.graph, study: true, algorithm: 'astar' }); }
    catch (error) { signal?.throwIfAborted(); record.error = error instanceof Error ? error.message : 'Unknown provider failure.'; }
    records.push(record); progress?.(records.length, pairs.length * options.spacings.length);
  }
  return { schemaVersion: 1, createdAt: new Date().toISOString(), options, boundary: boundary.source, samplingFrame: SF_BOUNDS, records,
    limitations: ['Uniform longitude/latitude draws within the supplied boundary intersected with the San Francisco bounding box; network snapping changes endpoints.', 'Failed pairs are retained, without replacement; successful-route selection may introduce bias.', 'Multiple routes sharing endpoints are dependent; bootstrap units are endpoint pairs.', 'Sampling sensitivity reruns the complete routing pipeline, so both geometry and metrics can change.', 'Metrics and modeled energy share slope inputs. This is a model comparison, not independent empirical validation.', 'DEM surface, alignment, resolution and noise affect grades; unsupported structures and out-of-range grades are excluded from correlations.'] };
}
const metricKeys = ['gain', 'averageGrade', 'maxGrade'] as const;
export function analyzeStudy(dataset: StudyDataset, bootstrapIterations = 500) {
  return dataset.options.spacings.map(spacing => {
    const records = dataset.records.filter(r => r.spacing === spacing);
    const groups: { pair: number; routes: Route[] }[] = [];
    let excluded = 0, duplicates = 0;
    for (const record of records) {
      const seen = new Set<string>(), eligible: Route[] = [];
      for (const route of record.result?.routes ?? []) {
        const key = geometryKey(route.geometry ?? route.points);
        if (seen.has(key)) { duplicates++; continue; } seen.add(key);
        const m = metrics(route);
        if (!record.result?.sources.metadataVerified || route.provenance?.kind !== 'dem-estimate' || route.provenance.specialSections.length || m.outsideRange || !Number.isFinite(m.normalizedCost)) { excluded++; continue; }
        eligible.push(route);
      }
      if (eligible.length) groups.push({ pair: record.pair, routes: eligible });
    }
    const correlate = (routes: Route[], key: typeof metricKeys[number]) => {
      const measurements = routes.map(metrics);
      return spearman(measurements.map(m => m[key]), measurements.map(m => m.normalizedCost));
    };
    const routes = groups.flatMap(g => g.routes), rng = random(dataset.options.seed + spacing);
    const correlations = metricKeys.map(key => {
      const values: number[] = [];
      if (groups.length >= 2) for (let i = 0; i < bootstrapIterations; i++) {
        const sample = groups.flatMap(() => groups[Math.floor(rng() * groups.length)].routes);
        const value = correlate(sample, key); if (value !== null) values.push(value);
      }
      values.sort((a, b) => a - b);
      return { metric: key, rho: correlate(routes, key), interval95: values.length ? [values[Math.floor((values.length - 1) * .025)], values[Math.ceil((values.length - 1) * .975)]] : null, validBootstrapReplicates: values.length };
    });
    return { spacing, attemptedPairs: records.length, successfulPairs: records.filter(r => r.result).length, failedPairs: records.filter(r => r.error).length, eligiblePairs: groups.length, eligibleRoutes: routes.length, excludedRoutes: excluded, duplicateRoutes: duplicates, correlations,
      withinPairs: groups.map(g => ({ pair: g.pair, count: g.routes.length, correlations: metricKeys.map(key => ({ metric: key, rho: correlate(g.routes, key) })) })) };
  });
}
