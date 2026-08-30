"""
Case brief as a real PDF, generated in-process.

SmartBrowz is the preferred renderer — it is the Catalyst-native service for this
and it renders the same HTML the browser shows. But it has to be enabled on the
project, and an export that only works once someone visits a console is not an
export. So this builds the document directly with fpdf2 (pure Python, installs on
the managed runtime with no native deps) and the endpoint prefers SmartBrowz,
falling back here.

The layout mirrors the HTML brief deliberately: an investigator should not be able
to tell which renderer produced the file in their hand.
"""
from __future__ import annotations

from datetime import datetime

from fpdf import FPDF

INK = (16, 19, 26)
MUTED = (90, 99, 119)
RULE = (215, 220, 230)
HEAD_BG = (241, 243, 248)
WARN_BG = (251, 247, 236)
WARN_LINE = (230, 217, 182)


# The core PDF fonts are Latin-1 only. Anything outside it becomes "?" unless it is
# transliterated first, and a brief peppered with "?" reads as a broken document.
_SUBS = str.maketrans({
    "\u2014": "-", "\u2013": "-", "\u2212": "-",          # em / en dash, minus
    "\u2018": "'", "\u2019": "'", "\u201a": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"',
    "\u2026": "...", "\u00b7": "-", "\u2022": "-",        # ellipsis, middots
    "\u2192": "->", "\u2190": "<-", "\u00a0": " ",
    "\u20b9": "Rs.", "\u2032": "'", "\u2033": '"',
})


def _s(v):
    """Latin-1 safe text, transliterating the typography we actually emit."""
    if v is None:
        return "-"
    return str(v).translate(_SUBS).encode("latin-1", "replace").decode("latin-1")


