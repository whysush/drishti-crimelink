"""
CLink engine — AppSail Flask service (Catalyst managed runtime).

Heavy ML lives here: fingerprint -> composite similarity -> clustering -> ranked,
evidence-backed series. The crimelink_function orchestrates and caches; this
service computes.

Data sources (auto):
  - DATA_DIR (bundled seed CSVs) loaded on startup  -> demo works immediately
  - POST /run {tables:{...}} -> recompute from caller-supplied rows (Datastore path)

Endpoints:
  GET  /                      health + cache status
  GET  /stats                 dataset + series summary
  GET  /series?limit=N        ranked series (evidence-backed)
  GET  /series/<series_id>    one series + inferred network edges
  GET  /case/<id>/series      THE HERO: the series a given undetected case is in
  GET  /cases/undetected      undetected cases (for map / picker)
  POST /run {tables,params}   recompute from supplied rows; refresh cache
"""
import logging
import os
import threading

from flask import Flask, jsonify, request

from engine.data import CSVBackend, DatastoreBackend, build_cases
from engine.linkage import edges_for_series
from engine.nlquery import answer as nl_answer
from engine.pipeline import run, series_for_case

app = Flask(__name__)


@app.after_request
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return resp

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.getenv("CLINK_DATA_DIR", os.path.join(HERE, "data", "seed_csv"))

_LOCK = threading.Lock()
_CACHE = {"fp": None, "series": None, "cases": None, "params": None, "source": None}
_LOG = logging.getLogger()

# CLINK_SOURCE: "auto" (try Data Store, fall back to CSV), "datastore", or "csv"
SOURCE = os.getenv("CLINK_SOURCE", "auto").lower()


def _public_series(s):
    return {k: v for k, v in s.items() if k != "_member_idx"}


def _load_cases():
    """Return (cases, source_label). Prefers Catalyst Data Store; CSV fallback."""
    if SOURCE in ("auto", "datastore"):
        try:
            import zcatalyst_sdk
            zapp = zcatalyst_sdk.initialize()
            cases = DatastoreBackend(zapp).load()
            if cases:
                return cases, "datastore"
            _LOG.warning("Data Store returned 0 cases; falling back to CSV")
        except Exception as e:  # noqa: BLE001
            _LOG.warning("Data Store load failed (%s); falling back to CSV", e)
        if SOURCE == "datastore":
            return [], "datastore(empty)"
    if os.path.isdir(DATA_DIR):
        return CSVBackend(DATA_DIR).load(), "bundled-csv"
    return [], "none"


def _compute(cases, params=None, source=None):
    fp, series = run(cases, params)
    with _LOCK:
        _CACHE.update(fp=fp, series=series, cases=cases, params=params)
        if source is not None:
            _CACHE["source"] = source
    return series


def _ensure_loaded():
    if _CACHE["series"] is None:
        cases, source = _load_cases()
        _compute(cases, source=source)


@app.get("/")
def health():
    return jsonify(status="ok", service="crimelink-engine",
                   loaded=_CACHE["series"] is not None,
                   data_source=_CACHE["source"], source_pref=SOURCE,
                   n_cases=len(_CACHE["cases"] or []),
                   n_series=len(_CACHE["series"] or []),
                   data_dir_present=os.path.isdir(DATA_DIR))


@app.get("/stats")
def stats():
    _ensure_loaded()
    series = _CACHE["series"] or []
    cases = _CACHE["cases"] or []
    stations = {c["police_station_id"] for c in cases}
    districts = {c["district_name"] for c in cases if c["district_name"]}
    linked = sum(s["size"] for s in series)
    heinous = sum(1 for s in series if s["gravity"] == "Heinous")
    cross = sum(1 for s in series if s["n_stations"] >= 2)
    return jsonify(
        undetected_cases=len(cases), stations=len(stations), districts=len(districts),
        series=len(series), cross_jurisdiction_series=cross, heinous_series=heinous,
        cases_in_series=linked, data_source=_CACHE["source"],
        pct_cases_linked=round(100 * linked / len(cases), 1) if cases else 0)


@app.get("/series")
def list_series():
    _ensure_loaded()
    limit = request.args.get("limit", type=int)
    series = _CACHE["series"] or []
    out = [_public_series(s) for s in series]
    return jsonify(count=len(out), series=out[:limit] if limit else out)


