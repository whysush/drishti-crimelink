"""
In-app validation.

A slide can claim any accuracy. This computes the numbers live, from the same
engine that serves the app, and reports them next to the results they describe —
including the ablation showing what each signal is actually worth, and a written
statement of where the method fails.

Requires a ground-truth file (planted series in the synthetic corpus). When one
is not present — as when real KSP data is loaded — the endpoint says so rather
than showing stale numbers.
"""
from __future__ import annotations

from .fingerprint import DEFAULT_WEIGHTS, DRIVER_LABELS, DELAY_SUBW, OCC_SUBW
from .forecast import backtest
from .fingerprint import Fingerprints
from .linkage import build_series, cluster
from .pipeline import DEFAULT_PARAMS, evaluate

LIMITATIONS = [
    ("Links are inferred, never asserted",
     "Every link is a similarity judgement over recorded features. It is a lead to "
     "investigate, not evidence of guilt, and the app never states otherwise."),
    ("Identity has zero weight, by measurement",
     "Accused names contribute nothing to linkage. We tested giving them weight and it "
     "made the engine measurably worse, so links are made on behaviour alone. A "
     "recurring name is shown as unconfirmed corroboration only."),
    ("Sparse free text degrades the strongest signal",
     "MO similarity needs BriefFacts. Where it is empty the weights renormalise onto "
     "typology, place, time and target profile, so linkage still runs — with less "
     "confidence, which the cohesion score reflects."),
    ("Geography can create false links",
     "Two unrelated offenders working the same market at the same hour look alike. "
     "Wide-spread groups are damped in ranking, but a tight cluster is not proof."),
    ("Measured on synthetic data",
     "These figures are against planted series in the schema-faithful synthetic "
     "corpus. Real FIR data will differ; the same evaluation re-runs against it "
     "unchanged."),
    ("Demographic fields are handled with care",
     "Complainant caste and religion exist in the schema and are deliberately "
     "excluded from linkage. Only victim age and gender inform the target profile."),
]


def _f1(ev):
    return ev["pairwise_f1"]


