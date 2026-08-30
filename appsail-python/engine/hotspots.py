"""
Spatiotemporal hotspots — "crime hotspots" in the sense the brief means.

A map of dots tells you where crime is. It does not tell you *when*, and a patrol
posted at the wrong hour is a patrol wasted. So place and time-of-day are clustered
together in one feature space: two offences belong to the same hotspot when they
happen near each other AND at a similar hour.

Time is encoded on a circle so 23:00 and 01:00 are close (a linear hour number
would put them 22 units apart, which is how naive versions miss the entire
late-night pattern), then scaled into the same units as distance so DBSCAN can
treat them as one geometry.

Runs over ALL FIRs, not just undetected ones — a hotspot is a policing fact
regardless of whether the cases were later solved.
"""
from __future__ import annotations

import math
from collections import Counter

import numpy as np
from sklearn.cluster import DBSCAN

EPS_KM = 2.6              # neighbourhood radius in the combined space
MIN_SAMPLES = 6           # below this it is coincidence, not a hotspot
TIME_SCALE_KM = 5.0       # 12 hours apart costs as much as this many km
EARTH_KM_PER_DEG = 111.32

HOUR_BANDS = [
    (0, 5, "late night (00:00–05:00)"), (5, 9, "early morning (05:00–09:00)"),
    (9, 12, "morning (09:00–12:00)"), (12, 16, "afternoon (12:00–16:00)"),
    (16, 20, "evening (16:00–20:00)"), (20, 24, "night (20:00–24:00)"),
]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _band(h):
    for lo, hi, label in HOUR_BANDS:
        if lo <= h < hi:
            return label
    return HOUR_BANDS[-1][2]


def _km(a, b):
    dlat = (a[0] - b[0]) * EARTH_KM_PER_DEG
    dlon = (a[1] - b[1]) * EARTH_KM_PER_DEG * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlon)


def find(cases, eps_km=EPS_KM, min_samples=MIN_SAMPLES, horizon=None):
    """Cluster all located, dated cases in space x time-of-day."""
    pts = [c for c in cases
           if c.get("lat") is not None and c.get("lon") is not None and c.get("incident_from")]
    if len(pts) < min_samples:
        return []

    lat = np.array([c["lat"] for c in pts])
    lon = np.array([c["lon"] for c in pts])
    lat0 = float(lat.mean())
    # local equirectangular projection — accurate enough at state scale and keeps
    # the units in kilometres so eps means something physical
    x = (lon - float(lon.mean())) * EARTH_KM_PER_DEG * math.cos(math.radians(lat0))
    y = (lat - lat0) * EARTH_KM_PER_DEG

    hours = np.array([c["incident_from"].hour + c["incident_from"].minute / 60.0 for c in pts])
    ang = 2 * math.pi * hours / 24.0
    # radius chosen so that a 12-hour (antipodal) gap equals TIME_SCALE_KM
    r = TIME_SCALE_KM / 2.0
    tx, ty = r * np.cos(ang), r * np.sin(ang)

    X = np.column_stack([x, y, tx, ty])
    labels = DBSCAN(eps=eps_km, min_samples=min_samples).fit_predict(X)

    out = []
    for lab in sorted(set(labels) - {-1}):
        idx = [i for i, l in enumerate(labels) if l == lab]
        members = [pts[i] for i in idx]
        clat = float(np.mean([m["lat"] for m in members]))
        clon = float(np.mean([m["lon"] for m in members]))
        d = sorted(_km((clat, clon), (m["lat"], m["lon"])) for m in members)
        radius = max(0.3, round(float(np.percentile(d, 90)), 2))

        hrs = [m["incident_from"].hour for m in members]
        band, band_n = Counter(_band(h) for h in hrs).most_common(1)[0]
        dow, dow_n = Counter(m["incident_from"].weekday() for m in members).most_common(1)[0]
        crime, crime_n = Counter(m["minor_head"] for m in members if m["minor_head"]).most_common(1)[0]

        dates = sorted(m["incident_from"] for m in members)
        undet = sum(1 for m in members if m.get("undetected"))
        heinous = sum(1 for m in members if m.get("gravity") == "Heinous")
        recency = (horizon - dates[-1]).days if horizon else None

        # how concentrated in time this hotspot is: 1.0 = every offence in one band
        concentration = band_n / len(members)
        # intensity blends size, tightness and temporal focus
        intensity = min(1.0, (len(members) / 25.0)) * 0.45 \
            + max(0.0, 1.0 - radius / 6.0) * 0.30 + concentration * 0.25

        out.append({
            "hotspot_id": f"HS-{len(out) + 1:03d}",
            "lat": round(clat, 5), "lon": round(clon, 5), "radius_km": radius,
            "n_cases": len(members),
            "undetected": undet,
            "heinous": heinous,
            "time_band": band,
            "time_share": round(concentration, 2),
            "peak_day": DAYS[dow],
            "day_share": round(dow_n / len(members), 2),
            "top_crime": crime,
            "crime_share": round(crime_n / len(members), 2),
            "districts": sorted({m["district_name"] for m in members if m["district_name"]}),
            "stations": sorted({m["station_name"] for m in members if m["station_name"]}),
            "date_from": dates[0].isoformat(sep=" ", timespec="minutes"),
            "date_to": dates[-1].isoformat(sep=" ", timespec="minutes"),
            "recency_days": recency,
            "intensity": round(intensity, 3),
            "level": "High" if intensity >= 0.6 else "Medium" if intensity >= 0.38 else "Low",
            "case_ids": [m["case_master_id"] for m in members],
            "sample": [{"crime_no": m["crime_no"], "station": m["station_name"],
                        "minor_head": m["minor_head"],
                        "incident_from": m["incident_from"].isoformat(sep=" ", timespec="minutes")}
                       for m in members[:6]],
        })

    out.sort(key=lambda h: -h["intensity"])
    for i, h in enumerate(out, 1):
        h["hotspot_id"] = f"HS-{i:03d}"
    return out


