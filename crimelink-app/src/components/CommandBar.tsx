import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { QueryResult } from "../types";
import { TFn } from "../i18n";

const SUGGESTIONS = ["Ravi Kumar", "heinous groups across stations", "chain snatching groups"];

/**
 * Natural-language search.
 *
 * Answers are retrieval-only — every result cites a real FIR, nothing is generated.
 * The result panel floats over the map instead of pushing the layout down, so
 * asking a question never costs you the view you were looking at.
 */
export default function CommandBar({ onOpenGroup, t }: {
  onOpenGroup: (id: string) => void; t: TFn;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function away(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  async function ask(text: string) {
    setQ(text); setBusy(true); setOpen(true);
    try { setRes(await api.query(text)); } catch { setRes(null); }
    setBusy(false);
  }

  return (
    <div className="cmd" ref={box}>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }}>
        <span className="cmd-ic" aria-hidden>⌕</span>
        <input value={q} onFocus={() => setOpen(true)}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("ask_ph")} />
        <button disabled={busy}>{busy ? "…" : t("ask")}</button>
      </form>

      {open && (
        <div className="cmd-pop">
          {res ? (
            <>
              <div className="cmd-ans">{res.answer}</div>
              {res.series?.length > 0 && (
                <div className="cmd-groups">
                  {res.series.map((s: any) => (
                    <button key={s.series_id} className="cmd-chip"
                      onClick={() => { onOpenGroup(s.series_id); setOpen(false); }}>
                      {s.series_id} · {s.size} cases
                    </button>
                  ))}
                </div>
              )}
              {res.cited?.length > 0 && (
                <div className="cmd-cited">
                  <span className="lbl">{t("cites")}</span>
                  {res.cited.slice(0, 8).map((c: any) => <code key={c.case_master_id}>{c.crime_no}</code>)}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="lbl" style={{ marginBottom: 9 }}>Try</div>
              <div className="chips">
                {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
              </div>
              <div className="cmd-cited" style={{ marginTop: 12 }}>
                Retrieval only — every answer cites real FIR numbers and nothing is generated.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
