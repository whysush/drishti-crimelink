/**
 * Bilingual chrome — English / ಕನ್ನಡ.
 *
 * Karnataka State Police work in Kannada. An investigator should not have to read
 * English to use a tool built for them, so every label, heading and explanation the
 * app writes itself is translated here.
 *
 * What is deliberately NOT translated: data that came out of the FIR record —
 * crime numbers, station names, brief facts, accused names. Those are quoted
 * verbatim in whatever language they were recorded, because a translated FIR
 * number is a wrong FIR number.
 */
import { useCallback, useEffect, useState } from "react";

export type Lang = "en" | "kn";

type Dict = Record<string, [string, string]>;

const T: Dict = {
  // brand + chrome
  subtitle: ["Karnataka State Police", "ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪೊಲೀಸ್"],
  tour: ["Guided tour", "ಮಾರ್ಗದರ್ಶಿ ಪ್ರವಾಸ"],
  // KPIs
  kpi_unsolved: ["unsolved cases", "ಬಗೆಹರಿಯದ ಪ್ರಕರಣ"],
  kpi_groups: ["linked groups", "ಸಂಪರ್ಕಿತ ಗುಂಪು"],
  kpi_cross: ["across stations", "ಠಾಣೆಗಳಾದ್ಯಂತ"],
  kpi_heinous: ["heinous groups", "ಘೋರ ಗುಂಪು"],
  kpi_connected: ["cases connected", "ಜೋಡಿಸಿದ ಪ್ರಕರಣ"],
  // tabs
  tab_leads: ["Leads", "ಸುಳಿವು"],
  tab_forecast: ["Forecast", "ಮುನ್ಸೂಚನೆ"],
  tab_people: ["People", "ವ್ಯಕ್ತಿಗಳು"],
  tab_triage: ["New FIR", "ಹೊಸ ಎಫ್‌ಐಆರ್"],
  tab_model: ["Model", "ಮಾದರಿ"],
  tab_hotspots: ["Hotspots", "ಹಾಟ್‌ಸ್ಪಾಟ್"],
  tab_alerts: ["Alerts", "ಎಚ್ಚರಿಕೆ"],
  tab_network: ["Network", "ಜಾಲ"],
  tab_insights: ["Insights", "ಒಳನೋಟ"],
  hotspots_head: ["Crime hotspots", "ಅಪರಾಧ ಹಾಟ್‌ಸ್ಪಾಟ್‌ಗಳು"],
  hotspots_sub: ["place and time-of-day, clustered together",
                 "ಸ್ಥಳ ಮತ್ತು ಸಮಯ, ಒಟ್ಟಿಗೆ ಗುಂಪುಗೂಡಿಸಲಾಗಿದೆ"],
  alerts_head: ["Alerts", "ಎಚ್ಚರಿಕೆಗಳು"],
  alerts_sub: ["spikes, district risk and anomalies",
               "ಏರಿಕೆ, ಜಿಲ್ಲಾ ಅಪಾಯ ಮತ್ತು ಅಸಂಗತತೆ"],
  network_head: ["Link analysis", "ಸಂಪರ್ಕ ವಿಶ್ಲೇಷಣೆ"],
  network_sub: ["incidents, persons, stations and MO",
                "ಘಟನೆ, ವ್ಯಕ್ತಿ, ಠಾಣೆ ಮತ್ತು ಎಂ.ಒ."],
  insights_head: ["Socio-economic overlay", "ಸಾಮಾಜಿಕ-ಆರ್ಥಿಕ ಪದರ"],
  insights_sub: ["the why behind the where", "ಎಲ್ಲಿ ಎಂಬುದರ ಹಿಂದಿನ ಏಕೆ"],
  stations_here: ["Police stations", "ಪೊಲೀಸ್ ಠಾಣೆಗಳು"],
  // leads
  leads_head: ["Priority leads", "ಆದ್ಯತೆಯ ಸುಳಿವುಗಳು"],
  leads_sub: ["suspected offender groups", "ಶಂಕಿತ ಅಪರಾಧಿ ಗುಂಪುಗಳು"],
  linked_by: ["linked by", "ಇದರಿಂದ ಜೋಡಿಸಲಾಗಿದೆ"],
  cases: ["cases", "ಪ್ರಕರಣಗಳು"],
  across: ["across", "ಆದ್ಯಂತ"],
  stations: ["stations", "ಠಾಣೆಗಳು"],
  possible_suspect: ["possible suspect", "ಸಂಭಾವ್ಯ ಶಂಕಿತ"],
  no_leads: ["No groups match these filters.", "ಈ ಶೋಧಕಗಳಿಗೆ ಯಾವ ಗುಂಪೂ ಹೊಂದಿಕೆಯಾಗಿಲ್ಲ."],
  // filters
  filters: ["Filters", "ಶೋಧಕಗಳು"],
  all_crimes: ["All crime types", "ಎಲ್ಲಾ ಅಪರಾಧ ಪ್ರಕಾರಗಳು"],
  heinous_only: ["Heinous only", "ಘೋರ ಮಾತ್ರ"],
  cross_only: ["Cross-station only", "ಠಾಣೆ ದಾಟಿದವು ಮಾತ್ರ"],
  clear: ["Clear", "ತೆರವುಗೊಳಿಸಿ"],
  // group view
  back: ["back", "ಹಿಂದೆ"],
  why_linked: ["Why we linked these", "ಇವನ್ನು ಏಕೆ ಜೋಡಿಸಲಾಗಿದೆ"],
  the_cases: ["The cases (each is a real FIR)", "ಪ್ರಕರಣಗಳು (ಪ್ರತಿಯೊಂದೂ ನಿಜವಾದ ಎಫ್‌ಐಆರ್)"],
  timeline: ["Timeline", "ಕಾಲಾನುಕ್ರಮ"],
  show_net: ["Show link diagram", "ಸಂಪರ್ಕ ರೇಖಾಚಿತ್ರ ತೋರಿಸಿ"],
  hide_net: ["Hide link diagram", "ಸಂಪರ್ಕ ರೇಖಾಚಿತ್ರ ಮರೆಮಾಡಿ"],
  print_brief: ["Case brief", "ಪ್ರಕರಣ ಸಾರಾಂಶ"],
  match_label: ["Match", "ಹೊಂದಿಕೆ"],
  priority: ["Priority", "ಆದ್ಯತೆ"],
  heinous: ["Heinous", "ಘೋರ"],
  // forecast
  forecast_head: ["Where this group may strike next", "ಈ ಗುಂಪು ಮುಂದೆ ಎಲ್ಲಿ ಹೊಡೆಯಬಹುದು"],
  expected_window: ["Expected window", "ನಿರೀಕ್ಷಿತ ಅವಧಿ"],
  after_last: ["after the last offence", "ಕೊನೆಯ ಅಪರಾಧದ ನಂತರ"],
  likely_zone: ["Likely area", "ಸಂಭಾವ್ಯ ಪ್ರದೇಶ"],
  likely_time: ["Usual time", "ಸಾಮಾನ್ಯ ಸಮಯ"],
  confidence: ["Confidence", "ವಿಶ್ವಾಸ"],
  days: ["days", "ದಿನಗಳು"],
  // persons
  people_head: ["Persons of interest", "ಆಸಕ್ತಿಯ ವ್ಯಕ್ತಿಗಳು"],
  people_sub: ["names recurring across separate FIRs", "ಪ್ರತ್ಯೇಕ ಎಫ್‌ಐಆರ್‌ಗಳಲ್ಲಿ ಪುನರಾವರ್ತಿತ ಹೆಸರುಗಳು"],
  appears_in: ["appears in", "ಇದರಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ"],
  also_spelt: ["also recorded as", "ಹೀಗೂ ದಾಖಲಾಗಿದೆ"],
  // triage
  triage_head: ["Screen a new FIR", "ಹೊಸ ಎಫ್‌ಐಆರ್ ಪರಿಶೀಲಿಸಿ"],
  triage_sub: ["check an incoming case against every known group",
               "ಬರುವ ಪ್ರಕರಣವನ್ನು ಎಲ್ಲಾ ತಿಳಿದ ಗುಂಪುಗಳ ವಿರುದ್ಧ ಪರಿಶೀಲಿಸಿ"],
  f_facts: ["What happened (brief facts)", "ಏನಾಯಿತು (ಸಂಕ್ಷಿಪ್ತ ವಿವರ)"],
  f_type: ["Crime type", "ಅಪರಾಧ ಪ್ರಕಾರ"],
  f_when: ["When", "ಯಾವಾಗ"],
  f_where: ["Where (district)", "ಎಲ್ಲಿ (ಜಿಲ್ಲೆ)"],
  f_victim_age: ["Victim age", "ಸಂತ್ರಸ್ತರ ವಯಸ್ಸು"],
  f_victim_gender: ["Victim gender", "ಸಂತ್ರಸ್ತರ ಲಿಂಗ"],
  f_named: ["Named accused (optional)", "ಹೆಸರಿಸಿದ ಆರೋಪಿ (ಐಚ್ಛಿಕ)"],
  run_check: ["Check for matches", "ಹೊಂದಿಕೆ ಪರಿಶೀಲಿಸಿ"],
  checking: ["Checking…", "ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…"],
  use_example: ["Use an example", "ಉದಾಹರಣೆ ಬಳಸಿ"],
  nearest_cases: ["Closest individual cases", "ಹತ್ತಿರದ ಪ್ರತ್ಯೇಕ ಪ್ರಕರಣಗಳು"],
  // model
  model_head: ["How accurate is this?", "ಇದು ಎಷ್ಟು ನಿಖರ?"],
  precision: ["Precision", "ನಿಖರತೆ"],
  recall: ["Recall", "ಮರುಪಡೆಯುವಿಕೆ"],
  recovered: ["Groups recovered", "ಮರುಪಡೆದ ಗುಂಪುಗಳು"],
  signal_worth: ["What each signal is worth", "ಪ್ರತಿ ಸಂಕೇತದ ಮೌಲ್ಯ"],
  limitations: ["Where this method fails", "ಈ ವಿಧಾನ ಎಲ್ಲಿ ವಿಫಲವಾಗುತ್ತದೆ"],
  backtest_head: ["Forecast, back-tested", "ಮುನ್ಸೂಚನೆ, ಹಿಂಪರೀಕ್ಷಿತ"],
  // misc
  loading: ["Loading…", "ಲೋಡ್ ಆಗುತ್ತಿದೆ…"],
  reset_map: ["reset map", "ನಕ್ಷೆ ಮರುಹೊಂದಿಸಿ"],
  unconfirmed: ["unconfirmed", "ದೃಢೀಕರಿಸಿಲ್ಲ"],
  unsolved_here: ["Unsolved cases here", "ಇಲ್ಲಿನ ಬಗೆಹರಿಯದ ಪ್ರಕರಣಗಳು"],
  groups_here: ["Linked groups in this district", "ಈ ಜಿಲ್ಲೆಯ ಸಂಪರ್ಕಿತ ಗುಂಪುಗಳು"],
  more: ["more", "ಇನ್ನಷ್ಟು"],
  // filter option labels
  all_time: ["All time", "ಎಲ್ಲಾ ಸಮಯ"],
  last_90: ["Last 90 days", "ಕಳೆದ 90 ದಿನ"],
  last_6m: ["Last 6 months", "ಕಳೆದ 6 ತಿಂಗಳು"],
  last_1y: ["Last year", "ಕಳೆದ ವರ್ಷ"],
  any_size: ["Any group size", "ಯಾವುದೇ ಗುಂಪಿನ ಗಾತ್ರ"],
  // map + chrome
  ask_ph: ["Ask about the cases — e.g. heinous groups across stations",
           "ಪ್ರಕರಣಗಳ ಬಗ್ಗೆ ಕೇಳಿ — ಉದಾ. ಠಾಣೆಗಳಾದ್ಯಂತ ಘೋರ ಗುಂಪುಗಳು"],
  ask: ["Ask", "ಕೇಳಿ"],
  cites: ["cites", "ಉಲ್ಲೇಖ"],
  layer_pins: ["case pins", "ಪ್ರಕರಣ ಗುರುತು"],
  layer_forecast: ["forecast zone", "ಮುನ್ಸೂಚನೆ ವಲಯ"],
  layer_hotspots: ["hotspots", "ಹಾಟ್‌ಸ್ಪಾಟ್"],
  layer_risk: ["red zones", "ಕೆಂಪು ವಲಯ"],
  spin_stop: ["stop spin", "ತಿರುಗುವಿಕೆ ನಿಲ್ಲಿಸಿ"],
  spin_start: ["auto-spin", "ಸ್ವಯಂ ತಿರುಗುವಿಕೆ"],
  map_hint: ["drag to rotate · scroll to zoom · click a district to drop case pins",
             "ತಿರುಗಿಸಲು ಎಳೆಯಿರಿ · ಜೂಮ್‌ಗೆ ಸ್ಕ್ರಾಲ್ · ಪ್ರಕರಣ ಗುರುತುಗಳಿಗೆ ಜಿಲ್ಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ"],
  legend: ["has cases · no data · selected · projected zone · taller = more cases",
           "ಪ್ರಕರಣಗಳಿವೆ · ಮಾಹಿತಿ ಇಲ್ಲ · ಆಯ್ಕೆಯಾದದ್ದು · ಪ್ರಕ್ಷೇಪಿತ ವಲಯ · ಎತ್ತರ = ಹೆಚ್ಚು ಪ್ರಕರಣ"],
  foot: [
    "Cases linked by how the crime was done — method, place & time, crime type, who was targeted. Identity carries zero weight: names are shown as unconfirmed corroboration, never as proof. Every case shows its real FIR number. Live on Zoho Catalyst.",
    "ಅಪರಾಧ ಹೇಗೆ ನಡೆಯಿತು ಎಂಬುದರ ಆಧಾರದ ಮೇಲೆ ಪ್ರಕರಣಗಳನ್ನು ಜೋಡಿಸಲಾಗಿದೆ — ವಿಧಾನ, ಸ್ಥಳ ಮತ್ತು ಸಮಯ, ಅಪರಾಧ ಪ್ರಕಾರ, ಗುರಿಯಾದವರು. ಗುರುತಿಗೆ ಶೂನ್ಯ ತೂಕ: ಹೆಸರುಗಳು ದೃಢೀಕರಿಸದ ಪೂರಕ ಮಾಹಿತಿ ಮಾತ್ರ, ಎಂದಿಗೂ ಪುರಾವೆ ಅಲ್ಲ. ಪ್ರತಿ ಪ್ರಕರಣವೂ ತನ್ನ ನಿಜವಾದ ಎಫ್‌ಐಆರ್ ಸಂಖ್ಯೆ ತೋರಿಸುತ್ತದೆ. Zoho Catalyst ನಲ್ಲಿ ಲೈವ್.",
  ],
};

