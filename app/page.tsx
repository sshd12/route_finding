'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import RouteMap from '@/components/route-map';
import ResearchMethod from '@/components/research-method';
import StudyRunner from '@/components/study-runner';
import { candidates, locations, metrics, rankValue, spearman, samplePositions, type Coordinate, type Ranking, type Route } from '@/lib/routing';
import { geometryKey } from '@/lib/geo';
import { comparisonCsv, download, routesGeoJson } from '@/lib/exports';
import type { RouteResult } from '@/lib/contracts';
const sampleEndpoints = [candidates(false)[0].points[0], candidates(false)[0].points.at(-1)!];
const presets: Record<string, Coordinate> = Object.fromEntries(locations.map((name, i) => [name, { lat: sampleEndpoints[i].lat, lng: sampleEndpoints[i].lng }]));
function Profile({ route, start, end }: { route: Route; start: string; end: string }) {
  const elevations = route.points.map(p => p.elevation), minimum = Math.min(...elevations), maximum = Math.max(...elevations);
  const lower = Math.floor(minimum / 5) * 5, upper = Math.max(lower + 5, Math.ceil(maximum / 5) * 5);
  const xs = samplePositions(route), y = (height: number) => 115 - (height - lower) / (upper - lower) * 95;
  const line = route.points.map((p, i) => `${45 + xs[i] * 535},${y(p.elevation)}`).join(' ');
  return <div className="profile"><div className="section-title"><h3>Elevation profile <span> / {route.name}</span></h3><span>{route.provenance ? 'DEM ESTIMATE' : 'SYNTHETIC'} / METERS</span></div>
    <svg viewBox="0 0 600 145" role="img" aria-label={`${route.name} elevation profile, ${lower} to ${upper} meters`}>
      {[lower, (lower + upper) / 2, upper].map(height => <g key={height}><path d={`M45 ${y(height)}H580`} stroke="#e5e8e1"/><text x="2" y={y(height) + 4} fontSize="10" fill="#738169">{height.toFixed(0)}</text></g>)}
      <polygon points={`45,115 ${line} 580,115`} fill={`${route.color}20`}/><polyline points={line} stroke={route.color} strokeWidth="3" fill="none"/>
      <text x="45" y="140" fontSize="10" fill="#738169">0 m</text><text x="580" y="140" textAnchor="end" fontSize="10" fill="#738169">{route.distance.toFixed(0)} m</text>
    </svg><div className="range-labels"><span>{start}</span><span>{end}</span></div></div>;
}
export default function Home() {
  const [start, setStart] = useState<string>(locations[0]), [end, setEnd] = useState<string>(locations[1]);
  const [custom, setCustom] = useState(false), [customStart, setCustomStart] = useState<Coordinate | null>(null), [customEnd, setCustomEnd] = useState<Coordinate | null>(null);
  const [pickTarget, setPickTarget] = useState<'start' | 'end'>('start'), [coordinateInput, setCoordinateInput] = useState(''), [coordinateError, setCoordinateError] = useState('');
  const [uphill, setUphill] = useState(12), [downhill, setDownhill] = useState(3), [spacing, setSpacing] = useState(20), [graph, setGraph] = useState(false), [algorithm, setAlgorithm] = useState('astar');
  const [selected, setSelected] = useState<string | null>(null), [ranking, setRanking] = useState<Ranking>('experimental'), [view, setView] = useState('explore');
  const [result, setResult] = useState<RouteResult | null>(null), [busy, setBusy] = useState(false), [requestError, setRequestError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const invalidate = () => { controller.current?.abort(); controller.current = null; setBusy(false); setResult(null); setSelected(null); setRequestError(''); };
  const pick = (point: Coordinate) => {
    invalidate(); setCustom(true);
    if (pickTarget === 'start') { setCustomStart(point); setPickTarget('end'); } else setCustomEnd(point);
    setCoordinateInput(''); setCoordinateError('');
  };
  const enterCoordinate = () => {
    const parts = coordinateInput.split(',').map(s => s.trim()), [lat, lng] = parts.map(Number);
    if (parts.length !== 2 || parts.some(p => !p) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { setCoordinateError('Enter latitude, longitude (for example: 37.7955, -122.3937).'); return; }
    pick({ lat, lng });
  };
  const find = async () => {
    if (!customStart || !customEnd) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setResult(null); setRequestError(''); setSelected(null);
    try {
      const response = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: customStart, end: customEnd, uphill, downhill, spacing, graph, algorithm }), signal: abort.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Walking-route request failed.');
      if (controller.current === abort) setResult(data);
    } catch (error) { if (!abort.signal.aborted && controller.current === abort) setRequestError(error instanceof Error ? error.message : 'Walking-route request failed.'); }
    finally { if (controller.current === abort) { setBusy(false); controller.current = null; } }
  };
  const sampleRoutes = useMemo(() => start === end ? [] : candidates(start === locations[1]), [start, end]);
  const routes = custom ? result?.routes ?? [] : sampleRoutes;
  const ranked = [...routes].sort((a, b) => rankValue(a, ranking, uphill, downhill) - rankValue(b, ranking, uphill, downhill));
  const eligible = ranked.filter(route => Number.isFinite(rankValue(route, ranking, uphill, downhill)));
  const recommended = eligible[0], active = routes.find(r => r.id === selected) ?? recommended ?? ranked[0];
  const baseline = routes.find(r => r.id === result?.baselineId) ?? [...routes].sort((a, b) => a.distance - b.distance)[0];
  const seen = new Set<string>();
  const measurements = routes.filter(route => {
    const key = geometryKey(route.geometry ?? route.points);
    if (seen.has(key)) return false; seen.add(key);
    return !metrics(route).outsideRange && !route.provenance?.specialSections.length;
  }).map(metrics);
  const correlations = [['Total ascent', 'gain'], ['Mean absolute grade', 'averageGrade'], ['Maximum absolute grade', 'maxGrade']].map(([label, key]) => ({ label, value: spearman(measurements.map(m => m[key as 'gain' | 'averageGrade' | 'maxGrade']), measurements.map(m => m.normalizedCost)) }));
  const label = (point: Coordinate | null) => point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Click the map to place a pin';
  return <main>
    <header><Link className="brand" href="/"><span className="brand-icon">↗</span> comfortwalk<span className="lab">RESEARCH LAB</span></Link><nav aria-label="Main">{[['explore', 'Route explorer'], ['method', 'The method'], ['study', 'Study runner']].map(([id, title]) => <button key={id} className={view === id ? 'nav-active' : ''} onClick={() => setView(id)}>{title}</button>)}</nav><span className="version">Experimental / v0.2</span></header>
    <section className="intro"><div><div className="eyebrow">A DIFFERENT WAY TO GET THERE</div><h1>Compare distance.<br/><span>Understand the hills.</span></h1><p>Explore walking routes and modeled terrain costs.<br/>The final research cost is still under development.</p></div><div className="intro-note"><span className="status-dot"/> Research prototype<p>San Francisco, California<br/>{custom ? 'Walking network / DEM estimates' : 'Synthetic demonstration data'}</p></div></section>
    {view === 'method' ? <ResearchMethod/> : view === 'study' ? <StudyRunner/> : <>
      <section className="workspace"><aside className="planner"><div className="section-title"><h2>Plan a walk</h2><span>01 / EXPLORE</span></div>
        <div className="endpoint-mode"><button onClick={() => { invalidate(); setCustom(false); setCustomStart(null); setCustomEnd(null); }} aria-pressed={!custom}>Sample walk</button><button onClick={() => { invalidate(); setCustom(true); setCustomStart(presets[start]); setCustomEnd(presets[end]); setPickTarget('start'); }} aria-pressed={custom}>Real walk</button></div>
        {custom ? <>
          <button className={`endpoint-select ${pickTarget === 'start' ? 'active' : ''}`} onClick={() => setPickTarget('start')}><strong>A · Starting point</strong><span>{label(customStart)}</span></button>
          <button className="swap" aria-label="Swap custom endpoints" onClick={() => { invalidate(); setCustomStart(customEnd); setCustomEnd(customStart); }}>⇅</button>
          <button className={`endpoint-select ${pickTarget === 'end' ? 'active' : ''}`} onClick={() => setPickTarget('end')}><strong>B · Destination</strong><span>{label(customEnd)}</span></button>
          <p className="field-note">Click the map to set your {pickTarget === 'start' ? 'starting point' : 'destination'}.</p><label htmlFor="coordinates">Or enter latitude, longitude</label><input id="coordinates" className="coordinate-input" value={coordinateInput} placeholder="37.7955, -122.3937" onChange={e => setCoordinateInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enterCoordinate(); }}/><button className="coordinate-button" onClick={enterCoordinate}>Set {pickTarget === 'start' ? 'starting point' : 'destination'}</button>{coordinateError && <p className="error" role="alert">{coordinateError}</p>}
          <button className="reset-endpoints" onClick={() => { invalidate(); setCustomStart(null); setCustomEnd(null); setPickTarget('start'); }}>Clear pins</button>
          <label htmlFor="spacing">Maximum elevation sample spacing</label><select id="spacing" value={spacing} onChange={e => { invalidate(); setSpacing(Number(e.target.value)); }}>{[10, 20, 40].map(value => <option key={value} value={value}>{value} meters</option>)}</select>
          <label className="check-label"><input type="checkbox" checked={graph} onChange={e => { invalidate(); setGraph(e.target.checked); }}/> Include experimental graph search</label>
          {graph && <><label htmlFor="algorithm">Search algorithm</label><select id="algorithm" value={algorithm} onChange={e => { invalidate(); setAlgorithm(e.target.value); }}><option value="astar">A*</option><option value="dijkstra">Dijkstra</option></select></>}
        </> : <>
          <label htmlFor="start">Starting point</label><select id="start" value={start} onChange={e => { invalidate(); setStart(e.target.value); }}>{locations.map(l => <option key={l}>{l}</option>)}</select><button className="swap" onClick={() => { invalidate(); setStart(end); setEnd(start); }} aria-label="Swap starting point and destination">⇅</button><label htmlFor="end">Destination</label><select id="end" value={end} onChange={e => { invalidate(); setEnd(e.target.value); }}>{locations.map(l => <option key={l}>{l}</option>)}</select>{start === end && <p className="error" role="alert">Choose two different locations to compare routes.</p>}
        </>}
        <div className="divider"/><label htmlFor="ranking">Compare by</label><select id="ranking" value={ranking} onChange={e => { setRanking(e.target.value as Ranking); setSelected(null); }}><option value="experimental">Experimental distance + hill penalties</option><option value="distance">Distance baseline</option><option value="ascent">Total ascent</option><option value="average">Mean absolute grade</option><option value="maximum">Maximum absolute grade</option><option value="energy">Modeled energy per meter · study reference</option><option value="totalEnergy">Total modeled trip energy</option></select>
        {(ranking === 'experimental' || graph) && <><label className="slider-label" htmlFor="uphill">Uphill penalty <strong>{uphill} m/m</strong></label><input id="uphill" type="range" min="0" max="30" value={uphill} onChange={e => { if (custom) invalidate(); setUphill(Number(e.target.value)); setSelected(null); }}/><label className="slider-label" htmlFor="downhill">Downhill penalty <strong>{downhill} m/m</strong></label><input id="downhill" type="range" min="0" max="15" value={downhill} onChange={e => { if (custom) invalidate(); setDownhill(Number(e.target.value)); setSelected(null); }}/></>}
        <p className="small">Energy per meter is the study reference. Trip energy includes route length. Weights and comfort recommendations remain provisional.</p>
        {custom && <><button className="primary find-routes" disabled={!customStart || !customEnd || busy} onClick={find}>{busy ? 'Finding walking routes…' : 'Find walking routes'}</button>{busy && <button className="reset-endpoints" onClick={invalidate}>Cancel request</button>}{requestError && <p className="error" role="alert">{requestError}</p>}</>}
        <div className="model-note">ⓘ {custom ? 'DEM estimates depend on data quality and sampling.' : 'Synthetic samples illustrate the equations.'} The final research cost is undecided.</div>
      </aside><div className="map-panel"><div className="map-heading"><span>WALKING ROUTE COMPARISON</span><span>{routes.length} candidates</span></div><RouteMap routes={routes} selected={active?.id ?? ''} custom={custom} start={custom ? customStart : presets[start]} end={custom ? customEnd : presets[end]} onPick={pick}/></div></section>
      {custom && !result && <section className="custom-notice" aria-live="polite"><h2>{busy ? 'Loading network and elevation data…' : 'Choose endpoints and find walking routes.'}</h2><p>Real walks use OpenStreetMap network data and a configured elevation service. Experimental graph search also needs an OSM extract or graph service.</p></section>}
      {active && baseline && <section className="results" aria-live="polite"><div className="results-heading"><div><div className="eyebrow">02 / COMPARE</div><h2>{custom ? 'Walking routes. Terrain tradeoffs.' : 'Synthetic paths. Different tradeoffs.'}</h2></div><p>Ranked among {routes.length} {custom ? 'computed' : 'synthetic'} candidates.</p></div>
        <div className="actions"><button onClick={() => download('walking-routes.json', JSON.stringify(result ?? { kind: 'synthetic', routes }, null, 2))}>Export JSON</button><button onClick={() => download('walking-routes.csv', comparisonCsv(routes), 'text/csv')}>Export CSV</button><button onClick={() => download('walking-routes.geojson', JSON.stringify(routesGeoJson(routes), null, 2))}>Export GeoJSON</button></div>
        {!recommended && <p className="error">No candidate has eligible modeled energy for this ranking criterion.</p>}
        <div className="route-cards">{ranked.map(route => { const m = metrics(route), unsupported = Boolean(route.provenance?.specialSections.length); return <button key={route.id} onClick={() => setSelected(route.id)} className={`route-card ${active.id === route.id ? 'selected' : ''}`} aria-pressed={active.id === route.id}>
          <div className="card-top"><span className="route-label"><i style={{ background: route.color }}/>{route.name}</span><span className={`badge ${route.id === recommended?.id ? 'green' : ''}`}>{route.role === 'research' ? 'Experimental search' : route.id === baseline.id ? 'Distance baseline' : route.id === recommended?.id ? 'Lowest value' : 'Alternative'}</span></div>
          <div className="card-distance">{(route.distance / 1000).toFixed(2)} <span>km</span></div><div className="card-metrics"><span>↗ {m.gain.toFixed(1)} m ascent</span><span>↘ {m.loss.toFixed(1)} m descent</span></div><div className="card-metrics hill-grades"><span>Mean {m.averageGrade.toFixed(2)}%</span><span>Max {m.maxGrade.toFixed(2)}%</span></div><div className="card-footer">Modeled energy / meter <strong>{m.normalizedCost.toFixed(3)} J/kg/m</strong></div><div className="energy-total">Total modeled energy: {m.totalEnergy.toFixed(0)} J/kg</div>
          {m.outsideRange && <p className="error">Outside ±45%: energy extrapolated and excluded from energy ranking.</p>}{unsupported && <p className="error">Unsupported ground-DEM surface: {route.provenance!.specialSections.join(', ')}. Energy excluded from ranking.</p>}
        </button>; })}</div>
        <div className="detail-grid"><Profile route={active} start={custom ? label(customStart) : start} end={custom ? label(customEnd) : end}/><div className="insight"><div className="eyebrow">COMPARED WITH {baseline.name.toUpperCase()}</div><h3>{Math.abs(active.distance - baseline.distance).toFixed(0)} m {active.distance >= baseline.distance ? 'farther' : 'shorter'}.</h3><p>{Math.abs(metrics(active).gain - metrics(baseline).gain).toFixed(1)} m {metrics(active).gain <= metrics(baseline).gain ? 'less' : 'more'} climbing. Total modeled energy changes by {(metrics(active).totalEnergy - metrics(baseline).totalEnergy).toFixed(0)} J/kg{metrics(active).outsideRange || metrics(baseline).outsideRange || active.provenance?.specialSections.length || baseline.provenance?.specialSections.length ? ' (outside supported model conditions)' : ''}.</p><button onClick={() => setView('method')}>Understand the model ↗</button></div></div>
        {result && <section className="provenance"><h3>Data and calculation settings</h3><p>{result.sources.elevation} · {result.sources.resolutionMeters === null ? 'unverified grid resolution' : `${result.sources.resolutionMeters} m grid`} · {result.sources.datum}<br/>OSM snapshot: {result.sources.networkVersion} · sampled at ≤{result.request.spacing} m · no smoothing<br/>Retrieved: {result.sources.retrievedAt}</p>{result.graph && <p>Modeled graph: {result.graph.nodes} nodes / {result.graph.edges} directed edges. Excluded: {result.graph.excludedSpecial} special-surface ways, {result.graph.excludedAccess} access exclusions, {result.graph.excludedGrade} out-of-range edges. Endpoint snapping gaps: {result.graph.snaps.map(s => s.gap.toFixed(1)).join(' / ')} m.</p>}{result.warnings.map((warning, i) => <p className="small" key={i}>{warning}</p>)}</section>}
        <section className="correlation"><div className="section-title"><h3>Ranking agreement with modeled energy per meter</h3><span>SPEARMAN ρ / ELIGIBLE N = {measurements.length}</span></div><div className="correlation-grid">{correlations.map(({ label, value }) => <div key={label}><span>{label}</span><strong>{value === null ? 'Undefined' : value.toFixed(3)}</strong></div>)}</div><p>{custom ? 'Model comparison for this endpoint pair. Use the study runner for multiple pairs and uncertainty analysis.' : 'Illustrative synthetic calculations, not study findings.'} Average ranks handle ties. Unsupported surfaces, out-of-range grades and exact duplicate geometry are excluded. All measures share elevation inputs.</p></section>
      </section>}
    </>}
    <footer><span>comfortwalk / Walking route research</span><span>Experimental models · Synthetic samples and DEM estimates · Not validated for navigation</span></footer>
  </main>;
}
