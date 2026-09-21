/**
 * Single source of truth for settings, the vocabulary deck and usage stats.
 * Every surface (content script, popup, dashboard, worker) reads through here
 * so defaults never drift between them.
 */
(function () {
  const DEFAULTS = {
    enabled: true,
    sourceLang: 'auto',
    targetLang: 'en',
    // How a lookup is triggered: select | hover | both | off
    trigger: 'both',
    hoverDelay: 500,
    // Require a held key for hover lookups: none | alt | shift | ctrl
    hoverModifier: 'none',
    autoSpeak: false,
    speechRate: 0.9,
    showRomanization: true,
    showDictionary: true,
    showGrammarHints: true,
    theme: 'auto', // dark | light | auto
    fontSize: 15,
    minChars: 2,
    maxChars: 1200,
    blocklist: [],
    sessionLimit: 60,
    saveContext: true,
    // Which translator to try first: 'free' | 'deepl' | 'gcloud'.
    // 'free' uses the built-in public endpoints; the other two need the user's
    // own key and are only attempted once that key and its host permission are
    // in place. The free chain always remains as the fallback.
    provider: 'free',
    apiKey: '',
    // MyMemory raises the anonymous daily character cap when a contact address
    // is sent with the request. Optional, and never sent anywhere else.
    mymemoryEmail: ''
  };

  const KEYS = { settings: 'settings', deck: 'deck', stats: 'stats', cache: 'tcache' };

  const today = (d) => {
    const t = d ? new Date(d) : new Date();
    // Local calendar day, so a streak matches what the user experienced.
    return (
      t.getFullYear() +
      '-' +
      String(t.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(t.getDate()).padStart(2, '0')
    );
  };

  async function getSettings() {
    const res = await chrome.storage.local.get(KEYS.settings);
    return Object.assign({}, DEFAULTS, res[KEYS.settings] || {});
  }

  async function setSettings(patch) {
    const current = await getSettings();
    const next = Object.assign({}, current, patch);
    await chrome.storage.local.set({ [KEYS.settings]: next });
    return next;
  }

  async function getDeck() {
    const res = await chrome.storage.local.get(KEYS.deck);
    return Array.isArray(res[KEYS.deck]) ? res[KEYS.deck] : [];
  }

  async function saveDeck(cards) {
    await chrome.storage.local.set({ [KEYS.deck]: cards });
    return cards;
  }

  const normTerm = (s) => (s || '').trim().toLowerCase();

  /**
   * Adds a card unless an identical term/direction is already in the deck, in
   * which case the existing card is enriched but its schedule is left alone —
   * re-saving a word you are already learning must not reset your progress.
   */
  async function addCard(fields) {
    const deck = await getDeck();
    const key = normTerm(fields.term);
    const existing = deck.find(
      (c) => normTerm(c.term) === key && c.target === fields.target
    );
    if (existing) {
      if (!existing.context && fields.context) existing.context = fields.context;
      if (!existing.pos && fields.pos) existing.pos = fields.pos;
      if ((!existing.senses || !existing.senses.length) && fields.senses) existing.senses = fields.senses;
      await saveDeck(deck);
      return { card: existing, added: false, total: deck.length };
    }
    const card = globalThis.GL.srs.newCard(fields);
    deck.push(card);
    await saveDeck(deck);
    await bump('saves');
    return { card, added: true, total: deck.length };
  }

  async function removeCards(ids) {
    const set = new Set(ids);
    const deck = await getDeck();
    const kept = deck.filter((c) => !set.has(c.id));
    await saveDeck(kept);
    return kept;
  }

  async function getStats() {
    const res = await chrome.storage.local.get(KEYS.stats);
    const s = res[KEYS.stats] || {};
    return { days: s.days || {}, firstUse: s.firstUse || Date.now() };
  }

  /** Increments today's counter for `kind` (lookups | saves | reviews). */
  async function bump(kind, n) {
    const stats = await getStats();
    const key = today();
    const day = stats.days[key] || { lookups: 0, saves: 0, reviews: 0 };
    day[kind] = (day[kind] || 0) + (n || 1);
    stats.days[key] = day;
    // Keep a rolling year so the object cannot grow without bound.
    const cutoff = today(Date.now() - 400 * 86400000);
    Object.keys(stats.days).forEach((k) => {
      if (k < cutoff) delete stats.days[k];
    });
    await chrome.storage.local.set({ [KEYS.stats]: stats });
    return stats;
  }

  /** Consecutive days up to and including today with any activity. */
  function streakOf(days) {
    let streak = 0;
    for (let i = 0; ; i += 1) {
      const key = today(Date.now() - i * 86400000);
      const d = days[key];
      const active = d && (d.lookups || d.reviews || d.saves);
      if (!active) {
        // Today not yet active still counts as an unbroken streak from yesterday.
        if (i === 0) continue;
        break;
      }
      streak += 1;
      if (i > 400) break;
    }
    return streak;
  }

  globalThis.GL = Object.assign(globalThis.GL || {}, {
    store: {
      DEFAULTS,
      KEYS,
      today,
      getSettings,
      setSettings,
      getDeck,
      saveDeck,
      addCard,
      removeCards,
      getStats,
      bump,
      streakOf
    }
  });
})();
