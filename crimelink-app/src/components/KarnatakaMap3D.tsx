import React, { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { buildTerrain, worldXZ, Terrain, DistrictMesh } from "../terrain";
import { DISTRICT_NAMES } from "../geo";
import { District, Group, Hotspot, RiskDistrict, UCase } from "../types";
import { TFn } from "../i18n";

/**
 * Map palette.
 *
 * The terrain is greyscale on purpose. Every other colour on this screen means
 * something, and if the land itself is coloured then the evidence drawn on top of
 * it — the links, the pins, the projected zone — has to shout to be seen. Graphite
 * relief, coloured evidence: the eye goes straight to what matters.
 *
 * Districts are graded by case volume, so the map still reads as a choropleth.
 */
// Districts separate on TWO axes, not just brightness. No-data districts are a
// neutral, inert grey — visible enough to read as land so the state never looks
// like it has holes in it, but flat and colourless. Districts carrying cases are
// lifted AND tinted cool blue, so "has data" is legible at a glance even where the
// volume is low and the brightness gap alone would be marginal.
// Measured against the rendered frame, not guessed: lighting lands these at roughly
// 0.7x their base luminance, so the values are chosen to sit in distinct bands —
// background ~12, no-data ~40, lowest-volume district ~60, busiest ~105.
const COL_LOW = "#52526e";        // has cases, few  (cool tint begins)
const COL_HIGH = "#8b8ba4";       // has cases, many
const COL_INACTIVE = "#383839";   // no data — unmistakably land, deliberately inert
const COL_SELECT = "#f4f1ea";     // clicked (bone — the only lit land)
const COL_HOVER = "#7d7d8d";
const ACCENT = "#8a8a99";
// The palette encodes epistemic status, not just category. Anything RECORDED is
// red, anything MEASURED is neutral bone, anything INFERRED is blue, and anything
// PREDICTED is amber — one colour the eye can learn once and trust everywhere.
//
// Risk previously shared red with case pins, so a forecast for next month looked
// identical to a crime that already happened. That is the one confusion this map
// cannot afford, so forward risk now sits with the rest of the predictions.
const PIN = "#ff4d4d";            // recorded — an offence that happened
const WEB_LINK = "#5b9dff";       // inferred — a link we computed
const HOTSPOT = "#f4f1ea";        // measured — an observed concentration
// Forecast is teal, deliberately nowhere near the warm end of the palette. Red and
// yellow now carry risk SEVERITY, so a projection drawn in either would read as a
// severity grade instead of a prediction.
const FORECAST = "#00e5d0";       // PREDICTED — projected next-strike zone
const RISK_HIGH = "#ff4d4d";      // PREDICTED RISK — Critical / High districts
const RISK_MED = "#ffd60a";       // PREDICTED RISK — Elevated districts
const TRAIL = "#c084fc";          // one person's recorded case history

function DistrictMeshMesh({ m, color, onOver, onOut, onPick }: {
  m: DistrictMesh; color: string; onOver: (code: number, e: any) => void; onOut: () => void; onPick: (code: number) => void;
}) {
  return (
    <mesh geometry={m.geometry}
      onPointerMove={(e) => { e.stopPropagation(); onOver(m.code, e); }}
      onPointerOut={() => onOut()}
      onClick={(e) => { e.stopPropagation(); onPick(m.code); }}>
      <meshStandardMaterial color={color} roughness={0.62} metalness={0.08} flatShading />
    </mesh>
  );
}

function DistrictMeshes({ meshes, selectedCode, hoverCode, volume, onOver, onOut, onPick }: {
  meshes: DistrictMesh[]; selectedCode: number | null; hoverCode: number;
  volume: Map<number, number>;
  onOver: (code: number, e: any) => void; onOut: () => void; onPick: (code: number) => void;
}) {
  const lo = new THREE.Color(COL_LOW), hi = new THREE.Color(COL_HIGH);
  return (
    <group>
      {meshes.map((m) => {
        let color: string;
        if (m.code === selectedCode) color = COL_SELECT;
        else if (m.code === hoverCode && m.active) color = COL_HOVER;
        else if (m.active) {
          // grade the graphite by case volume so the map still carries the data
          const k = volume.get(m.code) ?? 0;
          color = "#" + lo.clone().lerp(hi, k).getHexString();
        } else color = COL_INACTIVE;
        return <DistrictMeshMesh key={m.code} m={m} color={color}
          onOver={onOver} onOut={onOut} onPick={onPick} />;
      })}
    </group>
  );
}

function BorderLines({ terrain }: { terrain: Terrain }) {
  // Each district carries the outline of its own top face, so a boundary between
  // two plateaus of different height is drawn twice — once on each rim — which is
  // exactly what makes the step between them read.
  const rings = useMemo(() => {
    const out: THREE.Vector3[][] = [];
    for (const m of terrain.meshes) {
      for (const ring of m.outline) {
        out.push(ring.map((p) => new THREE.Vector3(p.x, p.y + 0.05, p.z)));
      }
    }
    return out;
  }, [terrain]);
  return (
    <group>
      {rings.map((pts, i) => (
        <Line key={i} points={pts} color="#07070a" lineWidth={1.15}
          transparent opacity={0.9} raycast={() => null} />
      ))}
    </group>
  );
}

/**
 * A real push-pin, not a ball on a stick.
 *
 * The silhouette is lathed from a profile traced off an actual drawing pin: a wide
 * flared skirt at the base, a pinched neck, then a domed head that flares back out.
 * That waist is the whole reason a push-pin reads as a push-pin at a glance, and a
 * sphere has none of it.
 *
 * Geometry and materials are built once at module scope and shared by every pin on
 * the map — a district can drop sixty of these, and rebuilding a lathe per pin
 * would cost far more than the shape is worth.
 */
const PIN_PROFILE: [number, number][] = [
  [0.00, 0.00], [0.44, 0.00], [0.43, 0.07],   // flared skirt, widest at the base
  [0.30, 0.26], [0.20, 0.46], [0.135, 0.66],
  [0.13, 0.90],                               // pinched waist — the telling detail
  [0.17, 1.04], [0.28, 1.20], [0.40, 1.38],
  [0.47, 1.56], [0.47, 1.70],                 // head, flared wider than the skirt
  [0.43, 1.82], [0.33, 1.90], [0.18, 1.95],
  [0.00, 1.97],                               // domed top
];

const PIN_BODY_GEOM = new THREE.LatheGeometry(
  PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 22);
const PIN_SPIKE_GEOM = new THREE.ConeGeometry(0.045, 4.2, 8);
const PIN_BODY_MAT = new THREE.MeshStandardMaterial({
  // barely any emissive: enough to stay visible against the dark terrain, not so
  // much that it flattens the shading the shape depends on to read as a pin
  color: PIN, emissive: PIN, emissiveIntensity: 0.16,
  roughness: 0.18, metalness: 0.04,           // wet-looking moulded plastic
});
const PIN_SPIKE_MAT = new THREE.MeshStandardMaterial({
  color: "#9aa0ad", roughness: 0.32, metalness: 0.85,
});

function Pin({ pos, onOver, onOut, onClick }: { pos: THREE.Vector3; onOver: (e: any) => void; onOut: () => void; onClick: () => void; }) {
  return (
    <group position={pos} onPointerOver={(e) => { e.stopPropagation(); onOver(e); }} onPointerOut={onOut} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {/* spike: tip sits on the ground, cone points down */}
      <mesh geometry={PIN_SPIKE_GEOM} material={PIN_SPIKE_MAT}
        position={[0, 2.1, 0]} rotation={[Math.PI, 0, 0]} />
      {/* body rests on the head of the spike */}
      <mesh geometry={PIN_BODY_GEOM} material={PIN_BODY_MAT} position={[0, 4.15, 0]} />
    </group>
  );
}

function CasePins({ cases, terrain, onOver, onOut, onPick }: {
  cases: UCase[]; terrain: Terrain; onOver: (c: UCase, e: any) => void; onOut: () => void; onPick: (id: string) => void;
}) {
  const pins = useMemo(() => cases.filter((c) => c.lat != null && c.lon != null).map((c) => {
    const [x, z] = worldXZ(c.lon as number, c.lat as number);
    return { c, pos: new THREE.Vector3(x, terrain.sampleY(c.lon as number, c.lat as number) + 0.2, z) };
  }), [cases, terrain]);
  return <group>{pins.map(({ c, pos }) => <Pin key={c.case_master_id} pos={pos} onOver={(e) => onOver(c, e)} onOut={onOut} onClick={() => onPick(c.case_master_id)} />)}</group>;
}

function GroupOverlay({ group, terrain }: { group: Group; terrain: Terrain }) {
  const pts = group.members.filter((m) => m.lat != null && m.lon != null).map((m) => {
    const [x, z] = worldXZ(m.lon as number, m.lat as number);
    return new THREE.Vector3(x, terrain.sampleY(m.lon as number, m.lat as number) + 3.4, z);
  });
  if (!pts.length) return null;
  const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const hub = new THREE.Vector3(c.x, c.y + 5, c.z);
  return (
    <group>
      {pts.map((p, i) => <Line key={"l" + i} points={[hub, p]} color={WEB_LINK} lineWidth={2} dashed dashSize={0.8} gapSize={0.45} transparent opacity={0.95} />)}
      {pts.map((p, i) => <mesh key={i} position={p}><sphereGeometry args={[0.38, 16, 16]} /><meshStandardMaterial color="#dceaff" emissive={WEB_LINK} emissiveIntensity={1.9} /></mesh>)}
      <mesh position={hub}><sphereGeometry args={[0.5, 16, 16]} /><meshStandardMaterial color="#ffffff" emissive={WEB_LINK} emissiveIntensity={1.5} /></mesh>
    </group>
  );
}

/**
 * Projected next-strike zone.
 *
 * Drawn as a real geographic circle: points are generated at the forecast radius
 * in lat/lon and each is mapped through the same projection as everything else, so
 * the ring on screen encloses the ground it claims to. It pulses slowly to read as
 * a projection rather than a recorded fact.
 */
/** Points on a real geographic circle, mapped through the same projection as
 *  everything else, so a ring encloses the ground it claims to. */
function ringPoints(lat: number, lon: number, radiusKm: number, terrain: Terrain, lift: number) {
  const dLat = radiusKm / 110.574;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const la = lat + dLat * Math.sin(a);
    const lo = lon + dLon * Math.cos(a);
    const [x, z] = worldXZ(lo, la);
    out.push(new THREE.Vector3(x, terrain.sampleY(lo, la) + lift, z));
  }
  return out;
}

