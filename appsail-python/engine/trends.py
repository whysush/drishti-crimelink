"""
Emerging trend alerts and district risk scoring.

The brief asks for a visual warning when a crime category "spikes in a region
compared to historical averages". That phrase hides the hard part: what counts as
a spike when a district registers four burglaries a month and the last month had
seven? Small counts are noisy, and a naive percentage change turns every quiet
district into a screaming red zone.

So spikes are scored with a Poisson z-score against that district-and-category's
own historical baseline, and anything whose baseline is too thin to support a claim
is reported as insufficient evidence rather than dressed up as a trend.

Risk scoring then combines the live signals — recent volume against baseline,
unsolved burden, heinous share, hotspot presence and open linked groups — into one
number per district, which is what drives the red-zone pulse on the map.
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

RECENT_DAYS = 90          # the "now" window
BASELINE_WINDOWS = 6      # how many prior windows form the historical average
MIN_BASELINE_EVENTS = 6   # below this the baseline cannot support a spike claim


def _level(z, baseline_mean=None):
    """Severity, capped by how much history stands behind it.

    A jump from a 1.0 average to 4 is a real Poisson z of 3.0, but calling it
    "Critical" gives a thin baseline the same voice as a well-established one.
    Where the baseline is under ~1.5 events per window, the strongest claim
    available is "Watch" — the pattern is worth an eye, not an alarm.
    """
    lvl = "Critical" if z >= 3.0 else "High" if z >= 2.0 else "Watch" if z >= 1.2 else "Normal"
    if baseline_mean is not None and baseline_mean < 1.5 and lvl in ("Critical", "High"):
        return "Watch"
    return lvl


def _windows(cases, horizon, days, n):
    """Bucket cases into the recent window and the n windows before it."""
    buckets = [defaultdict(int) for _ in range(n + 1)]
    for c in cases:
        d = c.get("incident_from")
        if not d:
            continue
        age = (horizon - d).days
        if age < 0:
            age = 0
        w = age // days
        if w <= n:
            buckets[w][(c.get("district_name"), c.get("minor_head"))] += 1
    return buckets


def spikes(cases, horizon, recent_days=RECENT_DAYS):
    """District x crime-type spikes against that pair's own historical baseline."""
    if horizon is None:
        return []
    buckets = _windows(cases, horizon, recent_days, BASELINE_WINDOWS)
    recent, history = buckets[0], buckets[1:]

    keys = set(recent) | {k for h in history for k in h}
    out = []
    for key in keys:
        district, crime = key
        if not district or not crime:
            continue
        hist = [h.get(key, 0) for h in history]
        total_hist = sum(hist)
        now = recent.get(key, 0)
        if total_hist < MIN_BASELINE_EVENTS or now == 0:
            continue
        mean = total_hist / len(hist)
        # Poisson: variance == mean, so sigma is sqrt(mean). This is the right
        # model for counts of rare independent events and it stops a jump from
        # 1 to 4 reading as louder than 40 to 60.
        sigma = math.sqrt(mean) if mean > 0 else 1.0
        z = (now - mean) / sigma
        if z < 1.2:
            continue
        out.append({
            "district": district, "crime_type": crime,
            "recent": now, "baseline_mean": round(mean, 2),
            "z_score": round(z, 2),
            "change_pct": round(100 * (now - mean) / mean, 1) if mean else None,
            "window_days": recent_days,
            "baseline_windows": len(hist),
            "baseline_events": total_hist,
            "level": _level(z, mean),
            "thin_baseline": mean < 1.5,
            "statement": (f"{crime} in {district}: {now} in the last {recent_days} days "
                          f"against a {round(mean, 1)} average — {round(z, 1)}σ above baseline."),
        })
    out.sort(key=lambda s: -s["z_score"])
    return out


