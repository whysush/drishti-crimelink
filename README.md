# Drishti — Undetected Case Linkage Engine

> **दृष्टि** · Crime-intelligence for **Karnataka State Police** · KSP Datathon
> **Live:** https://crimelink-927199644.development.catalystserverless.com/app/index.html

Thousands of **undetected FIRs** (final report `C`) sit isolated because the database has
**no global offender ID** — an accused is just a name string within one FIR. So serial
crimes by the same offender across different police stations are never connected.

**Drishti links these undetected cases by *how* the crime was done — not by who was named.**
It builds a behavioural fingerprint of every undetected case, clusters the look-alikes into
offender **"series," and hands the investigator a ranked, evidence-backed set of cold cases
to reopen — every claim citing a real `CrimeNo`.** Presented on an interactive 3D map of Karnataka.

---

## What it does
- **Behavioural linkage** — MO (crime text) + typology + spatiotemporal + victim profile →
  weighted composite similarity → clustering into case series.
- **Next-strike projection** — each group's own rhythm and patch give a projected window and
  area, drawn on the map. Back-tested by holding out each group's last offence: the real
  offence lands inside the projected **area 93%** of the time (timing is weaker, and we say so).
- **Live FIR triage** — paste an incoming case and it is scored against every known group,
  graded against that group's *own* cohesion. This is the daily loop, not a retrospective view.
- **Persons of interest** — the one thing the schema cannot do: accused names resolved across
  separate FIRs, surfaced where they cross station boundaries. Explicitly a name-string
  inference, never an identity claim.
- **In-app validation** — precision, recall, per-signal ablation, forecast back-test and a
  written account of where the method fails, computed live by the same engine.
- **3D interactive Karnataka map** — districts extruded by case volume; case pins, cross-station
  link "webs", projected-strike ring.
- **Printable case brief** — the whole group as a document an officer can file, offline.
- **Bilingual EN / ಕನ್ನಡ**, ⌘K palette, guided tour, shareable deep links.
- **No hallucination, explainable, measured** — precision **0.93** / recall **0.97** /
  F1 **0.95**, 13/13 planted series recovered.

### Identity carries zero weight — and that is a measured decision
We tested whether the accused name should influence linkage. It made the engine **worse**:
P 0.919 / R 0.854 with names against **P 0.928 / R 0.965** without. Coincidental name collisions
were dragging unrelated cases into real groups. So links are made on **behaviour alone**, and a
recurring name is surfaced to the investigator as unconfirmed corroboration only. The ablation
that proves it is in the app, under **Model**.

## Architecture (all on Zoho Catalyst)
```
Browser ─▶ Web Client Hosting (React 19 + Three.js 3D map)
            │  /server/crimelink_function
            ▼
        Serverless Function — API gateway (AdvancedIO, Python)
            ├── RBAC: Catalyst Authentication → role → per-route permission
            ├── Catalyst Cache (gzip'd responses, default segment)
            └── SmartBrowz → server-rendered case-brief PDF
            │  ENGINE_URL
            ▼
        AppSail managed runtime  (Flask + scikit-learn engine)
            │  paginated ZCQL
            ▼
        Catalyst Data Store  (FIR schema · 28 tables · full-text search)

  Job Scheduling ──▶ crimelink_recompute   nightly re-cluster + cache flush
  Signals/Events ──▶ crimelink_newfir      auto-triage a newly registered FIR
```

## Access control
Three roles, enforced in the gateway before anything touches case data:

| | investigator | analyst | supervisor |
|---|---|---|---|
| Leads, cases, triage, briefs | ✅ (own district) | ✅ | ✅ |
| Hotspots, alerts, risk, network | ✅ | ✅ | ✅ |
| **Persons of interest** | ❌ | ✅ | ✅ |
| Model / validation, socio overlay | ❌ | ✅ | ✅ |
| Assign & dismiss leads, audit | ❌ | ❌ | ✅ |

Investigators are **scoped to their district** — they receive only their own
jurisdiction's cases and the groups that touch it. Persons of interest is
deliberately closed to them: it is a list of people charged with nothing, and
opening it should take a more accountable role.

