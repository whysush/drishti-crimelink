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
import base64
import gzip
import hashlib
import json
import logging
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from flask import Request, jsonify, make_response

import rbac

logger = logging.getLogger()

# Belt and braces: the Catalyst SDK makes HTTP calls without an explicit timeout,
# so a slow service could hang a request until the platform killed the whole
# function. urllib calls that pass their own timeout are unaffected by this.
socket.setdefaulttimeout(8)
ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:9055").rstrip("/")
# Must stay comfortably inside the function's own execution limit. At 60s a cold
# engine (~12s to load and cluster) could leave the gateway still waiting when the
# platform killed it, which surfaced as EXECUTION_TIME_EXCEEDED / 408 rather than
# an error the client could act on. Failing fast lets us answer "warming" instead.
TIMEOUT = 18

# incoming API path -> engine path. `*` = tail passthrough.
ROUTES = {
    "/health": "/",
    "/stats": "/stats",
    "/series": "/series",
    "/series/*": "/series/*",
    "/case/*/series": "/case/*/series",
    "/case/*": "/case/*",
    "/cases/undetected": "/cases/undetected",
    "/districts": "/districts",
    "/query": "/query",
    "/persons": "/persons",
    "/match": "/match",
    "/validation": "/validation",
    "/hotspots": "/hotspots",
    "/stations": "/stations",
    "/alerts": "/alerts",
    "/risk": "/risk",
    "/network": "/network",
    "/anomalies": "/anomalies",
    "/socio": "/socio",
    "/recompute": "/run",
}


# ---- Catalyst Cache -------------------------------------------------------
# The engine reclusters the whole undetected corpus; the answers change only when
# the data does. Cached in Catalyst Cache (default segment, so nothing needs
# provisioning) with an in-process fallback, because a cache being unavailable
# must slow the app down, never break it.
CACHEABLE = {"/stats", "/districts", "/series", "/cases/undetected", "/persons",
             "/validation", "/hotspots", "/risk", "/anomalies", "/socio", "/network"}
CACHE_TTL_HOURS = int(os.getenv("CLINK_CACHE_TTL_HOURS", "6"))
# Measured, not assumed: a 12KB compressed value round-trips through the shared
# cache, a 35KB one is accepted on write and then never returned. So we only send
# what is known to survive; anything larger stays in per-instance memory and says
# so in the X-Drishti-Cache header rather than silently pretending to be cached.
CACHE_MAX_BYTES = 30_000
_LOCAL_CACHE = {}
_DIST_CACHE = {}
_LAST_CACHE_ERR = {"e": None}


def _sdk(req=None, scope="admin"):
    """Initialised Catalyst SDK app, or None.

    The request must be passed through: the SDK lifts its credentials off the
    Catalyst-injected headers on that request, and without it the admin token is
    never resolved.
    """
    import zcatalyst_sdk
    return zcatalyst_sdk.initialize(scope=scope, req=req)


# Response caching through Catalyst Cache is OFF by default.
#
# It saved very little — the engine answers in about a second and already caches in
# process — while putting a network call with no timeout of ours in the hot path of
# every read. When that call hung it tied up the gateway's instances until even
# /health, which touches nothing, queued past the execution limit and 408'd. A
# cache that can take the whole API down is not worth the millisecond.
#
# Set CLINK_CACHE=1 to turn it back on.
CACHE_ENABLED = os.getenv("CLINK_CACHE", "0") == "1"
_CACHE_OFF = {"v": not CACHE_ENABLED}


def _cache_segment(req=None):
    if _CACHE_OFF["v"]:
        return None
    try:
        return _sdk(req).cache().segment()
    except Exception as e:  # noqa: BLE001
        logger.info("catalyst cache unavailable (%s)", type(e).__name__)
        _CACHE_OFF["v"] = True
        return None


