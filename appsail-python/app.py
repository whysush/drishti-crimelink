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
  GET  /case/<id>             one case file (+ the group it sits in)
  GET  /persons               cross-FIR persons of interest (name resolution)
  POST /match                 LIVE TRIAGE: score a new FIR against every group
  GET  /validation            measured accuracy, signal ablation, limitations
  GET  /brief/<series_id>     printable case brief (PDF, or HTML with ?format=html)
  GET  /hotspots              spatiotemporal clusters (place x time-of-day)
  GET  /stations              station-level rollup for district drill-down
  GET  /alerts                emerging-trend spikes vs historical baseline
  GET  /risk                  predictive district risk scores (red zones)
  GET  /network               multi-entity link graph + suspected associations
  GET  /anomalies             incidents deviating from their own crime type
  GET  /socio                 socio-economic correlation (Census 2011 overlay)
  POST /run {tables,params}   recompute from supplied rows; refresh cache
"""
import logging
import os
import threading

from flask import Flask, Response, jsonify, request

from engine import anomaly as anomaly_mod
from engine import hotspots as hotspots_mod
from engine import network as network_mod
from engine import socio as socio_mod
from engine import trends as trends_mod
from engine.data import CSVBackend, DatastoreBackend, build_cases
from engine.linkage import edges_for_series
from engine.nlquery import answer as nl_answer
from engine.persons import resolve as resolve_persons
from engine.pipeline import run, series_for_case
from engine.triage import match as triage_match
from engine.validation import report as validation_report

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
_CACHE = {"fp": None, "series": None, "cases": None, "params": None, "source": None,
          "persons": None, "validation": None,
          # the analytical side runs over ALL FIRs, not just the undetected spine
          "all_cases": None, "hotspots": None, "analytics": None}
GT_PATH = os.path.join(HERE, "data", "ground_truth_series.json")
_LOG = logging.getLogger()

# CLINK_SOURCE: "auto" (try Data Store, fall back to CSV), "datastore", or "csv"
SOURCE = os.getenv("CLINK_SOURCE", "auto").lower()


def _public_series(s):
    return {k: v for k, v in s.items() if k != "_member_idx"}


def _find_case(ident):
    """Resolve either a CaseMasterID or a CrimeNo. Investigators know the FIR
    number; the internal primary key is an implementation detail to them."""
    key = str(ident).strip()
    for c in _CACHE["cases"] or []:
        if str(c["case_master_id"]) == key or str(c["crime_no"]) == key:
            return c
    return None


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
        _CACHE.update(fp=fp, series=series, cases=cases, params=params,
                      persons=None, validation=None,
                      hotspots=None, analytics=None)
        if source is not None:
            _CACHE["source"] = source
    return series


def _ensure_loaded():
    if _CACHE["series"] is None:
        cases, source = _load_cases()
        _compute(cases, source=source)


def _all_cases():
    """Every FIR, not just the undetected spine.

    Hotspots, trend baselines and socio-economic rates are meaningless if they
    only see unsolved cases — a "spike" would then be measured against a
    population that silently excludes everything the police cleared.
    """
    if _CACHE["all_cases"] is None:
        rows = []
        if SOURCE in ("auto", "datastore"):
            try:
                import zcatalyst_sdk
                rows = DatastoreBackend(zcatalyst_sdk.initialize()).load(only_undetected=False)
            except Exception as e:  # noqa: BLE001
                _LOG.warning("Data Store all-case load failed (%s); using CSV", e)
        if not rows and os.path.isdir(DATA_DIR):
            rows = CSVBackend(DATA_DIR).load(only_undetected=False)
        with _LOCK:
            _CACHE["all_cases"] = rows or (_CACHE["cases"] or [])
    return _CACHE["all_cases"]


def _horizon(cases):
    return max((c["incident_from"] for c in cases if c["incident_from"]), default=None)


def _ensure_hotspots():
    if _CACHE["hotspots"] is None:
        allc = _all_cases()
        hs = hotspots_mod.find(allc, horizon=_horizon(allc))
        with _LOCK:
            _CACHE["hotspots"] = hs
    return _CACHE["hotspots"]


def _ensure_persons():
    if _CACHE["persons"] is None:
        with _LOCK:
            _CACHE["persons"] = resolve_persons(_CACHE["cases"] or [], _CACHE["series"] or [])
    return _CACHE["persons"]


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
    c = _find_case(case_master_id)
    res = (series_for_case(_CACHE["fp"], _CACHE["series"] or [], c["case_master_id"])
           if c else None)
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


@app.get("/hotspots")
def hotspots():
    """Spatiotemporal clusters — where AND when, so patrols can be timed."""
    _ensure_loaded()
    hs = _ensure_hotspots()
    limit = request.args.get("limit", type=int)
    return jsonify(count=len(hs), hotspots=hs[:limit] if limit else hs,
                   method=("DBSCAN over a combined space where time-of-day is encoded "
                           "on a circle and scaled into kilometres, so 23:00 and 01:00 "
                           "are neighbours and a cluster means same place AND same hour"),
                   scanned_cases=len(_all_cases()))


@app.get("/stations")
def stations():
    """Station-level rollup — the district -> police-station drill-down."""
    _ensure_loaded()
    allc = _all_cases()
    rows = hotspots_mod.by_station(allc)
    did = request.args.get("district_id", type=int)
    if did is not None:
        rows = [r for r in rows if r["district_id"] == did]
    return jsonify(count=len(rows), stations=rows)


@app.get("/alerts")
def alerts():
    """Emerging-trend alerts: category spikes against that region's own baseline."""
    _ensure_loaded()
    allc = _all_cases()
    hz = _horizon(allc)
    window = request.args.get("window", default=trends_mod.RECENT_DAYS, type=int)
    sp = trends_mod.spikes(allc, hz, recent_days=window)
    em = trends_mod.emerging_typologies(allc, hz, recent_days=window)
    return jsonify(
        count=len(sp), window_days=window,
        reference_date=hz.isoformat(sep=" ", timespec="minutes") if hz else None,
        spikes=sp, emerging=em,
        method=("counts in the recent window are compared with the mean of the six "
                "preceding windows for the same district and crime type, scored as a "
                "Poisson z-score; pairs with too little history to support a claim are "
                "dropped rather than reported as trends"))


