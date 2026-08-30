"""
Data-access layer for the CLink engine.

Two backends, one shape: both yield a list of `case` dicts (undetected cases,
cstype='C') plus lookup label maps, so the rest of the engine never knows whether
it's reading local seed CSVs (dev) or Catalyst Data Store (prod).

    CSVBackend(dir)         -> reads seed/csv/*.csv          (dev / offline)
    DatastoreBackend(app)   -> ZCQL over Catalyst Data Store (prod)

A `case` dict is the engine's unit of analysis (see build_cases()).
"""
from __future__ import annotations

import csv
import os
from collections import defaultdict
from datetime import datetime


def _parse_dt(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M",
                "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _num(s, cast=float, default=None):
    try:
        return cast(s)
    except (TypeError, ValueError):
        return default


class CSVBackend:
    """Reads the seed CSVs. Header names == Data Store column names."""

    def __init__(self, csv_dir):
        self.dir = csv_dir

    def _load(self, table):
        path = os.path.join(self.dir, f"{table}.csv")
        with open(path, encoding="utf-8") as f:
            return list(csv.DictReader(f))

    def load(self, only_undetected=True):
        casemaster = self._load("CaseMaster")
        chargesheet = self._load("ChargesheetDetails")
        accused = self._load("Accused")
        victim = self._load("Victim")
        complainant = self._load("ComplainantDetails")
        actsec = self._load("ActSectionAssociation")

        units = {r["UnitID"]: r for r in self._load("Unit")}
        districts = {r["DistrictID"]: r for r in self._load("District")}
        subheads = {r["CrimeSubHeadID"]: r["CrimeHeadName"] for r in self._load("CrimeSubHead")}
        heads = {r["CrimeHeadID"]: r["CrimeGroupName"] for r in self._load("CrimeHead")}
        gravity = {r["GravityOffenceID"]: r["LookupValue"] for r in self._load("GravityOffence")}
        occupations = {r["OccupationID"]: r["OccupationName"]
                       for r in self._load("OccupationMaster")}

        labels = dict(units=units, districts=districts, subheads=subheads,
                      heads=heads, gravity=gravity, occupations=occupations)
        return build_cases(casemaster, chargesheet, accused, victim,
                           complainant, actsec, labels,
                           only_undetected=only_undetected)


class DatastoreBackend:
    """Catalyst Data Store via PAGINATED ZCQL (ZCQL caps a query at ~300 rows, so
    full-table reads must page). `app` is an initialized zcatalyst_sdk app."""
    PAGE = 200

    def __init__(self, app):
        self.app = app

    def load(self):  # pragma: no cover - requires live Catalyst
        zcql = self.app.zcql()

        def rows(table, where=""):
            out, offset = [], 0
            while True:
                q = f"SELECT * FROM {table}"
                if where:
                    q += f" WHERE {where}"
                q += f" LIMIT {offset}, {self.PAGE}"
                batch = list(zcql.execute_query(q))
                for r in batch:
                    flat = {}
                    for _tbl, cols in r.items():   # ZCQL rows are {Table: {col: val}}
                        flat.update(cols)
                    out.append(flat)
                if len(batch) < self.PAGE:
                    break
                offset += self.PAGE
            return out

        casemaster = rows("CaseMaster")
        chargesheet = rows("ChargesheetDetails", "cstype = 'C'")
        accused = rows("Accused")
        victim = rows("Victim")
        complainant = rows("ComplainantDetails")
        actsec = rows("ActSectionAssociation")
        units = {r["UnitID"]: r for r in rows("Unit")}
        districts = {r["DistrictID"]: r for r in rows("District")}
        subheads = {r["CrimeSubHeadID"]: r["CrimeHeadName"] for r in rows("CrimeSubHead")}
        heads = {r["CrimeHeadID"]: r["CrimeGroupName"] for r in rows("CrimeHead")}
        gravity = {r["GravityOffenceID"]: r["LookupValue"] for r in rows("GravityOffence")}
        occupations = {r["OccupationID"]: r["OccupationName"]
                       for r in rows("OccupationMaster")}
        labels = dict(units=units, districts=districts, subheads=subheads,
                      heads=heads, gravity=gravity, occupations=occupations)
        return build_cases(casemaster, chargesheet, accused, victim,
                           complainant, actsec, labels)


def build_cases(casemaster, chargesheet, accused, victim, complainant, actsec, labels,
                only_undetected=True):
    """Join FIR + children into engine `case` dicts.

    Linkage only ever runs on undetected cases (cstype='C') — that is the whole
    premise. But the analytical side of the platform (hotspots, trend baselines,
    socio-economic correlation) has to see the *whole* crime picture, or a "spike"
    is measured against a population that excludes every solved case. So the
    caller chooses: `only_undetected=True` for the linkage spine, False for
    analytics over all FIRs.
    """
    undetected_ids = {r["CaseMasterID"] for r in chargesheet if r.get("cstype") == "C"}
    cs_by_case = {r["CaseMasterID"]: r for r in chargesheet}

    acc_by_case = defaultdict(list)
    for r in accused:
        acc_by_case[r["CaseMasterID"]].append(r)
    vic_by_case = defaultdict(list)
    for r in victim:
        vic_by_case[r["CaseMasterID"]].append(r)
    comp_by_case = defaultdict(list)
    for r in complainant:
        comp_by_case[r["CaseMasterID"]].append(r)
    acts_by_case = defaultdict(set)
    for r in actsec:
        # ER column names are ActID/SectionID, carrying Act.ActCode / Section.SectionCode values
        acts_by_case[r["CaseMasterID"]].add(f"{r['ActID']}:{r['SectionID']}")

    units, districts = labels["units"], labels["districts"]
    subheads, heads, gravity = labels["subheads"], labels["heads"], labels["gravity"]
    occupations = labels.get("occupations", {})

    cases = []
    for r in casemaster:
        cid = r["CaseMasterID"]
        if only_undetected and cid not in undetected_ids:
            continue
        unit = units.get(r.get("PoliceStationID"), {})
        did_raw = unit.get("DistrictID")            # string key for lookups below
        did = _num(did_raw, int)                    # int so it matches GeoJSON censuscode
        incident = _parse_dt(r.get("IncidentFromDate"))
        info = _parse_dt(r.get("InfoReceivedPSDate"))
        delay_h = None
        if incident and info:
            delay_h = max(0.0, (info - incident).total_seconds() / 3600.0)

        names = [a["AccusedName"] for a in acc_by_case[cid]
                 if a.get("AccusedName") and a["AccusedName"].strip().lower() != "unknown"]
        victims = [{"age": _num(v.get("AgeYear"), int), "gender": (v.get("GenderID") or "").upper()}
                   for v in vic_by_case[cid]]
        occs = [c.get("OccupationID") for c in comp_by_case[cid]]

        cases.append({
            "case_master_id": cid,
            "crime_no": r.get("CrimeNo"),
            "police_station_id": r.get("PoliceStationID"),
            "station_name": unit.get("UnitName"),
            "district_id": did,
            "district_name": districts.get(did_raw, {}).get("DistrictName"),
            "lat": _num(r.get("latitude")),
            "lon": _num(r.get("longitude")),
            "major_head_id": r.get("CrimeMajorHeadID"),
            "major_head": heads.get(r.get("CrimeMajorHeadID")),
            "minor_head_id": r.get("CrimeMinorHeadID"),
            "minor_head": subheads.get(r.get("CrimeMinorHeadID")),
            "gravity_id": r.get("GravityOffenceID"),
            "gravity": gravity.get(r.get("GravityOffenceID")),
            "incident_from": incident,
            "info_received": info,
            "reporting_delay_h": delay_h,
            "brief_facts": (r.get("BriefFacts") or "").strip(),
            "act_sections": acts_by_case[cid],
            "victims": victims,
            "accused_names": names,
            "complainant_occupations": [occupations.get(o, o) for o in occs if o],
            "registered_date": r.get("CrimeRegisteredDate"),
            "csdate": cs_by_case.get(cid, {}).get("csdate"),
            "undetected": cid in undetected_ids,
            "cstype": cs_by_case.get(cid, {}).get("cstype"),
            "complainant_occupation_ids": [o for o in occs if o],
        })
    return cases