class Brief(FPDF):
    def __init__(self, series_id):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.series_id = series_id
        self.set_auto_page_break(auto=True, margin=16)
        self.set_margins(16, 14, 16)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*MUTED)
        self.cell(0, 4, _s(f"Karnataka State Police - Confidential - {self.series_id}"),
                  align="L")
        self.cell(0, 4, _s(f"Page {self.page_no()}"), align="R")

    # -- building blocks ---------------------------------------------------
    def h3(self, text):
        self.ln(3)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 5, _s(text.upper()), new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*RULE)
        y = self.get_y()
        self.line(16, y, 194, y)
        self.ln(2)

    def para(self, text, size=9, style="", color=INK):
        self.set_font("Helvetica", style, size)
        self.set_text_color(*color)
        self.multi_cell(0, 4.4, _s(text), new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def table(self, headers, rows, widths):
        self.set_font("Helvetica", "B", 7)
        self.set_fill_color(*HEAD_BG)
        self.set_text_color(*MUTED)
        self.set_draw_color(*RULE)
        for h, w in zip(headers, widths):
            self.cell(w, 6, _s(h.upper()), border=1, align="L", fill=True)
        self.ln()
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(*INK)
        for r in rows:
            # keep a row intact across a page break
            if self.get_y() > 265:
                self.add_page()
            for v, w in zip(r, widths):
                txt = _s(v)
                while self.get_string_width(txt) > w - 2 and len(txt) > 4:
                    txt = txt[:-2]
                self.cell(w, 5.5, txt, border=1, align="L")
            self.ln()
        self.ln(2)


def render(group: dict) -> bytes:
    g = group
    f = g.get("forecast") or {}
    pdf = Brief(g.get("series_id", ""))
    pdf.add_page()

    # header
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.cell(120, 4, _s("KARNATAKA STATE POLICE"))
    pdf.cell(0, 4, _s(f"Generated {datetime.utcnow():%Y-%m-%d %H:%M} UTC"), align="R")
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(*INK)
    pdf.cell(120, 6, _s(f"Linked Case Brief - {g.get('series_id')}"))
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 6, _s("Drishti - undetected case linkage"), align="R")
    pdf.ln(8)
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.5)
    pdf.line(16, pdf.get_y(), 194, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(*INK)
    pdf.multi_cell(0, 6, _s(g.get("title")), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)

    dates = ""
    if g.get("date_from"):
        dates = f" between {g['date_from'][:10]} and {(g.get('date_to') or '')[:10]}"
    pdf.para(
        f"{g.get('size')} undetected cases show a consistent pattern suggesting a single "
        f"offender or group, across {g.get('n_stations')} police stations in "
        f"{', '.join(g.get('districts') or [])}{dates}. Match strength "
        f"{g.get('match_strength')} (cohesion {g.get('cohesion', 0):.2f}); investigative "
        f"priority {g.get('priority')}."
        + (" This group includes heinous offences." if g.get("gravity") == "Heinous" else ""))

    pdf.h3("Why these cases were linked")
    pdf.table(["Signal", "Contribution"],
              [[d.get("label"), f"{d.get('contribution', 0) * 100:.1f}%"]
               for d in g.get("drivers", [])], [130, 48])
    pdf.para("Contributions are the weighted share each signal carried across every pair "
             "of cases in this group. Identity carries zero weight - the accused name "
             "recorded in an FIR never influences whether two crimes are linked.",
             size=7.5, color=MUTED)

    if g.get("weak_name"):
        w = g["weak_name"]
        pdf.h3("Name appearing across cases")
        pdf.para(f"The name \"{w.get('name')}\" is recorded in {w.get('cases')} of "
                 f"{w.get('of')} cases in this group. This is an unconfirmed lead, not "
                 f"proof of identity. It played no part in forming this group.")

    if f.get("available"):
        pdf.h3("Projected next offence")
        zone = ""
        if f.get("zone"):
            z = f["zone"]
            zone = f", within {z.get('radius_km')} km of {z.get('lat'):.3f}, {z.get('lon'):.3f}"
        pdf.para(
            f"On this group's own rhythm, a next offence would fall between "
            f"{(f.get('window_from') or '')[:10]} and {(f.get('window_to') or '')[:10]}{zone}, "
            f"most likely during {f.get('likely_hours')}, typically on a {f.get('likely_day')}. "
            f"Confidence {f.get('confidence_level')}, from {f.get('n_events')} dated offences "
            f"with a median gap of {f.get('median_gap_days')} days.")
        pdf.para(f.get("caveat"), size=7.5, color=MUTED)

    pdf.h3("Cases in this group")
    pdf.table(["FIR / Crime No.", "Station", "District", "Date & time", "Offence", "Gravity"],
              [[m.get("crime_no"), m.get("station"), m.get("district"),
                (m.get("incident_from") or "")[:16], m.get("minor_head"), m.get("gravity")]
               for m in g.get("members", [])],
              [40, 32, 27, 30, 27, 22])

    pdf.h3("Brief facts as recorded")
    for m in g.get("members", []):
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.set_text_color(*INK)
        pdf.cell(0, 4, _s(m.get("crime_no")), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 7.5)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(0, 3.8, _s(m.get("brief_snippet")), new_x="LMARGIN", new_y="NEXT")
        if m.get("accused_names"):
            pdf.set_font("Helvetica", "I", 7)
            pdf.multi_cell(0, 3.6, _s(f"Named in the FIR: {', '.join(m['accused_names'])} "
                                      f"(unconfirmed)."), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

    if pdf.get_y() > 215:
        pdf.add_page()
    pdf.h3("How to read this brief")
    pdf.set_fill_color(*WARN_BG)
    pdf.set_draw_color(*WARN_LINE)
    start = pdf.get_y()
    pdf.ln(2)
    for line in [
        "Every link here is inferred from similarity between recorded case features. "
        "It is a direction for investigation, not evidence.",
        "The cases are linked by behaviour - method, place, time, offence type and who "
        "was targeted. No verified identity connects them.",
        "Spatial and temporal closeness can group two unrelated offenders working the "
        "same area at the same hours. Corroborate before acting.",
        "Every case above cites its real FIR number and can be pulled from the record.",
    ]:
        pdf.set_font("Helvetica", "", 7.5)
        pdf.set_text_color(*INK)
        pdf.set_x(20)
        pdf.multi_cell(170, 3.9, _s("- " + line), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(0.6)
    pdf.rect(16, start, 178, pdf.get_y() - start + 2)
    pdf.ln(6)

    # signature block
    y = pdf.get_y()
    pdf.set_draw_color(*INK)
    for i, label in enumerate(["Reviewed by", "Rank / Unit", "Date"]):
        x = 16 + i * 60
        pdf.line(x, y + 10, x + 52, y + 10)
        pdf.set_xy(x, y + 10)
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(*MUTED)
        pdf.cell(52, 4, _s(label))

    return bytes(pdf.output())
