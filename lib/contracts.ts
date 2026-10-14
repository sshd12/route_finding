import { distance, inStudyBounds, validCoordinate } from './geo';
import type { Coordinate, Route } from './routing';
export type RouteRequest = { start: Coordinate; end: Coordinate; uphill: number; downhill: number; spacing: number; graph: boolean; study: boolean; algorithm: 'astar' | 'dijkstra' };
export type RouteResult = {
  routes: Route[]; baselineId: string; researchId?: string; warnings: string[]; request: RouteRequest;
  sources: { elevation: string; datum: string; resolutionMeters: number | null; networkVersion: string; retrievedAt: string; metadataVerified: boolean };
  graph?: { bounds: number[]; nodes: number; edges: number; hash: string; excludedSpecial: number; excludedAccess: number; excludedGrade: number; snaps: { point: Coordinate; gap: number }[]; snapshot: unknown };
};
export function parseRequest(input: unknown): RouteRequest {
  if (!input || typeof input !== 'object') throw new Error('Provide a routing request.');
  const value = input as Record<string, unknown>;
  if (!validCoordinate(value.start) || !validCoordinate(value.end) || !inStudyBounds(value.start) || !inStudyBounds(value.end)) throw new Error('Choose valid endpoints within the San Francisco study bounding box.');
  if (distance(value.start, value.end) < 10 || distance(value.start, value.end) > 15000) throw new Error('Endpoints must be between 10 m and 15 km apart.');
  const numeric = (key: string, fallback: number, min: number, max: number) => {
    const v = value[key] ?? fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid ${key}: expected ${min}–${max}.`);
    return v;
  };
  if (value.graph !== undefined && typeof value.graph !== 'boolean') throw new Error('Invalid graph option.');
  if (value.study !== undefined && typeof value.study !== 'boolean') throw new Error('Invalid study option.');
  if (value.algorithm !== undefined && value.algorithm !== 'astar' && value.algorithm !== 'dijkstra') throw new Error('Invalid search algorithm.');
  return { start: { lat: value.start.lat, lng: value.start.lng }, end: { lat: value.end.lat, lng: value.end.lng }, uphill: numeric('uphill', 12, 0, 30), downhill: numeric('downhill', 3, 0, 15), spacing: numeric('spacing', 20, 5, 100), graph: value.graph ?? false, study: value.study ?? false, algorithm: value.algorithm === 'dijkstra' ? 'dijkstra' : 'astar' };
}