def by_station(cases):
    """Station-level rollup for district -> station drill-down.

    Stations carry no coordinates in the FIR schema, so each one is placed at the
    centroid of its own cases — which is where its work actually is.
    """
    agg = {}
    for c in cases:
        sid = c.get("police_station_id")
        if not sid:
            continue
        a = agg.setdefault(sid, {
            "station_id": sid, "station": c["station_name"],
            "district": c["district_name"], "district_id": c["district_id"],
            "total": 0, "undetected": 0, "heinous": 0,
            "lats": [], "lons": [], "hours": [], "crimes": Counter(), "dates": [],
        })
        a["total"] += 1
        if c.get("undetected"):
            a["undetected"] += 1
        if c.get("gravity") == "Heinous":
            a["heinous"] += 1
        if c.get("lat") is not None:
            a["lats"].append(c["lat"]); a["lons"].append(c["lon"])
        if c.get("incident_from"):
            a["hours"].append(c["incident_from"].hour)
            a["dates"].append(c["incident_from"])
        if c.get("minor_head"):
            a["crimes"][c["minor_head"]] += 1

    out = []
    for a in agg.values():
        band = Counter(_band(h) for h in a["hours"]).most_common(1)
        top = a["crimes"].most_common(1)
        out.append({
            "station_id": a["station_id"], "station": a["station"],
            "district": a["district"], "district_id": a["district_id"],
            "total": a["total"], "undetected": a["undetected"], "heinous": a["heinous"],
            "clearance_pct": round(100 * (a["total"] - a["undetected"]) / a["total"], 1) if a["total"] else 0,
            "lat": round(float(np.mean(a["lats"])), 5) if a["lats"] else None,
            "lon": round(float(np.mean(a["lons"])), 5) if a["lons"] else None,
            "peak_time": band[0][0] if band else None,
            "top_crime": top[0][0] if top else None,
            "last_incident": max(a["dates"]).isoformat(sep=" ", timespec="minutes") if a["dates"] else None,
        })
    out.sort(key=lambda s: -s["total"])
    return out