def _cache_key(path, query):
    """A cache key made only of characters the cache is guaranteed to round-trip.

    Punctuation in keys was silently accepted on write and then never matched on
    read, so keys are slugged to word characters and any query string is folded in
    as a short digest rather than carried literally.
    """
    slug = re.sub(r"\W+", "_", path.strip("/")) or "root"
    if query:
        slug += "_" + hashlib.sha1(query.encode()).hexdigest()[:10]
    return "drishti_" + slug


def _encode(payload):
    """gzip + base64 the JSON.

    The series and case lists run past the per-key cache limit uncompressed, which
    pushed them into per-instance memory that a serverless instance change throws
    away. Compressed they fit, so every instance shares one warm answer.
    """
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return "gz:" + base64.b64encode(gzip.compress(raw, 6)).decode()


def _decode(blob):
    if blob.startswith("gz:"):
        return json.loads(gzip.decompress(base64.b64decode(blob[3:])))
    return json.loads(blob)


def _cache_get(key, req=None):
    """Return (payload, source). The source is echoed on the response so cache
    behaviour is observable in production rather than taken on trust."""
    seg = _cache_segment(req)
    if seg is not None:
        try:
            raw = seg.get_value(key)
            if raw:
                return _decode(raw), "catalyst-cache"
        except Exception as e:  # noqa: BLE001
            logger.info("cache read miss (%s)", type(e).__name__)
    hit = _LOCAL_CACHE.get(key)
    return (hit, "local-cache") if hit is not None else (None, None)


def _cache_put(key, payload, req=None):
    try:
        blob = _encode(payload)
    except (TypeError, ValueError):
        return
    _LOCAL_CACHE[key] = payload
    if len(blob) > CACHE_MAX_BYTES:
        logger.info("too large for shared cache (%d B): %s", len(blob), key)
        return
    seg = _cache_segment(req)
    if seg is None:
        _LAST_CACHE_ERR["e"] = "no segment"
        return
    try:
        seg.put(key, blob, CACHE_TTL_HOURS)
        _LAST_CACHE_ERR["e"] = None
    except Exception as e:  # noqa: BLE001
        _LAST_CACHE_ERR["e"] = f"{type(e).__name__}: {str(e)[:160]}"
        logger.info("cache write skipped (%s)", _LAST_CACHE_ERR["e"])


def _cache_flush(req=None):
    _LOCAL_CACHE.clear()
    _DIST_CACHE.clear()
    seg = _cache_segment(req)
    if seg is None:
        return
    for path in CACHEABLE:
        try:
            seg.delete(_cache_key(path, ""))
        except Exception:  # noqa: BLE001
            pass


def _catalyst_user(req=None):
    """The signed-in Catalyst user, or None.

    Only attempted when authentication is actually enforced. Resolving a user costs
    a network round-trip to Catalyst, and in demo mode the answer cannot change the
    outcome — the gateway serves a configured role either way. Paying for that call
    on every request made even /health time out, so it is now skipped unless the
    answer can matter.
    """
    if rbac.AUTH_MODE != "enforced":
        return None
    try:
        return _sdk(req, scope="user").authentication().get_current_user()
    except Exception as e:  # noqa: BLE001 — no signed-in user is a normal state
        logger.info("no catalyst user (%s)", type(e).__name__)
        return None


def _district_names(did):
    """Map a district id to its name, for filtering series by district name."""
    if not _DIST_CACHE:
        try:
            payload, _ = _engine("/districts")
            for d in payload.get("districts", []):
                _DIST_CACHE[d["district_id"]] = d["district"]
        except Exception:  # noqa: BLE001
            return set()
    name = _DIST_CACHE.get(did)
    return {name} if name else set()


