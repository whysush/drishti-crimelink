import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import { api } from "./api";
import { District, Group, Stats, UCase } from "./types";
import KarnatakaMap3D from "./components/KarnatakaMap3D";
import RightPanel from "./components/RightPanel";
import CommandBar from "./components/CommandBar";

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [districts, setDistricts] = useState<District[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [cases, setCases] = useState<UCase[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [dist, setDist] = useState<{ id: number; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [st, dl, gl, uc] = await Promise.all([
          api.stats(), api.districts(), api.groups(), api.undetected()]);
        setStats(st); setDistricts(dl.districts); setGroups(gl.series); setCases(uc.cases);
      } catch { setErr(`Cannot reach the API at ${api.base}.`); }
    })();
  }, []);

  async function openGroup(id: string) {
    try { setGroup(await api.groupById(id)); } catch { /* ignore */ }
  }
  async function pickCase(caseId: string) {
    try {
      const r = await api.caseGroup(caseId);
      if ((r as any).linked !== false && r.series_id) setGroup(r);
    } catch { /* ignore */ }
  }
  function clickDistrict(id: number, name: string) {
    setGroup(null); setDist({ id, name });
  }

  const districtCases = useMemo(
    () => (dist ? cases.filter((c) => c.district_id === dist.id) : []), [dist, cases]);
  const districtGroups = useMemo(
    () => (dist ? groups.filter((g) => g.districts.includes(dist.name)) : []), [dist, groups]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Dri<span className="lk">shti</span></span>
          <span className="tag">Karnataka State Police</span>
        </div>
        {stats && (
          <div className="kpis">
            <Kpi n={stats.undetected_cases} l="unsolved cases" />
            <Kpi n={stats.series} l="linked groups" />
            <Kpi n={stats.cross_jurisdiction_series} l="across stations" hi />
            <Kpi n={stats.heinous_series} l="heinous groups" />
            <Kpi n={stats.cases_in_series} l="cases connected" />
          </div>
        )}
      </header>

      {err && <div className="err">{err}</div>}

      <CommandBar onOpenGroup={openGroup} />

      <div className="main">
        <section className="map-area">
          <KarnatakaMap3D districts={districts} cases={cases} selectedGroup={group}
            selectedDistrictId={dist?.id ?? null} onClickDistrict={clickDistrict} onPickCase={pickCase} />
          <div className="legend">
            <span className="dot-key"><i className="sw sw-a" /> has cases <i className="sw sw-n" /> no data <i className="sw sw-s" /> selected · taller = more cases</span>
          </div>
          {(group || dist) && (
            <button className="reset" onClick={() => { setGroup(null); setDist(null); }}>
              reset map
            </button>
          )}
        </section>

        <aside className="right">
          <RightPanel groups={groups} selectedGroup={group}
            districtSel={dist} districtCases={districtCases} districtGroups={districtGroups}
            onOpenGroup={openGroup} onPickCase={pickCase}
            onBack={() => setGroup(null)} onCloseDistrict={() => setDist(null)} />
        </aside>
      </div>

      <footer className="foot">
        Cases linked by how the crime was done — method, place &amp; time, crime type, who was targeted.
        Names are flagged as unconfirmed, never used as proof. Every case shows its real FIR number.
        Live on Zoho Catalyst.
      </footer>
    </div>
  );
}

function Kpi({ n, l, hi }: { n: React.ReactNode; l: string; hi?: boolean }) {
  return <div className={`kpi ${hi ? "hi" : ""}`}><div className="kn">{n}</div><div className="kl">{l}</div></div>;
}
