"""
Socio-economic correlation — the "why" behind the "where".

The brief asks for crime overlaid on urbanisation, population and socio-economic
indicators. Two honest constraints shape what this can be:

  1. The FIR schema carries no socio-economic data about places, only about
     individuals. So the population and urbanisation figures below are real
     Karnataka Census 2011 district figures, held here as a small reference table.
     They are the genuine article, not invented numbers, and they are the one part
     of this platform that does not come out of the case data.

  2. The schema DOES record complainant caste and religion. Those fields are
     deliberately never used — not in linkage, not in correlation, not anywhere.
     Occupation is used, because economic role is a legitimate policing variable
     in a way that caste and religion are not, and because the alternative is a
     tool that quietly encodes communal profiling into police work.

Correlation is reported with its sample size and an explicit warning that 19
districts is a small n — a coefficient from nineteen points is a hint about where
to look, never a finding.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict

import numpy as np

# Karnataka, Census of India 2011. population = total district population,
# urban_pct = share living in urban areas, density = persons per sq km,
# literacy_pct = effective literacy rate.
CENSUS = {
    "Bengaluru Urban": {"population": 9621551, "urban_pct": 90.9, "density": 4378, "literacy_pct": 87.7},
    "Bengaluru Rural": {"population": 990923,  "urban_pct": 25.4, "density": 441,  "literacy_pct": 77.9},
    "Ramanagara":      {"population": 1082636, "urban_pct": 24.4, "density": 340,  "literacy_pct": 69.2},
    "Mandya":          {"population": 1805769, "urban_pct": 16.0, "density": 364,  "literacy_pct": 70.4},
    "Mysuru":          {"population": 3001127, "urban_pct": 41.5, "density": 476,  "literacy_pct": 72.8},
    "Chamarajanagar":  {"population": 1020791, "urban_pct": 17.1, "density": 200,  "literacy_pct": 61.4},
    "Tumakuru":        {"population": 2678980, "urban_pct": 22.8, "density": 253,  "literacy_pct": 75.1},
    "Kolar":           {"population": 1536401, "urban_pct": 30.0, "density": 384,  "literacy_pct": 74.4},
    "Chikkaballapura": {"population": 1255104, "urban_pct": 23.3, "density": 297,  "literacy_pct": 69.8},
    "Hassan":          {"population": 1776221, "urban_pct": 21.4, "density": 261,  "literacy_pct": 75.9},
    "Shivamogga":      {"population": 1752753, "urban_pct": 35.7, "density": 207,  "literacy_pct": 80.5},
    "Davanagere":      {"population": 1945497, "urban_pct": 32.3, "density": 329,  "literacy_pct": 75.7},
    "Chitradurga":     {"population": 1659456, "urban_pct": 19.7, "density": 197,  "literacy_pct": 73.7},
    "Belagavi":        {"population": 4779661, "urban_pct": 25.1, "density": 356,  "literacy_pct": 73.5},
    "Dharwad":         {"population": 1847023, "urban_pct": 56.8, "density": 434,  "literacy_pct": 80.0},
    "Kalaburagi":      {"population": 2566326, "urban_pct": 32.9, "density": 233,  "literacy_pct": 64.9},
    "Ballari":         {"population": 2452595, "urban_pct": 37.6, "density": 300,  "literacy_pct": 67.4},
    "Dakshina Kannada":{"population": 2089649, "urban_pct": 47.7, "density": 430,  "literacy_pct": 88.6},
    "Udupi":           {"population": 1177361, "urban_pct": 28.5, "density": 304,  "literacy_pct": 86.2},
}

# Complainant occupation is the one socio-economic variable the FIR itself records.
# Caste and religion are present in the schema and deliberately excluded.
EXCLUDED_FIELDS = ["caste", "religion"]


def _pearson(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    if len(x) < 3 or x.std() == 0 or y.std() == 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def _sig(r, n):
    """Rough two-sided significance for a correlation at this sample size."""
    if r is None or n < 4:
        return None
    if abs(r) >= 0.999:
        return 0.0
    t = abs(r) * math.sqrt((n - 2) / (1 - r * r))
    # normal approximation is adequate for the "is this worth looking at" question
    return round(2 * (1 - 0.5 * (1 + math.erf(t / math.sqrt(2)))), 4)


def correlate(cases, horizon=None):
    """Per-district crime rates against census indicators, plus the occupation mix."""
    agg = defaultdict(lambda: {"total": 0, "undetected": 0, "heinous": 0,
                               "occ": Counter(), "did": None})
    for c in cases:
        d = c.get("district_name")
        if not d:
            continue
        a = agg[d]
        a["did"] = c.get("district_id")
        a["total"] += 1
        if c.get("undetected"):
            a["undetected"] += 1
        if c.get("gravity") == "Heinous":
            a["heinous"] += 1
        for o in (c.get("complainant_occupations") or []):
            a["occ"][o] += 1

    rows = []
    for name, a in agg.items():
        ref = CENSUS.get(name)
        if not ref:
            continue
        pop_lakh = ref["population"] / 100000.0
        rows.append({
            "district": name, "district_id": a["did"],
            "population": ref["population"],
            "urban_pct": ref["urban_pct"], "density": ref["density"],
            "literacy_pct": ref["literacy_pct"],
            "cases": a["total"],
            "rate_per_lakh": round(a["total"] / pop_lakh, 2),
            "undetected": a["undetected"],
            "unsolved_share": round(a["undetected"] / a["total"], 3) if a["total"] else 0,
            "heinous_share": round(a["heinous"] / a["total"], 3) if a["total"] else 0,
            "top_complainant_occupations": [o for o, _ in a["occ"].most_common(3)],
        })
    rows.sort(key=lambda r: -r["rate_per_lakh"])

    n = len(rows)
    pairs = [
        ("urban_pct", "rate_per_lakh", "Urbanisation vs crime rate",
         "Do more urban districts report more crime per capita?"),
        ("density", "rate_per_lakh", "Population density vs crime rate",
         "Does crowding track reported crime?"),
        ("literacy_pct", "rate_per_lakh", "Literacy vs crime rate",
         "A proxy for development, not a cause of anything."),
        ("urban_pct", "unsolved_share", "Urbanisation vs unsolved share",
         "Are urban cases harder to detect?"),
        ("density", "heinous_share", "Density vs heinous share",
         "Does crowding track offence severity?"),
    ]
    correlations = []
    for xk, yk, title, note in pairs:
        r = _pearson([row[xk] for row in rows], [row[yk] for row in rows])
        correlations.append({
            "x": xk, "y": yk, "title": title, "note": note,
            "r": round(r, 3) if r is not None else None,
            "r2": round(r * r, 3) if r is not None else None,
            "p_approx": _sig(r, n),
            "n": n,
            "strength": (None if r is None else
                         "strong" if abs(r) >= 0.7 else
                         "moderate" if abs(r) >= 0.4 else "weak"),
            "direction": (None if r is None else "positive" if r > 0 else "negative"),
        })

    occ_total = Counter()
    for a in agg.values():
        occ_total.update(a["occ"])
    grand = sum(occ_total.values()) or 1

    return {
        "districts": rows,
        "correlations": correlations,
        "occupation_mix": [{"occupation": o, "cases": n_,
                            "share": round(100 * n_ / grand, 1)}
                           for o, n_ in occ_total.most_common()],
        "source": ("District population, urbanisation, density and literacy are "
                   "Census of India 2011 figures for Karnataka. Everything else is "
                   "computed from the FIR data."),
        "excluded": ("Complainant caste and religion are recorded in the FIR schema and "
                     "are deliberately excluded from every analysis in this platform. "
                     "Occupation is used because economic role is a legitimate policing "
                     "variable; community identity is not."),
        "caveat": (f"Correlation over {n} districts is a small sample. These coefficients "
                   "indicate where to look — they are not causal findings, and reported "
                   "crime also reflects reporting behaviour and police capacity, not just "
                   "underlying crime."),
        "data_warning": ("The case data here is SYNTHETIC and was generated with roughly "
                         "even volume per district, while the census figures are real and "
                         "vary enormously — Bengaluru Urban holds nearly ten million people. "
                         "That mismatch alone produces a negative crime-rate-vs-urbanisation "
                         "coefficient, and it is an artefact of the generator, not a finding "
                         "about Karnataka. The method is what is being demonstrated; run it "
                         "on real FIR data and these numbers change completely."),
    }
