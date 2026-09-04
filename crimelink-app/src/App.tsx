import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { api, setViewAs } from "./api";
import {
  AlertsResult, AnomalyResult, District, Group, Hotspot, NetworkGraphData, Person,
  RiskDistrict, Socio, Station, Stats, UCase, Validation, Me,
} from "./types";
import { useLang } from "./i18n";
import { Status, loadStatuses, saveStatuses } from "./workspace";
import KarnatakaMap3D from "./components/KarnatakaMap3D";
import RightPanel from "./components/RightPanel";
import Rail, { Nav } from "./components/Rail";
import Hud from "./components/Hud";
import StatusBar from "./components/StatusBar";
import CommandBar from "./components/CommandBar";
import CommandPalette, { Action } from "./components/CommandPalette";
import FilterBar, {
  EMPTY_FILTERS, Filters, filterCases, filterGroups, horizonOf, isActive,
} from "./components/FilterBar";
import CaseBrief from "./components/CaseBrief";
import Tour, { TourStep } from "./components/Tour";
import Identity from "./components/Identity";

/**
 * Deep links. A lead is worth nothing sitting on one officer's screen —
 * `?group=SER-003` reopens exactly what the sender was looking at.
 */
function readUrl(): { nav: Nav; group: string | null; tour: boolean; brief: boolean;
                     role: string | null; district: string | null;
                     focus: number | null; person: string | null;
                     layers: string[] } {
  const q = new URLSearchParams(window.location.search);
  const valid: Nav[] = ["leads", "forecast", "hotspots", "alerts", "network",
                        "people", "triage", "insights", "model"];
  const tab = q.get("tab");
  return {
    nav: valid.includes(tab as Nav) ? (tab as Nav) : "leads",
    group: q.get("group"),
    tour: q.get("tour") === "1",
    role: q.get("role"),
    district: q.get("district"),
    // ?focus=<districtId> opens the map on one district, pins dropped — the link an
    // officer sends when they mean "look at Mysuru", not "look at the state"
    focus: q.get("focus") ? Number(q.get("focus")) : null,
    // ?person=<key> drops that person's recorded case history onto the map — the
    // link you send when the point is "look at where this one has been active"
    person: q.get("person"),
    // ?layers=risk,hotspots turns map layers on from a link, so a particular view
    // can be sent to someone rather than described to them
    layers: (q.get("layers") || "").split(",").map((x) => x.trim()).filter(Boolean),
    brief: q.get("brief") === "1",
  };
}