def emerging_typologies(cases, horizon, recent_days=RECENT_DAYS):
    """Statewide: which crime categories are growing fastest right now."""
    if horizon is None:
        return []
    recent, prior = defaultdict(int), defaultdict(int)
    for c in cases:
        d = c.get("incident_from")
        if not d or not c.get("minor_head"):
            continue
        age = (horizon - d).days
        if age < 0:
            age = 0
        if age < recent_days:
            recent[c["minor_head"]] += 1
        elif age < recent_days * (BASELINE_WINDOWS + 1):
            prior[c["minor_head"]] += 1
    out = []
    for crime in set(recent) | set(prior):
        base = prior[crime] / BASELINE_WINDOWS
        now = recent[crime]
        if prior[crime] < MIN_BASELINE_EVENTS:
            continue
        sigma = math.sqrt(base) if base > 0 else 1.0
        z = (now - base) / sigma
        out.append({
            "crime_type": crime, "recent": now, "baseline_mean": round(base, 2),
            "z_score": round(z, 2),
            "change_pct": round(100 * (now - base) / base, 1) if base else None,
            "direction": "rising" if z > 0 else "falling",
        })
    out.sort(key=lambda r: -r["z_score"])
    return out


def district_risk(cases, horizon, hotspot_list, series, recent_days=RECENT_DAYS):
    """One forward-looking risk score per district — what drives the map's red zones.

    Every input is a live measurement, and each district's score ships with the
    breakdown that produced it, because a risk number an officer cannot interrogate
    is a number they are right to ignore.
    """
    agg = defaultdict(lambda: {"total": 0, "recent": 0, "prior": 0, "undetected": 0,
                               "heinous": 0, "did": None})
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
        dt = c.get("incident_from")
        if dt and horizon:
            age = max(0, (horizon - dt).days)
            if age < recent_days:
                a["recent"] += 1
            elif age < recent_days * (BASELINE_WINDOWS + 1):
                a["prior"] += 1

    hs_by_district = defaultdict(list)
    for h in hotspot_list:
        for d in h["districts"]:
            hs_by_district[d].append(h)
    series_by_district = defaultdict(list)
    for s in series:
        for d in s["districts"]:
            series_by_district[d].append(s)

    rows = []
    for name, a in agg.items():
        base = a["prior"] / BASELINE_WINDOWS if a["prior"] else 0.0
        sigma = math.sqrt(base) if base > 0 else 1.0
        trend_z = (a["recent"] - base) / sigma if base > 0 else 0.0
        trend = max(0.0, min(1.0, trend_z / 3.0))

        unsolved_share = a["undetected"] / a["total"] if a["total"] else 0.0
        heinous_share = a["heinous"] / a["total"] if a["total"] else 0.0
        hs = hs_by_district.get(name, [])
        hotspot_pressure = min(1.0, sum(h["intensity"] for h in hs) / 2.0)
        groups = series_by_district.get(name, [])
        # a linked group whose projected window is still open is live exposure
        open_groups = sum(1 for g in groups
                          if (g.get("forecast") or {}).get("status") in ("open", "upcoming"))
        group_pressure = min(1.0, (len(groups) / 4.0) * 0.6 + (open_groups / 2.0) * 0.4)

        score = (0.30 * trend + 0.22 * hotspot_pressure + 0.20 * unsolved_share
                 + 0.16 * group_pressure + 0.12 * heinous_share)
        rows.append({
            "district": name, "district_id": a["did"],
            "risk": round(score, 3),
            "level": "Critical" if score >= 0.6 else "High" if score >= 0.45
                     else "Elevated" if score >= 0.3 else "Normal",
            "trend_z": round(trend_z, 2),
            "recent_cases": a["recent"], "baseline_mean": round(base, 1),
            "total_cases": a["total"], "undetected": a["undetected"],
            "unsolved_share": round(unsolved_share, 3),
            "heinous_share": round(heinous_share, 3),
            "hotspots": len(hs), "linked_groups": len(groups), "open_windows": open_groups,
            "drivers": [
                {"factor": "recent volume vs baseline", "weight": 0.30, "value": round(trend, 3)},
                {"factor": "hotspot pressure", "weight": 0.22, "value": round(hotspot_pressure, 3)},
                {"factor": "unsolved burden", "weight": 0.20, "value": round(unsolved_share, 3)},
                {"factor": "active linked groups", "weight": 0.16, "value": round(group_pressure, 3)},
                {"factor": "heinous share", "weight": 0.12, "value": round(heinous_share, 3)},
            ],
        })
    rows.sort(key=lambda r: -r["risk"])
    return rows
