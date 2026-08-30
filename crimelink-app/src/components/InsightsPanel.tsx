import React from "react";
import { Socio } from "../types";

/**
 * Socio-economic overlay — the "why" behind the "where".
 *
 * This is the one panel whose inputs are not all FIR data: the population,
 * urbanisation, density and literacy figures are real Census 2011 numbers for
 * Karnataka. That provenance is stated on the panel rather than buried, along
 * with the reason the coefficients currently look the way they do.
 *
 * Caste and religion exist in the FIR schema. They are excluded everywhere, and
 * the panel says so out loud — a crime-analytics tool that quietly correlates
 * offending with community identity is not a tool anyone should ship.
 */
export default function InsightsPanel({ s }: { s: Socio | null }) {
  if (!s) return <div className="empty">Loading…</div>;
  const maxRate = Math.max(...s.districts.map((d) => d.rate_per_lakh), 1);

  return (
    <div className="ins">
      <div className="warn-block">
        <div className="warn-h">Read this before the numbers</div>
        {s.data_warning}
      </div>

      <div className="gv-sub">Correlations</div>
      {s.correlations.map((c) => (
        <div className="corr" key={c.title}>
          <div className="corr-top">
            <span className="corr-t">{c.title}</span>
            <span className={`corr-r ${c.strength || ""}`}>
              r = {c.r != null ? c.r.toFixed(3) : "—"}
            </span>
          </div>
          <div className="corr-scale">
            <i className="corr-zero" />
            {c.r != null && (
              <span className={`corr-fill ${c.r < 0 ? "neg" : "pos"}`}
                style={{ width: `${Math.abs(c.r) * 50}%`,
                         left: c.r < 0 ? `${50 - Math.abs(c.r) * 50}%` : "50%" }} />
            )}
          </div>
          <div className="corr-meta">
            {c.strength} {c.direction} · n = {c.n}
            {c.p_approx != null && <> · p ≈ {c.p_approx}</>}
            {c.r2 != null && <> · explains {Math.round(c.r2 * 100)}% of variance</>}
          </div>
          <div className="corr-note">{c.note}</div>
        </div>
      ))}

      <div className="gv-sub">District profile</div>
      <div className="sociotable">
        <div className="st-head">
          <span>District</span><span>Rate /lakh</span><span>Urban %</span><span>Unsolved</span>
        </div>
        {s.districts.map((d) => (
          <div className="st-row" key={d.district}>
            <span className="st-d">{d.district}</span>
            <span className="st-bar">
              <i style={{ width: `${(d.rate_per_lakh / maxRate) * 100}%` }} />
              <b>{d.rate_per_lakh}</b>
            </span>
            <span className="st-u">{d.urban_pct}%</span>
            <span className="st-s">{Math.round(d.unsolved_share * 100)}%</span>
          </div>
        ))}
      </div>

      <div className="gv-sub">Who reports crime</div>
      <div className="occ">
        {s.occupation_mix.slice(0, 8).map((o) => (
          <div className="occ-r" key={o.occupation}>
            <span className="occ-n">{o.occupation}</span>
            <span className="occ-bar"><i style={{ width: `${o.share * 4}%` }} /></span>
            <span className="occ-v">{o.share}%</span>
          </div>
        ))}
      </div>

      <div className="excl-block">
        <div className="warn-h">Deliberately excluded</div>
        {s.excluded}
      </div>
      <p className="ledger-foot">{s.source} {s.caveat}</p>
    </div>
  );
}
