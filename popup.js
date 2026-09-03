/* popup.js — UI controller. */
'use strict';

const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  from: '2025-07-01', to: new Date().toISOString().slice(0, 10),
  dateField: 'Submission', direction: 'Both', status: 'All', docType: 'All',
  rin: '', rinRole: 'any',
  pageSize: 100, concurrency: 6, windowDays: 30, maxDocs: 0, includeDetails: true
};

// save form edits as they change (debounced) so nothing reverts and nothing is lost
let optsAppliedOnce = false;
let saveTimer = 0;
function scheduleOptSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { chrome.storage.local.set({ eta_opts: readOpts() }); } catch (e) {}
  }, 400);
}

function sendPop(msg) {
  return chrome.runtime.sendMessage({ __etaPop: 1, ...msg });
}

function fmtNum(n) { return (typeof n === 'number' ? n : 0).toLocaleString('en-US'); }

function readOpts() {
  return {
    from: $('from').value || DEFAULTS.from,
    to: $('to').value || DEFAULTS.to,
    dateField: $('dateField').value,
    direction: $('direction').value,
    status: $('status').value,
    docType: $('docType').value,
    rin: ($('rin').value || '').replace(/\D+/g, ''),
    rinRole: $('rinRole').value,
    pageSize: Math.max(10, Math.min(100, parseInt($('pageSize').value, 10) || 100)),
    concurrency: Math.max(1, Math.min(12, parseInt($('concurrency').value, 10) || 6)),
    windowDays: Math.max(1, Math.min(365, parseInt($('windowDays').value, 10) || 30)),
    maxDocs: Math.max(0, parseInt($('maxDocs').value, 10) || 0),
    includeDetails: $('includeDetails').checked
  };
}

function applyOpts(o) {
  if (!o) return;
  for (const k of ['from', 'to', 'dateField', 'direction', 'status', 'docType', 'rin', 'rinRole']) if (o[k] != null) $(k).value = o[k];
  for (const k of ['pageSize', 'concurrency', 'windowDays', 'maxDocs']) if (o[k] != null) $(k).value = o[k];
  $('includeDetails').checked = o.includeDetails !== false;
}

function setDots(st) {
  $('dotTab').classList.toggle('on', !!(st.pong && st.pong.ok !== false && st.pong.url));
  $('dotAuth').classList.toggle('on', !!st.auth || !!(st.pong && (st.pong.token || st.pong.auth)));
  $('dotData').classList.toggle('on', st.stats && (st.stats.docs > 0 || st.chunkIdx.rows > 0));
}

let lastState = null;
let statusHoldUntil = 0;
function render(st) {
  lastState = st;
  setDots(st);
  const p = st.progress || {};
  let txt = '';
  let pct = 0;
  if (st.running) {
    if (p.phase === 'auth') txt = 'Authenticating with the portal…';
    else if (p.phase === 'list') {
      txt = `Listing invoices — window ${p.window || 0}/${p.windows || '?'}, page ${p.page || 0}/${p.pages || '?'} — <b>${fmtNum(p.listed)}</b> found`;
      pct = p.windows ? Math.min(28, (p.window / p.windows) * 28) : 5;
    } else if (p.phase === 'details') {
      const done = p.detailsDone || 0, total = p.detailsTotal || 1;
      pct = 28 + Math.min(70, (done / total) * 70);
      txt = `Fetching details — <b>${fmtNum(done)}</b>/${fmtNum(total)} — items so far: ${fmtNum(p.items || 0)}${p.errors ? ` — errors: ${p.errors}` : ''}`;
    } else txt = 'Working…';
  } else if (st.finishedAt && st.stats.docs > 0) {
    txt = `Done — <b>${fmtNum(st.stats.docs)}</b> invoices, ${fmtNum(st.stats.items)} line items.` +
      (st.stats.errors ? ` <span style="color:#b3372e">${fmtNum(st.stats.errors)} invoices without details</span>` : '');
    pct = 100;
  } else if (st.interrupted) {
    txt = 'Previous run was interrupted.';
    pct = 0;
  } else txt = 'Idle.';

  if (Date.now() > statusHoldUntil) $('status').innerHTML = txt; // hold transient feedback
  $('barIn').style.width = pct + '%';
  $('err').textContent = st.lastError || '';

  const hasData = st.stats.docs > 0 || st.chunkIdx.rows > 0 || st.pendingRows > 0;
  $('exportXlsx').disabled = !hasData;
  $('exportCsv').disabled = !hasData;
  $('pdfs').disabled = !hasData;
  $('start').disabled = st.running;
  $('clear').disabled = st.running; // no data wipe mid-crawl
  $('pause').disabled = !st.running;
  $('pause').textContent = st.paused ? 'Resume crawl' : 'Pause';
  $('cancel').disabled = !st.running;
  $('resume').style.display = (!st.running && st.interrupted) ? '' : 'none';

  if (p.log) pushLog(p.log);
}

