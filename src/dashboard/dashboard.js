const GL = globalThis.GL;
const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  deck: [],
  stats: null,
  queue: [],
  index: 0,
  revealed: false,
  session: { again: 0, good: 0, total: 0 },
  selection: new Set()
};

/* ------------------------------------------------------------------ misc -- */

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1900);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const route = (from, to) =>
  GL.langLabel(from) + '  →  ' + GL.langLabel(to);

function dueLabel(card, now) {
  const delta = card.due - now;
  if (card.suspended) return 'suspended';
  if (delta <= 0) return 'now';
  return 'in ' + GL.srs.humanDelay(delta);
}

/* ----------------------------------------------------------------- theme -- */

const THEME_KEY = 'aks.theme';

function applyTheme(mode) {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (e) {
    /* storage can be blocked; the system default is a fine fallback */
  }
  applyTheme(saved || 'system');

  $('themeToggle').addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    const current = document.documentElement.getAttribute('data-theme') || 'system';
    const next = order[(order.indexOf(current) + 1) % order.length];
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* ignore */
    }
    toast('Theme: ' + next);
    // Bar widths and cell colors are CSS-driven, so nothing needs re-rendering.
  });
}

/* ------------------------------------------------------------------ tabs -- */

const TABS = ['review', 'deck', 'stats', 'settings'];

function showTab(name) {
  if (TABS.indexOf(name) === -1) name = 'review';
  TABS.forEach((t) => {
    $('panel-' + t).classList.toggle('hidden', t !== name);
    const btn = document.querySelector('[data-tab="' + t + '"]');
    btn.setAttribute('aria-selected', String(t === name));
  });
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (name === 'stats') renderStats();
  if (name === 'deck') renderDeck();
  if (name === 'review') renderReview();
}

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
}

/* ---------------------------------------------------------------- review -- */

function startSession(includeFuture) {
  const now = Date.now();
  state.queue = GL.srs.buildQueue(state.deck, now, state.settings.sessionLimit);
  if (!state.queue.length && includeFuture) {
    // "Study ahead": take the soonest cards even though they are not due yet.
    state.queue = state.deck
      .filter((c) => !c.suspended)
      .sort((a, b) => a.due - b.due)
      .slice(0, Math.min(20, state.settings.sessionLimit));
  }
  state.index = 0;
  state.revealed = false;
  state.session = { again: 0, good: 0, total: 0 };
}

