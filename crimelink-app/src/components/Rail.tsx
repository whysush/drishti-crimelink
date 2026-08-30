import React from "react";
import { TFn, Lang } from "../i18n";

/**
 * Left rail — primary navigation.
 *
 * Moving navigation out of the top bar buys back a whole strip of vertical space
 * for the map, and it puts the four things this product does side by side where
 * they can be compared rather than buried in a tab row.
 */
export type Nav = "leads" | "hotspots" | "alerts" | "network"
                | "people" | "triage" | "insights" | "model";

const ICONS: Record<Nav, React.ReactNode> = {
  // concentric rings — a hotspot
  hotspots: (<><circle cx="10" cy="11" r="2" /><circle cx="10" cy="11" r="5" />
    <path d="M10 2.5v2M15.5 5.5l-1.4 1.4M4.5 5.5l1.4 1.4" /></>),
  // a rising signal with a warning point
  alerts: (<><path d="M3 15l4-5 3 2.5L17 4" /><path d="M17 8V4h-4" />
    <circle cx="10" cy="17.5" r="1" /></>),
  // linked nodes
  network: (<><circle cx="5" cy="6" r="2" /><circle cx="15" cy="5.5" r="2" />
    <circle cx="10" cy="14.5" r="2" /><path d="M6.7 7.3 8.7 12.7M13.6 7.2 11.4 12.8M7 6h6" /></>),
  // overlay of place and population
  insights: (<><path d="M3 16.5 7 5l4 7 3-4 3 8.5z" /><path d="M2.5 17.5h15" /></>),
  // stacked records — the lead queue
  leads: (<><path d="M3 5h14M3 10h14M3 15h9" /><circle cx="16.5" cy="15" r="2" /></>),
  // a person, unresolved
  people: (<><circle cx="10" cy="6.5" r="3" /><path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /></>),
  // an incoming document
  triage: (<><path d="M5 2.5h6l4 4v11H5z" /><path d="M11 2.5v4h4" /><path d="M10 10v5M7.5 12.5h5" /></>),
  // a measured curve
  model: (<><path d="M3 16V4M3 16h14" /><path d="M6 13l3.5-5 3 3L17 5" /><circle cx="17" cy="5" r="1.3" /></>),
};

export default function Rail({
  nav, onNav, lang, setLang, t, nPersons, nHotspots, nAlerts, onTour, onPalette, can,
}: {
  nav: Nav; onNav: (n: Nav) => void;
  lang: Lang; setLang: (l: Lang) => void; t: TFn;
  nPersons: number; nHotspots: number; nAlerts: number;
  onTour: () => void; onPalette: () => void;
  can: (perm: string) => boolean;
}) {
  // A role that cannot open a panel is shown the item locked rather than having it
  // vanish — hiding it would leave an officer wondering what they are missing, and
  // "you need a different role" is more useful than silence.
  const NEEDS: Partial<Record<Nav, string>> = {
    people: "persons.read", model: "model.read",
    insights: "model.read", triage: "triage.run",
  };
  const items: { id: Nav; label: string; badge?: number }[] = [
    { id: "leads", label: t("tab_leads") },
    { id: "hotspots", label: t("tab_hotspots"), badge: nHotspots || undefined },
    { id: "alerts", label: t("tab_alerts"), badge: nAlerts || undefined },
    { id: "network", label: t("tab_network") },
    { id: "people", label: t("tab_people"), badge: nPersons || undefined },
    { id: "triage", label: t("tab_triage") },
    { id: "insights", label: t("tab_insights") },
    { id: "model", label: t("tab_model") },
  ];

  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-brand">
        <span className="rail-mark" aria-hidden>
          {/* दृष्टि — an aperture. The pupil is the only lit pixel in the chrome. */}
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <path d="M2.5 15S7.5 7 15 7s12.5 8 12.5 8-5 8-12.5 8S2.5 15 2.5 15Z"
              stroke="#63636d" strokeWidth="1.4" />
            <circle cx="15" cy="15" r="4.2" stroke="#9c9ca6" strokeWidth="1.4" />
            <circle cx="15" cy="15" r="1.9" fill="#ff9f1c" />
          </svg>
        </span>
        <span className="rail-name">Drishti</span>
      </div>

      <div className="rail-nav">
        {items.map((it) => {
          const need = NEEDS[it.id];
          const locked = !!need && !can(need);
          return (
            <button key={it.id} className={`rail-i ${nav === it.id ? "on" : ""} ${locked ? "locked" : ""}`}
              onClick={() => !locked && onNav(it.id)} aria-current={nav === it.id}
              disabled={locked}
              title={locked ? `Your role cannot open this — it needs "${need}"` : undefined}>
              <svg viewBox="0 0 20 20" aria-hidden>{ICONS[it.id]}</svg>
              <span>{it.label}</span>
              {locked ? <em className="lockb" aria-label="restricted">🔒</em>
                : it.badge != null && <em className="badge">{it.badge}</em>}
            </button>
          );
        })}
      </div>

      <div className="rail-foot">
        <button className="rail-btn" onClick={onTour} title="Guided tour (?)">◎ {t("tour")}</button>
        <button className="rail-btn" onClick={onPalette} title="Ctrl / ⌘ K">⌘K</button>
        <div className="rail-lang" role="group" aria-label="Language">
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          <button className={lang === "kn" ? "on" : ""} onClick={() => setLang("kn")}>ಕ</button>
        </div>
      </div>
    </nav>
  );
}
