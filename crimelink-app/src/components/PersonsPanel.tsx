import React, { useState } from "react";
import { Person } from "../types";
import { TFn } from "../i18n";

/**
 * Persons of interest.
 *
 * The FIR schema has no global offender identity, so a name appearing in six FIRs
 * across four stations is six unrelated strings to the database. This panel is the
 * one place the app shows those recurrences — and it says on every card that a
 * name is not an identity, because that is exactly the mistake this view could
 * otherwise invite.
 */
export default function PersonsPanel({ persons, t, onOpenGroup, onPickCase }: {
  persons: Person[]; t: TFn;
  onOpenGroup: (id: string) => void; onPickCase: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [crossOnly, setCrossOnly] = useState(true);
  const list = crossOnly ? persons.filter((p) => p.cross_station) : persons;

  return (
    <div className="ppl">
      <div className="ppl-note">
        The database has no offender ID — an accused is only a name inside one FIR.
        These names recur across <b>separate</b> FIRs, which no single station can see.
        A shared name is <b>not</b> a shared identity; treat every row as a lead to verify.
      </div>

      <label className="ppl-filter">
        <input type="checkbox" checked={crossOnly} onChange={(e) => setCrossOnly(e.target.checked)} />
        Only names crossing station boundaries
        <span className="ppl-count">{list.length}</span>
      </label>

      {list.length === 0 && <div className="empty">No recurring names match this filter.</div>}

      {list.slice(0, 40).map((p) => {
        const isOpen = open === p.person_key;
        return (
          <div className={`poi ${isOpen ? "open" : ""}`} key={p.person_key}>
            <button className="poi-top" onClick={() => setOpen(isOpen ? null : p.person_key)}>
              <span className="poi-name">{p.name}</span>
              <span className={`pridot ${p.priority === "High" ? "high" : p.priority === "Medium" ? "mid" : "low"}`}>
                {p.priority}
              </span>
            </button>
            <div className="poi-meta">
              {t("appears_in")} <b>{p.n_cases}</b> {t("cases")} · <b>{p.n_stations}</b> {t("stations")} ·{" "}
              {p.districts.join(", ")}
              {p.heinous_cases > 0 && <span className="poi-hein"> · {p.heinous_cases} heinous</span>}
            </div>
            <div className="poi-crimes">{p.crime_types.join(" · ")}</div>
            {p.variants.length > 1 && (
              <div className="poi-var">{t("also_spelt")}: {p.variants.filter((v) => v !== p.name).join(", ")}</div>
            )}
            {p.series_ids.length > 0 && (
              <div className="poi-ser">
                {p.series_ids.map((s) => (
                  <button key={s} className="cmd-chip" onClick={() => onOpenGroup(s)}>{s}</button>
                ))}
              </div>
            )}

            {isOpen && (
              <div className="poi-cases">
                {p.cases.map((c) => (
                  <button className="poi-case" key={c.case_master_id}
                    onClick={() => onPickCase(c.case_master_id)}>
                    <span className="c-fir">{c.crime_no}</span>
                    <span className="c-type">{c.minor_head}</span>
                    <span className="c-stn">{c.station}</span>
                    <span className="c-date">{(c.incident_from || "").slice(0, 10)}</span>
                  </button>
                ))}
                <div className="poi-caveat">⚠ {p.caveat}</div>
              </div>
            )}
          </div>
        );
      })}
      {list.length > 40 && <div className="more">+{list.length - 40} {t("more")}…</div>}
    </div>
  );
}