function renderReview() {
  const counts = GL.srs.counts(state.deck);
  const pill = $('tabDue');
  pill.textContent = counts.due;
  pill.classList.toggle('zero', counts.due === 0);

  if (!state.queue.length) startSession(false);

  const hasQueue = state.index < state.queue.length;
  $('reviewStage').classList.toggle('hidden', !hasQueue);
  $('reviewEmpty').classList.toggle('hidden', hasQueue || state.session.total > 0);
  $('reviewDone').classList.toggle('hidden', hasQueue || state.session.total === 0);

  if (!hasQueue) {
    if (state.session.total > 0) {
      $('doneSummary').textContent =
        state.session.total +
        ' card' + (state.session.total === 1 ? '' : 's') + ' reviewed · ' +
        state.session.good + ' recalled · ' + state.session.again + ' to see again soon.';
    } else if (!state.deck.length) {
      $('reviewEmptyTitle').textContent = 'Your deck is empty';
      $('reviewEmptyBody').textContent =
        'Hover or select a word on any page, then press S in the tooltip to add it here.';
      $('studyAhead').classList.add('hidden');
    } else {
      $('reviewEmptyTitle').textContent = 'Nothing due right now';
      const soonest = state.deck
        .filter((c) => !c.suspended)
        .reduce((min, c) => (c.due < min ? c.due : min), Infinity);
      $('reviewEmptyBody').textContent =
        soonest === Infinity
          ? 'Every card is suspended.'
          : 'Next card is due in ' + GL.srs.humanDelay(soonest - Date.now()) + '.';
      $('studyAhead').classList.toggle('hidden', soonest === Infinity);
    }
    return;
  }

  const card = state.queue[state.index];
  const done = state.session.total;
  $('progressFill').style.width = (done / (done + state.queue.length - state.index)) * 100 + '%';
  $('queuePos').textContent = state.index + 1 + ' / ' + state.queue.length;

  const tag = $('cardState');
  tag.textContent = card.state === 'review' ? 'review · ' + GL.srs.humanDelay(card.interval * GL.srs.DAY) : card.state;
  tag.className = 'tag ' + card.state;

  $('flashRoute').textContent = route(card.source, card.target);
  const term = $('flashTerm');
  term.textContent = card.term;
  term.setAttribute('dir', GL.isRtl(card.source) ? 'rtl' : 'ltr');

  const hint = state.settings.showGrammarHints && card.source === 'de' ? GL.grammar.germanHint(card.term) : null;
  $('flashPos').textContent = [card.pos, hint && hint.article ? hint.article + ' ' + card.term : '']
    .filter(Boolean)
    .join(' · ');

  // Back of the card is built now but stays hidden until reveal.
  const answer = $('flashAnswer');
  answer.textContent = card.translation;
  answer.setAttribute('dir', GL.isRtl(card.target) ? 'rtl' : 'ltr');

  const senses = (card.senses || [])
    .map((s) => (s.pos ? s.pos + ': ' : '') + s.terms.join(', '))
    .slice(0, 3)
    .join('  ·  ');
  $('flashSenses').textContent = senses;
  $('flashSenses').classList.toggle('hidden', !senses);

  const ctx = $('flashContext');
  ctx.textContent = card.context ? '“' + card.context + '”' : '';
  ctx.classList.toggle('hidden', !card.context);

  const src = $('flashSource');
  if (card.url && /^https?:/i.test(card.url)) {
    src.href = card.url;
    src.textContent = card.title || card.url;
    src.classList.remove('hidden');
  } else {
    src.removeAttribute('href');
    src.classList.add('hidden');
  }

  setRevealed(false);

  const preview = GL.srs.intervalPreview(card);
  document.querySelectorAll('.grade').forEach((b) => {
    const key = GL.srs.GRADES[Number(b.dataset.grade)].key;
    b.querySelector('span').textContent = preview[key];
  });
}

function setRevealed(on) {
  state.revealed = on;
  $('flashBack').classList.toggle('hidden', !on);
  $('gradeRow').classList.toggle('hidden', !on);
  $('revealBtn').classList.toggle('hidden', on);
}

async function grade(value) {
  if (!state.revealed) return;
  const card = state.queue[state.index];
  const updated = GL.srs.review(card, value);

  const at = state.deck.findIndex((c) => c.id === card.id);
  if (at !== -1) state.deck[at] = updated;
  await GL.store.saveDeck(state.deck);
  await GL.store.bump('reviews');

  state.session.total += 1;
  if (value === 0) {
    state.session.again += 1;
    // A lapsed card comes back at the end of this session, not tomorrow.
    state.queue.push(updated);
  } else {
    state.session.good += 1;
  }

  state.index += 1;
  renderReview();
}

