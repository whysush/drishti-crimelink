import React, { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { buildTerrain, worldXZ, Terrain, DistrictMesh } from "../terrain";
import { DISTRICT_NAMES, DISTRICT_FEATURES } from "../geo";
import { District, Group, UCase } from "../types";

// theme (violet / indigo — not ocean-green)
const COL_ACTIVE = "#6a54e0";     // districts with cases (brighter blue-violet)
const COL_INACTIVE = "#3a1f66";   // no data (deep purple, clearly above the near-black bg)
const COL_SELECT = "#ffc24d";     // clicked (gold)
const COL_HOVER = "#d9ccff";      // hover preview (lavender)
const ACCENT = "#9b7bff";

function DistrictMeshMesh({ m, color, onOver, onOut, onPick }: {
  m: DistrictMesh; color: string; onOver: (code: number, e: any) => void; onOut: () => void; onPick: (code: number) => void;
}) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [m]);
  return (
    <mesh geometry={geom}
      onPointerMove={(e) => { e.stopPropagation(); onOver(m.code, e); }}
      onPointerOut={() => onOut()}
      onClick={(e) => { e.stopPropagation(); onPick(m.code); }}>
      <meshStandardMaterial color={color} roughness={0.86} metalness={0.06} side={THREE.DoubleSide} />
    </mesh>
  );
}

function DistrictMeshes({ meshes, selectedCode, hoverCode, onOver, onOut, onPick }: {
  meshes: DistrictMesh[]; selectedCode: number | null; hoverCode: number;
  onOver: (code: number, e: any) => void; onOut: () => void; onPick: (code: number) => void;
}) {
  return (
    <group>
      {meshes.map((m) => {
        const color = m.code === selectedCode ? COL_SELECT
          : (m.code === hoverCode && m.active) ? COL_HOVER
            : m.active ? COL_ACTIVE : COL_INACTIVE;
        return <DistrictMeshMesh key={m.code} m={m} color={color} onOver={onOver} onOut={onOut} onPick={onPick} />;
      })}
    </group>
  );
}

function BorderLines({ terrain }: { terrain: Terrain }) {
  const rings = useMemo(() => {
    const out: THREE.Vector3[][] = [];
    for (const f of DISTRICT_FEATURES) for (const poly of f.coords) for (const ring of poly) {
      out.push(ring.map(([lon, lat]) => { const [x, z] = worldXZ(lon, lat); return new THREE.Vector3(x, terrain.sampleY(lon, lat) + 0.4, z); }));
    }
    return out;
  }, [terrain]);
  return <group>{rings.map((pts, i) => <Line key={i} points={pts} color="#141a2c" lineWidth={1.3} transparent opacity={0.9} raycast={() => null} />)}</group>;
}

function Pin({ pos, onOver, onOut, onClick }: { pos: THREE.Vector3; onOver: (e: any) => void; onOut: () => void; onClick: () => void; }) {
  return (
    <group position={pos} onPointerOver={(e) => { e.stopPropagation(); onOver(e); }} onPointerOut={onOut} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <mesh position={[0, 1.35, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.06, 2.7, 8]} /><meshStandardMaterial color="#c2ccdd" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 2.85, 0]}>
        <sphereGeometry args={[0.38, 16, 16]} /><meshStandardMaterial color="#ff3b3b" emissive="#ff2020" emissiveIntensity={0.9} />
      </mesh>
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
  const WEB = "#22e6ff";   // vivid electric cyan — pops against the violet terrain
  return (
    <group>
      {pts.map((p, i) => <Line key={"l" + i} points={[hub, p]} color={WEB} lineWidth={2} dashed dashSize={0.8} gapSize={0.45} transparent opacity={0.95} />)}
      {pts.map((p, i) => <mesh key={i} position={p}><sphereGeometry args={[0.38, 16, 16]} /><meshStandardMaterial color="#9ff6ff" emissive={WEB} emissiveIntensity={2} /></mesh>)}
      <mesh position={hub}><sphereGeometry args={[0.55, 16, 16]} /><meshStandardMaterial color="#ff5cc0" emissive="#ff2d95" emissiveIntensity={1.7} /></mesh>
    </group>
  );
}

function Rig({ autoRotate }: { autoRotate: boolean }) {
  const ref = useRef<any>(null);
  useFrame(() => { if (ref.current) ref.current.update(); });
  return <OrbitControls ref={ref} makeDefault enableDamping dampingFactor={0.08} autoRotate={autoRotate} autoRotateSpeed={0.45} minDistance={45} maxDistance={260} maxPolarAngle={Math.PI / 2.03} target={[0, 0, 0]} />;
}

export default function KarnatakaMap3D({
  districts, cases, selectedGroup, selectedDistrictId, onClickDistrict, onPickCase,
}: {
  districts: District[]; cases: UCase[]; selectedGroup: Group | null; selectedDistrictId: number | null;
  onClickDistrict: (censuscode: number, name: string) => void; onPickCase: (id: string) => void;
}) {
  const terrain = useMemo(() => (districts.length ? buildTerrain(districts) : null), [districts]);
  const byCode = useMemo(() => new Map(districts.map((d) => [Number(d.district_id), d])), [districts]);
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
      <Canvas camera={{ position: [0, 82, 98], fov: 40 }} dpr={[1, 2]}>
        <color attach="background" args={["#08060f"]} />
        <fog attach="fog" args={["#08060f", 180, 380]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[-70, 80, 30]} intensity={1.6} color="#f1ecff" />
        <directionalLight position={[60, 30, -40]} intensity={0.5} color={ACCENT} />
        <group position={[0, -4, 0]}>
          {terrain && (
            <DistrictMeshes meshes={terrain.meshes} selectedCode={selectedDistrictId} hoverCode={hoverCode}
              onOver={(code, e) => { document.body.style.cursor = byCode.get(code) ? "pointer" : "default"; setHoverCode(code); setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
              onOut={() => { document.body.style.cursor = "default"; setHoverCode(-1); setTip(null); }}
              onPick={(code) => { const d = byCode.get(code); if (d) onClickDistrict(code, d.district); }} />
          )}
          {terrain && <BorderLines terrain={terrain} />}
          {terrain && districtCases.length > 0 && (
            <CasePins cases={districtCases} terrain={terrain}
              onOver={(c, e) => { document.body.style.cursor = "pointer"; setPinTip({ c, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
              onOut={() => setPinTip(null)} onPick={onPickCase} />
          )}
          {terrain && selectedGroup && <GroupOverlay group={selectedGroup} terrain={terrain} />}
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
      <div className="map3d-controls"><button onClick={() => setAuto((v) => !v)}>{auto ? "⏸ stop spin" : "▶ auto-spin"}</button></div>
      <div className="map3d-hint">drag to rotate · scroll to zoom · click a district to drop case pins</div>
    </div>
  );
}
