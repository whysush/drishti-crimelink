// Terrain — one crisp extruded plateau per district.
//
// The earlier build sampled a jittered grid and clipped it to the district
// polygons, which meant every border was stair-stepped at grid resolution, fbm
// noise made the districts lumpy, and the height came from an inverse-distance
// blend that bled across boundaries. It read as melted dunes, not a map.
//
// This extrudes each district straight from its real GeoJSON outline instead, so
// the boundary is exact, the top is flat, and a district's height is its own case
// count rather than a smear of its neighbours'. Same data encoding — taller means
// more unsolved cases — but it now reads as a map you could put on a wall.
import * as THREE from "three";

import { makeProjection } from "./geo";
import { District } from "./types";

const PROJ = makeProjection(100, 100, 6);
const toXY = (lon: number, lat: number): [number, number] => {
  const [x, y] = PROJ.project(lon, lat);
  return [x - 50, 50 - y];
};

// A tall spread turned the state into disconnected towers with chasms between
// them. Kept shallow, the plateaus still rank by case load but the map reads as one
// landmass — which is what a map is supposed to do.
const BASE_H = 2.8;      // every district stands off the ground: it is land, not a gap
const CRIME_H = 2.6;     // additional height at the busiest district
const BEVEL = 0.07;      // a chamfer this small only catches the light on the rim

// The source outlines carry ~19,800 vertices across 30 districts — far more than a
// 100-unit-wide map can show. Extruded raw, every micro-vertex became a corrugation
// down the side walls and a burr on the rim. Simplifying first is what makes the
// edges read as clean lines instead of noise.
const SIMPLIFY = 0.28;

type Ring = number[][];

function inRing(x: number, y: number, r: Ring) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker on an open polyline. */
function rdpOpen(pts: Ring, eps: number): Ring {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const [ax, ay] = pts[lo], [bx, by] = pts[hi];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1, bestD = eps;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = pts[i];
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([lo, best], [best, hi]); }
  }
  const out: Ring = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * Simplify one ring.
 *
 * These rings are closed — the last point repeats the first — so running
 * Douglas-Peucker straight down them anchors on a zero-length segment, measures
 * every deviation as zero, and discards the entire outline. The fix is to anchor
 * on the point furthest from the start and simplify the two halves, which is what
 * gives a closed ring the two real endpoints the algorithm needs.
 */
function simplify(ring: Ring, eps: number): Ring {
  const n = ring.length;
  const closed = n > 2 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length < 6) return ring;

  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[0][0], dy = pts[i][1] - pts[0][1];
    const d = dx * dx + dy * dy;
    if (d > fd) { fd = d; far = i; }
  }
  const out = rdpOpen(pts.slice(0, far + 1), eps)
    .concat(rdpOpen(pts.slice(far), eps).slice(1));
  if (out.length < 4) return ring;
  return closed ? out.concat([out[0]]) : out;
}

export interface DistrictMesh {
  code: number;
  active: boolean;
  geometry: THREE.BufferGeometry;
  /** top-face height, so pins and borders can sit exactly on the plateau */
  height: number;
  /** outline of the top face, for the border pass */
  outline: THREE.Vector3[][];
}

export interface Terrain {
  meshes: DistrictMesh[];
  sampleY: (lon: number, lat: number) => number;
  heightOf: (code: number) => number;
}

export function buildTerrain(districts: District[]): Terrain {
  const byCode = new Map(districts.map((d) => [Number(d.district_id), d]));
  const maxU = Math.max(1, ...districts.map((d) => d.unsolved));

  const meshes: DistrictMesh[] = [];
  const heights = new Map<number, number>();
  // kept in projected space for the point-in-district test that places pins
  const shapes: { code: number; polys: Ring[][] }[] = [];

  for (const f of PROJ.features) {
    const d = byCode.get(f.censuscode);
    const value = d ? d.unsolved / maxU : 0;
    const height = BASE_H + Math.sqrt(value) * CRIME_H;
    heights.set(f.censuscode, height);

    const polys: Ring[][] = [];
    const threeShapes: THREE.Shape[] = [];
    const outline: THREE.Vector3[][] = [];

    for (const poly of f.coords) {
      const rings: Ring[] = poly.map((ring) =>
        simplify(ring.map(([lo, la]) => toXY(lo, la)), SIMPLIFY));
      if (!rings.length || rings[0].length < 3) continue;
      polys.push(rings);

      const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)));
      // inner rings are holes — enclaves must not be filled in
      for (let h = 1; h < rings.length; h++) {
        if (rings[h].length >= 3) {
          shape.holes.push(new THREE.Path(rings[h].map(([x, y]) => new THREE.Vector2(x, y))));
        }
      }
      threeShapes.push(shape);
      outline.push(rings[0].map(([x, y]) => new THREE.Vector3(x, height, -y)));
    }
    if (!threeShapes.length) continue;

    const geometry = new THREE.ExtrudeGeometry(threeShapes, {
      depth: height,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelOffset: 0,
      bevelSegments: 1,
      curveSegments: 1,          // outlines are already dense polylines
    });
    // shapes are authored in XY; stand them up so height runs along world Y
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();

    meshes.push({
      code: f.censuscode,
      active: value > 0,
      geometry,
      height,
      outline,
    });
    shapes.push({ code: f.censuscode, polys });
  }

  const districtAt = (x: number, y: number): number => {
    for (const s of shapes) {
      for (const rings of s.polys) {
        if (!inRing(x, y, rings[0])) continue;
        let hole = false;
        for (let h = 1; h < rings.length; h++) if (inRing(x, y, rings[h])) { hole = true; break; }
        if (!hole) return s.code;
      }
    }
    return -1;
  };

  return {
    meshes,
    heightOf: (code) => heights.get(code) ?? BASE_H,
    sampleY: (lon, lat) => {
      const [x, y] = toXY(lon, lat);
      const c = districtAt(x, y);
      return c === -1 ? 0 : (heights.get(c) ?? BASE_H);
    },
  };
}

export function worldXZ(lon: number, lat: number): [number, number] {
  const [x, y] = toXY(lon, lat);
  return [x, -y];
}