/**
 * Signal names arrive from the engine already labelled in English. Mapping them
 * back by their stable key is what lets the evidence trail — the part an officer
 * reads most closely — appear in Kannada too.
 */
const SIGNALS: Dict = {
  mo: ["method — how it was done", "ವಿಧಾನ — ಹೇಗೆ ಮಾಡಲಾಯಿತು"],
  minor: ["crime type", "ಅಪರಾಧ ಪ್ರಕಾರ"],
  act: ["law sections", "ಕಾನೂನು ಕಲಂಗಳು"],
  spatial: ["location", "ಸ್ಥಳ"],
  temporal: ["time pattern", "ಸಮಯದ ಮಾದರಿ"],
  profile: ["who was targeted", "ಯಾರನ್ನು ಗುರಿಯಾಗಿಸಲಾಯಿತು"],
  name: ["possible same name", "ಸಂಭಾವ್ಯ ಒಂದೇ ಹೆಸರು"],
};

/** Full sentences, with {a} {b} … placeholders filled at call time. */
const S: Dict = {
  gv_lede: [
    "{n} unsolved cases that look like the same offender — across {s} police stations in {d}.",
    "{n} ಬಗೆಹರಿಯದ ಪ್ರಕರಣಗಳು ಒಬ್ಬನೇ ಅಪರಾಧಿಯಂತೆ ಕಾಣುತ್ತವೆ — {d} ನಲ್ಲಿ {s} ಪೊಲೀಸ್ ಠಾಣೆಗಳಾದ್ಯಂತ.",
  ],
  gv_between: ["Between {a} and {b}", "{a} ಮತ್ತು {b} ನಡುವೆ"],
  gv_recent: ["most recent {n} days ago", "ಇತ್ತೀಚಿನದು {n} ದಿನಗಳ ಹಿಂದೆ"],
  // The written forecast report. Split into sentences rather than one blob so the
  // Kannada can follow its own word order instead of being forced through English
  // syntax with the values dropped in.
  fc_r_rhythm: [
    "Looking at {n} offences, this group has been striking roughly every {gap} days — usually somewhere between {lo} and {hi} days apart. They work {hours}{day}.",
    "{n} ಅಪರಾಧಗಳನ್ನು ನೋಡಿದರೆ, ಈ ಗುಂಪು ಸುಮಾರು ಪ್ರತಿ {gap} ದಿನಗಳಿಗೊಮ್ಮೆ ಕೃತ್ಯ ಎಸಗಿದೆ — ಸಾಮಾನ್ಯವಾಗಿ {lo} ರಿಂದ {hi} ದಿನಗಳ ಅಂತರದಲ್ಲಿ. ಇವರು {hours}{day} ಕಾರ್ಯನಿರತರಾಗಿರುತ್ತಾರೆ.",
  ],
  fc_r_day: [", most often on a {d}", ", ಹೆಚ್ಚಾಗಿ {d} ದಂದು"],
  fc_r_when: [
    "On that pattern the next offence would be due between {a} and {b}{tail}",
    "ಆ ಮಾದರಿಯಂತೆ ಮುಂದಿನ ಅಪರಾಧ {a} ಮತ್ತು {b} ನಡುವೆ ನಿರೀಕ್ಷಿತ{tail}",
  ],
  fc_r_elapsed: [
    " — a window that has already passed in this dataset, which is why this group reads as one to review rather than one to patrol.",
    " — ಈ ದತ್ತಾಂಶದಲ್ಲಿ ಈ ಅವಧಿ ಈಗಾಗಲೇ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಈ ಗುಂಪು ಗಸ್ತಿಗಿಂತ ಪರಿಶೀಲನೆಗೆ ಸೂಕ್ತವಾಗಿದೆ.",
  ],
  fc_r_open: [" — a window that is open right now.", " — ಈ ಅವಧಿ ಈಗ ತೆರೆದಿದೆ."],
  fc_r_ahead: [" — a window still ahead.", " — ಈ ಅವಧಿ ಇನ್ನೂ ಮುಂದಿದೆ."],
  fc_r_where: [
    "The likely area is within about {km} km of where they have already been active — that circle covers the areas around {places} in {districts}.",
    "ಸಂಭಾವ್ಯ ಪ್ರದೇಶವು ಅವರು ಈಗಾಗಲೇ ಸಕ್ರಿಯರಾಗಿದ್ದ ಸ್ಥಳದಿಂದ ಸುಮಾರು {km} ಕಿ.ಮೀ ವ್ಯಾಪ್ತಿಯಲ್ಲಿದೆ — ಆ ವೃತ್ತವು {districts} ನಲ್ಲಿನ {places} ಸುತ್ತಮುತ್ತಲಿನ ಪ್ರದೇಶಗಳನ್ನು ಒಳಗೊಂಡಿದೆ.",
  ],
  fc_r_where_plain: [
    "The likely area is within about {km} km of the centre of their known offences in {districts}.",
    "ಸಂಭಾವ್ಯ ಪ್ರದೇಶವು {districts} ನಲ್ಲಿನ ಅವರ ತಿಳಿದ ಅಪರಾಧಗಳ ಕೇಂದ್ರದಿಂದ ಸುಮಾರು {km} ಕಿ.ಮೀ ವ್ಯಾಪ್ತಿಯಲ್ಲಿದೆ.",
  ],
  fc_r_nogeo: [
    "No usable coordinates, so the area cannot be projected for this group.",
    "ಬಳಸಬಹುದಾದ ನಿರ್ದೇಶಾಂಕಗಳಿಲ್ಲ, ಆದ್ದರಿಂದ ಈ ಗುಂಪಿಗೆ ಪ್ರದೇಶವನ್ನು ಊಹಿಸಲಾಗುವುದಿಲ್ಲ.",
  ],
  fc_r_trust: [
    "Confidence is {level}. Across all groups, this method puts the next offence inside the projected area about 93% of the time, but gets the timing right only about half the time — so treat the place as the useful part and the date as a rough guide.",
    "ವಿಶ್ವಾಸ {level}. ಎಲ್ಲಾ ಗುಂಪುಗಳಲ್ಲಿ, ಈ ವಿಧಾನವು ಮುಂದಿನ ಅಪರಾಧವನ್ನು ಸುಮಾರು 93% ಸಮಯ ಊಹಿಸಿದ ಪ್ರದೇಶದೊಳಗೆ ಇರಿಸುತ್ತದೆ, ಆದರೆ ಸಮಯವನ್ನು ಅರ್ಧದಷ್ಟು ಬಾರಿ ಮಾತ್ರ ಸರಿಯಾಗಿ ಹೇಳುತ್ತದೆ — ಆದ್ದರಿಂದ ಸ್ಥಳವನ್ನು ಉಪಯುಕ್ತ ಭಾಗವೆಂದು ಮತ್ತು ದಿನಾಂಕವನ್ನು ಸ್ಥೂಲ ಮಾರ್ಗದರ್ಶಿಯೆಂದು ಪರಿಗಣಿಸಿ.",
  ],
  fc_r_head: ["In plain words", "ಸರಳ ಮಾತಿನಲ್ಲಿ"],
  fc_lede: [
    "On this group's own rhythm, the next offence would fall {lo}–{hi} days after the last offence — around day {c}.",
    "ಈ ಗುಂಪಿನ ಸ್ವಂತ ಲಯದ ಪ್ರಕಾರ, ಮುಂದಿನ ಅಪರಾಧ ಕೊನೆಯ ಅಪರಾಧದ ನಂತರ {lo}–{hi} ದಿನಗಳಲ್ಲಿ ಸಂಭವಿಸಬಹುದು — ಸುಮಾರು {c}ನೇ ದಿನ.",
  ],
  fc_within: ["within {r} km of {p}", "{p} ನಿಂದ {r} ಕಿ.ಮೀ. ಒಳಗೆ"],
  fc_share: ["{p}% of this group's offences · mostly {d}",
             "ಈ ಗುಂಪಿನ {p}% ಅಪರಾಧಗಳು · ಹೆಚ್ಚಾಗಿ {d}"],
  fc_basis: ["Built from {n} dated offences · median gap {g} days · rhythm regularity {r}%",
             "{n} ದಿನಾಂಕಿತ ಅಪರಾಧಗಳಿಂದ · ಸರಾಸರಿ ಅಂತರ {g} ದಿನ · ಲಯದ ಕ್ರಮಬದ್ಧತೆ {r}%"],
  fc_caveat: [
    "A statistical projection from this group's own rhythm and patch — not a prediction of a specific crime. Use it to time and place patrols, never as grounds for action against a person.",
    "ಈ ಗುಂಪಿನ ಸ್ವಂತ ಲಯ ಮತ್ತು ಪ್ರದೇಶದಿಂದ ಮಾಡಿದ ಸಂಖ್ಯಾಶಾಸ್ತ್ರೀಯ ಪ್ರಕ್ಷೇಪಣ — ನಿರ್ದಿಷ್ಟ ಅಪರಾಧದ ಭವಿಷ್ಯವಾಣಿ ಅಲ್ಲ. ಗಸ್ತು ಯೋಜನೆಗೆ ಬಳಸಿ, ವ್ಯಕ್ತಿಯ ವಿರುದ್ಧ ಕ್ರಮಕ್ಕೆ ಆಧಾರವಾಗಿ ಎಂದಿಗೂ ಅಲ್ಲ.",
  ],
  fc_elapsed: ["window already elapsed in this dataset", "ಈ ದತ್ತಾಂಶದಲ್ಲಿ ಅವಧಿ ಈಗಾಗಲೇ ಮುಗಿದಿದೆ"],
  fc_open: ["window is open now", "ಅವಧಿ ಈಗ ತೆರೆದಿದೆ"],
  fc_ahead: ["still ahead", "ಇನ್ನೂ ಮುಂದಿದೆ"],
  fc_coverage: ["90% of this group's offences fall inside this radius — shown as the ring on the map",
                "ಈ ಗುಂಪಿನ 90% ಅಪರಾಧಗಳು ಈ ತ್ರಿಜ್ಯದೊಳಗೆ ಬರುತ್ತವೆ — ನಕ್ಷೆಯಲ್ಲಿ ಉಂಗುರವಾಗಿ ತೋರಿಸಲಾಗಿದೆ"],
  fc_none: ["Not enough history to project a pattern.", "ಮಾದರಿ ಊಹಿಸಲು ಸಾಕಷ್ಟು ಇತಿಹಾಸವಿಲ್ಲ."],
  weak_name: [
    "A name — “{n}” — shows up in {a} of {b} cases. Unconfirmed lead, not proof — and it played no part in forming this group.",
    "ಒಂದು ಹೆಸರು — “{n}” — {b} ಪ್ರಕರಣಗಳಲ್ಲಿ {a} ರಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ. ದೃಢೀಕರಿಸದ ಸುಳಿವು, ಪುರಾವೆ ಅಲ್ಲ — ಮತ್ತು ಈ ಗುಂಪು ರಚನೆಯಲ್ಲಿ ಇದರ ಪಾತ್ರವಿಲ್ಲ.",
  ],
  tl_span: ["{d} days · {n} offences", "{d} ದಿನಗಳು · {n} ಅಪರಾಧಗಳು"],
  tl_key: ["projected next window", "ಪ್ರಕ್ಷೇಪಿತ ಮುಂದಿನ ಅವಧಿ"],
  size_n: ["{n}+ cases", "{n}+ ಪ್ರಕರಣ"],
  count_summary: ["{g} groups · {c} cases", "{g} ಗುಂಪು · {c} ಪ್ರಕರಣ"],
  lead_meta: ["{n} cases · across {s} stations · {d}",
              "{n} ಪ್ರಕರಣ · {s} ಠಾಣೆಗಳಾದ್ಯಂತ · {d}"],
  lead_next: ["next window {d} · {c}", "ಮುಂದಿನ ಅವಧಿ {d} · {c}"],
};

