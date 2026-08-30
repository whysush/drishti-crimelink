import React from "react";
import { TFn } from "../i18n";

/**
 * Stat block, floated over the map.
 *
 * These numbers used to be a toolbar across the top, which cost a strip of the
 * screen and made the map look like an afterthought. As a HUD they sit on the
 * thing they describe, and the map gets to be the hero.
 *
 * They report what is *currently filtered into view*, not the dataset totals —
 * a number that does not match what you can see is worse than no number.
 */
export default function Hud({ s, t, filtered }: {
  s: { cases: number; groups: number; cross: number; hein: number; linked: number };
  t: TFn; filtered: boolean;
}) {
  const rows: { n: number; l: string; key?: boolean }[] = [
    { n: s.cases, l: t("kpi_unsolved") },
    { n: s.groups, l: t("kpi_groups") },
    { n: s.cross, l: t("kpi_cross"), key: true },
    { n: s.hein, l: t("kpi_heinous") },
    { n: s.linked, l: t("kpi_connected") },
  ];
  return (
    <div className="hud">
      <div className="hud-h">
        <i className="hud-live" />
        <span className="lbl">{filtered ? "In view" : "Statewide"}</span>
      </div>
      <div className="hud-rows">
        {rows.map((r) => (
          <div className={`hud-r ${r.key ? "key" : ""}`} key={r.l}>
            <span className="hud-n">{r.n.toLocaleString()}</span>
            <span className="hud-l">{r.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
