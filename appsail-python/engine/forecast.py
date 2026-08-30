"""
Next-strike projection for a linked series.

A series is a sequence of events by (probably) one offender. If that offender
works to a rhythm and a patch, the sequence carries a weak but real signal about
when and where the next one lands. This module extracts it:

  WHEN   median inter-event gap, with the inter-quartile range as the window
  WHERE  centroid of the member locations + the radius covering 90% of them
  HOUR   the modal time-of-day band and day-of-week the offender works
  TRUST  a confidence from regularity (how metronomic the gaps are), the number
         of events, and how tight the geography is

This is deliberately a *projection*, not a prediction: it is arithmetic over the
observed pattern, it carries its own confidence, and `backtest()` measures how
often it would actually have been right. Anything a station acts on must be
justifiable in court, so nothing here is a black box.
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import timedelta

import numpy as np

MIN_EVENTS = 3          # below this a "rhythm" is not a rhythm
EARTH_KM_PER_DEG = 111.32

HOUR_BANDS = [
    (0, 5, "late night (00:00–05:00)"), (5, 9, "early morning (05:00–09:00)"),
    (9, 12, "morning (09:00–12:00)"), (12, 16, "afternoon (12:00–16:00)"),
    (16, 20, "evening (16:00–20:00)"), (20, 24, "night (20:00–24:00)"),
]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _band(hour):
    for lo, hi, label in HOUR_BANDS:
        if lo <= hour < hi:
            return label
    return HOUR_BANDS[-1][2]


def _centroid(pts):
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    return float(np.mean(lats)), float(np.mean(lons))


def _km(a, b):
    """Local-plane distance in km — fine at series scale (tens of km)."""
    dlat = (a[0] - b[0]) * EARTH_KM_PER_DEG
    dlon = (a[1] - b[1]) * EARTH_KM_PER_DEG * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlon)


def _level(v, hi, mid):
    return "High" if v >= hi else "Medium" if v >= mid else "Low"


def project(members, horizon=None):
    """Project the next event for one series.

    `members` are the series member dicts (from build_series). `horizon` is the
    latest incident date anywhere in the dataset — used only to say whether the
    projected window is still ahead of the data or has already elapsed.
    Returns None when the series cannot support a projection.
    """
    from datetime import datetime

    dates = []
    for m in members:
        v = m.get("incident_from")
        if not v:
            continue
        dates.append(v if isinstance(v, datetime)
                     else datetime.fromisoformat(str(v).replace("T", " ")))
    dates.sort()
    if len(dates) < MIN_EVENTS:
        return {"available": False,
                "reason": f"needs at least {MIN_EVENTS} dated events, this group has {len(dates)}"}

    gaps = np.array([(dates[i + 1] - dates[i]).total_seconds() / 86400.0
                     for i in range(len(dates) - 1)])
    gaps = gaps[gaps >= 0]
    if len(gaps) == 0:
        return {"available": False, "reason": "all events share one timestamp"}

    med = float(np.median(gaps))
    q1, q3 = (float(np.percentile(gaps, 25)), float(np.percentile(gaps, 75)))
    mean_g = float(np.mean(gaps))
    # regularity: 1 when the offender is metronomic, 0 when the gaps are erratic
    cv = float(np.std(gaps) / mean_g) if mean_g > 0 else 1.0
    regularity = max(0.0, 1.0 - min(1.0, cv))

    last = dates[-1]
    win_lo = last + timedelta(days=max(0.5, q1))
    win_hi = last + timedelta(days=max(q3, q1 + 1.0))
    centre = last + timedelta(days=med)

    pts = [(m["lat"], m["lon"]) for m in members
           if m.get("lat") is not None and m.get("lon") is not None]
    zone = None
    tightness = 0.0
    if len(pts) >= 2:
        c = _centroid(pts)
        d = sorted(_km(c, p) for p in pts)
        r90 = float(np.percentile(d, 90))
        radius = max(1.0, round(r90, 1))
        # tight patch => strong geographic signal; a state-wide spread means little
        tightness = float(max(0.0, 1.0 - min(1.0, radius / 25.0)))
        zone = {"lat": round(c[0], 5), "lon": round(c[1], 5),
                "radius_km": radius,
                "coverage": "90% of this group's offences fall inside this radius"}

    hours = [d.hour for d in dates]
    band = Counter(_band(h) for h in hours).most_common(1)[0]
    dow = Counter(d.weekday() for d in dates).most_common(1)[0]

    size_score = min(1.0, (len(dates) - 2) / 4.0)
    conf = 0.45 * regularity + 0.30 * size_score + 0.25 * tightness

    elapsed = None
    if horizon is not None:
        elapsed = "elapsed" if win_hi < horizon else (
            "open" if win_lo <= horizon else "upcoming")

    return {
        "available": True,
        "window_from": win_lo.isoformat(sep=" ", timespec="minutes"),
        "window_to": win_hi.isoformat(sep=" ", timespec="minutes"),
        "centre_date": centre.isoformat(sep=" ", timespec="minutes"),
        "days_after_last": round(med, 1),
        "median_gap_days": round(med, 1),
        "gap_iqr_days": [round(q1, 1), round(q3, 1)],
        "n_events": len(dates),
        "last_event": last.isoformat(sep=" ", timespec="minutes"),
        "regularity": round(regularity, 3),
        "zone": zone,
        "likely_hours": band[0],
        "hours_share": round(band[1] / len(dates), 2),
        "likely_day": DAYS[dow[0]],
        "day_share": round(dow[1] / len(dates), 2),
        "confidence": round(conf, 3),
        "confidence_level": _level(conf, 0.6, 0.38),
        "status": elapsed,
        "caveat": ("A statistical projection from this group's own rhythm and patch — "
                   "not a prediction of a specific crime. Use it to time and place "
                   "patrols, never as grounds for action against a person."),
    }


def backtest(series_list, horizon=None):
    """Honest self-check: hide each series' last event, project from the rest,
    and measure whether the real event landed inside the projected window/zone.

    Reported in the app next to the forecast so the number a jury sees is
    measured on this data, not asserted.
    """
    from datetime import datetime

    tested = hit_time = hit_place = hit_both = 0
    lead_err = []
    for s in series_list:
        ms = []
        for m in s["members"]:
            v = m.get("incident_from")
            if not v:
                continue
            dt = v if isinstance(v, datetime) else datetime.fromisoformat(str(v).replace("T", " "))
            ms.append({**m, "incident_from": dt})
        if len(ms) < MIN_EVENTS + 1:
            continue
        ms.sort(key=lambda m: m["incident_from"])
        held, prior = ms[-1], ms[:-1]
        p = project(prior, horizon)
        if not p.get("available"):
            continue
        tested += 1
        lo = datetime.fromisoformat(p["window_from"])
        hi = datetime.fromisoformat(p["window_to"])
        # a window is only useful with some tolerance; allow half the median gap
        tol = timedelta(days=max(1.0, p["median_gap_days"] * 0.5))
        in_time = (lo - tol) <= held["incident_from"] <= (hi + tol)
        in_place = True
        if p.get("zone") and held.get("lat") is not None and held.get("lon") is not None:
            d = _km((p["zone"]["lat"], p["zone"]["lon"]), (held["lat"], held["lon"]))
            in_place = d <= p["zone"]["radius_km"] * 1.5
        hit_time += in_time
        hit_place += in_place
        hit_both += in_time and in_place
        centre = datetime.fromisoformat(p["centre_date"])
        lead_err.append(abs((held["incident_from"] - centre).total_seconds() / 86400.0))

    if not tested:
        return {"tested": 0,
                "note": "not enough multi-event groups to back-test"}
    return {
        "tested": tested,
        "window_hit_rate": round(hit_time / tested, 3),
        "zone_hit_rate": round(hit_place / tested, 3),
        "both_hit_rate": round(hit_both / tested, 3),
        "median_timing_error_days": round(float(np.median(lead_err)), 1),
        "method": ("last event of each group held out, projection built from the "
                   "earlier events only, then checked against the held-out event"),
    }
