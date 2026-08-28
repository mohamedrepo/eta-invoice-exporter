/*
 * relay.js — ISOLATED world bridge on invoicing.eta.gov.eg.
 * MAIN world cannot access chrome.* APIs, so all crawl traffic is relayed:
 *   page (postMessage, tag 1)  ->  here  ->  chrome.runtime.sendMessage -> background SW
 *   background SW (tabs.sendMessage tag __etaToPage) -> here -> postMessage (tag 2) -> page
 */
(function () {
  'use strict';
  if (window.__ETA_RELAY) return;
  window.__ETA_RELAY = true;

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var m = ev.data;
    if (!m || m.__eta !== 1) return;
    try {
      var p = chrome.runtime.sendMessage({ __eta: 1, type: m.type, data: m.data });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.__etaToPage) {
      window.postMessage({ __eta: 2, type: msg.type, data: msg.data }, location.origin);
      return;
    }
    if (msg.type === 'RELAY_PING') {
      sendResponse({ ok: true, relay: true, url: location.href });
      return;
    }
  });
})();