function speakCard() {
  const card = state.queue[state.index];
  if (!card || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(card.term);
  const tag = GL.bcp47(card.source);
  if (tag) u.lang = tag;
  u.rate = state.settings.speechRate;
  window.speechSynthesis.speak(u);
}

function initReview() {
  $('revealBtn').addEventListener('click', () => setRevealed(true));
  $('flashSpeak').addEventListener('click', speakCard);
  $('studyAhead').addEventListener('click', () => {
    startSession(true);
    renderReview();
  });
  $('doneAgain').addEventListener('click', () => {
    startSession(false);
    renderReview();
  });
  document.querySelectorAll('.grade').forEach((b) => {
    b.addEventListener('click', () => grade(Number(b.dataset.grade)));
  });

  document.addEventListener('keydown', (e) => {
    if ($('panel-review').classList.contains('hidden')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (!state.revealed) setRevealed(true);
      else grade(2);
      return;
    }
    if (e.key >= '1' && e.key <= '4' && state.revealed) {
      e.preventDefault();
      grade(Number(e.key) - 1);
      return;
    }
    if (e.key.toLowerCase() === 'p') {
      e.preventDefault();
      speakCard();
    }
  });
}

/* ------------------------------------------------------------------ deck -- */

function visibleCards() {
  const q = $('deckSearch').value.trim().toLowerCase();
  const lang = $('deckLang').value;
  const sort = $('deckSort').value;

  let rows = state.deck.slice();
  if (lang) rows = rows.filter((c) => c.source === lang);
  if (q) {
    rows = rows.filter((c) =>
      (c.term + ' ' + c.translation + ' ' + (c.context || '')).toLowerCase().includes(q)
    );
  }

  const sorters = {
    created: (a, b) => b.created - a.created,
    due: (a, b) => a.due - b.due,
    term: (a, b) => a.term.localeCompare(b.term),
    lapses: (a, b) => b.lapses - a.lapses || a.ease - b.ease
  };
  rows.sort(sorters[sort] || sorters.created);
  return rows;
}

function strengthOf(card) {
  // 0..1, saturating at a three-week interval — the point a card reads as "known".
  if (card.state !== 'review') return Math.min(0.25, card.reps * 0.06);
  return Math.min(1, 0.25 + (card.interval / 21) * 0.75);
}

function renderDeck() {
  const langSel = $('deckLang');
  if (langSel.options.length <= 1) {
    const seen = Array.from(new Set(state.deck.map((c) => c.source))).sort((a, b) =>
      GL.langName(a).localeCompare(GL.langName(b))
    );
    seen.forEach((code) => {
      const o = document.createElement('option');
      o.value = code;
      o.textContent = GL.langLabel(code);
      langSel.appendChild(o);
    });
  }

  const rows = visibleCards();
  const body = $('deckBody');
  body.replaceChildren();
  const now = Date.now();

  rows.forEach((card) => {
    const tr = el('tr');
    if (card.suspended) tr.className = 'suspended';

    const tdChk = el('td', 'chk');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = state.selection.has(card.id);
    chk.setAttribute('aria-label', 'Select ' + card.term);
    chk.addEventListener('change', () => {
      if (chk.checked) state.selection.add(card.id);
      else state.selection.delete(card.id);
      renderBulkBar();
    });
    tdChk.appendChild(chk);
    tr.appendChild(tdChk);

    const tdTerm = el('td');
    const termEl = el('div', 'cellTerm', card.term);
    if (GL.isRtl(card.source)) termEl.setAttribute('dir', 'rtl');
    tdTerm.appendChild(termEl);
    if (card.context) tdTerm.appendChild(el('div', 'cellCtx', '“' + card.context + '”'));
    tr.appendChild(tdTerm);

    const tdMean = el('td', 'cellMeaning');
    const meanEl = el('div', null, card.translation);
    if (GL.isRtl(card.target)) meanEl.setAttribute('dir', 'rtl');
    tdMean.appendChild(meanEl);
    if (card.pos) tdMean.appendChild(el('div', 'cellCtx', card.pos));
    tr.appendChild(tdMean);

    const tdDir = el('td');
    tdDir.appendChild(
      el('div', 'dir', GL.langName(card.source) + ' → ' + GL.langName(card.target))
    );
    tr.appendChild(tdDir);

    const tdStrength = el('td');
    const meter = el('div', 'meter');
    const fill = el('div', 'meterFill');
    fill.style.width = Math.round(strengthOf(card) * 100) + '%';
    meter.appendChild(fill);
    tdStrength.appendChild(meter);
    tdStrength.appendChild(
      el(
        'div',
        'meterNote',
        card.state === 'review'
          ? GL.srs.humanDelay(card.interval * GL.srs.DAY) + ' interval'
          : card.state + (card.lapses ? ' · ' + card.lapses + ' lapse' + (card.lapses > 1 ? 's' : '') : '')
      )
    );
    tr.appendChild(tdStrength);

    const tdDue = el('td');
    const isDueNow = !card.suspended && card.due <= now;
    tdDue.appendChild(el('div', 'due' + (isDueNow ? ' now' : ''), dueLabel(card, now)));
    tr.appendChild(tdDue);

    const tdDel = el('td');
    const del = el('button', 'rowDel', '✕');
    del.title = 'Delete this card';
    del.setAttribute('aria-label', 'Delete ' + card.term);
    del.addEventListener('click', async () => {
      state.deck = await GL.store.removeCards([card.id]);
      state.selection.delete(card.id);
      renderDeck();
      renderBulkBar();
      toast('Deleted “' + card.term + '”');
    });
    tdDel.appendChild(del);
    tr.appendChild(tdDel);

    body.appendChild(tr);
  });

  $('deckEmpty').classList.toggle('hidden', rows.length > 0);
  $('checkAll').checked = rows.length > 0 && rows.every((c) => state.selection.has(c.id));
  renderBulkBar();
}

function renderBulkBar() {
  const n = state.selection.size;
  $('bulkBar').classList.toggle('hidden', n === 0);
  $('bulkCount').textContent = n + ' selected';
}

/* --------------------------------------------------------------- export -- */

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

function exportCsv() {
  const rows = visibleCards();
  if (!rows.length) return toast('Nothing to export');
  const header = ['Term', 'Translation', 'Other meanings', 'Context', 'From', 'To', 'Source URL'];
  const lines = [header.map(csvCell).join(',')];
  rows.forEach((c) => {
    lines.push(
      [
        c.term,
        c.translation,
        (c.senses || []).map((s) => (s.pos ? s.pos + ': ' : '') + s.terms.join(', ')).join(' | '),
        c.context,
        GL.langName(c.source),
        GL.langName(c.target),
        c.url
      ]
        .map(csvCell)
        .join(',')
    );
  });
  // BOM so Excel opens non-Latin scripts correctly.
  download('akslingo-' + GL.store.today() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('Exported ' + rows.length + ' cards');
}

function exportJson() {
  const payload = {
    format: 'akslingo/deck',
    version: 1,
    exported: new Date().toISOString(),
    cards: state.deck,
    stats: state.stats
  };
  download('akslingo-backup-' + GL.store.today() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  toast('Backed up ' + state.deck.length + ' cards');
}

async function importJson(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    return toast('That file is not valid JSON');
  }
  const cards = Array.isArray(data) ? data : data && data.cards;
  if (!Array.isArray(cards)) return toast('No cards found in that file');

  const byKey = new Map(state.deck.map((c) => [c.term.toLowerCase() + '|' + c.target, c]));
  let added = 0;
  cards.forEach((raw) => {
    if (!raw || typeof raw.term !== 'string' || !raw.term.trim()) return;
    const key = raw.term.toLowerCase() + '|' + raw.target;
    if (byKey.has(key)) return;
    // Rebuild through newCard so a hand-edited or partial file still lands valid.
    const card = GL.srs.newCard(raw);
    byKey.set(key, card);
    state.deck.push(card);
    added += 1;
  });
  await GL.store.saveDeck(state.deck);
  chrome.runtime.sendMessage({ type: 'refreshBadge' });
  renderDeck();
  toast(added ? 'Added ' + added + ' cards' : 'Every card was already in your deck');
}

function initDeck() {
  ['deckSearch', 'deckLang', 'deckSort'].forEach((id) => {
    $(id).addEventListener('input', renderDeck);
    $(id).addEventListener('change', renderDeck);
  });

  $('checkAll').addEventListener('change', (e) => {
    const rows = visibleCards();
    if (e.target.checked) rows.forEach((c) => state.selection.add(c.id));
    else rows.forEach((c) => state.selection.delete(c.id));
    renderDeck();
  });

  $('bulkDelete').addEventListener('click', async () => {
    const n = state.selection.size;
    if (!n || !confirm('Delete ' + n + ' card' + (n === 1 ? '' : 's') + '? This cannot be undone.')) return;
    state.deck = await GL.store.removeCards(Array.from(state.selection));
    state.selection.clear();
    chrome.runtime.sendMessage({ type: 'refreshBadge' });
    renderDeck();
    toast('Deleted ' + n + ' cards');
  });

  $('bulkSuspend').addEventListener('click', async () => {
    let changed = 0;
    state.deck.forEach((c) => {
      if (state.selection.has(c.id)) {
        c.suspended = !c.suspended;
        changed += 1;
      }
    });
    await GL.store.saveDeck(state.deck);
    chrome.runtime.sendMessage({ type: 'refreshBadge' });
    state.selection.clear();
    renderDeck();
    toast('Toggled suspend on ' + changed + ' cards');
  });

  $('exportCsv').addEventListener('click', exportCsv);
  $('exportJson').addEventListener('click', exportJson);
  $('importJson').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJson(f);
    e.target.value = '';
  });
}

