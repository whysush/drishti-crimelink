"""
Local end-to-end engine run against the seed CSVs, evaluated vs planted ground
truth. No Catalyst needed:  python run_local.py [--tune]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine.data import CSVBackend
from engine.pipeline import evaluate, run

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_DIR = os.path.join(ROOT, "seed", "csv")
GT = os.path.join(ROOT, "seed", "ground_truth_series.json")


def main(tune=False):
    cases = CSVBackend(CSV_DIR).load()
    gt = json.load(open(GT))
    print(f"Loaded {len(cases)} undetected (cstype='C') cases\n")

    if tune:
        print("threshold  cohesion   P     R     F1    series  recov")
        best = None
        for th in [0.45, 0.5, 0.55, 0.6, 0.65]:
            for mc in [0.4, 0.45, 0.5, 0.55]:
                fp, series = run(cases, dict(distance_threshold=th, min_cohesion=mc))
                ev = evaluate(series, cases, gt)
                row = (th, mc, ev["pairwise_precision"], ev["pairwise_recall"],
                       ev["pairwise_f1"], ev["n_predicted_series"],
                       f"{ev['n_series_recovered']}/{ev['n_series_total']}")
                print(f"  {th:.2f}      {mc:.2f}    {row[2]:.2f}  {row[3]:.2f}  {row[4]:.2f}   {row[5]:>4}   {row[6]}")
                if best is None or ev["pairwise_f1"] > best[0]:
                    best = (ev["pairwise_f1"], th, mc)
        print(f"\nBest F1={best[0]:.3f} at distance_threshold={best[1]}, min_cohesion={best[2]}")
        return

    fp, series = run(cases)
    ev = evaluate(series, cases, gt)
    print("=== EVALUATION vs planted ground truth ===")
    print(f"  pairwise: P={ev['pairwise_precision']}  R={ev['pairwise_recall']}  "
          f"F1={ev['pairwise_f1']}  (tp={ev['tp']} fp={ev['fp']} fn={ev['fn']})")
    print(f"  series recovered: {ev['n_series_recovered']}/{ev['n_series_total']}  "
          f"| predicted series: {ev['n_predicted_series']}")
    for k, v in ev["per_series"].items():
        flag = "OK " if v["recovered"] else "MISS"
        print(f"    [{flag}] {k}: {v['largest_together']}/{v['size']} together -> {v['cluster']}")

    print("\n=== TOP RANKED SERIES (the investigator's queue) ===")
    for s in series[:6]:
        wk = f" | weak name: {s['weak_name']['name']} ({s['weak_name']['cases']}/{s['weak_name']['of']})" if s["weak_name"] else ""
        print(f"\n  {s['series_id']}  rank={s['rank_score']}  cohesion={s['cohesion']}  "
              f"actionability={s['actionability']}")
        print(f"    {s['size']} cases across {s['n_stations']} stations "
              f"({', '.join(s['districts'])}) | {s['gravity']}{wk}")
        print(f"    linked by: {', '.join(s['top_drivers'])} | span {s['spatial_span_km']}km "
              f"| {s['date_from']} -> {s['date_to']}")
        for m in s["members"][:3]:
            print(f"      - {m['crime_no']} @ {m['station']}: {m['brief_snippet'][:70]}")


if __name__ == "__main__":
    main(tune="--tune" in sys.argv)
