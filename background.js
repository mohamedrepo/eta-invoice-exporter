/*
 * background.js — MV3 service worker.
 * Owns: crawl state, chunked persistence to chrome.storage.local, portal tab
 * discovery/creation, progress broadcast to the popup.
 */
'use strict';

const PORTAL_URL = 'https://invoicing.eta.gov.eg/documents';
const KEY_META = 'eta_meta';
const KEY_AUTH = 'eta_auth';
const KEY_OPTS = 'eta_opts';
const P_ROWS = 'eta_rows_c';
const P_ITEMS = 'eta_items_c';
const P_SEEN = 'eta_seen_c';
const FLUSH_AT = 1000;

let run = defaults();
// diagnostic event ring buffer (survives popup reopen, cleared with data reset)
let evlog = [];
let batchCount = 0;
function ev(type, text) {
  evlog.push({ ts: new Date().toISOString().slice(11, 19), type, text: String(text || '').slice(0, 300) });
  if (evlog.length > 250) evlog.shift();
}
function defaults() {
  return {
    running: false, paused: false, interrupted: false,
    progress: {}, stats: { docs: 0, items: 0, errors: 0 },
    lastError: null, startedAt: 0, finishedAt: 0,
    pong: null
  };
}
let chunkIdx = { rows: 0, items: 0, seen: 0 };
let pending = { rows: [], items: [], seen: [] };

// ---------- storage helpers ----------
async function getStorage(key) { const o = await chrome.storage.local.get(key); return o[key]; }

function allKeysIn(obj, prefix) {
  return Object.keys(obj).filter(k => k.startsWith(prefix));
}

async function syncChunkIdx() {
  const all = await chrome.storage.local.get(null);
  chunkIdx = {
    rows: allKeysIn(all, P_ROWS).length,
    items: allKeysIn(all, P_ITEMS).length,
    seen: allKeysIn(all, P_SEEN).length
  };
}

async function saveMeta() {
  await chrome.storage.local.set({
    [KEY_META]: {
      running: run.running, paused: run.paused, interrupted: run.interrupted,
      progress: run.progress, stats: run.stats, lastError: run.lastError,
      startedAt: run.startedAt, finishedAt: run.finishedAt, chunkIdx
    }
  });
}

async function flushChunks(force) {
  if (pending.rows.length < FLUSH_AT && !force) return;
  const ops = {};
  if (pending.rows.length) ops[P_ROWS + (chunkIdx.rows++)] = pending.rows;
  if (pending.items.length) ops[P_ITEMS + (chunkIdx.items++)] = pending.items;
  if (pending.seen.length) ops[P_SEEN + (chunkIdx.seen++)] = pending.seen;
  pending = { rows: [], items: [], seen: [] };
  if (Object.keys(ops).length) await chrome.storage.local.set(ops);
}

async function clearData() {
  const all = await chrome.storage.local.get(null);
  const keys = allKeysIn(all, P_ROWS).concat(allKeysIn(all, P_ITEMS)).concat(allKeysIn(all, P_SEEN)).concat([KEY_META]);
  if (keys.length) await chrome.storage.local.remove(keys);
  chunkIdx = { rows: 0, items: 0, seen: 0 };
  pending = { rows: [], items: [], seen: [] };
}

async function loadSeen() {
  const all = await chrome.storage.local.get(null);
  const keys = allKeysIn(all, P_SEEN).sort((a, b) => parseInt(a.slice(P_SEEN.length), 10) - parseInt(b.slice(P_SEEN.length), 10));
  const set = new Set();
  for (const k of keys) for (const u of all[k] || []) set.add(u);
  return set;
}

function broadcast() {
  chrome.runtime.sendMessage({ __etaPop: 1, type: 'STATE', state: snapshot() }).catch(() => {});
}