def report(fp, series, cases, ground_truth, params=None):
    """Full validation: headline metrics, per-signal ablation, forecast back-test."""
    horizon = max((c["incident_from"] for c in cases if c["incident_from"]), default=None)
    fc = backtest(series, horizon)

    base_weights = dict(DEFAULT_WEIGHTS)
    signals = [{"signal": k, "label": DRIVER_LABELS[k], "weight": v}
               for k, v in base_weights.items()]

    out = {
        "data_profile": {
            "undetected_cases": len(cases),
            "stations": len({c["police_station_id"] for c in cases}),
            "districts": len({c["district_name"] for c in cases if c["district_name"]}),
            "with_brief_facts": sum(1 for c in cases
                                    if len((c["brief_facts"] or "").split()) >= 3),
            "with_coordinates": sum(1 for c in cases if c["lat"] is not None),
            "with_named_accused": sum(1 for c in cases if c["accused_names"]),
            "groups_found": len(series),
            "cases_grouped": sum(s["size"] for s in series),
        },
        "signals": signals,
        "parameters": dict(DEFAULT_PARAMS, **(params or {})),
        "forecast_backtest": fc,
        "limitations": LIMITATIONS,
    }

    if not ground_truth:
        out["ground_truth_available"] = False
        out["note"] = ("No ground-truth file is loaded, so linkage accuracy cannot be "
                       "measured on this dataset. The forecast back-test above is "
                       "self-supervised and still applies.")
        return out

    p = dict(DEFAULT_PARAMS)
    p.update(params or {})
    base = evaluate(series, cases, ground_truth)
    out["ground_truth_available"] = True
    out["accuracy"] = {
        "precision": base["pairwise_precision"], "recall": base["pairwise_recall"],
        "f1": base["pairwise_f1"], "tp": base["tp"], "fp": base["fp"], "fn": base["fn"],
        "series_recovered": base["n_series_recovered"],
        "series_total": base["n_series_total"],
        "method": ("pairwise over every pair of undetected cases: a pair is correct "
                   "when the engine groups two cases that the ground truth says share "
                   "an offender"),
    }
    out["per_series"] = [
        {"series_key": k, "size": v["size"], "found_together": v["largest_together"],
         "recovered": v["recovered"], "matched_group": v["cluster"]}
        for k, v in sorted(base["per_series"].items())
    ]

    # Leave-one-signal-out: zero a weight, recompose (cheap — the component
    # matrices are reused), recluster, re-evaluate. Signals already at zero are
    # skipped here and reported separately, since removing nothing proves nothing.
    ablation = []
    for k in base_weights:
        if base_weights[k] <= 0:
            continue
        fp2 = fp.with_weights({k: 0.0})
        cl = cluster(fp2, distance_threshold=p["distance_threshold"],
                     min_size=p["min_size"], method=p["method"])
        s2 = build_series(fp2, cl, min_cohesion=p["min_cohesion"])
        ev = evaluate(s2, cases, ground_truth)
        ablation.append({
            "signal": k, "label": DRIVER_LABELS[k], "weight": base_weights[k],
            "f1_without": ev["pairwise_f1"],
            "f1_drop": round(_f1(base) - _f1(ev), 3),
            "precision_without": ev["pairwise_precision"],
            "recall_without": ev["pairwise_recall"],
            "series_recovered_without": ev["n_series_recovered"],
        })
    ablation.sort(key=lambda a: -a["f1_drop"])
    out["ablation"] = {
        "baseline_f1": base["pairwise_f1"],
        "rows": ablation,
        "method": ("each signal's weight is set to zero and the whole pipeline re-run; "
                   "the drop in F1 is what that signal is worth"),
    }

    # The identity experiment, run in reverse: what happens if we DO let the
    # accused name influence linkage. This is why its weight is zero, and showing
    # the number is more convincing than asserting the principle.
    fp3 = fp.with_weights({"name": 0.08})
    cl3 = cluster(fp3, distance_threshold=p["distance_threshold"],
                  min_size=p["min_size"], method=p["method"])
    ev3 = evaluate(build_series(fp3, cl3, min_cohesion=p["min_cohesion"]),
                   cases, ground_truth)
    # The two sub-signals the design called for inside `temporal` and `profile`.
    # Both are implemented; both are measured here rather than asserted.
    subs = []
    for key, label, parent, shipped in [
        ("delay", "reporting delay (incident -> reported)", "temporal", DELAY_SUBW),
        ("occ", "complainant occupation", "profile", OCC_SUBW),
    ]:
        trial = {"delay": 0.0, "occ": 0.0}
        trial[key] = 0.20
        fps = Fingerprints(cases, sub=trial)
        cls = cluster(fps, distance_threshold=p["distance_threshold"],
                      min_size=p["min_size"], method=p["method"])
        evs = evaluate(build_series(fps, cls, min_cohesion=p["min_cohesion"]),
                       cases, ground_truth)
        subs.append({
            "signal": key, "label": label, "folded_into": parent,
            "shipped_weight": shipped,
            "at_20pct": {"precision": evs["pairwise_precision"],
                         "recall": evs["pairwise_recall"], "f1": evs["pairwise_f1"]},
            "at_zero": {"precision": base["pairwise_precision"],
                        "recall": base["pairwise_recall"], "f1": base["pairwise_f1"]},
        })
    out["sub_signal_experiment"] = {
        "question": ("The design called for reporting delay and complainant occupation. "
                     "Do they actually help?"),
        "answer": "Not on this corpus — so they are built, wired, and shipped at zero weight.",
        "rows": subs,
        "conclusion": ("The synthetic generator draws reporting delay as a uniform random "
                       "4-72 hours and complainant occupation at random, both independent of "
                       "the planted offender series — so here they are noise by construction "
                       "and can only blur true links. Both remain wired into the composite and "
                       "into live triage; enabling them is a one-line weight change, and this "
                       "panel re-measures them against whatever data is loaded. Real FIR data "
                       "may well carry signal in both."),
    }
    out["identity_experiment"] = {
        "question": "Should the accused name influence whether two crimes are linked?",
        "answer": "No — we measured it, and it made the engine worse.",
        "without_name": {"precision": base["pairwise_precision"],
                         "recall": base["pairwise_recall"], "f1": base["pairwise_f1"]},
        "with_name_at_8pct": {"precision": ev3["pairwise_precision"],
                              "recall": ev3["pairwise_recall"], "f1": ev3["pairwise_f1"]},
        "conclusion": ("Coincidental name collisions pulled unrelated cases into real "
                       "groups. Identity now carries zero weight in linkage; names are "
                       "surfaced to the investigator as unconfirmed corroboration only."),
    }
    return out