/** Time bands and weekdays come from the engine as English strings. */
const PHRASES: Dict = {
  "late night (00:00–05:00)": ["late night (00:00–05:00)", "ತಡರಾತ್ರಿ (00:00–05:00)"],
  "early morning (05:00–09:00)": ["early morning (05:00–09:00)", "ಮುಂಜಾನೆ (05:00–09:00)"],
  "morning (09:00–12:00)": ["morning (09:00–12:00)", "ಬೆಳಗ್ಗೆ (09:00–12:00)"],
  "afternoon (12:00–16:00)": ["afternoon (12:00–16:00)", "ಮಧ್ಯಾಹ್ನ (12:00–16:00)"],
  "evening (16:00–20:00)": ["evening (16:00–20:00)", "ಸಂಜೆ (16:00–20:00)"],
  "night (20:00–24:00)": ["night (20:00–24:00)", "ರಾತ್ರಿ (20:00–24:00)"],
  Monday: ["Monday", "ಸೋಮವಾರ"], Tuesday: ["Tuesday", "ಮಂಗಳವಾರ"],
  Wednesday: ["Wednesday", "ಬುಧವಾರ"], Thursday: ["Thursday", "ಗುರುವಾರ"],
  Friday: ["Friday", "ಶುಕ್ರವಾರ"], Saturday: ["Saturday", "ಶನಿವಾರ"],
  Sunday: ["Sunday", "ಭಾನುವಾರ"],
  New: ["New", "ಹೊಸತು"], Assigned: ["Assigned", "ನಿಯೋಜಿತ"], Dismissed: ["Dismissed", "ತಿರಸ್ಕೃತ"],
  High: ["High", "ಹೆಚ್ಚು"], Medium: ["Medium", "ಮಧ್ಯಮ"], Low: ["Low", "ಕಡಿಮೆ"],
};

