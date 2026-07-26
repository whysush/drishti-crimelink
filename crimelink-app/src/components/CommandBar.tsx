import React, { useState } from "react";
import { api } from "../api";
import { QueryResult } from "../types";

const SUGGESTIONS = ["Ravi Kumar", "heinous groups across stations", "chain snatching groups"];

// Ask in plain English. Answers are retrieval-only — every result cites a real FIR.
export default function CommandBar({ onOpenGroup }: { onOpenGroup: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(text: string) {
    setQ(text); setBusy(true);
    try { setRes(await api.query(text)); } catch { setRes(null); }
    setBusy(false);
  }

  return (
    <div className="cmd">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }}>
        <span className="cmd-ic">⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about the cases — e.g. heinous groups across stations" />
        <button disabled={busy}>{busy ? "…" : "Ask"}</button>
      </form>
      <div className="chips">
        {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
      </div>
      {res && (
        <div className="cmd-res">
          <div className="cmd-ans">{res.answer}</div>
          {res.series?.length > 0 && (
            <div className="cmd-groups">
              {res.series.map((s: any) => (
                <button key={s.series_id} className="cmd-chip" onClick={() => onOpenGroup(s.series_id)}>
                  {s.title || s.series_id} · {s.size} cases
                </button>
              ))}
            </div>
          )}
          {res.cited?.length > 0 && (
            <div className="cmd-cited"><span>cites:</span>
              {res.cited.slice(0, 6).map((c: any) => <code key={c.case_master_id}>{c.crime_no}</code>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
