import React from "react";
import {
  AlertsResult, AnomalyResult, District, Group, Hotspot, NetworkGraphData, Person,
  RiskDistrict, Socio, Station, UCase, Validation,
} from "../types";
import { TFn, TSFn, SigFn, PhFn } from "../i18n";
import { Status, STATUSES } from "../workspace";
import { Nav } from "./Rail";
import HotspotsPanel from "./HotspotsPanel";
import AlertsPanel from "./AlertsPanel";
import NetworkPanel from "./NetworkPanel";
import ForecastPanel from "./ForecastPanel";
import InsightsPanel from "./InsightsPanel";
import GroupView from "./GroupView";
import PersonsPanel from "./PersonsPanel";
import TriagePanel from "./TriagePanel";
import ModelPanel from "./ModelPanel";

/**
 * The dossier. Navigation lives in the rail, so this panel is only ever showing
 * one thing — and its header always says which, plus how much of it there is.
 */
export default function RightPanel({
  nav, groups, selectedGroup, districtSel, districtCases, districtGroups,
  persons, validation, districts, statuses, t, ts, sig, ph, loading,
  hotspots, hotspotMethod, hotspotScanned, selectedHotspot, onSelectHotspot,
  alerts, risk, anomalies, graph, socio, stations,
  onOpenGroup, onShowPerson, onPickCase, onBack, onCloseDistrict, onSetStatus, onBrief, onDistrict,
}: {
  nav: Nav;
  groups: Group[]; selectedGroup: Group | null;
  districtSel: { id: number; name: string } | null;
  districtCases: UCase[]; districtGroups: Group[];
  persons: Person[]; validation: Validation | null; districts: District[];
  statuses: Record<string, Status>; t: TFn; ts: TSFn; sig: SigFn; ph: PhFn;
  loading: boolean;
  onOpenGroup: (id: string) => void;
  onShowPerson: (keys: string[], label: string) => void; onPickCase: (id: string) => void;
  onBack: () => void; onCloseDistrict: () => void;
  onSetStatus: (id: string, s: Status) => void; onBrief: () => void;
  hotspots: Hotspot[]; hotspotMethod: string; hotspotScanned: number;
  selectedHotspot: string | null; onSelectHotspot: (id: string | null) => void;
  alerts: AlertsResult | null; risk: RiskDistrict[]; anomalies: AnomalyResult | null;
  graph: NetworkGraphData | null; socio: Socio | null; stations: Station[];
  onDistrict: (id: number, name: string) => void;
}) {
  const head =
    nav === "hotspots" ? { l: t("hotspots_head"), n: t("hotspots_sub") }
    : nav === "alerts" ? { l: t("alerts_head"), n: t("alerts_sub") }
    : nav === "network" ? { l: t("network_head"), n: t("network_sub") }
    : nav === "insights" ? { l: t("insights_head"), n: t("insights_sub") }
    : nav === "people" ? { l: t("people_head"), n: t("people_sub") }
    : nav === "triage" ? { l: t("triage_head"), n: t("triage_sub") }
    : nav === "model" ? { l: t("model_head"), n: validation ? "measured, not claimed" : "…" }
    : selectedGroup ? { l: "Case file", n: selectedGroup.series_id }
    : districtSel ? { l: "District", n: districtSel.name }
    : { l: t("leads_head"), n: `${groups.length} ${t("kpi_groups")}` };

  return (
    <aside className="dossier">
      <div className="dossier-h">
        <span className="lbl">{head.l}</span>
        <span className="tick">{head.n}</span>
      </div>

      <div className="dossier-b">
        {nav === "people" && (
          <PersonsPanel persons={persons} t={t} onOpenGroup={onOpenGroup} onPickCase={onPickCase} />
        )}
        {nav === "triage" && (
          <TriagePanel districts={districts} t={t} onOpenGroup={onOpenGroup} onPickCase={onPickCase} />
        )}
        {nav === "model" && <ModelPanel v={validation} t={t} />}
        {nav === "hotspots" && (
          <HotspotsPanel hotspots={hotspots} selected={selectedHotspot}
            onSelect={onSelectHotspot} method={hotspotMethod} scanned={hotspotScanned} />
        )}
        {nav === "alerts" && (
          <AlertsPanel alerts={alerts} risk={risk} anomalies={anomalies}
            onDistrict={onDistrict} onPickCase={onPickCase} />
        )}
        {nav === "forecast" && (
          <ForecastPanel groups={groups} validation={validation} t={t} onOpenGroup={onOpenGroup} />
        )}
        {nav === "network" && <NetworkPanel g={graph} onOpenGroup={onOpenGroup}
          onShowPerson={onShowPerson} />}
        {nav === "insights" && <InsightsPanel s={socio} />}

        {nav === "leads" && (
          selectedGroup ? (
            <GroupView group={selectedGroup} t={t} ts={ts} sig={sig} ph={ph}
              status={statuses[selectedGroup.series_id] || "new"}
              onSetStatus={(s) => onSetStatus(selectedGroup.series_id, s)}
              onPickCase={onPickCase} onBack={onBack} onBrief={onBrief} />
          ) : districtSel ? (
            <DistrictView sel={districtSel} cases={districtCases} groups={districtGroups}
              stations={stations} t={t} ts={ts} ph={ph}
              onOpenGroup={onOpenGroup} onClose={onCloseDistrict} />
          ) : loading ? <LeadSkeleton /> : (
            <Leads groups={groups} statuses={statuses} t={t} ts={ts} sig={sig} ph={ph}
              onOpenGroup={onOpenGroup} />
          )
        )}
      </div>
    </aside>
  );
}

