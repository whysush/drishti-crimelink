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
- **Behavioural linkage** — MO (crime text) + typology + spatiotemporal + victim profile + weak-name → weighted composite similarity → clustering into case series.
- **3D interactive Karnataka map** — districts extruded by case volume; hover/click districts, drop case pins, light up cross-station link "webs".
- **Ranked priority leads** with an **evidence trail** (why linked, cited FIRs, timeline).
- **Suspect-name search** and **natural-language search** — retrieval-only, always cite real records.
- **No hallucination, explainable, measured** — precision 0.92 / recall 0.85, 13/13 planted series recovered.

## Architecture (all on Zoho Catalyst)
```
Browser ─▶ Web Client Hosting (React 19 + Three.js 3D map)
            │  /server/crimelink_function
            ▼
        Serverless Function  (API gateway, Python)
            │  ENGINE_URL
            ▼
        AppSail managed runtime  (Flask + scikit-learn engine)
            │  paginated ZCQL
            ▼
        Catalyst Data Store  (FIR schema · 28 tables · full-text search)
```

## Tech stack
| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Three.js + React-Three-Fiber + drei |
| ML engine | Python 3.13, Flask, scikit-learn (TF-IDF, AgglomerativeClustering), NumPy/SciPy, NetworkX |
| API | Catalyst Serverless Function (AdvancedIO, Python) |
| Data | Catalyst Data Store (relational, ZCQL) |
| Hosting | Catalyst Web Client Hosting |

## Repo layout
```
crimelink-app/         React + TypeScript frontend (3D map, panels)
  src/terrain.ts       GeoJSON → per-district 3D terrain meshes
  src/components/      map, panels, command bar
appsail-python/        Flask ML engine (source only; deps installed at deploy)
  engine/              fingerprint · linkage · pipeline · nlquery · data access
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

## Run locally
```bash
# engine
cd appsail-python && python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
CLINK_DATA_DIR="$(pwd)/data/seed_csv" X_ZOHO_CATALYST_LISTEN_PORT=9055 python app.py

# frontend (new terminal)
cd crimelink-app && npm install
REACT_APP_API_BASE=http://localhost:9055 npm start

# regenerate synthetic data + evaluate the engine
python seed/generate_seed.py
python appsail-python/run_local.py            # prints precision/recall vs ground truth
```

## Deploy (Zoho Catalyst)
```bash
catalyst deploy --only appsail     # ML engine
catalyst deploy --only functions   # API gateway
catalyst deploy --only client      # web app
```
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/INGESTION.md](docs/INGESTION.md)
(Data Store go-live).
