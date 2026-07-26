import React, { useState } from "react";
import { Group } from "../types";
import NetworkGraph from "./NetworkGraph";

// Evidence view for one linked group — plain language, every case cites a real FIR.
export default function GroupView({
  group, onPickCase, onBack,
}: { group: Group; onPickCase: (id: string) => void; onBack: () => void }) {
  const [showNet, setShowNet] = useState(false);
  const maxC = Math.max(...group.drivers.map((d) => d.contribution), 0.001);

  return (
    <div className="gview">
      <button className="back" onClick={onBack}>‹ back</button>
      <div className="gv-title">{group.title}</div>
      <div className="gv-badges">
        <Pri level={group.priority} />
        <span className="chip2">Match: {group.match_strength}</span>
        {group.gravity === "Heinous" && <span className="chip2 danger">Heinous</span>}
        <span className="chip2 accent">across {group.n_stations} stations</span>
      </div>

      <p className="gv-lede">
        <b>{group.size} unsolved cases</b> that look like the same offender —
        across <b>{group.n_stations} police stations</b> in {group.districts.join(", ")}.
        {group.date_from && <> Between {group.date_from.slice(0, 10)} and {group.date_to?.slice(0, 10)}</>}
        {group.recency_days != null && <>, most recent {group.recency_days} days ago.</>}
      </p>

      {group.weak_name && (
        <div className="gv-weak">
          ⚠ A name — <b>“{group.weak_name.name}”</b> — shows up in {group.weak_name.cases} of{" "}
          {group.weak_name.of} cases. <i>Unconfirmed lead, not proof.</i>
        </div>
      )}

      <div className="gv-sub">Why we linked these</div>
      {group.drivers.map((d) => (
        <div className="drv" key={d.signal}>
          <span className="drv-l">{d.label}</span>
          <span className="drv-bar"><span style={{ width: `${(d.contribution / maxC) * 100}%` }} /></span>
        </div>
      ))}

      <button className="netbtn" onClick={() => setShowNet((v) => !v)}>
        {showNet ? "Hide" : "Show"} link diagram
      </button>
      {showNet && <NetworkGraph group={group} />}

      <div className="gv-sub">The cases (each is a real FIR)</div>
      <div className="cases">
        {group.members.map((m) => (
          <div className="case" key={m.case_master_id} onClick={() => onPickCase(m.case_master_id)}>
            <div className="c-top">
              <span className="c-fir">{m.crime_no}</span>
              <span className="c-stn">{m.station}</span>
              <span className="c-date">{m.incident_from?.slice(0, 16)}</span>
            </div>
            <div className="c-snip">{m.brief_snippet}</div>
            {m.accused_names.length > 0 && (
              <div className="c-name">named suspect: {m.accused_names.join(", ")} <i>(unconfirmed)</i></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Pri({ level }: { level: string }) {
  const cls = level === "High" ? "high" : level === "Medium" ? "mid" : "low";
  return <span className={`pri ${cls}`}>Priority: {level}</span>;
}