Identity comes from **Catalyst Authentication**. With `CLINK_AUTH_MODE=enforced` an
authenticated Catalyst user is required; the default `demo` mode serves a default
role so the prototype is explorable, and `?role=investigator&district=577` shows
the rules taking effect. A signed-in identity always overrides the demo header.

## Tech stack
| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Three.js + React-Three-Fiber + drei |
| ML engine | Python 3.13, Flask, scikit-learn (TF-IDF, AgglomerativeClustering), NumPy/SciPy, NetworkX |
| API | Catalyst Serverless Function (AdvancedIO, Python) |
| Data | Catalyst Data Store (relational, ZCQL) |
| Hosting | Catalyst Web Client Hosting |

## Catalyst services used
| Service | Used for |
|---|---|
| **AppSail** (managed runtime) | ML engine — fingerprint, clustering, forecast, triage |
| **Serverless Functions** (AdvancedIO) | API gateway, RBAC enforcement, response caching |
| **Job Scheduling** | `crimelink_recompute` — nightly re-cluster (Cron is deprecated; not used) |
| **Signals + Event Functions** | `crimelink_newfir` — auto-triage a new FIR (Event Listeners deprecated; not used) |
| **Cache** | gzip'd API responses in the default segment, shared across function instances |
| **Authentication** | investigator / analyst / supervisor identity behind the RBAC layer |
| **SmartBrowz** | preferred renderer for the case-brief PDF (see *Console steps*) |
| **Web Client Hosting** | the React app |
| **Data Store** | FIR schema, 28 tables (see *Console steps* below) |

## Console steps still open
Catalyst gates a few operations to the admin console — they cannot be done from the
CLI or SDK, so they are listed here rather than silently missing:

1. **Data Store tables** — table creation is console-only (the SDK does row ops on
   existing tables). `engine/data.py` has a working `DatastoreBackend`; the app runs
   on the bundled CSVs until the tables exist. Full-text search on `BriefFacts`
   enables with them.
2. **Production environment** — the project has only Development; `catalyst deploy`
   has no production flag.
3. **Job Scheduling jobpool** — `crimelink_recompute` is deployed; attaching it to a
   nightly schedule needs a jobpool created in the console.
4. **Signals event binding** — `crimelink_newfir` is deployed; binding it to the FIR
   insert event needs the console.
5. **SmartBrowz** — enabling it makes `/brief/<id>` render through Catalyst rather
   than in-process. It is **not** required: the endpoint already returns a real PDF.
   `GET /diag` shows the live status of every Catalyst service the gateway uses.

### PDF export
`GET /brief/<series_id>` returns a real `application/pdf`. It tries **SmartBrowz**
first and falls back to an in-process **fpdf2** renderer producing the same document,
so the export does not depend on a console step. The response says which renderer
ran (`X-Drishti-Pdf-Renderer`) and, if SmartBrowz was skipped, why
(`X-Drishti-Pdf-Fallback`). `?format=html` returns the HTML, `?renderer=local`
forces the in-process path.

## Repo layout
```
crimelink-app/         React + TypeScript frontend (3D map, panels)
  src/terrain.ts       GeoJSON → per-district 3D terrain meshes
  src/i18n.ts          English / ಕನ್ನಡ
  src/components/      map, panels, triage, model, tour, palette, printable brief
appsail-python/        Flask ML engine (source only; deps installed at deploy)
  engine/              fingerprint · linkage · pipeline · nlquery · data access
                       forecast (next-strike + back-test) · triage (live FIR match)
                       persons (cross-FIR name resolution) · validation (metrics + ablation)
  app.py               HTTP API; Data Store or bundled-CSV source
  data/seed_csv/       bundled synthetic seed (fallback data source)
functions/             Catalyst function API gateway
seed/                  synthetic data generator + ground truth
docs/                  schema plan, ingestion runbook, deployment notes
Police_FIR_ER_Diagram.pdf        authoritative KSP FIR schema
Karnataka_District_Boundary.json district polygons (map)
```