def _scope_to_district(path, payload, identity):
    """Trim a response to the caller's jurisdiction.

    Investigators work a district. Handing them the whole state is more data than
    the job needs, and least-privilege over personal data is not a nicety in
    policing. Analysts and supervisors are unscoped by design.
    """
    did = identity.get("district_id")
    if identity["role"] != "investigator" or did is None or not isinstance(payload, dict):
        return payload
    if path == "/cases/undetected" and "cases" in payload:
        kept = [c for c in payload["cases"] if c.get("district_id") == did]
        payload["cases"], payload["count"] = kept, len(kept)
        payload["scoped_to_district"] = did
    elif path == "/districts" and "districts" in payload:
        kept = [d for d in payload["districts"] if d.get("district_id") == did]
        payload["districts"], payload["count"] = kept, len(kept)
        payload["scoped_to_district"] = did
    elif path == "/series" and "series" in payload:
        names = _district_names(did)
        kept = [g for g in payload["series"]
                if not names or set(g.get("districts", [])) & names]
        payload["series"], payload["count"] = kept, len(kept)
        payload["scoped_to_district"] = did
    return payload


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


def _engine_raw(path, query=""):
    """Fetch a non-JSON body from the engine (the PDF brief) with its headers."""
    url = f"{ENGINE_URL}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read(), r.status, dict(r.headers)


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

    # Absolute first thing, before identity or routing touches anything. If this is
    # slow the problem is the function starting up, not our code inside it.
    if path == "/ping":
        return _cors(make_response(jsonify(pong=True), 200))

    if path.startswith("/api"):
        path = path[4:] or "/"

    if request.method == "OPTIONS":
        return _cors(make_response("", 204))

    # ---- identity + authorisation, before anything touches case data ----
    identity = rbac.identify(request, _catalyst_user(request))
    if identity is None:
        return _json({"error": "authentication required",
                      "detail": "Sign in with your Catalyst account to use Drishti.",
                      "auth_mode": rbac.AUTH_MODE}, 401)

    if path in ("/", "/health"):
        return _json({"status": "ok", "service": "crimelink-api",
                      "engine_url": ENGINE_URL, "auth_mode": rbac.AUTH_MODE})

    if path == "/me":
        return _json({"email": identity["email"], "name": identity["name"],
                      "role": identity["role"], "district_id": identity["district_id"],
                      "authenticated": identity["authenticated"],
                      "source": identity["source"], "auth_mode": rbac.AUTH_MODE,
                      "permissions": rbac.permissions_of(identity["role"]),
                      "roles": list(rbac.ROLES)})

    # PDF export via Catalyst SmartBrowz — rendered server-side so a brief can be
    # filed, mailed, or produced by the nightly job without a browser in the loop.
    if path.startswith("/brief/"):
        if not rbac.may(identity, "brief.export"):
            return _json({"error": "forbidden", "needs_permission": "brief.export",
                          "your_role": identity["role"]}, 403)
        sid = path.rsplit("/", 1)[-1]

        # SmartBrowz is the Catalyst-native renderer and stays the preferred path,
        # but it has to be enabled on the project — off by default so an
        # unprovisioned service cannot slow every export down.
        if os.getenv("CLINK_SMARTBROWZ", "0") == "1":
            try:
                html, _, _ = _engine_raw(f"/brief/{sid}", "format=html")
                out = _sdk(request).smart_browz().convert_to_pdf(html.decode())
                data = out.content if hasattr(out, "content") else out
                r = make_response(bytes(data))
                r.headers["Content-Type"] = "application/pdf"
                r.headers["Content-Disposition"] = f'attachment; filename="{sid}-case-brief.pdf"'
                r.headers["X-Drishti-Pdf-Renderer"] = "smartbrowz"
                return _cors(r)
            except Exception as e:  # noqa: BLE001
                logger.info("smartbrowz unavailable (%s); using engine renderer", e)

        try:
            body, status, hdrs = _engine_raw(path, request.query_string.decode())
        except urllib.error.HTTPError as e:
            return _json({"error": "group not found", "series_id": sid}, e.code)
        r = make_response(body, status)
        r.headers["Content-Type"] = hdrs.get("Content-Type", "application/pdf")
        if hdrs.get("Content-Disposition"):
            r.headers["Content-Disposition"] = hdrs["Content-Disposition"]
        r.headers["X-Drishti-Pdf-Renderer"] = hdrs.get("X-Drishti-Pdf-Renderer", "engine")
        return _cors(r)

    if path == "/diag":
        # Which Catalyst credential headers arrive, and whether each SDK service
        # initialises. Header NAMES and presence only — never token values.
        if not rbac.may(identity, "model.read"):
            return _json({"error": "forbidden", "needs_permission": "model.read"}, 403)
        probe_html = "<!doctype html><html><body><p>diag</p></body></html>"
        out = {"catalyst_headers_present":
               sorted(h for h in request.headers.keys() if h.lower().startswith("x-zc")),
               "services": {}}

        def _probe(label, fn):
            try:
                fn()
                out["services"][label] = "ok"
            except Exception as e:  # noqa: BLE001
                out["services"][label] = f"{type(e).__name__}: {str(e)[:200]}"

        _probe("cache",
               lambda: _sdk(request).cache().segment().put("drishti_diag", "ok", 1))
        _probe("authentication",
               lambda: _sdk(request, scope="user").authentication().get_current_user())
        _probe("smartbrowz[admin]",
               lambda: _sdk(request).smart_browz().convert_to_pdf(probe_html))
        _probe("smartbrowz[user]",
               lambda: _sdk(request, scope="user").smart_browz().convert_to_pdf(probe_html))
        _probe("pdf[engine]", lambda: _engine_raw("/brief/SER-001"))
        return _json(out)

    perm, known = rbac.route_permission(path, rbac.ROUTE_PERMS)
    if not known:
        return _json({"error": "unknown route", "path": path}, 404)
    if not rbac.may(identity, perm):
        logger.warning("denied %s to role=%s (needs %s)", path, identity["role"], perm)
        return _json({"error": "forbidden", "path": path,
                      "needs_permission": perm, "your_role": identity["role"],
                      "detail": f"The {identity['role']} role cannot access this. "
                                f"It requires '{perm}'."}, 403)

    target = _match(path)
    if target is None:
        return _json({"error": "unknown route", "path": path}, 404)

    try:
        body = None
        if request.method == "POST":
            body = request.get_json(force=True, silent=True) or {}
        query = request.query_string.decode() if request.query_string else ""
        cache_key = _cache_key(path, query)
        cached, cache_src = (_cache_get(cache_key, request)
                             if request.method == "GET" and path in CACHEABLE
                             else (None, None))

        if cached is not None:
            payload, status = cached, 200
        else:
            payload, status = _engine(target, method=request.method,
                                      query=query, body=body)
            if request.method == "GET" and path in CACHEABLE and status == 200:
                _cache_put(cache_key, payload, request)
            # a recompute invalidates every cached answer derived from the old data
            if path == "/recompute":
                _cache_flush(request)

        # scope AFTER caching: the cache holds the unscoped engine answer, so one
        # user's jurisdiction can never be served to another
        payload = _scope_to_district(path, payload, identity)
        resp = _json(payload, status)
        resp.headers["X-Drishti-Cache"] = cache_src or ("miss" if path in CACHEABLE else "n/a")
        if _LAST_CACHE_ERR["e"]:
            resp.headers["X-Drishti-Cache-Err"] = _LAST_CACHE_ERR["e"]
        return resp
    except urllib.error.HTTPError as e:
        return _json({"error": "engine error", "status": e.code,
                      "detail": e.read().decode()[:300]}, e.code)
    except (socket.timeout, urllib.error.URLError, TimeoutError) as e:
        # The engine idles and cold-starts. That is a wait, not a failure, and the
        # client can retry into it — so say so rather than returning a dead error.
        logger.info("engine slow/unreachable (%s)", type(e).__name__)
        return _json({"error": "engine warming",
                      "detail": "The analysis engine is starting up. Retrying shortly.",
                      "warming": True}, 503)
    except Exception as e:  # noqa: BLE001
        logger.exception("gateway failure")
        return _json({"error": "gateway failure", "detail": str(e),
                      "engine_url": ENGINE_URL}, 502)
