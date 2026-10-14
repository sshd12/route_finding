import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assembleGraph, graphSkeleton, pathRoute, search, snapNode, type OsmData } from './graph';
import { decodePolyline, distance, geometryKey, resample, SF_BOUNDS } from './geo';
import { metrics, type Coordinate, type Provenance, type Route } from './routing';
import { parseRequest, type RouteRequest, type RouteResult } from './contracts';

export type ProviderConfig = {
  valhallaUrl: string; elevationUrl: string; overpassUrl?: string; osmFile?: string;
  elevationDataset: string; elevationDatum: string; elevationResolution: number | null;
  networkVersion: string; timeoutMs: number; graphPaddingMeters: number; metadataVerified: boolean; allowBatch: boolean;
};
export function providerStatus(env = process.env) {
  const missing = ['VALHALLA_URL'].filter(key => !env[key]);
  const metadataVerified = Boolean(env.ELEVATION_DATASET && env.ELEVATION_DATUM && Number(env.ELEVATION_RESOLUTION_M) > 0 && env.OSM_DATA_VERSION);
  return { configured: missing.length === 0, missing, metadataVerified, graphConfigured: Boolean(env.OSM_GRAPH_FILE || env.OVERPASS_URL), batchConfigured: metadataVerified && env.ALLOW_BATCH_STUDIES === 'true' };
}
export function providerConfig(env = process.env): ProviderConfig {
  const status = providerStatus(env);
  if (!status.configured) throw new Error(`Configure ${status.missing.join(', ')} on the server before requesting real routes.`);
  return { valhallaUrl: env.VALHALLA_URL!, elevationUrl: env.ELEVATION_URL || env.VALHALLA_URL!, overpassUrl: env.OVERPASS_URL, osmFile: env.OSM_GRAPH_FILE,
    elevationDataset: env.ELEVATION_DATASET || 'Configured elevation service (dataset unverified)', elevationDatum: env.ELEVATION_DATUM || 'Unverified datum', elevationResolution: Number(env.ELEVATION_RESOLUTION_M) > 0 ? Number(env.ELEVATION_RESOLUTION_M) : null,
    networkVersion: env.OSM_DATA_VERSION || 'Unverified provider graph version', timeoutMs: 60000, graphPaddingMeters: 750, metadataVerified: status.metadataVerified, allowBatch: status.batchConfigured };
}
async function postJson(url: string, body: unknown, config: ProviderConfig, signal?: AbortSignal, transport: typeof fetch = fetch) {
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs);
  const response = await transport(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'comfortwalk-research-prototype' }, body: JSON.stringify(body), signal: combined, cache: 'no-store' });
  if (!response.ok) throw new Error(`Routing/elevation provider returned HTTP ${response.status}. Check service coverage and configuration.`);
  const value = await response.json();
  if (value.error || value.error_code) throw new Error(`Provider could not process this route (${value.error_code ?? 'unknown error'}).`);
  return value;
}
const endpoint = (base: string, path: string) => `${base.replace(/\/$/, '')}/${path}`;
export async function elevationSamples(points: Coordinate[], config: ProviderConfig, signal?: AbortSignal, transport: typeof fetch = fetch) {
  const heights: number[] = [];
  for (let i = 0; i < points.length; i += 256) {
    const chunk = points.slice(i, i + 256);
    const value = await postJson(endpoint(config.elevationUrl, 'height'), { shape: chunk.map(p => ({ lat: p.lat, lon: p.lng })), height_precision: 2 }, config, signal, transport);
    if (!Array.isArray(value.height) || value.height.length !== chunk.length || value.height.some((h: unknown) => typeof h !== 'number' || !Number.isFinite(h) || h < -500 || h > 9000)) throw new Error('Missing or invalid DEM elevations. No zero-height substitution was applied.');
    heights.push(...value.height);
  }
  return heights;
}
function provenance(config: ProviderConfig, spacing: number, retrievedAt: string): Provenance {
  return { kind: 'dem-estimate', network: `OpenStreetMap / ${config.networkVersion}`, elevation: config.elevationDataset, retrievedAt, spacing, smoothing: 'none', distanceMethod: 'horizontal great-circle segment distances; preserved vertices; subdivisions <= spacing', specialSections: [] };
}
export async function profileRoute(shape: Coordinate[], config: ProviderConfig, spacing: number, id: string, name: string, color: string, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<Route> {
  const sample = resample(shape, spacing);
  const heights = await elevationSamples(sample.points, config, signal, transport);
  return { id, name, color, geometry: shape, ...sample, points: sample.points.map((p, i) => ({ ...p, elevation: heights[i] })), provenance: provenance(config, spacing, new Date().toISOString()) };
}
type Trip = { legs: { shape: string }[]; summary: { length: number }; status: number };
async function valhallaRoutes(request: RouteRequest, config: ProviderConfig, signal?: AbortSignal, transport: typeof fetch = fetch) {
  const result: Route[] = [], seen = new Set<string>();
  // Baseline is mandatory; additional hill-preference candidates may coincide with it.
  for (const [i, options] of [{ shortest: true }, { use_hills: 0 }, { use_hills: 1 }].entries()) {
    const response = await postJson(endpoint(config.valhallaUrl, 'route'), {
      locations: [request.start, request.end].map(p => ({ lat: p.lat, lon: p.lng })), costing: 'pedestrian', units: 'kilometers', shape_format: 'polyline6',
      costing_options: { pedestrian: options }, alternates: i === 1 ? 2 : 0,
    }, config, signal, transport);
    const trips: Trip[] = [response.trip, ...(response.alternates ?? []).map((a: { trip: Trip }) => a.trip)];
    for (const trip of trips) {
      if (!trip || trip.status !== 0 || trip.legs?.length !== 1 || typeof trip.legs[0].shape !== 'string') throw new Error('Invalid Valhalla walking route response.');
      const shape = decodePolyline(trip.legs[0].shape);
      if (distance(shape[0], request.start) > 100 || distance(shape.at(-1)!, request.end) > 100) throw new Error('Valhalla snapped an endpoint farther than 100 m from the requested location.');
      const key = geometryKey(shape);
      if (seen.has(key)) continue;
      seen.add(key);
      const special = new Set<string>();
      try {
        const attributes = await postJson(endpoint(config.valhallaUrl, 'trace_attributes'), {
          encoded_polyline: trip.legs[0].shape, shape_match: 'edge_walk', costing: 'pedestrian', filters: { action: 'include', attributes: ['edge.bridge', 'edge.tunnel', 'edge.use', 'edge.indoor'] },
        }, config, signal, transport);
        if (!Array.isArray(attributes.edges) || !attributes.edges.length) throw new Error('Missing route attributes.');
        for (const edge of attributes.edges) {
          if (typeof edge.use !== 'string') special.add('unverified surface attributes');
          if (edge.bridge) special.add('bridge'); if (edge.tunnel) special.add('tunnel'); if (edge.indoor) special.add('indoor');
          if (['steps', 'stairs', 'elevator', 'escalator', 'ferry'].includes(edge.use)) special.add(edge.use);
        }
      } catch {
        signal?.throwIfAborted();
        // Keep the original walking geometry; do not silently remap it to another road.
        special.add('unverified surface attributes');
      }
      const route = await profileRoute(shape, config, request.spacing, `valhalla-${result.length}`, i === 0 ? 'Valhalla distance baseline' : `Valhalla walking alternative ${result.length}`, ['#a87b55', '#6384ae', '#9165a3', '#507d8b'][result.length % 4], signal, transport);
      if (!Number.isFinite(trip.summary?.length) || trip.summary.length <= 0) throw new Error('Invalid provider route length.');
      route.provenance!.specialSections = [...special]; route.role = i === 0 ? 'baseline' : 'candidate'; route.providerDistance = trip.summary.length * 1000;
      result.push(route);
    }
  }
  return result;
}
async function graphRoutes(request: RouteRequest, config: ProviderConfig, signal?: AbortSignal, transport: typeof fetch = fetch) {
  const latPad = config.graphPaddingMeters / 111195, lngPad = latPad / Math.cos(request.start.lat * Math.PI / 180);
  const bounds = [Math.max(SF_BOUNDS.south, Math.min(request.start.lat, request.end.lat) - latPad), Math.max(SF_BOUNDS.west, Math.min(request.start.lng, request.end.lng) - lngPad), Math.min(SF_BOUNDS.north, Math.max(request.start.lat, request.end.lat) + latPad), Math.min(SF_BOUNDS.east, Math.max(request.start.lng, request.end.lng) + lngPad)];
  let data: OsmData;
  if (config.osmFile) {
    data = JSON.parse(await readFile(config.osmFile, 'utf8'));
  } else {
    if (!config.overpassUrl) throw new Error('Configure OSM_GRAPH_FILE or OVERPASS_URL for experimental graph search.');
    const area = (bounds[2] - bounds[0]) * 111195 * (bounds[3] - bounds[1]) * 111195 * Math.cos(request.start.lat * Math.PI / 180);
    if (area > 25000000) throw new Error('Live graph query exceeds 25 km². Use a local OSM_GRAPH_FILE extract for larger study areas.');
    const response = await transport(config.overpassUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'comfortwalk-research-prototype/0.2' }, body: new URLSearchParams({ data: `[out:json][timeout:45];way[highway](${bounds.join(',')});(._;>;);out body;` }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs), cache: 'no-store' });
    if (!response.ok) throw new Error(`OSM network provider returned HTTP ${response.status}.`);
    data = await response.json();
  }
  const skeleton = graphSkeleton(data, request.spacing);
  const unique = new Map<string, Coordinate>();
  for (const edge of skeleton.edges) for (const p of edge.sample.points) unique.set(`${p.lat.toFixed(9)},${p.lng.toFixed(9)}`, p);
  if (unique.size > 30000) throw new Error('Graph exceeds 30,000 elevation samples. Use a smaller study area or larger sampling interval.');
  const keys = [...unique.keys()], coordinates = [...unique.values()];
  const heights = await elevationSamples(coordinates, config, signal, transport), heightByKey = new Map(keys.map((key, i) => [key, heights[i]]));
  const retrievedAt = new Date().toISOString();
  const profiles = skeleton.edges.map(edge => ({ id: edge.id, name: 'OSM edge', color: '#347d62', ...edge.sample, points: edge.sample.points.map(p => ({ ...p, elevation: heightByKey.get(`${p.lat.toFixed(9)},${p.lng.toFixed(9)}`)! })) }));
  const graph = assembleGraph(skeleton, profiles);
  const snaps = [snapNode(graph, request.start), snapNode(graph, request.end)];
  const baseline = pathRoute(search(graph, snaps[0].id, snaps[1].id, 0, 0, request.algorithm).edges, 'graph-baseline', 'Graph distance baseline', '#a87b55');
  const research = pathRoute(search(graph, snaps[0].id, snaps[1].id, request.uphill, request.downhill, request.algorithm).edges, 'graph-research', 'Experimental hill-aware route', '#347d62');
  baseline.role = 'baseline'; research.role = 'research';
  for (const route of [baseline, research]) route.provenance = { ...provenance(config, request.spacing, retrievedAt), parameters: { algorithm: request.algorithm, uphill: route.role === 'baseline' ? 0 : request.uphill, downhill: route.role === 'baseline' ? 0 : request.downhill, cost: 'distance + uphill * ascent + downhill * descent (provisional)' } };
  return { routes: [baseline, research], graph: { bounds: config.osmFile ? [] : bounds, nodes: graph.nodes.size, edges: graph.edges.length, hash: createHash('sha256').update(JSON.stringify(data)).digest('hex'), excludedSpecial: graph.excludedSpecial, excludedAccess: graph.excludedAccess, excludedGrade: graph.excludedGrade, snaps, snapshot: data } };
}
export async function findRoutes(input: unknown, config = providerConfig(), signal?: AbortSignal, transport: typeof fetch = fetch): Promise<RouteResult> {
  const request = parseRequest(input);
  if (request.study && !config.allowBatch) throw new Error('Batch studies require ALLOW_BATCH_STUDIES=true, documented DEM/OSM metadata, and services permitted for batch use.');
  const candidates = await valhallaRoutes(request, config, signal, transport), warnings: string[] = [];
  const routes = [...candidates];
  if (!config.metadataVerified) warnings.push('Elevation dataset, grid resolution, datum or network version is unverified. These interactive estimates are excluded from study analysis.');
  let graphResult: Awaited<ReturnType<typeof graphRoutes>> | undefined;
  if (request.graph) { graphResult = await graphRoutes(request, config, signal, transport); routes.unshift(...graphResult.routes); }
  for (const route of routes) {
    const m = metrics(route);
    if (m.outsideRange) warnings.push(`${route.name}: grade outside ±45%; modeled energy is extrapolated and excluded from energy ranking and study correlations.`);
    if (route.provenance?.specialSections.length) warnings.push(`${route.name}: ${route.provenance.specialSections.join(', ')} present; ground DEM energy is excluded from ranking and study correlations.`);
  }
  if (graphResult) warnings.push('Graph search is optimal only within the supplied modeled graph, with conservative access rules. Snapping gaps are excluded from walking distance; pedestrian turn restrictions and open-area crossings are not modeled.');
  warnings.push('DEM elevations are estimates. The experimental cost and weights are provisional; this is a model comparison, not independent empirical validation.');
  return { routes, baselineId: graphResult ? 'graph-baseline' : candidates[0].id, researchId: graphResult ? 'graph-research' : undefined, request, warnings, graph: graphResult?.graph,
    sources: { elevation: config.elevationDataset, datum: config.elevationDatum, resolutionMeters: config.elevationResolution, networkVersion: config.networkVersion, metadataVerified: config.metadataVerified, retrievedAt: new Date().toISOString() } };
}
