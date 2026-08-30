import React from "react";
import { Group } from "../types";
import { TFn, TSFn } from "../i18n";

/**
 * The series as a sequence in time.
 *
 * Events are placed on a real time axis rather than spaced evenly, because the
 * spacing IS the evidence: a regular rhythm is what makes a group look like one
 * offender working, and an accelerating one is what makes it urgent. The
 * projected next window is drawn on the same axis so it reads as a continuation
 * of the pattern rather than a separate claim.
 */
export default function Timeline({ group, t, ts, onPickCase }: {
  group: Group; t: TFn; ts: TSFn; onPickCase: (id: string) => void;
}) {
  const evs = group.members
    .filter((m) => m.incident_from)
    .map((m) => ({ m, ts: new Date(m.incident_from as string).getTime() }))
    .sort((a, b) => a.ts - b.ts);
  if (evs.length < 2) return null;

  const f = group.forecast;
  const t0 = evs[0].ts;
  const tLast = evs[evs.length - 1].ts;
  const fEnd = f?.available && f.window_to ? new Date(f.window_to).getTime() : null;
  const tEnd = Math.max(tLast, fEnd ?? tLast);
  const span = Math.max(1, tEnd - t0);
  const pct = (ts: number) => ((ts - t0) / span) * 100;

  const fLo = f?.available && f.window_from ? pct(new Date(f.window_from).getTime()) : null;
  const fHi = fEnd != null ? pct(fEnd) : null;

  const days = Math.round((tLast - t0) / 86400000);

  return (
    <div className="tl">
      <div className="tl-track">
        <div className="tl-axis" />
        {fLo != null && fHi != null && (
          <div className="tl-forecast" style={{ left: `${fLo}%`, width: `${Math.max(1.5, fHi - fLo)}%` }}
            title="projected next-offence window" />
        )}
        {evs.map(({ m, ts }, i) => (
          <button key={m.case_master_id} className="tl-ev" style={{ left: `${pct(ts)}%` }}
            onClick={() => onPickCase(m.case_master_id)}
            title={`${m.crime_no} · ${m.station} · ${(m.incident_from || "").slice(0, 16)}`}>
            <span className="tl-dot" />
            <span className="tl-n">{i + 1}</span>
          </button>
        ))}
      </div>
      <div className="tl-ends">
        <span>{(evs[0].m.incident_from || "").slice(0, 10)}</span>
        <span className="tl-span">{ts("tl_span", { d: days, n: evs.length })}</span>
        <span>{(evs[evs.length - 1].m.incident_from || "").slice(0, 10)}</span>
      </div>
      {fLo != null && <div className="tl-key"><i className="tl-sw" /> {ts("tl_key")}</div>}
    </div>
  );
}
