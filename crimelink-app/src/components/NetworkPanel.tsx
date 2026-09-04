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

/**
 * Who is connected to whom.
 *
 * The full graph is 434 nodes and 847 edges. In a 500-pixel panel that is confetti:
 * every dot anonymous, the station-to-case cliques shouting loudest, and the one
 * finding that matters - that two people are linked - invisible inside it.
 *
 * So the default view draws only the finding. Twenty-five people, twenty-one
 * inferred associations, every node carrying its name. The full graph stays behind
 * a tab for anyone who wants to audit the structure it came from.
 */
const LEVEL_COLOR: Record<string, string> = {
  High: "#ff4d4d", Medium: "#ff9f1c", Low: "#6b7482",
};

interface PNode { key: string; name: string; cases: number; deg: number; }

function peopleGraph(assocs: Association[]) {
  const byKey = new Map<string, PNode>();
  for (const a of assocs) {
    if (!byKey.has(a.a_key)) byKey.set(a.a_key, { key: a.a_key, name: a.a, cases: a.a_cases, deg: 0 });
    if (!byKey.has(a.b_key)) byKey.set(a.b_key, { key: a.b_key, name: a.b, cases: a.b_cases, deg: 0 });
    byKey.get(a.a_key)!.deg++;
    byKey.get(a.b_key)!.deg++;
  }
  return {
    nodes: Array.from(byKey.values()),
    edges: assocs.map((a) => ({
      source: a.a_key, target: a.b_key, weight: a.strength, level: a.level, assoc: a,
    })),
  };
}

export default function NetworkPanel({ g, onOpenGroup, onShowPerson }: {
  g: NetworkGraphData | null; onOpenGroup: (id: string) => void;
  onShowPerson: (keys: string[], label: string) => void;
}) {
  const [show, setShow] = useState<Record<string, boolean>>({
    case: true, person: true, station: false, mo: true,
  });
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [view, setView] = useState<"people" | "graph" | "assoc">("people");
  const [pSel, setPSel] = useState<string | null>(null);

  const W = 440, H = 440;
  const sub = useMemo(() => {
    if (!g) return null;
    const nodes = g.nodes.filter((n) => show[n.type]);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges, ...layout(nodes, edges, W, H) };
  }, [g, show]);

  const PW = 440, PH = 470;
  const people = useMemo(() => {
    if (!g) return null;
    const { nodes, edges } = peopleGraph(g.associations);
    if (!nodes.length) return { nodes, edges, P: [] as {x:number;y:number}[], idx: new Map<string, number>() };
    const lay = layout(
      nodes.map((n) => ({ id: n.key, type: "person", label: n.name })) as any,
      edges.map((e) => ({ source: e.source, target: e.target, type: "assoc", weight: e.weight })) as any,
      PW, PH - 40);

    // The force layout clamps to a 10px border, which parked whole components on
    // the frame edge with their labels sliced off. Rescaling the finished result
    // into a padded box keeps the shape the simulation found and guarantees every
    // name has room to render, whatever the graph turns out to look like.
    const PAD_X = 52, PAD_T = 16, PAD_B = 30;
    const xs = lay.P.map((q) => q.x), ys = lay.P.map((q) => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = x1 - x0 < 1 ? 1 : (PW - PAD_X * 2) / (x1 - x0);
    const sy = y1 - y0 < 1 ? 1 : (PH - PAD_T - PAD_B) / (y1 - y0);
    const P = lay.P.map((q) => ({
      x: x1 - x0 < 1 ? PW / 2 : PAD_X + (q.x - x0) * sx,
      y: y1 - y0 < 1 ? PH / 2 : PAD_T + (q.y - y0) * sy,
    }));
    return { nodes, edges, P, idx: lay.idx };
  }, [g]);

  if (!g) return <div className="empty">Loading the graph…</div>;

  return (
    <div className="net-panel">
      <div className="subtabs" role="tablist">
        <button role="tab" aria-selected={view === "people"} className={view === "people" ? "on" : ""}
          onClick={() => setView("people")}>People<em>{people ? people.nodes.length : 0}</em></button>
        <button role="tab" aria-selected={view === "assoc"} className={view === "assoc" ? "on" : ""}
          onClick={() => setView("assoc")}>Details<em>{g.association_count}</em></button>
        <button role="tab" aria-selected={view === "graph"} className={view === "graph" ? "on" : ""}
          onClick={() => setView("graph")}>Full network<em>{g.nodes.length}</em></button>
      </div>

      {view === "people" ? (
        <PeopleGraph pg={people} W={PW} H={PH} sel={pSel}
          onSel={(k) => {
            setPSel(k);
            const n = k ? people?.nodes.find((x) => x.key === k) : null;
            if (k && n) onShowPerson([k], n.name); else onShowPerson([], "");
          }} />
      ) : view === "graph" ? (
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
          {g.associations.map((a) => (
            <AssocRow key={a.a_key + a.b_key} a={a}
              onShow={() => onShowPerson([a.a_key, a.b_key], `${a.a} ↔ ${a.b}`)} />
          ))}
        </>
      )}
    </div>
  );
}

