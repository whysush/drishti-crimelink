# CLink — Tier 0 Data Store Schema Plan

Status: reconciled against the authoritative `Police_FIR_ER_Diagram.pdf`.

**Full-schema compliance (seed generator):** `seed/generate_seed.py` now emits **all 28
ER tables** — audited at **28/28 tables matching the ER columns exactly** and **43/43
foreign keys resolving** (no dangling refs). Beyond the linkage-core tables below it also
generates UnitType, Rank, Designation, Court, Employee, CrimeHeadActSection, ArrestSurrender,
inv_arrestsurrenderaccused, and Inv_OccuranceTime (columns inferred — the ER leaves it
undefined). Note: `ActSectionAssociation` columns are named **ActID / SectionID** per the
diagram, and hold the `Act.ActCode` / `Section.SectionCode` values they FK to.

Scope: the Tier-0 subset needed to prove the spine
(`CaseMaster ⨝ ChargesheetDetails WHERE cstype='C'` returns undetected cases),
plus the lookups the linkage engine will need in Tier 1.

## Corrections applied from the ER diagram (draft plan was wrong on these)
- **Act** PK is `ActCode` (VARCHAR), *not* `ActID` (Bigint). **Section** has no `SectionID` — it's keyed by (`ActCode`, `SectionCode`) VARCHARs.
- **ActSectionAssociation** has **no PK column** (Catalyst ROWID covers it); its `ActID`/`SectionID` FKs point at `Act.ActCode` / `Section.SectionCode`, so we store them as the **code strings**, and it carries `ActOrderID`/`SectionOrderID`.
- **CrimeHead** name column is `CrimeGroupName` (e.g. "Crimes Against Body"), not `CrimeHeadName`.
- **CrimeSubHead** name column is confusingly `CrimeHeadName` (e.g. "Murder", "Robbery") + has `SeqID`.
- **GravityOffence** and **CaseCategory** label column is `LookupValue`, not `*Name`.
- **CasteMaster** uses snake_case: `caste_master_id`, `caste_master_name`.
- **CaseMaster** also has `CaseNo`, `PolicePersonID`(→Employee), `CourtID`(→Court) — added.
- **ChargesheetDetails** also has `PolicePersonID`(→Employee); `cstype` is CHAR(1).
- **Victim** has `VictimPolice`; **ComplainantDetails** has `ComplainantName` — added.

## Catalyst Data Store conventions
- Every table auto-gets `ROWID`(PK), `CREATEDTIME`, `MODIFIEDTIME`, `CREATORID` — we don't define these.
- We keep KSP **domain keys** (e.g. `CaseMasterID`) as unique-indexed columns and JOIN on them in ZCQL (source data references domain keys, not Catalyst ROWID).
- Relationships modeled as **indexed domain-key columns**, not enforced FK constraints (FK constraints need parent ROWIDs and fight bulk import). Can harden later.
- Type mapping: ER `INT`→`Bigint`, `DECIMAL`→`Double`, `DATE`/`DATETIME`→`DateTime`, `Nvarchar(Max)`→`Text`, `CHAR`/`VARCHAR`→`Varchar`, `BIT`→`Boolean`. (Catalyst has no Decimal/Date/CHAR — mapped to nearest.)
- **Full-text search** enabled per-table on selected columns (flagged ✓).

---

## Core tables

### CaseMaster — the FIR (hero table)
| Column | Type | Notes |
|---|---|---|
| CaseMasterID | Bigint | **unique idx** — domain PK |
| CrimeNo | Varchar | **idx** — structured: `[1 CaseCat][4 District][4 PoliceStation][4 Year][5 serial]`. Cited in every output; also a recoverable geo/typology signal for Tier 1. |
| CaseNo | Varchar | last 9 digits of CrimeNo |
| CrimeRegisteredDate | DateTime | |
| PolicePersonID | Bigint | → Employee (registering officer) |
| PoliceStationID | Bigint | idx → Unit.UnitID |
| CaseCategoryID | Bigint | idx → CaseCategory |
| GravityOffenceID | Bigint | idx → GravityOffence (actionability scoring) |
| CrimeMajorHeadID | Bigint | idx → CrimeHead |
| CrimeMinorHeadID | Bigint | idx → CrimeSubHead |
| CaseStatusID | Bigint | idx → CaseStatusMaster |
| CourtID | Bigint | → Court |
| IncidentFromDate | DateTime | |
| IncidentToDate | DateTime | |
| InfoReceivedPSDate | DateTime | reporting-delay feature |
| latitude | Double | real GPS |
| longitude | Double | real GPS |
| BriefFacts | Text | **FULL-TEXT SEARCH ✓** — MO free text |

### ChargesheetDetails — the "solved/undetected" flag
| Column | Type | Notes |
|---|---|---|
| CSID | Bigint | **unique idx** |
| CaseMasterID | Bigint | idx → CaseMaster |
| csdate | DateTime | |
| cstype | Varchar(1) | **idx** — `A`=chargesheet `B`=false case `C`=**undetected** (engine filters on `C`) |
| PolicePersonID | Bigint | → Employee |

### Accused
| Column | Type | Notes |
|---|---|---|
| AccusedMasterID | Bigint | unique idx |
| CaseMasterID | Bigint | idx |
| AccusedName | Varchar | raw string; FULL-TEXT SEARCH ✓ (weak-identity fuzzy + NL query) |
| AgeYear | Int | |
| GenderID | Bigint | M/F/T |
| PersonID | Varchar | "A1/A2" **within-FIR only** — NOT a global id |

