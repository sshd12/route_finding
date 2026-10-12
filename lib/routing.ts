/** Synthetic candidate routes: illustrative only, not surveyed walkable paths. */
export type Point = { lat: number; lng: number; elevation: number };
export type Route = { id: string; name: string; distance: number; segmentDistances: number[]; points: Point[]; color: string };
const point = (lat: number, lng: number, elevation: number): Point => ({ lat, lng, elevation });
export const locations = ['Ferry Building', 'Washington Square'] as const;
export const routes: Route[] = [
  { id: 'direct', name: 'Direct route', distance: 1650, segmentDistances: [700, 450, 500], color: '#a87b55', points: [point(37.7955,-122.3937,5),point(37.797,-122.402,18),point(37.799,-122.406,68),point(37.801,-122.41,35)] },
  { id: 'balanced', name: 'Gentler streets', distance: 1920, segmentDistances: [500, 600, 450, 370], color: '#347d62', points: [point(37.7955,-122.3937,5),point(37.799,-122.398,8),point(37.802,-122.402,20),point(37.803,-122.407,28),point(37.801,-122.41,35)] },
  { id: 'flat', name: 'Waterfront detour', distance: 2480, segmentDistances: [850, 500, 650, 480], color: '#6384ae', points: [point(37.7955,-122.3937,5),point(37.803,-122.398,7),point(37.806,-122.403,9),point(37.805,-122.41,17),point(37.801,-122.41,35)] },
];
/** Polynomial supplied in the research reference, attributed to Minetti et al. (2002).
 * Decimal signed grade in; J/kg/m out. Intended range: -0.45 to +0.45.
 */
export function walkingCost(grade: number) {
  return 280.5 * grade ** 5 - 58.7 * grade ** 4 - 76.8 * grade ** 3
    + 51.9 * grade ** 2 + 19.6 * grade + 2.5;
}
export function metrics(route: Route) {
  if (route.points.length < 2 || route.segmentDistances.length !== route.points.length - 1
    || route.segmentDistances.some(d => !Number.isFinite(d) || d <= 0)
    || route.points.some(p => !Number.isFinite(p.elevation))) {
    throw new Error('A route requires finite elevation samples and one positive distance per segment.');
  }
  const distance = route.segmentDistances.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(route.distance) || Math.abs(distance - route.distance) > 1e-6) {
    throw new Error('Route distance must equal the sum of segment distances.');
  }
  let gain = 0, loss = 0, maxGrade = 0, totalEnergy = 0, outsideRange = false;
  route.points.slice(1).forEach((p, i) => {
    const delta = p.elevation - route.points[i].elevation;
    const grade = delta / route.segmentDistances[i];
    gain += Math.max(0, delta); loss += Math.max(0, -delta);
    maxGrade = Math.max(maxGrade, Math.abs(grade) * 100);
    outsideRange ||= Math.abs(grade) > .45;
    totalEnergy += walkingCost(grade) * route.segmentDistances[i];
  });
  return { gain, loss, maxGrade, averageGrade: 100 * (gain + loss) / distance,
    totalEnergy, normalizedCost: totalEnergy / distance, outsideRange };
}
/** Average ranks handle ties; correlation is undefined for a constant series. */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 2 || [...x, ...y].some(v => !Number.isFinite(v))) return null;
  const ranks = (values: number[]) => {
    const ordered = values.map((value, index) => ({ value, index })).sort((a,b) => a.value - b.value);
    const result = new Array<number>(values.length);
    for (let i = 0; i < ordered.length;) {
      let end = i + 1;
      while (end < ordered.length && ordered[end].value === ordered[i].value) end++;
      const rank = (i + 1 + end) / 2;
      for (let j = i; j < end; j++) result[ordered[j].index] = rank;
      i = end;
    }
    return result;
  };
  const rx = ranks(x), ry = ranks(y), mean = (x.length + 1) / 2;
  let covariance = 0, vx = 0, vy = 0;
  rx.forEach((value, i) => {
    const a = value - mean, b = ry[i] - mean;
    covariance += a * b; vx += a * a; vy += b * b;
  });
  return vx === 0 || vy === 0 ? null : covariance / Math.sqrt(vx * vy);
}
export function samplePositions(route: Route) {
  let cumulative = 0;
  return [0, ...route.segmentDistances.map(d => (cumulative += d) / route.distance)];
}
/** Provisional equivalent-distance score. Coefficients are meters per elevation meter. */
export function score(route: Route, uphill: number, downhill: number) {
  const { gain, loss } = metrics(route);
  return route.distance + uphill * gain + downhill * loss;
}
export function candidates(reverse: boolean) {
  return routes.map(route => reverse ? { ...route, points: [...route.points].reverse(), segmentDistances: [...route.segmentDistances].reverse() } : route);
}
