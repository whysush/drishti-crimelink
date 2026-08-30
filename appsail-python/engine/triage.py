"""
Live FIR triage — the daily loop.

Everything else in the engine looks backwards over the archive. This looks
forward: a station registers a new FIR this morning, and the question is whether
it belongs to a pattern somebody else is already sitting on.

We fingerprint the incoming case with the same seven signals, score it against
every undetected case in the corpus, then roll those scores up per series. The
result is a ranked shortlist with the same evidence trail the archive view uses,
so the answer is auditable the moment it appears.
"""
from __future__ import annotations

import numpy as np

from .fingerprint import DRIVER_LABELS

TOP_CASES = 5           # nearest individual cases quoted as evidence
MIN_SERIES_SCORE = 0.30 # below this a "match" is noise, and saying so matters

# A match is judged against the group's OWN cohesion, not a fixed cut-off. The
# question an investigator actually asks is "does this case resemble that group
# as much as its members resemble each other?" — a tight group demands a high
# score, a loose one cannot, and a single constant would misjudge both.
FIT_HIGH, FIT_MEDIUM = 0.85, 0.65


def _level(v, hi, mid):
    return "High" if v >= hi else "Medium" if v >= mid else "Low"


def match(fp, series, new_case, limit=5):
    """Rank existing series by how well an unseen case fits them."""
    if fp is None or fp.n == 0:
        return {"matched": False, "reason": "no case corpus loaded", "matches": []}

    S, contrib, dist_km = fp.similarity_row(new_case)
    cases = fp.cases

    # nearest individual cases regardless of series — useful even when the case
    # matches no known group
    order = np.argsort(-S)
    nearest = []
    for i in order[:TOP_CASES]:
        c = cases[int(i)]
        top = sorted(((k, float(contrib[k][i])) for k in contrib), key=lambda kv: -kv[1])[:3]
        nearest.append({
            "case_master_id": c["case_master_id"], "crime_no": c["crime_no"],
            "station": c["station_name"], "district": c["district_name"],
            "minor_head": c["minor_head"],
            "incident_from": c["incident_from"].isoformat(sep=" ") if c["incident_from"] else None,
            "score": round(float(S[i]), 3),
            "distance_km": (None if np.isnan(dist_km[i]) else round(float(dist_km[i]), 2)),
            "why": [DRIVER_LABELS[k] for k, v in top if v > 0.02],
        })

    idx_of = {c["case_master_id"]: i for i, c in enumerate(cases)}
    out = []
    for s in series:
        idx = [idx_of[cid] for cid in s["member_case_ids"] if cid in idx_of]
        if not idx:
            continue
        vals = S[idx]
        mean_s = float(np.mean(vals))
        best_s = float(np.max(vals))
        # a case joins a group on its overall fit, but a single very strong link
        # is itself informative — weight both
        score = 0.65 * mean_s + 0.35 * best_s
        if score < MIN_SERIES_SCORE:
            continue
        agg = {k: float(np.mean(contrib[k][idx])) for k in contrib}
        drivers = sorted(agg.items(), key=lambda kv: -kv[1])
        fit = score / s["cohesion"] if s["cohesion"] else 0.0
        bi = idx[int(np.argmax(vals))]
        bc = cases[bi]
        out.append({
            "series_id": s["series_id"], "group_no": s["group_no"], "title": s["title"],
            "priority": s["priority"], "size": s["size"], "gravity": s["gravity"],
            "districts": s["districts"], "n_stations": s["n_stations"],
            "score": round(score, 3),
            "score_pct": int(round(score * 100)),
            "mean_similarity": round(mean_s, 3),
            "best_similarity": round(best_s, 3),
            "match_level": _level(fit, FIT_HIGH, FIT_MEDIUM),
            "fit_ratio": round(fit, 3),
            "fit_pct": int(round(min(1.0, fit) * 100)),
            "cohesion": s["cohesion"],
            "drivers": [{"signal": k, "label": DRIVER_LABELS[k],
                         "contribution": round(v, 4)} for k, v in drivers if v > 0.001],
            "top_drivers": [DRIVER_LABELS[k] for k, v in drivers[:3] if v > 0.001],
            "closest_case": {
                "case_master_id": bc["case_master_id"], "crime_no": bc["crime_no"],
                "station": bc["station_name"],
                "similarity": round(float(S[bi]), 3),
                "distance_km": (None if np.isnan(dist_km[bi]) else round(float(dist_km[bi]), 2)),
            },
        })

    out.sort(key=lambda m: (-m["fit_ratio"], -m["score"]))
    out = out[:limit]
    top = out[0] if out else None
    if top and top["match_level"] == "High":
        verdict = (f"Escalate. This FIR fits {top['series_id']} ({top['title']}) as "
                   f"closely as that group's own cases fit each other "
                   f"({top['fit_pct']}% of its internal cohesion) — a group already spanning "
                   f"{top['n_stations']} stations. Notify the district crime unit "
                   f"before it is worked as an isolated case.")
    elif top and top["match_level"] == "Medium":
        verdict = (f"Review. A possible fit with {top['series_id']} — {top['fit_pct']}% "
                   f"of that group's internal cohesion. "
                   f"Worth a look by the investigating officer alongside "
                   f"{top['closest_case']['crime_no']}.")
    elif top:
        verdict = (f"Weak signal only. Closest group is {top['series_id']} at "
                   f"{top['fit_pct']}% of its internal cohesion — treat this FIR as "
                   f"unlinked unless something else corroborates it.")
    else:
        verdict = ("No existing group fits this FIR. It may be an isolated offence, "
                   "or the first of a new pattern — it will be reconsidered as more "
                   "cases arrive.")

    return {
        "matched": bool(out),
        "verdict": verdict,
        "matches": out,
        "nearest_cases": nearest,
        "signals_used": [DRIVER_LABELS[k] for k in contrib
                         if float(np.max(contrib[k])) > 0.001],
        "caveat": ("Scored against undetected cases only, using the same signals and "
                   "weights as the archive, and graded against each group's own "
                   "cohesion. Every figure traces to a real FIR."),
    }
