import React from "react";
import { Group, UCase } from "../types";
import GroupView from "./GroupView";

export default function RightPanel({
  groups, selectedGroup, districtSel, districtCases, districtGroups,
  onOpenGroup, onPickCase, onBack, onCloseDistrict,
}: {
  groups: Group[];
  selectedGroup: Group | null;
  districtSel: { id: number; name: string } | null;
  districtCases: UCase[];
  districtGroups: Group[];
  onOpenGroup: (id: string) => void;
  onPickCase: (id: string) => void;
  onBack: () => void;
  onCloseDistrict: () => void;
}) {
  if (selectedGroup)
    return <GroupView group={selectedGroup} onPickCase={onPickCase} onBack={onBack} />;

  if (districtSel)
    return (
      <div className="dview">
        <button className="back" onClick={onCloseDistrict}>‹ back to leads</button>
        <div className="dv-title">{districtSel.name}</div>
        <div className="dv-stat">{districtCases.length} unsolved cases · {districtGroups.length} linked groups here</div>

        {districtGroups.length > 0 && <div className="gv-sub">Linked groups in this district</div>}
        {districtGroups.map((g) => (
          <div className="lead sm" key={g.series_id} onClick={() => onOpenGroup(g.series_id)}>
            <div className="lead-top"><span className="lead-ser">{g.series_id}</span><b>{g.title}</b><PriDot level={g.priority} /></div>
            <div className="lead-meta">{g.size} cases · across {g.n_stations} stations</div>
          </div>
        ))}

        <div className="gv-sub">Unsolved cases here</div>
        <div className="dcases">
          {districtCases.slice(0, 60).map((c) => (
            <div className={`dcase ${c.in_series ? "linked" : ""}`} key={c.case_master_id}>
              <span className="c-fir">{c.crime_no}</span>
              <span className="c-type">{c.minor_head}</span>
              {c.gravity === "Heinous" && <span className="c-hein">heinous</span>}
              {c.in_series && <span className="c-link">● in a group</span>}
            </div>
          ))}
          {districtCases.length > 60 && <div className="more">+{districtCases.length - 60} more…</div>}
        </div>
      </div>
    );

  // default: ranked priority leads
  return (
    <div className="leads">
      <div className="leads-head">Priority leads <span>— suspected offender groups</span></div>
      {groups.map((g) => (
        <div className="lead" key={g.series_id} onClick={() => onOpenGroup(g.series_id)}>
          <div className="lead-top">
            <span className="lead-no">{g.group_no}</span>
            <b className="lead-title">{g.title}</b>
            <PriDot level={g.priority} />
          </div>
          <div className="lead-meta"><span className="lead-ser">{g.series_id}</span> · {g.size} cases · across {g.n_stations} stations · {g.districts.join(", ")}</div>
          <div className="lead-why">linked by {g.top_drivers.join(" · ")}</div>
          {g.weak_name && <div className="lead-name">possible suspect: {g.weak_name.name}</div>}
        </div>
      ))}
    </div>
  );
}

function PriDot({ level }: { level: string }) {
  const cls = level === "High" ? "high" : level === "Medium" ? "mid" : "low";
  return <span className={`pridot ${cls}`}>{level}</span>;
}
