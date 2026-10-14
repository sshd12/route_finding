import { distance, resample } from './geo';
import { metrics, score, type Coordinate, type Route } from './routing';

export type OsmNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> };
export type OsmWay = { type: 'way'; id: number; nodes: number[]; tags: Record<string, string> };
export type OsmData = { elements: (OsmNode | OsmWay)[]; osm3s?: { timestamp_osm_base?: string }; remark?: string };
export type Edge = { id: string; from: string; to: string; profile: Route };
export type Graph = { nodes: Map<string, Coordinate>; edges: Edge[]; excludedSpecial: number; excludedAccess: number; excludedGrade: number };
const allowedHighways = new Set(['footway', 'path', 'pedestrian', 'living_street', 'residential', 'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'track', 'cycleway']);
const allowedAccess = new Set(['yes', 'designated', 'permissive']);
export function pedestrianAccess(tags: Record<string, string>) {
  if (!allowedHighways.has(tags.highway) || tags.area === 'yes' || tags.indoor === 'yes') return false;
  if (tags.foot) return allowedAccess.has(tags.foot);
  if (tags.access && !allowedAccess.has(tags.access)) return false;
  if (tags.highway === 'cycleway') return false;
  return tags.sidewalk !== 'separate';
}
/** Conservative research graph: omit structures that a ground DEM cannot represent. */
export function graphSkeleton(data: OsmData, spacing = 20) {
  if (!Array.isArray(data.elements) || data.remark) throw new Error(data.remark ? 'OSM query was incomplete; reduce the study area.' : 'Invalid OSM response.');
  const nodes = new Map(data.elements.filter((e): e is OsmNode => e.type === 'node').map(n => [String(n.id), n]));
  const edges: { id: string; from: string; to: string; sample: ReturnType<typeof resample>; directions: number[] }[] = [];
  let excludedSpecial = 0, excludedAccess = 0;
  for (const way of data.elements.filter((e): e is OsmWay => e.type === 'way')) {
    if (way.tags.highway === 'steps' || (way.tags.bridge && way.tags.bridge !== 'no') || (way.tags.tunnel && way.tags.tunnel !== 'no')) { excludedSpecial++; continue; }
    if (!pedestrianAccess(way.tags) || way.tags['access:conditional'] || way.tags['foot:conditional'] || way.tags['oneway:foot:conditional']) { excludedAccess++; continue; }
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodes.get(String(way.nodes[i - 1])), b = nodes.get(String(way.nodes[i]));
      if (!a || !b) throw new Error('OSM way references missing nodes.');
      const blocked = (n: OsmNode) => n.tags && ((n.tags.foot && !allowedAccess.has(n.tags.foot)) || (!n.tags.foot && n.tags.access && !allowedAccess.has(n.tags.access)) || (n.tags.barrier && !['bollard', 'cycle_barrier', 'entrance', 'kerb'].includes(n.tags.barrier) && !allowedAccess.has(n.tags.foot)));
      if (blocked(a) || blocked(b)) { excludedAccess++; continue; }
      if (distance({ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon }) < .001) continue;
      const directions = [];
      if (way.tags['oneway:foot'] !== '-1' && (!way.tags['foot:forward'] || allowedAccess.has(way.tags['foot:forward']))) directions.push(1);
      if (!['yes', '1', 'true'].includes(way.tags['oneway:foot']) && (!way.tags['foot:backward'] || allowedAccess.has(way.tags['foot:backward']))) directions.push(-1);
      edges.push({ id: `${way.id}:${i}`, from: String(a.id), to: String(b.id), sample: resample([{ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon }], spacing), directions });
    }
  }
  return { nodes, edges, excludedSpecial, excludedAccess };
}
export function assembleGraph(skeleton: ReturnType<typeof graphSkeleton>, profiles: Route[]): Graph {
  if (profiles.length !== skeleton.edges.length) throw new Error('Graph elevation profiles do not match edges.');
  const graph: Graph = { nodes: new Map(), edges: [], excludedAccess: skeleton.excludedAccess, excludedSpecial: skeleton.excludedSpecial, excludedGrade: 0 };
  skeleton.edges.forEach((edge, i) => {
    const profile = profiles[i];
    if (metrics(profile).outsideRange) { graph.excludedGrade++; return; }
    for (const direction of edge.directions) {
      const forward = direction === 1;
      const from = forward ? edge.from : edge.to, to = forward ? edge.to : edge.from;
      const directed = forward ? profile : { ...profile, points: [...profile.points].reverse(), segmentDistances: [...profile.segmentDistances].reverse() };
      graph.edges.push({ id: `${edge.id}:${direction}`, from, to, profile: directed });
      graph.nodes.set(from, directed.points[0]); graph.nodes.set(to, directed.points.at(-1)!);
    }
  });
  return graph;
}
export function snapNode(graph: Graph, point: Coordinate, maxDistance = 100) {
  let closest = '', gap = Infinity;
  for (const [id, coordinate] of graph.nodes) {
    const d = distance(point, coordinate);
    if (d < gap) { closest = id; gap = d; }
  }
  if (gap > maxDistance) throw new Error(`No modeled walking-network node within ${maxDistance} m of an endpoint.`);
  return { id: closest, point: graph.nodes.get(closest)!, gap };
}
class Heap {
  items: { node: string; priority: number; cost: number }[] = [];
  push(item: typeof this.items[number]) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= item.priority) break;
      this.items[i] = this.items[parent]; i = parent;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (2 * i + 1 < this.items.length) {
        let child = 2 * i + 1;
        if (child + 1 < this.items.length && this.items[child + 1].priority < this.items[child].priority) child++;
        if (this.items[child].priority >= last.priority) break;
        this.items[i] = this.items[child]; i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}
/** Distance is an admissible A* heuristic for distance + nonnegative ascent/descent penalties. */
export function search(graph: Graph, start: string, end: string, uphill: number, downhill: number, algorithm: 'astar' | 'dijkstra' = 'astar') {
  if (![uphill, downhill].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Invalid search weights.');
  if (!graph.nodes.has(start) || !graph.nodes.has(end) || start === end) throw new Error('Select distinct walking-network nodes.');
  const adjacent = new Map<string, Edge[]>();
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to) || edge.profile.distance + 1e-6 < distance(graph.nodes.get(edge.from)!, graph.nodes.get(edge.to)!)) throw new Error('Graph edges must connect known nodes with valid geographic distances.');
    const list = adjacent.get(edge.from) ?? []; list.push(edge); adjacent.set(edge.from, list);
  }
  const costs = new Map([[start, 0]]), previous = new Map<string, Edge>(), heap = new Heap();
  const heuristic = (node: string) => algorithm === 'astar' ? distance(graph.nodes.get(node)!, graph.nodes.get(end)!) : 0;
  heap.push({ node: start, cost: 0, priority: heuristic(start) });
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== costs.get(current.node)) continue;
    if (current.node === end) {
      const path: Edge[] = [];
      for (let node = end; node !== start;) { const edge = previous.get(node)!; path.push(edge); node = edge.from; }
      return { edges: path.reverse(), cost: current.cost };
    }
    for (const edge of adjacent.get(current.node) ?? []) {
      const cost = current.cost + score(edge.profile, uphill, downhill);
      if (!Number.isFinite(cost)) throw new Error('Nonfinite graph cost.');
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost); previous.set(edge.to, edge);
        heap.push({ node: edge.to, cost, priority: cost + heuristic(edge.to) });
      }
    }
  }
  throw new Error('Endpoints are disconnected in the modeled graph.');
}
export function pathRoute(path: Edge[], id: string, name: string, color: string): Route {
  if (!path.length) throw new Error('Empty walking path.');
  const points = [path[0].profile.points[0]], segmentDistances: number[] = [];
  path.forEach(edge => { points.push(...edge.profile.points.slice(1)); segmentDistances.push(...edge.profile.segmentDistances); });
  return { id, name, color, points, segmentDistances, distance: segmentDistances.reduce((a, b) => a + b, 0) };
}
