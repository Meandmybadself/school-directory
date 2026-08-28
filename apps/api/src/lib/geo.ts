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

/** Band width for a reported neighbour distance, in miles. Deliberately coarse:
 *  a member controls their own address, so they can move it, re-read
 *  /home/neighbors and repeat — three readings trilaterate a discoverable
 *  neighbour to roughly the band width. At 0.1 mi that was ~160 m, which is a
 *  house; a quarter mile is a neighbourhood, which is all "who lives near me"
 *  ever needed to answer. */
const DISTANCE_BAND_MILES = 0.25;

/** "~0.25 mi" — snapped to a band so it locates a neighbourhood, never a home.
 *  (This used to branch on `miles < 1` with two identical arms, which decided
 *  nothing; the band is the rule that branch was reaching for.) */
export function approxDistance(miles: number): string {
  const rounded = Math.round(miles / DISTANCE_BAND_MILES) * DISTANCE_BAND_MILES;
  // Never claim "~0.00 mi" — the nearest band still means "very close by".
  const banded = Math.max(DISTANCE_BAND_MILES, rounded);
  return `~${banded.toFixed(2)} mi`;
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

/** Slippy-map tile URL containing the given point. Uses CARTO's OSM-based
 *  basemap at @2x (512px) so the thumbnail stays crisp on retina displays;
 *  keyless, attribution "© OpenStreetMap contributors © CARTO". */
export function osmTileUrl(lat: number, lon: number, zoom: number): string {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return `https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}@2x.png`;
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