function AssocRow({ a, onShow }: { a: Association; onShow: () => void }) {
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
      <button className="assoc-map" onClick={onShow}>◎ Show both on the map</button>
      <div className="assoc-caveat">{a.caveat}</div>
    </div>
  );
}

/**
 * The association graph: people as named nodes, inferred links as edges.
 *
 * Every node is labelled, because an unlabelled dot in a police tool is a dot you
 * have to click to learn anything from — and nobody clicks 400 of them. Node size
 * is the person's case count, edge weight and colour are the strength of the
 * inference, and selecting anyone dims everything they are not connected to, which
 * is the question this view exists to answer.
 */
function PeopleGraph({ pg, W, H, sel, onSel }: {
  pg: { nodes: PNode[]; edges: any[]; P: { x: number; y: number }[]; idx: Map<string, number> } | null;
  W: number; H: number; sel: string | null; onSel: (k: string | null) => void;
}) {
  if (!pg || !pg.nodes.length) {
    return <div className="empty">No associations detected in this data.</div>;
  }

  // who the selected person is directly linked to
  const near = new Set<string>();
  if (sel) {
    near.add(sel);
    for (const e of pg.edges) {
      if (e.source === sel) near.add(e.target);
      if (e.target === sel) near.add(e.source);
    }
  }
  const dim = (k: string) => (sel ? !near.has(k) : false);
  const selected = sel ? pg.nodes.find((n) => n.key === sel) : null;
  const selEdges = sel ? pg.edges.filter((e) => e.source === sel || e.target === sel) : [];

  return (
    <>
      <div className="panel-note">
        <b>{pg.nodes.length} people</b> who appear in separate FIRs but work the same modus
        operandi in overlapping jurisdictions. A line means <b>we think these two are connected</b>
        {" "}— thicker and redder is a stronger inference. Click anyone to isolate their links.
      </div>

      <div className="pg-legend">
        {(["High", "Medium", "Low"] as const).map((l) => (
          <span key={l}><i style={{ background: LEVEL_COLOR[l] }} />{l} confidence</span>
        ))}
        <span className="pg-size"><i className="dotmark" />bigger = more cases</span>
      </div>

      <svg className="pgraph" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Graph of suspected associations between named persons">
        {pg.edges.map((e, i) => {
          const a = pg.P[pg.idx.get(e.source) as number];
          const b = pg.P[pg.idx.get(e.target) as number];
          if (!a || !b) return null;
          const off = sel && !(e.source === sel || e.target === sel);
          return (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={LEVEL_COLOR[e.level] || LEVEL_COLOR.Low}
              strokeWidth={e.level === "High" ? 2.6 : e.level === "Medium" ? 1.8 : 1.1}
              opacity={off ? 0.08 : e.level === "Low" ? 0.5 : 0.85} />
          );
        })}

        {pg.nodes.map((n) => {
          const p = pg.P[pg.idx.get(n.key) as number];
          if (!p) return null;
          const r = 5 + Math.min(1, (n.cases - 1) / 5) * 5;
          const off = dim(n.key);
          return (
            <g key={n.key} className={`pgn ${sel === n.key ? "sel" : ""}`}
              opacity={off ? 0.16 : 1}
              onClick={() => onSel(sel === n.key ? null : n.key)}>
              <circle cx={p.x} cy={p.y} r={r} fill="#ff4d4d"
                stroke={sel === n.key ? "#fff" : "rgba(0,0,0,.45)"}
                strokeWidth={sel === n.key ? 2 : 1} />
              <text x={p.x} y={p.y + r + 10} textAnchor="middle" className="pgl">
                {n.name.length > 17 ? n.name.slice(0, 16) + "…" : n.name}
              </text>
              <title>{n.name} — {n.cases} cases, {n.deg} suspected link{n.deg === 1 ? "" : "s"}</title>
            </g>
          );
        })}
      </svg>

      {selected ? (
        <div className="pgsel">
          <div className="pgsel-h">
            <b>{selected.name}</b>
            <span>{selected.cases} cases · {selEdges.length} suspected link
              {selEdges.length === 1 ? "" : "s"}</span>
            <button className="btn-ghost sm" onClick={() => onSel(null)}>clear</button>
          </div>
          {selEdges.map((e, i) => {
            const other = e.source === sel ? e.assoc.b : e.assoc.a;
            return (
              <div className="pgsel-r" key={i}>
                <span className={`assoc-lvl ${e.level.toLowerCase()}`}>{e.level}</span>
                <b>{other}</b>
                <span className="pgsel-mo">{e.assoc.shared_mo.join(" · ")}</span>
                <span className="pgsel-geo">{e.assoc.shared_districts.join(", ")}</span>
              </div>
            );
          })}
          <div className="pgsel-c">{selEdges[0]?.assoc.caveat}</div>
        </div>
      ) : (
        <div className="pg-hint">
          These are <b>hypotheses to test, not recorded relationships</b>. Two people sharing a
          method and a patch is a reason to look, never a reason to act.
        </div>
      )}
    </>
  );
}