@app.get("/series/<series_id>")
def get_series(series_id):
    _ensure_loaded()
    for s in _CACHE["series"] or []:
        if s["series_id"] == series_id:
            return jsonify({**_public_series(s),
                            "edges": edges_for_series(_CACHE["fp"], s)})
    return jsonify(error="series not found"), 404


@app.get("/case/<case_master_id>/series")
def case_series(case_master_id):
    _ensure_loaded()
    res = series_for_case(_CACHE["fp"], _CACHE["series"] or [], case_master_id)
    if res is None:
        return jsonify(linked=False, case_master_id=case_master_id,
                       message="No linked series found for this case."), 200
    return jsonify(linked=True, **res)


@app.get("/districts")
def districts():
    """Per-district aggregates for the map choropleth + hover cards."""
    _ensure_loaded()
    cases = _CACHE["cases"] or []
    series = _CACHE["series"] or []
    agg = {}
    for c in cases:
        did = c["district_id"]
        if did is None:
            continue
        d = agg.setdefault(did, {"district_id": did, "district": c["district_name"],
                                 "unsolved": 0, "heinous": 0, "in_series": 0,
                                 "lat": c["lat"], "lon": c["lon"], "groups": set()})
        d["unsolved"] += 1
        if c["gravity"] == "Heinous":
            d["heinous"] += 1
    in_series_ids = set()
    for s in series:
        for cid in s["member_case_ids"]:
            in_series_ids.add(cid)
        for dn in s["districts"]:
            for d in agg.values():
                if d["district"] == dn:
                    d["groups"].add(s["series_id"])
    id_to_did = {c["case_master_id"]: c["district_id"] for c in cases}
    for cid in in_series_ids:
        did = id_to_did.get(cid)
        if did in agg:
            agg[did]["in_series"] += 1
    out = []
    for d in agg.values():
        d["groups"] = sorted(d["groups"])
        d["n_groups"] = len(d["groups"])
        out.append(d)
    out.sort(key=lambda d: -d["unsolved"])
    return jsonify(count=len(out), districts=out)


@app.get("/cases/undetected")
def undetected():
    _ensure_loaded()
    in_series = {cid for s in (_CACHE["series"] or []) for cid in s["member_case_ids"]}
    out = []
    for c in _CACHE["cases"] or []:
        out.append({
            "case_master_id": c["case_master_id"], "crime_no": c["crime_no"],
            "station": c["station_name"], "district": c["district_name"],
            "district_id": c["district_id"],
            "lat": c["lat"], "lon": c["lon"], "minor_head": c["minor_head"],
            "gravity": c["gravity"], "incident_from":
                c["incident_from"].isoformat(sep=" ") if c["incident_from"] else None,
            "in_series": c["case_master_id"] in in_series,
        })
    return jsonify(count=len(out), cases=out)


@app.route("/query", methods=["GET", "POST"])
def query():
    _ensure_loaded()
    if request.method == "POST":
        body = request.get_json(force=True, silent=True) or {}
        q = body.get("q") or body.get("question", "")
    else:
        q = request.args.get("q", "")
    res = nl_answer(_CACHE["cases"] or [], _CACHE["series"] or [], q)
    return jsonify(question=q, **res)


@app.post("/run")
def run_endpoint():
    body = request.get_json(force=True, silent=True) or {}
    rows = body.get("tables")
    params = body.get("params")
    if rows:  # caller supplied raw Data Store tables
        cases = build_cases(rows["CaseMaster"], rows["ChargesheetDetails"],
                            rows.get("Accused", []), rows.get("Victim", []),
                            rows.get("ComplainantDetails", []),
                            rows.get("ActSectionAssociation", []), rows["labels"])
        series = _compute(cases, params, source="posted")
    else:  # force a fresh reload from the configured source (Data Store or CSV)
        cases, source = _load_cases()
        series = _compute(cases, params, source=source)
    return jsonify(ok=True, n_cases=len(cases), n_series=len(series), data_source=_CACHE["source"])


listen_port = int(os.getenv("X_ZOHO_CATALYST_LISTEN_PORT", 9000))
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=listen_port)
