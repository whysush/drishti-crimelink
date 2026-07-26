// Tiny self-contained GeoJSON projector (no d3). Equirectangular with longitude
// cos-latitude correction so Karnataka isn't horizontally stretched. The SAME
// projection is used for district shapes AND case dots so they line up exactly.
import geojson from "./assets/karnataka_districts.json";

type Ring = number[][];
type Poly = Ring[];
export interface Feature {
  district: string; censuscode: number; kind: string; coords: Poly[];
}

const FEATURES: Feature[] = (geojson as any).features.map((f: any) => ({
  district: f.properties.district,
  censuscode: f.properties.censuscode,
  kind: f.geometry.type,
  coords: f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates],
}));

export const DISTRICT_NAMES = new Map<number, string>(
  FEATURES.map((f) => [f.censuscode, f.district]));

export const DISTRICT_FEATURES = FEATURES;   // real polygons, for drawing borders

function bounds() {
  let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
  for (const f of FEATURES)
    for (const poly of f.coords)
      for (const ring of poly)
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        }
  return { minLon, maxLon, minLat, maxLat };
}

export function makeProjection(W: number, H: number, pad = 24) {
  const b = bounds();
  const midLat = ((b.minLat + b.maxLat) / 2) * Math.PI / 180;
  const kx = Math.cos(midLat);                       // lon compression
  const gx = (lon: number) => lon * kx;
  const spanX = (b.maxLon - b.minLon) * kx;
  const spanY = b.maxLat - b.minLat;
  const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const ox = (W - spanX * scale) / 2;
  const oy = (H - spanY * scale) / 2;
  const project = (lon: number, lat: number): [number, number] => [
    ox + (gx(lon) - gx(b.minLon)) * scale,
    oy + (b.maxLat - lat) * scale,          // invert Y (north up)
  ];
  const pathFor = (f: Feature): string => {
    let d = "";
    for (const poly of f.coords)
      for (const ring of poly) {
        d += ring.map(([lon, lat], i) => {
          const [x, y] = project(lon, lat);
          return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
        }).join("") + "Z";
      }
    return d;
  };
  const centroid = (f: Feature): [number, number] => {
    let sx = 0, sy = 0, n = 0;
    for (const poly of f.coords) for (const [lon, lat] of poly[0]) {
      const [x, y] = project(lon, lat); sx += x; sy += y; n++;
    }
    return [sx / n, sy / n];
  };
  return { project, pathFor, centroid, features: FEATURES };
}
