'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import StreetMap from './street-map';
import type { Coordinate, Route } from '@/lib/routing';
type MapInstance = {
  addListener: (name: string, handler: (event: { latLng: { lat: () => number; lng: () => number } | null }) => void) => { remove: () => void };
  getBounds: () => { contains: (point: Coordinate) => boolean } | undefined;
  fitBounds: (bounds: object, padding: number) => void; setZoom: (zoom: number) => void;
};
type Maps = {
  Map: new (element: HTMLElement, options: object) => MapInstance;
  Marker: new (options: object) => { setMap: (map: object | null) => void };
  Polyline: new (options: object) => { setMap: (map: object | null) => void };
  LatLngBounds: new () => { extend: (point: Coordinate) => void };
};
declare global { interface Window { google?: { maps: Maps }; gm_authFailure?: () => void } }
type Props = { routes: Route[]; selected: string; start: Coordinate | null; end: Coordinate | null; onPick: (point: Coordinate) => void; custom: boolean };
function GoogleMap({ routes, selected, start, end, onPick }: Props) {
  const container = useRef<HTMLDivElement>(null), instance = useRef<MapInstance | null>(null), pickHandler = useRef(onPick), viewportKey = useRef('');
  useEffect(() => { pickHandler.current = onPick; }, [onPick]);
  useEffect(() => {
    if (!container.current || !window.google?.maps) return;
    const map = new window.google.maps.Map(container.current, { center: { lat: 37.8008, lng: -122.402 }, zoom: 15, mapTypeControl: false, streetViewControl: false });
    instance.current = map;
    const listener = map.addListener('click', event => { if (event.latLng) pickHandler.current({ lat: event.latLng.lat(), lng: event.latLng.lng() }); });
    return () => { listener.remove(); instance.current = null; viewportKey.current = ''; };
  }, []);
  useEffect(() => {
    const map = instance.current, maps = window.google?.maps;
    if (!map || !maps) return;
    const markers = [start, end].flatMap((p, i) => p ? [new maps.Marker({ map, position: p, label: i ? 'B' : 'A' })] : []);
    const lines = [...routes].sort((a, b) => Number(a.id === selected) - Number(b.id === selected)).map(route => new maps.Polyline({ map, path: route.geometry ?? route.points, strokeColor: route.color, strokeOpacity: route.id === selected ? 1 : .35, strokeWeight: route.id === selected ? 7 : 4 }));
    const points = [...[start, end].filter((p): p is Coordinate => p !== null), ...routes.flatMap(r => r.geometry ?? r.points)];
    const signature = points.map(p => `${p.lat},${p.lng}`).join(';');
    if (signature !== viewportKey.current && points.length) {
      viewportKey.current = signature;
      if (points.some(p => !map.getBounds()?.contains(p))) {
        const bounds = new maps.LatLngBounds(); points.forEach(p => bounds.extend(p)); map.fitBounds(bounds, 45);
        if (points.length === 1) map.setZoom(15);
      }
    }
    return () => { lines.forEach(line => line.setMap(null)); markers.forEach(marker => marker.setMap(null)); };
  }, [routes, selected, start, end]);
  return <div className="google-map" ref={container} aria-label="Google Maps with walking route overlays" />;
}
export default function RouteMap(props: Props) {
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [schematic, setSchematic] = useState(false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  useEffect(() => {
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => setFailed(true);
    return () => { window.gm_authFailure = previous; };
  }, []);
  const sampleMode = schematic && !props.custom && props.routes.length > 0;
  const googleAvailable = Boolean(key && ready && !failed);
  const project = (lat: number, lng: number) => `${80 + (lng + 122.412) / .020 * 700},${460 - (lat - 37.794) / .014 * 420}`;
  return <div className="map-wrap">
    <div className="map-mode" role="group" aria-label="Map display"><button aria-pressed={!sampleMode} onClick={() => setSchematic(false)}>Street map</button><button disabled={props.custom || !props.routes.length} aria-pressed={sampleMode} onClick={() => setSchematic(true)}>Sample routes</button></div>
    {key && !failed && <Script id="google-maps" src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`} strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setFailed(true)} />}
    {sampleMode ? <svg className="demo-map" viewBox="0 0 900 540" role="img" aria-label="Schematic comparison of synthetic walking routes">
      <defs><pattern id="blocks" width="65" height="55" patternUnits="userSpaceOnUse"><rect width="65" height="55" fill="#eeeae0"/><rect x="7" y="7" width="51" height="41" rx="5" fill="#e3e2d8"/></pattern></defs>
      <rect width="900" height="540" fill="url(#blocks)"/><path d="M740 0H900V540H865L825 380 775 270 740 160Z" fill="#c6dedc"/>
      {[...props.routes].sort((a, b) => Number(a.id === props.selected) - Number(b.id === props.selected)).map(route => <polyline key={route.id} points={route.points.map(p => project(p.lat, p.lng)).join(' ')} fill="none" stroke={route.color} strokeWidth={route.id === props.selected ? 7 : 4} opacity={route.id === props.selected ? 1 : .4} strokeLinecap="round" strokeLinejoin="round"/>)}
      {[props.start, props.end].map((p, i) => { if (!p) return null; const [x, y] = project(p.lat, p.lng).split(','); return <g key={i}><circle cx={x} cy={y} r="15" fill="#243d32"/><text x={x} y={Number(y) + 5} textAnchor="middle" fontSize="13" fill="#fff">{i ? 'B' : 'A'}</text></g>; })}
    </svg> : googleAvailable ? <GoogleMap {...props}/> : <StreetMap {...props}/>}
    <div className="map-caption">{sampleMode ? 'Schematic · synthetic route comparison' : `${googleAvailable ? 'Google Maps' : 'OpenStreetMap'} · ${props.routes.length ? props.custom ? 'DEM estimates' : 'synthetic route overlays' : 'select endpoints'}`}</div>
  </div>;
}
