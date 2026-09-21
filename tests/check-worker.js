/**
 * Boots the service worker against a stubbed chrome API.
 *
 * If the worker throws while evaluating, Chrome marks it inactive and every
 * `sendMessage` from a content script rejects — the tooltip then shows
 * "Extension reloading" on every lookup. That failure is invisible unless you
 * open chrome://extensions and click the worker link, so it is worth catching
 * here instead.
 *
 *   node tests/check-worker.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const WORKER = manifest.background.service_worker;

const calls = [];
const listeners = {};

const evented = (name) => ({
  addListener: (fn) => {
    listeners[name] = fn;
    calls.push('on ' + name);
  }
});

const chromeStub = {
  runtime: {
    onMessage: evented('runtime.onMessage'),
    onInstalled: evented('runtime.onInstalled'),
    onStartup: evented('runtime.onStartup'),
    getURL: (p) => 'chrome-extension://test/' + p,
    getManifest: () => manifest,
    lastError: null
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {}
    },
    onChanged: evented('storage.onChanged')
  },
  contextMenus: {
    create: (o) => calls.push('menu ' + o.id),
    removeAll: (cb) => cb && cb(),
    onClicked: evented('contextMenus.onClicked')
  },
  commands: { onCommand: evented('commands.onCommand') },
  alarms: {
    create: (n) => calls.push('alarm ' + n),
    onAlarm: evented('alarms.onAlarm')
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {}
  },
  tabs: {
    create: async () => {},
    sendMessage: async () => {},
    // Swapped out below to simulate a build with no wildcard host permission,
    // where filtering a query by URL yields nothing.
    query: async () => [{ id: 1, url: 'https://example.com/' }]
  },
  scripting: {
    executeScript: async (o) => calls.push('inject into tab ' + o.target.tabId)
  }
};

const sandbox = {
  console,
  chrome: chromeStub,
  fetch: async () => {
    throw new Error('network disabled in this check');
  },
  AbortController,
  setTimeout,
  clearTimeout,
  Intl,
  Date,
  Math,
  JSON,
  Number,
  Promise,
  Map,
  Set,
  Error,
  URL,
  URLSearchParams,
  importScripts: (...files) => {
    files.forEach((f) => {
      const rel = String(f).replace(/^\//, '');
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) throw new Error('importScripts: missing ' + rel);
      vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: rel });
    });
  }
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

let failed = false;

try {
  vm.runInContext(fs.readFileSync(path.join(ROOT, WORKER), 'utf8'), sandbox, { filename: WORKER });
  console.log('Worker evaluated without throwing.\n');
} catch (e) {
  failed = true;
  console.log('WORKER FAILED TO EVALUATE:\n  ' + e.stack + '\n');
}

if (!failed) {
  console.log('Registered during startup:');
  calls.forEach((c) => console.log('  ' + c));

  // Every message type the rest of the extension sends must have a handler.
  const SENT = [
    'translate',
    'translateBatch',
    'saveCard',
    'openDashboard',
    'refreshBadge',
    'clearCache',
    'testKey',
    'providerStatus'
  ];
  const handler = listeners['runtime.onMessage'];
  console.log('\nMessage handlers:');
  if (!handler) {
    failed = true;
    console.log('  no onMessage listener registered');
  } else {
    SENT.forEach((type) => {
      let answered = false;
      try {
        answered = handler({ type, payload: {} }, {}, () => {}) === true;
      } catch (e) {
        answered = false;
      }
      console.log('  ' + (answered ? 'ok   ' : 'MISS ') + type);
      if (!answered) failed = true;
    });
  }

  // The names in manifest.commands must all be handled.
  const onCommand = listeners['commands.onCommand'];
  console.log('\nCommands declared in the manifest:');
  Object.keys(manifest.commands || {}).forEach((name) => {
    console.log('  ' + name + (onCommand ? '' : '  (NO HANDLER)'));
  });
  if (!onCommand) failed = true;
}

(async () => {
  const onInstalled = listeners['runtime.onInstalled'];
  if (onInstalled) {
    console.log('\nRunning the install handler:');
    try {
      await onInstalled({ reason: 'update' });
      const injected = calls.filter((c) => c.indexOf('inject into tab') === 0);
      console.log(
        '  ' + (injected.length ? 'ok    ' : 'MISS  ') +
          'injects the content script into tabs that are already open'
      );
      if (!injected.length) failed = true;
    } catch (e) {
      failed = true;
      console.log('  install handler threw: ' + e.message);
    }

    /**
     * The manifest no longer asks for http://*&#47;* and https://*&#47;* as separate
     * host permissions — that access comes from the content script's <all_urls>
     * match instead. If Chrome ever declines to filter a tabs.query by URL
     * without the standalone permission, the query comes back empty and every
     * already-open tab silently loses its content script, which is the exact
     * bug injectIntoOpenTabs exists to prevent. Prove the fallback catches it.
     */
    console.log('\nWith URL-filtered tab queries returning nothing:');
    const before = calls.filter((c) => c.indexOf('inject into tab') === 0).length;
    chromeStub.tabs.query = async (q) =>
      q && q.url ? [] : [{ id: 7, url: 'https://example.org/' }];
    try {
      await onInstalled({ reason: 'update' });
      const after = calls.filter((c) => c.indexOf('inject into tab') === 0).length;
      const ok = after > before;
      console.log('  ' + (ok ? 'ok    ' : 'MISS  ') + 'falls back to an unfiltered query');
      if (!ok) failed = true;
    } catch (e) {
      failed = true;
      console.log('  fallback threw: ' + e.message);
    }
  }

  console.log('\n' + (failed ? 'PROBLEMS FOUND' : 'Service worker starts cleanly.'));
  process.exit(failed ? 1 : 0);
})();