### Victim
| Column | Type | Notes |
|---|---|---|
| VictimMasterID | Bigint | unique idx |
| CaseMasterID | Bigint | idx |
| VictimName | Varchar | |
| AgeYear | Int | target-profile feature |
| GenderID | Bigint | m/f/t — target-profile feature |
| VictimPolice | Varchar | 1 if victim is police else 0 |

### ComplainantDetails  (socio-demographic — handle sensitively)
| Column | Type | Notes |
|---|---|---|
| ComplainantID | Bigint | unique idx |
| CaseMasterID | Bigint | idx |
| ComplainantName | Varchar | |
| AgeYear | Int | |
| OccupationID | Bigint | → OccupationMaster |
| ReligionID | Bigint | → ReligionMaster |
| CasteID | Bigint | → CasteMaster.caste_master_id |
| GenderID | Bigint | |

### ActSectionAssociation — legal signature per case (no PK column)
| Column | Type | Notes |
|---|---|---|
| CaseMasterID | Bigint | idx → CaseMaster |
| ActCode | Varchar | idx → Act.ActCode (diagram calls it ActID but FK targets the code) |
| SectionCode | Varchar | idx → Section.SectionCode |
| ActOrderID | Int | print/display order |
| SectionOrderID | Int | print/display order |

---

## Typology / legal tables

### CrimeHead
| CrimeHeadID (Bigint, unique idx) | CrimeGroupName (Varchar) | Active (Boolean) |

### CrimeSubHead
| CrimeSubHeadID (Bigint, unique idx) | CrimeHeadID (Bigint, idx) | CrimeHeadName (Varchar — the sub-head label, e.g. "Murder") | SeqID (Int) |

### Act
| ActCode (Varchar, **unique idx** — PK) | ActDescription (Varchar) | ShortName (Varchar) | Active (Boolean) |

### Section  (keyed by ActCode + SectionCode)
| ActCode (Varchar, idx) | SectionCode (Varchar, idx) | SectionDescription (Varchar) | Active (Boolean) |

---

## Geography tables

### Unit — police station
| UnitID (Bigint, unique idx) | UnitName (Varchar) | TypeID (Bigint) | ParentUnit (Bigint, self-ref) | StateID (Bigint, idx) | DistrictID (Bigint, idx) | Active (Boolean) |

### District
| DistrictID (Bigint, unique idx) | DistrictName (Varchar) | StateID (Bigint, idx) | Active (Boolean) |

### State
| StateID (Bigint, unique idx) | StateName (Varchar) | Active (Boolean) |

---

## Lookup tables (small; load if present, else keep raw IDs)
- **CaseCategory**: CaseCategoryID (unique idx), LookupValue — FIR / UDR / PAR / Zero FIR
- **GravityOffence**: GravityOffenceID (unique idx), LookupValue — Heinous / Non-Heinous
- **CaseStatusMaster**: CaseStatusID (unique idx), CaseStatusName — Under Investigation / Charge Sheeted / Closed
- **OccupationMaster**: OccupationID (unique idx), OccupationName
- **ReligionMaster**: ReligionID (unique idx), ReligionName
- **CasteMaster**: caste_master_id (unique idx), caste_master_name

## Deferred to Tier 1+ (present in ER, not needed for the spine)
Court, Employee, Rank, Designation, UnitType, ArrestSurrender + `inv_arrestsurrenderaccused`,
CrimeHeadActSection. **`Inv_OccuranceTime`** (1:1 with CaseMaster — "occurrence time/location
record") — its columns aren't defined in the ER PDF but it likely holds a precise time-of-day;
**worth chasing for the temporal feature** if the real data includes it.

---

## Tier-0 verification query (ZCQL) — proof-of-life
```sql
SELECT CaseMaster.CaseMasterID, CaseMaster.CrimeNo, CaseMaster.CrimeRegisteredDate,
       CaseMaster.PoliceStationID, CaseMaster.latitude, CaseMaster.longitude,
       ChargesheetDetails.cstype, ChargesheetDetails.csdate
FROM CaseMaster
JOIN ChargesheetDetails ON CaseMaster.CaseMasterID = ChargesheetDetails.CaseMasterID
WHERE ChargesheetDetails.cstype = 'C'
LIMIT 50
```
Count of undetected cases:
```sql
SELECT COUNT(ChargesheetDetails.CSID) FROM ChargesheetDetails WHERE ChargesheetDetails.cstype = 'C'
```

---

## Ingestion approach — decision tree
| Dataset format & shape | Recommended path |
|---|---|
| Clean CSV, one file per table, < ~20MB | **Console Bulk Import** (zero code) |
| CSV needing coercion / date parse / dedupe | **Loader Function** (AdvancedIO) reading from **Stratus**, SDK bulk-write |
| SQL dump (.sql) | local script → per-table CSV → console import |
| Excel (.xlsx, multi-sheet) | local script → per-sheet CSV → console import |
| One big denormalized flat file | Loader Function that normalizes into these tables |
| >20MB / 100k+ rows | Bulk Write API, CSV-in-zip staged in **Stratus** |
| **No real data yet** | **Synthetic seed generator** matching this schema → prove spine now, swap real data via same loader later |

Reminder (CONTEXT §1): **Stratus** not File Store, **Job Scheduling** not Cron, **Signals + Event Functions** not Event Listeners.
