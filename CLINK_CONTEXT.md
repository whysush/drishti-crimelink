# CLink — Project Context & Next Steps (Claude Code Handoff)

> Paste this as the opening prompt / place at repo root as `CONTEXT.md` so Claude Code has full context before touching anything.

---

## 0. What this project is

**CLink** is a submission for the **KSP (Karnataka State Police) Datathon**. It is a crime-intelligence platform, but the *hero feature* is what makes it stand out from every other team:

> **The Undetected Case Linkage Engine.** KSP has thousands of *undetected* cases (final report type `C`) sitting in isolation because the database has **no global person-ID for accused** — `Accused.PersonID` is only "A1/A2/A3" *within one FIR*, and `AccusedName` is a raw string. So cases committed by the same offender across different police stations are never connected. CLink links them **by how the crime was done (MO + spatiotemporal + typology), not by who was named**, and hands the investigator a ranked, evidence-backed "series" to reopen.

One-line pitch: *"Every other team shows you where crime happened. We surface the crimes nobody knew were connected — and prove it."* The verb is **"we reopen cold cases,"** not "we visualize crime."

**Critical framing insight (state this in the pitch):** the schema's biggest weakness — no person-ID — is turned INTO the problem statement. That's the differentiator. Any team claiming cross-case offender tracking via a person-ID is wrong about the schema.

---

## 1. Hard constraints (do not violate)

- **Deployment via Zoho Catalyst is MANDATORY, no exceptions.** Using a third-party service where a Catalyst equivalent exists may invalidate the submission. Use Catalyst-native services everywhere one exists.
- **Deprecated Catalyst services — DO NOT USE:** Cron, File Store, Event Listeners (EOL 30 Apr 2026). Use **Job Scheduling** instead of Cron, **Stratus** instead of File Store, **Signals + Event Functions** instead of Event Listeners.
- **No hallucination.** Every CLink output (series, links, chatbot answers) MUST cite real `CaseMasterID` / `CrimeNo` values pulled from the data. This is the trust story for a police jury — it is a feature, not a nicety.
- **Graceful degradation.** The `BriefFacts` free-text field may be sparse or synthetic in the real dataset. MO-embedding is the hero signal *when text is rich*, but the linkage MUST still work on typology + spatiotemporal + target-profile features alone. Never demo a feature that dies on empty text.
- **Keep clustering on scikit-learn primitives** (`DBSCAN` / `AgglomerativeClustering`) by default so the AppSail **Catalyst-Managed Runtime** can install deps from `requirements.txt`. Treat `hdbscan` as an *optional* upgrade only (it compiles native code and may force a switch to AppSail Docker runtime — avoid unless needed).

---

## 2. Current state (already done — Phase 0 complete)

Environment is fully set up on Ubuntu 22.04:

- Node 20 (via nvm), `zcatalyst-cli` v1.26.2 installed and logged in.
- Python 3.13.14 (via pyenv) wired to Catalyst: `catalyst config:set python3_13.bin=...` done.
- Catalyst project **`crimelink`** created in console and initialized locally at `~/crimelink`.

Repo structure at `~/crimelink`:

```
crimelink/
├── catalyst.json            # project config (3 components registered)
├── .catalystrc              # project binding
├── functions/
│   └── crimelink_function/  # AdvancedIO function, Python 3.13 — the HTTP API layer
├── crimelink-app/           # React + TypeScript frontend
└── appsail-python/          # "crimelink_engine" — Python/Flask ML backend (fingerprint, similarity, clustering)
```

Component roles:
- **`crimelink_function`** (AdvancedIO, Python) → API layer. Routes, auth checks, orchestrates calls to the engine + Data Store, returns JSON to the frontend.
- **`crimelink_engine`** (AppSail, Python/Flask, managed runtime) → heavy ML: fingerprint vector builder, similarity, clustering, series scoring, evidence-trail assembly.
- **`crimelink-app`** (React + TS) → dashboard: hotspot map, network graph, series view, NL query bar, PDF export trigger.

---

## 3. The data (KSP FIR schema — key tables only)

From the official ER diagram. Full schema has ~30 tables; these are the ones CLink depends on:

- **CaseMaster** (PK `CaseMasterID`) — the FIR. Key fields: `CrimeNo`, `CrimeRegisteredDate`, `PoliceStationID`, `CaseCategoryID`, `GravityOffenceID`, `CrimeMajorHeadID`, `CrimeMinorHeadID`, `CaseStatusID`, `IncidentFromDate`, `IncidentToDate`, `InfoReceivedPSDate`, **`latitude`**, **`longitude`**, **`BriefFacts`** (Nvarchar Max — the MO free text).
- **ChargesheetDetails** (PK `CSID`, FK `CaseMasterID`) — `csdate`, **`cstype`** CHAR: `A`=Chargesheet, `B`=False Case, **`C`=Undetected**. ← **`cstype='C'` is the "unsolved" flag; the whole engine operates on these.**
- **CaseStatusMaster** — Under Investigation / Charge Sheeted / Closed (secondary solved/unsolved axis).
- **Accused** (PK `AccusedMasterID`, FK `CaseMasterID`) — `AccusedName` (raw string), `AgeYear`, `GenderID`, `PersonID` ("A1/A2..." within-FIR only — NOT a global ID).
- **Victim** (FK `CaseMasterID`) — `VictimName`, `AgeYear`, `GenderID`.
- **ComplainantDetails** (FK `CaseMasterID`) — `AgeYear`, `OccupationID`, `ReligionID`, `CasteID`, `GenderID` (socio-demographic signal — handle sensitively).
- **CrimeHead** / **CrimeSubHead** — crime typology hierarchy.
- **ActSectionAssociation** → **Act** / **Section** — legal signature per case.
- **Unit** (police station), **District**, **State** — geography/jurisdiction.
- **GravityOffence** — Heinous / Non-Heinous (used for series actionability scoring).

