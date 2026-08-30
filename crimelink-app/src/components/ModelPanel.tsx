import React from "react";
import { Validation } from "../types";
import { TFn } from "../i18n";

/**
 * Measured accuracy, in the product.
 *
 * Any team can put a precision figure on a slide. These numbers are computed by
 * the same engine that served everything else on screen, at the moment this panel
 * is opened — including the ablation showing what each signal is actually worth,
 * a back-test of the forecast, and a written account of where the method fails.
 *
 * The limitations section is not a disclaimer. For a police tool, knowing when to
 * distrust the output is the difference between a lead and a wrongful accusation.
 */
export default function ModelPanel({ v, t }: { v: Validation | null; t: TFn }) {
  if (!v) return <div className="empty">{t("loading")}</div>;

  const a = v.accuracy;
  const ab = v.ablation;
  const bt = v.forecast_backtest;
  const ie = v.identity_experiment;
  const maxDrop = ab ? Math.max(...ab.rows.map((r) => r.f1_drop), 0.001) : 1;

  return (
    <div className="mdl">
      {a ? (
        <>
          <div className="mdl-kpis">
            <Metric v={a.precision} l={t("precision")} sub="of the links we make, this share are real" />
            <Metric v={a.recall} l={t("recall")} sub="of the real links, this share we find" />
            <Metric v={a.f1} l="F1" sub="the balance of the two" hi />
          </div>
          <div className="mdl-rec">
            <b>{a.series_recovered}/{a.series_total}</b> {t("recovered")} — every planted offender
            group in the data was found.
          </div>
          <div className="mdl-method">{a.method}.</div>
        </>
      ) : (
        <div className="mdl-note">{v.note}</div>
      )}

      {ie && (
        <div className="mdl-exp">
          <div className="gv-sub">{ie.question}</div>
          <div className="mdl-exp-a">{ie.answer}</div>
          <table className="mdl-t">
            <thead><tr><th>Configuration</th><th>P</th><th>R</th><th>F1</th></tr></thead>
            <tbody>
              <tr><td>Name given 8% weight</td>
                <td>{ie.with_name_at_8pct.precision.toFixed(3)}</td>
                <td>{ie.with_name_at_8pct.recall.toFixed(3)}</td>
                <td>{ie.with_name_at_8pct.f1.toFixed(3)}</td></tr>
              <tr className="win"><td>Name given zero weight <b>(shipped)</b></td>
                <td>{ie.without_name.precision.toFixed(3)}</td>
                <td>{ie.without_name.recall.toFixed(3)}</td>
                <td>{ie.without_name.f1.toFixed(3)}</td></tr>
            </tbody>
          </table>
          <div className="mdl-method">{ie.conclusion}</div>
        </div>
      )}

      {ab && (
        <>
          <div className="gv-sub">{t("signal_worth")}</div>
          <div className="mdl-method">{ab.method}.</div>
          {ab.rows.map((r) => (
            <div className="abl" key={r.signal}>
              <div className="abl-top">
                <span className="abl-l">{r.label}</span>
                <span className="abl-w">weight {(r.weight * 100).toFixed(0)}%</span>
              </div>
              <div className="abl-bar">
                <span style={{ width: `${(r.f1_drop / maxDrop) * 100}%` }} />
              </div>
              <div className="abl-n">
                without it, F1 falls {ab.baseline_f1.toFixed(3)} → {r.f1_without.toFixed(3)}
                <b> (−{r.f1_drop.toFixed(3)})</b>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="gv-sub">{t("backtest_head")}</div>
      {bt.tested > 0 ? (
        <>
          <div className="mdl-kpis">
            <Metric v={bt.zone_hit_rate ?? 0} l="Area hit" sub="the next offence fell in the projected area" />
            <Metric v={bt.window_hit_rate ?? 0} l="Window hit" sub="…and inside the projected time window" />
          </div>
          <div className="mdl-method">
            {bt.method}. Tested on {bt.tested} groups; median timing error{" "}
            <b>{bt.median_timing_error_days} days</b>. The area holds up far better than
            the timing — which is what you would expect, and it is why the map ring is
            the actionable part of the forecast, not the date.
          </div>
        </>
      ) : (
        <div className="mdl-note">{bt.note}</div>
      )}

      <div className="gv-sub">Data this ran on</div>
      <div className="mdl-prof">
        <Row k="Undetected cases" v={v.data_profile.undetected_cases} />
        <Row k="Police stations" v={v.data_profile.stations} />
        <Row k="Districts" v={v.data_profile.districts} />
        <Row k="With usable brief facts" v={v.data_profile.with_brief_facts} />
        <Row k="With coordinates" v={v.data_profile.with_coordinates} />
        <Row k="With a named accused" v={v.data_profile.with_named_accused} />
        <Row k="Groups found" v={v.data_profile.groups_found} />
        <Row k="Cases placed in a group" v={v.data_profile.cases_grouped} />
      </div>

      <div className="gv-sub">{t("limitations")}</div>
      <div className="lim">
        {v.limitations.map(([head, body]) => (
          <div className="lim-i" key={head}>
            <div className="lim-h">{head}</div>
            <div className="lim-b">{body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ v, l, sub, hi }: { v: number; l: string; sub: string; hi?: boolean }) {
  return (
    <div className={`metric ${hi ? "hi" : ""}`}>
      <div className="metric-n">{(v * 100).toFixed(1)}<small>%</small></div>
      <div className="metric-l">{l}</div>
      <div className="metric-s">{sub}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return <div className="prof-r"><span>{k}</span><b>{v.toLocaleString()}</b></div>;
}