function snapshot() {
  return {
    running: run.running, paused: run.paused, interrupted: run.interrupted,
    progress: run.progress, stats: run.stats, lastError: run.lastError,
    startedAt: run.startedAt, finishedAt: run.finishedAt,
    chunkIdx, pendingRows: pending.rows.length,
    auth: !!authCache, pong: run.pong
  };
}

// ---------- portal tab helpers ----------
async function findPortalTab() {
  const tabs = await chrome.tabs.query({ url: 'https://invoicing.eta.gov.eg/*' });
  return tabs.length ? tabs[0] : null;
}

async function waitRelayReady(tabId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'RELAY_PING' });
      if (resp && resp.ok) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

async function pingPortal() {
  const tab = await findPortalTab();
  if (!tab) return { ok: false, error: 'NO_TAB' };
  run.pong = null;
  try { await chrome.tabs.sendMessage(tab.id, { __etaToPage: 1, type: 'PING' }); } catch (e) { return { ok: false, error: 'SEND_FAILED' }; }
  await new Promise(r => setTimeout(r, 900));
  return { ok: true, pong: run.pong };
}

// ---------- relay messages ----------
function handleRelay(msg, sender) {
  const d = msg.data || {};
  switch (msg.type) {
    case 'HELLO':
      break;
    case 'PONG':
      run.pong = d;
      broadcast();
      break;
    case 'AUTH':
      authCache = d.auth || null;
      chrome.storage.local.set({ [KEY_AUTH]: { auth: d.auth || null, headers: d.headers || {} } }).catch(() => {});
      break;
    case 'LOG':
      ev('LOG', d.message);
      run.lastError = null;
      run.progress.log = String(d.message || '').slice(0, 200);
      broadcast();
      break;
    case 'PROGRESS':
      ev('PROG', JSON.stringify(d));
      run.progress = Object.assign({}, run.progress, d);
      broadcast();
      break;
    case 'BATCH': {
      if (!run.running) { ev('DROP', 'stray batch dropped after stop (rows=' + (d.rows || []).length + ')'); break; } // strays after cancel/error must not touch storage
      const rows = d.rows || [], items = d.itemRows || [], keys = d.keys || [];
      pending.rows.push(...rows);
      pending.items.push(...items);
      pending.seen.push(...keys);
      run.stats.docs += rows.length;
      run.stats.items += items.length;
      batchCount++;
      if (batchCount % 10 === 0) ev('BATCH', 'batches=' + batchCount + ' rows+=' + rows.length + ' items+=' + items.length);
      flushChunks(false).then(broadcast).catch(() => {});
      break;
    }
    case 'DONE':
      ev('DONE', JSON.stringify(d));
      flushChunks(true).then(() => {
        run.running = false; run.finishedAt = Date.now();
        if (d.errors) run.stats.errors = d.errors;
        run.stats.dropped = d.dropped || 0;
        saveMeta().then(broadcast).catch(() => {});
      }).catch(() => {});
      break;
    case 'ERROR':
      ev('ERROR', String(d.message || 'Unknown error') + (d.cancelled ? ' (cancelled)' : ''));
      if (!d.cancelled) run.lastError = String(d.message || 'Unknown error');
      if (d.fatal || d.cancelled) {
        run.running = false;
        flushChunks(true).then(saveMeta).then(broadcast).catch(() => {});
      } else broadcast();
      break;
  }
}

let authCache = null;