/**
 * Measured hotspots. Neutral bone rather than a warning colour: a hotspot is an
 * observation about where and when crime has already happened, not a prediction,
 * and the palette reserves red for risk and amber for projection.
 */
function HotspotRings({ hotspots, terrain, selected }: {
  hotspots: Hotspot[]; terrain: Terrain; selected: string | null;
}) {
  const rings = useMemo(() => hotspots.map((h) => ({
    id: h.hotspot_id,
    pts: ringPoints(h.lat, h.lon, Math.max(h.radius_km, 1.2), terrain, 1.0),
    intensity: h.intensity,
  })), [hotspots, terrain]);
  return (
    <group>
      {rings.map((r) => {
        const on = selected === r.id;
        return <Line key={r.id} points={r.pts} color={HOTSPOT}
          lineWidth={on ? 2.6 : 1.1} transparent
          opacity={on ? 0.95 : 0.16 + r.intensity * 0.3} raycast={() => null} />;
      })}
    </group>
  );
}

/**
 * Red-zone pulsing for districts carrying high forward risk — the visual the
 * brief asks for. It pulses because a static red blob reads as a category, while
 * a pulse reads as "this is live right now", which is what a risk score is.
 */
function RiskZones({ risk, districts, terrain }: {
  risk: RiskDistrict[]; districts: District[]; terrain: Terrain;
}) {
  const ref = useRef<any>(null);
  const zones = useMemo(() => {
    const byId = new Map(districts.map((d) => [Number(d.district_id), d]));
    // Elevated districts are drawn too, in yellow. Showing only the red tier hid
    // the districts a commander would actually watch next, and left the map
    // implying everywhere else was fine.
    return risk
      .filter((r) => r.level === "Critical" || r.level === "High" || r.level === "Elevated")
      .map((r) => {
        const d = byId.get(Number(r.district_id));
        if (!d) return null;
        const top = r.level === "Critical" || r.level === "High";
        return {
          id: r.district,
          pts: ringPoints(d.lat, d.lon, 26 + r.risk * 22, terrain, 1.6),
          risk: r.risk,
          color: top ? RISK_HIGH : RISK_MED,
          top,
        };
      })
      .filter(Boolean) as { id: string; pts: THREE.Vector3[]; risk: number;
                            color: string; top: boolean }[];
  }, [risk, districts, terrain]);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.children.forEach((c: any, i: number) => {
        if (!c.material) return;
        const phase = clock.elapsedTime * 1.5 - i * 0.35;
        c.material.opacity = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(phase));
      });
    }
  });

  return (
    <group ref={ref}>
      {zones.map((z) => (
        <Line key={z.id} points={z.pts} color={z.color} lineWidth={1.4 + z.risk * 2.4}
          transparent opacity={0.4} raycast={() => null} />
      ))}
    </group>
  );
}

