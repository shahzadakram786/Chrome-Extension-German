/**
 * AksLingo background worker.
 *
 * Every network call lives here rather than in the content script: the worker
 * owns the extension's host permissions, so requests are not subject to the
 * visited page's CSP or origin, and one shared cache serves every tab.
 */
importScripts(
  '/src/lib/languages.js',
  '/src/lib/srs.js',
  '/src/lib/store.js',
  '/src/lib/gtx.js',
  '/src/lib/mymemory.js',
  '/src/lib/byokey.js'
);

const GL = globalThis.GL;

/* ------------------------------------------------------------------ cache -- */

const MEM_MAX = 600;
const DISK_MAX = 2000;
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Map preserves insertion order, which gives us LRU for free. */
const mem = new Map();
let disk = null; // lazily hydrated from storage
let diskDirty = false;
let flushTimer = null;

const cacheKey = (text, sl, tl) => sl + '|' + tl + '|' + text;

async function diskCache() {
  if (disk) return disk;
  const res = await chrome.storage.local.get(GL.store.KEYS.cache);
  disk = res[GL.store.KEYS.cache] || {};
  return disk;
}

async function cacheGet(key) {
  const hit = mem.get(key);
  if (hit) {
    mem.delete(key);
    mem.set(key, hit); // refresh recency
    return hit.v;
  }
  const d = await diskCache();
  const entry = d[key];
  if (!entry) return null;
  if (Date.now() - entry.t > CACHE_TTL) {
    delete d[key];
    return null;
  }
  mem.set(key, { v: entry.v, t: entry.t });
  return entry.v;
}

async function cacheSet(key, value) {
  const t = Date.now();
  mem.set(key, { v: value, t });
  while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);

  const d = await diskCache();
  d[key] = { v: value, t };
  diskDirty = true;
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushCache, 3000);
}

async function flushCache() {
  flushTimer = null;
  if (!diskDirty || !disk) return;
  diskDirty = false;
  const keys = Object.keys(disk);
  if (keys.length > DISK_MAX) {
    // Drop the oldest quarter at once so we are not trimming on every write.
    keys.sort((a, b) => disk[a].t - disk[b].t);
    keys.slice(0, keys.length - Math.floor(DISK_MAX * 0.75)).forEach((k) => delete disk[k]);
  }
  try {
    await chrome.storage.local.set({ [GL.store.KEYS.cache]: disk });
  } catch (e) {
    // Quota exceeded: start clean rather than wedging every future write.
    disk = {};
    await chrome.storage.local.remove(GL.store.KEYS.cache);
  }
}

/* -------------------------------------------------------------- providers -- */

