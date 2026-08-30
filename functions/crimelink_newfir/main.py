"""
Auto-flag a newly registered FIR — Catalyst Event Function, driven by Signals.

The point of the linkage engine is that nobody notices a cross-station pattern by
hand. Waiting for someone to open the app and paste a case in re-introduces exactly
that gap. So when a new FIR row is written, this fires, scores it against every
known group, and raises a flag if it fits one.

Wired via Signals + Event Functions, not Event Listeners, which are deprecated
(EOL 30 Apr 2026).

It writes nothing back into the case record. An automated system must not annotate
a police file with an inference; it records a flag for a human to accept or reject.
"""
import json
import logging
import os
import re
import urllib.request

logger = logging.getLogger()
ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:9055").rstrip("/")
TIMEOUT = 120
FLAG_AT = float(os.getenv("CLINK_FLAG_AT", "0.65"))   # fit ratio worth a human look


def _match(payload):
    req = urllib.request.Request(
        f"{ENGINE_URL}/match", data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def _row_of(event):
    """Pull the FIR row out of whichever shape the signal delivers."""
    if not isinstance(event, dict):
        return {}
    for key in ("data", "row", "payload", "record"):
        v = event.get(key)
        if isinstance(v, dict):
            return v.get("row") if isinstance(v.get("row"), dict) else v
    return event


def _flag(case_ref, result):
    """Record the flag where a human will see it. Never touches the FIR itself."""
    top = (result.get("matches") or [None])[0]
    entry = {
        "case": case_ref,
        "verdict": result.get("verdict"),
        "series_id": top and top.get("series_id"),
        "fit_pct": top and top.get("fit_pct"),
        "match_level": top and top.get("match_level"),
        "status": "awaiting_review",
    }
    try:
        import zcatalyst_sdk
        seg = zcatalyst_sdk.initialize(scope="admin").cache().segment()
        key = "drishti_flag_" + re.sub(r"\W+", "_", case_ref)
        seg.put(key, json.dumps(entry), 168)      # a week for someone to action it
        logger.info("flagged %s -> %s", case_ref, entry["series_id"])
    except Exception as e:  # noqa: BLE001
        logger.warning("could not persist flag (%s); logging only: %s", e, entry)


def handler(event, context):
    row = _row_of(event)
    case_ref = str(row.get("CrimeNo") or row.get("CaseMasterID") or "unknown")
    payload = {
        "brief_facts": row.get("BriefFacts") or "",
        "minor_head_id": row.get("CrimeMinorHeadID"),
        "lat": row.get("latitude"), "lon": row.get("longitude"),
        "incident_from": row.get("IncidentFromDate") or "",
        "act_sections": [], "victims": [], "accused_names": [],
    }
    try:
        result = _match(payload)
    except Exception:  # noqa: BLE001
        logger.exception("triage failed for %s", case_ref)
        context.close_with_failure()
        return

    top = (result.get("matches") or [None])[0]
    fit = (top or {}).get("fit_ratio") or 0.0
    if top and fit >= FLAG_AT:
        _flag(case_ref, result)
    else:
        logger.info("%s: no group fits (best %.2f, threshold %.2f)",
                    case_ref, fit, FLAG_AT)
    context.close_with_success()
