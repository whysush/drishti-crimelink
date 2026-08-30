import React, { useMemo, useState } from "react";
import { Association, GraphEdge, GraphNode, NetworkGraphData } from "../types";

/**
 * The criminological link graph.
 *
 * Four kinds of node — incident, person, station, modus operandi — laid out by a
 * small force simulation run once at render. A library would do this too, but the
 * simulation is twenty lines and shipping a graph engine to draw a few hundred
 * nodes is not a trade worth making.
 *
 * The MO nodes are what make the picture criminological rather than administrative:
 * two people who never appear in the same FIR still end up pulled together when
 * they work the same signature, which is exactly the structure a spreadsheet hides.
 */
const TYPE_COLOR: Record<string, string> = {
  case: "#9c9ca6", person: "#ff4d4d", station: "#5b9dff", mo: "#ff9f1c",
};
const TYPE_R: Record<string, number> = { case: 3.2, person: 7, station: 5, mo: 5.5 };

function layout(nodes: GraphNode[], edges: GraphEdge[], w: number, h: number) {
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  if (!n) return { P: [], idx, deg: [] as number[] };

  // Fruchterman-Reingold. The earlier hand-rolled version sampled repulsion and
  // let it overpower the centering pull, which pinned every node against the
  // clamp and drew a rectangle. FR derives its ideal edge length from the area
  // per node, so attraction and repulsion stay in balance whatever the graph size.
  const area = w * h;
  const k = 0.82 * Math.sqrt(area / n);
  const X = new Float64Array(n), Y = new Float64Array(n);
  const DX = new Float64Array(n), DY = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const a = i * 2.399963;                       // deterministic golden-angle seed
    const r = Math.sqrt((i + 0.5) / n) * Math.min(w, h) * 0.42;
    X[i] = w / 2 + r * Math.cos(a);
    Y[i] = h / 2 + r * Math.sin(a);
  }

  const E = edges
    .map((e) => [idx.get(e.source), idx.get(e.target), e.weight] as [number, number, number])
    .filter((e) => e[0] != null && e[1] != null && e[0] !== e[1]);

  const deg = new Array(n).fill(0);
  E.forEach(([a, b]) => { deg[a]++; deg[b]++; });

  const CUT = k * 3.2;
  const ITER = 150;
  let temp = Math.min(w, h) * 0.14;
  for (let step = 0; step < ITER; step++) {
    DX.fill(0); DY.fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = X[i] - X[j], dy = Y[i] - Y[j];
        let d = Math.hypot(dx, dy);
        // Repulsion cutoff. Without it every node feels a push from all 400-odd
        // others, the sum overwhelms gravity, and the whole graph inflates until
        // it pins against the clamp as a ring. Beyond a few ideal edge lengths
        // the force is noise anyway.
        if (d > CUT) continue;
        if (d < 0.01) { dx = ((i * 13 + j) % 7) - 3; dy = ((i * 7 + j) % 5) - 2; d = 1; }
        const f = (k * k) / d;
        const ux = (dx / d) * f, uy = (dy / d) * f;
        DX[i] += ux; DY[i] += uy;
        DX[j] -= ux; DY[j] -= uy;
      }
    }

    for (const [a, b, wt] of E) {
      let dx = X[a] - X[b], dy = Y[a] - Y[b];
      const d = Math.hypot(dx, dy) || 0.01;
      const f = ((d * d) / k) * (0.5 + wt);
      const ux = (dx / d) * f, uy = (dy / d) * f;
      DX[a] -= ux; DY[a] -= uy;
      DX[b] += ux; DY[b] += uy;
    }

    for (let i = 0; i < n; i++) {
      // gravity keeps disconnected components from drifting to infinity
      DX[i] += (w / 2 - X[i]) * 0.16;
      DY[i] += (h / 2 - Y[i]) * 0.16;
      const d = Math.hypot(DX[i], DY[i]) || 1;
      const lim = Math.min(d, temp);
      X[i] += (DX[i] / d) * lim;
      Y[i] += (DY[i] / d) * lim;
      X[i] = Math.max(10, Math.min(w - 10, X[i]));
      Y[i] = Math.max(10, Math.min(h - 10, Y[i]));
    }
    temp *= 0.965;
  }

  const P = Array.from({ length: n }, (_, i) => ({ x: X[i], y: Y[i] }));
  return { P, idx, deg };
}

