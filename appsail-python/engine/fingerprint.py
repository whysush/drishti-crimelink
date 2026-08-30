"""
Fingerprint + composite similarity.

Per undetected case we build a multi-signal fingerprint, then a weighted composite
similarity between every pair. Signals (CLINK_CONTEXT sec.5 step 5):

  mo        MO semantics    TF-IDF(BriefFacts) cosine        (graceful: 0 if empty)
  minor     typology        crime sub-head match
  act       legal signature Jaccard of Act:Section set
  spatial   geography       haversine distance -> proximity
  temporal  time signature  time-of-day + day-of-week + reporting delay
  profile   target profile  victim gender + age band + complainant occupation
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

# Base weights (sum 1.0).
#
# `name` carries ZERO weight, and that is a measured decision, not a cautious one.
# The ablation (see engine/validation.py, served live at /validation) showed that
# giving accused names any weight at all made the engine *worse* — precision 0.919
# and recall 0.854 with names, against 0.928 / 0.965 without. Coincidental name
# collisions were dragging unrelated cases into real groups and splitting them.
#
# So identity plays no part in deciding that two crimes are linked: links are made
# on behaviour alone. A recurring name is still computed and shown to the
# investigator as unconfirmed corroboration — it just never influences the maths.
# The signal is kept in the table (rather than deleted) so the app can show the
# weight is zero and prove why.
DEFAULT_WEIGHTS = {
    "mo": 0.326, "minor": 0.163, "act": 0.109, "spatial": 0.163,
    "temporal": 0.130, "profile": 0.109, "name": 0.0,
}
SPATIAL_D0_KM = 6.0     # proximity half-scale
AGE_SCALE = 15.0        # victim-age similarity scale (years)
DELAY_SCALE_H = 18.0    # reporting-delay similarity scale (hours)

# Sub-signal weights inside `temporal` and `profile`. Both are built, wired through
# both the matrix and the single-case triage path, and both currently ship at ZERO.
#
# That is a measured decision, not an oversight. Swept against the clustering
# threshold, every non-zero setting was worse than zero — at 0.20/0.20 precision
# rose to 0.947 but recall collapsed 0.965 -> 0.814 (F1 0.946 -> 0.876).
#
# The reason is a property of the corpus, not of the idea: the synthetic generator
# draws reporting delay as random.randint(4, 72) and complainant occupation as
# random.choice(...), both independent of the planted offender series. So in THIS
# data they are noise by construction and cannot do anything but blur true links.
#
# Real FIR data may well carry signal in both — a serial offender working one victim
# type tends to produce a consistent reporting delay. Turning them on is a one-line
# change to these two constants, and /validation re-measures them against whatever
# data is loaded. They are kept wired rather than deleted for exactly that reason.
DELAY_SUBW = 0.0        # share of `temporal` given to reporting delay
OCC_SUBW = 0.0          # share of `profile` given to complainant occupation

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


def _haversine_row(lat, lon, plat, plon):
    """Distance in km from one point to every case."""
    R = 6371.0
    la, lo = np.radians(lat), np.radians(lon)
    pla, plo = math.radians(plat), math.radians(plon)
    dlat, dlon = la - pla, lo - plo
    a = np.sin(dlat / 2) ** 2 + np.cos(la) * math.cos(pla) * np.sin(dlon / 2) ** 2
    return R * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _cyclic_row(values, point, period):
    """Cyclic similarity of every case's value to one point, mapped 0..1."""
    ang = 2 * math.pi * (values / period)
    pa = 2 * math.pi * (point / period)
    return (np.sin(ang) * math.sin(pa) + np.cos(ang) * math.cos(pa) + 1) / 2


def _blend(parts, fallback=0.5):
    """Combine sub-signals into one score, renormalising per pair.

    Each part is (weight, similarity, availability). Where a sub-signal has no
    input for a given pair its weight is dropped and the rest are rescaled, so a
    missing complainant occupation weakens the profile score rather than voiding
    it. Pairs with nothing available fall back to neutral.
    """
    num = np.zeros_like(parts[0][1], dtype=float)
    den = np.zeros_like(parts[0][1], dtype=float)
    for w, S, av in parts:
        m = av.astype(float) * w
        num += m * S
        den += m
    return np.where(den > 0, num / np.where(den > 0, den, 1.0), fallback)


