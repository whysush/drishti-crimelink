import React, { useState } from "react";
import { AlertsResult, Anomaly, AnomalyResult, RiskDistrict } from "../types";

/**
 * Everything currently demanding attention, in one place: categories spiking
 * against their own history, districts carrying the most forward risk, and
 * individual incidents that do not behave like their crime type.
 *
 * Each section states the evidence behind it. A spike built on a baseline of one
 * event per window is labelled as such rather than shouted as a crisis — the
 * fastest way to make an alert panel useless is to let it cry wolf.
 */
type Sub = "spikes" | "risk" | "anomalies";

export default function AlertsPanel({ alerts, risk, anomalies, onDistrict, onPickCase }: {
  alerts: AlertsResult | null; risk: RiskDistrict[]; anomalies: AnomalyResult | null;
  onDistrict: (id: number, name: string) => void; onPickCase: (id: string) => void;
}) {
  const [sub, setSub] = useState<Sub>("spikes");
  const tabs: { id: Sub; label: string; n?: number }[] = [
    { id: "spikes", label: "Spikes", n: alerts?.count },
    { id: "risk", label: "Risk", n: risk.length },
    { id: "anomalies", label: "Anomalies", n: anomalies?.count },
  ];

  return (
    <div className="al">
      <div className="subtabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={sub === x.id}
            className={sub === x.id ? "on" : ""} onClick={() => setSub(x.id)}>
            {x.label}{x.n != null && <em>{x.n}</em>}
          </button>
        ))}
      </div>

      {sub === "spikes" && (alerts ? (
        <>
          <div className="panel-note">
            Counts in the last <b>{alerts.window_days} days</b> against the mean of the six
            preceding windows for the same district and crime type, as a Poisson z-score.
          </div>
          {alerts.spikes.length === 0 && <div className="empty">Nothing above baseline right now.</div>}
          {alerts.spikes.map((s) => (
            <div className={`spike lv-${s.level.toLowerCase()}`} key={s.district + s.crime_type}>
              <div className="spike-top">
                <span className="spike-crime">{s.crime_type}</span>
                <span className="spike-dist">{s.district}</span>
                <span className={`spike-lvl ${s.level.toLowerCase()}`}>{s.level}</span>
              </div>
              <div className="spike-nums">
                <b>{s.recent}</b> now · <span>{s.baseline_mean} avg</span> ·{" "}
                <b className="z">{s.z_score}σ</b>
                {s.change_pct != null && <> · {s.change_pct > 0 ? "+" : ""}{s.change_pct}%</>}
              </div>
              {s.thin_baseline && (
                <div className="spike-thin">
                  baseline is only {s.baseline_events} events over {s.baseline_windows} windows —
                  severity capped, treat as a watch item
                </div>
              )}
            </div>
          ))}
          <div className="gv-sub">Emerging statewide</div>
          {alerts.emerging.slice(0, 6).map((e) => (
            <div className="emg" key={e.crime_type}>
              <span className="emg-c">{e.crime_type}</span>
              <span className={`emg-z ${e.z_score > 0 ? "up" : "down"}`}>
                {e.z_score > 0 ? "▲" : "▼"} {Math.abs(e.z_score)}σ
              </span>
              <span className="emg-n">{e.recent} vs {e.baseline_mean} avg</span>
            </div>
          ))}
        </>
      ) : <div className="empty">Loading…</div>)}

      {sub === "risk" && (
        <>
          <div className="panel-note">
            Forward-looking risk per district. Districts at <b>Critical</b> or <b>High</b> pulse
            red on the map. Every score opens to show what produced it.
          </div>
          {risk.map((r) => <RiskRow key={r.district} r={r} onDistrict={onDistrict} />)}
        </>
      )}

      {sub === "anomalies" && (anomalies ? (
        <>
          <div className="panel-note">
            {anomalies.count} of the archive flagged. {anomalies.method}.
          </div>
          {anomalies.anomalies.map((a) => (
            <AnomalyRow key={a.case_master_id} a={a} onPickCase={onPickCase} />
          ))}
          <p className="ledger-foot">{anomalies.caveat}</p>
        </>
      ) : <div className="empty">Loading…</div>)}
    </div>
  );
}

function RiskRow({ r, onDistrict }: { r: RiskDistrict; onDistrict: (id: number, n: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`risk lv-${r.level.toLowerCase()}`}>
      <button className="risk-top" onClick={() => setOpen((v) => !v)}>
        <span className="risk-d">{r.district}</span>
        <span className={`risk-lvl ${r.level.toLowerCase()}`}>{r.level}</span>
        <span className="risk-n">{r.risk.toFixed(3)}</span>
      </button>
      <div className="risk-bar"><span style={{ width: `${r.risk * 100}%` }} /></div>
      <div className="risk-meta">
        {r.recent_cases} recent vs {r.baseline_mean} avg ({r.trend_z > 0 ? "+" : ""}{r.trend_z}σ) ·{" "}
        {r.hotspots} hotspots · {r.linked_groups} groups
        {r.open_windows > 0 && <span className="risk-open"> · {r.open_windows} open window</span>}
      </div>
      {open && (
        <div className="risk-drv">
          {r.drivers.map((d) => (
            <div className="drv" key={d.factor}>
              <span className="drv-l">{d.factor}</span>
              <span className="drv-bar"><span style={{ width: `${d.value * 100}%` }} /></span>
              <span className="drv-v">{Math.round(d.weight * 100)}%</span>
            </div>
          ))}
          <button className="btn-ghost sm" onClick={() => onDistrict(r.district_id, r.district)}>
            Open {r.district} on the map
          </button>
        </div>
      )}
    </div>
  );
}

function AnomalyRow({ a, onPickCase }: { a: Anomaly; onPickCase: (id: string) => void }) {
  return (
    <button className={`anom lv-${a.level.toLowerCase()}`} onClick={() => onPickCase(a.case_master_id)}>
      <div className="anom-top">
        <span className="c-fir">{a.crime_no}</span>
        <span className="c-type">{a.minor_head}</span>
        <span className={`anom-lvl ${a.level.toLowerCase()}`}>{a.level}</span>
      </div>
      <div className="anom-why">{a.why}</div>
      <div className="anom-meta">
        {a.station} · {a.district} · {(a.incident_from || "").slice(0, 16)}
        {a.undetected && <span className="anom-un"> · unsolved</span>}
      </div>
      <div className="anom-f">
        {a.factors.map((f) => <span key={f.factor}>{f.factor} {f.z}σ</span>)}
      </div>
    </button>
  );
}