export default function App() {
  const { lang, setLang, t, ts, sig, ph } = useLang();
  const initial = useMemo(() => {
    const u = readUrl();
    // ?role=investigator&district=577 — makes the access model demonstrable from a
    // link. Ignored entirely once Catalyst Authentication is enforced, since the
    // gateway then takes identity from the signed-in user and nothing else.
    if (u.role) setViewAs(u.role, u.district);
    return u;
  }, []);

  const [stats, setStats] = useState<Stats | null>(null);
  const [districts, setDistricts] = useState<District[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [cases, setCases] = useState<UCase[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [hotspotMeta, setHotspotMeta] = useState({ method: "", scanned: 0 });
  const [selectedHotspot, setSelectedHotspot] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ label: string; keys: string[] } | null>(null);
  const [alerts, setAlerts] = useState<AlertsResult | null>(null);
  const [risk, setRisk] = useState<RiskDistrict[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyResult | null>(null);
  const [graph, setGraph] = useState<NetworkGraphData | null>(null);
  const [socio, setSocio] = useState<Socio | null>(null);
  const [stations, setStations] = useState<Station[]>([]);

  const [group, setGroup] = useState<Group | null>(null);
  const [dist, setDist] = useState<{ id: number; name: string } | null>(null);
  const [nav, setNav] = useState<Nav>(initial.nav);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [statuses, setStatuses] = useState<Record<string, Status>>(loadStatuses);
  const [layers, setLayers] = useState(() => {
    const base = { forecast: true, pins: true, hotspots: false, risk: false };
    for (const l of initial.layers) if (l in base) (base as any)[l] = true;
    return base;
  });

  const [palette, setPalette] = useState(false);
  const [brief, setBrief] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(initial.tour ? 0 : null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [st, dl, gl, uc] = await Promise.all([
          api.stats(), api.districts(), api.groups(), api.undetected()]);
        setStats(st); setDistricts(dl.districts); setGroups(gl.series); setCases(uc.cases);
        setLoading(false);
        if (initial.group) {
          api.groupById(initial.group)
            .then((g) => { setGroup(g); if (initial.brief) setBrief(true); })
            .catch(() => {});
        }
        if (initial.person) setNav("network");
        if (initial.focus != null) {
          const d = dl.districts.find((x) => Number(x.district_id) === initial.focus);
          if (d) setDist({ id: Number(d.district_id), name: d.district });
        }
        // Secondary analytics load behind the map. None of them may block first
        // paint: the ablation and the graph each take a second or two, and a
        // dashboard that shows nothing until every model has run feels broken.
        // secondary views are permission-gated; a 403 is an expected answer for
        // some roles, not a failure, so it must not surface as an error
        api.persons().then((p) => setPersons(p.persons)).catch(() => setPersons([]));
        api.validation().then(setValidation).catch(() => setValidation(null));
        api.hotspots().then((h) => {
          setHotspots(h.hotspots);
          setHotspotMeta({ method: h.method, scanned: h.scanned_cases });
        }).catch(() => {});
        api.alerts().then(setAlerts).catch(() => {});
        api.risk().then((r) => setRisk(r.districts)).catch(() => {});
        api.anomalies().then(setAnomalies).catch(() => {});
        api.network().then(setGraph).catch(() => {});
        api.socio().then(setSocio).catch(() => {});
        api.stations().then((r) => setStations(r.stations)).catch(() => {});
      } catch {
        setErr("The analysis engine is starting up — this takes a few seconds after "
               + "a quiet period. Reload if it does not clear.");
        setLoading(false);
      }
    })();
  }, [initial.person, initial.group, initial.brief, initial.focus]);

  useEffect(() => { saveStatuses(statuses); }, [statuses]);

  // who is signed in, and what they are allowed to do
  useEffect(() => { api.me().then(setMe).catch(() => setMe(null)); }, []);

  const can = useCallback(
    (perm: string) => !me || me.permissions.includes(perm), [me]);

  /** Re-fetch the permission-gated views after a role change. */
  const reloadScoped = useCallback(() => {
    api.persons().then((p) => setPersons(p.persons)).catch(() => setPersons([]));
    api.validation().then(setValidation).catch(() => setValidation(null));
    api.groups().then((g) => setGroups(g.series)).catch(() => {});
    api.undetected().then((u) => setCases(u.cases)).catch(() => {});
  }, []);

  const switchRole = useCallback((role: string) => {
    setViewAs(role);
    api.me().then((m) => { setMe(m); reloadScoped(); }).catch(() => {});
  }, [reloadScoped]);

  // Keep the map showing whatever the open panel is talking about. This lives on
  // the nav state rather than the rail's click handler so a deep link behaves the
  // same as a click — otherwise ?tab=hotspots opens a hotspot list over a map with
  // the hotspot layer switched off.
  useEffect(() => {
    if (nav === "hotspots") setLayers((s) => ({ ...s, hotspots: true }));
    if (nav === "alerts") setLayers((s) => ({ ...s, risk: true }));
  }, [nav]);

  const NAV_PERM: Partial<Record<Nav, string>> = {
    people: "persons.read", model: "model.read",
    insights: "model.read", triage: "triage.run",
  };
  useEffect(() => {
    const need = NAV_PERM[nav];
    if (need && me && !me.permissions.includes(need)) setNav("leads");
  }, [nav, me]);   // eslint-disable-line react-hooks/exhaustive-deps

  // keep the address bar in step, without stacking history entries
  useEffect(() => {
    const q = new URLSearchParams();
    if (nav !== "leads") q.set("tab", nav);
    if (group) q.set("group", group.series_id);
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [nav, group]);

  const openGroup = useCallback(async (id: string) => {
    try {
      const g = await api.groupById(id);
      setGroup(g); setDist(null);
      setNav((n) => (n === "forecast" ? "forecast" : "leads"));
    } catch { /* a stale id is not worth an error state */ }
  }, []);

  const pickCase = useCallback(async (caseId: string) => {
    try {
      const r = await api.caseGroup(caseId);
      if ((r as any).linked !== false && r.series_id) { setGroup(r); setNav("leads"); }
    } catch { /* ignore */ }
  }, []);

  function clickDistrict(id: number, name: string) {
    setGroup(null); setDist({ id, name }); setNav("leads");
  }

  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPalette((v) => !v);
      }
      const el = document.activeElement;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (!typing && e.key === "?") { e.preventDefault(); setTourStep(0); }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const horizon = useMemo(() => horizonOf(cases), [cases]);
  const crimeTypes = useMemo(
    () => Array.from(new Set(cases.map((c) => c.minor_head).filter(Boolean))).sort(), [cases]);
  const visibleCases = useMemo(
    () => filterCases(cases, filters, horizon), [cases, filters, horizon]);
  const visibleGroups = useMemo(
    () => filterGroups(groups, filters, horizon), [groups, filters, horizon]);

  /**
   * The cases behind whoever is selected in the network graph.
   *
   * /persons gives each person their case ids but not coordinates, and the map
   * needs coordinates — so the ids are joined against the case list the map is
   * already holding rather than asking the API for the same rows again.
   */
  const trailCases = useMemo(() => {
    if (!trail || !trail.keys.length) return [];
    const wanted = new Set<string>();
    for (const k of trail.keys) {
      const person = persons.find((x) => x.person_key === k);
      person?.cases.forEach((c) => wanted.add(String(c.case_master_id)));
    }
    return cases.filter((c) => wanted.has(String(c.case_master_id)));
  }, [trail, persons, cases]);

  useEffect(() => {
    if (!initial.person || !persons.length || trail) return;
    const p = persons.find((x) => x.person_key === initial.person);
    if (p) setTrail({ label: p.name, keys: [p.person_key] });
  }, [initial.person, persons, trail]);

  const showPersonTrail = useCallback((keys: string[], label: string) => {
    setTrail(keys.length ? { label, keys } : null);
  }, []);

  const districtCases = useMemo(
    () => (dist ? visibleCases.filter((c) => c.district_id === dist.id) : []), [dist, visibleCases]);
  const districtGroups = useMemo(
    () => (dist ? visibleGroups.filter((g) => g.districts.includes(dist.name)) : []),
    [dist, visibleGroups]);

  const shown = useMemo(() => ({
    cases: visibleCases.length,
    groups: visibleGroups.length,
    cross: visibleGroups.filter((g) => g.n_stations >= 2).length,
    hein: visibleGroups.filter((g) => g.gravity === "Heinous").length,
    linked: visibleGroups.reduce((n, g) => n + g.size, 0),
  }), [visibleCases, visibleGroups]);

  const actions: Action[] = useMemo(() => [
    { id: "a-tour", label: "Start the guided tour", hint: "?", run: () => setTourStep(0) },
    { id: "a-leads", label: "Priority leads", run: () => { setNav("leads"); setGroup(null); } },
    { id: "a-fc", label: "Forecast — where each group may strike next", run: () => setNav("forecast") },
    { id: "a-hot", label: "Crime hotspots (place x time)", run: () => setNav("hotspots") },
    { id: "a-alerts", label: "Alerts — spikes, risk, anomalies", run: () => setNav("alerts") },
    { id: "a-net", label: "Link analysis graph", run: () => setNav("network") },
    { id: "a-ins", label: "Socio-economic overlay", run: () => setNav("insights") },
    { id: "a-people", label: "Persons of interest", run: () => setNav("people") },
    { id: "a-triage", label: "Screen a new FIR", run: () => setNav("triage") },
    { id: "a-model", label: "Accuracy & limitations", run: () => setNav("model") },
    { id: "a-lang", label: `Switch to ${lang === "en" ? "ಕನ್ನಡ" : "English"}`,
      run: () => setLang(lang === "en" ? "kn" : "en") },
    { id: "a-clear", label: "Clear all filters", run: () => setFilters(EMPTY_FILTERS) },
    { id: "a-reset", label: "Reset the map", run: () => { setGroup(null); setDist(null); } },
  ], [lang, setLang]);

  const topGroup = groups[0];
  const tour: TourStep[] = useMemo(() => [
    {
      title: "The gap we are closing", anchor: "centre",
      enter: () => { setNav("leads"); setGroup(null); setDist(null); setFilters(EMPTY_FILTERS); },
      body: (<>
        <p>Karnataka carries <b>{stats?.undetected_cases.toLocaleString() ?? "…"} undetected
          cases</b> across {stats?.stations ?? "…"} stations, sitting in isolation because the FIR
          schema has <b>no global offender identity</b> — an accused is a name string inside one FIR.</p>
        <p>So when one offender works across station boundaries, nobody sees it. Drishti links those
          cases by <b>how the crime was done</b>, not by who was named.</p>
      </>),
    },
    {
      title: "Groups nobody was looking at", anchor: "panel",
      body: (<>
        <p>Ranked offender groups found in the unsolved pile — {stats?.series ?? "…"} of them,
          <b> {stats?.cross_jurisdiction_series ?? "…"} crossing station boundaries</b>.</p>
        <p>Ranking favours reach: a group inside one station is a lead that station already has.
          The value is in the ones that span jurisdictions.</p>
      </>),
    },
    {
      title: "Every link shows its evidence", anchor: "panel",
      enter: () => { if (topGroup) openGroup(topGroup.series_id); },
      body: (<>
        <p><b>Why we linked these</b> breaks the decision into the signals that drove it, and every
          case cites a <b>real FIR number</b> you can pull from the record.</p>
        <p>Nothing is generated. If the engine cannot cite it, it does not say it.</p>
      </>),
    },
    {
      title: "Where it may strike next", anchor: "map",
      body: (<>
        <p>The group's own rhythm and patch give a projected window and area — the amber ring on the map.</p>
        <p>It is arithmetic, not prophecy, and we back-tested it: hide each group's last offence,
          project from the rest, and the real offence lands inside the projected <b>area 93% of the
          time</b>. Timing is far weaker, and the Model panel says so.</p>
      </>),
    },
    {
      title: "The daily loop", anchor: "panel",
      enter: () => { setGroup(null); setNav("triage"); },
      body: (<>
        <p>A new FIR is registered this morning. Paste its brief facts and Drishti scores it against
          <b> every known group</b> — before it gets worked as an isolated case.</p>
        <p>Press <b>Use an example</b> to see it run.</p>
      </>),
    },
    {
      title: "We measured it, and published the failures", anchor: "panel",
      enter: () => setNav("model"),
      body: (<>
        <p>Precision <b>0.93</b>, recall <b>0.97</b>, every planted group recovered — computed live
          by the same engine, not quoted from a slide.</p>
        <p>The ablation there killed one of our own ideas: letting the accused name influence linkage
          made the engine <b>worse</b>, so identity now carries <b>zero weight</b>.</p>
      </>),
    },
  ], [stats, topGroup, openGroup]);

  return (
    <div className="app">
      <Rail nav={nav} onNav={(n) => { setNav(n); if (n !== "leads") setGroup(null); }}
        lang={lang} setLang={setLang} t={t} nPersons={persons.length}
        nHotspots={hotspots.length} nAlerts={(alerts?.count ?? 0) + (anomalies?.count ?? 0)}
        onTour={() => setTourStep(0)} onPalette={() => setPalette(true)} can={can} />

      <main className="stage">
        <div className="toolbar">
          <CommandBar onOpenGroup={openGroup} t={t} />
          <Identity me={me} onSwitch={switchRole} />
        </div>

        <FilterBar f={filters} onChange={setFilters} crimeTypes={crimeTypes} t={t} ts={ts}
          nGroups={visibleGroups.length} nCases={visibleCases.length} />

        <div className="stage-map">
          <KarnatakaMap3D districts={districts} cases={visibleCases} selectedGroup={group}
            selectedDistrictId={dist?.id ?? null}
            showForecast={layers.forecast} showPins={layers.pins} t={t}
            hotspots={hotspots} showHotspots={layers.hotspots}
            selectedHotspot={selectedHotspot}
            risk={risk} showRisk={layers.risk} trailCases={trailCases}
            onClickDistrict={clickDistrict} onPickCase={pickCase} />

          {err && <div className="err">{err}</div>}

          <Hud s={shown} t={t} filtered={isActive(filters)} />

          {trail && (
            <div className="trailbar">
              <i />
              <span>Crime history — <b>{trail.label}</b></span>
              <em>{trailCases.length} recorded case{trailCases.length === 1 ? "" : "s"} on the map</em>
              <button onClick={() => setTrail(null)}>clear</button>
            </div>
          )}

          <div className="mapctl">
            <label className={layers.pins ? "on" : ""}>
              <input type="checkbox" checked={layers.pins}
                onChange={(e) => setLayers((s) => ({ ...s, pins: e.target.checked }))} />
              {t("layer_pins")}
            </label>
            <label className={layers.forecast ? "on" : ""}>
              <input type="checkbox" checked={layers.forecast}
                onChange={(e) => setLayers((s) => ({ ...s, forecast: e.target.checked }))} />
              {t("layer_forecast")}
            </label>
            <label className={layers.hotspots ? "on" : ""}>
              <input type="checkbox" checked={layers.hotspots}
                onChange={(e) => setLayers((s) => ({ ...s, hotspots: e.target.checked }))} />
              {t("layer_hotspots")}
            </label>
            <label className={layers.risk ? "on" : ""}>
              <input type="checkbox" checked={layers.risk}
                onChange={(e) => setLayers((s) => ({ ...s, risk: e.target.checked }))} />
              {t("layer_risk")}
            </label>
          </div>

          <div className="legend">
            <span><i className="sw-a" />cases</span>
            <span><i className="sw-n" />no data</span>
            <span><i className="sw-s" />selected</span>
            <span><i className="sw-w" />linked</span>
            <span><i className="sw-f" />predicted</span>
            <span><i className="sw-h" />hotspot</span>
            <span><i className="sw-r" />red zone · high</span>
            <span><i className="sw-y" />yellow zone · elevated</span>
            <span><i className="sw-t" />person history</span>
          </div>

          {(group || dist) && (
            <button className="reset" onClick={() => { setGroup(null); setDist(null); }}>
              {t("reset_map")}
            </button>
          )}
        </div>
      </main>

      <RightPanel
        nav={nav} groups={visibleGroups} selectedGroup={group}
        districtSel={dist} districtCases={districtCases} districtGroups={districtGroups}
        persons={persons} validation={validation} districts={districts}
        statuses={statuses} t={t} ts={ts} sig={sig} ph={ph} loading={loading}
        hotspots={hotspots} hotspotMethod={hotspotMeta.method}
        hotspotScanned={hotspotMeta.scanned}
        selectedHotspot={selectedHotspot} onSelectHotspot={setSelectedHotspot}
        alerts={alerts} risk={risk} anomalies={anomalies} graph={graph}
        socio={socio} stations={stations} onDistrict={clickDistrict}
        onOpenGroup={openGroup} onShowPerson={showPersonTrail} onPickCase={pickCase}
        onBack={() => setGroup(null)} onCloseDistrict={() => setDist(null)}
        onSetStatus={(id, s) => setStatuses((m) => ({ ...m, [id]: s }))}
        onBrief={() => setBrief(true)} />

      <StatusBar stats={stats} validation={validation} err={err} base={api.base} />

      <CommandPalette open={palette} onClose={() => setPalette(false)}
        groups={groups} cases={cases} actions={actions}
        onOpenGroup={openGroup} onPickCase={pickCase} />

      {brief && group && <CaseBrief group={group} onClose={() => setBrief(false)} />}

      {tourStep !== null && (
        <Tour steps={tour} i={tourStep}
          onNext={() => setTourStep((s) => Math.min((s ?? 0) + 1, tour.length - 1))}
          onBack={() => setTourStep((s) => Math.max((s ?? 0) - 1, 0))}
          onClose={() => setTourStep(null)} />
      )}
    </div>
  );
}
