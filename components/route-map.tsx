'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import StreetMap, { type Coordinate } from './street-map';
import type { Route } from '@/lib/routing';
type Maps = {
  Map: new (element: HTMLElement, options: object) => { addListener: (name: string, handler: (event: { latLng: { lat: () => number; lng: () => number } | null }) => void) => { remove: () => void } };
  Marker: new (options: object) => { setMap: (map: object | null) => void };
  Polyline: new (options: object) => { setMap: (map: object | null) => void };
};
declare global { interface Window { google?: { maps: Maps }; comfortMapReady?: () => void; gm_authFailure?: () => void } }
export default function RouteMap({ routes, selected, start, end, onPick, custom }: { routes: Route[]; selected: string; start: Coordinate | null; end: Coordinate | null; onPick: (point: Coordinate) => void; custom: boolean }) {
  const pickHandler = useRef(onPick);
  useEffect(() => { pickHandler.current = onPick; }, [onPick]);
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [schematic, setSchematic] = useState(false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  useEffect(() => {
    window.comfortMapReady = () => setReady(true);
    window.gm_authFailure = () => setFailed(true);
    if (window.google?.maps) setReady(true);
    return () => { delete window.comfortMapReady; delete window.gm_authFailure; };
  }, []);
  useEffect(() => {
    if (schematic || !ready || !container.current || !window.google?.maps) return;
    const maps = window.google.maps;
    const map = new maps.Map(container.current, { center: { lat: 37.8008, lng: -122.402 }, zoom: 15, mapTypeControl: false, streetViewControl: false });
    const listener = map.addListener('click', event => { if (event.latLng) pickHandler.current({ lat: event.latLng.lat(), lng: event.latLng.lng() }); });
    const markers = [start,end].filter(p => p !== null).map((p,i) => new maps.Marker({ map, position: p, label: i ? 'B' : 'A' }));
    const lines = [...(custom ? [] : routes)].sort((a, b) => Number(a.id === selected) - Number(b.id === selected)).map(route => new maps.Polyline({ map, path: route.points, strokeColor: route.color, strokeOpacity: route.id === selected ? 1 : .35, strokeWeight: route.id === selected ? 7 : 4 }));
    return () => { listener.remove(); lines.forEach(line => line.setMap(null)); markers.forEach(marker => marker.setMap(null)); };
  }, [ready, routes, selected, schematic, start, end, custom]);
  const project = (lat: number, lng: number) => `${80 + (lng + 122.412) / .020 * 700},${460 - (lat - 37.794) / .014 * 420}`;
  useEffect(() => { if (custom) setSchematic(false); }, [custom]);
  const googleAvailable = Boolean(key && ready && !failed);
  return <div className="map-wrap">
    <div className="map-mode" role="group" aria-label="Map display"><button aria-pressed={!schematic} onClick={() => setSchematic(false)}>Street map</button><button disabled={custom} aria-pressed={schematic} onClick={() => setSchematic(true)}>Sample routes</button></div>
    {key && !failed && <Script src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=comfortMapReady`} strategy="afterInteractive" onError={() => setFailed(true)} />}
    {!schematic && googleAvailable ? <div className="google-map" ref={container} aria-label="Google Maps with synthetic route overlays" /> : !schematic ? <StreetMap start={start} end={end} onPick={onPick} routes={custom ? [] : routes} selected={selected}/> : <svg className="demo-map" viewBox="0 0 900 540" role="img" aria-label="Schematic comparison of three synthetic walking routes">
      <defs><pattern id="blocks" width="65" height="55" patternUnits="userSpaceOnUse" patternTransform="rotate(-16)"><rect width="65" height="55" fill="#eeeae0"/><rect x="7" y="7" width="51" height="41" rx="5" fill="#e3e2d8"/></pattern></defs>
      <rect width="900" height="540" fill="url(#blocks)"/><path d="M740 0H900V540H865L825 380 775 270 740 160Z" fill="#c6dedc"/>
      <path d="M65 70Q250 10 340 125T550 210M30 330Q200 250 390 360T700 460" fill="none" stroke="#d3d7c3" strokeWidth="55" opacity=".7"/>
      <text x="780" y="150" fill="#608582" fontSize="18" transform="rotate(72 780 150)">SAN FRANCISCO BAY</text>
      <text x="235" y="260" fill="#98978c" fontSize="13" letterSpacing="3">NORTH BEACH</text><text x="420" y="415" fill="#98978c" fontSize="13" letterSpacing="3">FINANCIAL DISTRICT</text>
      {[...routes].sort((a, b) => Number(a.id === selected) - Number(b.id === selected)).map(route => <polyline key={route.id} points={route.points.map(p => project(p.lat,p.lng)).join(' ')} fill="none" stroke={route.color} strokeWidth={route.id === selected ? 7 : 4} opacity={route.id === selected ? 1 : .4} strokeLinecap="round" strokeLinejoin="round"/>)}
      {routes[0].points.filter((_,i) => i === 0 || i === routes[0].points.length-1).map((p,i) => {const [x,y] = project(p.lat,p.lng).split(',');return <g key={i}><circle cx={x} cy={y} r="15" fill={i ? '#243d32' : '#fff'} stroke="#243d32" strokeWidth="3"/><text x={x} y={Number(y)+5} textAnchor="middle" fontSize="13" fontWeight="bold" fill={i ? '#fff' : '#243d32'}>{i ? 'B' : 'A'}</text></g>})}
    </svg>}
    <div className="map-caption">{schematic ? 'Schematic · synthetic route comparison' : googleAvailable ? custom ? 'Google Maps · custom endpoints · routing pending' : 'Google Maps · synthetic route overlays' : custom ? 'OpenStreetMap · custom endpoints · routing pending' : 'OpenStreetMap · synthetic route overlays'}</div>
    {schematic && <div className="map-legend"><span><i style={{background:'#347d62'}}/>Gentler</span><span><i style={{background:'#a87b55'}}/>Direct</span><span><i style={{background:'#6384ae'}}/>Waterfront</span></div>}
  </div>;
}