export default function NetworkPanel({ g, onOpenGroup }: {
  g: NetworkGraphData | null; onOpenGroup: (id: string) => void;
}) {
  const [show, setShow] = useState<Record<string, boolean>>({
    case: true, person: true, station: false, mo: true,
  });
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [view, setView] = useState<"graph" | "assoc">("graph");

  const W = 440, H = 440;
  const sub = useMemo(() => {
    if (!g) return null;
    const nodes = g.nodes.filter((n) => show[n.type]);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges, ...layout(nodes, edges, W, H) };
  }, [g, show]);

  if (!g) return <div className="empty">Loading the graph…</div>;

  return (
    <div className="net-panel">
      <div className="subtabs" role="tablist">
        <button role="tab" aria-selected={view === "graph"} className={view === "graph" ? "on" : ""}
          onClick={() => setView("graph")}>Graph<em>{g.nodes.length}</em></button>
        <button role="tab" aria-selected={view === "assoc"} className={view === "assoc" ? "on" : ""}
          onClick={() => setView("assoc")}>Associations<em>{g.association_count}</em></button>
      </div>

      {view === "graph" ? (
        <>
          <div className="panel-note">
            {g.counts.case} incidents · {g.counts.person} persons · {g.counts.station} stations ·{" "}
            {g.counts.mo} MO signatures. Showing the {g.capped_at} most structurally
            connected of {g.total_cases} cases.
          </div>

          <div className="netlegend">
            {(["case", "person", "mo", "station"] as const).map((t) => (
              <label key={t} className={show[t] ? "on" : ""}>
                <input type="checkbox" checked={show[t]}
                  onChange={(e) => setShow((s) => ({ ...s, [t]: e.target.checked }))} />
                <i style={{ background: TYPE_COLOR[t] }} />
                {t === "mo" ? "modus operandi" : t}
              </label>
            ))}
          </div>

          <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Entity link graph">
            {sub?.edges.map((e, i) => {
              const a = sub.P[sub.idx.get(e.source) as number];
              const b = sub.P[sub.idx.get(e.target) as number];
              if (!a || !b) return null;
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                className={`ge ge-${e.type}`} strokeWidth={0.4 + e.weight * 1.1} />;
            })}
            {sub?.nodes.map((n, i) => {
              const p = sub.P[i];
              const r = TYPE_R[n.type] * (n.type === "person"
                ? 0.7 + Math.min(1, (n.cases || 1) / 6) * 0.8 : 1);
              return (
                <circle key={n.id} cx={p.x} cy={p.y} r={r}
                  className={`gn gn-${n.type} ${sel?.id === n.id ? "sel" : ""}`}
                  fill={TYPE_COLOR[n.type]}
                  onClick={() => setSel(n)}>
                  <title>{n.label}</title>
                </circle>
              );
            })}
          </svg>

          {sel && (
            <div className="gsel">
              <div className="gsel-t">
                <span className={`gsel-type ${sel.type}`}>{sel.type}</span>
                <b>{sel.label}</b>
              </div>
              {sel.type === "person" && (
                <div className="gsel-b">
                  {sel.cases} cases across {sel.stations} stations · {(sel.districts || []).join(", ")}
                  <div className="gsel-crimes">{(sel.crimes || []).join(" · ")}</div>
                </div>
              )}
              {sel.type === "case" && (
                <div className="gsel-b">
                  {sel.crime} · {sel.station} · {sel.district}
                  <div>{sel.when}{sel.linked && " · in a linked group"}</div>
                </div>
              )}
              {sel.type === "station" && <div className="gsel-b">{sel.cases} cases · {sel.district}</div>}
              {sel.type === "mo" && <div className="gsel-b">a modus-operandi signature</div>}
              <button className="btn-ghost sm" onClick={() => setSel(null)}>close</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="panel-note">
            People <b>never named in the same FIR</b> who nonetheless work the same modus
            operandi in overlapping jurisdictions. This is the association a spreadsheet
            cannot show, because the two names never share a row.
          </div>
          {g.associations.length === 0 && <div className="empty">No associations detected.</div>}
          {g.associations.map((a) => <AssocRow key={a.a_key + a.b_key} a={a} />)}
        </>
      )}
    </div>
  );
}

function AssocRow({ a }: { a: Association }) {
  return (
    <div className={`assoc lv-${a.level.toLowerCase()}`}>
      <div className="assoc-top">
        <b>{a.a}</b><span className="assoc-link">↔</span><b>{a.b}</b>
        <span className={`assoc-lvl ${a.level.toLowerCase()}`}>{a.level}</span>
      </div>
      <div className="assoc-mo">{a.shared_mo.join(" · ")}</div>
      <div className="assoc-meta">
        {a.a_cases} and {a.b_cases} cases
        {a.shared_stations.length > 0 && <> · same station: {a.shared_stations.join(", ")}</>}
        {" · "}{a.shared_districts.join(", ")}
      </div>
      <div className="assoc-caveat">{a.caveat}</div>
    </div>
  );
}
