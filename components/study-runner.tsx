'use client';
import { useEffect, useRef, useState } from 'react';
import { analyzeStudy, parseBoundary, runStudy, type Boundary, type StudyDataset } from '@/lib/study';
import { download, studyCsv } from '@/lib/exports';
import type { RouteResult } from '@/lib/contracts';
export default function StudyRunner() {
  const [boundary, setBoundary] = useState<Boundary | null>(null), [seed, setSeed] = useState(42), [count, setCount] = useState(3), [graph, setGraph] = useState(false);
  const [dataset, setDataset] = useState<StudyDataset | null>(null), [error, setError] = useState(''), [progress, setProgress] = useState(''), [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const analysis = dataset ? analyzeStudy(dataset) : [];
  const run = async () => {
    if (!boundary || running) return;
    const abort = new AbortController(); controller.current = abort; setRunning(true); setError(''); setDataset(null);
    try {
      const status = await (await fetch('/api/routes', { signal: abort.signal })).json();
      if (!status.batchConfigured) throw new Error('Configure services for batch use and record DEM/OSM metadata before running a study. See README setup.');
      const result = await runStudy(boundary, { seed, count, spacings: [10, 20, 40], minDistance: 100, maxDistance: 5000, graph, uphill: 12, downhill: 3 }, async request => {
        const response = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: abort.signal });
        const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Route request failed.'); return value as RouteResult;
      }, (completed, total) => setProgress(`${completed} / ${total} requests complete`), abort.signal);
      setDataset(result);
    } catch (e) { setError(abort.signal.aborted ? 'Study canceled.' : e instanceof Error ? e.message : 'Study failed.'); }
    finally { setRunning(false); controller.current = null; }
  };
  return <section className="method study"><div className="eyebrow">REPRODUCIBLE MODEL COMPARISON</div><h2>Run a San Francisco study</h2>
    <p>Use a geographic boundary from your chosen source. Endpoints are sampled within its intersection with the San Francisco study bounding box. Requests run sequentially at 10, 20 and 40 m maximum spacing. Use your own routing and data services for batch studies.</p>
    <label htmlFor="boundary">Study boundary · WGS84 GeoJSON</label><input id="boundary" type="file" accept=".json,.geojson,application/json" disabled={running} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { setBoundary(parseBoundary(JSON.parse(await file.text()))); setError(''); } catch (err) { setBoundary(null); setError(err instanceof Error ? err.message : 'Invalid boundary.'); } }}/>
    <div className="study-fields"><label>Random seed<input type="number" value={seed} disabled={running} onChange={e => setSeed(Number(e.target.value))}/></label><label>Endpoint pairs (1–50)<input type="number" min="1" max="50" value={count} disabled={running} onChange={e => setCount(Number(e.target.value))}/></label></div>
    <label className="check-label"><input type="checkbox" checked={graph} disabled={running} onChange={e => setGraph(e.target.checked)}/> Include experimental graph search</label>
    <div className="actions"><button className="primary" disabled={!boundary || running} onClick={run}>Run study</button>{running && <button onClick={() => controller.current?.abort()}>Cancel</button>}</div>
    <p role="status">{progress}</p>{error && <p className="error" role="alert">{error}</p>}
    {dataset && <><div className="actions"><button onClick={() => download('study-dataset.json', JSON.stringify(dataset, null, 2))}>Export dataset</button><button onClick={() => download('study-analysis.json', JSON.stringify(analysis, null, 2))}>Export analysis</button><button onClick={() => download('study-routes.csv', studyCsv(dataset), 'text/csv')}>Export CSV</button></div>
      <div className="table-scroll"><table><thead><tr><th>Spacing</th><th>Pairs completed / failed</th><th>Eligible routes</th><th>Ascent ρ</th><th>Mean grade ρ</th><th>Max grade ρ</th></tr></thead><tbody>{analysis.map(row => <tr key={row.spacing}><td>{row.spacing} m</td><td>{row.successfulPairs} / {row.failedPairs}</td><td>{row.eligibleRoutes}</td>{row.correlations.map(c => <td key={c.metric}>{c.rho === null ? 'Undefined' : c.rho.toFixed(3)}{c.interval95 && <small>95% interval [{c.interval95.map(v => v.toFixed(3)).join(', ')}]</small>}</td>)}</tr>)}</tbody></table></div><p>Intervals use endpoint-pair bootstrap resampling. Small studies can yield unstable or degenerate intervals. These are model comparisons, not independent empirical validation.</p></>}
  </section>;
}
