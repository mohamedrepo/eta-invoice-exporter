# Decisions — ETA eInvoicing Exporter

Technical decisions made during the session, with rationale. Each entry: decision → why →
consequence.

## D1 — Direct API replay, not DOM scraping

**Decision:** crawl the portal's internal REST API instead of scraping rendered pages.
**Why:** the reference tool was page-by-page (3,487 pages pending in its dialog); the API
returns 100 invoices/request and structured JSON.
**Consequence:** the extension must know (and track) the API contract — captured in
[architecture.md](architecture.md) — and auth must be replayed from the user's session.

## D2 — Auth = capture the app's own header, don't guess

**Decision:** hook `fetch`/`XHR` in the MAIN world at document start and record the exact
`Authorization` header the portal app sends; fall back to the OIDC token from
`localStorage`/`sessionStorage` (`oidc.user:…`, authority `https://id.eta.gov.eg`).
**Why:** the bundle showed a suspicious literal (`Authorization:"***".concat(token)`) —
instead of guessing the scheme, capture ground truth at runtime and keep a candidate list
(`captured header` → `Bearer <token>` → `<token>` → `***<token>`), tried × credential modes
(`omit`/`include`) × minimal URLs, with a full probe matrix logged on failure.
**Consequence:** no stored passwords; works with the user's live session; auth problems are
visible in the debug report (see [troubleshooting.md](troubleshooting.md)).

## D3 — Documents list = `/documents/recent` with variant probing

**Decision:** page `GET /api/v1/documents/recent?PageSize=&PageNo=&…` and probe parameter
variants on the first request (direction via `DocumentTypeName`/`Direction`/
`InvoiceDirection`; `TimeCompliance` ∈ {0, omitted} — never negative; submission vs issue
dates auto-switched when a window returns zero rows).
**Why:** the parameters were recovered from the app's own calls; the server silently ignores
unknown ones, so zero-result awareness + alternates avoid silent mis-filtering.
**Consequence:** variants are locked once per run and logged ("API params locked: …").

## D4 — RIN filtering via `/documents/search?Query=` + full-document verification

**Decision:** RIN mode ignores `/documents/recent`'s `IssuerId`/`ReceiverId` params (the
gateway silently ignores them — proven by a 3,512-row export with only 53 relevant rows).
Instead: `documents/search?Query={rin}` returns candidates; each candidate's **full document**
is fetched and verified against `raw.issuer.id` / `raw.receiver.id` (digit-run match,
leading-zero tolerant, composite values like `"RN5W8FR51MKN (756158761)"` handled).
**Why:** search summaries don't carry matchable id fields; the raw document is authoritative.
**Consequence:** a RIN filter forces the details phase; scanned/matched/dropped counters are
shown in progress and the debug report.

## D5 — Document identity: `uuid` first, `longId` as fallback

**Decision:** fetch details with the 26-char `uuid`; treat the 40-char `longId`
(`…M10X87JqZ…`) as a display/link value only.
**Why:** calling `/documents/{longId}/details` returns 404 for every document (the cause of
the empty line-items sheet in v1.2.4 and earlier).
**Consequence:** details lookups try `uuid` → `longId` (and any 26-char id found in the row)
until one works; the winner is cached for the run.

## D6 — Search rows are shape-agnostic

**Decision:** never assume field names in search-result rows. Extract IDs by scanning the
whole row for ETA's 26-char uppercase-alphanumeric pattern; emit the first raw row verbatim
into the log; derive export headers from the row's own keys.
**Why:** search summaries carry **no** `uuid`/`longId`/`issuerId`/`receiverId` fields
(v1.2.7's finding), and assuming names silently dropped every candidate.
**Consequence:** unknown future shapes produce a visible diagnostic instead of empty output.

## D7 — ExcelJS for exports; SheetJS removed

**Decision:** generate XLSX with bundled ExcelJS (`vendor/exceljs.min.js`), removed SheetJS.
**Why:** the reference workbook's look needs real styling (fills, borders, hyperlinks, RTL,
freeze panes) — SheetJS Community cannot write cell styles.
**Consequence:** vendor bundle in the repo; no CDN dependency; package shrunk by ~950 KB
when SheetJS was dropped.

## D8 — Original visual identity over the design system

**Decision:** export styling replicates the user's reference workbook (status/type colors
`C6EFCE`/`D9E1F2`/`FFE699`/`FFC7CE`, thin borders, Calibri 11, original column widths,
plain headers upgraded to bold + subtle fill), implemented as direct cell fills plus
conditional-formatting where useful.
**Why:** explicit user requirement; skill guidance "Preserve & Match" overrides default
design tokens.
**Consequence:** duplicate Arabic headers were suffixed with their T-code
(e.g. ضريبة الدمغة النسبية (T5)) — required because Excel Tables demand unique column names.

## D9 — Content-script lifecycle by per-execution epochs

**Decision:** every injection of `inject_main.js`/`relay.js` stamps `Date.now()` into
`window.__ETA_EPOCH` / `window.__ETA_RELAY_EPOCH`; handlers ignore messages when the window
epoch differs from their own.
**Why:** after an extension reload, a stale portal tab keeps dead scripts; the background
auto re-injects fresh ones, and the epoch makes the old copies inert instead of
double-crawling.
**Consequence:** the background can re-inject scripts programmatically
(`ensureRelay`) — stale tabs recover without a manual F5.

## D10 — Race-guarded startups (run generation)

**Decision:** every START/RESUME increments `runGen`; CANCEL/CLEAR increments it too; any
in-flight startup whose generation is stale may not mutate run state.
**Why:** Cancel followed by Start used to leave the first startup's 60 s wait running, which
could overwrite the newer run's state.
**Consequence:** superseded startups return early with `note: 'superseded'`.

## D11 — Startup transparency

**Decision:** log every startup step (tab lookup, page wait, ready, command sent) and cap
the relay wait at 25 s with an actionable error; drop the silent 60 s wait.
**Why:** the user's first startup-hang report showed an empty progress and no events.
**Consequence:** hangs are impossible to miss; the debug report shows exactly which step
failed.

## D12 — Chunked local storage with resume

**Decision:** collected rows stream to `chrome.storage.local` in append-only chunks
(`eta_rows_c*`, `eta_items_c*`, `eta_seen_c*`) plus `eta_meta`; Resume rebuilds the skip set
from the stored keys.
**Why:** service workers can die mid-crawl; chunked appends survive restarts without O(n²)
rewrites.
**Consequence:** Resume re-lists (fast) and skips documents whose rows were already flushed.

## D13 — Direction defaults to Both; options never revert

**Decision:** Direction default = Both (one-time migration of saved options); saved options
are restored **once** per popup open, and edits persist live (debounced).
**Why:** the popup's 1.2 s refresh used to re-apply saved options over the user's edits —
a cleared RIN resurrected itself (user-reported).
**Consequence:** clearing any field stays cleared.

## D14 — Document-type codes are Arabic-mapped in exports

**Decision:** `i/c/d/ii/ei/ec/ed` map to فاتورة / إشعار دائن / إشعار مدين / … in export rows;
status colors follow type (green/blue/amber) with red overriding for non-valid statuses.
**Why:** mirrors the reference workbook's coloring rule exactly.
**Consequence:** conditional formatting and direct fills agree; see
[architecture.md](architecture.md) for the exact palette.
