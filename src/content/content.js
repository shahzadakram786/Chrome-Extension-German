/**
 * Page-side orchestration: decide what the user is pointing at, ask the worker
 * to translate it, and drive the tooltip. Deliberately holds no network code.
 */
(function () {
  if (window.__aksLingoLoaded) return;
  window.__aksLingoLoaded = true;

  const GL = globalThis.GL;

  let settings = Object.assign({}, GL.store.DEFAULTS);
  let siteDisabled = false;
  let tip = null;
  let hoverTimer = null;
  let lookupToken = 0;
  let last = null; // { term, source, target, result, context }

  /* ------------------------------------------------------------ settings -- */

  const host = location.hostname;

  function applySettings(next) {
    settings = next;
    siteDisabled = (settings.blocklist || []).some(
      (b) => b && (host === b || host.endsWith('.' + b))
    );
    if (tip) tip.applyTheme(settings.theme, settings.fontSize);
    if ((!settings.enabled || siteDisabled) && tip) tip.hide();
  }

  GL.store.getSettings().then(applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[GL.store.KEYS.settings]) {
      GL.store.getSettings().then(applySettings);
    }
  });

  const active = () => settings.enabled && !siteDisabled && settings.trigger !== 'off';

  /* ------------------------------------------------------- text analysis -- */

  const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
  const WORDISH = /[\p{L}\p{M}\p{N}]/u;

  let segmenter = null;
  let sentencer = null;
  try {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    sentencer = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  } catch (e) {
    /* older browsers fall back to the regex path below */
  }

  const minCharsFor = (text) => (CJK.test(text) ? 1 : settings.minChars);

  function caretFromPoint(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p && p.offsetNode ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  }

  /**
   * The word under the cursor, as a Range so we can anchor the tooltip to the
   * word itself rather than to the mouse. Uses Intl.Segmenter, which is what
   * makes this work for Chinese, Japanese and Thai — languages that do not
   * put spaces between words.
   */
  function wordAtPoint(x, y) {
    const pos = caretFromPoint(x, y);
    if (!pos || pos.node.nodeType !== Node.TEXT_NODE) return null;

    const node = pos.node;
    const text = node.textContent;
    if (!text || !text.trim()) return null;

    let start = -1;
    let end = -1;

    if (segmenter) {
      for (const seg of segmenter.segment(text)) {
        const segEnd = seg.index + seg.segment.length;
        if (pos.offset >= seg.index && pos.offset < segEnd) {
          if (!seg.isWordLike) return null;
          start = seg.index;
          end = segEnd;
          break;
        }
      }
    } else {
      const re = /[\p{L}\p{M}\p{N}'’‐-―-]+/gu;
      let m;
      while ((m = re.exec(text))) {
        if (pos.offset >= m.index && pos.offset < m.index + m[0].length) {
          start = m.index;
          end = m.index + m[0].length;
          break;
        }
      }
    }

    if (start < 0) return null;
    const word = text.slice(start, end).trim();
    if (!word || !WORDISH.test(word) || word.length < minCharsFor(word)) return null;

    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return { word, range, node, start, end };
  }

  /**
   * The sentence a word sits in. Saved alongside the card so review has
   * context, and — more importantly — used to identify the language, because
   * detecting from one word is a coin flip. The public endpoint reads the
   * German "Haus" as English with 0.70 confidence and hands it back untranslated.
   */
  function sentenceAround(node, start) {
    if (!node) return '';
    const text = (node.textContent || '').replace(/\s+/g, ' ');
    if (text.length < 12) return '';
    if (!sentencer) return text.slice(0, 200);
    for (const seg of sentencer.segment(text)) {
      if (start >= seg.index && start < seg.index + seg.segment.length) {
        const s = seg.segment.trim();
        return s.length > 300 ? s.slice(0, 300) + '…' : s;
      }
    }
    return text.slice(0, 200);
  }

  /**
   * Resolves "auto" into a concrete language before asking for a translation.
   *
   * Chrome ships an offline language detector, and we feed it the whole
   * sentence rather than the hovered word — a sentence identifies a language
   * reliably, a single word does not. The page's own `lang` attribute is the
   * next best evidence. Only if both come up empty do we let the translation
   * service guess, which is where it used to get German words wrong.
   */
  async function effectiveSource(word, sentence) {
    if (settings.sourceLang !== 'auto') return settings.sourceLang;

    const sample = sentence && sentence.length >= 20 ? sentence : word;
    try {
      const res = await chrome.i18n.detectLanguage(sample);
      const top = res && res.languages && res.languages[0];
      if (top && top.percentage >= 50) {
        const code = GL.canonical(top.language);
        if (code) return code;
      }
    } catch (e) {
      /* detector unavailable — fall through to the page's own declaration */
    }

    const declared = (document.documentElement.getAttribute('lang') || '').trim();
    if (declared) {
      const code = GL.canonical(declared.split(',')[0].trim());
      if (code) return code;
    }

    return 'auto';
  }

  const isEditable = (node) => {
    const elNode = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!elNode || !elNode.closest) return false;
    return !!elNode.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  };

  /* -------------------------------------------------------------- speech -- */

  let voices = [];
  const loadVoices = () => {
    try {
      voices = window.speechSynthesis.getVoices() || [];
    } catch (e) {
      voices = [];
    }
  };
  loadVoices();
  if (window.speechSynthesis) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

  function pickVoice(tag) {
    if (!tag || !voices.length) return null;
    const base = tag.split('-')[0];
    return (
      voices.find((v) => v.lang === tag || v.lang === tag.replace('-', '_')) ||
      voices.find((v) => v.lang && v.lang.split(/[-_]/)[0] === base && v.localService) ||
      voices.find((v) => v.lang && v.lang.split(/[-_]/)[0] === base) ||
      null
    );
  }

  function speak(text, langCode, slow) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const tag = GL.bcp47(langCode);
    if (tag) u.lang = tag;
    const v = pickVoice(tag);
    if (v) u.voice = v;
    u.rate = slow ? 0.5 : settings.speechRate;
    window.speechSynthesis.speak(u);
  }

  /* ------------------------------------------------------------- tooltip -- */

  function tooltip() {
    if (tip) return tip;
    tip = new globalThis.GL_Tooltip({
      onSpeak: (slow) => last && speak(last.term, last.detected || last.source, slow),
      onSwap: () => {
        if (!last) return;
        // Flip direction using what was actually detected, not "auto".
        const newSource = last.result ? last.result.target : last.target;
        const newTarget = last.detected || last.source;
        runLookup(last.term, last.anchorRect, {
          source: newSource,
          target: newTarget,
          node: last.node,
          start: last.start
        });
      },
      onCopy: async () => {
        if (!last || !last.result) return;
        try {
          await navigator.clipboard.writeText(last.result.text);
          tip.toast('Copied');
        } catch (e) {
          tip.toast('Copy blocked by page');
        }
      },
      onSave: saveCurrent,
      onReport: (grammar) => reportGrammar(grammar)
    });
    tip.applyTheme(settings.theme, settings.fontSize);
    return tip;
  }

  /**
   * Builds a bug report for the grammar panel and hands it to the worker to
   * open.
   *
   * What goes in is deliberately narrow: the word, what the engine decided
   * about it, and the version. The page URL, its title and the sentence the
   * word came from are all available right here and all deliberately left out —
   * the privacy policy says page content never leaves the machine, and a
   * convenience feature is not a reason to make that untrue. A report about
   * "können" does not need to know you were reading your bank's website.
   */
  function reportGrammar(a) {
    if (!a) return;
    const lines = [];

    if (a.type === 'verb') {
      const c = a.conjugation;
      lines.push('Word shown: ' + (a.word || c.infinitive));
      lines.push('Infinitive: ' + c.infinitive);
      lines.push('Classified as: ' + c.kind + (c.modal ? ' (modal)' : ''));
      lines.push('Principal parts: ' + [c.infinitive, c.tenses[1].forms[2], c.partizip2].join(' · '));
      lines.push('Perfekt auxiliary: ' + c.auxiliary);
      if (c.separable) lines.push('Separable prefix: ' + c.separable);
      lines.push('From: ' + (c.source === 'rules' ? 'regular-verb rules' : 'the irregular table'));
    } else if (a.type === 'noun') {
      lines.push('Word shown: ' + a.declension.word);
      lines.push('Gender given: ' + a.declension.gender);
    } else if (a.comparison) {
      lines.push('Word shown: ' + a.comparison.positive);
      lines.push('Komparativ · Superlativ: ' +
        a.comparison.comparative + ' · ' + a.comparison.superlative);
    }

    chrome.runtime
      .sendMessage({
        type: 'reportIssue',
        payload: { kind: 'grammar', subject: lines[0] || 'Grammar', details: lines.join('\n') }
      })
      .catch(() => tip && tip.toast('Could not open the report form'));
  }

  async function saveCurrent() {
    if (!last || !last.result) return;
    const res = await chrome.runtime.sendMessage({
      type: 'saveCard',
      payload: {
        term: last.term,
        translation: last.result.text,
        source: last.detected || last.source,
        target: last.result.target || last.target,
        pos: last.result.pos || '',
        senses: last.result.senses || [],
        context: last.context || '',
        url: location.href,
        title: document.title
      }
    });
    if (res && res.ok) tip.markSaved(res.added);
  }

  /* -------------------------------------------------------------- lookup -- */

  async function runLookup(term, rect, opts) {
    opts = opts || {};
    const target = opts.target || settings.targetLang;
    const t = tooltip();
    const token = ++lookupToken;
    const sentence = sentenceAround(opts.node, opts.start);

    last = {
      term,
      source: opts.source || settings.sourceLang,
      target,
      anchorRect: rect,
      node: opts.node,
      start: opts.start,
      context: settings.saveContext ? sentence : '',
      result: null,
      detected: null
    };

    t.setLoading(term, last.source);
    t.showAt(rect);

    // Resolve "auto" from the sentence before asking, not from the word after.
    const source = opts.source || (await effectiveSource(term, sentence));
    if (token !== lookupToken) return; // a newer lookup started while detecting
    last.source = source;

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'translate',
        payload: { text: term, source, target, rich: term.length <= 40 }
      });
    } catch (e) {
      // Worker restarted mid-flight, or the extension was reloaded.
      res = { ok: false, error: 'Extension reloading — try again' };
    }

    if (token !== lookupToken || !t.visible) return; // a newer lookup won

    if (!res || !res.ok) {
      t.setError((res && res.error) || 'Translation failed');
      return;
    }

    last.result = res;
    last.detected = res.detected;
    t.setResult(res, {
      sourceLang: source,
      targetLang: target,
      showRomanization: settings.showRomanization,
      showDictionary: settings.showDictionary,
      showGrammarHints: settings.showGrammarHints
    });

    if (settings.autoSpeak) speak(term, res.detected || source, false);
  }

  /* ------------------------------------------------------------ triggers -- */

  const modifierHeld = (e) => {
    switch (settings.hoverModifier) {
      case 'alt':
        return e.altKey;
      case 'shift':
        return e.shiftKey;
      case 'ctrl':
        return e.ctrlKey || e.metaKey;
      default:
        return true;
    }
  };

  function selectionLookup() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    const text = sel.toString().trim();
    if (!text || text.length < minCharsFor(text) || text.length > settings.maxChars) return false;
    const range = sel.getRangeAt(0);
    runLookup(text, range.getBoundingClientRect(), {
      node: range.startContainer,
      start: range.startOffset
    });
    return true;
  }

  document.addEventListener(
    'mouseup',
    (e) => {
      if (!active() || settings.trigger === 'hover') return;
      if (tip && tip.containsEvent(e)) return;
      // Let the browser finish updating the selection first.
      setTimeout(selectionLookup, 10);
    },
    true
  );

  document.addEventListener('mousemove', (e) => {
    if (!active() || settings.trigger === 'select') return;
    if (tip && tip.containsEvent(e)) return;
    clearTimeout(hoverTimer);

    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // a selection is in progress
    if (!modifierHeld(e)) return;
    if (isEditable(e.target)) return;

    const x = e.clientX;
    const y = e.clientY;
    hoverTimer = setTimeout(() => {
      const found = wordAtPoint(x, y);
      if (!found) return;
      if (last && tip && tip.visible && last.term === found.word) return; // already showing it
      runLookup(found.word, found.range.getBoundingClientRect(), {
        node: found.node,
        start: found.start
      });
    }, settings.hoverDelay);
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (tip && tip.visible && !tip.containsEvent(e)) tip.hide();
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    if (!tip || !tip.visible) return;
    if (e.key === 'Escape') {
      tip.hide();
      return;
    }
    // Single-key shortcuts, but never while the user is typing somewhere.
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(document.activeElement)) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      saveCurrent();
    } else if (k === 'c') {
      e.preventDefault();
      tip.h.onCopy();
    } else if (k === 'w') {
      e.preventDefault();
      tip.h.onSwap();
    } else if (k === 'p') {
      e.preventDefault();
      tip.h.onSpeak(e.shiftKey);
    } else if (k === 'g') {
      e.preventDefault();
      tip.toggleGrammar();
    }
  });

  let scrollRaf = null;
  window.addEventListener(
    'scroll',
    (e) => {
      // The grammar panel scrolls inside the tooltip; that is not the page
      // moving out from under it, so it must not dismiss anything.
      if (tip && tip.containsEvent(e)) return;
      if (!tip || !tip.visible || scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        // The anchor was captured in viewport coordinates, so it moves with the page.
        tip.hide();
      });
    },
    true
  );

  window.addEventListener('resize', () => tip && tip.reposition());

  /* ------------------------------------------------------ immersion mode -- */

  const immersion = {
    on: false,
    observer: null,
    queue: [],
    flushTimer: null,
    done: new WeakSet(),
    styled: false,
    MAX: 250
  };

  const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, dd, figcaption, td';

  function injectImmersionStyle() {
    if (immersion.styled) return;
    const s = document.createElement('style');
    s.id = 'gl-immersion-style';
    s.textContent = globalThis.GL_IMMERSION_CSS;
    document.head.appendChild(s);
    immersion.styled = true;
  }

  function immersionCandidates() {
    const out = [];
    document.querySelectorAll(BLOCK_SELECTOR).forEach((node) => {
      if (out.length >= immersion.MAX) return;
      if (immersion.done.has(node)) return;
      if (node.closest('aks-lingo') || node.querySelector(BLOCK_SELECTOR)) return;
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 25 || text.length > 1500) return;
      out.push(node);
    });
    return out;
  }

  function queueForTranslation(node) {
    if (immersion.done.has(node)) return;
    immersion.done.add(node);
    immersion.queue.push(node);
    clearTimeout(immersion.flushTimer);
    immersion.flushTimer = setTimeout(flushImmersion, 250);
  }

  async function flushImmersion() {
    const batch = immersion.queue.splice(0, 20);
    if (!batch.length) return;
    const segments = batch.map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim());

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'translateBatch',
        payload: { segments, source: settings.sourceLang, target: settings.targetLang }
      });
    } catch (e) {
      return;
    }
    if (!immersion.on || !res || !res.ok) return;

    const rtl = GL.isRtl(settings.targetLang);
    batch.forEach((node, i) => {
      const text = res.translations[i];
      if (!text || !node.isConnected) return;
      const line = document.createElement('div');
      line.className = 'gl-immersion-line';
      line.textContent = text;
      if (rtl) line.setAttribute('dir', 'rtl');
      node.insertAdjacentElement('afterend', line);
    });

    if (immersion.queue.length) {
      immersion.flushTimer = setTimeout(flushImmersion, 200);
    }
  }

  function startImmersion() {
    injectImmersionStyle();
    immersion.on = true;
    immersion.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            queueForTranslation(entry.target);
            immersion.observer.unobserve(entry.target);
          }
        });
      },
      // Start a screen early so translations are there before you scroll to them.
      { rootMargin: '400px 0px' }
    );
    immersionCandidates().forEach((n) => immersion.observer.observe(n));
    flash('Immersion mode on — ' + GL.langName(settings.targetLang) + ' under every paragraph');
  }

  function stopImmersion() {
    immersion.on = false;
    if (immersion.observer) immersion.observer.disconnect();
    immersion.observer = null;
    immersion.queue = [];
    immersion.done = new WeakSet();
    clearTimeout(immersion.flushTimer);
    document.querySelectorAll('.gl-immersion-line').forEach((n) => n.remove());
    flash('Immersion mode off');
  }

  const toggleImmersion = () => (immersion.on ? stopImmersion() : startImmersion());

  /* --------------------------------------------------------------- flash -- */

  let flashEl = null;
  function flash(message) {
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.style.cssText =
        'all:initial;position:fixed;bottom:22px;left:50%;transform:translateX(-50%);' +
        'z-index:2147483647;background:#16181d;color:#e8eaed;font:500 13px system-ui,sans-serif;' +
        'padding:9px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);' +
        'border:1px solid #2b2f38;opacity:0;transition:opacity .2s;pointer-events:none;';
      document.documentElement.appendChild(flashEl);
    }
    flashEl.textContent = message;
    flashEl.style.opacity = '1';
    clearTimeout(flashEl._t);
    flashEl._t = setTimeout(() => {
      flashEl.style.opacity = '0';
    }, 2200);
  }

  /* ----------------------------------------------------- worker messages -- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg && msg.type) {
      // The popup pings to find out whether this tab has a live content script.
      // A tab that was already open when the extension loaded has none, and the
      // ping simply gets no answer — which is what the popup reports.
      case 'gl:ping':
        sendResponse({
          ok: true,
          enabled: settings.enabled,
          trigger: settings.trigger,
          siteDisabled,
          host
        });
        return false;
      case 'gl:translate-selection': {
        const text = (msg.text || '').trim();
        if (text) {
          const sel = window.getSelection();
          const rect =
            sel && sel.rangeCount && !sel.isCollapsed
              ? sel.getRangeAt(0).getBoundingClientRect()
              : { left: 40, right: 40, top: 60, bottom: 60 };
          runLookup(text, rect, {});
        } else if (!selectionLookup()) {
          flash('Select some text first');
        }
        break;
      }
      case 'gl:save-selection': {
        const text = (msg.text || '').trim();
        if (!text) break;
        const sel = window.getSelection();
        const rect =
          sel && sel.rangeCount && !sel.isCollapsed
            ? sel.getRangeAt(0).getBoundingClientRect()
            : { left: 40, right: 40, top: 60, bottom: 60 };
        runLookup(text, rect, {}).then(() => {
          if (last && last.result) saveCurrent();
        });
        break;
      }
      case 'gl:toggle-immersion':
        if (settings.enabled && !siteDisabled) toggleImmersion();
        break;
      case 'gl:disable-site':
        siteDisabled = true;
        if (tip) tip.hide();
        if (immersion.on) stopImmersion();
        flash('AksLingo is off on ' + host);
        break;
      default:
        return false;
    }
    sendResponse({ ok: true });
    return false;
  });
})();
