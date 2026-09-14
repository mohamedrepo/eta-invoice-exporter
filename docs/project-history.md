# Project History — ETA eInvoicing Exporter

Timeline of the working session that produced this extension, newest last.

## Phase 0 — Discovery (2026-08-28)

- User request: build a Chrome extension to bulk-download all invoices + details from
  `invoicing.eta.gov.eg/documents` using **direct API** calls (the third-party tool they had
  was page-by-page and slow — its export dialog showed 3,487 pages pending).
- Reference artifacts provided by the user:
  - `eInvoices_2025-2026.xlsx` — 43,335 invoices / 55,973 line items, two sheets
    (جميع الفواتير 58 cols, بيانات الفواتير 64 cols) — the layout to replicate.
  - Screenshot of the existing exporter's dialog.
- Reverse engineering: downloaded the portal's Angular bundles
  (`main.*.chunk.js`, ~7.5 MB) and extracted the full internal API surface:
  gateway `https://api-portal.invoicing.eta.gov.eg/`, `apiVersion: 1`, endpoints
  (`documents/recent`, `documents/{uuid}/details|raw|pdf`, `documents/search`,
  `documents/count`, `codetypes/...`), response shape `{result, metadata}`.
- Discovered the portal's own auth: OIDC authority `https://id.eta.gov.eg/`,
  client `9A029E3B-7403-4B25-8850-AB67E1FD92AB`, access token held by the app
  (`_t.currentUser.access_token`).
- Also discovered the user already had a third-party exporter extension installed
  (abouelela.net — exceljs/jszip based, page-by-page).

## Phase 1 — v1.0.0 (initial build, 2026-08-28)

- Full extension: MAIN-world hooks (`inject_main.js`), relay bridge (`relay.js`),
  service worker (`background.js`), popup UI, ExcelJS export window, shared
  `mapping.js` (API → 58/64-column reference layout).
- Published to GitHub: <https://github.com/mohamedrepo/eta-invoice-exporter> (private),
  release v1.0.0.

## Phase 2 — v1.0.1 → v1.2.x (debug iterations, 2026-08-28 → 09-03)

Driven by the user's debug reports:

- **v1.0.1** — auth probe rebuilt as a candidate × credentials × URL matrix with
  diagnostics (initial probe used an invalid `TimeCompliance=-1`).
- **v1.1.0** — fixed the empty "بيانات الفواتير" sheet: details were being fetched with the
  40-char `longId` (404); switched to the 26-char `uuid`. Rewrote the export on **ExcelJS**
  replicating the reference workbook styling (RTL, frozen header, status/type colors,
  borders, exact column widths, internal/external hyperlinks).
- **v1.2.0** — added Registration Number (RIN) filtering (sender/receiver/any side).
- **v1.2.1** — the RIN filter did not filter (3,512 rows exported, only 53 relevant):
  the gateway silently ignores `IssuerId`/`ReceiverId` on `/documents/recent`. Switched RIN
  mode to `documents/search?Query={rin}` + strict client-side matching.
- **v1.2.2** — review pass: capped search date windows at 30 days, removed the unused
  SheetJS bundle.
- **v1.2.3** — modern styled export (`eInvoices_Modern_2026.xlsx` build added), fixed a
  second silent 404 class, dashboard sheet `ملخص الفواتير`.
- **v1.2.4** — cross-check fixes (list-only resume keys, auth redaction, taxes shape).

## Phase 3 — v1.2.5 → v1.2.8 (2026-09-03)

- **v1.2.5** — RIN verification moved to the **full document** (`raw.issuer.id` /
  `raw.receiver.id`); search summaries do not carry matchable ids. Forced details phase when
  a RIN filter is active; added scanned/matched/dropped counters.
- **v1.2.6** — debug report now includes a **live API probe** run inside the portal tab
  (captures the real response shape of one search request).
- **v1.2.7** — search rows carry **no `uuid`/`longId` at all** → shape-agnostic ID extraction
  (26-char pattern scan across the row) with multi-candidate details attempts.
- **v1.2.8** — UX: Direction defaults to **Both**; filter fields no longer revert while
  typing (saved options restored once per popup open; edits persisted live).

## Phase 4 — v1.2.9 → v1.3.1 (2026-09-10/11)

- **v1.2.9** — a partial patch produced a release whose `background.js` called the removed
  `waitRelayReady` (START/RESUME crashed). Superseded; release deleted.
- **v1.3.0** — re-applied the startup-reliability work (logged startup, auto re-injection of
  stale portal pages, 25 s timeout, Cancel/Start race guard) **and** added the
  **Code usages export** (`codetypes/codes/my`) requested by the user.
- **v1.3.1** — the user hit `waitRelayReady is not defined` on v1.3.0 (the same partial-patch
  class: `ensureRelay` replaced the helper but START/RESUME still called it). Fixed both call
  sites, fixed codes-XLSX scoping bugs, switched content scripts to **per-execution epochs**
  (stale copies after extension updates go inert), added Cancel race guard.
  Release: <https://github.com/mohamedrepo/eta-invoice-exporter/releases/tag/v1.3.1>

## Side deliverables (same session)

- `eInvoices_Modern_2026.xlsx` (4.8 MB, in `DELIVERY/` and Downloads): modernized workbook
  built from the successful RIN export (6,366 invoices / 8,595 line items) — Excel Tables
  (`tblInvoices`/`tblInvoiceLines`), real date columns, helper date columns
  (السنة/الشهر/ربع السنة/...), `#,##0.00` money formats, dashboard sheet
  `ملخص الفواتير` with live `SUBTOTAL`/`SUMIFS` KPIs, `مراجعة` integrity sheet.
  Verified: row counts + 4 grand totals match the source exactly; independent QA pass.
- Successful RIN extraction confirmed: `eInvoices_2026-07-01_2026-09-03 (1).xlsx`
  (6,366 invoices / 8,595 items for Jul 1 → Sep 3, 2026).

## Documentation (2026-09-14)

- `docs/` knowledge base created (this folder) from the working session transcript and
  committed to the repo as persistent project context.
