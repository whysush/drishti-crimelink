import React, { useMemo, useState } from "react";
import { makeProjection } from "../geo";
import { District, Group, UCase } from "../types";

const W = 820, H = 760;

export default function KarnatakaMap({
  districts, cases, selectedGroup, selectedDistrictId, tilt, onClickDistrict,
}: {
  districts: District[];
  cases: UCase[];
  selectedGroup: Group | null;
  selectedDistrictId: number | null;
  tilt: boolean;
  onClickDistrict: (censuscode: number, name: string) => void;
}) {
  const proj = useMemo(() => makeProjection(W, H), []);
  const byId = useMemo(
    () => new Map(districts.map((d) => [Number(d.district_id), d])), [districts]);
  const maxUnsolved = useMemo(
    () => Math.max(1, ...districts.map((d) => d.unsolved)), [districts]);
  const [hover, setHover] = useState<{ d: District | null; x: number; y: number } | null>(null);

  // choropleth fill: dark→bright cyan by unsolved volume; grey if no data
  const fillFor = (censuscode: number) => {
    const d = byId.get(censuscode);
    if (!d) return "#0e1420";
    const t = Math.sqrt(d.unsolved / maxUnsolved);   // sqrt so low counts still read
    const heinT = d.unsolved ? d.heinous / d.unsolved : 0;
    const hue = 188 - heinT * 42;               // shift cyan→amber with heinous share
    return `hsl(${hue}, ${55 + t * 40}%, ${24 + t * 30}%)`;
  };

  const memberPts = (selectedGroup?.members ?? [])
    .filter((m) => m.lat != null && m.lon != null)
    .map((m) => ({ id: m.case_master_id, crime: m.crime_no, station: m.station,
                   xy: proj.project(m.lon as number, m.lat as number) }));
  const cx = memberPts.length ? memberPts.reduce((s, p) => s + p.xy[0], 0) / memberPts.length : 0;
  const cy = memberPts.length ? memberPts.reduce((s, p) => s + p.xy[1], 0) / memberPts.length : 0;

  return (
    <div className={`mapwrap ${tilt ? "tilt" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="kmap" role="img" aria-label="Karnataka crime map">
        <defs>
          <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="pin" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7cffe4" /><stop offset="100%" stopColor="#16b89a" />
          </radialGradient>
        </defs>

        {/* districts */}
        <g className={selectedGroup ? "dimmed" : ""}>
          {proj.features.map((f) => {
            const d = byId.get(f.censuscode);
            const isSel = selectedDistrictId === f.censuscode;
            const active = !!d;
            return (
              <path key={f.censuscode} d={proj.pathFor(f)}
                className={`district ${active ? "on" : "off"} ${isSel ? "sel" : ""}`}
                fill={fillFor(f.censuscode)}
                filter={isSel ? "url(#glow)" : undefined}
                onMouseMove={(e) => {
                  const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({ d: d ?? { district: f.district, district_id: f.censuscode,
                    unsolved: 0, heinous: 0, in_series: 0, n_groups: 0, groups: [], lat: 0, lon: 0 },
                    x: e.clientX - r.left, y: e.clientY - r.top });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => active && onClickDistrict(f.censuscode, d!.district)} />
            );
          })}
        </g>

        {/* pulse rings + count badges on data districts */}
        <g className={selectedGroup ? "dimmed" : ""}>
          {districts.map((d) => {
            const f = proj.features.find((x) => x.censuscode === Number(d.district_id));
            if (!f) return null;
            const [x, y] = proj.centroid(f);
            return (
              <g key={d.district_id} className="badge-g" pointerEvents="none">
                {d.n_groups > 0 && <circle cx={x} cy={y} r={12} className="pulse" />}
                <circle cx={x} cy={y} r={10} className="cbadge" />
                <text x={x} y={y + 3.5} className="ctext">{d.unsolved}</text>
              </g>
            );
          })}
        </g>

        {/* selected group overlay: member cases + links across districts */}
        {selectedGroup && memberPts.length > 1 && (
          <g className="overlay">
            {memberPts.map((p) => (
              <line key={"l" + p.id} x1={cx} y1={cy} x2={p.xy[0]} y2={p.xy[1]} className="glink" />
            ))}
            {memberPts.map((p) => (
              <circle key={p.id} cx={p.xy[0]} cy={p.xy[1]} r={6.5} fill="url(#pin)"
                className="gpin" filter="url(#glow)">
                <title>{p.crime} · {p.station}</title>
              </circle>
            ))}
            <circle cx={cx} cy={cy} r={4} className="gcentroid" />
          </g>
        )}
      </svg>

      {hover?.d && (
        <div className="maptip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          <div className="tt-name">{hover.d.district}</div>
          {hover.d.unsolved > 0 ? (
            <>
              <div className="tt-row"><b>{hover.d.unsolved}</b> unsolved cases</div>
              <div className="tt-row"><b>{hover.d.in_series}</b> in linked groups · {hover.d.n_groups} groups</div>
              <div className="tt-row heinous"><b>{hover.d.heinous}</b> heinous</div>
              <div className="tt-hint">click to open</div>
            </>
          ) : <div className="tt-row muted">no data yet</div>}
        </div>
      )}
    </div>
  );
}
