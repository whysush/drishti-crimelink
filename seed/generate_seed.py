#!/usr/bin/env python3
"""
CLink synthetic seed generator (statewide edition).

Geography is driven by the real Karnataka district GeoJSON
(../Karnataka_District_Boundary.json): we pick ~19 districts spanning the state,
compute each district's centroid, and scatter police stations + cases inside the
real boundaries. Districts are keyed by real `censuscode` so the frontend joins
map polygons to data with zero name-spelling ambiguity.

Still: deterministic (seed=42), stdlib only, planted linkable series + ground truth
for evaluating the engine. Real KSP data swaps in through the same tables later.

Output: seed/csv/<Table>.csv  +  seed/ground_truth_series.json
"""

import csv
import json
import os
import random
from datetime import datetime, timedelta

random.seed(42)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "csv")
os.makedirs(OUT, exist_ok=True)
GEOJSON = os.path.join(ROOT, "Karnataka_District_Boundary.json")

# ----------------------------------------------------------------------------
# Districts from the GeoJSON (censuscode = DistrictID, real centroid = center)
# geojson_name -> modern display name
# ----------------------------------------------------------------------------
DISTRICT_PICK = {
    "Bangalore": "Bengaluru Urban", "Bangalore Rural": "Bengaluru Rural",
    "Ramanagara": "Ramanagara", "Mandya": "Mandya", "Mysore": "Mysuru",
    "Chamrajnagar": "Chamarajanagar", "Tumkur": "Tumakuru", "Kolar": "Kolar",
    "Chikkaballapura": "Chikkaballapura", "Hassan": "Hassan", "Shimoga": "Shivamogga",
    "Davanagere": "Davanagere", "Chitradurga": "Chitradurga", "Belgaum": "Belagavi",
    "Dharwad": "Dharwad", "Gulbarga": "Kalaburagi", "Bellary": "Ballari",
    "Dakshina Kannada": "Dakshina Kannada", "Udupi": "Udupi",
}


