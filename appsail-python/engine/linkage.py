"""
Linkage: composite-similarity graph -> clusters -> ranked, evidence-backed series.

Clustering uses scikit-learn AgglomerativeClustering with average linkage on the
precomputed distance (1 - similarity) and a distance threshold — no native-compile
deps, so it installs on the Catalyst managed runtime from requirements.txt.
(DBSCAN is a drop-in alternative; kept as a flag.)

Each series carries a Tier-2 evidence trail: which signals drove the links, the
cited CrimeNos, spatial span, timeline, and a cohesion x actionability rank.
"""
from __future__ import annotations

import numpy as np
from sklearn.cluster import AgglomerativeClustering, DBSCAN

from collections import Counter

from .fingerprint import DRIVER_LABELS

# plain-language phrase for each crime sub-head (for human-readable group titles)
PLAIN_CRIME = {
    "Chain Snatching": "Chain snatchings", "House Burglary": "House break-ins",
    "Motor Vehicle Theft": "Vehicle thefts", "Robbery": "Robberies",
    "Theft - Other": "Thefts", "Murder": "Murders", "Hurt": "Assaults",
    "Attempt to Murder": "Attempt-to-murder", "Assault on Woman": "Assaults on women",
    "Cheating": "Cheating cases",
}


def _level(v, hi, mid):
    return "High" if v >= hi else "Medium" if v >= mid else "Low"


def cluster(fp, distance_threshold=0.55, min_size=2, method="agglomerative",
            dbscan_eps=0.45):
    """Return list of clusters (each a list of case indices), size >= min_size."""
    n = fp.n
    if n < 2:
        return []
    D = 1.0 - fp.S
    np.fill_diagonal(D, 0.0)
    D = np.clip(D, 0.0, 1.0)
    if method == "dbscan":
        labels = DBSCAN(eps=dbscan_eps, min_samples=min_size,
                        metric="precomputed").fit_predict(D)
    else:
        model = AgglomerativeClustering(
            n_clusters=None, metric="precomputed", linkage="average",
            distance_threshold=distance_threshold)
        labels = model.fit_predict(D)
    groups = {}
    for i, lab in enumerate(labels):
        if lab < 0:
            continue
        groups.setdefault(lab, []).append(i)
    return [g for g in groups.values() if len(g) >= min_size]


def _intra_pairs(idx):
    for a in range(len(idx)):
        for b in range(a + 1, len(idx)):
            yield idx[a], idx[b]


def _now_reference(cases):
    dates = [c["incident_from"] for c in cases if c["incident_from"]]
    return max(dates) if dates else None


