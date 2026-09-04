import React from "react";
import { Forecast, Group } from "../types";
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
/**
 * The projection, written out the way an officer would say it.
 *
 * A radius and a pair of coordinates is a measurement, not an explanation — you
 * cannot brief a shift from "8.3 km of 14.135, 76.535". This turns the same numbers
 * into a short report: how often this group offends, when the next one is due,
 * and which named stations sit inside the projected area. Stations are worked out
 * by distance from the projected centre, so the places listed are the places the
 * ring actually covers rather than just everywhere the group has ever been.
 */
function narrative(f: Forecast, g: Group | null | undefined,
                   ts: TSFn, ph: PhFn): string[] {
  const zone = f.zone;
  const day = f.likely_day ? ts("fc_r_day", { d: ph(f.likely_day) }) : "";
  const rhythm = ts("fc_r_rhythm", {
    n: f.n_events ?? 0, gap: f.median_gap_days ?? 0,
    lo: f.gap_iqr_days?.[0] ?? 0, hi: f.gap_iqr_days?.[1] ?? 0,
    hours: ph(f.likely_hours), day,
  });

  const tail = f.status === "elapsed" ? ts("fc_r_elapsed")
    : f.status === "open" ? ts("fc_r_open") : ts("fc_r_ahead");
  const when = ts("fc_r_when", {
    a: (f.window_from || "").slice(0, 10), b: (f.window_to || "").slice(0, 10), tail,
  });

  let where: string;
  if (zone && g) {
    // Name only the stations the projected circle actually reaches, worked out by
    // distance from its centre. Listing every station the group ever touched would
    // overstate the area the ring is claiming.
    const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
    const inside = (g.members || [])
      .filter((m) => m.lat != null && m.lon != null)
      .filter((m) => {
        const dLat = rad((m.lat as number) - zone.lat);
        const dLon = rad((m.lon as number) - zone.lon);
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(rad(zone.lat)) * Math.cos(rad(m.lat as number)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(Math.min(1, a))) <= zone.radius_km;
      })
      .map((m) => m.station)
      .filter(Boolean);
    const stations = Array.from(new Set(inside));
    const districts = (g.districts || []).join(", ");
    const km = Math.round(zone.radius_km);
    where = stations.length
      ? ts("fc_r_where", {
          km, districts,
          places: stations.slice(0, 4).join(", ") +
            (stations.length > 4 ? ` +${stations.length - 4}` : ""),
        })
      : ts("fc_r_where_plain", { km, districts });
  } else {
    where = ts("fc_r_nogeo");
  }

  const trust = ts("fc_r_trust", { level: ph(f.confidence_level).toLowerCase() });
  return [rhythm, when, where, trust];
}

export default function ForecastCard({ f, g, t, ts, ph }: {
  f?: Forecast; g?: Group | null; t: TFn; ts: TSFn; ph: PhFn;
}) {
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

      <div className="fc-report">
        <div className="fc-report-h">{ts("fc_r_head")}</div>
        {narrative(f, g, ts, ph).map((para, i) => <p key={i}>{para}</p>)}
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
