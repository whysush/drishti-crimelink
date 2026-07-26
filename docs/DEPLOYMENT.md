# CLink — Deployment (live on Zoho Catalyst)

All three components are deployed to the Catalyst **Development** environment and
verified end-to-end (HTTP 200, cloud-to-cloud hero flow working).

## Live URLs
| Component | URL |
|---|---|
| **Web client** (React) | https://crimelink-927199644.development.catalystserverless.com/app/index.html |
| **API gateway** (Function, AdvancedIO) | https://crimelink-927199644.development.catalystserverless.com/server/crimelink_function/ |
| **Engine** (AppSail, Flask + scikit-learn) | https://crimelink-engine-10128587118.development.catalystappsail.com |

## Architecture (matches CLINK_CONTEXT §2)
```
Browser ─▶ Web Client (Catalyst Client hosting, /app)
             │  fetch  /server/crimelink_function/...   (same origin)
             ▼
        crimelink_function  (AdvancedIO, Python)  ── API gateway: CORS, routing
             │  ENGINE_URL (server-to-server)
             ▼
        crimelink-engine  (AppSail, managed runtime, Python 3.13)
             │  fingerprint → composite similarity → clustering → ranked series
             ▼
        data:  bundled seed CSVs today  →  Data Store (see below)
```

## What runs where
- **Engine** does the ML: TF-IDF MO + typology + spatiotemporal + target-profile +
  weak-name → weighted composite similarity → AgglomerativeClustering → ranked,
  evidence-backed series. scikit-learn / scipy / numpy install cleanly from
  `requirements.txt` on the managed runtime (cp313 manylinux wheels, no compile).
  `app-config.json`: stack `python_3_13`, memory 1024 MB.
- **Function** is a thin gateway (stdlib `urllib` only) → forwards to the engine,
  adds CORS. `ENGINE_URL` set via `catalyst-config.json` env_variables.
- **Client** built with `REACT_APP_API_BASE=/server/crimelink_function` (see
  `.env.production`) so it calls the gateway on the same origin.

## Verified (cloud)
- `GET engine/stats` → 455 undetected cases, 11 series, 8 cross-jurisdiction.
- `GET function/case/1/series` → SER-004, 7 cases across 4 stations, weak name
  "Manjunath Gowda" (3/7, flagged weak), 21 confidence-scored edges citing real CrimeNos.
- `GET function/query?q=...` → NL retrieval, real CrimeNos cited.
- Engine offline eval vs planted ground truth: **precision 0.85, recall 1.0, 6/6 series recovered.**

## Redeploy
```bash
catalyst deploy --only appsail     # engine (reinstalls deps, ~3 min)
catalyst deploy --only functions   # gateway
catalyst deploy --only client      # web app (rebuilds from .env.production)
# or: catalyst deploy               # all three
```
Note: CLI deploys to the **Development** env. For the live submission, promote to
**Production** (deploy against the production env) as CLINK_CONTEXT §5 Phase 5 notes.

## Data Store spine — the one remaining console step
The engine currently serves the **bundled seed CSVs** (same real rows, citing real
CrimeNos), so the deployed demo works today. To move the data into **Catalyst Data
Store** (Tier-0 spine, the "fully on Data Store" story):

> Catalyst Data Store table creation (DDL) is a **console / Admin-console** action —
> it is not exposed by the CLI or the `zcatalyst-sdk` (the SDK only does row ops on
> existing tables). So this step can't be scripted from here.

1. Create the 19 tables from the exact specs in `docs/INGESTION.md` **or** use console
   *Import Data* on each `seed/csv/*.csv` (Catalyst auto-creates the table from the CSV).
2. Enable full-text Search on `CaseMaster.BriefFacts` and `Accused.AccusedName`.
3. Verify the spine with the ZCQL in `docs/INGESTION.md` (expect **464/455** `cstype='C'`).
4. Switch the engine to Data Store: the function already has a path to feed rows to the
   engine's `POST /run` (`DatastoreBackend` in `engine/data.py` reads via ZCQL). Wire a
   nightly recompute with **Job Scheduling** (not Cron) per CLINK_CONTEXT §1.

Everything else (compute, API, UI) is already live and does not depend on this step.