const KEY = "drishti.lang";

export function useLang() {
  const [lang, setLang] = useState<Lang>(() => {
    // ?lang=kn wins over the stored preference, so a link can open the interface
    // in Kannada for someone who has never set it.
    try {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (q === "kn" || q === "en") return q;
    } catch { /* no URL in a non-browser context */ }
    try {
      return (localStorage.getItem(KEY) as Lang) || "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* private mode — the toggle still works for this session */
    }
    document.documentElement.lang = lang;
  }, [lang]);
  const i = lang === "kn" ? 1 : 0;
  const t = useCallback((k: string) => (T[k] ? T[k][i] : k), [i]);
  /** Full sentence with {placeholders} substituted. */
  const ts = useCallback((k: string, p: Record<string, string | number> = {}) => {
    const raw = S[k] ? S[k][i] : k;
    return raw.replace(/\{(\w+)\}/g, (m, key) =>
      p[key] !== undefined ? String(p[key]) : m);
  }, [i]);
  /** Engine signal key -> label in the reader's language. */
  const sig = useCallback((key: string, fallback: string) =>
    (SIGNALS[key] ? SIGNALS[key][i] : fallback), [i]);
  /** A fixed phrase the engine emitted in English (time band, weekday, level). */
  const ph = useCallback((v?: string | null) =>
    (v && PHRASES[v] ? PHRASES[v][i] : (v || "")), [i]);
  return { lang, setLang, t, ts, sig, ph };
}

export type TFn = (k: string) => string;
export type TSFn = (k: string, p?: Record<string, string | number>) => string;
export type SigFn = (key: string, fallback: string) => string;
export type PhFn = (v?: string | null) => string;
