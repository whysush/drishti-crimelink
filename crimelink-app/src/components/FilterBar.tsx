import React from "react";
import { Group, UCase } from "../types";
import { TFn, TSFn } from "../i18n";

/**
 * Filters over the whole view — leads, map pins and the headline counts move
 * together, so what the numbers describe is always what is on screen.
 */
export interface Filters {
  crime: string;          // minor_head, "" = all
  heinous: boolean;
  crossStation: boolean;
  minSize: number;
  periodDays: number;     // 0 = all time, measured back from the latest case in the data
}

export const EMPTY_FILTERS: Filters = {
  crime: "", heinous: false, crossStation: false, minSize: 0, periodDays: 0,
};

export function isActive(f: Filters) {
  return !!f.crime || f.heinous || f.crossStation || f.minSize > 0 || f.periodDays > 0;
}

/** Latest incident in the data — the reference "now" for period filters. */
export function horizonOf(cases: UCase[]): number {
  let max = 0;
  for (const c of cases) {
    if (!c.incident_from) continue;
    const t = new Date(c.incident_from).getTime();
    if (t > max) max = t;
  }
  return max || Date.now();
}

export function filterCases(cases: UCase[], f: Filters, horizon: number): UCase[] {
  const cut = f.periodDays ? horizon - f.periodDays * 86400000 : 0;
  return cases.filter((c) => {
    if (f.crime && c.minor_head !== f.crime) return false;
    if (f.heinous && c.gravity !== "Heinous") return false;
    if (cut && (!c.incident_from || new Date(c.incident_from).getTime() < cut)) return false;
    return true;
  });
}

export function filterGroups(groups: Group[], f: Filters, horizon: number): Group[] {
  const cut = f.periodDays ? horizon - f.periodDays * 86400000 : 0;
  return groups.filter((g) => {
    if (f.heinous && g.gravity !== "Heinous") return false;
    if (f.crossStation && g.n_stations < 2) return false;
    if (f.minSize && g.size < f.minSize) return false;
    if (f.crime && !g.members.some((m) => m.minor_head === f.crime)) return false;
    if (cut && (!g.date_to || new Date(g.date_to).getTime() < cut)) return false;
    return true;
  });
}

const PERIODS = [
  { d: 0, k: "all_time" }, { d: 90, k: "last_90" },
  { d: 180, k: "last_6m" }, { d: 365, k: "last_1y" },
];

export default function FilterBar({ f, onChange, crimeTypes, t, ts, nGroups, nCases }: {
  f: Filters; onChange: (f: Filters) => void; crimeTypes: string[]; t: TFn; ts: TSFn;
  nGroups: number; nCases: number;
}) {
  const set = (p: Partial<Filters>) => onChange({ ...f, ...p });
  return (
    <div className="fbar">
      <span className="fbar-l">{t("filters")}</span>

      <select value={f.crime} onChange={(e) => set({ crime: e.target.value })}>
        <option value="">{t("all_crimes")}</option>
        {crimeTypes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <select value={f.periodDays} onChange={(e) => set({ periodDays: Number(e.target.value) })}>
        {PERIODS.map((p) => <option key={p.d} value={p.d}>{t(p.k)}</option>)}
      </select>

      <select value={f.minSize} onChange={(e) => set({ minSize: Number(e.target.value) })}>
        <option value={0}>{t("any_size")}</option>
        {[4, 5, 6].map((n) => (
          <option key={n} value={n}>{ts("size_n", { n })}</option>
        ))}
      </select>

      <label className={`fchk ${f.heinous ? "on" : ""}`}>
        <input type="checkbox" checked={f.heinous} onChange={(e) => set({ heinous: e.target.checked })} />
        {t("heinous_only")}
      </label>
      <label className={`fchk ${f.crossStation ? "on" : ""}`}>
        <input type="checkbox" checked={f.crossStation}
          onChange={(e) => set({ crossStation: e.target.checked })} />
        {t("cross_only")}
      </label>

      <span className="fbar-count">{ts("count_summary", { g: nGroups, c: nCases.toLocaleString() })}</span>
      {isActive(f) && (
        <button className="fbar-clear" onClick={() => onChange(EMPTY_FILTERS)}>{t("clear")}</button>
      )}
    </div>
  );
}
