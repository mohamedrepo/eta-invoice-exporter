# Architecture — ETA eInvoicing Exporter

Chrome MV3 extension. All portal interaction happens **inside the portal tab** (page
context) with the user's live session; the service worker only orchestrates and persists.

```
┌────────────────────────── Chrome ───────────────────────────┐
│                                                             │
│  Portal tab (invoicing.eta.gov.eg)                          │
│  ┌──────────────────────────────┐  ┌─────────────────────┐  │
│  │ MAIN world: inject_main.js   │  │ ISOLATED: relay.js  │  │
│  │ - fetch/XHR hooks (capture   │←→│ - postMessage ↔     │  │
│  │   Authorization, replay API, │  │   chrome.runtime    │  │
│  │   crawl engine, codes engine)│  │   bridge (epoch)    │  │
│  └──────────────┬───────────────┘  └─────────┬───────────┘  │
│                 │ window.postMessage          │ runtime.msg  │
│  ┌──────────────┴───────────────────────────┐ │             │
│  │ Portal SPA (Angular) — session/token     │ │             │
│  └──────────────────────────────────────────┘ │             │
│                                               ▼             │
│  Service worker: background.js ──────────────────────────── │
│  - run state (runGen, stats, headers, evlog ring)           │
│  - chunked persistence → chrome.storage.local               │
│  - tab discovery / re-injection (ensureRelay)               │
│                          ▲                                   │
│  Popup (popup.html/js) ──┘          Export window          │
│  filters / progress / debug        (export.html/js +        │
│  Copy debug report                  vendor/exceljs.min.js)  │
└─────────────────────────────────────────────────────────────┘
```

## Components

| File | World | Role |
|---|---|---|
| `mapping.js` | MAIN + export window | API JSON → reference Excel layout (58/64 columns), headers, tax-code column pairs, unit map |
| `inject_main.js` | MAIN (document_start) | fetch/XHR hooks (auth capture), token discovery, auth probe matrix, documents crawl (`documents/recent` + per-uuid `details`), RIN search crawl (`documents/search?Query=`), codes crawl (`codetypes/codes/my`), epoch lifecycle |
| `relay.js` | ISOLATED (document_start) | page ↔ extension message bridge (`__eta` tag), epoch lifecycle |
| `background.js` | service worker | state machine (runGen), chunked storage, tab discovery + `ensureRelay` re-injection, progress broadcast, `GET_DEBUG` + live API probe (`probeApiSample`), HEADERS event |
| `popup.html/js` | popup | filters, progress, Start/Pause/Resume/Cancel, Copy debug report, export launchers, PDF batch |
| `export.html/js` | extension window | builds XLSX (ExcelJS) / CSV from storage chunks; documents mode (2 styled sheets + dashboard) and codes mode (1 sheet) |
| `vendor/exceljs.min.js` | export window | ExcelJS 4.4.0 (bundled offline) |

## Message protocol

| Channel | Tag | Direction | Payload |
|---|---|---|---|
| `window.postMessage` | `__eta: 1` | MAIN → relay | `AUTH`, `PONG`, `PROGRESS`, `BATCH {rows,itemRows,keys}`, `HEADERS {sheet,cols}`, `LOG`, `DONE`, `ERROR` |
| `window.postMessage` | `__eta: 2` | relay → MAIN | `START_CRAWL`, `PAUSE`, `RESUME`, `CANCEL`, `PING` |
| `chrome.runtime.sendMessage` | `__eta: 1` | relay → SW | same as page events |
| `chrome.tabs.sendMessage` | `__etaToPage: 1` | SW → page | `START_CRAWL`, `PAUSE`, `RESUME`, `CANCEL`, `PING` |
| `chrome.runtime.sendMessage` | `__etaPop: 1` | popup → SW | `STATE`, `START`, `RESUME`, `PAUSE`, `RESUME_CMD`, `CANCEL`, `PING_PORTAL`, `CLEAR`, `GET_AUTH`, `GET_DEBUG` |

## Storage layout (chrome.storage.local)

