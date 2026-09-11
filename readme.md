# ETA eInvoicing Bulk Exporter (Chrome Extension)

> **Download:** get the ready-to-load ZIP from the [latest release](https://github.com/mohamedrepo/eta-invoice-exporter/releases/latest) - no build step needed.

Downloads **all invoices + full details** from the Egyptian Tax Authority portal
(<https://invoicing.eta.gov.eg/documents>) **directly through the portal's internal API** -
no slow page-by-page scraping - and produces an Excel file with the same two-sheet layout as
the reference file (`eInvoices_2025-2026.xlsx`):

- Sheet **جميع الفواتير** - one row per invoice (58 columns)
- Sheet **بيانات الفواتير** - one row per invoice line item (64 columns)

---

## 1. Install (Load unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this `eta-invoice-exporter` folder
4. Pin the extension to the toolbar

Requirements: Chrome 111+ (Edge also works via `edge://extensions`).

## 2. Use

1. Open <https://invoicing.eta.gov.eg> and **log in** as usual (the extension uses your
   existing session - it never sees or stores your password).
2. Click the extension icon. Check the three indicators: **Portal tab**, **Auth token**,
   **Data collected**. Press **Check connection** to verify.
3. **Choose the export type** at the top of the popup:
   - **الفواتير — Documents**: invoices + line items (everything below applies).
   - **الأكواد — Code usages**: your registered item codes from
     <https://invoicing.eta.gov.eg/codeusages> via `codetypes/codes/my` — optional code-type
     filter (EGS/GS1) and a code/name search; exports a single-sheet XLSX/CSV with all fields
     the portal returns. Document filters (dates/direction/status/RIN) are hidden in this mode.
4. Then choose filters (Documents mode only):

   - **From / To** - date range (30-day windows are used internally, matching API limits)
   - **Date field** - filter by submission date (تاريخ التقديم) or issue date (تاريخ الإصدار)
   - **Direction** - Both (default) / Received (وارد) / Sent (صادر)
   - **Registration number** - extract only documents where a specific RIN (e.g. `756158761`)
     is the **sender**, the **receiver**, or **either side**. Implemented on the portal's own
     search endpoint (`documents/search?Query=...`) with **strict client-side matching**: only
     rows whose issuer/receiver ID contains the RIN as an exact ID are kept - the portal's
     fuzzy name matches are excluded. Leave empty for all parties.
   - **Status / Document type** - optional filters
   - **Detail workers** - parallel requests for per-invoice details (6 is polite and fast)
   - **Max documents** - safety cap; `0` = everything in the range
4. Press **Start export**. Progress shows listing → details phases. You can **Pause/Resume/Cancel**.
5. When finished, press **Export .xlsx** (recommended) or **Export CSV**.
   The .xlsx mirrors the reference workbook's look: RTL sheets, frozen header row,
   thin borders, Calibri 11, exact column widths, and status/type colors -
   green invoices (فاتورة), blue credit notes (اشعار دائن), amber debit notes
   (اشعار مدين), red for Invalid/Rejected/Cancelled. تفاصيل (عرض) jumps to the
   invoice's line items; الرابط الخارجى opens the portal share link.
6. Optional: **Download PDFs...** to save the official PDF printouts of the collected invoices
   into `Downloads/ETA_PDFs/`.

> **Upgrading note:** data collected by v1.0.x lacks details (that was the bug fixed in
> v1.1.0 - details are now fetched by `uuid`). After updating, press **Start** (fresh)
> rather than Resume so everything is re-fetched with details.

## 3. How it works (the "direct API" part)

Everything was reverse-engineered from the portal's own JavaScript bundle:

| Purpose | Endpoint (GET) |
|---|---|
| Invoice list (paginated) | `https://api-portal.invoicing.eta.gov.eg/api/v1/documents/recent?PageSize=100&PageNo=N&SubmissionDateFrom=...&SubmissionDateTo=...&Direction=Received&IssuerId=...&ReceiverId=...&...` |
| Full document details | `https://api-portal.invoicing.eta.gov.eg/api/v1/documents/{uuid}/details` (fallback `{uuid}/raw`) |
| PDF printout | `https://api-portal.invoicing.eta.gov.eg/api/v1/documents/{uuid}/pdf` |
| Response shape | `{ result: DocumentSummary[], metadata: { totalPages, totalCount } }` |

Authentication: the extension captures the **exact `Authorization` header the portal app
itself sends** (hooked at page startup) and falls back to the OIDC access token stored by
the portal (`oidc.user:...` key, authority `https://id.eta.gov.eg`). All requests run **inside
the portal tab** (page context), so cookies/headers behave exactly like the real app.

Speed: the reference tool exported 3,487 pages manually. This extension pages the API at
100 invoices/request and fetches details with parallel workers - a full year (~43k invoices)
is mostly bound by the details phase, which runs 6× concurrent.

## 4. Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, permissions, content scripts |
| `mapping.js` | Shared mapping: API JSON → the reference Excel's 58/64-column layout |
| `inject_main.js` | Page-context engine: header capture, token discovery, crawl loop |
| `relay.js` | Bridge between the page (MAIN world) and the extension |
| `background.js` | Service worker: state, chunked storage, tab orchestration |
| `popup.html/js` | Filter UI, progress, buttons |
| `export.html/js` | Builds the styled .xlsx (ExcelJS, bundled offline in `vendor/`) or CSVs |

## 5. Modify

- **Columns / Arabic headers** → `mapping.js` (`HEADERS1`, `HEADERS2`, tax-code column pairs)
- **API filters/params** → `inject_main.js` (`recentUrl()`, `variants()` - auto-adapts
  `Direction` vs `InvoiceDirection` and `TimeCompliance` if the API rejects defaults)
- **Export layout/format** → `export.js`
- **Default filter values** → top of `popup.js` (`DEFAULTS`)

## 6. Troubleshooting

- **Anything acting weird?** Press **Copy debug report** in the popup - it puts a full
  diagnostic snapshot (version, options, run state, last 250 events) on your clipboard.
  Paste it into a support chat and the problem can be diagnosed from it directly.

- **"NOT_LOGGED_IN / Auth token red"** - open the portal and log in, then press
  **Check connection** (the token is picked up automatically; no need to restart the export... but a fresh Start is cleanest).
- **"SESSION_EXPIRED"** - the portal rejected every auth candidate. **Refresh the portal page (F5)** so the app issues a fresh token, confirm the documents list opens normally, then press **Start** again. The log now shows the full auth probe matrix (each candidate × credentials mode × HTTP status); if every row shows 401/403 even after a refresh, log out and back in on the portal.
- **Interrupted (browser/tab closed)** - press **Resume**; already-fetched invoices are skipped.
- **Zero results** - double-check Direction (Received vs Sent) and the date range; try **Check connection**, then Direction = Both to sanity-check.
- **Rate limiting** - the extension honors `Retry-After` automatically; lower *Detail workers* if you see many waits.
- **Large exports** - ~43k invoices ≈ 43k detail requests; expect roughly 30-90 min depending on the connection. Use **Pause** freely. CSV export is lighter than XLSX for very large ranges.

## 7. Privacy & scope

- Runs only on `invoicing.eta.gov.eg` and its API host `api-portal.invoicing.eta.gov.eg`.
- Stores collected data only in the extension's local storage on your machine.
- Sends nothing anywhere except the ETA portal itself, using your own session.
