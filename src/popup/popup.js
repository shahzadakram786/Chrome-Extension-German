const GL = globalThis.GL;

const $ = (id) => document.getElementById(id);

const ui = {
  enabled: $('enabled'),
  source: $('source'),
  target: $('target'),
  swap: $('swap'),
  trigger: $('trigger'),
  siteEnabled: $('siteEnabled'),
  siteHost: $('siteHost'),
  statDue: $('statDue'),
  statWords: $('statWords'),
  statStreak: $('statStreak'),
  review: $('review'),
  refresh: $('refresh')
};

let settings = null;
let host = '';
let activeTab = null;

function fillSelect(select, withAuto) {
  GL.sortedCodes(withAuto).forEach((code) => {
    const lang = GL.langs[code];
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent =
      code === 'auto'
        ? 'Auto-detect'
        : GL.langLabel(code) + (lang.native !== lang.name ? '  ·  ' + lang.native : '');
    select.appendChild(opt);
  });
}

function paintTrigger(value) {
  ui.trigger.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.value === value));
  });
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
};

const covers = (h, b) => !!b && (h === b || h.endsWith('.' + b));
const blocked = (h, list) => list.some((b) => covers(h, b));

const webPage = (tab) => /^https?:/.test((tab && tab.url) || '');

/**
 * Chrome injects content scripts when a page loads, so any tab that was already
 * open when the extension was installed or reloaded has no script running in it
 * — hovering and selecting there does nothing at all, with no visible error.
 * Ping the tab; if nothing answers, say so and offer the reload that fixes it.
 */
function showBanner(text, actionLabel, onAction, tone) {
  $('bannerText').textContent = text;
  $('banner').classList.remove('hidden');
  $('banner').classList.toggle('ok', tone === 'ok');
  const btn = $('bannerAction');
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.classList.remove('hidden');
    btn.onclick = onAction;
  } else {
    btn.classList.add('hidden');
  }
}

const hideBanner = () => $('banner').classList.add('hidden');

async function ping(tab) {
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'gl:ping' });
  } catch (e) {
    return null; // nothing is listening in that tab
  }
}

/**
 * Starts a fresh copy of AksLingo in the tab without reloading the page, so
 * nothing the user typed or scrolled to is lost. A copy already running there
 * hands over to the new one (see the top of content.js), which is also what
 * clears a tooltip that has got itself stuck.
 */
async function startHere(tab) {
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
  } catch (e) {
    return false; // the web store, PDFs and some Chrome pages refuse scripts
  }
  return !!(await ping(tab));
}

function offerReload(tab, text) {
  showBanner(text, 'Reload page', () => {
    chrome.tabs.reload(tab.id);
    window.close();
  });
}

async function checkTab(tab) {
  if (!webPage(tab)) {
    showBanner('AksLingo only runs on web pages, not on browser or extension pages.');
    return;
  }

  const status = await ping(tab);

  if (!status) {
    showBanner('Not running on this tab yet — it was open before AksLingo loaded.', 'Start here', async () => {
      if (await startHere(tab)) {
        showBanner('AksLingo is running on this tab now.', null, null, 'ok');
      } else {
        offerReload(tab, 'Could not start on this page without a reload.');
      }
    });
    return;
  }

  hideBanner();
  if (status.siteDisabled) {
    showBanner('Turned off for ' + status.host + '. Use the switch below to turn it back on.');
  } else if (!status.enabled) {
    showBanner('AksLingo is switched off. Use the toggle at the top right.');
  } else if (status.trigger === 'off') {
    showBanner('Trigger is set to Off, so nothing will happen on hover or select.');
  }
}

// "Auto-detect" cannot be a target, so there is nothing to swap it with.
function paintSwap() {
  ui.swap.disabled = ui.source.value === 'auto';
  ui.swap.title = ui.swap.disabled ? 'Pick a source language to swap' : 'Swap languages';
}

function paintSettings() {
  ui.enabled.checked = settings.enabled;
  ui.source.value = settings.sourceLang;
  ui.target.value = settings.targetLang;
  paintTrigger(settings.trigger);
  paintSwap();
  const scriptable = !!host && webPage(activeTab);
  ui.siteHost.textContent = scriptable ? host : 'not available on this page';
  ui.siteEnabled.disabled = !scriptable;
  ui.siteEnabled.checked = scriptable && !blocked(host, settings.blocklist);
}

async function paintStats() {
  const [deck, stats] = await Promise.all([GL.store.getDeck(), GL.store.getStats()]);
  const counts = GL.srs.counts(deck);
  ui.statDue.textContent = counts.due;
  ui.statWords.textContent = counts.total;
  ui.statStreak.textContent = GL.store.streakOf(stats.days);

  ui.review.classList.toggle('quiet', counts.due === 0);
  if (counts.total === 0) {
    ui.review.textContent = 'Save a word to start a deck';
  } else if (counts.due === 0) {
    ui.review.textContent = 'All caught up — browse deck';
  } else {
    ui.review.textContent = 'Review ' + counts.due + ' card' + (counts.due === 1 ? '' : 's');
  }
}

async function load() {
  fillSelect(ui.source, true);
  fillSelect(ui.target, false);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  host = hostOf((tab && tab.url) || '');
  ui.refresh.disabled = !webPage(tab);

  settings = await GL.store.getSettings();
  paintSettings();
  await paintStats();

  checkTab(activeTab);
}

ui.refresh.addEventListener('click', async () => {
  if (!webPage(activeTab) || ui.refresh.disabled) return;
  ui.refresh.disabled = true;
  ui.refresh.classList.add('spin');
  const started = await startHere(activeTab);
  settings = await GL.store.getSettings();
  paintSettings();
  await paintStats();
  ui.refresh.classList.remove('spin');
  ui.refresh.disabled = false;
  if (started) {
    showBanner('Restarted on this tab.', null, null, 'ok');
    // Then say what still stands in the way, if anything.
    setTimeout(() => checkTab(activeTab), 1400);
  } else {
    offerReload(activeTab, 'Could not restart on this page without a reload.');
  }
});

const patch = (p) => GL.store.setSettings(p).then((next) => (settings = next));

ui.enabled.addEventListener('change', () => patch({ enabled: ui.enabled.checked }));
ui.source.addEventListener('change', () => {
  paintSwap();
  patch({ sourceLang: ui.source.value });
});
ui.target.addEventListener('change', () => patch({ targetLang: ui.target.value }));

ui.swap.addEventListener('click', () => {
  const from = ui.source.value;
  const to = ui.target.value;
  // Swapping out of "auto" used to set both sides to the target language,
  // which translates nothing. The button is disabled then; this is the backstop.
  if (from === 'auto') return;
  ui.source.value = to;
  ui.target.value = from;
  paintSwap();
  patch({ sourceLang: to, targetLang: from });
});

ui.trigger.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  paintTrigger(btn.dataset.value);
  patch({ trigger: btn.dataset.value });
});

ui.siteEnabled.addEventListener('change', async () => {
  if (!host) return;
  // Turning a site back on clears every entry that covers it. Removing only
  // the exact host left "example.com" blocking www.example.com, so the switch
  // showed on while the site stayed off.
  const list = settings.blocklist.filter((b) => !covers(host, b));
  if (!ui.siteEnabled.checked) list.push(host);
  await patch({ blocklist: list });
  checkTab(activeTab);
});

ui.review.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'openDashboard', payload: { hash: '#review' } });
  window.close();
});

document.querySelectorAll('.links a').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'openDashboard', payload: { hash: a.dataset.hash } });
    window.close();
  });
});

load();