// ---------- popup commands ----------
async function handlePopup(msg) {
  if (msg.type !== 'STATE' && msg.type !== 'GET_DEBUG') ev('CMD', msg.type); // keep polls out of the ring
  switch (msg.type) {
    case 'STATE':
      return { ok: true, state: snapshot(), opts: (await getStorage(KEY_OPTS)) || null };
    case 'START': {
      if (run.running) return { ok: false, error: 'ALREADY_RUNNING' };
      await clearData();
      seenSet = new Set();
      const opts = msg.opts || {};
      await chrome.storage.local.set({ [KEY_OPTS]: opts });
      run = defaults();
      run.running = true;
      run.startedAt = Date.now();
      await saveMeta();
      broadcast();
      try {
        let tab = await findPortalTab();
        if (!tab) tab = await chrome.tabs.create({ url: PORTAL_URL, active: true });
        const ready = await waitRelayReady(tab.id, 60000);
        if (!ready) throw new Error('Portal page did not respond — is it fully loaded and are you logged in?');
        await chrome.tabs.sendMessage(tab.id, { __etaToPage: 1, type: 'START_CRAWL', data: opts });
        return { ok: true };
      } catch (e) {
        run.running = false;
        run.lastError = String(e && e.message || e);
        await saveMeta(); broadcast();
        return { ok: false, error: run.lastError };
      }
    }
    case 'RESUME': {
      if (run.running) return { ok: false, error: 'ALREADY_RUNNING' };
      seenSet = await loadSeen();
      const opts = msg.opts || (await getStorage(KEY_OPTS)) || {};
      await chrome.storage.local.set({ [KEY_OPTS]: opts });
      run = defaults();
      run.running = true;
      run.startedAt = Date.now();
      run.interrupted = false;
      run.stats.docs = 0; run.stats.items = 0; run.stats.errors = 0;
      await saveMeta(); broadcast();
      try {
        let tab = await findPortalTab();
        if (!tab) tab = await chrome.tabs.create({ url: PORTAL_URL, active: true });
        const ready = await waitRelayReady(tab.id, 60000);
        if (!ready) throw new Error('Portal page did not respond — is it fully loaded and are you logged in?');
        const startOpts = Object.assign({}, opts, { skipUuids: [...seenSet] });
        await chrome.tabs.sendMessage(tab.id, { __etaToPage: 1, type: 'START_CRAWL', data: startOpts });
        return { ok: true };
      } catch (e) {
        run.running = false;
        run.lastError = String(e && e.message || e);
        await saveMeta(); broadcast();
        return { ok: false, error: run.lastError };
      }
    }
    case 'PAUSE':
    case 'RESUME_CMD':
    case 'CANCEL': {
      const map = { PAUSE: 'PAUSE', RESUME_CMD: 'RESUME', CANCEL: 'CANCEL' };
      const type = map[msg.type];
      if (type === 'PAUSE') run.paused = true;
      if (type === 'RESUME_CMD') run.paused = false;
      if (type === 'CANCEL') { run.paused = false; }
      const tab = await findPortalTab();
      if (tab) { try { await chrome.tabs.sendMessage(tab.id, { __etaToPage: 1, type }); } catch (e) {} }
      if (type === 'CANCEL') { run.running = false; await saveMeta(); }
      broadcast();
      return { ok: true };
    }
    case 'PING_PORTAL':
      return pingPortal();
    case 'CLEAR':
      await clearData();
      evlog = []; batchCount = 0;
      run = defaults();
      await saveMeta();
      broadcast();
      return { ok: true };
    case 'GET_AUTH':
      return { ok: true, auth: (await getStorage(KEY_AUTH)) || null };
    case 'GET_DEBUG':
      return { ok: true, state: snapshot(), opts: (await getStorage(KEY_OPTS)) || null, log: evlog };
    default:
      return { ok: false, error: 'UNKNOWN_CMD' };
  }
}

let seenSet = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.__eta === 1) { handleRelay(msg, sender); return; }
  if (msg.__etaPop === 1) {
    handlePopup(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
});

// cold-start recovery
(async () => {
  try {
    const meta = await getStorage(KEY_META);
    await syncChunkIdx();
    if (meta) {
      run = Object.assign(defaults(), meta);
      run.running = false;
      run.paused = false;
      if (!meta.finishedAt && meta.running) {
        run.interrupted = true;
        run.lastError = 'Previous run was interrupted (browser/extension restart). Press Resume to continue.';
      }
    }
    const a = await getStorage(KEY_AUTH);
    authCache = a && a.auth;
  } catch (e) {}
})();
