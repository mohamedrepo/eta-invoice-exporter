# Conversation Digest — ETA eInvoicing Exporter

> Condensed, reusable knowledge from the original working session (2026-08-28 → 2026-09-11).
> This file is the index; the detailed knowledge lives in:
> [project-history.md](project-history.md) · [requirements.md](requirements.md) ·
> [decisions.md](decisions.md) · [troubleshooting.md](troubleshooting.md) ·
> [architecture.md](architecture.md)

## What this project is

A Chrome MV3 extension ("ETA eInvoicing Bulk Exporter") that bulk-downloads invoices,
line-item details, and registered item codes from the Egyptian Tax Authority portal
(<https://invoicing.eta.gov.eg>) **directly through the portal's internal API** (no DOM
scraping), and exports them to styled Excel/CSV files that mirror the user's reference
workbook layout.

- Repo: <https://github.com/mohamedrepo/eta-invoice-exporter> (private)
- Current version: **v1.3.1** (see [project-history.md](project-history.md))
- Install: `chrome://extensions` → Developer mode → Load unpacked → this folder

## How it was built (30-second version)

1. Reverse-engineered the portal's Angular bundle (`main.*.chunk.js`) to recover the exact
   internal API contract — gateway, endpoints, parameters, auth scheme.
2. Built the extension around that contract: MAIN-world request hooks capture the live
   `Authorization` header; the crawl engine pages the API; results stream to the service
   worker in chunks; an ExcelJS-based export window produces the final files.
3. Hardened through multiple debug-report-driven iterations (auth probing, RIN matching,
   startup reliability).

## Key facts at a glance

| Fact | Value |
|---|---|
| Gateway | `https://api-portal.invoicing.eta.gov.eg/` |
| API prefix | `/api/v1/` |
| Auth | `Authorization: Bearer <oidc-token>` (captured from the app's own requests) |
| OIDC authority | `https://id.eta.gov.eg/` |
| Documents list | `GET /api/v1/documents/recent?PageSize&PageNo&...` |
| RIN search | `GET /api/v1/documents/search?Query={rin}&...` (summaries lack ids — verify via details) |
| Document details | `GET /api/v1/documents/{uuid}/details` (fallback `/raw`) |
| PDF printout | `GET /api/v1/documents/{uuid}/pdf` |
| Codes (item codes) | `GET /api/v1/codetypes/codes/my?Ps&Pn&CodeTypeID&...` |
| Response shape | `{ result: [...], metadata: { totalPages, totalCount } }` |

## Critical lessons (details in troubleshooting.md)

- `/documents/recent` **ignores** `IssuerId`/`ReceiverId` — RIN filtering must use
  `/documents/search?Query=` plus client-side verification.
- Search-result summaries **lack `uuid`/`longId`/`issuerId`/`receiverId`** — extract IDs
  shape-agnostically (26-char pattern) and verify RIN on the **full document**.
- Document details must be fetched by **`uuid`** (the 40-char `longId` returns 404).
- After any extension update, a stale portal tab keeps dead scripts — the extension
  re-injects them automatically (epoch lifecycle).

## Open items

See the TODO list at the end of [requirements.md](requirements.md).
