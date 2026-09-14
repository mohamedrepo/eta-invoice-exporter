# Troubleshooting — ETA eInvoicing Exporter

Every error/fix cycle from the project, plus diagnostics. Newest issues last.

## T1 — `SESSION_EXPIRED` on every Start (v1.0.x era)

**Symptom:** Start failed immediately even though "Check connection" showed token + captured
auth header.
**Root cause:** the auth probe used `TimeCompliance=-1` — an out-of-domain value (valid enum:
0=All, 1=OnTime, 2=Late per the portal bundle). Combined with `credentials:include`, the
gateway rejected the probe and the old code read any rejection as "session expired".
**Fix:** probe without optional params first, try `TimeCompliance` 0/omitted, try both
credential modes, and log the full probe matrix (candidate × credentials × URL → HTTP status).
**Lesson:** never infer "expired" from a rejected probe without logging every attempt.

## T2 — "Search page 1: 37 results, 0 exactly match RIN …" (v1.2.3)

**Symptom:** RIN export produced 3,512 rows, only 53 relevant.
**Root cause:** `/documents/recent` silently ignores `IssuerId`/`ReceiverId` — the filter
never reached the server, and the variant probe saw "results" and proceeded.
**Fix:** RIN mode switched to `/documents/search?Query={rin}` with strict client-side
verification (see decisions D4).

## T3 — "Search page 1: 37 results, 0 exactly match" (v1.2.5, second form)

**Symptom:** same log line, still zero matches — but this time `scanned: 0` in the DONE
payload: the summaries array was empty.
**Root cause:** `/documents/search` rows carry **no `uuid`/`longId` fields** — the key
extraction (`s.uuid || s.longId`) skipped all 37 candidates before details could be fetched.
**Fix:** shape-agnostic ID extraction (26-char `[A-Z0-9]` scan across the row, D6) and
multi-candidate details attempts (D5).

## T4 — Empty "بيانات الفواتير" sheet (v1.2.4 and earlier)

**Symptom:** invoice sheet exported but the line-items sheet was empty; totals/taxes/address
columns empty in sheet 1.
**Root cause:** details fetched with the 40-char `longId` → 404 → silent `raw = null`.
**Fix:** `uuid`-first with fallback chain (D5) + diagnostics that log the first successful
details field names and line count.

## T5 — `waitRelayReady is not defined` (v1.2.9/v1.3.0)

**Symptom:** Start/RESUME crashed immediately.
**Root cause:** two partial patch applications: `ensureRelay` replaced the `waitRelayReady`
helper, but the START/RESUME call sites still referenced it (and in one state the file had a
duplicate `let runGen`).
**Fix (v1.3.1):** both call sites rewritten; generation guard completed.
**Lesson:** multi-edit patches must be atomic per file — write only after every anchor
matched (the Python patch scripts now assert all anchors before writing).

## T6 — Startup appears to hang (v1.2.8, user report 2026-09-10)

**Symptom:** `running: true`, `progress: {}`, no events after START.
**Root cause:** the crawl waits up to 60 s for the portal page's relay; a stale portal tab
(after an extension update) never responds, and nothing was logged meanwhile.
**Fix (v1.3.1):** every startup step logged, 25 s budget, auto re-injection of scripts into
the page, clear error naming the exact remediation (F5).

## T7 — Cleared Registration Number reappears (v1.2.8 report)

**Symptom:** clearing the RIN field restored the old value within ~1 s.
**Root cause:** the popup re-applied saved options on every 1.2 s refresh.
**Fix:** saved options restored once per popup open; edits persisted live (debounced);
Direction default migrated to Both.

## T8 — Filter rows duplicated on Resume (list-only exports)

**Symptom:** resuming a details-less export re-emitted every row.
**Root cause:** list-only batches sent `keys: []`, so the seen-set never grew.
**Fix:** list-only mode emits each row's document key; Resume skips flushed documents.

## T9 — Modern workbook: dates in the wrong column (builder)

**Symptom:** verification found 'Valid' in the تاريخ الإصدار column of
`eInvoices_Modern_2026.xlsx`.
**Root cause:** builder used date indices (4,5) — but الحالة is idx 4 and the dates are
idx 5/6 (and تاريخ التقديم is empty by source limitation).
**Fix:** corrected to (5,6,55) / (4,5,61); helpers derive from تاريخ الإصدار (idx 5).

## T10 — Modern workbook: T% column formats missing on empty cells

**Symptom:** a T1% cell with no value had format "General" instead of `0"%"`.
**Fix:** builder now assigns the column format to every cell in money/%/quantity columns,
empty or not.

## Standing diagnostics (how to debug any new issue)

1. Popup → **Copy debug report** — includes version, options, run state, last 250 events
   (auth probe matrix, per-page progress, errors), and a **live API probe**: one real search
   request executed inside the portal tab (with the session) whose status, metadata, row
   count, and first-row field names/values are captured shape-only.
2. In RIN mode the crawler logs `First candidate as returned: {…}` — the exact summary row.
3. On details failures it logs the first dropped candidate's `issuer`/`receiver` JSON.

## Known limitations (not bugs)

- تاريخ التقديم is empty in **RIN/search-mode** exports — the search endpoint does not
  return the received date (full-range `/documents/recent` exports do include it).
- Token material never appears in logs: diagnostics record only the auth scheme and length.
- Codes export headers come from the API response keys (Arabic labels mapped where known —
  `CODE_LABELS` in `inject_main.js`); unknown keys appear as their raw field names.
