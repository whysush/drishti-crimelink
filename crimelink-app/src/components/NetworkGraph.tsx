import React from "react";
import { Group } from "../types";

// Inferred-link graph. Edges are INFERRED (opacity = confidence), never asserted
// facts — the honesty the jury cares about. Circular layout, no deps.
export default function NetworkGraph({ group }: { group: Group }) {
  const W = 420, H = 420, R = 150, cx = W / 2, cy = H / 2;
  const nodes = group.members.map((m, i) => {
    const a = (2 * Math.PI * i) / group.members.length - Math.PI / 2;
    return { id: m.case_master_id, crime: m.crime_no, station: m.station,
             x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const edges = group.edges ?? [];

  return (
    <div className="net">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Link network">
        {edges.map((e, i) => {
          const a = pos.get(e.source), b = pos.get(e.target);
          if (!a || !b) return null;
          return (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              className="edge" strokeWidth={0.5 + e.confidence * 3.5}
              opacity={0.15 + e.confidence * 0.6}>
              <title>{e.source_crime_no} ↔ {e.target_crime_no}
                {"\n"}confidence {(e.confidence * 100).toFixed(0)}% · {e.distance_km} km
                {"\n"}why: {e.why.join(", ")}</title>
            </line>
          );
        })}
        {nodes.map((n) => (
          <g key={n.id} className="node">
            <circle cx={n.x} cy={n.y} r={13} />
            <text x={n.x} y={n.y + 3} textAnchor="middle">{n.crime.slice(-4)}</text>
            <title>{n.crime} · {n.station}</title>
          </g>
        ))}
      </svg>
      <div className="net-legend">
        Edge thickness &amp; opacity = link confidence · {edges.length} inferred links
      </div>
    </div>
  );
}