@app.get("/risk")
def risk():
    """Predictive district risk scores — what drives the red zones on the map."""
    _ensure_loaded()
    allc = _all_cases()
    rows = trends_mod.district_risk(allc, _horizon(allc), _ensure_hotspots(),
                                    _CACHE["series"] or [])
    return jsonify(count=len(rows), districts=rows,
                   method=("a weighted blend of recent volume against baseline, hotspot "
                           "pressure, unsolved burden, active linked groups and heinous "
                           "share; every district ships the breakdown that produced it"))


@app.get("/network")
def network():
    """Multi-entity link graph: incidents, persons, stations and MO signatures."""
    _ensure_loaded()
    people = _ensure_persons()
    cap = request.args.get("max_cases", default=260, type=int)
    g = network_mod.build(_CACHE["cases"] or [], _CACHE["series"] or [], people, max_cases=cap)
    assoc = network_mod.associations(people, _CACHE["cases"] or [])
    return jsonify(nodes=g["nodes"], edges=g["edges"],
                   counts=dict(g["counts"]), capped_at=g["capped_at"],
                   total_cases=g["total_cases"],
                   associations=assoc[:40], association_count=len(assoc))


@app.get("/anomalies")
def anomalies():
    """Incidents that do not behave like their own crime type."""
    _ensure_loaded()
    allc = _all_cases()
    limit = request.args.get("limit", default=40, type=int)
    return jsonify(**anomaly_mod.detect(allc, _horizon(allc), limit=limit))


@app.get("/socio")
def socio():
    """Socio-economic overlay: Census 2011 indicators against computed crime rates."""
    _ensure_loaded()
    allc = _all_cases()
    return jsonify(**socio_mod.correlate(allc, _horizon(allc)))


@app.get("/persons")
def persons():
    """Cross-FIR persons of interest.

    The schema has no global offender ID, so the same name in six FIRs is six
    unrelated strings. This surfaces the recurrences — as a name-string inference,
    never an identity claim.
    """
    _ensure_loaded()
    people = _ensure_persons() or []
    limit = request.args.get("limit", type=int)
    cross_only = request.args.get("cross_station") in ("1", "true", "yes")
    out = [p for p in people if p["cross_station"]] if cross_only else people
    return jsonify(count=len(out), cross_station=sum(1 for p in people if p["cross_station"]),
                   persons=out[:limit] if limit else out)


