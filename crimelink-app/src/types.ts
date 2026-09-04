export interface Driver { signal: string; label: string; contribution: number; }
export interface WeakName { name: string; cases: number; of: number; confidence: string; }
export interface Member {
  case_master_id: string; crime_no: string; station: string; district: string;
  lat: number | null; lon: number | null; incident_from: string | null;
  gravity: string; minor_head: string; brief_snippet: string; accused_names: string[];
}
export interface Edge {
  source: string; target: string; source_crime_no: string; target_crime_no: string;
  confidence: number; why: string[]; distance_km: number;
}
export interface Group {
  series_id: string; group_no: number; title: string;
  match_strength: string; priority: string;
  size: number; member_case_ids: string[]; members: Member[];
  cohesion: number; actionability: number; rank_score: number;
  drivers: Driver[]; top_drivers: string[]; spatial_span_km: number;
  stations: string[]; n_stations: number; districts: string[];
  date_from: string | null; date_to: string | null; recency_days: number | null;
  gravity: string; weak_name: WeakName | null; edges?: Edge[];
  forecast?: Forecast;
}
export interface Stats {
  undetected_cases: number; stations: number; districts: number; series: number;
  cross_jurisdiction_series: number; heinous_series: number;
  cases_in_series: number; pct_cases_linked: number; data_source?: string;
}
export interface UCase {
  case_master_id: string; crime_no: string; station: string; district: string;
  district_id: number; lat: number | null; lon: number | null;
  minor_head: string; gravity: string; incident_from: string | null; in_series: boolean;
}
export interface District {
  district_id: number; district: string; unsolved: number; heinous: number;
  in_series: number; n_groups: number; groups: string[]; lat: number; lon: number;
}
export interface QueryResult {
  question: string; intent: string; answer: string; series: any[]; cited: any[];
}

export interface ForecastZone { lat: number; lon: number; radius_km: number; coverage: string; }
export interface Forecast {
  available: boolean; reason?: string;
  window_from?: string; window_to?: string; centre_date?: string;
  days_after_last?: number; median_gap_days?: number; gap_iqr_days?: [number, number];
  n_events?: number; last_event?: string; regularity?: number;
  zone?: ForecastZone | null; likely_hours?: string; hours_share?: number;
  likely_day?: string; day_share?: number;
  confidence?: number; confidence_level?: string;
  status?: "upcoming" | "open" | "elapsed" | null; caveat?: string;
}
export interface PersonCase {
  case_master_id: string; crime_no: string; station: string; district: string;
  minor_head: string; gravity: string; incident_from: string | null; series_ids: string[];
}
export interface Person {
  person_key: string; name: string; variants: string[];
  n_cases: number; n_stations: number; n_districts: number;
  stations: string[]; districts: string[]; crime_types: string[];
  heinous_cases: number; cross_station: boolean; series_ids: string[];
  first_seen: string | null; last_seen: string | null;
  score: number; priority: string; cases: PersonCase[]; caveat: string;
}
export interface TriageMatch {
  series_id: string; group_no: number; title: string; priority: string;
  size: number; gravity: string; districts: string[]; n_stations: number;
  score: number; score_pct: number; mean_similarity: number; best_similarity: number;
  match_level: string; fit_ratio: number; fit_pct: number; cohesion: number;
  drivers: Driver[]; top_drivers: string[];
  closest_case: { case_master_id: string; crime_no: string; station: string;
                  similarity: number; distance_km: number | null };
}
export interface TriageNearest {
  case_master_id: string; crime_no: string; station: string; district: string;
  minor_head: string; incident_from: string | null; score: number;
  distance_km: number | null; why: string[];
}
export interface TriageResult {
  matched: boolean; verdict: string; matches: TriageMatch[];
  nearest_cases: TriageNearest[]; signals_used: string[]; caveat: string;
}
export interface AblationRow {
  signal: string; label: string; weight: number; f1_without: number; f1_drop: number;
  precision_without: number; recall_without: number; series_recovered_without: number;
}
export interface Validation {
  data_source?: string;
  data_profile: {
    undetected_cases: number; stations: number; districts: number;
    with_brief_facts: number; with_coordinates: number; with_named_accused: number;
    groups_found: number; cases_grouped: number;
  };
  signals: { signal: string; label: string; weight: number }[];
  parameters: Record<string, any>;
  forecast_backtest: {
    tested: number; window_hit_rate?: number; zone_hit_rate?: number;
    both_hit_rate?: number; median_timing_error_days?: number; method?: string; note?: string;
  };
  limitations: [string, string][];
  ground_truth_available: boolean; note?: string;
  accuracy?: {
    precision: number; recall: number; f1: number; tp: number; fp: number; fn: number;
    series_recovered: number; series_total: number; method: string;
  };
  per_series?: { series_key: string; size: number; found_together: number;
                 recovered: boolean; matched_group: string | null }[];
  ablation?: { baseline_f1: number; rows: AblationRow[]; method: string };
  identity_experiment?: {
    question: string; answer: string; conclusion: string;
    without_name: { precision: number; recall: number; f1: number };
    with_name_at_8pct: { precision: number; recall: number; f1: number };
  };
}
export interface CaseFile {
  case_master_id: string; crime_no: string; station: string; district: string;
  district_id: number; lat: number | null; lon: number | null;
  major_head: string; minor_head: string; gravity: string; brief_facts: string;
  act_sections: string[]; accused_names: string[];
  victims: { age: number | null; gender: string }[];
  incident_from: string | null; info_received: string | null;
  reporting_delay_h: number | null;
  group: { series_id: string; title: string; size: number;
           priority: string; n_stations: number } | null;
}