function ForecastZone({ group, terrain }: { group: Group; terrain: Terrain }) {
  const ref = useRef<any>(null);
  const f = group.forecast;
  const pts = useMemo(() => (
    f?.available && f.zone
      ? ringPoints(f.zone.lat, f.zone.lon, f.zone.radius_km, terrain, 1.2)
      : null
  ), [f, terrain]);

  useFrame(({ clock }) => {
    if (ref.current) {
      const k = 0.55 + 0.45 * Math.sin(clock.elapsedTime * 1.6);
      ref.current.material.opacity = 0.35 + 0.5 * k;
    }
  });

  if (!pts || !f?.zone) return null;
  const [cx, cz] = worldXZ(f.zone.lon, f.zone.lat);
  const cy = terrain.sampleY(f.zone.lon, f.zone.lat);
  return (
    <group>
      <Line ref={ref} points={pts} color={FORECAST} lineWidth={2.6} transparent opacity={0.8}
        raycast={() => null} />
      <mesh position={[cx, cy + 1.4, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, 0.9, 24]} />
        <meshBasicMaterial color={FORECAST} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * One person's recorded case history.
 *
 * Every case they are named in, in date order, joined by a line so the sequence
 * reads as a path rather than a scatter. Deliberately violet: these are recorded
 * offences, so they must not borrow the amber that means "predicted", and must not
 * disappear into the red of the ordinary case pins either.
 */
function PersonTrail({ cases, terrain }: { cases: UCase[]; terrain: Terrain }) {
  const pts = useMemo(() => cases
    .filter((c) => c.lat != null && c.lon != null)
    .slice()
    .sort((a, b) => (a.incident_from || "").localeCompare(b.incident_from || ""))
    .map((c) => {
      const [x, z] = worldXZ(c.lon as number, c.lat as number);
      return new THREE.Vector3(x, terrain.sampleY(c.lon as number, c.lat as number) + 3.2, z);
    }), [cases, terrain]);

  if (!pts.length) return null;
  return (
    <group>
      {pts.length > 1 && (
        <Line points={pts} color={TRAIL} lineWidth={2.2} dashed dashSize={1.1} gapSize={0.6}
          transparent opacity={0.9} raycast={() => null} />
      )}
      {pts.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.62, 18, 18]} />
          <meshStandardMaterial color={TRAIL} emissive={TRAIL} emissiveIntensity={1.5} />
        </mesh>
      ))}
    </group>
  );
}