@app.get("/case/<case_master_id>")
def case_detail(case_master_id):
    """One case file, with the group it belongs to if any."""
    _ensure_loaded()
    c = _find_case(case_master_id)
    if c is not None:
            grp = None
            for s in _CACHE["series"] or []:
                if c["case_master_id"] in s["member_case_ids"]:
                    grp = {"series_id": s["series_id"], "title": s["title"],
                           "size": s["size"], "priority": s["priority"],
                           "n_stations": s["n_stations"]}
                    break
            return jsonify(
                case_master_id=c["case_master_id"], crime_no=c["crime_no"],
                station=c["station_name"], district=c["district_name"],
                district_id=c["district_id"], lat=c["lat"], lon=c["lon"],
                major_head=c["major_head"], minor_head=c["minor_head"],
                gravity=c["gravity"], brief_facts=c["brief_facts"],
                act_sections=sorted(c["act_sections"]),
                accused_names=c["accused_names"], victims=c["victims"],
                incident_from=c["incident_from"].isoformat(sep=" ") if c["incident_from"] else None,
                info_received=c["info_received"].isoformat(sep=" ") if c["info_received"] else None,
                reporting_delay_h=(round(c["reporting_delay_h"], 1)
                                   if c["reporting_delay_h"] is not None else None),
                group=grp)
    return jsonify(error="case not found"), 404


@app.route("/match", methods=["POST", "OPTIONS"])
def match_new_fir():
    """LIVE TRIAGE — score an incoming FIR against every known group.

    Body: {brief_facts, minor_head_id, lat, lon, incident_from, act_sections,
           victims:[{age,gender}], accused_names:[]}
    """
    if request.method == "OPTIONS":
        return ("", 204)
    _ensure_loaded()
    body = request.get_json(force=True, silent=True) or {}

    dt = None
    raw = (body.get("incident_from") or "").strip()
    if raw:
        from datetime import datetime
        for f in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(raw, f)
                break
            except ValueError:
                continue

    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    new_case = {
        "brief_facts": body.get("brief_facts") or "",
        "minor_head_id": body.get("minor_head_id"),
        "lat": _f(body.get("lat")), "lon": _f(body.get("lon")),
        "incident_from": dt,
        "act_sections": set(body.get("act_sections") or []),
        "victims": body.get("victims") or [],
        "accused_names": [n for n in (body.get("accused_names") or []) if n],
    }
    res = triage_match(_CACHE["fp"], _CACHE["series"] or [], new_case,
                       limit=request.args.get("limit", default=5, type=int))
    return jsonify(**res)


@app.get("/brief/<series_id>")
def brief_endpoint(series_id):
    """Case brief as a real PDF.

    Rendered here rather than in the API gateway on purpose: fpdf2 drags in
    fontTools and Pillow (~36MB), which is fine alongside scikit-learn but turned
    the thin gateway function's cold start into a timeout. The gateway proxies the
    bytes.
    """
    _ensure_loaded()
    target = None
    for s in _CACHE["series"] or []:
        if s["series_id"] == series_id:
            target = _public_series(s)
            break
    if target is None:
        return jsonify(error="series not found", series_id=series_id), 404

    import brief as brief_doc
    if request.args.get("format") == "html":
        return Response(brief_doc.render(target), mimetype="text/html; charset=utf-8")

    import pdfdoc
    try:
        data = pdfdoc.render(target)
    except Exception as e:  # noqa: BLE001 — an export must still hand back a document
        _LOG.exception("pdf render failed")
        return Response(brief_doc.render(target), mimetype="text/html; charset=utf-8",
                        headers={"X-Drishti-Pdf-Fallback": type(e).__name__})
    return Response(data, mimetype="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{series_id}-case-brief.pdf"',
        "X-Drishti-Pdf-Renderer": "fpdf2",
    })


@app.get("/validation")
def validation():
    """Measured accuracy, per-signal ablation, forecast back-test, limitations."""
    _ensure_loaded()
    if _CACHE["validation"] is None:
        gt = None
        if os.path.isfile(GT_PATH):
            try:
                import json
                with open(GT_PATH) as fh:
                    gt = json.load(fh)
            except Exception as e:  # noqa: BLE001
                _LOG.warning("ground truth unreadable (%s)", e)
        rep = validation_report(_CACHE["fp"], _CACHE["series"] or [],
                                _CACHE["cases"] or [], gt, _CACHE["params"])
        with _LOCK:
            _CACHE["validation"] = rep
    return jsonify(**_CACHE["validation"], data_source=_CACHE["source"])


listen_port = int(os.getenv("X_ZOHO_CATALYST_LISTEN_PORT", 9000))
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=listen_port)
