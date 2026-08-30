import React from "react";
import { Hotspot } from "../types";

/**
 * Spatiotemporal hotspots.
 *
 * Every row answers "where AND when" in one line, because a hotspot without an
 * hour attached cannot be turned into a patrol roster. The time-share bar shows
 * how concentrated the pattern is: 90% in one band is a shift to staff, 35% is a
 * place that is simply busy.
 */
export default function HotspotsPanel({ hotspots, selected, onSelect, method, scanned }: {
  hotspots: Hotspot[]; selected: string | null;
  onSelect: (id: string | null) => void; method: string; scanned: number;
}) {
  if (!hotspots.length) return <div className="empty">No hotspots detected.</div>;
  return (
    <div className="hs">
      <div className="panel-note">
        Place and time-of-day clustered together across <b>{scanned.toLocaleString()}</b> FIRs —
        solved and unsolved alike, because a hotspot is a policing fact either way.
      </div>

      {hotspots.map((h) => {
        const on = selected === h.hotspot_id;
        return (
          <div className={`hsrow ${on ? "on" : ""} lv-${h.level.toLowerCase()}`} key={h.hotspot_id}
            onClick={() => onSelect(on ? null : h.hotspot_id)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") onSelect(on ? null : h.hotspot_id); }}>
            <div className="hs-top">
              <span className="hs-id">{h.hotspot_id}</span>
              <span className="hs-crime">{h.top_crime}</span>
              <span className={`hs-lvl ${h.level.toLowerCase()}`}>{h.level}</span>
            </div>
            <div className="hs-when">{h.time_band} · mostly {h.peak_day}</div>
            <div className="hs-meta">
              {h.n_cases} offences · {h.undetected} unsolved
              {h.heinous > 0 && <span className="hs-hein"> · {h.heinous} heinous</span>}
              {" · "}within {h.radius_km} km · {h.districts.join(", ")}
            </div>
            <div className="hs-bar" title={`${Math.round(h.time_share * 100)}% fall in this time band`}>
              <span style={{ width: `${h.time_share * 100}%` }} />
            </div>
            <div className="hs-share">
              {Math.round(h.time_share * 100)}% in this time band ·{" "}
              {Math.round(h.crime_share * 100)}% are {h.top_crime}
            </div>

            {on && (
              <div className="hs-detail">
                <div className="hs-stns">{h.stations.join(" · ")}</div>
                {h.sample.map((s) => (
                  <div className="hs-case" key={s.crime_no}>
                    <span className="c-fir">{s.crime_no}</span>
                    <span className="c-type">{s.minor_head}</span>
                    <span className="c-date">{s.incident_from.slice(0, 16)}</span>
                  </div>
                ))}
                <div className="hs-range">
                  {h.date_from.slice(0, 10)} → {h.date_to.slice(0, 10)}
                  {h.recency_days != null && <> · last {h.recency_days} days ago</>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="ledger-foot">{method}.</p>
    </div>
  );
}
