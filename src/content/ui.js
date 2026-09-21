/**
 * The tooltip, rendered inside a closed-off shadow root.
 *
 * Two rules hold throughout: nothing from the page is ever assigned to
 * innerHTML (selected text is attacker-controlled), and every element is
 * created once in the constructor so showing a result is only text updates.
 */
(function () {
  const GL = globalThis.GL;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  class Tooltip {
    constructor(handlers) {
      this.h = handlers || {};
      this.visible = false;
      this.anchor = null;
      this.saved = false;

      this.host = document.createElement('aks-lingo');
      this.host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;';
      this.root = this.host.attachShadow({ mode: 'open' });

      const sheet = document.createElement('style');
      sheet.textContent = globalThis.GL_TOOLTIP_CSS;
      this.root.appendChild(sheet);

      this.card = el('div', 'card');
      this.card.setAttribute('role', 'dialog');
      this.card.setAttribute('aria-live', 'polite');
      this.card.setAttribute('aria-label', 'Translation');
      this.root.appendChild(this.card);

      // --- header ---------------------------------------------------------
      const header = el('header');
      this.termEl = el('div', 'term');
      header.appendChild(this.termEl);

      const acts = el('div', 'acts');
      this.btnSpeak = this._button('🔊', 'Listen (hold Shift for slow)', (e) =>
        this.h.onSpeak && this.h.onSpeak(e.shiftKey)
      );
      this.btnGrammar = this._button(this._tableIcon(), 'Conjugation and grammar (G)', () => this.toggleGrammar());
      this.btnGrammar.style.display = 'none'; // shown only when there is a table
      this.btnSave = this._button('☆', 'Save to deck (S)', () => this.h.onSave && this.h.onSave());
      this.btnSwap = this._button('⇄', 'Translate the other way (W)', () => this.h.onSwap && this.h.onSwap());
      this.btnCopy = this._button('⧉', 'Copy translation (C)', () => this.h.onCopy && this.h.onCopy());
      this.btnClose = this._button('✕', 'Close (Esc)', () => this.hide());
      [this.btnSpeak, this.btnGrammar, this.btnSave, this.btnSwap, this.btnCopy, this.btnClose].forEach(
        (b) => acts.appendChild(b)
      );
      header.appendChild(acts);
      this.card.appendChild(header);

      // --- body -----------------------------------------------------------
      this.body = el('div', 'body');
      this.card.appendChild(this.body);

      this.translationEl = el('div', 'translation');
      this.romanEl = el('div', 'roman');
      this.sensesEl = el('div', 'senses');
      this.hintEl = el('div', 'hint');
      this.exampleEl = el('div', 'example');
      this.toastEl = el('div', 'toast');

      this.footer = el('footer');
      this.routeEl = el('div', 'route');
      this.badgeEl = el('div', 'badge');
      this.footer.appendChild(this.routeEl);
      this.footer.appendChild(this.badgeEl);

      // Clicks inside must not bubble to the page's own handlers.
      this.card.addEventListener('mousedown', (e) => e.stopPropagation());
      this.card.addEventListener('mouseup', (e) => e.stopPropagation());

      (document.documentElement || document.body).appendChild(this.host);
    }

    /**
     * A conjugation-table icon, drawn rather than typed: the book emoji is
     * missing from some system fonts and renders as a blank box.
     */
    _tableIcon() {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('width', '15');
      svg.setAttribute('height', '15');
      svg.setAttribute('aria-hidden', 'true');
      const box = document.createElementNS(NS, 'rect');
      box.setAttribute('x', '1.5');
      box.setAttribute('y', '2.5');
      box.setAttribute('width', '13');
      box.setAttribute('height', '11');
      box.setAttribute('rx', '1.5');
      box.setAttribute('fill', 'none');
      box.setAttribute('stroke', 'currentColor');
      box.setAttribute('stroke-width', '1.3');
      svg.appendChild(box);
      [6, 9.5].forEach((y) => {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', '1.5');
        line.setAttribute('y1', String(y));
        line.setAttribute('x2', '14.5');
        line.setAttribute('y2', String(y));
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', '1.3');
        svg.appendChild(line);
      });
      const col = document.createElementNS(NS, 'line');
      col.setAttribute('x1', '6');
      col.setAttribute('y1', '6');
      col.setAttribute('x2', '6');
      col.setAttribute('y2', '13.5');
      col.setAttribute('stroke', 'currentColor');
      col.setAttribute('stroke-width', '1.3');
      svg.appendChild(col);
      return svg;
    }

    _button(glyph, title, onClick) {
      const b = el('button', null, typeof glyph === 'string' ? glyph : null);
      if (typeof glyph !== 'string') b.appendChild(glyph);
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      });
      return b;
    }

    applyTheme(theme, fontSize) {
      const dark =
        theme === 'dark' ||
        (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      this.card.classList.toggle('light', !dark);
      this.card.style.setProperty('--gl-size', (fontSize || 15) + 'px');
    }

    _clearBody() {
      while (this.body.firstChild) this.body.removeChild(this.body.firstChild);
      if (this.footer.parentNode) this.card.removeChild(this.footer);
    }

    setLoading(term, srcLang) {
      this._setTerm(term, srcLang);
      this.saved = false;
      this.btnSave.textContent = '☆';
      this.btnSave.classList.remove('on');
      this.grammar = null;
      this.grammarOpen = false;
      this.btnGrammar.style.display = 'none';
      this.btnGrammar.classList.remove('on');
      this.card.classList.remove('wide');
      [this.btnSave, this.btnCopy, this.btnSwap].forEach((b) => (b.disabled = true));

      this._clearBody();
      const sk = el('div', 'skeleton');
      sk.appendChild(el('div', 'bar'));
      sk.appendChild(el('div', 'bar short'));
      this.body.appendChild(sk);
    }

    _setTerm(term, lang) {
      this.termEl.textContent = term;
      this.termEl.setAttribute('dir', GL.isRtl(lang) ? 'rtl' : 'ltr');
    }

    setError(message) {
      this._clearBody();
      this.body.appendChild(el('div', 'error', '⚠ ' + message));
    }

    /**
     * @param {object} data  translation payload from the worker
     * @param {object} opts  { sourceLang, targetLang, showRomanization, showDictionary, showGrammarHints }
     */
    setResult(data, opts) {
      this._clearBody();
      [this.btnSave, this.btnCopy, this.btnSwap].forEach((b) => (b.disabled = false));

      const detected = data.detected || opts.sourceLang;
      this._setTerm(this.termEl.textContent, detected);

      this.translationEl.textContent = data.text;
      this.translationEl.setAttribute('dir', GL.isRtl(data.target || opts.targetLang) ? 'rtl' : 'ltr');
      this.body.appendChild(this.translationEl);

      // Romanization of whichever side is not in Latin script.
      const roman = GL.isRtl(data.target || opts.targetLang) || !GL.isRtl(detected)
        ? data.romanTarget || data.romanSource
        : data.romanSource || data.romanTarget;
      if (opts.showRomanization && roman && roman !== data.text) {
        this.romanEl.textContent = roman;
        this.body.appendChild(this.romanEl);
      }

      if (opts.showDictionary && data.senses && data.senses.length) {
        while (this.sensesEl.firstChild) this.sensesEl.removeChild(this.sensesEl.firstChild);
        data.senses.slice(0, 3).forEach((s) => {
          const row = el('div', 'sense');
          row.appendChild(el('span', 'pos', s.pos || '—'));
          row.appendChild(el('span', 'terms', s.terms.join(', ')));
          this.sensesEl.appendChild(row);
        });
        this.body.appendChild(this.sensesEl);
      }

      if (opts.showGrammarHints && detected === 'de') {
        const hint = GL.grammar.germanHint(this.termEl.textContent);
        if (hint) {
          while (this.hintEl.firstChild) this.hintEl.removeChild(this.hintEl.firstChild);
          if (hint.article) {
            const b = el('b', null, hint.article + ' ' + this.termEl.textContent);
            this.hintEl.appendChild(b);
            this.hintEl.appendChild(document.createTextNode(' · ' + hint.note));
          } else {
            this.hintEl.appendChild(document.createTextNode(hint.note));
          }
          this.body.appendChild(this.hintEl);
        }
      }

      if (data.examples && data.examples.length) {
        this.exampleEl.textContent = '“' + data.examples[0] + '”';
        this.body.appendChild(this.exampleEl);
      }

      // Nothing changed and the source was read as the target language: the
      // detector got it wrong. Say so, rather than presenting the original word
      // back to the user as though it were a translation.
      const target = data.target || opts.targetLang;
      const unchanged =
        data.text.trim().toLowerCase() === this.termEl.textContent.trim().toLowerCase();
      if (unchanged && detected === target) {
        this.body.appendChild(
          el(
            'div',
            'caution',
            'Read as ' + GL.langName(detected) + ', so nothing was translated. ' +
              'Set the language in the toolbar popup if that is wrong.'
          )
        );
      }

      // The fallback provider's crowd-sourced memory can return a confident-looking
      // but wrong answer. Say so rather than letting it pass as a real translation.
      if (data.lowConfidence) {
        this.body.appendChild(
          el('div', 'caution', '⚠ Unverified fallback translation — treat with caution')
        );
      }

      this._prepareGrammar(this.termEl.textContent, detected, data.pos);

      while (this.routeEl.firstChild) this.routeEl.removeChild(this.routeEl.firstChild);
      const route =
        GL.langLabel(detected) + '  →  ' + GL.langLabel(data.target || opts.targetLang);
      this.routeEl.appendChild(el('span', null, route));
      this.badgeEl.textContent = data.cached ? 'cached' : data.provider || '';
      this.card.appendChild(this.footer);

      this.reposition();
    }

    /* ------------------------------------------------------------ grammar -- */

    /**
     * Offers the grammar panel when the word is German and we can say something
     * exact about it. Nothing is shown for a word we cannot analyse, rather
     * than a half-filled table.
     */
    _prepareGrammar(term, detected, pos) {
      this.grammar = null;
      this.grammarOpen = false;
      this.btnGrammar.style.display = 'none';
      this.btnGrammar.classList.remove('on');
      if (detected !== 'de' || !GL.german) return;

      const analysis = GL.german.analyze(term, pos);
      if (!analysis) return;
      // A noun we cannot gender has no table worth opening.
      if (analysis.type === 'noun' && !analysis.declension) return;

      this.grammar = analysis;
      this.btnGrammar.style.display = '';
    }

    toggleGrammar() {
      if (!this.grammar) return;
      this.grammarOpen = !this.grammarOpen;
      this.btnGrammar.classList.toggle('on', this.grammarOpen);
      this.card.classList.toggle('wide', this.grammarOpen);

      if (!this.grammarOpen) {
        if (this.gramEl && this.gramEl.parentNode) this.gramEl.parentNode.removeChild(this.gramEl);
        this.reposition();
        return;
      }

      this.gramEl = this._renderGrammar(this.grammar);
      this.body.appendChild(this.gramEl);
      this.reposition();
    }

    _row(container, label, value, strong) {
      container.appendChild(el('span', 'pron', label));
      container.appendChild(el('span', strong ? 'form key' : 'form', value));
    }

    _renderGrammar(a) {
      const wrap = el('div', 'gram');

      if (a.type === 'verb') {
        const c = a.conjugation;

        const head = el('div', 'gramHead');
        head.appendChild(el('span', 'gramWord', c.infinitive));
        const KIND_LABEL = {
          modal: 'modal verb · preterite-present',
          strong: 'strong verb',
          mixed: 'mixed verb',
          weak: 'weak verb'
        };
        const bits = [KIND_LABEL[c.kind] || 'weak verb', 'Perfekt with ' + c.auxiliary];
        if (c.separable) bits.push('separable: ' + c.separable + '-');
        head.appendChild(el('span', 'gramMeta', bits.join(' · ')));
        wrap.appendChild(head);

        if (a.inflected) {
          wrap.appendChild(
            el('div', 'gramNote', a.certain
              ? '“' + a.word + '” is a form of ' + c.infinitive
              : '“' + a.word + '” looks like a form of ' + c.infinitive + ' — not confirmed')
          );
        }

        // Say how far to trust the table. A verb absent from the irregular list
        // is conjugated as a regular one, which is right for the overwhelming
        // majority — but only reliably so once that list is the complete,
        // generated one.
        if (c.source === 'rules' && !c.listComplete) {
          wrap.appendChild(
            el('div', 'caution', 'Not in the built-in irregular list, so these are the regular-verb forms. A rare strong verb could differ.')
          );
        }

        // The three principal parts, which is what gets memorised.
        const key = el('div', 'gramKey');
        [
          ['Infinitiv', c.infinitive],
          ['Präteritum', c.tenses[1].forms[2]],
          ['Partizip II', c.partizip2]
        ].forEach(([label, value]) => {
          const cell = el('div', 'keyCell');
          cell.appendChild(el('b', null, label));
          cell.appendChild(el('span', null, value));
          key.appendChild(cell);
        });
        wrap.appendChild(key);

        c.tenses.forEach((t) => {
          const block = el('div', 'gramTense');
          const title = el('div', 'gramTitle');
          title.appendChild(el('span', null, t.label));
          title.appendChild(el('i', null, t.note));
          block.appendChild(title);

          const rows = el('div', 'gramRows');
          c.pronouns.forEach((p, i) => this._row(rows, p, t.forms[i]));
          block.appendChild(rows);

          // "hat gekonnt" is right only when the modal stands alone. Governing
          // another verb, German takes the infinitive instead — the
          // Ersatzinfinitiv. Without this the table quietly teaches
          // "hat schwimmen gekonnt", which is the kind of confident wrong
          // answer this panel exists to avoid.
          if (c.modal && (t.key === 'perfekt' || t.key === 'plusquamperfekt')) {
            block.appendChild(
              el('div', 'caution',
                'With another verb, use the infinitive, not ' + c.partizip2 + ': ' +
                '„er hat schwimmen ' + c.infinitive + '“. ' +
                'The forms above are for ' + c.infinitive + ' standing on its own.')
            );
          }

          wrap.appendChild(block);
        });

        const imp = el('div', 'gramTense');
        const impTitle = el('div', 'gramTitle');
        impTitle.appendChild(el('span', null, 'Imperativ'));
        impTitle.appendChild(el('i', null, 'commands'));
        imp.appendChild(impTitle);
        const impRows = el('div', 'gramRows');
        ['du', 'ihr', 'Sie'].forEach((p, i) => this._row(impRows, p, c.imperative[i] + '!'));
        imp.appendChild(impRows);
        wrap.appendChild(imp);

        const parts = el('div', 'gramTense');
        const pTitle = el('div', 'gramTitle');
        pTitle.appendChild(el('span', null, 'Partizipien'));
        parts.appendChild(pTitle);
        const pRows = el('div', 'gramRows');
        this._row(pRows, 'Partizip I', c.partizip1);
        this._row(pRows, 'Partizip II', c.partizip2);
        parts.appendChild(pRows);
        wrap.appendChild(parts);
        return wrap;
      }

      if (a.type === 'noun') {
        const d = a.declension;
        const head = el('div', 'gramHead');
        head.appendChild(el('span', 'gramWord', d.gender + ' ' + d.word));
        head.appendChild(el('span', 'gramMeta', 'noun'));
        wrap.appendChild(head);

        if (a.genderNote) wrap.appendChild(el('div', 'gramNote', a.genderNote));

        const block = el('div', 'gramTense');
        const title = el('div', 'gramTitle');
        title.appendChild(el('span', null, 'Singular'));
        title.appendChild(el('i', null, 'the four cases'));
        block.appendChild(title);
        const rows = el('div', 'gramRows');
        d.cases.forEach((c, i) => this._row(rows, c, d.singular[i]));
        block.appendChild(rows);
        wrap.appendChild(block);

        wrap.appendChild(
          el('div', 'gramNote', 'German plurals are not predictable from the singular, so none is shown.')
        );
        return wrap;
      }

      const c = a.comparison;
      const head = el('div', 'gramHead');
      head.appendChild(el('span', 'gramWord', c.positive));
      head.appendChild(el('span', 'gramMeta', c.irregular ? 'adjective · irregular' : 'adjective'));
      wrap.appendChild(head);

      const block = el('div', 'gramTense');
      const rows = el('div', 'gramRows');
      this._row(rows, 'Positiv', c.positive);
      this._row(rows, 'Komparativ', c.comparative, true);
      this._row(rows, 'Superlativ', c.superlative, true);
      block.appendChild(rows);
      wrap.appendChild(block);
      return wrap;
    }

    toast(message) {
      this.toastEl.textContent = message;
      if (!this.toastEl.parentNode) this.body.appendChild(this.toastEl);
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        if (this.toastEl.parentNode) this.toastEl.parentNode.removeChild(this.toastEl);
      }, 1600);
    }

    markSaved(added) {
      this.saved = true;
      this.btnSave.textContent = '★';
      this.btnSave.classList.add('on');
      this.toast(added ? '★ Added to your deck' : 'Already in your deck');
    }

    /** @param {DOMRect} rect anchor rectangle in viewport coordinates */
    showAt(rect) {
      this.anchor = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      };
      this.card.style.display = 'block';
      this.visible = true;
      this.reposition();
      requestAnimationFrame(() => this.card.classList.add('visible'));
    }

    /**
     * Places the card next to its anchor, flipping above when there is no room
     * below and clamping to the viewport so it is never half off-screen.
     */
    reposition() {
      if (!this.visible || !this.anchor) return;
      const a = this.anchor;
      const gap = 10;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;

      // Measure off-flow before committing to a position.
      this.card.style.left = '0px';
      this.card.style.top = '-9999px';
      const w = this.card.offsetWidth;
      const h = this.card.offsetHeight;

      let left = a.left;
      if (left + w > vw - 8) left = vw - w - 8;
      if (left < 8) left = 8;

      const roomBelow = vh - a.bottom;
      const above = roomBelow < h + gap && a.top > h + gap;
      const top = above ? a.top - h - gap : a.bottom + gap;

      this.card.style.left = Math.round(left + window.scrollX) + 'px';
      this.card.style.top = Math.round(top + window.scrollY) + 'px';
    }

    hide() {
      if (!this.visible) return;
      this.visible = false;
      this.card.classList.remove('visible');
      this.card.style.display = 'none';
      this.anchor = null;
      if (this.h.onHide) this.h.onHide();
    }

    /** True when the event target is inside this tooltip (shadow DOM aware). */
    containsEvent(event) {
      const path = event.composedPath ? event.composedPath() : [];
      return path.indexOf(this.host) !== -1 || path.indexOf(this.card) !== -1;
    }
  }

  globalThis.GL_Tooltip = Tooltip;
})();
