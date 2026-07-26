"""
NL query over the SAME cached data (retrieval-only -> cannot hallucinate).

Deterministic intent + full-text retrieval that always answers with cited, real
CrimeNos. This is the graceful-degradation baseline for the NL bar; it can be
upgraded to QuickML RAG later without changing the contract (retrieve -> cite).
"""
from __future__ import annotations

import re

_CRIME_NO_RE = re.compile(r"\b\d{6,18}\b")


def _kw(q, *words):
    return any(w in q for w in words)


def answer(cases, series, question):
    q = (question or "").lower().strip()
    cases_by_id = {str(c["case_master_id"]): c for c in cases}

    # 1) direct CrimeNo -> its series
    m = _CRIME_NO_RE.search(q)
    if m:
        cno = m.group(0)
        hit = next((c for c in cases if str(c["crime_no"]) == cno), None)
        if hit:
            s = next((s for s in series if hit["case_master_id"] in s["member_case_ids"]), None)
            if s:
                return _series_answer(
                    f"Crime {cno} is part of series {s['series_id']} — "
                    f"{s['size']} linked undetected cases across {s['n_stations']} station(s).",
                    [s], cases_by_id)
            return {"intent": "case_lookup", "answer":
                    f"Crime {cno} is undetected but not currently in a linked series.",
                    "series": [], "cited": [_cite(hit)]}

    # 1.5) suspect name -> every case + series linked to that name
    name_index = {}
    for c in cases:
        for nm in c.get("accused_names", []):
            name_index[nm.lower()] = nm
    name_tokens = set()
    for lname in name_index:
        name_tokens.update(t for t in lname.split() if len(t) >= 3)
    fillers = {"cases", "case", "linked", "link", "to", "show", "me", "suspect", "series",
               "by", "who", "is", "the", "all", "find", "connected", "with", "named",
               "name", "accused", "of", "for", "any", "and"}
    content = [w for w in re.findall(r"[a-z]+", q) if w not in fillers and len(w) >= 3]
    if content and all(w in name_tokens for w in content):
        qset = set(content)
        hit_cases = [c for c in cases if any(qset & set(nm.lower().split())
                     for nm in c.get("accused_names", []))]
        if hit_cases:
            return _suspect_answer(content, hit_cases, series, cases_by_id)

    # 2) filter series by facets
    sel = list(series)
    facets = []
    if _kw(q, "heinous"):
        sel = [s for s in sel if s["gravity"] == "Heinous"]; facets.append("heinous")
    if _kw(q, "cross", "multi", "jurisdiction", "different station", "across station"):
        sel = [s for s in sel if s["n_stations"] >= 2]; facets.append("cross-jurisdiction")
    crime_types = {"chain": "Chain Snatching", "snatch": "Chain Snatching",
                   "burglar": "House Burglary", "house": "House Burglary",
                   "vehicle": "Motor Vehicle Theft", "two-wheeler": "Motor Vehicle Theft",
                   "motorcycle": "Motor Vehicle Theft", "robber": "Robbery",
                   "murder": "Murder", "cheat": "Cheating"}
    for kw, label in crime_types.items():
        if kw in q:
            sel = [s for s in sel if any(m["minor_head"] == label for m in s["members"])]
            facets.append(label); break
    for c in cases:
        d = (c["district_name"] or "").lower()
        if d and d.split()[0] in q:
            sel = [s for s in sel if c["district_name"] in s["districts"]]
            facets.append(c["district_name"]); break

    if facets or _kw(q, "series", "linked", "connected", "pattern"):
        label = (" and ".join(facets)) if facets else "linked"
        head = f"Found {len(sel)} {label} series."
        return _series_answer(head, sel[:10], cases_by_id)

    # 3) fallback: full-text over BriefFacts
    terms = [w for w in re.findall(r"[a-z]{3,}", q)
             if w not in {"the", "show", "find", "cases", "case", "with", "near", "any", "all"}]
    scored = []
    for c in cases:
        bf = (c["brief_facts"] or "").lower()
        score = sum(bf.count(t) for t in terms)
        if score:
            scored.append((score, c))
    scored.sort(key=lambda x: -x[0])
    top = [c for _, c in scored[:10]]
    return {"intent": "fulltext", "facets": terms,
            "answer": f"{len(scored)} undetected cases mention "
                      f"'{' '.join(terms) or question}'. Top {len(top)} shown.",
            "series": [], "cited": [_cite(c) for c in top]}


def _suspect_answer(content, hit_cases, series, cases_by_id):
    name = " ".join(w.capitalize() for w in content)
    hit_ids = {c["case_master_id"] for c in hit_cases}
    sel = []
    for s in series:
        wn = s.get("weak_name")
        wn_match = wn and all(w in wn["name"].lower() for w in content)
        if any(cid in hit_ids for cid in s["member_case_ids"]) or wn_match:
            sel.append(s)
    head = (f"Suspect “{name}” appears in {len(hit_cases)} case(s)"
            + (f", linked to {len(sel)} series." if sel else " (not yet in a linked series)."))
    res = _series_answer(head, sel, cases_by_id)
    res["intent"] = "suspect"
    res["answer"] = head
    cited_ids = {c["case_master_id"] for c in res["cited"]}
    for c in hit_cases:
        if c["case_master_id"] not in cited_ids:
            res["cited"].append(_cite(c))
    return res


def _cite(c):
    return {"case_master_id": c["case_master_id"], "crime_no": c["crime_no"],
            "station": c["station_name"], "district": c["district_name"],
            "minor_head": c["minor_head"], "gravity": c["gravity"],
            "snippet": (c["brief_facts"] or "")[:140]}


def _series_answer(head, sel, cases_by_id):
    out = []
    cited = []
    for s in sel:
        out.append({"series_id": s["series_id"], "size": s["size"],
                    "n_stations": s["n_stations"], "districts": s["districts"],
                    "gravity": s["gravity"], "cohesion": s["cohesion"],
                    "rank_score": s["rank_score"], "top_drivers": s["top_drivers"],
                    "weak_name": s["weak_name"],
                    "crime_nos": [m["crime_no"] for m in s["members"]]})
        for m in s["members"]:
            c = cases_by_id.get(str(m["case_master_id"]))
            if c:
                cited.append(_cite(c))
    return {"intent": "series", "answer": head, "series": out, "cited": cited}
