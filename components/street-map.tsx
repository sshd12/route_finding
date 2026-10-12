'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { Route } from '@/lib/routing';
export type Coordinate = { lat: number; lng: number };
export default function StreetMap({ start, end, onPick, routes, selected }: {
  start: Coordinate | null; end: Coordinate | null; onPick: (point: Coordinate) => void;
  routes: Route[]; selected: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layers = useRef<LayerGroup | null>(null);
  const handler = useRef(onPick);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { handler.current = onPick; }, [onPick]);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    import('leaflet').then(L => {
      if (cancelled || !element.current) return;
      const instance = L.map(element.current).setView([37.8008, -122.402], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(instance);
      instance.on('click', e => handler.current({lat: e.latlng.lat, lng: e.latlng.lng}));
      observer = new ResizeObserver(() => instance.invalidateSize());
      observer.observe(element.current);
      map.current = instance;
      layers.current = L.layerGroup().addTo(instance);
      setReady(true);
    }).catch(() => setError(true));
    return () => { cancelled = true; observer?.disconnect(); map.current?.remove(); map.current = null; layers.current = null; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    import('leaflet').then(L => {
      if (cancelled || !layers.current) return;
      layers.current.clearLayers();
      [...routes].sort((a,b) => Number(a.id === selected)-Number(b.id === selected)).forEach(route => {
        L.polyline(route.points.map(p => [p.lat,p.lng]), { color: route.color, weight: route.id === selected ? 6 : 3, opacity: route.id === selected ? 1 : .4, interactive: false }).addTo(layers.current!);
      });
      const endpoints = [start,end].filter((p): p is Coordinate => p !== null);
      if (map.current && endpoints.some(p => !map.current!.getBounds().contains([p.lat,p.lng]))) {
        map.current.fitBounds(L.latLngBounds(endpoints.map(p => [p.lat,p.lng])), {padding:[45,45], maxZoom:15});
      }
      [start,end].forEach((point,i) => {
        if (!point) return;
        L.marker([point.lat,point.lng], { icon: L.divIcon({className:'endpoint-icon', html:`<span>${i ? 'B' : 'A'}</span>`, iconSize:[30,30],iconAnchor:[15,15]}), keyboard:true })
          .bindTooltip(i ? 'Destination' : 'Starting point').addTo(layers.current!);
      });
    });
    return () => { cancelled = true; };
  }, [ready, start, end, routes, selected]);
  return <><div ref={element} className="street-map" aria-label="Street map: click to select the active endpoint"/>{error && <p className="map-error" role="alert">Map unavailable. Use the coordinate fields to choose your endpoints.</p>}</>;
}
