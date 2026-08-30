import React from "react";
import { Group } from "../types";
import { api } from "../api";

/**
 * Printable case brief.
 *
 * A lead that cannot leave the screen does not reach the officer who works it.
 * This renders the whole group as a document the investigator can print or save
 * as PDF from the browser — no service, no network, works in a room with no wifi.
 *
 * It is written to be read by someone who has never seen the app: what the group
 * is, why the engine believes it, every FIR cited in full, and what the method
 * cannot tell them.
 */
export default function CaseBrief({ group, onClose }: { group: Group; onClose: () => void }) {
  const f = group.forecast;
  const generated = new Date().toISOString().slice(0, 16).replace("T", " ");

  return (
    <div className="brief-wrap" role="dialog" aria-label="Case brief">
      <div className="brief-bar no-print">
        {/* Server-rendered PDF via Catalyst SmartBrowz — travels as a file, so a
            brief can be filed or mailed without anyone opening the app. Browser
            print stays as the offline path. */}
        <a className="btn-primary" href={api.briefUrl(group.series_id)}
           target="_blank" rel="noreferrer">Download PDF</a>
        <button className="btn-ghost" onClick={() => window.print()}>Print this page</button>
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <span className="brief-hint">Choose “Save as PDF” in the print dialog to file this with the case.</span>
      </div>

      <div className="brief">
        <header className="brief-head">
          <div>
            <div className="brief-org">Karnataka State Police</div>
            <div className="brief-title">Linked Case Brief — {group.series_id}</div>
          </div>
          <div className="brief-meta">
            <div>Generated {generated}</div>
            <div>Drishti · undetected case linkage</div>
          </div>
        </header>

        <h2>{group.title}</h2>
        <p className="brief-lede">
          <b>{group.size} undetected cases</b> show a consistent pattern suggesting a single
          offender or group, spread across <b>{group.n_stations} police stations</b> in{" "}
          {group.districts.join(", ")}
          {group.date_from && <> between {group.date_from.slice(0, 10)} and {group.date_to?.slice(0, 10)}</>}.
          Match strength <b>{group.match_strength}</b> (cohesion {group.cohesion.toFixed(2)});
          investigative priority <b>{group.priority}</b>.
          {group.gravity === "Heinous" && <> This group includes <b>heinous</b> offences.</>}
        </p>

        <section>
          <h3>Why these cases were linked</h3>
          <table className="brief-t">
            <thead><tr><th>Signal</th><th>Contribution</th></tr></thead>
            <tbody>
              {group.drivers.map((d) => (
                <tr key={d.signal}>
                  <td>{d.label}</td>
                  <td>{(d.contribution * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="brief-sm">
            Contributions are the weighted share each signal carried across every pair of cases
            in this group. Identity carries zero weight — the accused name recorded in an FIR
            never influences whether two crimes are linked.
          </p>
        </section>

        {group.weak_name && (
          <section>
            <h3>Name appearing across cases</h3>
            <p>
              The name <b>“{group.weak_name.name}”</b> is recorded in {group.weak_name.cases} of{" "}
              {group.weak_name.of} cases in this group.
              <b> This is an unconfirmed lead, not proof of identity</b> — the record holds a
              name string, not a verified person. It played no part in forming this group.
            </p>
          </section>
        )}

        {f?.available && (
          <section>
            <h3>Projected next offence</h3>
            <p>
              On this group's own rhythm, a next offence would fall between{" "}
              <b>{f.window_from?.slice(0, 10)}</b> and <b>{f.window_to?.slice(0, 10)}</b>
              {f.zone && <>, within <b>{f.zone.radius_km} km</b> of {f.zone.lat.toFixed(3)}, {f.zone.lon.toFixed(3)}</>}
              , most likely during <b>{f.likely_hours}</b>
              {f.likely_day && <> and typically on a <b>{f.likely_day}</b></>}.
              Confidence <b>{f.confidence_level}</b>, from {f.n_events} dated offences with a
              median gap of {f.median_gap_days} days.
            </p>
            <p className="brief-sm">{f.caveat}</p>
          </section>
        )}

        <section>
          <h3>Cases in this group</h3>
          <table className="brief-t">
            <thead>
              <tr><th>FIR / Crime No.</th><th>Station</th><th>District</th>
                <th>Date &amp; time</th><th>Offence</th><th>Gravity</th></tr>
            </thead>
            <tbody>
              {group.members.map((m) => (
                <tr key={m.case_master_id}>
                  <td className="mono">{m.crime_no}</td>
                  <td>{m.station}</td><td>{m.district}</td>
                  <td>{(m.incident_from || "—").slice(0, 16)}</td>
                  <td>{m.minor_head}</td><td>{m.gravity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3>Brief facts as recorded</h3>
          {group.members.map((m) => (
            <p key={m.case_master_id} className="brief-facts">
              <b className="mono">{m.crime_no}</b> — {m.brief_snippet}
              {m.accused_names.length > 0 && (
                <em> Named in the FIR: {m.accused_names.join(", ")} (unconfirmed).</em>
              )}
            </p>
          ))}
        </section>

        <section className="brief-caution">
          <h3>How to read this brief</h3>
          <ul>
            <li>Every link here is <b>inferred</b> from similarity between recorded case
              features. It is a direction for investigation, not evidence.</li>
            <li>The cases are linked by <b>behaviour</b> — method, place, time, offence type and
              who was targeted. No verified identity connects them.</li>
            <li>Spatial and temporal closeness can group two unrelated offenders working the
              same area at the same hours. Corroborate before acting.</li>
            <li>Every case above cites its real FIR number and can be pulled from the record.</li>
          </ul>
        </section>

        <footer className="brief-foot">
          <div className="sigline"><span>Reviewed by</span><i /></div>
          <div className="sigline"><span>Rank / Unit</span><i /></div>
          <div className="sigline"><span>Date</span><i /></div>
        </footer>
      </div>
    </div>
  );
}