async function httpJson(url, opts) {
  const o = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 9000);
  try {
    const init = { signal: ctl.signal, credentials: 'omit' };
    if (o.method) init.method = o.method;
    if (o.headers) init.headers = o.headers;
    if (o.body !== undefined) init.body = o.body;
    const res = await fetch(url, init);
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 429 is deliberately absent: when we are rate limited, retrying in 350ms only
// makes it worse. We fail fast and let the next provider answer instead.
const RETRYABLE = new Set([408, 425, 500, 502, 503, 504]);

async function withRetry(fn, attempts) {
  let lastErr;
  for (let i = 0; i < (attempts || 3); i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = !e.status || RETRYABLE.has(e.status);
      if (!retryable || i === (attempts || 3) - 1) break;
      const backoff = 350 * Math.pow(2, i) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function providerGoogle(text, sl, tl, rich) {
  const dt = rich ? 'dt=t&dt=bd&dt=rm&dt=ex' : 'dt=t&dt=rm';
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
    encodeURIComponent(sl) +
    '&tl=' +
    encodeURIComponent(tl) +
    '&' +
    dt +
    '&q=' +
    encodeURIComponent(text);
  const json = await httpJson(url);
  const parsed = GL.gtx.parse(json, sl);
  if (!parsed.text) throw new Error('empty translation');
  parsed.provider = 'google';
  return parsed;
}

async function providerMyMemory(text, sl, tl, email) {
  // A contact address raises MyMemory's anonymous daily character cap. It is
  // the user's own, entered in Settings, and goes nowhere but this endpoint.
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=' +
    encodeURIComponent(GL.mymemory.langPair(sl, tl)) +
    (email ? '&de=' + encodeURIComponent(email) : '');
  const parsed = GL.mymemory.parse(await httpJson(url), sl);
  parsed.provider = 'mymemory';
  return parsed;
}

/* ------------------------------------------------ user-supplied key -- */

async function providerDeepL(text, sl, tl, key) {
  const pair = GL.byokey.deepl.pair(sl, tl);
  const body = new URLSearchParams();
  body.set('text', text);
  body.set('target_lang', pair.target);
  if (pair.source) body.set('source_lang', pair.source);
  // Our "text" is a hovered word or a paragraph, never markup.
  body.set('preserve_formatting', '1');

  const json = await httpJson(GL.byokey.deepl.host(key) + '/v2/translate', {
    method: 'POST',
    headers: {
      // The header form, not the deprecated auth_key query param, so the key
      // never lands in a URL that could be logged along the way.
      Authorization: 'DeepL-Auth-Key ' + key,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const parsed = GL.byokey.deepl.parse(json, sl);
  if (!parsed.text) throw new Error('empty translation');
  parsed.provider = 'deepl';
  return parsed;
}

async function providerGCloud(text, sl, tl, key) {
  const body = new URLSearchParams();
  body.set('q', text);
  body.set('target', tl);
  body.set('format', 'text');
  if (sl && sl !== 'auto') body.set('source', sl);

  const json = await httpJson(
    'https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }
  );

  const parsed = GL.byokey.gcloud.parse(json, sl);
  if (!parsed.text) throw new Error('empty translation');
  parsed.provider = 'gcloud';
  return parsed;
}

/**
 * The keyed provider for the current settings, or null when the user has not
 * configured one — or has, but not for a pair this provider handles. DeepL has
 * no Urdu, and silently returning nothing for de→ur would be worse than
 * quietly using the free chain for that lookup.
 */
function keyedProvider(settings, sl, tl) {
  const name = settings.provider;
  const key = (settings.apiKey || '').trim();
  if (!key || (name !== 'deepl' && name !== 'gcloud')) return null;
  if (name === 'deepl' && !(GL.byokey.deepl.supports(sl) && GL.byokey.deepl.supports(tl))) {
    return null;
  }
  return {
    name,
    run: (text) =>
      name === 'deepl'
        ? providerDeepL(text, sl, tl, key)
        : providerGCloud(text, sl, tl, key)
  };
}

/**
 * Skip a provider for a while once it starts failing, rather than paying its
 * timeout on every hover. A 429 opens the breaker at once and for longer: a
 * rate limit is a statement about the next few minutes, not a blip.
 */
const RATE_LIMIT_COOLDOWN = 5 * 60 * 1000;
const FAILURE_COOLDOWN = 60 * 1000;

const breaker = {
  google: { fails: 0, until: 0 },
  mymemory: { fails: 0, until: 0 },
  byo: { fails: 0, until: 0 }
};

/**
 * A rejected key is not a transient failure — it will reject every subsequent
 * request too. We remember the last one so Settings can tell the user their key
 * is wrong, instead of leaving them to wonder why the paid provider they
 * configured never seems to be the one answering.
 */
let keyProblem = null;

function noteKeyProblem(provider, status) {
  if (status === 401 || status === 403) {
    keyProblem = { provider, kind: 'rejected', at: Date.now() };
  } else if (status === 456 || status === 429) {
    keyProblem = { provider, kind: 'quota', at: Date.now() };
  }
}

function breakerOpen(name) {
  return breaker[name].until > Date.now();
}

function breakerHit(name, ok, status) {
  const b = breaker[name];
  if (ok) {
    b.fails = 0;
    b.until = 0;
    return;
  }
  if (status === 429) {
    b.fails = 0;
    b.until = Date.now() + RATE_LIMIT_COOLDOWN;
    return;
  }
  b.fails += 1;
  if (b.fails >= 2) {
    b.until = Date.now() + FAILURE_COOLDOWN;
    b.fails = 0;
  }
}

/* ------------------------------------------------------------- translate -- */

const inflight = new Map(); // key -> Promise, so N tabs asking at once make one request

async function translate({ text, source, target, rich }) {
  text = (text || '').trim();
  if (!text) return { ok: false, error: 'No text' };
  if (source === target && source !== 'auto') {
    return { ok: true, text, detected: source, provider: 'noop', cached: true, senses: [], examples: [] };
  }

  // The provider is part of the key: switching to your own DeepL key should
  // start giving you DeepL's answers, not replay the free chain's from cache.
  const settingsForKey = await GL.store.getSettings();
  const key =
    cacheKey(text, source, target) +
    (rich ? '|r' : '') +
    '|' +
    (settingsForKey.provider || 'free');
  const cached = await cacheGet(key);
  if (cached) return Object.assign({ ok: true, cached: true }, cached);

  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    let result = null;
    let firstError = null;
    const settings = settingsForKey;

    // A key the user paid for goes first: it is contractual, unthrottled at our
    // scale, and the whole reason they configured it. The free chain stays
    // underneath so a bad key or an exhausted quota degrades instead of failing.
    const keyed = keyedProvider(settings, source, target);
    if (keyed && !breakerOpen('byo')) {
      try {
        result = await withRetry(() => keyed.run(text), 2);
        breakerHit('byo', true);
        keyProblem = null;
      } catch (e) {
        firstError = e;
        breakerHit('byo', false, e.status);
        noteKeyProblem(keyed.name, e.status);
      }
    }

    if (!result && !breakerOpen('google')) {
      try {
        result = await withRetry(() => providerGoogle(text, source, target, rich));
        breakerHit('google', true);
      } catch (e) {
        firstError = firstError || e;
        breakerHit('google', false, e.status);
      }
    }

    if (!result && !breakerOpen('mymemory')) {
      try {
        result = await withRetry(
          () => providerMyMemory(text, source, target, settings.mymemoryEmail),
          2
        );
        breakerHit('mymemory', true);
      } catch (e) {
        firstError = firstError || e;
        breakerHit('mymemory', false, e.status);
      }
    }

    if (!result) {
      const limited =
        (firstError && firstError.status === 429) ||
        (breakerOpen('google') && breakerOpen('mymemory'));
      return {
        ok: false,
        error: limited
          ? 'Both translators are rate limiting us — try again in a few minutes'
          : 'Could not reach a translation service'
      };
    }

    const payload = {
      text: result.text,
      detected: result.detected === 'auto' ? source : result.detected,
      confidence: result.confidence,
      senses: result.senses,
      pos: result.pos,
      romanSource: result.romanSource,
      romanTarget: result.romanTarget,
      examples: result.examples.slice(0, 2),
      provider: result.provider,
      lowConfidence: !!result.lowConfidence,
      target
    };
    await cacheSet(key, payload);
    GL.store.bump('lookups').catch(() => {});
    return Object.assign({ ok: true, cached: false }, payload);
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Immersion mode sends whole paragraphs. Batching them into one request keeps
 * us well under the rate limit; if the line count comes back wrong we fall
 * back to translating that batch one segment at a time rather than guessing.
 */
async function translateBatch({ segments, source, target }) {
  const CHUNK_CHARS = 1400;
  const out = new Array(segments.length).fill('');
  const batches = [];
  let current = [];
  let size = 0;

  segments.forEach((seg, i) => {
    const clean = (seg || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (size + clean.length > CHUNK_CHARS && current.length) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push({ i, text: clean });
    size += clean.length;
  });
  if (current.length) batches.push(current);

  const runBatch = async (batch) => {
    if (batch.length === 1) {
      const r = await translate({ text: batch[0].text, source, target, rich: false });
      if (r.ok) out[batch[0].i] = r.text;
      return;
    }
    const joined = batch.map((b) => b.text).join('\n');
    const r = await translate({ text: joined, source, target, rich: false });
    if (!r.ok) return;
    const lines = r.text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === batch.length) {
      batch.forEach((b, idx) => {
        out[b.i] = lines[idx];
      });
    } else {
      // Line counts drifted — redo this batch segment by segment.
      for (const b of batch) {
        const single = await translate({ text: b.text, source, target, rich: false });
        if (single.ok) out[b.i] = single.text;
      }
    }
  };

  // Modest concurrency: fast enough to feel instant, gentle enough to not trip limits.
  const CONCURRENCY = 3;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(runBatch));
  }

  return { ok: true, translations: out };
}

/* ----------------------------------------------------------------- badge -- */

async function refreshBadge() {
  try {
    const deck = await GL.store.getDeck();
    const { due } = GL.srs.counts(deck);
    await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    await chrome.action.setBadgeText({ text: due > 0 ? (due > 99 ? '99+' : String(due)) : '' });
  } catch (e) {
    /* action API unavailable during startup races */
  }
}

/* ---------------------------------------------------------- context menu -- */

const MENU = {
  translate: 'gl-translate',
  save: 'gl-save',
  dashboard: 'gl-dashboard',
  mute: 'gl-mute-site'
};

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.translate,
      title: 'Translate “%s”',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: MENU.save,
      title: 'Save “%s” to my deck',
      contexts: ['selection']
    });
    chrome.contextMenus.create({ id: 'gl-sep', type: 'separator', contexts: ['all'] });
    chrome.contextMenus.create({ id: MENU.dashboard, title: 'Open review dashboard', contexts: ['all'] });
    chrome.contextMenus.create({ id: MENU.mute, title: 'Turn off on this site', contexts: ['all'] });
  });
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
};

