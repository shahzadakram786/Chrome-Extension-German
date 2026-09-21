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
  reviewCount: $('reviewCount')
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

const blocked = (h, list) => list.some((b) => b && (h === b || h.endsWith('.' + b)));

/**
 * Chrome injects content scripts when a page loads, so any tab that was already
 * open when the extension was installed or reloaded has no script running in it
 * — hovering and selecting there does nothing at all, with no visible error.
 * Ping the tab; if nothing answers, say so and offer the reload that fixes it.
 */
function showBanner(text, actionLabel, onAction) {
  $('bannerText').textContent = text;
  $('banner').classList.remove('hidden');
  const btn = $('bannerAction');
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.classList.remove('hidden');
    btn.onclick = onAction;
  } else {
    btn.classList.add('hidden');
  }
}

async function checkTab(tab) {
  const url = (tab && tab.url) || '';

  if (!/^https?:/.test(url)) {
    showBanner('AksLingo only runs on web pages, not on browser or extension pages.');
    return;
  }

  let status = null;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'gl:ping' });
  } catch (e) {
    status = null; // nothing is listening in that tab
  }

  if (!status) {
    showBanner('Not running on this tab yet — pages open before the extension loaded need a reload.', 'Reload', () => {
      chrome.tabs.reload(tab.id);
      window.close();
    });
    return;
  }

  if (status.siteDisabled) {
    showBanner('Turned off for ' + status.host + '. Use the switch below to turn it back on.');
  } else if (!status.enabled) {
    showBanner('AksLingo is switched off. Use the toggle at the top right.');
  } else if (status.trigger === 'off') {
    showBanner('Trigger is set to Off, so nothing will happen on hover or select.');
  }
}

async function load() {
  fillSelect(ui.source, true);
  fillSelect(ui.target, false);

  settings = await GL.store.getSettings();
  ui.enabled.checked = settings.enabled;
  ui.source.value = settings.sourceLang;
  ui.target.value = settings.targetLang;
  paintTrigger(settings.trigger);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  host = hostOf((tab && tab.url) || '');
  const scriptable = host && /^https?:/.test((tab && tab.url) || '');
  ui.siteHost.textContent = scriptable ? host : 'not available on this page';
  ui.siteEnabled.disabled = !scriptable;
  ui.siteEnabled.checked = scriptable && !blocked(host, settings.blocklist);

  const [deck, stats] = await Promise.all([GL.store.getDeck(), GL.store.getStats()]);
  const counts = GL.srs.counts(deck);
  ui.statDue.textContent = counts.due;
  ui.statWords.textContent = counts.total;
  ui.statStreak.textContent = GL.store.streakOf(stats.days);
  ui.reviewCount.textContent = counts.due;

  if (counts.total === 0) {
    ui.review.textContent = 'Save a word to start a deck';
    ui.review.classList.add('quiet');
  } else if (counts.due === 0) {
    ui.review.textContent = 'All caught up — browse deck';
    ui.review.classList.add('quiet');
  }

  checkTab(activeTab);
}

const patch = (p) => GL.store.setSettings(p).then((next) => (settings = next));

ui.enabled.addEventListener('change', () => patch({ enabled: ui.enabled.checked }));
ui.source.addEventListener('change', () => patch({ sourceLang: ui.source.value }));
ui.target.addEventListener('change', () => patch({ targetLang: ui.target.value }));

ui.swap.addEventListener('click', () => {
  const from = ui.source.value;
  const to = ui.target.value;
  // "auto" cannot be a target, so swapping out of auto keeps the target as-is.
  ui.source.value = to;
  if (from !== 'auto') ui.target.value = from;
  patch({ sourceLang: ui.source.value, targetLang: ui.target.value });
});

ui.trigger.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  paintTrigger(btn.dataset.value);
  patch({ trigger: btn.dataset.value });
});

ui.siteEnabled.addEventListener('change', async () => {
  if (!host) return;
  const list = settings.blocklist.filter((b) => b !== host);
  if (!ui.siteEnabled.checked) list.push(host);
  await patch({ blocklist: list });
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