def _centroid(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    best, bestA = None, -1
    for poly in polys:
        ring = poly[0]
        A = cx = cy = 0.0
        for i in range(len(ring) - 1):
            x0, y0 = ring[i]; x1, y1 = ring[i + 1]
            cr = x0 * y1 - x1 * y0
            A += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr
        if abs(A) < 1e-9:
            continue
        A *= 0.5; cx /= (6 * A); cy /= (6 * A)
        if abs(A) > bestA:
            bestA, best = abs(A), (round(cy, 4), round(cx, 4))  # (lat, lon)
    return best


def load_districts():
    gj = json.load(open(GEOJSON))
    feat = {f["properties"]["district"]: f for f in gj["features"]}
    out = []
    for gname, disp in DISTRICT_PICK.items():
        f = feat[gname]
        lat, lon = _centroid(f["geometry"])
        out.append(dict(id=int(f["properties"]["censuscode"]), name=disp,
                        geo=gname, lat=lat, lon=lon))
    return out


DISTRICTS = load_districts()
DBYNAME = {d["name"]: d for d in DISTRICTS}
STATE = [(29, "Karnataka", 1, 1)]          # StateID, StateName, NationalityID, Active
NATIONALITY_ID = 1                          # India (lookup value; no master in ER)

STATION_SUFFIX = ["Town PS", "North PS", "South PS", "East PS", "West PS",
                  "Market PS", "Rural PS", "City PS"]

# police-administration lookups (ER: UnitType / Rank / Designation)
UNITTYPE = [(1, "Police Station", "City", 4, 1), (2, "Circle Office", "District", 3, 1),
            (3, "Sub-Division", "District", 2, 1)]   # UnitTypeID, UnitTypeName, CityDistState, Hierarchy, Active
RANK = [(1, "Superintendent of Police", 3, 1), (2, "Deputy SP", 4, 1), (3, "Inspector", 5, 1),
        (4, "Sub-Inspector", 6, 1), (5, "Assistant SI", 7, 1), (6, "Head Constable", 8, 1),
        (7, "Police Constable", 9, 1)]              # RankID, RankName, Hierarchy, Active
DESIGNATION = [(1, "Investigating Officer", 1, 1), (2, "Station House Officer", 1, 2),
               (3, "Writer", 1, 3), (4, "Beat Officer", 1, 4)]  # DesignationID, DesignationName, Active, SortOrder
RANK_IDS = [r[0] for r in RANK]
DESIG_IDS = [d[0] for d in DESIGNATION]

# ----------------------------------------------------------------------------
# Lookups
# ----------------------------------------------------------------------------
CASE_CATEGORY = [(1, "FIR"), (3, "UDR"), (4, "PAR"), (8, "Zero FIR")]
GRAVITY = [(1, "Heinous"), (2, "Non-Heinous")]
CASE_STATUS = [(1, "Under Investigation"), (2, "Charge Sheeted"), (3, "Closed")]
CRIME_HEAD = [(1, "Crimes Against Body", 1), (2, "Crimes Against Property", 1),
              (3, "Crimes Against Women", 1), (4, "Crimes Against Public Order", 1)]
CRIME_SUBHEAD = [
    (10, 2, "Chain Snatching", 1), (11, 2, "House Burglary", 2),
    (12, 2, "Motor Vehicle Theft", 3), (13, 2, "Robbery", 4), (14, 2, "Theft - Other", 5),
    (20, 1, "Murder", 1), (21, 1, "Hurt", 2), (22, 1, "Attempt to Murder", 3),
    (30, 3, "Assault on Woman", 1), (40, 4, "Cheating", 1),
]
HEAD_OF_SUBHEAD = {s[0]: s[1] for s in CRIME_SUBHEAD}
HEINOUS_SUBHEADS = {13, 20, 22, 30}
ACT = [("IPC", "Indian Penal Code, 1860", "IPC", 1),
       ("BNS", "Bharatiya Nyaya Sanhita, 2023", "BNS", 1),
       ("MVAct", "Motor Vehicles Act, 1988", "MV Act", 1)]
SECTION = [("IPC", "302", "Murder", 1), ("IPC", "307", "Attempt to murder", 1),
           ("IPC", "323", "Voluntarily causing hurt", 1),
           ("IPC", "356", "Assault to commit theft carried by a person", 1),
           ("IPC", "379", "Theft", 1), ("IPC", "380", "Theft in dwelling house", 1),
           ("IPC", "392", "Robbery", 1), ("IPC", "411", "Receiving stolen property", 1),
           ("IPC", "457", "House-breaking by night", 1),
           ("IPC", "354", "Assault on woman to outrage modesty", 1),
           ("IPC", "420", "Cheating and dishonestly inducing delivery", 1)]
SUBHEAD_SECTIONS = {
    10: [("IPC", "356"), ("IPC", "379")], 11: [("IPC", "457"), ("IPC", "380")],
    12: [("IPC", "379")], 13: [("IPC", "392")], 14: [("IPC", "379"), ("IPC", "411")],
    20: [("IPC", "302")], 21: [("IPC", "323")], 22: [("IPC", "307")],
    30: [("IPC", "354")], 40: [("IPC", "420")],
}
OCCUPATION = [(1, "Farmer"), (2, "Government Employee"), (3, "Private Employee"),
              (4, "Business"), (5, "Student"), (6, "Homemaker"),
              (7, "Daily Wage Labourer"), (8, "Unemployed")]
RELIGION = [(1, "Hindu"), (2, "Muslim"), (3, "Christian"), (4, "Other")]
CASTE = [(1, "General"), (2, "OBC"), (3, "SC"), (4, "ST")]

FIRST_M = ["Ravi", "Suresh", "Manjunath", "Prakash", "Kiran", "Naveen", "Arun", "Vinay",
           "Girish", "Santosh", "Mahesh", "Ramesh", "Anil", "Basavaraj", "Shivakumar",
           "Nagaraj", "Prasad", "Harish", "Lokesh", "Umesh", "Imran", "Firoz"]
FIRST_F = ["Lakshmi", "Geetha", "Savitha", "Anitha", "Rekha", "Divya", "Nagaratna",
           "Sushma", "Vidya", "Roopa", "Kavya", "Bhavya", "Shwetha", "Deepa"]
LAST = ["Gowda", "Reddy", "Naik", "Shetty", "Rao", "Kumar", "Murthy", "Patil",
        "Hegde", "Bhat", "Achar", "Setty", "Raju", "Prasad", "Nayak", "Pasha"]


def full_name(gender):
    fn = random.choice(FIRST_F if gender == "F" else FIRST_M)
    return f"{fn} {random.choice(LAST)}"


DIRECTIONS = ["towards the market", "towards the bus stand", "into a bylane",
              "towards the highway", "into the residential layout", "towards the flyover",
              "into the lake-bed area", "towards the ring road"]
LANDMARKS = ["a temple", "a bank ATM", "a bus stop", "a park gate", "a jewellery shop",
             "a school", "a petrol bunk", "a wedding hall", "a vegetable market",
             "a hospital gate", "an apartment complex", "a government office"]
_ITEMS = ["a gold chain", "a mangalsutra", "two gold bangles", "a mobile phone",
          "a wallet with cash", "a laptop bag", "a handbag", "ear studs"]
_VEH = ["a Honda Activa", "a Bajaj Pulsar", "a TVS scooter", "a Hero Splendor",
        "a Royal Enfield", "a Yamaha bike"]
_ENTRY = ["the rear door", "a window grille", "the main door lock", "the roof ventilator",
          "the compound gate", "the kitchen door"]
_TIMEWORD = ["in the early hours", "during the afternoon", "late in the evening",
             "around noon", "at dusk", "during office hours", "at night"]

NOISE_TEMPLATES = {
    10: ["The complainant states that {who} snatched {item} near {lm} {tw} and fled {dir}.",
         "While walking near {lm}, {item} was snatched from the complainant by a passer-by who escaped {dir}.",
         "{item} was pulled off the complainant's neck near {lm}; the accused ran {dir}.",
         "An unidentified person grabbed {item} from the complainant close to {lm} and disappeared."],
    11: ["The complainant found {entry} broken on returning home; {item} and cash were missing.",
         "Unknown persons entered through {entry} {tw} and took gold ornaments and cash.",
         "The house near {lm} was burgled via {entry}; {item} was reported stolen.",
         "On returning from a trip the complainant found {entry} forced and valuables gone."],
    12: ["{veh} parked near {lm} was found missing {tw}.",
         "The complainant's {veh} was stolen from outside {lm}.",
         "{veh} left near {lm} could not be traced; the steering lock was broken.",
         "Unknown persons rode away {veh} parked near {lm} {tw}."],
    13: ["The complainant was waylaid near {lm} {tw} and robbed of {item} at knife-point.",
         "Two persons on a bike snatched {item} near {lm} after threatening the complainant.",
         "The complainant was assaulted near {lm} and {item} was taken forcibly.",
         "Near {lm}, unknown persons robbed the complainant of {item} and fled {dir}."],
    14: ["{item} was found missing from the complainant's shop near {lm} {tw}.",
         "The complainant reported theft of {item} from the premises near {lm}.",
         "Household articles and {item} were stolen from the complainant's house near {lm}.",
         "{item} kept at the workplace near {lm} was stolen {tw}."],
    20: ["The body of a person was found near {lm} {tw}; a case of murder is registered.",
         "The deceased was found with injuries near {lm}; murder is suspected.",
         "A murder was reported near {lm} following a dispute {tw}."],
    21: ["The complainant sustained injuries in an assault near {lm} {tw}.",
         "A quarrel near {lm} led to the complainant being beaten and hurt.",
         "The complainant was assaulted with a stick near {lm} and injured."],
    22: ["The complainant was attacked with a weapon near {lm} {tw} and grievously injured.",
         "An attempt was made on the complainant's life near {lm} using a sharp weapon."],
    30: ["The complainant, a woman, was harassed and assaulted near {lm} {tw}.",
         "Near {lm}, an unknown person outraged the modesty of the complainant {tw}."],
    40: ["The complainant was cheated of money near {lm} on a false promise {tw}.",
         "An unknown person defrauded the complainant of cash promising {item} {tw}."],
}


def noise_mo(subhead):
    t = random.choice(NOISE_TEMPLATES[subhead])
    return t.format(who=random.choice(["an unknown person", "a passer-by", "two youths"]),
                    item=random.choice(_ITEMS), veh=random.choice(_VEH),
                    entry=random.choice(_ENTRY), lm=random.choice(LANDMARKS),
                    tw=random.choice(_TIMEWORD), dir=random.choice(DIRECTIONS))


# ----------------------------------------------------------------------------
# Build stations (Unit) per district
# ----------------------------------------------------------------------------
units = []
unit_id = 0
for d in DISTRICTS:
    n_st = random.randint(3, 4)
    for k in range(n_st):
        unit_id += 1
        ulat = round(d["lat"] + random.uniform(-0.12, 0.12), 6)
        ulon = round(d["lon"] + random.uniform(-0.12, 0.12), 6)
        units.append(dict(UnitID=unit_id, UnitName=f"{d['name']} {STATION_SUFFIX[k]}",
                          TypeID=1, ParentUnit=0, NationalityID=NATIONALITY_ID, StateID=29,
                          DistrictID=d["id"], Active=1, _lat=ulat, _lon=ulon, _did=d["id"]))
UNITS_BY_DISTRICT = {}
for u in units:
    UNITS_BY_DISTRICT.setdefault(u["_did"], []).append(u)
UNIT_BY_ID = {u["UnitID"]: u for u in units}

# ----------------------------------------------------------------------------
# Courts (per district) and Employees (police officers) — referenced by CaseMaster
# .CourtID / .PolicePersonID and ChargesheetDetails.PolicePersonID, so the FKs resolve.
# ----------------------------------------------------------------------------
courts = []
court_id = 5000
for d in DISTRICTS:
    for name in ["JMFC Court", "District & Sessions Court"][:random.randint(1, 2)]:
        court_id += 1
        courts.append(dict(CourtID=court_id, CourtName=f"{d['name']} {name}",
                           DistrictID=d["id"], StateID=29, Active=1))
COURT_IDS = [c["CourtID"] for c in courts]

employees = []
emp_id = 999
for u in units:
    for _ in range(random.randint(3, 5)):
        emp_id += 1
        g = random.choice(["M", "M", "F"])
        dob = datetime(random.randint(1975, 1998), random.randint(1, 12), random.randint(1, 28))
        appt = datetime(random.randint(2005, 2020), random.randint(1, 12), random.randint(1, 28))
        employees.append(dict(EmployeeID=emp_id, DistrictID=u["_did"], UnitID=u["UnitID"],
                              RankID=random.choice(RANK_IDS), DesignationID=random.choice(DESIG_IDS),
                              KGID=f"KG{emp_id:06d}", FirstName=random.choice(FIRST_F if g == "F" else FIRST_M),
                              EmployeeDOB=dob.date().isoformat(), GenderID=g,
                              BloodGroupID=random.randint(1, 8), PhysicallyChallenged=0,
                              AppointmentDate=appt.date().isoformat()))
EMPLOYEE_IDS = [e["EmployeeID"] for e in employees]

# ----------------------------------------------------------------------------
# Planted series — each has a DISTINCT MO template (unique phrasing) so that even
# same-crime-type series in different districts stay separable.
# ----------------------------------------------------------------------------
SERIES_DEFS = [
    dict(key="S1", subhead=10, name="Chain-snatch bike duo", district="Bengaluru Urban",
         n=7, weak_name="Manjunath Gowda", weak_frac=0.45, vg="F", va=(28, 55), night=True,
         mo="Two men on a black motorcycle snatched a gold chain from a woman near {lm} at about {t}. The pillion rider grabbed the chain and they sped away {dir}."),
    dict(key="S2", subhead=11, name="Rear-ventilator burglary crew", district="Mysuru",
         n=6, weak_name="Suresh Naik", weak_frac=0.33, vg="M", va=(35, 65), night=True,
         mo="Entry was made through the rear ventilator while the house was locked and the family away. Gold ornaments and cash were taken from the bedroom almirah near {lm}."),
    dict(key="S3", subhead=12, name="Two-wheeler lifters (tech corridor)", district="Bengaluru Urban",
         n=8, weak_name=None, weak_frac=0.0, vg="M", va=(22, 40), night=False,
         mo="A two-wheeler parked outside {lm} was found missing; the steering lock was snapped. CCTV shows a lone man wheeling it away {dir}."),
    dict(key="S4", subhead=13, name="Highway waylay robbers", district="Ramanagara",
         n=6, weak_name="Ravi Kumar", weak_frac=0.6, vg="M", va=(30, 50), night=True,
         mo="The complainant was waylaid near {lm} on the state highway, threatened with a long knife, and robbed of cash and a mobile phone before the accused fled {dir}."),
    dict(key="S5", subhead=11, name="Daytime lock-break burglars", district="Tumakuru",
         n=5, weak_name="Suresh Naik", weak_frac=0.4, vg="M", va=(40, 70), night=False,
         mo="The front-door padlock was cut during daytime while the occupants were at work. Cash and gold kept near {lm} were missing on return."),
    dict(key="S6", subhead=10, name="Festival-crowd chain snatchers", district="Mandya",
         n=6, weak_name=None, weak_frac=0.0, vg="F", va=(25, 60), night=False,
         mo="In a crowded festival procession near {lm}, a gold chain was snatched from a woman devotee and the accused melted into the crowd {dir}."),
    dict(key="S7", subhead=10, name="Temple-town chain snatchers", district="Hassan",
         n=6, weak_name="Imran Pasha", weak_frac=0.35, vg="F", va=(30, 60), night=False,
         mo="Outside a temple gate near {lm}, two youths on a scooter snatched a gold chain from an elderly woman and rode off {dir} at about {t}."),
    dict(key="S8", subhead=12, name="ATM two-wheeler theft ring", district="Davanagere",
         n=6, weak_name=None, weak_frac=0.0, vg="M", va=(25, 45), night=True,
         mo="A motorcycle parked near {lm} ATM kiosk was lifted after midnight; a duplicate key appears to have been used. No CCTV coverage at the spot."),
    dict(key="S9", subhead=13, name="NH bypass knife robbers", district="Chitradurga",
         n=5, weak_name="Ravi Kumar", weak_frac=0.6, vg="M", va=(28, 55), night=True,
         mo="On the NH bypass near {lm}, lorry and car drivers were stopped, shown a knife, and relieved of cash collections before the gang escaped {dir}."),
    dict(key="S10", subhead=11, name="Compound-wall burglars", district="Belagavi",
         n=6, weak_name=None, weak_frac=0.0, vg="M", va=(35, 65), night=True,
         mo="The gang scaled the compound wall near {lm} and broke open the rear door with a crowbar, decamping with jewellery and cash while the family slept."),
    dict(key="S11", subhead=10, name="Market chain snatchers", district="Dharwad",
         n=6, weak_name="Basavaraj Patil", weak_frac=0.5, vg="F", va=(30, 55), night=False,
         mo="At the crowded main market near {lm}, a two-wheeler-borne duo snatched a mangalsutra from a shopper and sped {dir}; the pillion wore a helmet."),
    dict(key="S12", subhead=22, name="Sharp-weapon assault series", district="Kalaburagi",
         n=5, weak_name=None, weak_frac=0.0, vg="M", va=(25, 50), night=True,
         mo="An attempt was made on the complainant's life near {lm} with a sharp weapon following a land dispute; the assailants fled {dir} on a motorcycle."),
    dict(key="S13", subhead=12, name="Coastal two-wheeler theft", district="Dakshina Kannada",
         n=6, weak_name=None, weak_frac=0.0, vg="M", va=(20, 38), night=False,
         mo="A scooter parked near {lm} on the beach road was found missing; the handle lock was broken. Similar thefts reported along the coastal stretch."),
]

# ----------------------------------------------------------------------------
# Case generation
# ----------------------------------------------------------------------------
casemaster, chargesheet, accused_rows = [], [], []
victim_rows, complainant_rows, actsec_rows = [], [], []
case_id = csid = accused_id = victim_id = complainant_id = 0
serial_counter = {}
BASE_START = datetime(2024, 1, 1)
BASE_END = datetime(2026, 6, 30)
SPAN_DAYS = (BASE_END - BASE_START).days


def make_crime_no(cat_id, did, uid, when):
    key = (cat_id, did, uid, when.year)
    serial_counter[key] = serial_counter.get(key, 0) + 1
    return f"{cat_id:1d}{did:04d}{uid:04d}{when.year:04d}{serial_counter[key]:05d}"


def rand_incident_dt(night=None):
    day = BASE_START + timedelta(days=random.randint(0, SPAN_DAYS))
    if night is True:
        hour = random.choice([20, 21, 22, 23, 0, 1, 2, 3])
    elif night is False:
        hour = random.randint(9, 18)
    else:
        hour = random.randint(0, 23)
    return day.replace(hour=hour, minute=random.randint(0, 59))


def add_case(subhead, unit, incident_dt, cstype, brieffacts, vg=None, va=None, accused_name=None):
    global case_id, csid, accused_id, victim_id, complainant_id
    case_id += 1
    cmid = case_id
    head = HEAD_OF_SUBHEAD[subhead]
    gravity = 1 if subhead in HEINOUS_SUBHEADS else 2
    crime_no = make_crime_no(1, unit["_did"], unit["UnitID"], incident_dt)
    delay_h = random.randint(1, 8) if cstype != "C" else random.randint(4, 72)
    info_dt = incident_dt + timedelta(hours=delay_h)
    reg_dt = info_dt + timedelta(hours=random.randint(0, 6))
    status = {"A": 2, "B": 3, "C": 1}[cstype]
    lat = round(unit["_lat"] + random.uniform(-0.03, 0.03), 6)
    lon = round(unit["_lon"] + random.uniform(-0.03, 0.03), 6)

    casemaster.append({
        "CaseMasterID": cmid, "CrimeNo": crime_no, "CaseNo": crime_no[-9:],
        "CrimeRegisteredDate": reg_dt.isoformat(sep=" "),
        "PolicePersonID": random.choice(EMPLOYEE_IDS), "PoliceStationID": unit["UnitID"],
        "CaseCategoryID": 1, "GravityOffenceID": gravity, "CrimeMajorHeadID": head,
        "CrimeMinorHeadID": subhead, "CaseStatusID": status, "CourtID": random.choice(COURT_IDS),
        "IncidentFromDate": incident_dt.isoformat(sep=" "),
        "IncidentToDate": (incident_dt + timedelta(hours=random.randint(0, 3))).isoformat(sep=" "),
        "InfoReceivedPSDate": info_dt.isoformat(sep=" "),
        "latitude": lat, "longitude": lon, "BriefFacts": brieffacts,
    })
    csid += 1
    chargesheet.append({"CSID": csid, "CaseMasterID": cmid,
                        "csdate": (reg_dt + timedelta(days=random.randint(20, 120))).isoformat(sep=" "),
                        "cstype": cstype, "PolicePersonID": random.choice(EMPLOYEE_IDS)})
    g = vg or random.choice(["M", "F"])
    age = random.randint(*va) if va else random.randint(18, 70)
    victim_id += 1
    victim_rows.append({"VictimMasterID": victim_id, "CaseMasterID": cmid,
                        "VictimName": full_name(g), "AgeYear": age, "GenderID": g, "VictimPolice": 0})
    complainant_id += 1
    complainant_rows.append({"ComplainantID": complainant_id, "CaseMasterID": cmid,
                             "ComplainantName": full_name(g), "AgeYear": age,
                             "OccupationID": random.choice(OCCUPATION)[0],
                             "ReligionID": random.choice(RELIGION)[0],
                             "CasteID": random.choice(CASTE)[0], "GenderID": g})
    if accused_name:
        names = [accused_name]
    elif cstype == "C":
        names = ["Unknown"] if random.random() < 0.7 else [full_name("M")]
    else:
        names = [full_name(random.choice(["M", "M", "F"])) for _ in range(random.randint(1, 2))]
    for i, nm in enumerate(names, start=1):
        accused_id += 1
        accused_rows.append({"AccusedMasterID": accused_id, "CaseMasterID": cmid,
                             "AccusedName": nm, "AgeYear": random.randint(18, 45),
                             "GenderID": "M", "PersonID": f"A{i}"})
    # ER column names are ActID/SectionID (they carry the Act.ActCode / Section.SectionCode
    # values — the diagram FKs them to those code PKs).
    for ac, sc in SUBHEAD_SECTIONS[subhead]:
        actsec_rows.append({"CaseMasterID": cmid, "ActID": ac, "SectionID": sc,
                            "ActOrderID": 1, "SectionOrderID": 1})
    return cmid, crime_no


# ---- planted series (cstype='C') ----
ground_truth = []
for sd in SERIES_DEFS:
    pool = UNITS_BY_DISTRICT[DBYNAME[sd["district"]]["id"]]
    members = []
    t0 = BASE_START + timedelta(days=random.randint(30, SPAN_DAYS - 220))
    n_named = int(round(sd["n"] * sd["weak_frac"]))
    named_flags = [True] * n_named + [False] * (sd["n"] - n_named)
    random.shuffle(named_flags)
    for i in range(sd["n"]):
        unit = random.choice(pool)
        incident_dt = (t0 + timedelta(days=i * random.randint(5, 14))).replace(
            hour=random.choice([21, 22, 23, 1, 2]) if sd["night"] else random.randint(10, 17),
            minute=random.randint(0, 59))
        mo = sd["mo"].format(lm=random.choice(LANDMARKS),
                             t=incident_dt.strftime("%I:%M %p").lstrip("0"),
                             dir=random.choice(DIRECTIONS))
        acc = sd["weak_name"] if (named_flags[i] and sd["weak_name"]) else None
        cmid, crime_no = add_case(sd["subhead"], unit, incident_dt, "C", mo,
                                  vg=sd["vg"], va=sd["va"], accused_name=acc)
        members.append({"CaseMasterID": cmid, "CrimeNo": crime_no, "PoliceStationID": unit["UnitID"],
                        "IncidentFromDate": incident_dt.isoformat(sep=" "), "weak_name_present": bool(acc)})
    ground_truth.append({"series_key": sd["key"], "label": sd["name"], "subhead": sd["subhead"],
                         "district": sd["district"], "weak_name": sd["weak_name"],
                         "size": sd["n"], "members": members})

# ---- noise cases (spread across all districts) ----
N_NOISE = 1650
CSTYPE_WEIGHTS = [("A", 0.50), ("B", 0.10), ("C", 0.40)]


def pick_cstype():
    r = random.random(); acc = 0
    for c, w in CSTYPE_WEIGHTS:
        acc += w
        if r <= acc:
            return c
    return "C"


all_units = units
for _ in range(N_NOISE):
    subhead = random.choice([s[0] for s in CRIME_SUBHEAD])
    unit = random.choice(all_units)
    add_case(subhead, unit, rand_incident_dt(None), pick_cstype(), noise_mo(subhead))

# ----------------------------------------------------------------------------
# Derived tables so every ER foreign key resolves.
# ----------------------------------------------------------------------------
cs_by_case = {r["CaseMasterID"]: r["cstype"] for r in chargesheet}
acc_by_case = {}
for a in accused_rows:
    acc_by_case.setdefault(a["CaseMasterID"], []).append(a)

# ArrestSurrender + junction — for solved (charge-sheeted, cstype='A') cases with a named accused
arrest_rows, arr_acc_rows = [], []
arr_id = 0
for cm in casemaster:
    cmid = cm["CaseMasterID"]
    if cs_by_case.get(cmid) != "A":
        continue
    accs = acc_by_case.get(cmid, [])
    if not accs:
        continue
    arr_id += 1
    inc = datetime.strptime(cm["IncidentFromDate"], "%Y-%m-%d %H:%M:%S")
    did = UNIT_BY_ID[cm["PoliceStationID"]]["DistrictID"]
    arrest_rows.append(dict(
        ArrestSurrenderID=arr_id, CaseMasterID=cmid, ArrestSurrenderTypeID=random.choice([1, 2]),
        ArrestSurrenderDate=(inc + timedelta(days=random.randint(10, 120))).date().isoformat(),
        ArrestSurrenderStateId=29, ArrestSurrenderDistrictId=did, PoliceStationID=cm["PoliceStationID"],
        IOID=random.choice(EMPLOYEE_IDS), CourtID=cm["CourtID"],
        AccusedMasterID=accs[0]["AccusedMasterID"], IsAccused=1, IsComplainantAccused=0))
    for a in accs:
        arr_acc_rows.append(dict(ArrestSurrenderID=arr_id, AccusedMasterID=a["AccusedMasterID"]))

# Inv_OccuranceTime — 1:1 with CaseMaster (ER leaves columns undefined; minimal sensible set)
occ_rows = []
for i, cm in enumerate(casemaster, start=1):
    hr = int(cm["IncidentFromDate"][11:13])
    occ_rows.append(dict(InvOccuranceTimeID=i, CaseMasterID=cm["CaseMasterID"],
                         OccuranceFromDate=cm["IncidentFromDate"], OccuranceToDate=cm["IncidentToDate"],
                         DayNight="Night" if (hr >= 19 or hr < 6) else "Day"))

# CrimeHeadActSection — maps each crime head to the act-sections used under it
chas_seen, chas_rows = set(), []
for sh, secs in SUBHEAD_SECTIONS.items():
    head = HEAD_OF_SUBHEAD[sh]
    for ac, sc in secs:
        if (head, ac, sc) not in chas_seen:
            chas_seen.add((head, ac, sc))
            chas_rows.append(dict(CrimeHeadID=head, ActCode=ac, SectionCode=sc))


# ----------------------------------------------------------------------------
# Write CSVs
# ----------------------------------------------------------------------------
def write_csv(name, header, rows):
    with open(os.path.join(OUT, f"{name}.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return len(rows)


def rows(tuples, header):
    return [dict(zip(header, t)) for t in tuples]


counts = {}
counts["State"] = write_csv("State", ["StateID", "StateName", "NationalityID", "Active"],
                            rows(STATE, ["StateID", "StateName", "NationalityID", "Active"]))
counts["District"] = write_csv("District", ["DistrictID", "DistrictName", "StateID", "Active"],
                               [{"DistrictID": d["id"], "DistrictName": d["name"], "StateID": 29, "Active": 1} for d in DISTRICTS])
counts["UnitType"] = write_csv("UnitType", ["UnitTypeID", "UnitTypeName", "CityDistState", "Hierarchy", "Active"],
                               rows(UNITTYPE, ["UnitTypeID", "UnitTypeName", "CityDistState", "Hierarchy", "Active"]))
counts["Unit"] = write_csv("Unit", ["UnitID", "UnitName", "TypeID", "ParentUnit", "NationalityID", "StateID", "DistrictID", "Active"], units)
counts["Rank"] = write_csv("Rank", ["RankID", "RankName", "Hierarchy", "Active"], rows(RANK, ["RankID", "RankName", "Hierarchy", "Active"]))
counts["Designation"] = write_csv("Designation", ["DesignationID", "DesignationName", "Active", "SortOrder"], rows(DESIGNATION, ["DesignationID", "DesignationName", "Active", "SortOrder"]))
counts["Court"] = write_csv("Court", ["CourtID", "CourtName", "DistrictID", "StateID", "Active"], courts)
counts["Employee"] = write_csv("Employee", ["EmployeeID", "DistrictID", "UnitID", "RankID", "DesignationID",
    "KGID", "FirstName", "EmployeeDOB", "GenderID", "BloodGroupID", "PhysicallyChallenged", "AppointmentDate"], employees)
counts["CaseCategory"] = write_csv("CaseCategory", ["CaseCategoryID", "LookupValue"], rows(CASE_CATEGORY, ["CaseCategoryID", "LookupValue"]))
counts["GravityOffence"] = write_csv("GravityOffence", ["GravityOffenceID", "LookupValue"], rows(GRAVITY, ["GravityOffenceID", "LookupValue"]))
counts["CaseStatusMaster"] = write_csv("CaseStatusMaster", ["CaseStatusID", "CaseStatusName"], rows(CASE_STATUS, ["CaseStatusID", "CaseStatusName"]))
counts["CrimeHead"] = write_csv("CrimeHead", ["CrimeHeadID", "CrimeGroupName", "Active"], rows(CRIME_HEAD, ["CrimeHeadID", "CrimeGroupName", "Active"]))
counts["CrimeSubHead"] = write_csv("CrimeSubHead", ["CrimeSubHeadID", "CrimeHeadID", "CrimeHeadName", "SeqID"], rows(CRIME_SUBHEAD, ["CrimeSubHeadID", "CrimeHeadID", "CrimeHeadName", "SeqID"]))
counts["Act"] = write_csv("Act", ["ActCode", "ActDescription", "ShortName", "Active"], rows(ACT, ["ActCode", "ActDescription", "ShortName", "Active"]))
counts["Section"] = write_csv("Section", ["ActCode", "SectionCode", "SectionDescription", "Active"], rows(SECTION, ["ActCode", "SectionCode", "SectionDescription", "Active"]))
counts["OccupationMaster"] = write_csv("OccupationMaster", ["OccupationID", "OccupationName"], rows(OCCUPATION, ["OccupationID", "OccupationName"]))
counts["ReligionMaster"] = write_csv("ReligionMaster", ["ReligionID", "ReligionName"], rows(RELIGION, ["ReligionID", "ReligionName"]))
counts["CasteMaster"] = write_csv("CasteMaster", ["caste_master_id", "caste_master_name"], rows(CASTE, ["caste_master_id", "caste_master_name"]))
counts["CaseMaster"] = write_csv("CaseMaster",
    ["CaseMasterID", "CrimeNo", "CaseNo", "CrimeRegisteredDate", "PolicePersonID", "PoliceStationID",
     "CaseCategoryID", "GravityOffenceID", "CrimeMajorHeadID", "CrimeMinorHeadID", "CaseStatusID",
     "CourtID", "IncidentFromDate", "IncidentToDate", "InfoReceivedPSDate", "latitude", "longitude", "BriefFacts"], casemaster)
counts["ChargesheetDetails"] = write_csv("ChargesheetDetails", ["CSID", "CaseMasterID", "csdate", "cstype", "PolicePersonID"], chargesheet)
counts["Accused"] = write_csv("Accused", ["AccusedMasterID", "CaseMasterID", "AccusedName", "AgeYear", "GenderID", "PersonID"], accused_rows)
counts["Victim"] = write_csv("Victim", ["VictimMasterID", "CaseMasterID", "VictimName", "AgeYear", "GenderID", "VictimPolice"], victim_rows)
counts["ComplainantDetails"] = write_csv("ComplainantDetails", ["ComplainantID", "CaseMasterID", "ComplainantName", "AgeYear", "OccupationID", "ReligionID", "CasteID", "GenderID"], complainant_rows)
counts["ActSectionAssociation"] = write_csv("ActSectionAssociation", ["CaseMasterID", "ActID", "SectionID", "ActOrderID", "SectionOrderID"], actsec_rows)
counts["CrimeHeadActSection"] = write_csv("CrimeHeadActSection", ["CrimeHeadID", "ActCode", "SectionCode"], chas_rows)
counts["ArrestSurrender"] = write_csv("ArrestSurrender", ["ArrestSurrenderID", "CaseMasterID", "ArrestSurrenderTypeID",
    "ArrestSurrenderDate", "ArrestSurrenderStateId", "ArrestSurrenderDistrictId", "PoliceStationID", "IOID",
    "CourtID", "AccusedMasterID", "IsAccused", "IsComplainantAccused"], arrest_rows)
counts["inv_arrestsurrenderaccused"] = write_csv("inv_arrestsurrenderaccused", ["ArrestSurrenderID", "AccusedMasterID"], arr_acc_rows)
counts["Inv_OccuranceTime"] = write_csv("Inv_OccuranceTime", ["InvOccuranceTimeID", "CaseMasterID", "OccuranceFromDate", "OccuranceToDate", "DayNight"], occ_rows)

json.dump({"planted_series": ground_truth}, open(os.path.join(HERE, "ground_truth_series.json"), "w"), indent=2)

n_c = sum(1 for r in chargesheet if r["cstype"] == "C")
n_planted = sum(len(g["members"]) for g in ground_truth)
print("=== CLink statewide synthetic seed ===")
print(f"  districts: {len(DISTRICTS)}  stations: {len(units)}")
print(f"  Total FIRs: {len(casemaster)}  |  undetected (C): {n_c} ({100*n_c/len(chargesheet):.0f}%)")
print(f"  planted series: {len(ground_truth)}  ({n_planted} cases)")
print(f"  CSVs: {OUT}")
