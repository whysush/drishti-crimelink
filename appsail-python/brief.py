"""
Server-rendered case brief -> PDF via Catalyst SmartBrowz.

The in-browser brief prints fine, but a lead that has to be printed by hand does
not travel. This renders the same document server-side and returns a real PDF, so
it can be attached to a case file, mailed to a station, or produced by the nightly
job without anyone opening the app.

The HTML is deliberately self-contained (inline CSS, no external assets) because
SmartBrowz renders it in an isolated browser with no access to our origin.
"""
from __future__ import annotations

import html
from datetime import datetime

CSS = """
*{box-sizing:border-box}
body{font:12px/1.6 -apple-system,'Segoe UI',Roboto,sans-serif;color:#10131a;margin:0;padding:34px 40px}
h1{font-size:17px;margin:0}
h2{font-size:18px;margin:16px 0 6px}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:#444d63;
   margin:20px 0 7px;border-bottom:1px solid #d7dce6;padding-bottom:4px}
.head{display:flex;justify-content:space-between;align-items:flex-start;
      border-bottom:2px solid #10131a;padding-bottom:10px}
.org{font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:#5a6377}
.meta{font-size:9.5px;color:#5a6377;text-align:right}
table{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:6px}
th{text-align:left;background:#f1f3f8;border:1px solid #d7dce6;padding:5px 7px;
   font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#444d63}
td{border:1px solid #d7dce6;padding:5px 7px}
.mono{font-family:ui-monospace,Menlo,monospace}
.sm{font-size:10px;color:#5a6377;margin-top:5px}
.facts{font-size:10.5px;margin:5px 0;padding-left:9px;border-left:2px solid #d7dce6}
.facts em{color:#8a5a00}
.warn{background:#fbf7ec;border:1px solid #e6d9b6;border-radius:4px;padding:10px 14px;margin-top:18px}
.warn ul{margin:5px 0 0;padding-left:17px}
.warn li{margin:4px 0;font-size:11px}
.sig{display:flex;gap:24px;margin-top:34px}
.sig div{flex:1;font-size:10px;color:#5a6377}
.sig i{display:block;border-bottom:1px solid #10131a;height:26px}
"""


def _e(v):
    return html.escape(str(v if v is not None else "—"))


def render(group: dict) -> str:
    """Build the standalone HTML for one linked group."""
    g = group
    f = g.get("forecast") or {}
    gen = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    rows = "".join(
        f"<tr><td class='mono'>{_e(m.get('crime_no'))}</td><td>{_e(m.get('station'))}</td>"
        f"<td>{_e(m.get('district'))}</td><td>{_e((m.get('incident_from') or '')[:16])}</td>"
        f"<td>{_e(m.get('minor_head'))}</td><td>{_e(m.get('gravity'))}</td></tr>"
        for m in g.get("members", []))

    drivers = "".join(
        f"<tr><td>{_e(d.get('label'))}</td>"
        f"<td>{d.get('contribution', 0) * 100:.1f}%</td></tr>"
        for d in g.get("drivers", []))

    facts = "".join(
        f"<p class='facts'><b class='mono'>{_e(m.get('crime_no'))}</b> — {_e(m.get('brief_snippet'))}"
        + (f" <em>Named in the FIR: {_e(', '.join(m.get('accused_names') or []))} (unconfirmed).</em>"
           if m.get("accused_names") else "")
        + "</p>"
        for m in g.get("members", []))

    weak = ""
    if g.get("weak_name"):
        w = g["weak_name"]
        weak = (f"<h3>Name appearing across cases</h3><p>The name <b>“{_e(w.get('name'))}”</b> is "
                f"recorded in {_e(w.get('cases'))} of {_e(w.get('of'))} cases in this group. "
                f"<b>This is an unconfirmed lead, not proof of identity.</b> It played no part in "
                f"forming this group — identity carries zero weight in linkage.</p>")

    forecast = ""
    if f.get("available"):
        zone = ""
        if f.get("zone"):
            z = f["zone"]
            zone = (f", within <b>{_e(z.get('radius_km'))} km</b> of "
                    f"{z.get('lat'):.3f}, {z.get('lon'):.3f}")
        forecast = (
            f"<h3>Projected next offence</h3><p>On this group's own rhythm, a next offence "
            f"would fall between <b>{_e((f.get('window_from') or '')[:10])}</b> and "
            f"<b>{_e((f.get('window_to') or '')[:10])}</b>{zone}, most likely during "
            f"<b>{_e(f.get('likely_hours'))}</b>, typically on a <b>{_e(f.get('likely_day'))}</b>. "
            f"Confidence <b>{_e(f.get('confidence_level'))}</b>, from {_e(f.get('n_events'))} dated "
            f"offences with a median gap of {_e(f.get('median_gap_days'))} days.</p>"
            f"<p class='sm'>{_e(f.get('caveat'))}</p>")

    dates = ""
    if g.get("date_from"):
        dates = f" between {_e(g['date_from'][:10])} and {_e((g.get('date_to') or '')[:10])}"

    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Case Brief {_e(g.get('series_id'))}</title><style>{CSS}</style></head><body>
<div class="head">
  <div><div class="org">Karnataka State Police</div>
       <h1>Linked Case Brief — {_e(g.get('series_id'))}</h1></div>
  <div class="meta"><div>Generated {gen}</div><div>Drishti · undetected case linkage</div></div>
</div>

<h2>{_e(g.get('title'))}</h2>
<p><b>{_e(g.get('size'))} undetected cases</b> show a consistent pattern suggesting a single
offender or group, across <b>{_e(g.get('n_stations'))} police stations</b> in
{_e(', '.join(g.get('districts') or []))}{dates}. Match strength
<b>{_e(g.get('match_strength'))}</b> (cohesion {g.get('cohesion', 0):.2f}); investigative
priority <b>{_e(g.get('priority'))}</b>.</p>

<h3>Why these cases were linked</h3>
<table><thead><tr><th>Signal</th><th>Contribution</th></tr></thead><tbody>{drivers}</tbody></table>
<p class="sm">Contributions are the weighted share each signal carried across every pair of
cases in this group. Identity carries zero weight — the accused name recorded in an FIR never
influences whether two crimes are linked.</p>

{weak}{forecast}

<h3>Cases in this group</h3>
<table><thead><tr><th>FIR / Crime No.</th><th>Station</th><th>District</th>
<th>Date &amp; time</th><th>Offence</th><th>Gravity</th></tr></thead><tbody>{rows}</tbody></table>

<h3>Brief facts as recorded</h3>{facts}

<div class="warn"><h3 style="border:none;margin-top:0">How to read this brief</h3><ul>
<li>Every link here is <b>inferred</b> from similarity between recorded case features. It is a
direction for investigation, not evidence.</li>
<li>The cases are linked by <b>behaviour</b> — method, place, time, offence type and who was
targeted. No verified identity connects them.</li>
<li>Spatial and temporal closeness can group two unrelated offenders working the same area at
the same hours. Corroborate before acting.</li>
<li>Every case above cites its real FIR number and can be pulled from the record.</li>
</ul></div>

<div class="sig"><div><span>Reviewed by</span><i></i></div>
<div><span>Rank / Unit</span><i></i></div><div><span>Date</span><i></i></div></div>
</body></html>"""
