# Requirements — ETA eInvoicing Exporter

Functional requirements gathered from the user across the session, in priority order.

## R1 — Bulk invoice extraction (core)

- Export **all** invoices (sent + received) from `invoicing.eta.gov.eg/documents` for a date
  range, **directly via the portal's internal API** (fast, reliable — not page-by-page DOM
  scraping).
- Must include **full details** per invoice: line items, taxes per type (T1–T17 with rates),
  discounts, seller/buyer names + tax IDs + addresses, signature, share links, currency.
- Output mirrors the reference workbook `eInvoices_2025-2026.xlsx`:
  - Sheet **جميع الفواتير** — 58 columns, one row per invoice.
  - Sheet **بيانات الفواتير** — 64 columns, one row per line item.
  - Arabic headers in the exact reference order.

## R2 — Visual identity of exports

- Preserve the reference workbook's look: RTL sheets, frozen header row, thin borders,
  Calibri 11, original column widths, status/type colors:
  - فاتورة → green `C6EFCE`; إشعار دائن → blue `D9E1F2`; إشعار مدين → amber `FFE699`;
    Invalid/Rejected/Cancelled → red `FFC7CE`.
- تفاصيل ("عرض") cell links to the invoice's line-item rows; الرابط الخارجى links to the
  portal share URL.

## R3 — Filtering

- Date range (from/to) with choice of **submission** (تاريخ التقديم) or **issue**
  (تاريخ الإصدار) date field; internal windowing ≤ 30 days.
- **Direction**: Both (default) / Received (وارد) / Sent (صادر).
- **Registration Number (RIN) filter**: documents where a specific RIN is the **sender**,
  the **receiver**, or **either side** — must actually filter (verified against the full
  document, not just the summary).
- Status filter (Valid/Invalid/Rejected/Cancelled/Submitted) and document type
  (invoice/credit note/debit note).

## R4 — Code usages export

- Export the taxpayer's registered item codes from
  `https://invoicing.eta.gov.eg/codeusages` (endpoint `codetypes/codes/my`) with optional
  code-type filter (EGS/GS1) and code/name search, as a single-sheet XLSX/CSV.

## R5 — Reliability & operations

- Pause / Resume / Cancel at any time; progress survives page refreshes (Resume).
- Session-expiry recovery (re-auth), rate-limit handling (`Retry-After`), 30-day windowing.
- Startup must never hang silently: every step logged, stale portal pages auto re-injected,
  clear timeout errors with actionable text.
- All collected data stored locally (chrome.storage), clearable from the popup.

## R6 — Diagnostics

- One-click **Copy debug report**: version, browser, run state, saved options, last 250
  runtime events, plus a **live API probe** (one real request captured shape-only) so any
  issue can be diagnosed from a single paste.

## R7 — Export formats

- XLSX (primary, styled) and CSV (fallback/light).
- Optional batch **PDF printout** download into `Downloads/ETA_PDFs/`.

## Non-goals

- No credential storage (uses the user's existing portal session).
- No modification of portal data (read-only API usage).
- No server component; everything stays on the user's machine.

## Open items / TODO

- [ ] Confirm the **Code usages** export end-to-end on the live portal (v1.3.0+; not yet
      confirmed by the user).
- [ ] تاريخ التقديم (received date) is empty in **RIN/search-mode** exports — the search
      endpoint does not return it. Option: enrich from a paired `/documents/recent` query.
- [ ] Pre-built PivotTable sheet (deferred — tables + helper columns cover grouping;
      user can insert a PivotTable in two clicks).
- [ ] Unit-name lookup (`UNITS` map in `mapping.js`) covers common GS1 codes only.
- [ ] Consider a PivotTable/date-hierarchy sheet if the user wants drill-down without
      manual insertion.
