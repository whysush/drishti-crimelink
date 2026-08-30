import React, { useState } from "react";
import { api, NewFir } from "../api";
import { District, TriageResult } from "../types";
import { TFn } from "../i18n";

/**
 * Live FIR triage — the daily loop.
 *
 * Everything else here looks backwards over the archive. This is the question a
 * station actually asks on a Monday morning: this FIR just came in, is it part of
 * something somebody else is already working?
 *
 * The form is deliberately short. A duty officer has the brief facts, a crime type,
 * a time and a place — nothing else is required, and the engine renormalises around
 * whatever is missing rather than refusing to answer.
 */
const CRIME_TYPES = [
  { id: "10", label: "Chain Snatching" }, { id: "11", label: "House Burglary" },
  { id: "12", label: "Motor Vehicle Theft" }, { id: "13", label: "Robbery" },
  { id: "14", label: "Theft - Other" }, { id: "20", label: "Murder" },
  { id: "21", label: "Hurt" }, { id: "22", label: "Attempt to Murder" },
  { id: "30", label: "Assault on Woman" }, { id: "40", label: "Cheating" },
];

const EXAMPLE = {
  brief_facts:
    "Two men on a motorcycle came up behind a woman walking home in the evening, " +
    "snatched her gold chain and rode off towards the main road before anyone could stop them.",
  minor_head_id: "10",
  incident_from: "2025-05-02T20:40",
  victim_age: "44",
  victim_gender: "F",
  accused: "",
};

export default function TriagePanel({ districts, t, onOpenGroup, onPickCase }: {
  districts: District[]; t: TFn;
  onOpenGroup: (id: string) => void; onPickCase: (id: string) => void;
}) {
  const [facts, setFacts] = useState("");
  const [type, setType] = useState("10");
  const [when, setWhen] = useState("");
  const [distId, setDistId] = useState<string>("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [accused, setAccused] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TriageResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function fillExample() {
    setFacts(EXAMPLE.brief_facts); setType(EXAMPLE.minor_head_id);
    setWhen(EXAMPLE.incident_from); setAge(EXAMPLE.victim_age);
    setGender(EXAMPLE.victim_gender); setAccused(EXAMPLE.accused);
    const bng = districts.find((d) => /Bengaluru Urban/i.test(d.district)) || districts[0];
    if (bng) setDistId(String(bng.district_id));
    setRes(null); setErr(null);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const d = districts.find((x) => String(x.district_id) === distId);
    const fir: NewFir = {
      brief_facts: facts,
      minor_head_id: type,
      lat: d ? d.lat : null,
      lon: d ? d.lon : null,
      incident_from: when,
      act_sections: [],
      victims: age || gender ? [{ age: age ? Number(age) : null, gender }] : [],
      accused_names: accused.trim() ? [accused.trim()] : [],
    };
    try {
      setRes(await api.match(fir));
    } catch {
      setErr("Could not reach the engine. The check needs the API to be up.");
      setRes(null);
    }
    setBusy(false);
  }

  const verdictClass = res
    ? res.matches[0]?.match_level === "High" ? "escalate"
      : res.matches[0]?.match_level === "Medium" ? "review" : "weak"
    : "";

  return (
    <div className="tri">
      <form className="tri-form" onSubmit={run}>
        <label className="tri-l">{t("f_facts")}</label>
        <textarea className="tri-ta" rows={4} value={facts} onChange={(e) => setFacts(e.target.value)}
          placeholder="Describe what happened, in the words of the complaint…" required />

        <div className="tri-row">
          <div>
            <label className="tri-l">{t("f_type")}</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {CRIME_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="tri-l">{t("f_when")}</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
        </div>

        <div className="tri-row">
          <div>
            <label className="tri-l">{t("f_where")}</label>
            <select value={distId} onChange={(e) => setDistId(e.target.value)}>
              <option value="">— select —</option>
              {districts.map((d) => (
                <option key={d.district_id} value={d.district_id}>{d.district}</option>
              ))}
            </select>
          </div>
          <div className="tri-two">
            <div>
              <label className="tri-l">{t("f_victim_age")}</label>
              <input type="number" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
            <div>
              <label className="tri-l">{t("f_victim_gender")}</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">—</option><option value="M">M</option>
                <option value="F">F</option><option value="O">O</option>
              </select>
            </div>
          </div>
        </div>

        <label className="tri-l">{t("f_named")}</label>
        <input value={accused} onChange={(e) => setAccused(e.target.value)}
          placeholder="only if a name was given in the complaint" />
        <div className="tri-hint">
          A name here does not affect the match — identity carries zero weight in linkage.
          It is checked separately and reported as corroboration only.
        </div>

        <div className="tri-actions">
          <button className="btn-primary" disabled={busy || !facts.trim()}>
            {busy ? t("checking") : t("run_check")}
          </button>
          <button type="button" className="btn-ghost" onClick={fillExample}>{t("use_example")}</button>
        </div>
      </form>

      {err && <div className="empty err-inline">{err}</div>}

      {res && (
        <div className="tri-res">
          <div className={`tri-verdict ${verdictClass}`}>{res.verdict}</div>

          {res.matches.map((m) => (
            <div className="tri-m" key={m.series_id}>
              <button className="tri-m-top" onClick={() => onOpenGroup(m.series_id)}>
                <span className="lead-ser">{m.series_id}</span>
                <b>{m.title}</b>
                <span className={`fitbadge ${m.match_level.toLowerCase()}`}>{m.fit_pct}%</span>
              </button>
              <div className="tri-bar">
                <span style={{ width: `${Math.min(100, m.fit_pct)}%` }} className={m.match_level.toLowerCase()} />
              </div>
              <div className="lead-meta">
                {m.size} {t("cases")} · {t("across")} {m.n_stations} {t("stations")} · {m.districts.join(", ")}
              </div>
              <div className="lead-why">{t("linked_by")} {m.top_drivers.join(" · ")}</div>
              <div className="tri-closest">
                closest case{" "}
                <button className="linkish" onClick={() => onPickCase(m.closest_case.case_master_id)}>
                  {m.closest_case.crime_no}
                </button>{" "}
                at {m.closest_case.station}
                {m.closest_case.distance_km != null && <> · {m.closest_case.distance_km} km away</>}
              </div>
              <div className="tri-scale">
                scored against this group's own cohesion of {m.cohesion.toFixed(2)}
              </div>
            </div>
          ))}

          {res.nearest_cases.length > 0 && (
            <>
              <div className="gv-sub">{t("nearest_cases")}</div>
              <div className="cases">
                {res.nearest_cases.map((c) => (
                  <button className="case" key={c.case_master_id} onClick={() => onPickCase(c.case_master_id)}>
                    <div className="c-top">
                      <span className="c-fir">{c.crime_no}</span>
                      <span className="c-stn">{c.station}</span>
                      <span className="c-date">{Math.round(c.score * 100)}%</span>
                    </div>
                    <div className="c-snip">
                      {c.minor_head} · {(c.incident_from || "").slice(0, 10)}
                      {c.distance_km != null && <> · {c.distance_km} km</>}
                      {c.why.length > 0 && <> — {c.why.join(", ")}</>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="tri-caveat">⚠ {res.caveat}</div>
        </div>
      )}
    </div>
  );
}
