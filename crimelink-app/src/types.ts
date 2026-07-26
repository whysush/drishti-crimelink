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
}
export interface Stats {
  undetected_cases: number; stations: number; districts: number; series: number;
  cross_jurisdiction_series: number; heinous_series: number;
  cases_in_series: number; pct_cases_linked: number;
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
