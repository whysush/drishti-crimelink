"""
Cross-FIR person resolution.

The FIR schema has no global offender identity: `Accused.PersonID` is only
"A1/A2" *within* one FIR and `AccusedName` is a free string. So a name that
appears in six FIRs across four stations is, to the database, six unrelated
strings — and nobody ever sees the pattern.

This module does the one thing the schema cannot: it normalises and fuzzy-groups
accused names across every undetected case, and surfaces the ones that recur —
especially across station boundaries, where no single officer would ever notice.

It is deliberately framed as an *inference over name strings*, never an identity
claim. Two people genuinely share a name; the output says so on every record.
"""
from __future__ import annotations

import re
from collections import defaultdict
from difflib import SequenceMatcher

HONORIFICS = {"mr", "mrs", "ms", "shri", "sri", "smt", "dr", "kum", "s/o", "d/o", "w/o"}
NOISE = {"unknown", "unidentified", "not known", "na", "n/a", "-", "accused"}
FUZZY = 0.88            # two spellings of one name
TOKEN_FUZZY = 0.75      # ...and every token must agree, not just the string overall
MIN_CASES = 2           # a person is only interesting once they recur


def normalise(name):
    n = (name or "").strip().lower()
    n = re.sub(r"[^a-z\s]", " ", n)
    toks = [t for t in n.split() if t and t not in HONORIFICS]
    return " ".join(toks)


def _same(a, b):
    """True only for spelling drift of one name — not two names that merely rhyme.

    Whole-string similarity alone merges "Basavaraj Pasha" into "Basavaraj Prasad"
    because the shared first token carries the ratio. So every token must match its
    counterpart too, which is what actually distinguishes a transliteration variant
    from a different person.
    """
    if a == b:
        return True
    ta, tb = a.split(), b.split()
    if len(ta) != len(tb):
        return False
    if SequenceMatcher(None, a, b).ratio() < FUZZY:
        return False
    # Transliteration drift preserves the opening sound: Setty/Shetty, Gowda/Gouda,
    # Naik/Nayak. Two genuinely different names can still score well on overlap —
    # "Imran Naik" against "Kiran Naik" — so the first letter of every token has to
    # agree as well. Under-merging is the safe error here: a missed variant loses a
    # lead, a wrong merge puts an innocent name on someone else's case list.
    return all(x[0] == y[0] and SequenceMatcher(None, x, y).ratio() >= TOKEN_FUZZY
               for x, y in zip(ta, tb))


def resolve(cases, series):
    """Group accused-name strings across undetected cases into persons of interest.

    Returns records ranked by how much they should worry an investigator:
    recurrence, how many stations they cross, and heinous involvement.
    """
    series_of = {}
    for s in series:
        for cid in s["member_case_ids"]:
            series_of.setdefault(cid, []).append(s["series_id"])

    # bucket raw names by normalised form, keeping every original spelling
    buckets = defaultdict(lambda: {"variants": set(), "cases": []})
    for c in cases:
        for raw in c.get("accused_names") or []:
            key = normalise(raw)
            if not key or key in NOISE or len(key) < 4:
                continue
            b = buckets[key]
            b["variants"].add(raw.strip())
            b["cases"].append(c)

    # merge near-identical normalised forms (transliteration drift)
    keys = sorted(buckets, key=lambda k: -len(buckets[k]["cases"]))
    merged, taken = [], set()
    for i, k in enumerate(keys):
        if k in taken:
            continue
        group = [k]
        taken.add(k)
        for k2 in keys[i + 1:]:
            if k2 not in taken and _same(k, k2):
                group.append(k2)
                taken.add(k2)
        merged.append(group)

    out = []
    for group in merged:
        variants, cs = set(), []
        seen_ids = set()
        for k in group:
            variants |= buckets[k]["variants"]
            for c in buckets[k]["cases"]:
                if c["case_master_id"] not in seen_ids:
                    seen_ids.add(c["case_master_id"])
                    cs.append(c)
        if len(cs) < MIN_CASES:
            continue

        cs.sort(key=lambda c: c["incident_from"] or "")
        stations = sorted({c["station_name"] for c in cs if c["station_name"]})
        districts = sorted({c["district_name"] for c in cs if c["district_name"]})
        crimes = sorted({c["minor_head"] for c in cs if c["minor_head"]})
        heinous = sum(1 for c in cs if c["gravity"] == "Heinous")
        sids = sorted({sid for c in cs for sid in series_of.get(c["case_master_id"], [])})
        dates = [c["incident_from"] for c in cs if c["incident_from"]]

        # rank: recurrence, then jurisdictional reach (what nobody currently sees),
        # then severity
        reach = min(1.0, (len(stations) - 1) / 2.0)
        recur = min(1.0, (len(cs) - 1) / 4.0)
        sev = min(1.0, heinous / max(1, len(cs)))
        score = 0.40 * reach + 0.35 * recur + 0.25 * sev

        display = max(variants, key=len)
        out.append({
            "person_key": normalise(display).replace(" ", "-"),
            "name": display,
            "variants": sorted(variants),
            "n_cases": len(cs),
            "n_stations": len(stations),
            "n_districts": len(districts),
            "stations": stations,
            "districts": districts,
            "crime_types": crimes,
            "heinous_cases": heinous,
            "cross_station": len(stations) >= 2,
            "series_ids": sids,
            "first_seen": dates[0].isoformat(sep=" ") if dates else None,
            "last_seen": dates[-1].isoformat(sep=" ") if dates else None,
            "score": round(score, 4),
            "priority": "High" if score >= 0.6 else "Medium" if score >= 0.35 else "Low",
            "cases": [{
                "case_master_id": c["case_master_id"], "crime_no": c["crime_no"],
                "station": c["station_name"], "district": c["district_name"],
                "minor_head": c["minor_head"], "gravity": c["gravity"],
                "incident_from": c["incident_from"].isoformat(sep=" ") if c["incident_from"] else None,
                "series_ids": series_of.get(c["case_master_id"], []),
            } for c in cs],
            "caveat": ("Matched on the name string recorded in each FIR — not a "
                       "verified identity. Different people share names and one "
                       "person may be recorded several ways. Corroborate before use."),
        })

    out.sort(key=lambda p: (-p["score"], -p["n_cases"]))
    return out
