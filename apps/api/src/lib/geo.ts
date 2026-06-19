// Geo helpers. Coordinates live server-side only; clients get rounded distance.

const EARTH_MILES = 3958.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** "~0.4 mi" — rounded so it never reveals an exact location. */
export function approxDistance(miles: number): string {
  const rounded = miles < 1 ? Math.round(miles * 10) / 10 : Math.round(miles * 10) / 10;
  return `~${rounded.toFixed(1)} mi`;
}

/** Server-side static-map URL for coords. Uses a configured provider template
 *  (STATIC_MAP_URL with {lat}{lon}{w}{h}{zoom}) if set, else a single OSM tile
 *  covering the location — no API key, just attribution + a descriptive UA. */
export function staticMapUrl(
  env: { STATIC_MAP_URL?: string },
  lat: number,
  lon: number,
  w: number,
  h: number,
  zoom: number,
): string {
  if (env.STATIC_MAP_URL) {
    return env.STATIC_MAP_URL
      .replaceAll("{lat}", String(lat))
      .replaceAll("{lon}", String(lon))
      .replaceAll("{w}", String(w))
      .replaceAll("{h}", String(h))
      .replaceAll("{zoom}", String(zoom));
  }
  return osmTileUrl(lat, lon, zoom);
}

/** OSM slippy-map tile URL containing the given point. */
export function osmTileUrl(lat: number, lon: number, zoom: number): string {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

/** Cheap bounding box for a radius in miles, to pre-filter before haversine. */
export function boundingBox(lat: number, lng: number, miles: number) {
  const latDelta = miles / 69; // ~69 miles per degree latitude
  const lngDelta = miles / (69 * Math.max(0.01, Math.cos(toRad(lat))));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
