import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface RealLocationPickerProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onChange: (latitude: number, longitude: number) => void;
}

/** Real OpenStreetMap tiles with a local-only circle selector. */
export default function RealLocationPicker({
  latitude,
  longitude,
  radiusMeters,
  onChange,
}: RealLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pointRef = useRef<L.CircleMarker | null>(null);
  const radiusRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  const previousPositionRef = useRef({ latitude, longitude });

  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
      .setView([latitude, longitude], 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const point = L.circleMarker([latitude, longitude], {
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#35b6a6',
      fillOpacity: 1,
    }).addTo(map);
    const radiusCircle = L.circle([latitude, longitude], {
      radius: radiusMeters,
      color: '#218779',
      weight: 2,
      fillColor: '#55c9bb',
      fillOpacity: 0.18,
    }).addTo(map);

    map.on('click', event => onChangeRef.current(event.latlng.lat, event.latlng.lng));
    mapRef.current = map;
    pointRef.current = point;
    radiusRef.current = radiusCircle;
    const frame = requestAnimationFrame(() => map.invalidateSize());

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapRef.current = null;
      pointRef.current = null;
      radiusRef.current = null;
    };
  }, []); // The following effect keeps selection props in sync.

  useEffect(() => {
    const latLng: L.LatLngExpression = [latitude, longitude];
    pointRef.current?.setLatLng(latLng);
    radiusRef.current?.setLatLng(latLng).setRadius(radiusMeters);
    const previous = previousPositionRef.current;
    const moved = previous.latitude !== latitude || previous.longitude !== longitude;
    if (moved && mapRef.current) {
      mapRef.current.setView(latLng, Math.max(mapRef.current.getZoom(), 14), { animate: false });
    }
    previousPositionRef.current = { latitude, longitude };
  }, [latitude, longitude, radiusMeters]);

  return <div ref={containerRef} style={{ width: '100%', height: 250 }} />;
}
