"""
Anomaly detection — incidents that do not behave like their own crime type.

The useful question is not "which case is unusual overall" (that just returns
whatever is rarest), but "which case is unusual *for what it claims to be*". A
burglary at 3pm in a district where burglaries happen at 2am is the signal an
investigator wants; a murder being rarer than a theft is not.

So every case is scored against the profile of its own crime type: hour of day,
reporting delay, victim age, and how isolated it is geographically from other
offences of that type. Each contributing factor is reported, because "this is
anomalous" is useless without "and here is which part of it".
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

MIN_GROUP = 12            # below this a crime type has no profile to deviate from
# Skewed metrics (reporting delay, geographic isolation) have long right tails, so a
# MAD-based z-score fires on ordinary tail values and flags a quarter of the archive.
# A percentile gate sets the false-positive rate directly: only the top slice of a
# crime type's own distribution can raise a flag, whatever the shape of that
# distribution. The z-score is kept purely to express *how* extreme.
TAIL_Q = 97.5
EARTH_KM_PER_DEG = 111.32


def _circ_dist_hours(a, b):
    d = abs(a - b) % 24
    return min(d, 24 - d)


def _mad(xs):
    """Median absolute deviation — robust where a mean would be dragged by the
    very outliers we are trying to find."""
    if len(xs) == 0:
        return 0.0
    med = float(np.median(xs))
    return float(np.median(np.abs(np.asarray(xs) - med))) or 0.0


def detect(cases, horizon=None, limit=40):
    groups = defaultdict(list)
    for c in cases:
        if c.get("minor_head"):
            groups[c["minor_head"]].append(c)

    scored = []
    for crime, members in groups.items():
        if len(members) < MIN_GROUP:
            continue

        hours = [m["incident_from"].hour + m["incident_from"].minute / 60.0
                 for m in members if m.get("incident_from")]
        med_h = float(np.median(hours)) if hours else None
        mad_h = _mad([_circ_dist_hours(h, med_h) for h in hours]) if hours else 0.0

        delays = [m["reporting_delay_h"] for m in members if m.get("reporting_delay_h") is not None]
        med_d = float(np.median(delays)) if delays else None
        mad_d = _mad(delays) if delays else 0.0

        ages = [v["age"] for m in members for v in (m.get("victims") or []) if v.get("age")]
        med_a = float(np.median(ages)) if ages else None
        mad_a = _mad(ages) if ages else 0.0

        # Geographic isolation, measured against the NEAREST other offence of the
        # same type — not against a statewide centroid. Burglaries happen in every
        # district, so distance-from-centroid flags half the state as anomalous;
        # "the nearest other burglary is 300 km away" is the real outlier signal.
        geo = [m for m in members if m.get("lat") is not None]
        nn = {}
        if len(geo) >= 3:
            glat = np.array([m["lat"] for m in geo])
            glon = np.array([m["lon"] for m in geo])
            cosf = math.cos(math.radians(float(glat.mean())))
            gx = glon * EARTH_KM_PER_DEG * cosf
            gy = glat * EARTH_KM_PER_DEG
            D = np.hypot(gx[:, None] - gx[None, :], gy[:, None] - gy[None, :])
            np.fill_diagonal(D, np.inf)
            for m, dmin in zip(geo, D.min(axis=1)):
                nn[m["case_master_id"]] = float(dmin)
        nn_vals = list(nn.values())
        med_km = float(np.median(nn_vals)) if nn_vals else None
        mad_km = _mad(nn_vals) if nn_vals else 0.0
        q_nn = float(np.percentile(nn_vals, TAIL_Q)) if len(nn_vals) >= 20 else None
        q_delay = float(np.percentile(delays, TAIL_Q)) if len(delays) >= 20 else None

        for m in members:
            factors = []

            if med_h is not None and m.get("incident_from") and mad_h > 0.4:
                h = m["incident_from"].hour + m["incident_from"].minute / 60.0
                z = _circ_dist_hours(h, med_h) / (1.4826 * mad_h)
                if z >= 2.5:
                    factors.append({"factor": "time of day", "z": round(z, 2),
                                    "detail": f"{m['incident_from'].strftime('%H:%M')} — "
                                              f"{crime} in this data centres on "
                                              f"{int(med_h):02d}:00"})

            if (med_d is not None and m.get("reporting_delay_h") is not None
                    and mad_d > 0.5 and q_delay is not None
                    and m["reporting_delay_h"] > q_delay):
                z = abs(m["reporting_delay_h"] - med_d) / (1.4826 * mad_d)
                if z >= 2.5:
                    factors.append({"factor": "reporting delay", "z": round(z, 2),
                                    "detail": f"{round(m['reporting_delay_h'], 1)}h to reach the "
                                              f"station against a {round(med_d, 1)}h norm"})

            v_ages = [v["age"] for v in (m.get("victims") or []) if v.get("age")]
            if med_a is not None and v_ages and mad_a > 0.5:
                z = abs(float(np.mean(v_ages)) - med_a) / (1.4826 * mad_a)
                if z >= 2.5:
                    factors.append({"factor": "victim age", "z": round(z, 2),
                                    "detail": f"victim aged {int(np.mean(v_ages))} against a "
                                              f"typical {int(med_a)}"})

            d = nn.get(m["case_master_id"])
            if (med_km is not None and d is not None and mad_km > 0.5
                    and q_nn is not None and d > q_nn):
                # one-sided: being unusually CLOSE to another offence is a cluster,
                # not an anomaly — only isolation counts
                z = (d - med_km) / (1.4826 * mad_km)
                if z >= 3.0:
                    factors.append({"factor": "isolation", "z": round(z, 2),
                                    "detail": f"nearest other {crime} is {round(d)} km away, "
                                              f"against a {round(med_km)} km norm"})

            # An anomaly worth an investigator's time is either odd in more than one
            # way, or extremely odd in one. Anything less is ordinary variation, and a
            # detector that flags 40% of the archive has told nobody anything.
            if not factors or (len(factors) < 2 and max(f["z"] for f in factors) < 4.5):
                continue
            score = min(1.0, sum(f["z"] for f in factors) / 12.0)
            factors.sort(key=lambda f: -f["z"])
            scored.append({
                "case_master_id": m["case_master_id"], "crime_no": m["crime_no"],
                "station": m["station_name"], "district": m["district_name"],
                "minor_head": crime, "gravity": m["gravity"],
                "undetected": bool(m.get("undetected")),
                "lat": m.get("lat"), "lon": m.get("lon"),
                "incident_from": m["incident_from"].isoformat(sep=" ", timespec="minutes")
                                 if m.get("incident_from") else None,
                "brief_snippet": (m["brief_facts"][:150] + "…")
                                 if len(m.get("brief_facts") or "") > 150 else m.get("brief_facts"),
                "score": round(score, 3),
                "level": "High" if score >= 0.55 else "Medium" if score >= 0.35 else "Low",
                "factors": factors,
                "why": f"Unusual for a {crime}: " + "; ".join(f["detail"] for f in factors[:2]),
            })

    scored.sort(key=lambda r: -r["score"])
    return {
        "count": len(scored),
        "anomalies": scored[:limit],
        "method": ("each case is compared against the profile of its OWN crime type — "
                   "hour, reporting delay, victim age and geographic isolation. Baselines "
                   f"use median absolute deviation so outliers cannot inflate the norm they "
                   f"are measured against, and each factor must also sit beyond the "
                   f"{TAIL_Q}th percentile of its own crime type before it can raise a flag — "
                   "which is what keeps the alert rate low enough to be worth reading"),
        "caveat": ("An anomaly is a prompt to look, not evidence of anything. Unusual "
                   "circumstances are common in real crime and most of these will have "
                   "ordinary explanations."),
    }
