"""
Role-based access control for Drishti.

A crime-linkage tool hands out two things that must not be handed out freely: the
names of people not charged with anything, and the ability to act on a lead. So
access is decided per capability, not per user, and the rules live here in one
readable table rather than scattered through the routing.

Three roles, matching how a district actually works:

  investigator  works cases in their own jurisdiction. Sees leads, case files, can
                screen a new FIR and print a brief. Scoped to their district — an
                officer does not need statewide data to work their own patch, and
                data minimisation is the whole point.
  analyst       reads across the state. Adds persons of interest, the model panel
                and recompute. Does not make case-handling decisions.
  supervisor    everything, plus assigning and dismissing leads, and the audit log.

Persons of interest is deliberately NOT available to investigators. It is the most
sensitive output in the product — a list of people who have been charged with
nothing — and it should take a deliberate, more accountable role to open it.
"""
from __future__ import annotations

import os

ROLES = ("investigator", "analyst", "supervisor")

PERMISSIONS = {
    "investigator": {
        "leads.read", "case.read", "triage.run", "brief.export", "stats.read",
    },
    "analyst": {
        "leads.read", "case.read", "triage.run", "brief.export", "stats.read",
        "persons.read", "model.read", "recompute",
    },
    "supervisor": {
        "leads.read", "case.read", "triage.run", "brief.export", "stats.read",
        "persons.read", "model.read", "recompute", "lead.assign", "audit.read",
    },
}

# API path -> permission required to call it
ROUTE_PERMS = {
    "/health": None,                 # liveness is public; it exposes no case data
    "/me": None,                     # you may always ask who you are
    "/diag": "model.read",           # service connectivity, no secrets
    "/stats": "stats.read",
    "/districts": "stats.read",
    "/series": "leads.read",
    "/series/*": "leads.read",
    "/query": "leads.read",
    "/case/*": "case.read",
    "/case/*/series": "case.read",
    "/cases/undetected": "case.read",
    "/persons": "persons.read",
    "/match": "triage.run",
    # analytical surface — aggregates are jurisdiction-safe, so investigators keep
    # them; the socio-economic overlay is research, not case work, so it sits with
    # the model panel behind an analyst role.
    "/hotspots": "stats.read",
    "/stations": "stats.read",
    "/risk": "stats.read",
    "/anomalies": "stats.read",
    "/alerts": "leads.read",
    "/network": "leads.read",
    "/socio": "model.read",
    "/validation": "model.read",
    "/brief/*": "brief.export",
    "/recompute": "recompute",
}

DEFAULT_ROLE = os.getenv("CLINK_DEFAULT_ROLE", "analyst").lower()
# "enforced": a Catalyst-authenticated user is required, no exceptions.
# "demo":     unauthenticated callers get DEFAULT_ROLE (or an X-Drishti-Role header),
#             so the prototype is explorable. Enforcement of the rules below is
#             identical in both modes — only where the identity comes from differs.
AUTH_MODE = os.getenv("CLINK_AUTH_MODE", "demo").lower()


def _role_map():
    """CLINK_ROLE_MAP='email:role,email:role' — role assignment without a console."""
    out = {}
    for pair in (os.getenv("CLINK_ROLE_MAP") or "").split(","):
        if ":" in pair:
            email, role = pair.split(":", 1)
            role = role.strip().lower()
            if role in ROLES:
                out[email.strip().lower()] = role
    return out


def _district_map():
    """CLINK_DISTRICT_MAP='email:districtId' — jurisdiction for investigators."""
    out = {}
    for pair in (os.getenv("CLINK_DISTRICT_MAP") or "").split(","):
        if ":" in pair:
            email, did = pair.split(":", 1)
            try:
                out[email.strip().lower()] = int(did.strip())
            except ValueError:
                continue
    return out


def identify(request, catalyst_user=None):
    """Resolve the caller into {email, name, role, district_id, authenticated}."""
    email = name = None
    if catalyst_user:
        email = (catalyst_user.get("email_id") or catalyst_user.get("email") or "").lower()
        first = catalyst_user.get("first_name") or ""
        last = catalyst_user.get("last_name") or ""
        name = f"{first} {last}".strip() or email

    roles, districts = _role_map(), _district_map()
    if email:
        role = roles.get(email, DEFAULT_ROLE)
        return {"email": email, "name": name, "role": role,
                "district_id": districts.get(email), "authenticated": True,
                "source": "catalyst-authentication"}

    if AUTH_MODE == "enforced":
        return None

    # Demo mode: the client may ask to view as a role, so a judge can see exactly
    # what each role is allowed to do. Never available once auth is enforced.
    hdr = (request.headers.get("X-Drishti-Role") or "").lower()
    role = hdr if hdr in ROLES else DEFAULT_ROLE
    did = request.headers.get("X-Drishti-District")
    try:
        did = int(did) if did else None
    except ValueError:
        did = None
    return {"email": None, "name": f"Demo {role}", "role": role,
            "district_id": did, "authenticated": False, "source": "demo-mode"}


def permissions_of(role):
    return sorted(PERMISSIONS.get(role, set()))


def route_permission(path, table):
    """Required permission for an API path, matching the same wildcards as routing."""
    path = path.rstrip("/") or "/"
    segs = path.split("/")
    for pat, perm in table.items():
        pp = pat.split("/")
        if len(pp) != len(segs):
            continue
        if all(p == "*" or p == s for p, s in zip(pp, segs)):
            return perm, True
    return None, False


def may(identity, permission):
    if permission is None:
        return True
    if not identity:
        return False
    return permission in PERMISSIONS.get(identity["role"], set())