| Key | Content |
|---|---|
| `eta_rows_c0…N` / `eta_items_c0…N` | append-only chunks of mapped invoice rows (58 cols) and line-item rows (64 cols) |
| `eta_seen_c0…N` | document keys already flushed (resume skip set) |
| `eta_meta` | run state snapshot (running/paused/interrupted, stats, progress, chunkIdx, opts subset, headers) |
| `eta_auth` | `{auth, headers}` captured from the portal app |
| `eta_opts` | last-used filter options (restored once per popup open) |

## Portal API contract (reverse-engineered from the portal bundle + live reports)

- Gateway: `https://api-portal.invoicing.eta.gov.eg/` — prefix `/api/v1/`.
- Auth: `Authorization: <captured scheme + token>` (portal app builds it from the OIDC
  session at `https://id.eta.gov.eg/`, client `9A029E3B-7403-4B25-8850-AB67E1FD92AB`,
  scope `publicportals.bff.api`).
- `GET /documents/recent?PageSize&PageNo&Status&DocumentType&DocumentTypeName|Direction|
  InvoiceDirection&TimeCompliance&Submission|IssueDateFrom/To`
  → `{ result: DocumentSummary[], metadata: { totalPages, totalCount } }`
  ⚠ the gateway ignores `IssuerId`/`ReceiverId` here (see decisions D4).
- `GET /documents/search?Query&Status&Submission|IssueDateFrom/To&Page&PageSize`
  → same shape; rows are fuzzy candidates without usable id fields.
- `GET /documents/{uuid}/details` (fallback `/raw`) → full document
  (`issuer{id,name,address}`, `receiver{…}`, `invoiceLines[]` / `documentLines[]`,
  `taxTotals[]`, `signatures[]`, `totalSales/netAmount/totalAmount`, …).
- `GET /documents/{uuid}/pdf` → PDF printout (blob).
- `GET /codetypes/taxes` → code-type registry (EGS/GS1 ids; shape varies).
- `GET /codetypes/codes/my?Ps&Pn&CodeTypeID&ItemCode&CodeName&ActiveFrom&ActiveTo…`
  → `{ result: codeUsageRows[], metadata }` (the /codeusages page data).
- Documents list/filter params seen in the app: `PageSize, PageNo, Status,
  DocumentTypeName (=direction: "Received"/"sent"), DocumentType, DocumentTypeVersion,
  SubmissionDateFrom/To, IssueDateFrom/To, Direction, InvoiceDirection, ReceiverId,
  IssuerId, ReceiverType, IssuerType, TimeCompliance (0=All,1=OnTime,2=Late),
  LateSubmissionReqNo`.

## Data flow (documents export)

1. Popup START → SW validates options, clears/keeps chunks, finds or opens the portal tab,
   waits for the relay (`ensureRelay`), sends `START_CRAWL`.
2. Crawler resolves auth (probe matrix) → probes list variants → pages all 30-day windows →
   (RIN mode) `documents/search` per window → emits candidate summaries.
3. Details phase: worker pool fetches `details` per document (uuid-first, longId fallback),
   maps each through `mapping.js`, streams batches to the SW (RIN mode filters on
   `raw.issuer.id`/`receiver.id` here).
4. SW appends chunks to storage, tracks stats/progress, broadcasts to the popup.
5. Export window concatenates chunks and writes XLSX (ExcelJS, styled per the reference
   workbook) or CSVs via `chrome.downloads`.

## Export workbook layout (documents mode)

- Sheet `جميع الفواتير`: 58 columns + 7 helper columns (السنة، الشهر رقم، الشهر، ربع السنة،
  الأسبوع، اليوم، تاريخ فقط) — table `tblInvoices`, hyperlinks on تفاصيل/الرابط الخارجى.
- Sheet `بيانات الفواتير`: 64 columns — table `tblInvoiceLines`.
- Conditional formatting rules encode the status/type colors (see decisions D14).
- Column widths come from the reference workbook (`W1`/`W2` arrays in `export.js`).

## Known constraints

- The search endpoint enforces ~30-day date spans → RIN mode caps `windowDays` at 30.
- تاريخ التقديم is not returned by the search endpoint → empty in RIN-mode exports.
- Excel Tables require unique column names → duplicated tax headers carry T-code suffixes.
- Export of very large ranges happens in the export window (ExcelJS memory) — split ranges
  if Chrome struggles.