def build_series(fp, clusters, min_cohesion=0.45):
    """Turn clusters into scored, evidence-backed series dicts, ranked best-first."""
    cases = fp.cases
    now = _now_reference(cases)
    series = []
    for members in clusters:
        pairs = list(_intra_pairs(members))
        if not pairs:
            continue
        cohesion = float(np.mean([fp.S[i, j] for i, j in pairs]))
        if cohesion < min_cohesion:
            continue

        # aggregate signal drivers across intra-cluster pairs
        agg = {k: 0.0 for k in fp.w}
        for i, j in pairs:
            for k, v in fp.pair_contributions(i, j).items():
                agg[k] += v
        for k in agg:
            agg[k] /= len(pairs)
        drivers = sorted(agg.items(), key=lambda kv: -kv[1])

        # spatial span
        dists = [fp.distance_km(i, j) for i, j in pairs]
        span_km = float(max(dists)) if dists else 0.0

        # timeline / recency
        m_cases = [cases[i] for i in members]
        idates = sorted([c["incident_from"] for c in m_cases if c["incident_from"]])
        date_from = idates[0] if idates else None
        date_to = idates[-1] if idates else None
        recency_days = None
        if now and date_to:
            recency_days = (now - date_to).days

        stations = sorted({c["station_name"] for c in m_cases if c["station_name"]})
        districts = sorted({c["district_name"] for c in m_cases if c["district_name"]})
        gravities = {c["gravity"] for c in m_cases if c["gravity"]}
        heinous = "Heinous" in gravities

        # weak identity: most common accused name across members
        name_counts = {}
        for c in m_cases:
            for nm in c["accused_names"]:
                name_counts[nm] = name_counts.get(nm, 0) + 1
        weak_name = None
        if name_counts:
            nm, cnt = max(name_counts.items(), key=lambda kv: kv[1])
            if cnt >= 2:
                weak_name = {"name": nm, "cases": cnt, "of": len(members),
                             "confidence": "weak"}

        # Actionability. CLink's unique value is surfacing series NO single station
        # sees, so cross-jurisdiction REACH is the primary driver (a one-station
        # cluster is a lead that station already has). Then recency, size, gravity.
        # spatial plausibility: one offender works a city/adjacent area, not the whole
        # state — damp reach for implausibly spread clusters (likely coincidental MO).
        plausibility = 1.0 if span_km <= 60 else max(0.15, 60.0 / span_km)
        reach_score = min(1.0, (len(stations) - 1) / 2.0) * plausibility
        rec_score = 1.0 if recency_days is None else 1.0 / (1.0 + max(0, recency_days) / 120.0)
        size_score = min(1.0, len(members) / 6.0)
        grav_score = 1.0 if heinous else 0.6
        actionability = float(0.35 * reach_score + 0.25 * rec_score +
                              0.20 * size_score + 0.20 * grav_score)
        rank_score = float(cohesion * actionability)

        members_out = []
        for c in m_cases:
            members_out.append({
                "case_master_id": c["case_master_id"],
                "crime_no": c["crime_no"],
                "station": c["station_name"],
                "district": c["district_name"],
                "lat": c["lat"], "lon": c["lon"],
                "incident_from": c["incident_from"].isoformat(sep=" ") if c["incident_from"] else None,
                "gravity": c["gravity"],
                "minor_head": c["minor_head"],
                "brief_snippet": (c["brief_facts"][:160] + "…") if len(c["brief_facts"]) > 160 else c["brief_facts"],
                "accused_names": c["accused_names"],
            })
        members_out.sort(key=lambda m: m["incident_from"] or "")

        # plain-language title: dominant crime type + dominant district
        top_crime = Counter(m["minor_head"] for m in m_cases if m["minor_head"]).most_common(1)
        top_dist = Counter(c["district_name"] for c in m_cases if c["district_name"]).most_common(1)
        crime_word = PLAIN_CRIME.get(top_crime[0][0], top_crime[0][0]) if top_crime else "Linked cases"
        title = f"{crime_word} · {top_dist[0][0]}" if top_dist else crime_word

        series.append({
            "size": len(members),
            "title": title,
            "match_strength": _level(cohesion, 0.75, 0.6),
            "priority": None,  # filled after ranking (needs the rank distribution)
            "member_case_ids": [cases[i]["case_master_id"] for i in members],
            "members": members_out,
            "cohesion": round(cohesion, 4),
            "actionability": round(actionability, 4),
            "rank_score": round(rank_score, 4),
            "drivers": [{"signal": k, "label": DRIVER_LABELS[k],
                         "contribution": round(v, 4)} for k, v in drivers if v > 0.001],
            "top_drivers": [DRIVER_LABELS[k] for k, v in drivers[:3] if v > 0.001],
            "spatial_span_km": round(span_km, 2),
            "stations": stations, "n_stations": len(stations),
            "districts": districts,
            "date_from": date_from.isoformat(sep=" ") if date_from else None,
            "date_to": date_to.isoformat(sep=" ") if date_to else None,
            "recency_days": recency_days,
            "gravity": "Heinous" if heinous else "Non-Heinous",
            "weak_name": weak_name,
            "_member_idx": members,
        })

    series.sort(key=lambda s: -s["rank_score"])
    n = len(series)
    for rank, s in enumerate(series, start=1):
        s["series_id"] = f"SER-{rank:03d}"
        s["group_no"] = rank  # human-facing "Group N"
        # priority by position: top third High, middle Medium, rest Low
        s["priority"] = "High" if rank <= max(1, n // 3) else \
            "Medium" if rank <= max(2, 2 * n // 3) else "Low"
    return series


def edges_for_series(fp, s, min_edge=0.5):
    """Confidence-weighted links between member cases, for the network graph.
    Edges are INFERRED (with confidence), never asserted facts."""
    idx = s["_member_idx"]
    out = []
    for i, j in _intra_pairs(idx):
        conf = float(fp.S[i, j])
        if conf < min_edge:
            continue
        contrib = fp.pair_contributions(i, j)
        top = sorted(contrib.items(), key=lambda kv: -kv[1])[:3]
        out.append({
            "source": fp.cases[i]["case_master_id"],
            "target": fp.cases[j]["case_master_id"],
            "source_crime_no": fp.cases[i]["crime_no"],
            "target_crime_no": fp.cases[j]["crime_no"],
            "confidence": round(conf, 3),
            "why": [DRIVER_LABELS[k] for k, v in top if v > 0.02],
            "distance_km": round(fp.distance_km(i, j), 2),
        })
    return out
