"""
Criminological network — the multi-entity link graph.

The linkage engine connects cases to cases. That is the hero, but it is only one
edge type, and the brief asks for something wider: a graph in which suspects,
victims, locations and incidents are all nodes, so an analyst can see the
structure that isolated spreadsheets hide.

Node types
    case      an FIR
    person    an accused name string, resolved across FIRs (never an identity)
    station   the police station an FIR belongs to
    mo        a modus-operandi signature (crime type + time band), which is what
              lets two offenders working the same way surface as a shared pattern

Edge types
    named_in     person  -> case
    registered   case    -> station
    linked       case    -> case   (inferred by the similarity engine)
    operates     person  -> mo
    co_accused   person  -> person (named in the same FIR)

Association detection then walks that graph for the thing nobody can see in a
spreadsheet: people who are never named together in one FIR, but who work the same
MO in the same stations — a suspected association rather than a recorded one.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from itertools import combinations

from .persons import normalise

HOUR_BANDS = [(0, 5, "late night"), (5, 9, "early morning"), (9, 12, "morning"),
              (12, 16, "afternoon"), (16, 20, "evening"), (20, 24, "night")]


def _band(h):
    for lo, hi, label in HOUR_BANDS:
        if lo <= h < hi:
            return label
    return "night"


def _mo_key(c):
    h = c["incident_from"].hour if c.get("incident_from") else None
    return f"{c.get('minor_head') or 'Unknown'} · {_band(h) if h is not None else 'unknown hour'}"


def build(cases, series, persons, max_cases=260):
    """Assemble the entity graph.

    Capped at `max_cases` incident nodes so the graph stays legible and the
    payload stays small — the cases inside linked groups and hotspot-heavy
    stations are kept first, since those are the ones carrying structure.
    """
    in_series = {cid for s in series for cid in s["member_case_ids"]}
    by_id = {c["case_master_id"]: c for c in cases}

    # keep grouped cases first, then cases naming a recurring person, then the rest
    person_case_ids = {pc["case_master_id"] for p in persons for pc in p["cases"]}
    ranked = sorted(cases, key=lambda c: (
        0 if c["case_master_id"] in in_series else
        1 if c["case_master_id"] in person_case_ids else 2,
        -(c["incident_from"].timestamp() if c.get("incident_from") else 0)))
    keep = ranked[:max_cases]
    keep_ids = {c["case_master_id"] for c in keep}

    nodes, edges = [], []
    seen = set()

    def node(nid, ntype, label, **extra):
        if nid in seen:
            return
        seen.add(nid)
        nodes.append({"id": nid, "type": ntype, "label": label, **extra})

    # incidents + their stations + MO signatures
    stations = Counter()
    for c in keep:
        cid = f"case:{c['case_master_id']}"
        node(cid, "case", c["crime_no"],
             district=c["district_name"], station=c["station_name"],
             crime=c["minor_head"], gravity=c["gravity"],
             undetected=bool(c.get("undetected")),
             linked=c["case_master_id"] in in_series,
             when=c["incident_from"].isoformat(sep=" ", timespec="minutes")
                  if c.get("incident_from") else None)
        if c.get("station_name"):
            sid = f"station:{c['station_name']}"
            node(sid, "station", c["station_name"], district=c["district_name"])
            edges.append({"source": cid, "target": sid, "type": "registered", "weight": 0.25})
            stations[c["station_name"]] += 1
        mo = _mo_key(c)
        node(f"mo:{mo}", "mo", mo)
        edges.append({"source": cid, "target": f"mo:{mo}", "type": "exhibits", "weight": 0.2})

    for n in nodes:
        if n["type"] == "station":
            n["cases"] = stations[n["label"]]

    # persons, and what they are named in
    person_of_case = defaultdict(list)
    for p in persons:
        pid = f"person:{p['person_key']}"
        node(pid, "person", p["name"],
             cases=p["n_cases"], stations=p["n_stations"],
             districts=p["districts"], priority=p["priority"],
             cross_station=p["cross_station"], crimes=p["crime_types"])
        for pc in p["cases"]:
            if pc["case_master_id"] in keep_ids:
                edges.append({"source": pid, "target": f"case:{pc['case_master_id']}",
                              "type": "named_in", "weight": 0.5})
            person_of_case[pc["case_master_id"]].append(p)
        # a person's own MO signature set
        for mo, n in Counter(_mo_key(by_id[pc["case_master_id"]])
                             for pc in p["cases"] if pc["case_master_id"] in by_id).items():
            if n >= 2:
                node(f"mo:{mo}", "mo", mo)
                edges.append({"source": pid, "target": f"mo:{mo}",
                              "type": "operates", "weight": min(1.0, n / 3)})

    # inferred case-to-case links from the similarity engine
    for s in series:
        ms = [cid for cid in s["member_case_ids"] if cid in keep_ids]
        for a, b in combinations(ms, 2):
            edges.append({"source": f"case:{a}", "target": f"case:{b}",
                          "type": "linked", "weight": round(s["cohesion"], 3),
                          "series_id": s["series_id"]})

    # co-accused: named together in one FIR — a recorded relationship
    for cid, ps in person_of_case.items():
        for a, b in combinations({p["person_key"] for p in ps}, 2):
            edges.append({"source": f"person:{a}", "target": f"person:{b}",
                          "type": "co_accused", "weight": 0.7})

    return {"nodes": nodes, "edges": edges,
            "counts": Counter(n["type"] for n in nodes),
            "capped_at": max_cases, "total_cases": len(cases)}


def associations(persons, cases, min_shared_mo=1):
    """Suspected associations: people never named in the same FIR who nonetheless
    work the same MO in the same places.

    This is the "hidden association" the brief describes — it cannot be seen in a
    spreadsheet because the two names never appear on the same row. It is a
    hypothesis for an analyst to test, and it is labelled as one.
    """
    by_id = {c["case_master_id"]: c for c in cases}
    profile = {}
    together = set()
    for p in persons:
        mos, stns, dists = Counter(), set(), set()
        for pc in p["cases"]:
            c = by_id.get(pc["case_master_id"])
            if not c:
                continue
            mos[_mo_key(c)] += 1
            if c.get("station_name"):
                stns.add(c["station_name"])
            if c.get("district_name"):
                dists.add(c["district_name"])
        profile[p["person_key"]] = {"p": p, "mos": set(mos), "stations": stns, "districts": dists}

    # people actually named in the same FIR are a recorded fact, not an inference
    per_case = defaultdict(set)
    for p in persons:
        for pc in p["cases"]:
            per_case[pc["case_master_id"]].add(p["person_key"])
    for ks in per_case.values():
        for a, b in combinations(sorted(ks), 2):
            together.add((a, b))

    out = []
    keys = sorted(profile)
    for a, b in combinations(keys, 2):
        if (a, b) in together:
            continue
        A, B = profile[a], profile[b]
        shared_mo = A["mos"] & B["mos"]
        shared_st = A["stations"] & B["stations"]
        shared_di = A["districts"] & B["districts"]
        # A shared MO in a shared district is the floor. Requiring two shared MO
        # signatures sounded rigorous and returned nothing at all — with most people
        # appearing in only two or three FIRs there simply are not two signatures to
        # share. One shared signature plus overlapping ground is the real signal;
        # strength then separates the coincidences from the rest.
        if len(shared_mo) < min_shared_mo or not shared_di:
            continue
        strength = min(1.0, 0.40 * min(1.0, len(shared_mo) / 2)
                       + 0.35 * (1.0 if shared_st else 0.0)
                       + 0.25 * min(1.0, len(shared_di) / 2))
        out.append({
            "a": A["p"]["name"], "b": B["p"]["name"],
            "a_key": a, "b_key": b,
            "shared_mo": sorted(shared_mo),
            "shared_stations": sorted(shared_st),
            "shared_districts": sorted(shared_di),
            "a_cases": A["p"]["n_cases"], "b_cases": B["p"]["n_cases"],
            "strength": round(strength, 3),
            "level": "High" if strength >= 0.7 else "Medium" if strength >= 0.45 else "Low",
            "basis": ("never named in the same FIR, but working the same modus operandi "
                      "in overlapping jurisdictions"),
            "caveat": ("A suspected association inferred from behaviour and name strings. "
                       "It is a hypothesis to test, not a recorded relationship."),
        })
    out.sort(key=lambda r: -r["strength"])
    return out