/* ----------------------------------------------------------------- stats -- */

/** Shared hover tooltip for the heatmap cells and the bars. */
function initVizTip() {
  const tip = el('div');
  tip.id = 'vizTip';
  tip.setAttribute('role', 'presentation');
  document.body.appendChild(tip);

  const show = (target) => {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    tip.classList.add('show');
    const r = target.getBoundingClientRect();
    // Measure first so the tooltip can be clamped inside the viewport.
    const w = tip.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const above = r.top > 44;
    tip.style.left = left + 'px';
    tip.style.top = (above ? r.top - tip.offsetHeight - 8 : r.bottom + 8) + 'px';
  };

  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) show(t);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest && e.target.closest('[data-tip]')) tip.classList.remove('show');
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) show(t);
  });
}

// Fixed bins rather than quantiles, so a cell means the same thing in any week.
const BINS = [1, 3, 7, 15];
const levelOf = (n) => (n <= 0 ? 0 : n < BINS[1] ? 1 : n < BINS[2] ? 2 : n < BINS[3] ? 3 : 4);

function renderHeatmap() {
  const wrap = $('heatmap');
  wrap.replaceChildren();

  const WEEKS = 26;
  const days = state.stats.days;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Wind back to the Monday that starts the first visible week.
  const start = new Date(now);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));
  const shift = (start.getDay() + 6) % 7; // 0 = Monday
  start.setDate(start.getDate() - shift);

  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  for (let i = 0; i < WEEKS * 7 + shift; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const cell = el('i', 'cell');

    if (d > now) {
      cell.className = 'cell future';
      wrap.appendChild(cell);
      continue;
    }

    const key = GL.store.today(d);
    const day = days[key] || {};
    const lookups = day.lookups || 0;
    const reviews = day.reviews || 0;
    const saves = day.saves || 0;
    const total = lookups + reviews;

    cell.className = 'cell l' + levelOf(total);
    cell.tabIndex = -1;
    cell.setAttribute(
      'data-tip',
      total === 0
        ? 'No activity · ' + fmt.format(d)
        : lookups + ' lookups, ' + reviews + ' reviews, ' + saves + ' saved · ' + fmt.format(d)
    );
    wrap.appendChild(cell);
  }

  document.querySelectorAll('.scale .cell').forEach((c, i) => {
    const labels = ['no activity', '1–2 a day', '3–6 a day', '7–14 a day', '15+ a day'];
    c.setAttribute('data-tip', labels[i]);
  });
}

