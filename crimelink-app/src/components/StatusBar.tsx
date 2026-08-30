import React, { useEffect, useState } from "react";
import { Stats, Validation } from "../types";

/**
 * Status bar.
 *
 * Borrowed from instruments rather than websites: where the data came from, how
 * much of it there is, how accurate the engine currently measures, and a clock.
 * It costs 26 pixels and it is the difference between looking like a demo and
 * looking like something that is running.
 */
export default function StatusBar({ stats, validation, err, base }: {
  stats: Stats | null; validation: Validation | null;
  err: string | null; base: string;
}) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata",
    }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const a = validation?.accuracy;
  const up = !err && !!stats;

  return (
    <footer className="status">
      <span className="status-i">
        <i className={`dot ${up ? "" : "down"}`} />
        ENGINE <b>{up ? "LIVE" : err ? "UNREACHABLE" : "STARTING"}</b>
      </span>
      <span className="status-i">SOURCE <b>{stats?.data_source ?? "—"}</b></span>
      <span className="status-i">
        UNDETECTED <b>{stats ? stats.undetected_cases.toLocaleString() : "—"}</b>
        {" / "}STATIONS <b>{stats?.stations ?? "—"}</b>
        {" / "}DISTRICTS <b>{stats?.districts ?? "—"}</b>
      </span>
      {a && (
        <span className="status-i acc">
          PRECISION <b>{a.precision.toFixed(3)}</b>
          {" · "}RECALL <b>{a.recall.toFixed(3)}</b>
          {" · "}RECOVERED <b>{a.series_recovered}/{a.series_total}</b>
        </span>
      )}
      <span className="status-i">IDENTITY WEIGHT <b>0.00</b></span>
      <span className="status-i right">{base.startsWith("http") ? "DEV" : "CATALYST"} · {clock} IST</span>
    </footer>
  );
}