const logLines = [];
function pushLog(s) {
  const t = new Date().toLocaleTimeString('en-GB');
  logLines.push(`[${t}] ${s}`);
  if (logLines.length > 60) logLines.shift();
  $('log').textContent = logLines.join('\n');
  $('log').scrollTop = 1e6;
}

async function refresh() {
  const resp = await sendPop({ type: 'STATE' });
  if (resp && resp.ok) {
    render(resp.state);
    if (resp.opts && !optsAppliedOnce) { applyOpts(resp.opts); optsAppliedOnce = true; } // restore saved filters only once on open — never re-type over the user's edits
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.__etaPop === 1 && msg.type === 'STATE') render(msg.state);
});

// ---- wire buttons ----
$('start').addEventListener('click', async () => {
  const resp = await sendPop({ type: 'STATE' });
  if (resp.ok && (resp.state.stats.docs > 0 || resp.state.chunkIdx.rows > 0)) {
    if (!confirm('Starting a new export clears previously collected data in this session.\nExport or note it first. Continue?')) return;
  }
  const r = await sendPop({ type: 'START', opts: readOpts() });
  if (!r.ok) $('err').textContent = r.error || 'Failed to start';
  refresh();
});
$('resume').addEventListener('click', async () => {
  const r = await sendPop({ type: 'RESUME', opts: readOpts() });
  if (!r.ok) $('err').textContent = r.error || 'Failed to resume';
  refresh();
});
$('pause').addEventListener('click', () => {
  const type = (lastState && lastState.paused) ? 'RESUME_CMD' : 'PAUSE';
  return sendPop({ type }).then(refresh);
});
$('cancel').addEventListener('click', () => sendPop({ type: 'CANCEL' }).then(refresh));
$('check').addEventListener('click', async () => {
  pushLog('Pinging portal tab…');
  const r = await sendPop({ type: 'PING_PORTAL' });
  if (r.ok && r.pong) {
    pushLog(`Portal OK — token: ${r.pong.token ? 'found' : 'not found'}, captured auth header: ${r.pong.auth ? 'yes' : 'not yet'}`);
  } else {
    pushLog('No portal tab found — open https://invoicing.eta.gov.eg/documents and log in.');
  }
  refresh();
});
$('clear').addEventListener('click', async () => {
  if (!confirm('Delete all collected invoice data stored by this extension?')) return;
  await sendPop({ type: 'CLEAR' });
  refresh();
});
$('dbg').addEventListener('click', async () => {
  const r = await sendPop({ type: 'GET_DEBUG' });
  if (!r || !r.ok) { $('err').textContent = 'Could not collect debug data.'; return; }
  const lines = [];
  lines.push('=== ETA Exporter Debug Report ===');
  lines.push('version: ' + (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '?'));
  lines.push('ua: ' + navigator.userAgent);
  lines.push('time: ' + new Date().toISOString());
  lines.push('--- state ---');
  lines.push(JSON.stringify(r.state || {}, null, 2));
  lines.push('--- options ---');
  lines.push(JSON.stringify(r.opts || {}, null, 2));
  lines.push('--- event log (oldest first) ---');
  for (const e of r.log || []) lines.push('[' + e.ts + '] ' + e.type + ': ' + e.text);
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    statusHoldUntil = Date.now() + 5000;
    $('status').textContent = 'Debug report copied to clipboard — paste it in the chat.';
  } catch (e) {
    $('err').textContent = 'Clipboard blocked — the report was printed to the extension console (F12).';
    console.log(text);
  }
});
$('exportXlsx').addEventListener('click', () => {
  chrome.windows.create({ url: chrome.runtime.getURL('export.html?kind=xlsx'), type: 'popup', width: 520, height: 360 });
});
$('exportCsv').addEventListener('click', () => {
  chrome.windows.create({ url: chrome.runtime.getURL('export.html?kind=csv'), type: 'popup', width: 520, height: 360 });
});
$('pdfs').addEventListener('click', async () => {
  const max = prompt('How many PDFs to download? (from the collected invoices, oldest first)', '50');
  if (!max) return;
  downloadPdfs(parseInt(max, 10) || 0);
});