function renderBars(container, tableBody, rows, unit) {
  container.replaceChildren();
  tableBody.replaceChildren();

  if (!rows.length) {
    container.appendChild(el('p', 'note', 'Nothing to show yet.'));
    return;
  }

  const max = Math.max.apply(null, rows.map((r) => r.value)) || 1;
  rows.forEach((r) => {
    const bar = el('div', 'bar');
    bar.appendChild(el('div', 'barLabel', r.label));

    const track = el('div', 'barTrack');
    const fill = el('div', 'barFill');
    fill.style.width = Math.max(2, (r.value / max) * 100) + '%';
    fill.setAttribute('data-tip', r.label + ': ' + r.value + ' ' + unit);
    track.appendChild(fill);
    bar.appendChild(track);

    bar.appendChild(el('div', 'barValue', String(r.value)));
    container.appendChild(bar);

    const tr = el('tr');
    tr.appendChild(el('td', null, r.label));
    tr.appendChild(el('td', null, String(r.value)));
    tableBody.appendChild(tr);
  });
}

function renderStats() {
  const counts = GL.srs.counts(state.deck);
  const days = state.stats.days;
  const totalLookups = Object.keys(days).reduce((sum, k) => sum + (days[k].lookups || 0), 0);

  $('tWords').textContent = counts.total;
  $('tStreak').textContent = GL.store.streakOf(days);
  $('tMature').textContent = counts.mature;
  $('tLookups').textContent = totalLookups;

  renderHeatmap();

  // Words saved by language — nominal categories, so one hue for every bar.
  const byLang = new Map();
  state.deck.forEach((c) => byLang.set(c.source, (byLang.get(c.source) || 0) + 1));
  const langRows = Array.from(byLang.entries())
    .map(([code, value]) => ({ label: GL.langLabel(code), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  renderBars($('langBars'), $('langTable'), langRows, 'words');

  const maturity = [
    { label: 'New / learning', value: counts.learning },
    { label: 'Young · under 3wk', value: counts.young },
    { label: 'Known well · 3wk+', value: counts.mature }
  ].filter((r) => r.value > 0 || counts.total > 0);
  renderBars($('maturityBars'), $('maturityTable'), maturity, 'cards');
}

/* -------------------------------------------------------------- settings -- */

const RANGES = {
  sHoverDelay: { key: 'hoverDelay', fmt: (v) => v + ' ms' },
  sFontSize: { key: 'fontSize', fmt: (v) => v + ' px' },
  sSpeechRate: { key: 'speechRate', fmt: (v) => Number(v).toFixed(2) + '×' },
  sSessionLimit: { key: 'sessionLimit', fmt: (v) => v + ' cards' }
};

const SELECTS = {
  sSource: 'sourceLang',
  sTarget: 'targetLang',
  sTrigger: 'trigger',
  sHoverModifier: 'hoverModifier',
  sTheme: 'theme'
};

const CHECKS = {
  sShowDictionary: 'showDictionary',
  sShowRomanization: 'showRomanization',
  sShowGrammarHints: 'showGrammarHints',
  sSaveContext: 'saveContext',
  sAutoSpeak: 'autoSpeak'
};

function fillLangSelect(select, withAuto) {
  GL.sortedCodes(withAuto).forEach((code) => {
    const lang = GL.langs[code];
    const o = document.createElement('option');
    o.value = code;
    o.textContent = code === 'auto' ? '🌐 Auto-detect' : GL.langLabel(code);
    select.appendChild(o);
  });
}

async function patch(p) {
  state.settings = await GL.store.setSettings(p);
}

/* ------------------------------------------------------ translation provider -- */

/**
 * The keyed providers are reached through optional host permissions rather than
 * ones granted at install. Someone who never supplies a key is never asked to
 * grant access to DeepL or Google Cloud, which keeps the install prompt to what
 * the extension actually needs on day one.
 */
const PROVIDER_ORIGINS = {
  deepl: ['https://api.deepl.com/*', 'https://api-free.deepl.com/*'],
  gcloud: ['https://translation.googleapis.com/*']
};

const PROVIDER_NOTES = {
  free:
    'Uses public endpoints with no setup. They rate-limit by IP, so heavy use ' +
    'can hit a wall for a few minutes at a time.',
  deepl:
    'Usually the best quality for European languages. DeepL has no Urdu, ' +
    'Hindi or Persian — those pairs fall back to the free service automatically.',
  gcloud:
    'Covers every language in the list, including Urdu. Billed per character ' +
    'by Google, with a free monthly allowance.'
};

function renderProvider() {
  const s = state.settings;
  const provider = s.provider || 'free';
  $('sProvider').value = provider;
  $('providerNote').textContent = PROVIDER_NOTES[provider] || '';
  $('keyRow').classList.toggle('hidden', provider === 'free');
  $('sApiKey').value = s.apiKey || '';
  $('sMymemoryEmail').value = s.mymemoryEmail || '';

  // A key that the worker has since seen rejected is worth surfacing here, or
  // the user is left wondering why the provider they configured never answers.
  if (provider !== 'free') {
    chrome.runtime.sendMessage({ type: 'providerStatus' }).then((res) => {
      if (!res || !res.ok || !res.keyProblem) return;
      if (res.keyProblem.provider !== provider) return;
      $('keyNote').textContent =
        res.keyProblem.kind === 'rejected'
          ? 'This key was rejected on the last lookup — translations are coming from the free service.'
          : 'This key is over its quota — translations are coming from the free service.';
      $('keyNote').className = 'note bad';
    }).catch(() => {});
  }
}

function initProvider() {
  $('sProvider').addEventListener('change', async () => {
    const provider = $('sProvider').value;
    $('keyNote').textContent = '';
    $('keyNote').className = 'note';

    // Ask for the host permission at the moment the user opts in, which is when
    // the request makes sense to them. Declining leaves the provider unchanged.
    if (PROVIDER_ORIGINS[provider]) {
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: PROVIDER_ORIGINS[provider] });
      } catch (e) {
        granted = false;
      }
      if (!granted) {
        $('sProvider').value = state.settings.provider || 'free';
        toast('Left on the free service — access was not granted');
        return;
      }
    }

    await patch({ provider });
    renderProvider();
  });

  let keyTimer;
  $('sApiKey').addEventListener('input', () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => patch({ apiKey: $('sApiKey').value.trim() }), 500);
  });

  let mailTimer;
  $('sMymemoryEmail').addEventListener('input', () => {
    clearTimeout(mailTimer);
    mailTimer = setTimeout(() => patch({ mymemoryEmail: $('sMymemoryEmail').value.trim() }), 600);
  });

  $('testKey').addEventListener('click', async () => {
    const provider = $('sProvider').value;
    const key = $('sApiKey').value.trim();
    const note = $('keyNote');
    note.className = 'note';
    note.textContent = 'Checking…';
    await patch({ apiKey: key });

    const res = await chrome.runtime
      .sendMessage({ type: 'testKey', payload: { provider, key } })
      .catch(() => null);

    if (res && res.ok) {
      note.className = 'note good';
      note.textContent = 'Key works — “hello” came back as “' + res.sample + '”.';
    } else {
      note.className = 'note bad';
      note.textContent = (res && res.error) || 'Could not check that key.';
    }
  });

  $('clearKey').addEventListener('click', async () => {
    $('sApiKey').value = '';
    $('keyNote').textContent = '';
    $('keyNote').className = 'note';
    await patch({ apiKey: '', provider: 'free' });
    renderProvider();
    toast('Key removed — back on the free service');
  });
}

