"""
CLink API gateway — Catalyst AdvancedIO function (Python).

The public API layer (CLINK_CONTEXT sec.2): the React app calls THIS; it orchestrates
the crimelink-engine (AppSail) and returns JSON with CORS. Kept thin on purpose —
the heavy ML lives in the engine; here we route, add CORS, and (optionally) cache.

Routing: AdvancedIO delivers the sub-path in request.path. We forward to the engine.

Env:
  ENGINE_URL   base URL of the crimelink-engine AppSail (e.g. https://<app>.catalyst...)
               defaults to http://localhost:9055 for local `catalyst serve` / dev.
"""
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

from flask import Request, jsonify, make_response

logger = logging.getLogger()
ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:9055").rstrip("/")
TIMEOUT = 30

# incoming API path -> engine path. `*` = tail passthrough.
ROUTES = {
    "/health": "/",
    "/stats": "/stats",
    "/series": "/series",
    "/series/*": "/series/*",
    "/case/*/series": "/case/*/series",
    "/cases/undetected": "/cases/undetected",
    "/districts": "/districts",
    "/query": "/query",
    "/recompute": "/run",
}


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return resp


def _json(payload, status=200):
    return _cors(make_response(jsonify(payload), status))


def _engine(path, method="GET", query="", body=None):
    url = f"{ENGINE_URL}{path}"
    if query:
        url += "?" + query
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode()), r.status


def _match(path):
    """Return engine path for an incoming API path, or None."""
    path = path.rstrip("/") or "/"
    for pat, target in ROUTES.items():
        pp, tp = pat.split("/"), target.split("/")
        segs = path.split("/")
        if len(pp) != len(segs):
            continue
        ok, out = True, []
        for pseg, seg in zip(pp, segs):
            if pseg == "*":
                out.append(seg)
            elif pseg != seg:
                ok = False
                break
        if ok:
            # substitute wildcards into target
            wild = iter(out)
            resolved = "/".join(next(wild) if t == "*" else t for t in tp)
            return resolved if resolved.startswith("/") else "/" + resolved
    return None


def handler(request: Request):
    # strip an optional /api prefix so both /api/stats and /stats work
    path = request.path or "/"
    if path.startswith("/api"):
        path = path[4:] or "/"

    if request.method == "OPTIONS":
        return _cors(make_response("", 204))

    if path in ("/", "/health"):
        return _json({"status": "ok", "service": "crimelink-api",
                      "engine_url": ENGINE_URL})

    target = _match(path)
    if target is None:
        return _json({"error": "unknown route", "path": path}, 404)

    try:
        body = None
        if request.method == "POST":
            body = request.get_json(force=True, silent=True) or {}
        query = request.query_string.decode() if request.query_string else ""
        payload, status = _engine(target, method=request.method, query=query, body=body)
        return _json(payload, status)
    except urllib.error.HTTPError as e:
        return _json({"error": "engine error", "status": e.code,
                      "detail": e.read().decode()[:300]}, e.code)
    except Exception as e:  # noqa: BLE001
        logger.exception("gateway failure")
        return _json({"error": "gateway failure", "detail": str(e),
                      "engine_url": ENGINE_URL}, 502)
