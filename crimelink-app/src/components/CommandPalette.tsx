import React, { useEffect, useMemo, useRef, useState } from "react";
import { Group, UCase } from "../types";

/**
 * ⌘K palette.
 *
 * The search bar answers questions about the data; this jumps to things. An
 * investigator who already knows the FIR number should not have to hunt for it in
 * a list, and a judge should be able to reach any part of the app from one key.
 */
export interface Action { id: string; label: string; hint?: string; run: () => void; }

export default function CommandPalette({ open, onClose, groups, cases, actions, onOpenGroup, onPickCase }: {
  open: boolean; onClose: () => void;
  groups: Group[]; cases: UCase[]; actions: Action[];
  onOpenGroup: (id: string) => void; onPickCase: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  const items = useMemo<Action[]>(() => {
    const needle = q.trim().toLowerCase();
    const acts = actions.filter((a) => !needle || a.label.toLowerCase().includes(needle));
    if (!needle) return acts;

    const gs: Action[] = groups
      .filter((g) => g.series_id.toLowerCase().includes(needle) ||
                     g.title.toLowerCase().includes(needle) ||
                     g.districts.join(" ").toLowerCase().includes(needle))
      .slice(0, 6)
      .map((g) => ({
        id: g.series_id, label: `${g.series_id} — ${g.title}`,
        hint: `${g.size} cases · ${g.n_stations} stations`,
        run: () => onOpenGroup(g.series_id),
      }));

    const cs: Action[] = cases
      .filter((c) => c.crime_no.includes(needle) || c.station.toLowerCase().includes(needle))
      .slice(0, 6)
      .map((c) => ({
        id: c.case_master_id, label: `FIR ${c.crime_no}`,
        hint: `${c.minor_head} · ${c.station}${c.in_series ? " · in a group" : ""}`,
        run: () => onPickCase(c.case_master_id),
      }));

    return [...acts, ...gs, ...cs];
  }, [q, groups, cases, actions, onOpenGroup, onPickCase]);

  useEffect(() => { setSel(0); }, [q]);
  if (!open) return null;

  function key(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = items[sel]; if (it) { it.run(); onClose(); } }
    else if (e.key === "Escape") onClose();
  }

  return (
    <>
      <div className="pal-scrim" onClick={onClose} />
      <div className="pal" role="dialog" aria-label="Command palette">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key}
          placeholder="Jump to a group, an FIR number, a station — or an action…" />
        <div className="pal-list">
          {items.length === 0 && <div className="pal-empty">Nothing matches “{q}”.</div>}
          {items.slice(0, 12).map((it, k) => (
            <button key={it.id + k} className={`pal-i ${k === sel ? "on" : ""}`}
              onMouseEnter={() => setSel(k)} onClick={() => { it.run(); onClose(); }}>
              <span className="pal-l">{it.label}</span>
              {it.hint && <span className="pal-h">{it.hint}</span>}
            </button>
          ))}
        </div>
        <div className="pal-foot">↑↓ move · ↵ open · esc close</div>
      </div>
    </>
  );
}
