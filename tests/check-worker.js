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
    created: [],
    create: async (o) => {
      chromeStub.tabs.created.push((o && o.url) || '');
    },
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
    'providerStatus',
    'reportIssue'
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

  /**
   * The report button opens a prefilled form. What it prefills is a privacy
   * boundary: the content script sits on the page and could trivially add the
   * URL or the sentence the word came from, and the policy promises page
   * content never leaves the machine. Pin it here, because that leak is one
   * convenient line away and would look helpful in review.
   */
  const onMessage = listeners['runtime.onMessage'];
  if (onMessage) {
    console.log('\nReporting a problem:');
    chromeStub.tabs.created.length = 0;
    try {
      await new Promise((resolve) => {
        onMessage(
          {
            type: 'reportIssue',
            payload: {
              kind: 'grammar',
              subject: 'können',
              details: 'Word shown: kannst\nInfinitive: können\nClassified as: modal'
            }
          },
          {},
          resolve
        );
      });

      const url = chromeStub.tabs.created[0] || '';
      const decoded = decodeURIComponent(url);
      const body = decoded.split('body=')[1] || '';

      // Anything that would mean the page came along for the ride.
      const LEAKS = ['example.com', 'example.org', 'http://', 'https://ex'];

      [
        ['opens a tab', !!url],
        ['goes to the repo issue form', url.indexOf('/issues/new') > -1],
        ['carries the word', decoded.indexOf('können') > -1],
        ['carries the version', decoded.indexOf(manifest.version) > -1],
        ['no labels= or template= to rot', url.indexOf('labels=') === -1 && url.indexOf('template=') === -1],
        ['no page URL or page text in the body', !LEAKS.some((l) => body.indexOf(l) > -1)]
      ].forEach(([label, ok]) => {
        console.log('  ' + (ok ? 'ok    ' : 'MISS  ') + label);
        if (!ok) failed = true;
      });
    } catch (e) {
      failed = true;
      console.log('  reportIssue threw: ' + e.message);
    }
  }

  console.log('\n' + (failed ? 'PROBLEMS FOUND' : 'Service worker starts cleanly.'));
  process.exit(failed ? 1 : 0);
})();
