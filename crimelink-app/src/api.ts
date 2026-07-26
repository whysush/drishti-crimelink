import { Group, Stats, UCase, District, QueryResult } from "./types";

// Prod: REACT_APP_API_BASE = the crimelink_function gateway. Dev: engine on :9055.
const BASE = (process.env.REACT_APP_API_BASE || "http://localhost:9055").replace(/\/$/, "");

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

export const api = {
  base: BASE,
  stats: () => get<Stats>("/stats"),
  districts: () => get<{ count: number; districts: District[] }>("/districts"),
  groups: (limit?: number) =>
    get<{ count: number; series: Group[] }>(`/series${limit ? `?limit=${limit}` : ""}`),
  groupById: (id: string) => get<Group>(`/series/${id}`),
  caseGroup: (caseId: string) => get<Group & { linked: boolean }>(`/case/${caseId}/series`),
  undetected: () => get<{ count: number; cases: UCase[] }>("/cases/undetected"),
  query: (q: string) => get<QueryResult>(`/query?q=${encodeURIComponent(q)}`),
};
