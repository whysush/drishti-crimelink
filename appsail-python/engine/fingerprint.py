"""
Fingerprint + composite similarity.

Per undetected case we build a multi-signal fingerprint, then a weighted composite
similarity between every pair. Signals (CLINK_CONTEXT sec.5 step 5):

  mo        MO semantics    TF-IDF(BriefFacts) cosine        (graceful: 0 if empty)
  minor     typology        crime sub-head match
  act       legal signature Jaccard of Act:Section set
  spatial   geography       haversine distance -> proximity
  temporal  time signature  time-of-day + day-of-week
  profile   target profile  victim gender + age band
  name      WEAK identity   fuzzy AccusedName match  (low weight, always flagged weak)

Graceful degradation: for any pair, signals whose inputs are missing (empty
BriefFacts, no act-sections, no victim...) are dropped and the remaining weights
renormalised — so linkage still works on typology + spatiotemporal alone.
"""
from __future__ import annotations

import math
from difflib import SequenceMatcher

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Base weights (sum ~1.0). `name` is a deliberately small bonus so identity never
# drives a link — it only ever corroborates. Tunable.
DEFAULT_WEIGHTS = {
    "mo": 0.30, "minor": 0.15, "act": 0.10, "spatial": 0.15,
    "temporal": 0.12, "profile": 0.10, "name": 0.08,
}
SPATIAL_D0_KM = 6.0     # proximity half-scale
AGE_SCALE = 15.0        # victim-age similarity scale (years)

DRIVER_LABELS = {
    "mo": "method — how it was done", "minor": "crime type",
    "act": "law sections", "spatial": "location", "temporal": "time pattern",
    "profile": "who was targeted", "name": "possible same name",
}


def _haversine_matrix(lat, lon):
    R = 6371.0
    la = np.radians(lat)[:, None]
    lo = np.radians(lon)[:, None]
    dlat = la - la.T
    dlon = lo - lo.T
    a = np.sin(dlat / 2) ** 2 + np.cos(la) * np.cos(la.T) * np.sin(dlon / 2) ** 2
    return R * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _cyclic_sim(values, period):
    ang = 2 * math.pi * (values / period)
    s, c = np.sin(ang), np.cos(ang)
    # cosine of angular diff, mapped 0..1
    return (s[:, None] * s[None, :] + c[:, None] * c[None, :] + 1) / 2


