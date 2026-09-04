import React from "react";
import { Group, Validation } from "../types";
import { TFn } from "../i18n";

/**
 * Every projection the engine is willing to make, in one place.
 *
 * The forecast used to live inside a single group's case file, which meant you
 * could only see it if you already knew which group to open — the wrong way round
 * for the one question a commander actually asks first: where should I put people
 * next. This ranks all of them, with the back-test sitting at the top so the
 * numbers are read in the light of how often they have actually been right.
 *
 * Windows that are still ahead of the data sort first. An elapsed window is not
 * useless — it is how the method gets audited — but it is not where patrols go.
 */
export default function ForecastPanel({ groups, validation, t, onOpenGroup }: {
  groups: Group[]; validation: Validation | null; t: TFn;
  onOpenGroup: (id: string) => void;
}) {
  const rows = groups
    .filter((g) => g.forecast?.available)
    .map((g) => ({ g, f: g.forecast! }))
    .sort((a, b) => {
      const openA = a.f.status === "open" || a.f.status === "upcoming" ? 0 : 1;
      const openB = b.f.status === "open" || b.f.status === "upcoming" ? 0 : 1;
      if (openA !== openB) return openA - openB;
      return (b.f.confidence ?? 0) - (a.f.confidence ?? 0);
    });

  const bt = validation?.forecast_backtest;
  const nOpen = rows.filter((r) => r.f.status === "open" || r.f.status === "upcoming").length;

  return (
    <div className="fcpanel">
      <div className="leads-head">
        {t("tab_forecast")} <span>— where each group may strike next</span>
      </div>

      {bt && bt.tested > 0 && (
        <div className="fc-trust">
          <div className="fc-trust-h">How often this has been right</div>
          <div className="fc-trust-row">
            <div><b>{Math.round((bt.zone_hit_rate ?? 0) * 100)}%</b><span>area hit</span></div>
            <div><b>{Math.round((bt.window_hit_rate ?? 0) * 100)}%</b><span>window hit</span></div>
            <div><b>{bt.median_timing_error_days}d</b><span>median timing error</span></div>
            <div><b>{bt.tested}</b><span>groups tested</span></div>
          </div>
          <p>
            Each group's last offence was hidden, a projection built from the earlier events
            only, then checked against what actually happened. <b>The area holds up far better
            than the timing</b> — which is why the ring on the map is the part worth acting on,
            not the date.
          </p>
        </div>
      )}

      <div className="fc-count">
        {rows.length} projections · <b>{nOpen} still open</b>
      </div>

      {rows.map(({ g, f }) => {
        const lvl = (f.confidence_level || "Low").toLowerCase();
        const open = f.status === "open" || f.status === "upcoming";
        return (
          <button className={`fcrow ${lvl} ${open ? "open" : ""}`} key={g.series_id}
            onClick={() => onOpenGroup(g.series_id)}>
            <div className="fcrow-top">
              <span className="lead-ser">{g.series_id}</span>
              <b>{g.title}</b>
              <span className={`fcchip ${lvl}`}>{f.confidence_level}</span>
            </div>

            <div className="fcrow-win">
              <span className="k">window</span>
              <span className="v">{(f.window_from || "").slice(0, 10)} → {(f.window_to || "").slice(0, 10)}</span>
              {open
                ? <em className="is-open">still open</em>
                : <em>elapsed in this data</em>}
            </div>

            <div className="fcrow-meta">
              within <b>{f.zone?.radius_km ?? "—"} km</b> · {f.likely_hours} · mostly {f.likely_day}
            </div>
            <div className="fcrow-basis">
              {f.n_events} offences · median gap {f.median_gap_days}d · {g.n_stations} stations
            </div>
          </button>
        );
      })}

      {rows.length === 0 && (
        <div className="empty">No group has enough dated offences to project a pattern yet.</div>
      )}

      <div className="fc-caveat-foot">
        ⚠ These are statistical projections from each group's own rhythm and patch — not
        predictions of a specific crime. Use them to time and place patrols, never as grounds
        for action against a person.
      </div>
    </div>
  );
}
