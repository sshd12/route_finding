import { metrics, type Route } from './routing';
import type { StudyDataset } from './study';
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function routesCsv(routes: Route[], pair?: number, spacing?: number) {
  return routes.map(route => {
    const m = metrics(route);
    return [pair, spacing ?? route.provenance?.spacing, route.id, route.name, route.role, route.distance, m.gain, m.loss, m.averageGrade, m.maxGrade, m.totalEnergy, m.normalizedCost, m.outsideRange, route.provenance?.kind ?? 'synthetic', route.provenance?.specialSections.join(';'), route.provenance?.elevation ?? 'invented', route.provenance?.retrievedAt].map(csvCell).join(',');
  });
}
const header = 'pair,spacing_m,id,name,role,distance_m,ascent_m,descent_m,mean_absolute_grade_pct,max_absolute_grade_pct,total_modeled_energy_J_per_kg,normalized_modeled_cost_J_per_kg_m,outside_model_range,data_kind,special_sections,elevation_source,retrieved_at';
export function comparisonCsv(routes: Route[]) { return [header, ...routesCsv(routes)].join('\r\n'); }
export function studyCsv(dataset: StudyDataset) { return [header, ...dataset.records.flatMap(record => routesCsv(record.result?.routes ?? [], record.pair, record.spacing))].join('\r\n'); }
export function routesGeoJson(routes: Route[]) {
  return { type: 'FeatureCollection', attribution: '© OpenStreetMap contributors; network data subject to ODbL', features: routes.map(route => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: route.points.map(p => [p.lng, p.lat, p.elevation]) }, properties: { id: route.id, name: route.name, role: route.role, ...metrics(route), distance: route.distance, segmentDistances: route.segmentDistances, provenance: route.provenance ?? { kind: 'synthetic' } } })) };
}
export function download(filename: string, content: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime })), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