function priClass(p: string) {
  return p === "High" ? "high" : p === "Medium" ? "mid" : "low";
}

function Leads({ groups, statuses, t, ts, sig, ph, onOpenGroup }: {
  groups: Group[]; statuses: Record<string, Status>;
  t: TFn; ts: TSFn; sig: SigFn; ph: PhFn; onOpenGroup: (id: string) => void;
}) {
  if (groups.length === 0)
    return (
      <div className="leads">
        <div className="empty">{t("no_leads")}</div>
      </div>
    );
  return (
    <div className="leads">
      {groups.map((g) => {
        const st = statuses[g.series_id] || "new";
        return (
          <div className={`lead p-${priClass(g.priority)} st-${st}`} key={g.series_id}
            onClick={() => onOpenGroup(g.series_id)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") onOpenGroup(g.series_id); }}>
            <div className="lead-top">
              <span className="lead-no">{String(g.group_no).padStart(2, "0")}</span>
              <span className="lead-title">{g.title}</span>
              <span className={`pridot ${priClass(g.priority)}`}>{ph(g.priority)}</span>
            </div>
            <div className="lead-meta">
              <span className="lead-ser">{g.series_id}</span>{" · "}
              {ts("lead_meta", { n: g.size, s: g.n_stations, d: g.districts.join(", ") })}
            </div>
            <div className="lead-why">
              {t("linked_by")}{" "}
              <b>{g.drivers.slice(0, 3).map((d) => sig(d.signal, d.label)).join(" · ")}</b>
            </div>
            <div className="lead-foot">
              {g.forecast?.available && (
                <span className="lead-fc" title="projected next-offence window">
                  ◷ {ts("lead_next", { d: g.forecast.window_from?.slice(0, 10) ?? "",
                    c: ph(g.forecast.confidence_level) })}
                </span>
              )}
              {g.weak_name && <span className="lead-name">{t("possible_suspect")}: {g.weak_name.name}</span>}
              {st !== "new" && (
                <span className={`stbadge ${st}`}>{ph(STATUSES.find((x) => x.id === st)?.label)}</span>
              )}
            </div>
          </div>
        );
      })}
      <p className="ledger-foot">{t("foot")}</p>
    </div>
  );
}

function DistrictView({ sel, cases, groups, stations, t, ts, ph, onOpenGroup, onClose }: {
  sel: { id: number; name: string }; cases: UCase[]; groups: Group[]; stations: Station[];
  t: TFn; ts: TSFn; ph: PhFn;
  onOpenGroup: (id: string) => void; onClose: () => void;
}) {
  const here = stations.filter((s) => s.district_id === sel.id);
  return (
    <div className="dview">
      <button className="back" onClick={onClose}>‹ {t("back")}</button>
      <div className="casefile">
        <div className="casefile-tag">
          <span className="casefile-id">DISTRICT</span>
          <span className="casefile-cls">{cases.length} undetected</span>
        </div>
        <div className="dv-title">{sel.name}</div>
      </div>
      <div className="dv-stat">{cases.length} {t("cases")} · {groups.length} {t("kpi_groups")}</div>

      {groups.length > 0 && <div className="gv-sub">{t("groups_here")}</div>}
      {groups.map((g) => (
        <div className={`lead sm p-${priClass(g.priority)}`} key={g.series_id}
          onClick={() => onOpenGroup(g.series_id)}>
          <div className="lead-top">
            <span className="lead-no">{g.series_id}</span>
            <span className="lead-title">{g.title}</span>
            <span className={`pridot ${priClass(g.priority)}`}>{ph(g.priority)}</span>
          </div>
          <div className="lead-meta">
            {ts("lead_meta", { n: g.size, s: g.n_stations, d: g.districts.join(", ") })}
          </div>
        </div>
      ))}

      {here.length > 0 && (
        <>
          <div className="gv-sub">{t("stations_here")}</div>
          <div className="stns">
            {here.map((s) => (
              <div className="stn" key={s.station_id}>
                <div className="stn-top">
                  <span className="stn-n">{s.station}</span>
                  <span className="stn-c">{s.total}</span>
                </div>
                <div className="stn-bar">
                  <span className="solved" style={{ width: `${s.clearance_pct}%` }} />
                </div>
                <div className="stn-meta">
                  {s.clearance_pct}% cleared · {s.undetected} unsolved
                  {s.peak_time && <> · peak {s.peak_time}</>}
                  {s.top_crime && <> · mostly {s.top_crime}</>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="gv-sub">{t("unsolved_here")}</div>
      <div className="dcases">
        {cases.slice(0, 60).map((c) => (
          <div className={`dcase ${c.in_series ? "linked" : ""}`} key={c.case_master_id}>
            <span className="c-fir">{c.crime_no}</span>
            <span className="c-type">{c.minor_head}</span>
            {c.gravity === "Heinous" && <span className="c-hein">heinous</span>}
            {c.in_series && <span className="c-link">linked</span>}
          </div>
        ))}
        {cases.length > 60 && <div className="more">+{cases.length - 60} {t("more")}…</div>}
      </div>
    </div>
  );
}

function LeadSkeleton() {
  return (
    <div className="leads">
      <div className="sk sk-head" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div className="sk-lead" key={i}>
          <div className="sk sk-t" /><div className="sk sk-m" /><div className="sk sk-w" />
        </div>
      ))}
    </div>
  );
}
