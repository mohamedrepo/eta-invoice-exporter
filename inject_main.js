/*
 * inject_main.js — runs in the MAIN world on invoicing.eta.gov.eg at document_start.
 *
 * 1. Hooks fetch/XHR to capture the exact Authorization header the portal app uses
 *    (ground truth — no guessing about "Bearer " vs anything else).
 * 2. Discovers the OIDC access token in localStorage/sessionStorage as a fallback.
 * 3. Runs the crawl engine when the extension asks:
 *      - auth probe: candidate headers × credential modes × minimal URLs, with a
 *        full diagnostic matrix in the log when everything is rejected
 *      - list: GET /api/v1/documents/recent (PageSize/PageNo), parameter variants
 *        matching what the portal app itself sends (TimeCompliance ∈ {0,1,2},
 *        direction via DocumentTypeName/Direction/InvoiceDirection, Submission or
 *        Issue date windows), auto-selected by probing with zero-result awareness
 *      - details: GET /api/v1/documents/{uuid}/details (parallel workers)
 *    Maps everything to the reference Excel layout and streams batches out.
 */
(function () {
  'use strict';
  if (window.__ETA_EXPORTER_INJECTED) return;
  window.__ETA_EXPORTER_INJECTED = true;

  var API = 'https://api-portal.invoicing.eta.gov.eg/api/v1/';
  var M = window.__ETA_MAP;

  // ---------------- messaging ----------------
  function send(type, data) {
    try { window.postMessage({ __eta: 1, type: type, data: data }, location.origin); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var m = ev.data;
    if (!m || m.__eta !== 2) return;
    try { handleCommand(m); } catch (e) { send('ERROR', { message: (e && e.message) || String(e), fatal: true }); }
  });

  // ---------------- capture hooks ----------------
  var capturedAuth = null;
  var capturedHeaders = {};

  function noteHeaders(obj) {
    try {
      if (!obj) return;
      var entries = [];
      if (typeof Headers !== 'undefined' && obj instanceof Headers) { obj.forEach(function (v, k) { entries.push([k, v]); }); }
      else if (Array.isArray(obj)) { entries = obj; }
      else if (typeof obj === 'object') { entries = Object.keys(obj).map(function (k) { return [k, obj[k]]; }); }
      entries.forEach(function (e) {
        var k = String(e[0]).toLowerCase(), v = String(e[1]);
        if (!v) return;
        if (k === 'authorization') { if (capturedAuth !== v) { capturedAuth = v; send('AUTH', { auth: v, headers: capturedHeaders }); } return; }
        if (['content-length', 'host', 'cookie', 'origin', 'referer', 'user-agent', 'accept-encoding'].indexOf(k) !== -1) return;
        capturedHeaders[k] = v;
      });
    } catch (e) {}
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        var url = '';
        if (typeof input === 'string') url = input;
        else if (input && input.url) url = input.url;
        if (url.indexOf('/api/') !== -1) {
          noteHeaders(init && init.headers);
          if (input && typeof input === 'object' && input.headers) noteHeaders(input.headers);
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__etaReq = { url: String(url) }; } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      if (this.__etaReq && this.__etaReq.url.indexOf('/api/') !== -1) {
        var lk = String(k).toLowerCase();
        if (lk === 'authorization') { if (capturedAuth !== v) { capturedAuth = v; send('AUTH', { auth: v, headers: capturedHeaders }); } }
        else if (['content-length', 'host', 'cookie', 'origin', 'referer', 'user-agent', 'accept-encoding'].indexOf(lk) === -1) capturedHeaders[lk] = String(v);
      }
    } catch (e) {}
    return origSet.apply(this, arguments);
  };

  // ---------------- token discovery ----------------
  function findToken() {
    try {
      var stores = [localStorage, sessionStorage];
      for (var s = 0; s < stores.length; s++) {
        var store = stores[s];
        for (var i = 0; i < store.length; i++) {
          var k = store.key(i);
          if (k && k.toLowerCase().indexOf('oidc.user') !== -1) {
            try {
              var u = JSON.parse(store.getItem(k));
              if (u && u.access_token) return u.access_token;
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // ---------------- crawl engine ----------------
  var ctl = { running: false, pause: false, cancel: false };

  function handleCommand(m) {
    if (m.type === 'PING') {
      send('PONG', { token: !!findToken(), auth: !!capturedAuth, url: location.href });
      return;
    }
    if (m.type === 'START_CRAWL') {
      if (ctl.running) { send('ERROR', { message: 'ALREADY_RUNNING', fatal: true }); return; }
      runCrawl(m.data || {}).catch(function (e) {
        ctl.running = false;
        send('ERROR', { message: (e && e.message) || String(e), cancelled: !!(e && e.cancelled), fatal: !(e && e.cancelled) });
      });
      return;
    }
    if (m.type === 'PAUSE') ctl.pause = true;
    else if (m.type === 'RESUME') ctl.pause = false;
    else if (m.type === 'CANCEL') ctl.cancel = true;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitGate() {
    while (ctl.pause && !ctl.cancel) await sleep(400);
    if (ctl.cancel) { var e = new Error('CANCELLED'); e.cancelled = true; throw e; }
  }

  function buildHeaders(auth) {
    var h = {};
    Object.keys(capturedHeaders).forEach(function (k) { h[k] = capturedHeaders[k]; });
    h['Authorization'] = auth;
    h['Accept'] = 'text/plain';
    return h;
  }

  function describeAuth(a) {
    if (!a) return '(none)';
    var sp = a.indexOf(' ');
    var scheme = sp > 0 ? a.slice(0, sp) : a.slice(0, 3);
    return 'scheme "' + scheme + '", ' + a.length + ' chars'; // no token material
  }

  // credentials strategy: 'omit' avoids CORS-with-credentials failures when the
  // gateway replies Access-Control-Allow-Origin:*; remember whichever mode works.
  var credsMode = 'omit';
  async function doFetch(url, auth, creds) {
    return fetch(url, { headers: buildHeaders(auth), credentials: creds || credsMode });
  }
  async function fetchWithCredsFallback(url, auth) {
    try {
      return await doFetch(url, auth, credsMode);
    } catch (e) {
      var alt = credsMode === 'omit' ? 'include' : 'omit';
      var r = await doFetch(url, auth, alt);
      credsMode = alt;
      send('LOG', { message: 'Switched request credentials mode to "' + alt + '".' });
      return r;
    }
  }

  async function fetchJson(url, auth, tries) {
    var lastErr = null;
    var n = tries || 3;
    for (var i = 0; i < n; i++) {
      await waitGate();
      try {
        var r = await fetchWithCredsFallback(url, auth);
        if (r.status === 429) {
          var ra = parseInt(r.headers.get('retry-after') || '0', 10) || (2 * (i + 1));
          send('LOG', { message: 'Rate limited, waiting ' + ra + 's...' });
          await sleep(ra * 1000); continue;
        }
        if (r.status >= 500) { await sleep(800 * (i + 1)); continue; }
        var text = await r.text();
        var json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        return { ok: r.ok, status: r.status, json: json, text: text };
      } catch (e) {
        if (e.cancelled) throw e;
        lastErr = e;
        await sleep(700 * (i + 1));
      }
    }
    throw lastErr || new Error('FETCH_FAILED');
  }

  function recentUrl(o, pageNo, winFrom, winTo, variant, df, pass) {
    var p = new URLSearchParams();
    p.set('PageSize', String(o.pageSize || 100));
    p.set('PageNo', String(pageNo));
    if (o.status && o.status !== 'All') p.set('Status', o.status);
    if (o.docType && o.docType !== 'All') p.set('DocumentType', o.docType);
    if (pass && pass.rinParam && o.rin) p.set(pass.rinParam, o.rin);
    if (variant && variant.dirParam && o.direction && o.direction !== 'Both') p.set(variant.dirParam, o.direction);
    if (variant && variant.tc != null) p.set('TimeCompliance', String(variant.tc));
    var dp = df === 'Issue' ? ['IssueDateFrom', 'IssueDateTo'] : ['SubmissionDateFrom', 'SubmissionDateTo'];
    p.set(dp[0], winFrom.toISOString());
    p.set(dp[1], winTo.toISOString());
    return API + 'documents/recent?' + p.toString();
  }

  // Variant order mirrors what the portal app itself sends: TimeCompliance 0=All/1=OnTime/2=Late
  // (never negative), and the direction filter rides on DocumentTypeName ("Received"/"sent").
  // strict RIN match: IDs may be composite like "RN5W8FR51MKN (756158761)" and may be
  // zero-padded — compare complete digit runs with leading zeros stripped.
  function rinRuns(v) {
    var runs = String(v || '').match(/\d{3,}/g) || [];
    var norm = [];
    for (var i = 0; i < runs.length; i++) norm.push(runs[i].replace(/^0+/, ''));
    return norm;
  }
  function rinHit(v, target) { return rinRuns(v).indexOf(target) !== -1; }
  function rinRowMatches(s, rin, role) {
    var target = String(rin).replace(/^0+/, '');
    var hitIss = rinHit(s.issuerId, target), hitRec = rinHit(s.receiverId, target);
    if (role === 'issuer') return hitIss;
    if (role === 'receiver') return hitRec;
    return hitIss || hitRec;
  }
  // authoritative check against the full document (raw.issuer.id / raw.receiver.id)
  function rinDocMatches(raw, rin, role) {
    var target = String(rin).replace(/^0+/, '');
    var iss = raw.issuer || {}, rec = raw.receiver || {};
    var hitIss = rinHit(iss.id, target) || rinHit(iss.taxpayerId, target);
    var hitRec = rinHit(rec.id, target) || rinHit(rec.taxpayerId, target);
    if (role === 'issuer') return hitIss;
    if (role === 'receiver') return hitRec;
    return hitIss || hitRec;
  }
  function docTypeOkRaw(raw, o) {
    if (!o.docType || o.docType === 'All') return true;
    return String(raw.documentType || '').toLowerCase() === String(o.docType).toLowerCase();
  }

  function docTypeOk(s, o) {
    if (!o.docType || o.docType === 'All') return true;
    return String(s.typeName || '').toLowerCase() === String(o.docType).toLowerCase();
  }

  // Portal's own free-text search: Query matches RIN across issuer/receiver (works for any
  // counterparty on the logged-in session). Role filtering is done client-side above.
  function searchUrl(o, pageNo, winFrom, winTo, df) {
    var p = new URLSearchParams();
    p.set('Query', String(o.rin));
    p.set('Page', String(pageNo));
    p.set('PageSize', String(o.pageSize || 100));
    if (o.status && o.status !== 'All') p.set('Status', o.status);
    var dp = df === 'Issue' ? ['IssueDateFrom', 'IssueDateTo'] : ['SubmissionDateFrom', 'SubmissionDateTo'];
    p.set(dp[0], winFrom.toISOString());
    p.set(dp[1], winTo.toISOString());
    return API + 'documents/search?' + p.toString();
  }

  function variants(o) {
    var v = [];
    if (o.direction && o.direction !== 'Both') {
      v.push({ dirParam: 'DocumentTypeName', tc: 0 });
      v.push({ dirParam: 'Direction', tc: 0 });
      v.push({ dirParam: 'InvoiceDirection', tc: 0 });
      v.push({ dirParam: 'DocumentTypeName', tc: null });
      v.push({ dirParam: 'Direction', tc: null });
      v.push({ dirParam: null, tc: 0 });
      v.push({ dirParam: null, tc: null });
    } else {
      v.push({ dirParam: null, tc: 0 });
      v.push({ dirParam: null, tc: null });
    }
    return v;
  }

  function describeVariant(v, o) {
    var d = v.dirParam && o.direction && o.direction !== 'Both'
      ? v.dirParam + '=' + o.direction
      : 'no direction param';
    return d + ', TimeCompliance=' + (v.tc == null ? '(omitted)' : v.tc);
  }

  function makeWindows(from, to, days) {
    var out = [];
    var a = from.getTime();
    var step = Math.max(1, days) * 86400000;
    while (a <= to.getTime()) {
      var b = Math.min(a + step - 1, to.getTime());
      out.push([new Date(a), new Date(b)]);
      a = b + 1;
    }
    return out;
  }

  function extractDoc(j) {
    if (!j || typeof j !== 'object') return null;
    if (j.document && typeof j.document === 'object') return j.document;
    if (j.result && typeof j.result === 'object' && !Array.isArray(j.result)) return j.result;
    if (j.invoiceLines || j.documentLines || j.issuer) return j;
    if (Array.isArray(j) && j.length && (j[0].invoiceLines || j[0].documentLines || j[0].issuer)) return j[0];
    return j;
  }

  // Auth probe: candidate headers × credential modes × minimal URLs.
  // Any response that is not 401/403 proves the auth is accepted (even 400/404),
  // because those come from the server AFTER authentication.
  async function reauth(cands) {
    var urls = [
      API + 'documents/recent?PageSize=1&PageNo=1',
      API + 'documents/recent?PageSize=1&PageNo=1&TimeCompliance=0'
    ];
    var modes = ['omit', 'include'];
    var report = [];
    for (var i = 0; i < cands.length; i++) {
      for (var m = 0; m < modes.length; m++) {
        for (var v = 0; v < urls.length; v++) {
          try {
            var r = await doFetch(urls[v], cands[i], modes[m]);
            report.push('hdr#' + (i + 1) + '/' + modes[m] + '/v' + (v + 1) + '→' + r.status);
            if (r.status !== 401 && r.status !== 403) {
              credsMode = modes[m];
              send('AUTH', { auth: cands[i], headers: capturedHeaders });
              send('LOG', { message: 'Auth OK — candidate #' + (i + 1) + ' (' + describeAuth(cands[i]) + '), credentials:' + modes[m] + ' → HTTP ' + r.status });
              return cands[i];
            }
          } catch (e) {
            report.push('hdr#' + (i + 1) + '/' + modes[m] + '/v' + (v + 1) + '→ERR');
          }
        }
      }
    }
    send('LOG', { message: 'Auth probe matrix: ' + report.join(' | ') });
    return null;
  }

  // List-parameter probe on the first window: pick the variant that actually returns
  // rows. Zero-result "working" variants are remembered as fallback; if every variant
  // returns zero rows, the alternate date field (Submission ↔ Issue) is tried too.
  async function probeList(opt, wa, wb, cands, authHolder, pass) {
    var vlist = variants(opt);
    var firstOk = null, winner = null;
    var tried = [];
    async function attempt(df) {
      for (var vi = 0; vi < vlist.length; vi++) {
        await waitGate();
        var url = recentUrl(opt, 1, wa, wb, vlist[vi], df, pass);
        var res = await fetchJson(url, authHolder.auth, 2);
        if (res.status === 401 || res.status === 403) {
          authHolder.auth = await reauth(cands);
          if (!authHolder.auth) throw new Error('SESSION_EXPIRED: portal rejected every auth candidate. Refresh the portal page (F5), make sure your documents list shows normally, then press Start again.');
          res = await fetchJson(url, authHolder.auth, 2);
        }
        var tc = res.json && res.json.metadata ? (res.json.metadata.totalCount | 0) : 0;
        if (res.ok && tc > 0) { winner = { v: vlist[vi], df: df, res: res }; return; }
        if (res.ok && !firstOk) { firstOk = { v: vlist[vi], df: df, res: res }; tried.push(describeVariant(vlist[vi], opt) + ' [' + df + ']→0 rows'); continue; }
        tried.push(describeVariant(vlist[vi], opt) + ' [' + df + ']→HTTP ' + res.status);
      }
    }
    await attempt(opt.dateField === 'Issue' ? 'Issue' : 'Submission');
    if (!winner) {
      var alt = opt.dateField === 'Issue' ? 'Submission' : 'Issue';
      send('LOG', { message: 'No rows with ' + opt.dateField + ' dates — retrying variants with ' + alt + ' dates...' });
      await attempt(alt);
    }
    if (!winner && firstOk) winner = firstOk;
    if (!winner) throw new Error('API_PROBE_FAILED — all parameter variants rejected: ' + tried.slice(0, 6).join(' | '));
    send('LOG', { message: 'API params locked: ' + describeVariant(winner.v, opt) + ', dates: ' + winner.df + '.' });
    return { variant: winner.v, dateField: winner.df, first: winner.res };
  }

  async function runCrawl(opt) {
    ctl.running = true; ctl.pause = false; ctl.cancel = false;
    var t0 = Date.now();
    send('PROGRESS', { phase: 'auth' });

    var token = findToken();
    var cands = [];
    if (capturedAuth) cands.push(capturedAuth);
    if (token) { cands.push('Bearer ' + token); cands.push(token); cands.push('***' + token); }
    if (!cands.length) { ctl.running = false; throw new Error('NOT_LOGGED_IN: open invoicing.eta.gov.eg, log in, then try again.'); }
    var authHolder = { auth: await reauth(cands) };
    if (!authHolder.auth) {
      ctl.running = false;
      throw new Error('SESSION_EXPIRED: the portal rejected every auth candidate (see the log for the probe matrix). Refresh the portal page (F5) so the app issues a fresh token, then press Start again.');
    }
    var auth = authHolder.auth;

    var from = new Date(opt.from + 'T00:00:00');
    var to = new Date(opt.to + 'T23:59:59.999');
    var effWindowDays = parseInt(opt.windowDays, 10) || 30;
    if (String(opt.rin || '').trim()) effWindowDays = Math.min(effWindowDays, 30); // search API max span
    var wins = makeWindows(from, to, effWindowDays);

    var summaries = [];
    var seen = new Set();
    var detailErrors = 0;
    var rinDropped = 0, emitted = 0, searchLogDone = false;
    var needDetails = opt.includeDetails || !!rin; // RIN verification needs full documents
    var skip = new Set(opt.skipUuids || []);

    send('PROGRESS', { phase: 'list', window: 0, windows: wins.length, page: 0, pages: '?', listed: 0 });

    var variant = null, dfUsed = opt.dateField === 'Issue' ? 'Issue' : 'Submission';

    // Registration-number filter: the /recent endpoint ignores IssuerId/ReceiverId on this
    // gateway, so RIN filtering uses the portal's own /documents/search?Query= endpoint with
    // strict client-side matching on issuerId/receiverId (exact digits).
    var passes = [];
    var rin = String(opt.rin || '').trim();
    if (rin) passes.push({ searchMode: true, label: 'search Query=' + rin });
    else passes.push({ rinParam: null, label: 'all parties' });

    for (var pi = 0; pi < passes.length; pi++) {
      var pass = passes[pi];
      if (pass.searchMode) send('LOG', { message: 'Searching documents for RIN ' + rin + ' (strict match, role: ' + (opt.rinRole || 'any') + ')...' });
      else if (passes.length > 1) send('LOG', { message: 'Pass ' + (pi + 1) + '/' + passes.length + ': documents where ' + rin + ' is the ' + pass.label + '...' });
      for (var wi = 0; wi < wins.length; wi++) {
      var wa = wins[wi][0], wb = wins[wi][1];
      var pageNo = 1, totalPages = 1, empty = false;
      while (pageNo <= totalPages && !empty) {
        await waitGate();
        var res;
        var url = pass.searchMode
          ? searchUrl(opt, pageNo, wa, wb, dfUsed)
          : recentUrl(opt, pageNo, wa, wb, variant, dfUsed, pass);
        if (pi === 0 && wi === 0 && pageNo === 1 && !variant && !pass.searchMode) {
          var probe = await probeList(opt, wa, wb, cands, authHolder, pass);
          variant = probe.variant; dfUsed = probe.dateField; auth = authHolder.auth; res = probe.first;
        } else {
          res = await fetchJson(url, auth);
          if (res.status === 401 || res.status === 403) {
            authHolder.auth = await reauth(cands);
            if (!authHolder.auth) throw new Error('SESSION_EXPIRED');
            auth = authHolder.auth;
            res = await fetchJson(url, auth);
          }
        }
        if (!res.ok) throw new Error('API_HTTP_' + res.status + ': ' + String(res.text || '').slice(0, 180));
        var j = res.json || {};
        var rowsArr = j.result || j.documents || (Array.isArray(j) ? j : []);
        var md = j.metadata || {};
        if (md.totalPages) totalPages = md.totalPages;
        else if (md.totalCount) totalPages = Math.max(totalPages, Math.ceil((md.totalCount | 0) / (parseInt(opt.pageSize, 10) || 100)));
        var rawLen = rowsArr.length;
        if (pass.searchMode) {
          // search summaries are fuzzy candidates; the RIN check happens on the full document
          if (!searchLogDone) {
            searchLogDone = true;
            send('LOG', { message: 'Search found ' + rawLen + ' candidate(s) for RIN ' + rin + ' — verifying each via document details...' });
          }
          if (rawLen === 0) { empty = true; break; } // page beyond available results
        }
        if (!rowsArr.length) {
          if (!pass.searchMode) { empty = true; break; }
          // search mode: later pages may still contain matches — page through metadata.totalPages
          if (pageNo >= totalPages) { empty = true; break; }
          pageNo++;
          continue;
        }
        for (var ri = 0; ri < rowsArr.length; ri++) {
          var s = rowsArr[ri];
          var key = s.longId || s.uuid;
          if (key && !seen.has(key)) { seen.add(key); summaries.push(s); }
        }
        send('PROGRESS', { phase: 'list', pass: pi + 1, passes: passes.length, window: wi + 1, windows: wins.length, page: pageNo, pages: totalPages, listed: summaries.length });
        if (opt.maxDocs && summaries.length >= opt.maxDocs) { break; }
        pageNo++;
      }
      if (opt.maxDocs && summaries.length >= opt.maxDocs) break;
      }
    }

    if (rin && !opt.includeDetails) send('LOG', { message: 'RIN filtering verifies each document via its details — fetching details for all candidates.' });
    if (!needDetails) {
      var acc = [], accK = [];
      for (var si = 0; si < summaries.length; si++) {
        await waitGate();
        var sKey = summaries[si].uuid || summaries[si].longId;
        if (skip.has(sKey)) continue; // already exported in a previous run — no duplicates on Resume
        acc.push(M.mapInvoice(summaries[si], null, si + 1));
        accK.push(sKey);
        if (acc.length >= 200) { send('BATCH', { rows: acc, itemRows: [], keys: accK }); acc = []; accK = []; }
      }
      if (acc.length) send('BATCH', { rows: acc, itemRows: [], keys: accK });
      ctl.running = false;
      send('DONE', { docs: summaries.length, items: 0, elapsedMs: Date.now() - t0 });
      return;
    }

    // ---- details phase ----
    send('PROGRESS', { phase: 'details', detailsDone: 0, detailsTotal: summaries.length, listed: summaries.length, errors: 0 });
    var idx = 0, doneD = 0, itemsCount = 0;
    var accRows = [], accItems = [], accKeys = [];
    var detailKeyField = null; // 'uuid' or 'longId' — remembered once one works

    function diagDoc(doc, idf) {
      try {
        var keys = Object.keys(doc).slice(0, 18).join(',');
        var lines = doc.invoiceLines || doc.documentLines;
        send('LOG', { message: 'First details OK (' + idf + ') — fields: ' + keys + ' | lines: ' + (Array.isArray(lines) ? lines.length : 'none') });
      } catch (e) {}
    }

    async function fetchDetails(s) {
      var ids = [];
      if (s.uuid) ids.push(['uuid', s.uuid]);
      if (s.longId) ids.push(['longId', s.longId]);
      if (detailKeyField) ids.sort(function (x, y) { return (x[0] === detailKeyField ? -1 : 1) - (y[0] === detailKeyField ? -1 : 1); });
      for (var i = 0; i < ids.length; i++) {
        var idf = ids[i][0], idv = ids[i][1];
        var res = await fetchJson(API + 'documents/' + encodeURIComponent(idv) + '/details', auth);
        if (res.status === 401 || res.status === 403) {
          authHolder.auth = await reauth(cands);
          if (!authHolder.auth) throw new Error('SESSION_EXPIRED');
          auth = authHolder.auth;
          res = await fetchJson(API + 'documents/' + encodeURIComponent(idv) + '/details', auth);
        }
        if (res.ok && res.json) {
          var doc = extractDoc(res.json);
          if (doc && (doc.invoiceLines || doc.documentLines || doc.issuer || doc.internalID)) {
            if (!detailKeyField) { detailKeyField = idf; diagDoc(doc, idf); }
            return doc;
          }
        }
        if (res.status !== 404 && res.status !== 400) {
          // non-404 failure: try the raw endpoint once with the same id
          var r2 = await fetchJson(API + 'documents/' + encodeURIComponent(idv) + '/raw', auth, 2);
          if (r2.ok && r2.json) {
            var d2 = extractDoc(r2.json);
            if (d2) { if (!detailKeyField) { detailKeyField = idf; diagDoc(d2, idf); } return d2; }
          }
          return null;
        }
        // 404/400 → try the next identifier
      }
      return null;
    }

    async function worker() {
      while (true) {
        var i = idx++;
        if (i >= summaries.length) break;
        await waitGate();
        var s = summaries[i];
        var key = s.uuid || s.longId;
        if (!skip.has(key)) {
          var raw = null;
          try { raw = await fetchDetails(s); }
          catch (e) {
            if (e.cancelled || e.message === 'SESSION_EXPIRED') throw e;
            raw = null;
          }
          if (!raw) {
            detailErrors++;
            if (detailErrors === 1) send('LOG', { message: 'No details returned for ' + key + ' — exporting summary row only (errors counter will include these).' });
          }
          var emit = true;
          if (rin) {
            if (raw) emit = rinDocMatches(raw, rin, opt.rinRole) && docTypeOkRaw(raw, opt);
            else emit = rinRowMatches(s, rin, opt.rinRole) && docTypeOk(s, opt); // details failed — best effort
            if (!emit) {
              rinDropped++;
              if (rinDropped === 1) {
                try {
                  send('LOG', { message: 'First non-match dropped: ' + key + ' issuer=' + JSON.stringify(raw && raw.issuer || null).slice(0, 160) + ' receiver=' + JSON.stringify(raw && raw.receiver || null).slice(0, 160) });
                } catch (e2) {}
              }
            }
          }
          if (emit) {
            emitted++;
            accRows.push(M.mapInvoice(s, raw, emitted));
            var items = M.mapLines(s, raw);
            for (var it = 0; it < items.length; it++) accItems.push(items[it]);
            itemsCount += items.length;
            accKeys.push(key);
            if (accRows.length >= 40) {
              send('BATCH', { rows: accRows, itemRows: accItems, keys: accKeys });
              accRows = []; accItems = []; accKeys = [];
            }
          }
        }
        doneD++;
        if (doneD % 20 === 0 || doneD === summaries.length) {
          send('PROGRESS', { phase: 'details', detailsDone: doneD, detailsTotal: summaries.length, listed: summaries.length, errors: detailErrors, items: itemsCount, matched: emitted, dropped: rinDropped });
        }
      }
    }

    var conc = Math.max(1, Math.min(12, parseInt(opt.concurrency, 10) || 6));
    var workers = [];
    for (var w = 0; w < conc; w++) workers.push(worker());
    await Promise.all(workers);
    if (accRows.length) send('BATCH', { rows: accRows, itemRows: accItems, keys: accKeys });
    if (rin && emitted === 0 && summaries.length) {
      try {
        send('LOG', { message: 'No candidate matched RIN ' + rin + ' — first candidate as returned by search: ' + JSON.stringify(summaries[0]).slice(0, 500) });
        send('LOG', { message: 'If this looks wrong, use "Copy debug report" — it now includes a live API probe of the search response.' });
      } catch (e) {}
    }

    ctl.running = false;
    send('DONE', { docs: emitted, scanned: summaries.length, items: itemsCount, elapsedMs: Date.now() - t0, errors: detailErrors, dropped: rinDropped });
  }
})();
