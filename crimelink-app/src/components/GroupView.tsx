import React, { useState } from "react";
import { Group } from "../types";
import { TFn, TSFn, SigFn, PhFn } from "../i18n";
import NetworkGraph from "./NetworkGraph";
import Timeline from "./Timeline";
import ForecastCard from "./ForecastCard";
import { Status, STATUSES } from "../workspace";

/**
 * One linked group, as a case file.
 *
 * The header is deliberately shaped like paperwork — an identifier, a
 * classification, then the facts — because that is the form the reader already
 * trusts, and because every number below it has to survive being quoted in one.
 */
export default function GroupView({
  group, t, ts, sig, ph, status, onSetStatus, onPickCase, onBack, onBrief,
}: {
  group: Group; t: TFn; ts: TSFn; sig: SigFn; ph: PhFn; status: Status;
  onSetStatus: (s: Status) => void;
  onPickCase: (id: string) => void; onBack: () => void; onBrief: () => void;
}) {
  const [showNet, setShowNet] = useState(false);
  const maxC = Math.max(...group.drivers.map((d) => d.contribution), 0.001);
  const total = group.drivers.reduce((n, d) => n + d.contribution, 0) || 1;
  const pri = group.priority === "High" ? "hi" : group.priority === "Medium" ? "mid" : "";

  return (
    <div className="gview">
      <button className="back" onClick={onBack}>‹ {t("back")}</button>

      <div className="casefile">
        <div className="casefile-tag">
          <span className="casefile-id">{group.series_id}</span>
          <span>undetected · linked group</span>
          <span className="casefile-cls">{group.gravity === "Heinous" ? "HEINOUS" : "NON-HEINOUS"}</span>
        </div>
        <h1 className="gv-title">{group.title}</h1>
        <div className="gv-badges">
          <span className={pri}>{t("priority")}<b>{ph(group.priority)}</b></span>
          <span>{t("match_label")}<b>{ph(group.match_strength)}</b></span>
          <span>{t("cases")}<b>{group.size}</b></span>
          <span>{t("stations")}<b>{group.n_stations}</b></span>
        </div>
      </div>

      <p className="gv-lede">
        {ts("gv_lede", { n: group.size, s: group.n_stations, d: group.districts.join(", ") })}
        {group.date_from && <> {ts("gv_between", { a: group.date_from.slice(0, 10),
          b: group.date_to?.slice(0, 10) ?? "" })}</>}
        {group.recency_days != null && <>, {ts("gv_recent", { n: group.recency_days })}.</>}
      </p>

      <div className="gv-tools">
        <div className="statuspick" role="group" aria-label="Triage status">
          {STATUSES.map((s) => (
            <button key={s.id} className={`st ${s.id} ${status === s.id ? "on" : ""}`}
              onClick={() => onSetStatus(s.id)} title={s.help}>{ph(s.label)}</button>
          ))}
        </div>
        <button className="btn-ghost sm" onClick={onBrief}>{t("print_brief")}</button>
      </div>

      {group.weak_name && (
        <div className="gv-weak">
          {ts("weak_name", { n: group.weak_name.name, a: group.weak_name.cases,
            b: group.weak_name.of })}
        </div>
      )}

      <ForecastCard f={group.forecast} g={group} t={t} ts={ts} ph={ph} />

      <div className="gv-sub">{t("why_linked")}</div>
      {group.drivers.map((d) => (
        <div className="drv" key={d.signal}>
          <span className="drv-l">{sig(d.signal, d.label)}</span>
          <span className="drv-bar"><span style={{ width: `${(d.contribution / maxC) * 100}%` }} /></span>
          <span className="drv-v">{Math.round((d.contribution / total) * 100)}%</span>
        </div>
      ))}

      <div className="gv-sub">{t("timeline")}</div>
      <Timeline group={group} t={t} ts={ts} onPickCase={onPickCase} />

      <button className="netbtn" onClick={() => setShowNet((v) => !v)}>
        {showNet ? t("hide_net") : t("show_net")}
      </button>
      {showNet && <NetworkGraph group={group} />}

      <div className="gv-sub">{t("the_cases")}</div>
      <div className="cases">
        {group.members.map((m) => (
          <button className="case" key={m.case_master_id} onClick={() => onPickCase(m.case_master_id)}>
            <div className="c-top">
              <span className="c-fir">{m.crime_no}</span>
              <span className="c-stn">{m.station}</span>
              <span className="c-date">{m.incident_from?.slice(0, 16)}</span>
            </div>
            <div className="c-snip">{m.brief_snippet}</div>
            {m.accused_names.length > 0 && (
              <div className="c-name">named: {m.accused_names.join(", ")} <i>({t("unconfirmed")})</i></div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
