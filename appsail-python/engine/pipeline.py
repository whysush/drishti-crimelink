"""
Pipeline orchestration + evaluation.

run()            cases -> (fingerprints, ranked series)
series_for_case  the series a given undetected case belongs to (+ inferred edges)
evaluate()       pairwise precision/recall/F1 and per-series recovery vs ground truth
"""
from __future__ import annotations

from itertools import combinations

from .fingerprint import Fingerprints
from .linkage import build_series, cluster, edges_for_series

DEFAULT_PARAMS = dict(
    distance_threshold=0.25, min_size=3, min_cohesion=0.6,
    method="agglomerative",
)


def run(cases, params=None, weights=None, sub=None):
    p = dict(DEFAULT_PARAMS)
    if params:
        p.update(params)
    fp = Fingerprints(cases, weights=weights, sub=sub)
    clusters = cluster(fp, distance_threshold=p["distance_threshold"],
                       min_size=p["min_size"], method=p["method"])
    series = build_series(fp, clusters, min_cohesion=p["min_cohesion"])
    return fp, series


def series_for_case(fp, series, case_master_id):
    for s in series:
        if case_master_id in s["member_case_ids"]:
            return {**{k: v for k, v in s.items() if k != "_member_idx"},
                    "edges": edges_for_series(fp, s)}
    return None


def evaluate(series, cases, ground_truth):
    """ground_truth: {'planted_series':[{series_key, members:[{CaseMasterID}]}]}."""
    truth = {}          # case_id -> series_key
    truth_sizes = {}
    for g in ground_truth["planted_series"]:
        truth_sizes[g["series_key"]] = len(g["members"])
        for m in g["members"]:
            truth[str(m["CaseMasterID"])] = g["series_key"]

    ids = [str(c["case_master_id"]) for c in cases]
    pred = {}           # case_id -> predicted cluster id
    for s in series:
        for cid in s["member_case_ids"]:
            pred[str(cid)] = s["series_id"]

    # pairwise P/R over all case pairs
    tp = fp_ = fn = 0
    for a, b in combinations(ids, 2):
        same_true = a in truth and b in truth and truth[a] == truth[b]
        same_pred = a in pred and b in pred and pred[a] == pred[b]
        if same_pred and same_true:
            tp += 1
        elif same_pred and not same_true:
            fp_ += 1
        elif not same_pred and same_true:
            fn += 1
    prec = tp / (tp + fp_) if (tp + fp_) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0

    # per-series recovery: a planted series is "recovered" if a majority of its
    # members land together in one predicted cluster
    recovered = {}
    for gkey, gsize in truth_sizes.items():
        members = [cid for cid, k in truth.items() if k == gkey]
        buckets = {}
        for cid in members:
            if cid in pred:
                buckets[pred[cid]] = buckets.get(pred[cid], 0) + 1
        best = max(buckets.values()) if buckets else 0
        recovered[gkey] = dict(size=gsize, largest_together=best,
                               recovered=best >= (gsize + 1) // 2,
                               cluster=max(buckets, key=buckets.get) if buckets else None)

    return dict(
        pairwise_precision=round(prec, 3), pairwise_recall=round(rec, 3),
        pairwise_f1=round(f1, 3), tp=tp, fp=fp_, fn=fn,
        n_predicted_series=len(series),
        n_series_recovered=sum(1 for v in recovered.values() if v["recovered"]),
        n_series_total=len(truth_sizes),
        per_series=recovered,
    )