## Data
The KSP dataset was not provided (only the ER schema), so `seed/generate_seed.py` produces
**realistic synthetic data** that is **schema-faithful (all 28 ER tables, 43/43 FKs resolve)**,
with planted, verifiable offender series buried in noise. Real FIR data swaps in through the
same tables/pipeline unchanged. The engine reads **Catalyst Data Store** when populated and
**falls back to the bundled CSVs** otherwise (see `/health` → `data_source`).

## API

All routes are served by the Catalyst Function gateway (`/server/crimelink_function/…`)
and proxied to the AppSail engine.

| Route | What it returns |
|---|---|
| `GET /stats` | dataset + group summary |
| `GET /series` · `GET /series/<id>` | ranked groups; one group + inferred edges + forecast |
| `GET /case/<id>` | one case file — accepts a **CrimeNo or a CaseMasterID** |
| `GET /case/<id>/series` | the group a given undetected case belongs to |
| `GET /districts` · `GET /cases/undetected` | map aggregates and pins |
| `GET /persons` | cross-FIR persons of interest (`?cross_station=1`) |
| `POST /match` | **live triage** — score a new FIR against every group |
| `GET /validation` | accuracy, per-signal ablation, forecast back-test, limitations |
| `GET /query?q=` | natural-language search (retrieval-only, cites real FIRs) |

```bash
curl -X POST "$BASE/match" -H 'Content-Type: application/json' -d '{
  "brief_facts": "Two men on a motorcycle snatched a gold chain and rode off.",
  "minor_head_id": "10", "lat": 12.97, "lon": 77.59,
  "incident_from": "2025-05-02 20:40",
  "victims": [{"age": 44, "gender": "F"}]
}'
```

### Deep links
`?group=SER-003` opens that group · `?tab=model|people|triage` opens a panel ·
`?brief=1` opens the printable brief · `?lang=kn` opens in Kannada · `?tour=1` starts the tour.

## For reviewers — how to run it

**Nothing needs installing.** The app is deployed and live:

> **https://crimelink-927199644.development.catalystserverless.com/app/index.html**

Open it and press **?** for a guided tour. Useful links:

| | |
|---|---|
| Guided tour | `?tour=1` |
| Accuracy, ablation, limitations | `?tab=model` |
| Screen a new FIR | `?tab=triage` |
| A linked group + forecast | `?group=SER-001` |
| **See the access model** | `?role=investigator&district=577` |
| ಕನ್ನಡ | `?lang=kn` |

> **Before a live demo, load the page once a minute or two beforehand.** The AppSail
> engine idles and cold-starts; the first request after a quiet period shows
> `ENGINE STARTING` in the status bar until it warms.

### Reproduce the accuracy claim offline (~1 min)
The headline numbers are not asserted — this recomputes them from the data:
```bash
python appsail-python/run_local.py
# pairwise: P=0.928  R=0.965  F1=0.946  | series recovered: 13/13
```

### Run the whole stack locally
```bash
catalyst serve --http 3020        # client + API gateway + engine
# → http://localhost:3020/app/index.html
```
This is full fidelity: RBAC, caching and PDF export all go through the real gateway.
The function calls whatever `ENGINE_URL` in `functions/crimelink_function/catalyst-config.json`
points at — the deployed engine by default; set it to `http://localhost:9055` to run
the engine locally too.

### Engine only (ML work, no gateway)
```bash
cd appsail-python && python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
CLINK_DATA_DIR="$(pwd)/data/seed_csv" X_ZOHO_CATALYST_LISTEN_PORT=9055 python app.py

cd crimelink-app && npm install
REACT_APP_API_BASE=http://localhost:9055 npm start
```
The client talks straight to the engine here, so the gateway-only features — RBAC,
`/me`, PDF export — are absent and every panel is unlocked. Use `catalyst serve` to
review those.

```bash
python seed/generate_seed.py      # regenerate the synthetic corpus
```

## Deploy (Zoho Catalyst)
```bash
catalyst deploy --only appsail     # ML engine
catalyst deploy --only functions   # API gateway
catalyst deploy --only client      # web app
```
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/INGESTION.md](docs/INGESTION.md)
(Data Store go-live).