function renderSettings() {
  const s = state.settings;
  Object.keys(SELECTS).forEach((id) => ($(id).value = s[SELECTS[id]]));
  Object.keys(CHECKS).forEach((id) => ($(id).checked = !!s[CHECKS[id]]));
  Object.keys(RANGES).forEach((id) => {
    const cfg = RANGES[id];
    $(id).value = s[cfg.key];
    $(id + 'Val').textContent = cfg.fmt(s[cfg.key]);
  });
  $('sBlocklist').value = (s.blocklist || []).join('\n');
  renderProvider();
}

function initSettings() {
  fillLangSelect($('sSource'), true);
  fillLangSelect($('sTarget'), false);
  initProvider();

  Object.keys(SELECTS).forEach((id) => {
    $(id).addEventListener('change', () => patch({ [SELECTS[id]]: $(id).value }));
  });
  Object.keys(CHECKS).forEach((id) => {
    $(id).addEventListener('change', () => patch({ [CHECKS[id]]: $(id).checked }));
  });
  Object.keys(RANGES).forEach((id) => {
    const cfg = RANGES[id];
    $(id).addEventListener('input', () => {
      const v = cfg.key === 'speechRate' ? Number($(id).value) : Number($(id).value);
      $(id + 'Val').textContent = cfg.fmt(v);
      patch({ [cfg.key]: v });
    });
  });

  let blockTimer;
  $('sBlocklist').addEventListener('input', () => {
    clearTimeout(blockTimer);
    blockTimer = setTimeout(() => {
      const list = $('sBlocklist')
        .value.split('\n')
        .map((l) => l.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
        .filter(Boolean);
      patch({ blocklist: Array.from(new Set(list)) });
    }, 600);
  });

  $('reportIssue').addEventListener('click', async () => {
    // Deliberately carries no deck contents and no page history — only which
    // way the user is translating, which is what most reports turn out to hinge
    // on. Everything else they can type themselves.
    const s = state.settings;
    await chrome.runtime.sendMessage({
      type: 'reportIssue',
      payload: {
        kind: 'bug',
        subject: '',
        details: 'Direction: ' + s.sourceLang + ' → ' + s.targetLang +
          '\nProvider: ' + (s.provider || 'free')
      }
    });
  });

  $('openRepo').addEventListener('click', () => {
    const url = chrome.runtime.getManifest().homepage_url;
    if (url) chrome.tabs.create({ url });
  });

  $('clearCache').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clearCache' });
    toast('Translation cache cleared');
  });

  $('resetSettings').addEventListener('click', async () => {
    if (!confirm('Reset every setting to its default? Your deck stays as it is.')) return;
    await chrome.storage.local.remove(GL.store.KEYS.settings);
    state.settings = await GL.store.getSettings();
    renderSettings();
    toast('Settings reset');
  });
}