Geography is **real GPS** (`latitude`/`longitude`), not just district codes — enables genuine spatiotemporal clustering.

---

## 4. Catalyst service mapping

| Layer | Catalyst service |
|---|---|
| Relational data + full-text search on BriefFacts | **Data Store** |
| Cached fingerprint vectors + series results | **Cache** + **NoSQL** |
| BriefFacts embeddings, RAG, NL query | **QuickML** (LLM serving, RAG) |
| Clustering / linkage compute | Python in **AppSail** (managed runtime; scikit-learn/networkx) |
| Tabular risk forecast | **Zia AutoML** |
| Kannada + voice (STT/TTS/translate) | **Zia Services** |
| PDF evidence-trail / report export | **SmartBrowz** |
| Backend orchestration | **Serverless Functions** (AdvancedIO) |
| Frontend hosting | **Client** (React) / optionally Slate |
| Auth + RBAC (investigator/analyst/supervisor) | **Authentication** + **API Gateway** |
| Nightly recompute | **Job Scheduling** (NOT Cron) |
| Auto-flag new FIR linking to existing series | **Signals + Event Functions** |

---

## 5. Build order (strict — do not jump ahead)

Cut from the bottom up if time runs short. **Never let Tier 1/2 slip for Tier 4 polish.**

### Tier 0 — Data spine (proof-of-life)
1. Model Data Store tables mirroring §3 (start with CaseMaster, ChargesheetDetails, Accused, Victim, ComplainantDetails, CrimeHead, CrimeSubHead, ActSectionAssociation, Unit, District, plus lookups).
2. Enable **full-text search on `BriefFacts`**.
3. Ingest the dataset (bulk import or a one-shot loader Function).
4. **Prove the join:** `CaseMaster ⨝ ChargesheetDetails WHERE cstype='C'` returns undetected cases. Seeing these render = spine works.

### Tier 1 — CLink hero (fingerprint → series)
5. **Fingerprint builder** in `crimelink_engine`: per undetected case, assemble the composite feature vector:
   - MO semantics: embed `BriefFacts` (QuickML) — *skip/zero-weight if empty (graceful degradation)*.
   - Typology: one-hot `CrimeHead`/`CrimeSubHead` + act-section set (legal signature).
   - Spatial: lat/long (+ distance features).
   - Temporal: time-of-day bucket, day-of-week, `IncidentFromDate`→`InfoReceivedPSDate` reporting delay, inter-event spacing.
   - Target profile: victim age/gender distribution, complainant occupation.
   - **Weak identity signal:** fuzzy match on `AccusedName` + age tolerance — used as ONE low weight signal, NEVER a hard join, always surfaced as "weak."
6. Composite weighted similarity → **DBSCAN/AgglomerativeClustering** (or `networkx` community detection on a case-similarity graph) → ranked candidate **series**.
7. Cache results (Cache + NoSQL).

### Tier 2 — Trust layer (the thing that wins)
8. **Evidence trail** per series: which features drove each link, per-case contribution, cited `CaseMasterID`/`CrimeNo`, series map + timeline. Rank series by cohesion × actionability (spatial tightness + recency + `GravityOffence`).

### Tier 3 — Platform surface (demo polish)
9. React frontend: series view, hotspot map (real lat/long), honest network graph (edges = *inferred* links w/ confidence, not asserted facts).
10. NL query bar over the same backend via QuickML RAG (retrieves + cites real rows → can't fabricate).
11. PDF export via SmartBrowz.
12. Auth + RBAC (Authentication + API Gateway).

### Tier 4 — If time remains
13. Zia AutoML risk forecast; Zia Services Kannada/voice; Signals auto-flag on new linked FIR; Job Scheduling nightly recompute.

### Phase 5 — Deploy (mandatory)
14. `catalyst deploy`. Note: CLI works against the **development** env — must explicitly **deploy to production** for the live submission. Optionally wire Pipelines for CI/CD.

---

## 6. Immediate next task for Claude Code

**Start at Tier 0.** Concretely:

1. Inspect the current repo (`catalyst.json`, the three component folders) and confirm structure matches §2.
2. Propose the Data Store table definitions (names, columns, types, PK/FK, which get full-text search) for the Tier-0 subset in §5 step 1 — as a written schema plan first, before creating anything.
3. Write the ingestion approach (bulk import vs. loader Function) given the dataset format — **ask which format the dataset is in (CSV / SQL dump / Excel) before writing the loader.**
4. Deliver the Tier-0 verification query that returns undetected (`cstype='C'`) cases joined to CaseMaster, so we can confirm proof-of-life.

**Do NOT** start Tier 1 ML code until the spine returns undetected cases. **Ask before** creating Data Store tables or writing ingestion code, and confirm the dataset file format first.

---

## 7. Demo script (what the build must serve, 3 min)

1. **Frame the gap (15s):** thousands of undetected cases, no person-ID to link them, sitting in isolation. *(Signals we read the schema.)*
2. **Reveal (45s):** click one undetected FIR → "5 likely-linked undetected cases across 3 stations, cohesion 0.87" → map lights up across jurisdictions.
3. **Proof (45s):** open evidence trail → linked by MO/time/target-profile; weak name match flagged weak; every row cites a real CrimeNo. "No hallucination."
4. **The verb (15s):** "This isn't a dashboard. It reopens cold cases."
5. **Breadth (30s):** map + NL query bar (Kannada/voice if built) + one-click PDF case file.
6. **Close (10s):** "Fully deployed on Catalyst, recomputes nightly, auto-flags new links."
