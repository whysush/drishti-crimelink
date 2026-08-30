"""
Nightly recompute — Catalyst Job Scheduling.

Linkage is computed over the whole undetected corpus, so it goes stale the moment
new FIRs land. This job re-runs the pipeline against the current data source and
clears the cached answers, so the queue an officer opens in the morning reflects
last night's cases rather than whenever the service last restarted.

Job Scheduling is used deliberately in place of Cron, which is deprecated
(EOL 30 Apr 2026) and must not be used for new work on this project.
"""
import json
import logging
import os
import urllib.request

logger = logging.getLogger()
ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:9055").rstrip("/")
TIMEOUT = 300


def _post(path, body=None):
    req = urllib.request.Request(
        f"{ENGINE_URL}{path}",
        data=json.dumps(body or {}).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def _flush_cache():
    """Drop cached API answers so the new results are served immediately."""
    try:
        import zcatalyst_sdk
        seg = zcatalyst_sdk.initialize(scope="admin").cache().segment()
        for key in ("stats", "districts", "series", "cases_undetected", "persons",
                    "validation", "hotspots", "risk", "anomalies", "socio", "network"):
            try:
                seg.delete(f"drishti_{key}")
            except Exception:  # noqa: BLE001 — a missing key is not a failure
                pass
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("cache flush skipped (%s)", e)
        return False


def handler(job_request, context):
    logger.info("nightly recompute starting against %s", ENGINE_URL)
    try:
        result = _post("/run")          # reload source + recluster
        flushed = _flush_cache()
        logger.info("recompute ok: %s cases, %s groups, source=%s, cache_flushed=%s",
                    result.get("n_cases"), result.get("n_series"),
                    result.get("data_source"), flushed)
        context.close_with_success()
    except Exception as e:  # noqa: BLE001
        logger.exception("nightly recompute failed")
        context.close_with_failure()