class Fingerprints:
    """Holds component similarity matrices + availability, builds the composite."""

    def __init__(self, cases, weights=None):
        self.cases = cases
        self.n = len(cases)
        self.w = dict(DEFAULT_WEIGHTS)
        if weights:
            self.w.update(weights)
        self.comps = {}
        self.avail = {}
        self._build()

    # -- component builders --------------------------------------------------
    def _build(self):
        n = self.n
        C = self.cases
        ones = np.ones((n, n))

        # MO: TF-IDF cosine
        texts = [c["brief_facts"] or "" for c in C]
        has_text = np.array([len(t.split()) >= 3 for t in texts])
        try:
            vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2),
                                  min_df=2, max_features=4000)
            X = vec.fit_transform(texts)
            S_mo = cosine_similarity(X)
        except ValueError:
            S_mo = np.zeros((n, n))
        self.comps["mo"] = S_mo
        self.avail["mo"] = has_text[:, None] & has_text[None, :]

        # Typology: sub-head match
        minor = np.array([str(c["minor_head_id"]) for c in C])
        self.comps["minor"] = (minor[:, None] == minor[None, :]).astype(float)
        self.avail["minor"] = ones.astype(bool)

        # Legal signature: Jaccard of act:section sets
        all_secs = sorted({s for c in C for s in c["act_sections"]})
        sec_idx = {s: i for i, s in enumerate(all_secs)}
        M = np.zeros((n, len(all_secs)))
        for i, c in enumerate(C):
            for s in c["act_sections"]:
                M[i, sec_idx[s]] = 1
        inter = M @ M.T
        rs = M.sum(1)
        union = rs[:, None] + rs[None, :] - inter
        with np.errstate(divide="ignore", invalid="ignore"):
            S_act = np.where(union > 0, inter / union, 0.0)
        self.comps["act"] = S_act
        has_act = rs > 0
        self.avail["act"] = has_act[:, None] & has_act[None, :]

        # Spatial: haversine -> soft proximity
        has_geo = np.array([c["lat"] is not None and c["lon"] is not None for c in C])
        lat = np.array([c["lat"] if c["lat"] is not None else 0.0 for c in C])
        lon = np.array([c["lon"] if c["lon"] is not None else 0.0 for c in C])
        D = _haversine_matrix(lat, lon)
        self._dist_km = D
        self.comps["spatial"] = 1.0 / (1.0 + D / SPATIAL_D0_KM)
        self.avail["spatial"] = has_geo[:, None] & has_geo[None, :]

        # Temporal: time-of-day + day-of-week
        has_time = np.array([c["incident_from"] is not None for c in C])
        tod = np.array([(c["incident_from"].hour + c["incident_from"].minute / 60.0)
                        if c["incident_from"] else 0.0 for c in C])
        dow = np.array([c["incident_from"].weekday() if c["incident_from"] else 0
                        for c in C], dtype=float)
        self.comps["temporal"] = 0.7 * _cyclic_sim(tod, 24) + 0.3 * _cyclic_sim(dow, 7)
        self.avail["temporal"] = has_time[:, None] & has_time[None, :]

        # Target profile: victim gender + age band
        def vinfo(c):
            gs = [v["gender"] for v in c["victims"] if v.get("gender")]
            ages = [v["age"] for v in c["victims"] if v.get("age")]
            g = gs[0] if gs else None
            a = float(np.mean(ages)) if ages else None
            return g, a
        vg = [vinfo(c) for c in C]
        has_prof = np.array([g is not None or a is not None for g, a in vg])
        gender = np.array([g or "" for g, a in vg])
        S_g = (gender[:, None] == gender[None, :]).astype(float)
        ages = np.array([a if a is not None else np.nan for g, a in vg])
        A = np.abs(ages[:, None] - ages[None, :])
        S_a = np.where(np.isnan(A), 0.5, np.exp(-A / AGE_SCALE))
        self.comps["profile"] = 0.5 * S_g + 0.5 * S_a
        self.avail["profile"] = has_prof[:, None] & has_prof[None, :]

        # WEAK identity: fuzzy accused-name match (only where both name-bearing)
        names = [c["accused_names"] for c in C]
        has_name = np.array([len(x) > 0 for x in names])
        S_name = np.zeros((n, n))
        idxs = [i for i in range(n) if has_name[i]]
        for ii in range(len(idxs)):
            for jj in range(ii + 1, len(idxs)):
                i, j = idxs[ii], idxs[jj]
                best = 0.0
                for a in names[i]:
                    for b in names[j]:
                        r = SequenceMatcher(None, a.lower(), b.lower()).ratio()
                        if r > best:
                            best = r
                S_name[i, j] = S_name[j, i] = best
        self.comps["name"] = S_name
        self.avail["name"] = has_name[:, None] & has_name[None, :]

        self._composite()

    # -- composite with per-pair renormalisation ----------------------------
    def _composite(self):
        n = self.n
        keys = list(self.w)
        W = np.stack([np.full((n, n), self.w[k]) * self.avail[k] for k in keys])
        Wsum = W.sum(0)
        Wsum[Wsum == 0] = 1.0
        Weff = W / Wsum  # effective weights per pair, sum to 1 over available comps
        S = np.zeros((n, n))
        self._weff = {}
        for idx, k in enumerate(keys):
            contrib = Weff[idx] * self.comps[k]
            self._weff[k] = Weff[idx]
            S += contrib
        np.fill_diagonal(S, 1.0)
        self.S = S

    # -- evidence helpers ----------------------------------------------------
    def pair_contributions(self, i, j):
        """Effective weighted contribution of each signal to composite[i,j]."""
        return {k: float(self._weff[k][i, j] * self.comps[k][i, j]) for k in self.w}

    def distance_km(self, i, j):
        return float(self._dist_km[i, j])
