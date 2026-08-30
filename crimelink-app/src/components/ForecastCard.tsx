import React from "react";
import { Forecast } from "../types";
import { TFn, TSFn, PhFn } from "../i18n";

/**
 * Next-strike projection.
 *
 * Presented relative to the last offence ("expected 5–14 days after") as well as
 * in absolute dates, because the relative framing is the part that stays true and
 * useful regardless of how old the case file is.
 *
 * The confidence and the caveat are not fine print — they are the reason a police
 * user can defend acting on this, so they sit in the card, not behind a tooltip.
 */
export default function ForecastCard({ f, t, ts, ph }: { f?: Forecast; t: TFn; ts: TSFn; ph: PhFn }) {
  if (!f) return null;
  if (!f.available) {
    return (
      <div className="fc fc-none">
        <div className="fc-head">{t("forecast_head")}</div>
        <div className="fc-empty">{ts("fc_none")} <i>{f.reason}</i></div>
      </div>
    );
  }

  const lo = f.gap_iqr_days?.[0] ?? 0;
  const hi = f.gap_iqr_days?.[1] ?? 0;
  const conf = Math.round((f.confidence ?? 0) * 100);
  const lvl = (f.confidence_level || "Low").toLowerCase();

  return (
    <div className={`fc fc-${lvl}`}>
      <div className="fc-head">
        {t("forecast_head")}
        <span className={`fc-conf ${lvl}`}>{t("confidence")} {ph(f.confidence_level)} · {conf}%</span>
      </div>

      <div className="fc-lede">
        {ts("fc_lede", { lo, hi, c: f.days_after_last ?? 0 })}
      </div>

      <div className="fc-grid">
        <div className="fc-cell">
          <span className="fc-k">{t("expected_window")}</span>
          <span className="fc-v">{(f.window_from || "").slice(0, 10)} → {(f.window_to || "").slice(0, 10)}</span>
          {f.status === "elapsed" && <span className="fc-note">{ts("fc_elapsed")}</span>}
          {f.status === "open" && <span className="fc-note open">{ts("fc_open")}</span>}
          {f.status === "upcoming" && <span className="fc-note open">{ts("fc_ahead")}</span>}
        </div>
        <div className="fc-cell">
          <span className="fc-k">{t("likely_time")}</span>
          <span className="fc-v">{ph(f.likely_hours)}</span>
          <span className="fc-note">
            {ts("fc_share", { p: Math.round((f.hours_share ?? 0) * 100), d: ph(f.likely_day) })}
          </span>
        </div>
        {f.zone && (
          <div className="fc-cell wide">
            <span className="fc-k">{t("likely_zone")}</span>
            <span className="fc-v">
              {ts("fc_within", { r: f.zone.radius_km,
                                 p: `${f.zone.lat.toFixed(3)}, ${f.zone.lon.toFixed(3)}` })}
            </span>
            <span className="fc-note">{ts("fc_coverage")}</span>
          </div>
        )}
      </div>

      <div className="fc-basis">
        {ts("fc_basis", { n: f.n_events ?? 0, g: f.median_gap_days ?? 0,
                          r: Math.round((f.regularity ?? 0) * 100) })}
      </div>
      <div className="fc-caveat">⚠ {ts("fc_caveat")}</div>
    </div>
  );
}
