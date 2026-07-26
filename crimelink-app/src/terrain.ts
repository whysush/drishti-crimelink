// Terrain generator — ONE smooth mesh PER DISTRICT so colours never leak across
// borders. Vertices are shared WITHIN a district (smooth shading) but duplicated
// at borders (each district owns its edge copies), giving crisp, non-bleeding
// district fills. Elevation rises with crime volume (+ gentle relief).
import { makeProjection } from "./geo";
import { District } from "./types";

const PROJ = makeProjection(100, 100, 6);
const toXY = (lon: number, lat: number): [number, number] => {
  const [x, y] = PROJ.project(lon, lat);
  return [x - 50, 50 - y];
};

function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const tl = hash(xi, yi), tr = hash(xi + 1, yi), bl = hash(xi, yi + 1), br = hash(xi + 1, yi + 1);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}
function fbm(x: number, y: number) { return 0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1, y * 2.1) + 0.1 * vnoise(x * 4.3, y * 4.3); }

type Ring = number[][];
function inRing(x: number, y: number, r: Ring) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

interface DPoly { rings: Ring[]; }
interface DFeat { code: number; polys: DPoly[]; bbox: [number, number, number, number]; cx: number; cy: number; value: number; }

export interface DistrictMesh { code: number; active: boolean; positions: Float32Array; indices: Uint32Array; }
export interface Terrain { meshes: DistrictMesh[]; sampleY: (lon: number, lat: number) => number; }

const STEP = 0.45;            // high-poly (per-district meshes -> no colour leak)
const JIT = 0.12 * STEP;
const CRIME_H = 11;
const RELIEF_H = 2.2;
const DETAIL_H = 0.5;

export function buildTerrain(districts: District[]): Terrain {
  const byCode = new Map(districts.map((d) => [Number(d.district_id), d]));
  const maxU = Math.max(1, ...districts.map((d) => d.unsolved));

  const feats: DFeat[] = PROJ.features.map((f) => {
    const polys: DPoly[] = f.coords.map((poly) => ({ rings: poly.map((ring) => ring.map(([lo, la]) => toXY(lo, la))) }));
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, sx = 0, sy = 0, n = 0;
    for (const p of polys) for (const [x, y] of p.rings[0]) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); sx += x; sy += y; n++; }
    const d = byCode.get(f.censuscode);
    return { code: f.censuscode, polys, bbox: [minx, miny, maxx, maxy], cx: sx / n, cy: sy / n, value: d ? d.unsolved / maxU : 0 };
  });
  const valueByCode = new Map(feats.map((f) => [f.code, f.value]));

  const inFeat = (x: number, y: number, ft: DFeat) => {
    if (x < ft.bbox[0] || x > ft.bbox[2] || y < ft.bbox[1] || y > ft.bbox[3]) return false;
    for (const p of ft.polys) { if (!inRing(x, y, p.rings[0])) continue; let hole = false; for (let h = 1; h < p.rings.length; h++) if (inRing(x, y, p.rings[h])) { hole = true; break; } if (!hole) return true; }
    return false;
  };
  const districtAt = (x: number, y: number): number => { for (const ft of feats) if (inFeat(x, y, ft)) return ft.code; return -1; };
  const crimeField = (x: number, y: number) => { let num = 0, den = 0; for (const ft of feats) { const dx = x - ft.cx, dy = y - ft.cy, w = 1 / (dx * dx + dy * dy + 4); num += ft.value * w; den += w; } return den ? num / den : 0; };
  const elevation = (x: number, y: number) => (fbm(x * 0.16 + 5, y * 0.16 + 9) - 0.5) * RELIEF_H + (fbm(x * 0.6 + 2, y * 0.6 + 7) - 0.5) * DETAIL_H + crimeField(x, y) * CRIME_H;

  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const ft of feats) { minx = Math.min(minx, ft.bbox[0]); miny = Math.min(miny, ft.bbox[1]); maxx = Math.max(maxx, ft.bbox[2]); maxy = Math.max(maxy, ft.bbox[3]); }
  const cols = Math.ceil((maxx - minx) / STEP) + 1, rows = Math.ceil((maxy - miny) / STEP) + 1;

  const N = cols * rows;
  const code = new Int32Array(N).fill(-1);
  const wx = new Float32Array(N), wy = new Float32Array(N), wz = new Float32Array(N);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = minx + i * STEP + (hash(i * 3.1, j * 7.7) - 0.5) * JIT;
    const y = miny + j * STEP + (hash(i * 5.9, j * 2.3) - 0.5) * JIT;
    const c = districtAt(x, y); if (c === -1) continue;
    const k = i * rows + j; code[k] = c; wx[k] = x; wy[k] = elevation(x, y); wz[k] = -y;
  }

  const majority = (a: number, b: number, c: number) => (a === b || a === c ? a : b === c ? b : a);
  const triKeys = new Map<number, number[]>();  // district -> flat node keys (3/tri)
  const addTri = (a: number, b: number, c: number) => {
    if (code[a] < 0 || code[b] < 0 || code[c] < 0) return;
    const d = majority(code[a], code[b], code[c]);
    const arr = triKeys.get(d) || []; arr.push(a, b, c); triKeys.set(d, arr);
  };
  for (let i = 0; i < cols - 1; i++) for (let j = 0; j < rows - 1; j++) {
    const a = i * rows + j, b = (i + 1) * rows + j, c = i * rows + (j + 1), d = (i + 1) * rows + (j + 1);
    addTri(a, b, d); addTri(a, d, c);
  }

  const meshes: DistrictMesh[] = [];
  triKeys.forEach((keys, dcode) => {
    const local = new Map<number, number>(); const pos: number[] = []; const idx: number[] = [];
    for (const k of keys) {
      let li = local.get(k);
      if (li === undefined) { li = pos.length / 3; local.set(k, li); pos.push(wx[k], wy[k], wz[k]); }
      idx.push(li);
    }
    meshes.push({ code: dcode, active: (valueByCode.get(dcode) ?? 0) > 0, positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  });

  return { meshes, sampleY: (lon, lat) => { const [x, y] = toXY(lon, lat); return elevation(x, y); } };
}

export function worldXZ(lon: number, lat: number): [number, number] { const [x, y] = toXY(lon, lat); return [x, -y]; }