/* ── analytical platform: hotspots, trends, network, anomalies, socio ── */

export interface Hotspot {
  hotspot_id: string; lat: number; lon: number; radius_km: number;
  n_cases: number; undetected: number; heinous: number;
  time_band: string; time_share: number; peak_day: string; day_share: number;
  top_crime: string; crime_share: number;
  districts: string[]; stations: string[];
  date_from: string; date_to: string; recency_days: number | null;
  intensity: number; level: string; case_ids: string[];
  sample: { crime_no: string; station: string; minor_head: string; incident_from: string }[];
}
export interface Station {
  station_id: string; station: string; district: string; district_id: number;
  total: number; undetected: number; heinous: number; clearance_pct: number;
  lat: number | null; lon: number | null;
  peak_time: string | null; top_crime: string | null; last_incident: string | null;
}
export interface Spike {
  district: string; crime_type: string; recent: number; baseline_mean: number;
  z_score: number; change_pct: number | null; window_days: number;
  baseline_windows: number; baseline_events: number; level: string;
  thin_baseline: boolean; statement: string;
}
export interface Emerging {
  crime_type: string; recent: number; baseline_mean: number;
  z_score: number; change_pct: number | null; direction: string;
}
export interface RiskDistrict {
  district: string; district_id: number; risk: number; level: string;
  trend_z: number; recent_cases: number; baseline_mean: number;
  total_cases: number; undetected: number; unsolved_share: number;
  heinous_share: number; hotspots: number; linked_groups: number; open_windows: number;
  drivers: { factor: string; weight: number; value: number }[];
}
export interface GraphNode {
  id: string; type: "case" | "person" | "station" | "mo"; label: string;
  [k: string]: any;
}
export interface GraphEdge {
  source: string; target: string; type: string; weight: number; series_id?: string;
}
export interface Association {
  a: string; b: string; a_key: string; b_key: string;
  shared_mo: string[]; shared_stations: string[]; shared_districts: string[];
  a_cases: number; b_cases: number; strength: number; level: string;
  basis: string; caveat: string;
}
export interface NetworkGraphData {
  nodes: GraphNode[]; edges: GraphEdge[]; counts: Record<string, number>;
  capped_at: number; total_cases: number;
  associations: Association[]; association_count: number;
}
export interface Anomaly {
  case_master_id: string; crime_no: string; station: string; district: string;
  minor_head: string; gravity: string; undetected: boolean;
  lat: number | null; lon: number | null; incident_from: string | null;
  brief_snippet: string; score: number; level: string;
  factors: { factor: string; z: number; detail: string }[]; why: string;
}
export interface AnomalyResult {
  count: number; anomalies: Anomaly[]; method: string; caveat: string;
}
export interface SocioDistrict {
  district: string; district_id: number; population: number;
  urban_pct: number; density: number; literacy_pct: number;
  cases: number; rate_per_lakh: number; undetected: number;
  unsolved_share: number; heinous_share: number;
  top_complainant_occupations: string[];
}
export interface Correlation {
  x: string; y: string; title: string; note: string;
  r: number | null; r2: number | null; p_approx: number | null; n: number;
  strength: string | null; direction: string | null;
}
export interface Socio {
  districts: SocioDistrict[]; correlations: Correlation[];
  occupation_mix: { occupation: string; cases: number; share: number }[];
  source: string; excluded: string; caveat: string; data_warning: string;
}
export interface AlertsResult {
  count: number; window_days: number; reference_date: string | null;
  spikes: Spike[]; emerging: Emerging[]; method: string;
}

export interface Me {
  email: string | null; name: string; role: string;
  district_id: number | null; authenticated: boolean;
  source: string; auth_mode: string;
  permissions: string[]; roles: string[];
}

export interface Robustness {
  negative_control: {
    question: string; answer: string; method: string;
    real_groups: number; clean: boolean;
    runs: { seed: number; groups: number; groups_of_4_plus: number }[];
  };
  degradation: {
    question: string; method: string; note: string;
    rows: { text_blank_pct: number; groups: number; precision?: number;
            recall?: number; recovered?: number; of?: number }[];
  };
  baseline: { precision: number; recall: number; f1: number } | null;
}