function Rig({ autoRotate }: { autoRotate: boolean }) {
  const ref = useRef<any>(null);
  useFrame(() => { if (ref.current) ref.current.update(); });
  return <OrbitControls ref={ref} makeDefault enableDamping dampingFactor={0.08} autoRotate={autoRotate} autoRotateSpeed={0.45} minDistance={45} maxDistance={260} maxPolarAngle={Math.PI / 2.03} target={[0, 0, 0]} />;
}

export default function KarnatakaMap3D({
  districts, cases, selectedGroup, selectedDistrictId, showForecast, showPins, t,
  hotspots, showHotspots, selectedHotspot, risk, showRisk, trailCases,
  onClickDistrict, onPickCase,
}: {
  districts: District[]; cases: UCase[]; selectedGroup: Group | null; selectedDistrictId: number | null;
  showForecast: boolean; showPins: boolean; t: TFn;
  hotspots: Hotspot[]; showHotspots: boolean; selectedHotspot: string | null;
  risk: RiskDistrict[]; showRisk: boolean;
  trailCases: UCase[];
  onClickDistrict: (censuscode: number, name: string) => void; onPickCase: (id: string) => void;
}) {
  const terrain = useMemo(() => (districts.length ? buildTerrain(districts) : null), [districts]);
  const byCode = useMemo(() => new Map(districts.map((d) => [Number(d.district_id), d])), [districts]);
  const volume = useMemo(() => {
    const max = Math.max(1, ...districts.map((d) => d.unsolved));
    return new Map(districts.map((d) => [Number(d.district_id), d.unsolved / max]));
  }, [districts]);
  const [hoverCode, setHoverCode] = useState<number>(-1);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [pinTip, setPinTip] = useState<{ c: UCase; x: number; y: number } | null>(null);
  const [auto, setAuto] = useState(true);

  const hoverD = hoverCode >= 0 ? byCode.get(hoverCode) : undefined;
  const hoverName = hoverCode >= 0 ? DISTRICT_NAMES.get(hoverCode) : undefined;
  const districtCases = useMemo(
    () => (selectedDistrictId != null ? cases.filter((c) => c.district_id === selectedDistrictId) : []),
    [selectedDistrictId, cases]);

  return (
    <div className="map3d" onPointerDown={() => setAuto(false)}>
      <Canvas camera={{ position: [0, 82, 98], fov: 40 }} dpr={[1, 2]}
        // measure the container immediately instead of on a debounce: the default
        // 200ms delay means the drawing buffer can stay at its 300x150 default if
        // the timer never resolves, and the map renders into nothing
        resize={{ debounce: 0, scroll: false }}>
        <color attach="background" args={["#0a0a0b"]} />
        <fog attach="fog" args={["#0a0a0b", 175, 370]} />
        <ambientLight intensity={0.62} />
        <directionalLight position={[-70, 80, 30]} intensity={1.75} color="#fff6e8" />
        <directionalLight position={[60, 30, -40]} intensity={0.62} color={ACCENT} />
        <group position={[0, -4, 0]}>
          {terrain && (
            <DistrictMeshes meshes={terrain.meshes} selectedCode={selectedDistrictId}
              hoverCode={hoverCode} volume={volume}
              onOver={(code, e) => { document.body.style.cursor = byCode.get(code) ? "pointer" : "default"; setHoverCode(code); setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
              onOut={() => { document.body.style.cursor = "default"; setHoverCode(-1); setTip(null); }}
              onPick={(code) => { const d = byCode.get(code); if (d) onClickDistrict(code, d.district); }} />
          )}
          {terrain && <BorderLines terrain={terrain} />}
          {terrain && showPins && districtCases.length > 0 && (
            <CasePins cases={districtCases} terrain={terrain}
              onOver={(c, e) => { document.body.style.cursor = "pointer"; setPinTip({ c, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
              onOut={() => setPinTip(null)} onPick={onPickCase} />
          )}
          {terrain && selectedGroup && <GroupOverlay group={selectedGroup} terrain={terrain} />}
          {terrain && trailCases.length > 0 && <PersonTrail cases={trailCases} terrain={terrain} />}
          {terrain && showForecast && selectedGroup?.forecast?.available && (
            <ForecastZone group={selectedGroup} terrain={terrain} />
          )}
          {terrain && showHotspots && hotspots.length > 0 && (
            <HotspotRings hotspots={hotspots} terrain={terrain} selected={selectedHotspot} />
          )}
          {terrain && showRisk && risk.length > 0 && (
            <RiskZones risk={risk} districts={districts} terrain={terrain} />
          )}
        </group>
        <Rig autoRotate={auto} />
      </Canvas>

      {pinTip ? (
        <div className="maptip" style={{ left: pinTip.x + 16, top: pinTip.y + 14 }}>
          <div className="tt-name">{pinTip.c.crime_no}</div>
          <div className="tt-row">{pinTip.c.minor_head} · {pinTip.c.station}</div>
          <div className={`tt-row ${pinTip.c.gravity === "Heinous" ? "heinous" : ""}`}>{pinTip.c.gravity}{pinTip.c.in_series ? " · in a group" : ""}</div>
          <div className="tt-hint">click to open</div>
        </div>
      ) : tip && hoverCode >= 0 && (
        <div className="maptip" style={{ left: tip.x + 16, top: tip.y + 14 }}>
          <div className="tt-name">{hoverName}</div>
          {hoverD && hoverD.unsolved > 0 ? (
            <>
              <div className="tt-row"><b>{hoverD.unsolved}</b> unsolved cases</div>
              <div className="tt-row"><b>{hoverD.in_series}</b> in linked groups · {hoverD.n_groups} groups</div>
              <div className="tt-row heinous"><b>{hoverD.heinous}</b> heinous</div>
              <div className="tt-hint">click to open</div>
            </>
          ) : <div className="tt-row muted">no data yet</div>}
        </div>
      )}
      <div className="map3d-controls"><button onClick={() => setAuto((v) => !v)}>{auto ? `⏸ ${t("spin_stop")}` : `▶ ${t("spin_start")}`}</button></div>
      <div className="map3d-hint">{t("map_hint")}</div>
    </div>
  );
}