def _cyclic_sim(values, period):
    ang = 2 * math.pi * (values / period)
    s, c = np.sin(ang), np.cos(ang)
    # cosine of angular diff, mapped 0..1
    return (s[:, None] * s[None, :] + c[:, None] * c[None, :] + 1) / 2


class Fingerprints:
    """Holds component similarity matrices + availability, builds the composite."""

    def __init__(self, cases, weights=None, sub=None):
        self.cases = cases
        self.n = len(cases)
        self.w = dict(DEFAULT_WEIGHTS)
        if weights:
            self.w.update(weights)
        self.sub = {"delay": DELAY_SUBW, "occ": OCC_SUBW}
        if sub:
            self.sub.update(sub)
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
            vec, X, S_mo = None, None, np.zeros((n, n))
        self._vec, self._X = vec, X
        self._has_text = has_text
        self.comps["mo"] = S_mo
        self.avail["mo"] = has_text[:, None] & has_text[None, :]

        # Typology: sub-head match
        minor = np.array([str(c["minor_head_id"]) for c in C])
        self._minor = minor
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
        self._secM, self._sec_idx, self._rs, self._has_act = M, sec_idx, rs, has_act
        self.avail["act"] = has_act[:, None] & has_act[None, :]

        # Spatial: haversine -> soft proximity
        has_geo = np.array([c["lat"] is not None and c["lon"] is not None for c in C])
        lat = np.array([c["lat"] if c["lat"] is not None else 0.0 for c in C])
        lon = np.array([c["lon"] if c["lon"] is not None else 0.0 for c in C])
        D = _haversine_matrix(lat, lon)
        self._dist_km = D
        self._lat, self._lon, self._has_geo = lat, lon, has_geo
        self.comps["spatial"] = 1.0 / (1.0 + D / SPATIAL_D0_KM)
        self.avail["spatial"] = has_geo[:, None] & has_geo[None, :]

        # Temporal: time-of-day + day-of-week
        has_time = np.array([c["incident_from"] is not None for c in C])
        tod = np.array([(c["incident_from"].hour + c["incident_from"].minute / 60.0)
                        if c["incident_from"] else 0.0 for c in C])
        dow = np.array([c["incident_from"].weekday() if c["incident_from"] else 0
                        for c in C], dtype=float)
        # reporting delay: how long the offence took to reach the station. Offenders
        # working one victim type in one manner tend to produce a consistent delay
        # (a shop break-in found at opening, a night mugging reported next morning),
        # so it carries MO signal the clock time alone does not.
        delay = np.array([c["reporting_delay_h"] if c["reporting_delay_h"] is not None
                          else np.nan for c in C], dtype=float)
        has_delay = ~np.isnan(delay)
        Dd = np.abs(delay[:, None] - delay[None, :])
        S_delay = np.where(np.isnan(Dd), 0.5, np.exp(-Dd / DELAY_SCALE_H))
        delay_pair = has_delay[:, None] & has_delay[None, :]
        self._tod, self._dow, self._has_time = tod, dow, has_time
        self._delay, self._has_delay = delay, has_delay
        time_pair = has_time[:, None] & has_time[None, :]
        dw = self.sub["delay"]
        self.comps["temporal"] = _blend([
            (0.70 * (1 - dw), _cyclic_sim(tod, 24), time_pair),
            (0.30 * (1 - dw), _cyclic_sim(dow, 7), time_pair),
            (dw, S_delay, delay_pair),
        ])
        # available if EITHER the clock or the reporting delay is known for the pair
        self.avail["temporal"] = time_pair | delay_pair

        # Target profile: victim gender + age band
        def vinfo(c):
            gs = [v["gender"] for v in c["victims"] if v.get("gender")]
            ages = [v["age"] for v in c["victims"] if v.get("age")]
            g = gs[0] if gs else None
            a = float(np.mean(ages)) if ages else None
            return g, a
        vg = [vinfo(c) for c in C]
        gender = np.array([g or "" for g, a in vg])
        has_g = np.array([g is not None for g, a in vg])
        S_g = (gender[:, None] == gender[None, :]).astype(float)
        g_pair = has_g[:, None] & has_g[None, :]
        ages = np.array([a if a is not None else np.nan for g, a in vg])
        has_a = ~np.isnan(ages)
        A = np.abs(ages[:, None] - ages[None, :])
        S_a = np.where(np.isnan(A), 0.5, np.exp(-A / AGE_SCALE))
        a_pair = has_a[:, None] & has_a[None, :]

        # complainant occupation: who the offender picks on. A run of offences
        # against shopkeepers looks different from a run against daily labourers,
        # and that is target selection, not coincidence.
        occs = [set(c["complainant_occupations"] or []) for c in C]
        all_occ = sorted({o for st in occs for o in st})
        oi = {o: i for i, o in enumerate(all_occ)}
        O = np.zeros((n, len(all_occ)))
        for i, st in enumerate(occs):
            for o in st:
                O[i, oi[o]] = 1.0
        inter_o = O @ O.T
        ro = O.sum(1)
        union_o = ro[:, None] + ro[None, :] - inter_o
        with np.errstate(divide="ignore", invalid="ignore"):
            S_occ = np.where(union_o > 0, inter_o / union_o, 0.0)
        has_occ = ro > 0
        o_pair = has_occ[:, None] & has_occ[None, :]

        has_prof = has_g | has_a | has_occ
        self._gender, self._ages, self._has_prof = gender, ages, has_prof
        self._occ_idx, self._occM, self._ro, self._has_occ = oi, O, ro, has_occ
        self._has_g, self._has_a = has_g, has_a
        ow = self.sub["occ"]
        self.comps["profile"] = _blend([
            (0.50 * (1 - ow), S_g, g_pair), (0.50 * (1 - ow), S_a, a_pair),
            (ow, S_occ, o_pair),
        ])
        self.avail["profile"] = g_pair | a_pair | o_pair

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
        self._names, self._has_name = names, has_name
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

    # -- reweighting (used by the in-app ablation study) ----------------------
    def with_weights(self, weights):
        """A light clone sharing the component matrices but with new weights.

        Recomposing costs O(7n^2) instead of rebuilding every signal, which is
        what makes the leave-one-signal-out ablation cheap enough to serve live.
        """
        import copy as _copy
        other = _copy.copy(self)
        other.w = dict(self.w)
        other.w.update(weights or {})
        other._composite()
        return other

    # -- scoring one ad-hoc case against the corpus (live FIR triage) --------
    def similarity_row(self, case):
        """Score an unseen case against every known case.

        Returns (similarity[n], contributions{signal: array[n]}, distance_km[n]).
        Uses the same seven signals and the same per-pair weight renormalisation
        as the matrix path, so a triage score is directly comparable to the
        cohesion numbers shown for an existing group.
        """
        n = self.n
        comps, avail = {}, {}
        zeros, nofill = np.zeros(n), np.zeros(n, dtype=bool)

        # MO — reuse the fitted vocabulary; an unseen case adds no vocabulary
        text = (case.get("brief_facts") or "").strip()
        if self._vec is not None and len(text.split()) >= 3:
            comps["mo"] = cosine_similarity(self._vec.transform([text]), self._X)[0]
            avail["mo"] = self._has_text.copy()
        else:
            comps["mo"], avail["mo"] = zeros.copy(), nofill.copy()

        # Typology
        mh = case.get("minor_head_id")
        if mh is not None and str(mh) != "":
            comps["minor"] = (self._minor == str(mh)).astype(float)
            avail["minor"] = np.ones(n, dtype=bool)
        else:
            comps["minor"], avail["minor"] = zeros.copy(), nofill.copy()

        # Legal signature
        secs = set(case.get("act_sections") or [])
        v = np.zeros(self._secM.shape[1])
        for sc in secs:
            if sc in self._sec_idx:
                v[self._sec_idx[sc]] = 1.0
        if v.sum() > 0:
            inter = self._secM @ v
            union = self._rs + v.sum() - inter
            with np.errstate(divide="ignore", invalid="ignore"):
                comps["act"] = np.where(union > 0, inter / union, 0.0)
            avail["act"] = self._has_act.copy()
        else:
            comps["act"], avail["act"] = zeros.copy(), nofill.copy()

        # Spatial
        dist_km = np.full(n, np.nan)
        if case.get("lat") is not None and case.get("lon") is not None:
            dist_km = _haversine_row(self._lat, self._lon,
                                     float(case["lat"]), float(case["lon"]))
            comps["spatial"] = 1.0 / (1.0 + dist_km / SPATIAL_D0_KM)
            avail["spatial"] = self._has_geo.copy()
        else:
            comps["spatial"], avail["spatial"] = zeros.copy(), nofill.copy()

        # Temporal — clock time plus reporting delay, same blend as the matrix path
        dt = case.get("incident_from")
        dly = case.get("reporting_delay_h")
        t_parts = []
        if dt is not None:
            tod = dt.hour + dt.minute / 60.0
            t_parts.append((0.70 * (1 - self.sub["delay"]),
                            _cyclic_row(self._tod, tod, 24), self._has_time))
            t_parts.append((0.30 * (1 - self.sub["delay"]),
                            _cyclic_row(self._dow, float(dt.weekday()), 7), self._has_time))
        if dly is not None:
            Dd = np.abs(self._delay - float(dly))
            t_parts.append((self.sub["delay"],
                            np.where(np.isnan(Dd), 0.5, np.exp(-Dd / DELAY_SCALE_H)),
                            self._has_delay))
        if t_parts:
            comps["temporal"] = _blend(t_parts)
            avail["temporal"] = np.zeros(n, dtype=bool)
            for _, _, av in t_parts:
                avail["temporal"] |= av
        else:
            comps["temporal"], avail["temporal"] = zeros.copy(), nofill.copy()

        # Target profile — victim gender/age plus complainant occupation
        vics = case.get("victims") or []
        gs = [x.get("gender") for x in vics if x.get("gender")]
        ags = [x.get("age") for x in vics if x.get("age")]
        g = gs[0] if gs else None
        a = float(np.mean(ags)) if ags else None
        occ = set(case.get("complainant_occupations") or [])
        p_parts = []
        if g is not None:
            p_parts.append((0.50 * (1 - self.sub["occ"]),
                            (self._gender == g).astype(float), self._has_g))
        if a is not None:
            A = np.abs(self._ages - a)
            p_parts.append((0.50 * (1 - self.sub["occ"]),
                            np.where(np.isnan(A), 0.5, np.exp(-A / AGE_SCALE)), self._has_a))
        if occ:
            v = np.zeros(self._occM.shape[1])
            for o in occ:
                if o in self._occ_idx:
                    v[self._occ_idx[o]] = 1.0
            if v.sum() > 0:
                inter = self._occM @ v
                union = self._ro + v.sum() - inter
                with np.errstate(divide="ignore", invalid="ignore"):
                    p_parts.append((self.sub["occ"],
                                    np.where(union > 0, inter / union, 0.0), self._has_occ))
        if p_parts:
            comps["profile"] = _blend(p_parts)
            avail["profile"] = np.zeros(n, dtype=bool)
            for _, _, av in p_parts:
                avail["profile"] |= av
        else:
            comps["profile"], avail["profile"] = zeros.copy(), nofill.copy()

        # WEAK identity — never decisive, only corroborating
        nms = [x for x in (case.get("accused_names") or []) if x]
        S_name = np.zeros(n)
        if nms:
            for i in range(n):
                if not self._has_name[i]:
                    continue
                best = 0.0
                for x in nms:
                    for y in self._names[i]:
                        r = SequenceMatcher(None, x.lower(), y.lower()).ratio()
                        if r > best:
                            best = r
                S_name[i] = best
            avail["name"] = self._has_name.copy()
        else:
            avail["name"] = nofill.copy()
        comps["name"] = S_name

        keys = list(self.w)
        W = np.stack([np.full(n, self.w[k]) * avail[k] for k in keys])
        Wsum = W.sum(0)
        Wsum[Wsum == 0] = 1.0
        Weff = W / Wsum
        S = np.zeros(n)
        contrib = {}
        for idx, k in enumerate(keys):
            c = Weff[idx] * comps[k]
            contrib[k] = c
            S += c
        return S, contrib, dist_km
