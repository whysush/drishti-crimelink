import {
  Group, Stats, UCase, District, QueryResult, Person, TriageResult, Validation, CaseFile,
  Hotspot, Station, AlertsResult, RiskDistrict, NetworkGraphData, AnomalyResult, Socio, Me, Robustness,
} from "./types";

// Prod: REACT_APP_API_BASE = the crimelink_function gateway. Dev: engine on :9055.
const BASE = (process.env.REACT_APP_API_BASE || "http://localhost:9055").replace(/\/$/, "");

/**
 * View-as role, for demo mode only.
 *
 * The gateway ignores this header entirely once Catalyst Authentication is
 * enforced — a real signed-in identity always wins. It exists so the access rules
 * can be demonstrated without provisioning three accounts.
 */
let viewAsRole: string | null = null;
let viewAsDistrict: string | null = null;
export function setViewAs(role: string | null, district?: string | null) {
  viewAsRole = role;
  if (district !== undefined) viewAsDistrict = district;
}

function headers(extra?: Record<string, string>) {
  const h: Record<string, string> = { ...(extra || {}) };
  if (viewAsRole) h["X-Drishti-Role"] = viewAsRole;
  if (viewAsDistrict) h["X-Drishti-District"] = viewAsDistrict;
  return h;
}

export class ApiError extends Error {
  status: number;
  needsPermission?: string;
  constructor(status: number, message: string, needsPermission?: string) {
    super(message);
    this.status = status;
    this.needsPermission = needsPermission;
  }
}

/**
 * Retry into a cold backend.
 *
 * The engine idles and takes ~12s to load and cluster on its first request, and a
 * wedged function instance can time out. Neither is a real failure — both clear on
 * their own — so a transient status is retried with backoff instead of being shown
 * to an investigator as a broken app.
 */
const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);
const RETRIES = 3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cap how many requests are in flight at once.
 *
 * The dashboard wants fourteen endpoints to draw itself, and firing them together
 * exceeded the function's concurrency limit — the burst came back as 429s and
 * 502s, and under retry pressure the gateway saturated until even /health timed
 * out. Two at a time costs a little more wall-clock and keeps the API standing.
 */
const MAX_INFLIGHT = 2;
let active = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_INFLIGHT) { active++; return Promise.resolve(); }
  return new Promise<void>((resolve) => waiting.push(() => { active++; resolve(); }));
}

function release() {
  active--;
  waiting.shift()?.();
}

async function fetchRetrying(url: string, init: RequestInit): Promise<Response> {
  await acquire();
  try {
    return await attempt(url, init);
  } finally {
    release();
  }
}

async function attempt(url: string, init: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const r = await fetch(url, init);
      if (!RETRY_STATUS.has(r.status)) return r;
      last = r;
    } catch (e) {
      if (i === RETRIES) throw e;
    }
    // back off with jitter: a synchronised retry storm is what caused the pile-up
    if (i < RETRIES) await wait(900 * (i + 1) + Math.random() * 600);
  }
  return last as Response;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetchRetrying(`${BASE}${path}`, { headers: headers() });
  if (!r.ok) {
    let detail = `${r.status} ${path}`;
    let perm: string | undefined;
    try {
      const j = await r.json();
      detail = j.detail || j.error || detail;
      perm = j.needs_permission;
    } catch { /* non-JSON error body */ }
    throw new ApiError(r.status, detail, perm);
  }
  return r.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchRetrying(`${BASE}${path}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = `${r.status} ${path}`;
    let perm: string | undefined;
    try {
      const j = await r.json();
      detail = j.detail || j.error || detail;
      perm = j.needs_permission;
    } catch { /* non-JSON error body */ }
    throw new ApiError(r.status, detail, perm);
  }
  return r.json();
}

export interface NewFir {
  brief_facts: string;
  minor_head_id: string;
  lat: number | null;
  lon: number | null;
  incident_from: string;
  act_sections: string[];
  victims: { age: number | null; gender: string }[];
  accused_names: string[];
}

export const api = {
  base: BASE,
  stats: () => get<Stats>("/stats"),
  districts: () => get<{ count: number; districts: District[] }>("/districts"),
  groups: (limit?: number) =>
    get<{ count: number; series: Group[] }>(`/series${limit ? `?limit=${limit}` : ""}`),
  groupById: (id: string) => get<Group>(`/series/${id}`),
  caseGroup: (caseId: string) => get<Group & { linked: boolean }>(`/case/${caseId}/series`),
  caseFile: (caseId: string) => get<CaseFile>(`/case/${caseId}`),
  undetected: () => get<{ count: number; cases: UCase[] }>("/cases/undetected"),
  query: (q: string) => get<QueryResult>(`/query?q=${encodeURIComponent(q)}`),
  persons: (limit?: number) =>
    get<{ count: number; cross_station: number; persons: Person[] }>(
      `/persons${limit ? `?limit=${limit}` : ""}`),
  validation: () => get<Validation>("/validation"),
  robustness: () => get<Robustness>("/robustness"),
  match: (fir: NewFir) => post<TriageResult>("/match", fir),

  // analytical platform
  hotspots: () => get<{ count: number; hotspots: Hotspot[]; method: string;
                        scanned_cases: number }>("/hotspots"),
  stations: (districtId?: number) =>
    get<{ count: number; stations: Station[] }>(
      `/stations${districtId != null ? `?district_id=${districtId}` : ""}`),
  alerts: () => get<AlertsResult>("/alerts"),
  risk: () => get<{ count: number; districts: RiskDistrict[]; method: string }>("/risk"),
  network: () => get<NetworkGraphData>("/network?max_cases=150"),
  anomalies: () => get<AnomalyResult>("/anomalies"),
  socio: () => get<Socio>("/socio"),

  // identity + access
  me: () => get<Me>("/me"),
  /** Server-rendered PDF via Catalyst SmartBrowz. */
  briefUrl: (seriesId: string) => `${BASE}/brief/${seriesId}`,
};