const openDashboard = (hash) =>
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html' + (hash || '')) });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU.dashboard) return openDashboard();

  if (info.menuItemId === MENU.mute) {
    const host = hostOf((tab && tab.url) || '');
    if (!host) return;
    const s = await GL.store.getSettings();
    if (!s.blocklist.includes(host)) {
      await GL.store.setSettings({ blocklist: s.blocklist.concat(host) });
    }
    if (tab) chrome.tabs.sendMessage(tab.id, { type: 'gl:disable-site' }).catch(() => {});
    return;
  }

  if (!tab || !info.selectionText) return;
  const type = info.menuItemId === MENU.save ? 'gl:save-selection' : 'gl:translate-selection';
  chrome.tabs.sendMessage(tab.id, { type, text: info.selectionText }).catch(() => {});
});

/* ------------------------------------------------------------- commands -- */

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'open-dashboard') return openDashboard();

  if (command === 'toggle-enabled') {
    const s = await GL.store.getSettings();
    await GL.store.setSettings({ enabled: !s.enabled });
    return;
  }

  if (!tab) return;
  const map = {
    'translate-selection': 'gl:translate-selection',
    'toggle-immersion': 'gl:toggle-immersion'
  };
  if (map[command]) chrome.tabs.sendMessage(tab.id, { type: map[command] }).catch(() => {});
});