async function downloadPdfs(max) {
  if (!max) return;
  $('err').textContent = '';
  pushLog(`PDF download started (up to ${max})…`);
  try {
    const all = await chrome.storage.local.get(null);
    const rowKeys = Object.keys(all).filter(k => k.startsWith('eta_rows_c'))
      .sort((a, b) => parseInt(a.slice('eta_rows_c'.length), 10) - parseInt(b.slice('eta_rows_c'.length), 10));
    const list = [];
    for (const k of rowKeys) {
      for (const r of all[k] || []) {
        if (r[40]) list.push({ u: r[40], n: r[39] });
        if (list.length >= max) break;
      }
      if (list.length >= max) break;
    }
    if (!list.length) { pushLog('No invoices collected yet.'); return; }
    const authInfo = (await chrome.storage.local.get('eta_auth')).eta_auth || {};
    const tabs = await chrome.tabs.query({ url: 'https://invoicing.eta.gov.eg/*' });
    if (!tabs.length) { pushLog('Open the portal tab first.'); return; }
    const tabId = tabs[0].id;
    let done = 0, failed = 0;
    for (const it of list) {
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN', func: fetchPdfB64,
          args: ['https://api-portal.invoicing.eta.gov.eg/api/v1/documents/' + encodeURIComponent(it.u) + '/pdf', authInfo.auth || null, JSON.stringify(authInfo.headers || {})]
        });
        const b64 = res && res[0] && res[0].result;
        if (!b64) { failed++; continue; }
        const safe = String(it.n || 'invoice').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
        await chrome.downloads.download({
          url: 'data:application/pdf;base64,' + b64,
          filename: 'ETA_PDFs/' + safe + '_' + it.u.slice(0, 12) + '.pdf',
          conflictAction: 'uniquify'
        });
        done++;
        if (done % 3 === 0) { $('status').textContent = `PDFs: ${done}/${list.length}`; await new Promise(r => setTimeout(r, 400)); }
      } catch (e) { failed++; }
    }
    pushLog(`PDFs finished — downloaded ${done}, failed ${failed}.`);
  } catch (e) {
    pushLog('PDF error: ' + (e && e.message || e));
  }
}

// runs in the portal page (MAIN world) — must be self-contained
function fetchPdfB64(url, auth, headersJson) {
  return (async () => {
    const headers = {};
    try { Object.assign(headers, JSON.parse(headersJson || '{}')); } catch (e) {}
    headers['Accept'] = 'application/pdf';
    if (auth) headers['Authorization'] = auth;
    const r = await fetch(url, { headers, credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    const u8 = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(bin);
  })();
}

refresh();
setInterval(refresh, 1200);

// persist edits live + one-time migration: direction defaults to Both
['from', 'to', 'dateField', 'direction', 'status', 'docType', 'rin', 'rinRole', 'pageSize', 'concurrency', 'windowDays', 'maxDocs', 'includeDetails'].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('change', scheduleOptSave);
  if (el.type === 'text' || el.type === 'number' || el.type === 'date') el.addEventListener('input', scheduleOptSave);
});
(async () => {
  try {
    const MIG = 'eta_dir_both_migrated';
    const got = await chrome.storage.local.get([MIG, 'eta_opts']);
    if (!got[MIG]) {
      const o = got.eta_opts || {};
      o.direction = 'Both';
      await chrome.storage.local.set({ eta_opts: o });
      await chrome.storage.local.set({ [MIG]: true });
    }
  } catch (e) {}
})();
