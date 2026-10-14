const assert = require('node:assert/strict');
const load = require('../scripts/load-ts.cjs');
const { distance, resample, decodePolyline, geometryKey } = load('lib/geo.ts');
const { graphSkeleton, assembleGraph, search, pathRoute, snapNode, pedestrianAccess } = load('lib/graph.ts');
const { metrics, rankValue } = load('lib/routing.ts');
const { parseRequest } = load('lib/contracts.ts');
const { findRoutes, elevationSamples, providerStatus } = load('lib/providers.ts');
const { parseBoundary, samplePairs, runStudy, analyzeStudy, insideBoundary } = load('lib/study.ts');
const { routesGeoJson, comparisonCsv } = load('lib/exports.ts');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const a = { lat: 37.8, lng: -122.4 }, b = { lat: 37.8003, lng: -122.3997 }, c = { lat: 37.8, lng: -122.3994 }, d = { lat: 37.7995, lng: -122.3997 };
const config = { valhallaUrl: 'https://fixture.invalid', elevationUrl: 'https://fixture.invalid', elevationDataset: 'TEST FIXTURE ONLY', elevationDatum: 'TEST', elevationResolution: 1, networkVersion: 'FIXTURE', metadataVerified: true, allowBatch: true, timeoutMs: 1000, graphPaddingMeters: 100 };
function encode(points) {
  let lastLat = 0, lastLng = 0, result = '';
  const number = value => { let n = value < 0 ? ~(value << 1) : value << 1; while (n >= 32) { result += String.fromCharCode((32 | (n & 31)) + 63); n >>= 5; } result += String.fromCharCode(n + 63); };
  for (const p of points) { const lat = Math.round(p.lat * 1e6), lng = Math.round(p.lng * 1e6); number(lat - lastLat); number(lng - lastLng); lastLat = lat; lastLng = lng; }
  return result;
}
function makeProfile(shape, elevations) {
  const sample = resample(shape, 20);
  return { id: 'fixture', name: 'TEST FIXTURE', color: '#000', ...sample, points: sample.points.map((p, i) => ({ ...p, elevation: elevations[0] + (elevations[1] - elevations[0]) * i / (sample.points.length - 1) })) };
}
function osmWay(id, nodes, tags = {}) { return { type: 'way', id, nodes, tags: { highway: 'residential', ...tags } }; }
const nodes = [a, b, c, d].map((p, i) => ({ type: 'node', id: i + 1, lat: p.lat, lon: p.lng }));
const osm = { elements: [...nodes, osmWay(10, [1, 2, 3]), osmWay(11, [1, 4, 3]), osmWay(12, [1, 3], { foot: 'no' }), osmWay(13, [1, 3], { bridge: 'yes' })] };
const skeleton = graphSkeleton(osm, 20);
const elevation = { 1: 0, 2: 10, 3: 0, 4: 0 };
const profiles = skeleton.edges.map(edge => makeProfile([edge.sample.points[0], edge.sample.points.at(-1)], [elevation[edge.from], elevation[edge.to]]));
const graph = assembleGraph(skeleton, profiles);
const baseline = search(graph, '1', '3', 0, 0), research = search(graph, '1', '3', 12, 3);
assert.deepEqual(baseline.edges.map(e => e.to), ['2', '3']);
assert.deepEqual(research.edges.map(e => e.to), ['4', '3']);
near(research.cost, search(graph, '1', '3', 12, 3, 'dijkstra').cost);
assert.ok(pathRoute(research.edges, 'r', 'r', '#000').distance > pathRoute(baseline.edges, 'b', 'b', '#000').distance);
near(metrics(pathRoute(baseline.edges, 'b', 'b', '#000')).gain, 10);
const reversed = search(graph, '3', '1', 0, 0);
near(metrics(pathRoute(reversed.edges, 'r', 'r', '#000')).gain, 10);
assert.throws(() => search(graph, '1', '3', -1, 0));
assert.throws(() => search({ ...graph, edges: [] }, '1', '3', 0, 0), /disconnected/);
assert.throws(() => snapNode(graph, { lat: 0, lng: 0 }));
assert.equal(snapNode(graph, a).id, '1');
assert.equal(skeleton.excludedSpecial, 1); assert.equal(skeleton.excludedAccess, 1);
assert.equal(pedestrianAccess({ highway: 'residential', access: 'private' }), false);
assert.equal(pedestrianAccess({ highway: 'residential', access: 'private', foot: 'yes' }), true);
assert.equal(pedestrianAccess({ highway: 'motorway', foot: 'yes' }), false);
assert.equal(graphSkeleton({ elements: [...nodes, osmWay(20, [1, 3], { oneway: 'yes' })] }).edges[0].directions.length, 2);
assert.deepEqual(graphSkeleton({ elements: [...nodes, osmWay(20, [1, 3], { 'oneway:foot': 'yes' })] }).edges[0].directions, [1]);
assert.deepEqual(graphSkeleton({ elements: [...nodes, osmWay(20, [1, 3], { 'oneway:foot': '-1' })] }).edges[0].directions, [-1]);
assert.throws(() => graphSkeleton({ elements: [], remark: 'timeout' }), /incomplete/);
const steep = profiles.map(p => ({ ...p, points: p.points.map((point, i) => ({ ...point, elevation: i * 100 })) }));
assert.equal(assembleGraph(skeleton, steep).edges.length, 0);
near(distance(a, c), distance(c, a));
const sampled = resample([a, b, b, c], 10);
assert.ok(sampled.segmentDistances.every(n => n > 0 && n <= 10));
assert.ok(sampled.points.some(p => p.lat === b.lat && p.lng === b.lng));
near(sampled.distance, distance(a, b) + distance(b, c));
assert.equal(geometryKey(decodePolyline(encode([a, b, c]))), geometryKey([a, b, c]));
assert.throws(() => decodePolyline('~')); assert.throws(() => resample([a, a], 10));
assert.throws(() => parseRequest({ start: a, end: a }));
assert.throws(() => parseRequest({ start: a, end: c, uphill: '12' }));
assert.throws(() => parseRequest({ start: { lat: 0, lng: 0 }, end: c }));
assert.throws(() => parseRequest({ start: a, end: c, spacing: 0 }));
assert.equal(providerStatus({}).configured, false);
const trip = { status: 0, summary: { length: .07 }, legs: [{ shape: encode([a, c]) }] };
let routeCalls = 0, traceCalls = 0;
async function transport(url, options) {
  const input = JSON.parse(options.body);
  if (url.endsWith('/route')) { routeCalls++; if (routeCalls % 3 === 1) assert.equal(input.costing_options.pedestrian.shortest, true); return Response.json({ trip, alternates: [{ trip }] }); }
  if (url.endsWith('/trace_attributes')) { traceCalls++; return Response.json({ edges: [{ use: 'road', bridge: false, tunnel: false }] }); }
  if (url.endsWith('/height')) return Response.json({ height: input.shape.map(p => (p.lon + 122.4) * 1000) });
  throw new Error('Unexpected provider request');
}
async function main() {
  const result = await findRoutes({ start: a, end: c, spacing: 20 }, config, undefined, transport);
  assert.equal(routeCalls, 3); assert.equal(traceCalls, 1); assert.equal(result.routes.length, 1);
  const route = result.routes[0]; assert.equal(route.role, 'baseline'); assert.equal(route.provenance.kind, 'dem-estimate');
  near(route.distance, route.segmentDistances.reduce((x, y) => x + y, 0));
  assert.equal(routesGeoJson([route]).features[0].geometry.coordinates[0][0], route.points[0].lng);
  assert.match(comparisonCsv([route]), /normalized_modeled_cost_J_per_kg_m/);
  await assert.rejects(() => elevationSamples([a], config, undefined, async () => Response.json({ height: [null] })), /Missing/);
  await assert.rejects(() => elevationSamples([a], config, undefined, async () => Response.json({ height: [-32768] })), /Missing/);
  await assert.rejects(() => findRoutes({ start: a, end: c, study: true }, { ...config, allowBatch: false }, undefined, transport), /Batch studies/);
  await assert.rejects(() => findRoutes({ start: a, end: c }, config, undefined, async () => new Response('', { status: 429 })), /HTTP 429/);
  assert.equal(rankValue({ ...route, provenance: { ...route.provenance, specialSections: ['bridge'] } }, 'energy', 0, 0), Infinity);
  const degraded = await findRoutes({ start: a, end: c }, config, undefined, async (url, options) => url.endsWith('/trace_attributes') ? new Response('', { status: 400 }) : transport(url, options));
  assert.deepEqual(degraded.routes[0].provenance.specialSections, ['unverified surface attributes']);
  assert.equal(rankValue(degraded.routes[0], 'energy', 0, 0), Infinity);
  const boundary = parseBoundary({ type: 'Polygon', coordinates: [[[-122.405, 37.795], [-122.395, 37.795], [-122.395, 37.805], [-122.405, 37.805], [-122.405, 37.795]]] });
  const options = { seed: 42, count: 3, spacings: [10, 20], minDistance: 100, maxDistance: 1000, graph: false, uphill: 12, downhill: 3 };
  const pairs = samplePairs(boundary, options);
  assert.deepEqual(pairs, samplePairs(boundary, options)); assert.ok(pairs.every(p => insideBoundary(p.start, boundary) && insideBoundary(p.end, boundary)));
  const holes = parseBoundary({ type: 'Polygon', coordinates: [boundary.polygons[0][0], [[-122.401, 37.799], [-122.399, 37.799], [-122.399, 37.801], [-122.401, 37.801], [-122.401, 37.799]]] });
  assert.equal(insideBoundary(a, holes), false);
  assert.throws(() => parseBoundary({ type: 'LineString', coordinates: [] }));
  let requests = 0;
  const dataset = await runStudy(boundary, options, async request => { assert.equal(request.study, true); if (++requests === 2) throw new Error('fixture coverage failure'); return { ...result, request, routes: [route, { ...route, id: 'duplicate' }] }; });
  assert.equal(dataset.records.length, 6); assert.equal(dataset.records[1].error, 'fixture coverage failure');
  assert.deepEqual(dataset.records[0].start, dataset.records[1].start);
  const analysis = analyzeStudy(dataset, 20);
  assert.equal(analysis[0].duplicateRoutes, 3); assert.equal(analysis[1].failedPairs, 1);
  assert.ok(analysis.every(r => r.correlations.every(c => c.rho === null))); // identical fixture metrics give constant ranks
  const varied = { ...dataset, records: dataset.records.filter(record => record.spacing === 10).map((record, i) => ({ ...record, result: { ...result, routes: [{ ...route, points: route.points.map((p, j) => ({ ...p, elevation: (i + 1) * j / (route.points.length - 1) })) }] } })) };
  const agreement = analyzeStudy(varied, 100)[0].correlations;
  agreement.forEach(c => {
    near(c.rho, 1);
    assert.ok(c.validBootstrapReplicates > 0 && c.validBootstrapReplicates < 100);
    c.interval95.forEach(value => near(value, 1));
  });
  const unverified = { ...dataset, records: dataset.records.map(r => r.result ? { ...r, result: { ...r.result, sources: { ...r.result.sources, metadataVerified: false } } } : r) };
  assert.equal(analyzeStudy(unverified)[0].eligibleRoutes, 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => runStudy(boundary, options, transport, undefined, abort.signal));
  console.log('Passed graph optimality, directed/access exclusions, resampling, provider contracts, missing-data handling, study reproducibility, dependence units and exports. Fixture results are not empirical findings.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