/* ------------------------------------------------------------------ boot -- */

async function boot() {
  initTheme();
  initVizTip();
  initReview();
  initDeck();
  initSettings();

  const [settings, deck, stats] = await Promise.all([
    GL.store.getSettings(),
    GL.store.getDeck(),
    GL.store.getStats()
  ]);
  state.settings = settings;
  state.deck = deck;
  state.stats = stats;

  renderSettings();
  // Tab handlers go on last: every render reads the state loaded above, so a
  // click that lands before this point would find it still null.
  initTabs();

  const hash = location.hash.slice(1);
  showTab(hash === 'welcome' ? 'settings' : hash);
  if (hash === 'welcome') {
    toast('Welcome — pick your languages, then hover any word on a page');
  }

  // Another tab (or the tooltip's save button) can change the deck under us.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes[GL.store.KEYS.deck]) {
      state.deck = await GL.store.getDeck();
      if (!$('panel-deck').classList.contains('hidden')) renderDeck();
      if (!$('panel-review').classList.contains('hidden')) renderReview();
    }
    if (changes[GL.store.KEYS.settings]) {
      state.settings = await GL.store.getSettings();
      renderSettings();
    }
    if (changes[GL.store.KEYS.stats]) {
      state.stats = await GL.store.getStats();
      if (!$('panel-stats').classList.contains('hidden')) renderStats();
    }
  });
}

boot();
