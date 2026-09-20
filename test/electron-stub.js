// Test harness stub: จำลอง Electron ipcRenderer + <webview> ให้ทดสอบ UI ได้ในเบราว์เซอร์ปกติ
// ทำงานเฉพาะเมื่อไม่ได้รันใน Electron จริง (แอปจริงไม่ได้รับผลกระทบแต่อย่างใด)
(function () {
  var isElectron = false;
  try { isElectron = typeof process !== 'undefined' && process.versions && !!process.versions.electron; } catch (e) {}
  if (isElectron) return;

  startStub();

  function startStub() {
window.__ipcLog = [];
window.__popouts = {};
window.__alerts = [];

const ipcListeners = {};
window.ipcRenderer = {
  send: function (ch) {
    var args = Array.prototype.slice.call(arguments, 1);
    window.__ipcLog.push([ch, args]);
    if (ch === 'popout-stream' && args[0]) window.__popouts[args[0].streamId] = args[0];
  },
  on: function (ch, fn) { (ipcListeners[ch] = ipcListeners[ch] || []).push(fn); }
};
window.__ipcEmit = function (ch) {
  var args = Array.prototype.slice.call(arguments, 1);
  (ipcListeners[ch] || []).forEach(function (fn) { fn({}, ...args); });
};
window.require = function (m) {
  if (m === 'electron') return { ipcRenderer: window.ipcRenderer };
  throw new Error('stub: module not available: ' + m);
};
window.alert = function (msg) { window.__alerts.push(String(msg)); };

// ---- webview stub: มี history จริงเพื่อทดสอบปุ่มย้อนกลับ/ไปหน้า ----
function patchWebview(el) {
  if (el.__patched) return;
  el.__patched = true;
  // หน้าตาคล้ายวิดีโอ เพื่อให้จับภาพหน้าจอ/ทดสอบแล้วเห็นขอบเขตชัด (webview จริงใน Electron ไม่ผ่านทางนี้)
  if (!el.__viz) {
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    var viz = document.createElement('div');
    viz.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;font-size:32px;color:rgba(48,209,88,0.30);pointer-events:none;background:radial-gradient(ellipse at center,#15201a 0%,#0a0e0a 75%);';
    viz.textContent = '▶';
    el.appendChild(viz);
    el.__viz = viz;
  }
  var state = {
    hist: [el.getAttribute('src') || 'about:blank'],
    pos: 0,
    url: el.getAttribute('src') || 'about:blank',
    muted: false,
    zoom: 1,
    js: []
  };
  el.__state = state;
  Object.defineProperty(el, 'src', {
    get: function () { return state.url; },
    set: function (v) {
      state.hist = state.hist.slice(0, state.pos + 1);
      state.hist.push(v);
      state.pos = state.hist.length - 1;
      state.url = v;
      setTimeout(function () {
        el.dispatchEvent(new Event('did-start-loading'));
        el.dispatchEvent(new Event('did-finish-load'));
        el.dispatchEvent(new Event('did-navigate'));
      }, 20);
    }
  });
  el.getURL = function () { return state.url; };
  el.setAudioMuted = function (m) { state.muted = !!m; };
  el.setZoomFactor = function (z) { state.zoom = z; };
  el.getZoomFactor = function () { return state.zoom; };
  el.executeJavaScript = function (code) { state.js.push(code); return Promise.resolve(); };
  el.canGoBack = function () { return state.pos > 0; };
  el.canGoForward = function () { return state.pos < state.hist.length - 1; };
  el.goBack = function () { if (state.pos > 0) { state.pos--; state.url = state.hist[state.pos]; el.dispatchEvent(new Event('did-navigate')); } };
  el.goForward = function () { if (state.pos < state.hist.length - 1) { state.pos++; state.url = state.hist[state.pos]; el.dispatchEvent(new Event('did-navigate')); } };
  el.reload = function () { el.dispatchEvent(new Event('did-start-loading')); el.dispatchEvent(new Event('did-finish-load')); };
  setTimeout(function () { el.dispatchEvent(new Event('dom-ready')); }, 30);
}

new MutationObserver(function (muts) {
  muts.forEach(function (m) {
    m.addedNodes.forEach(function (n) {
      if (n.nodeType !== 1) return;
      // webview ถูกสร้างผ่าน innerHTML จึงต้องค้นลูกด้านในด้วย (observer รายงานเฉพาะโหนดราก)
      if (n.tagName === 'WEBVIEW') patchWebview(n);
      if (n.querySelectorAll) n.querySelectorAll('webview').forEach(patchWebview);
    });
  });
}).observe(document.documentElement, { childList: true, subtree: true });

console.log('[harness] electron stub ready');
  }
})();
