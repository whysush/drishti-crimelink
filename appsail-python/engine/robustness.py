"""
Robustness checks — the two questions a sceptical reader should ask.

Both headline numbers are measured against offender series we planted ourselves,
which invites the obvious challenge: did the engine simply find patterns its own
authors inserted? And the brief promises linkage survives sparse free text, which
is a claim about behaviour on data nobody has seen yet.

Neither is answered by precision and recall, so both are answered here.

  negative control  destroy the structure, keep every marginal distribution, and
                    see whether the pipeline still reports groups. If it invents
                    them from noise, the accuracy figures mean nothing.
  degradation       blank the BriefFacts text and watch what happens to the number
                    of groups and their precision.

Both re-run the real pipeline. Nothing here is hard-coded.
"""
from __future__ import annotations

import random

from .pipeline import DEFAULT_PARAMS, evaluate, run

SCRAMBLED_FIELDS = ("brief_facts", "minor_head_id", "act_sections",
                    "incident_from", "victims", "accused_names")


def _scramble(cases, seed):
    """Shuffle each behavioural field independently.

    Every marginal distribution survives — the same texts, times, places and crime
    types are all still present in the same proportions. Only the correspondence
    between a case and its own behaviour is destroyed, so no offender pattern can
    remain for the engine to find.
    """
    rnd = random.Random(seed)
    out = [dict(c) for c in cases]
    for field in SCRAMBLED_FIELDS:
        vals = [c[field] for c in out]
        rnd.shuffle(vals)
        for c, v in zip(out, vals):
            c[field] = v
    coords = [(c["lat"], c["lon"]) for c in out]
    rnd.shuffle(coords)
    for c, (la, lo) in zip(out, coords):
        c["lat"], c["lon"] = la, lo
    return out


def _blank_text(cases, fraction, seed=7):
    rnd = random.Random(seed)
    out = [dict(c) for c in cases]
    for c in out:
        if rnd.random() < fraction:
            c["brief_facts"] = ""
    return out


def report(cases, ground_truth, params=None, seeds=(1, 2, 3)):
    p = dict(DEFAULT_PARAMS)
    p.update(params or {})

    _, base = run(cases, p)
    base_eval = evaluate(base, cases, ground_truth) if ground_truth else None

    control = []
    for s in seeds:
        _, series = run(_scramble(cases, s), p)
        control.append({"seed": s, "groups": len(series),
                        "groups_of_4_plus": sum(1 for x in series if x["size"] >= 4)})
    invented = sum(c["groups"] for c in control)

    degradation = []
    for frac in (0.0, 0.5, 1.0):
        c = cases if frac == 0.0 else _blank_text(cases, frac)
        _, series = run(c, p)
        row = {"text_blank_pct": int(frac * 100), "groups": len(series)}
        if ground_truth:
            ev = evaluate(series, c, ground_truth)
            row.update(precision=ev["pairwise_precision"], recall=ev["pairwise_recall"],
                       recovered=ev["n_series_recovered"], of=ev["n_series_total"])
        degradation.append(row)

    return {
        "negative_control": {
            "question": ("Does the engine invent groups when there is nothing to find?"),
            "answer": ("No — it reports nothing." if invented == 0
                       else f"It still reported {invented} groups across {len(seeds)} runs."),
            "method": ("every behavioural field is shuffled independently, so all the "
                       "same texts, times, places and crime types remain in the same "
                       "proportions and only the link between a case and its own "
                       "behaviour is destroyed"),
            "real_groups": len(base),
            "runs": control,
            "clean": invented == 0,
        },
        "degradation": {
            "question": "What happens when the free-text description is missing?",
            "method": ("BriefFacts is blanked for a share of cases and the whole "
                       "pipeline re-run; the remaining signals renormalise, and the "
                       "score is discounted by how much evidence a pair actually has"),
            "rows": degradation,
            "note": ("Fewer groups with lower recall is the intended behaviour: on thin "
                     "evidence the engine should get more cautious, not louder. Without "
                     "the coverage discount this returned 53 groups at precision 0.375."),
        },
        "baseline": None if not base_eval else {
            "precision": base_eval["pairwise_precision"],
            "recall": base_eval["pairwise_recall"],
            "f1": base_eval["pairwise_f1"],
        },
    }