/* ------------------------------------------------------------- messaging -- */

const handlers = {
  translate: (msg) => translate(msg.payload),
  translateBatch: (msg) => translateBatch(msg.payload),
  saveCard: async (msg) => {
    const res = await GL.store.addCard(msg.payload);
    await refreshBadge();
    return { ok: true, added: res.added, total: res.total };
  },
  openDashboard: async (msg) => {
    await openDashboard(msg.payload && msg.payload.hash);
    return { ok: true };
  },
  refreshBadge: async () => {
    await refreshBadge();
    return { ok: true };
  },
  clearCache: async () => {
    mem.clear();
    disk = {};
    await chrome.storage.local.remove(GL.store.KEYS.cache);
    return { ok: true };
  },
  /**
   * Verifies a key against its provider with one cheap round trip, so the user
   * finds out in Settings rather than by noticing translations look wrong.
   * The key comes from the message rather than storage: this runs before the
   * user commits it.
   */
  testKey: async (msg) => {
    const { provider, key } = msg.payload || {};
    const complaint = GL.byokey.validateKey(provider, key);
    if (complaint) return { ok: false, error: complaint };
    try {
      const probe =
        provider === 'deepl'
          ? await providerDeepL('hello', 'en', 'de', key.trim())
          : await providerGCloud('hello', 'en', 'de', key.trim());
      keyProblem = null;
      breaker.byo.fails = 0;
      breaker.byo.until = 0;
      return { ok: true, sample: probe.text };
    } catch (e) {
      const status = e && e.status;
      if (status === 401 || status === 403) return { ok: false, error: 'That key was rejected.' };
      if (status === 456) return { ok: false, error: 'That key is over its quota for this month.' };
      if (status === 429) return { ok: false, error: 'Rate limited — wait a moment and try again.' };
      return { ok: false, error: 'Could not reach the provider: ' + String((e && e.message) || e) };
    }
  },
  providerStatus: async () => {
    const s = await GL.store.getSettings();
    return { ok: true, provider: s.provider, hasKey: !!(s.apiKey || '').trim(), keyProblem };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // keep the channel open for the async reply
});

/* ------------------------------------------------------------- lifecycle -- */

/**
 * Chrome only injects content scripts as a page loads, so every tab that was
 * already open when the extension was installed or reloaded has no script in
 * it — hovering there does nothing, silently. Inject into them once, up front,
 * so the extension works immediately instead of after a manual reload.
 * content.js guards against running twice, so re-injection is harmless.
 */
async function injectIntoOpenTabs() {
  const declared = chrome.runtime.getManifest().content_scripts[0];

  // Filtering by URL in the query needs host access to read tab URLs. That
  // access comes from the content script's <all_urls> match rather than from a
  // separate wildcard host permission, so if the filtered query ever comes back
  // empty or throws, fall back to listing every tab and letting executeScript
  // reject the ones we may not touch. Silently injecting into nothing is the
  // exact failure this function exists to prevent.
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch (e) {
    tabs = [];
  }
  if (!tabs.length) {
    try {
      tabs = await chrome.tabs.query({});
    } catch (e) {
      return;
    }
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: declared.js });
      } catch (e) {
        // Chrome blocks injection on its own pages, the web store and PDFs.
      }
    })
  );
}

chrome.runtime.onInstalled.addListener(async (details) => {
  buildMenus();
  await GL.store.setSettings({}); // materialise defaults on first run
  await refreshBadge();
  await injectIntoOpenTabs();
  if (details.reason === 'install') openDashboard('#welcome');
});

chrome.runtime.onStartup.addListener(() => {
  buildMenus();
  refreshBadge();
});

chrome.alarms.create('gl-badge', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'gl-badge') refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[GL.store.KEYS.deck]) refreshBadge();
});
