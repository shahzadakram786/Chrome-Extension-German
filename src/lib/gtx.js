/**
 * Parser for the public translate endpoint's response.
 *
 * The response is a deeply nested, undocumented array, so every field is read
 * defensively: a shape change upstream should cost us a romanization or a
 * dictionary entry, never the translation itself. Kept in its own file so the
 * test suite can exercise it against real captured responses.
 */
(function () {
  function parse(json, requestedSource) {
    const out = {
      text: '',
      detected: requestedSource,
      confidence: 1,
      senses: [],
      pos: '',
      romanSource: '',
      romanTarget: '',
      examples: []
    };
    if (!Array.isArray(json)) return out;

    // json[0] — one row per sentence, plus an optional transliteration row.
    const rows = Array.isArray(json[0]) ? json[0] : [];
    const parts = [];
    rows.forEach((row) => {
      if (!Array.isArray(row)) return;
      if (typeof row[0] === 'string') {
        parts.push(row[0]);
      } else {
        // [null, null, <roman of translation>, <roman of source>]
        if (typeof row[2] === 'string' && row[2]) out.romanTarget = row[2];
        if (typeof row[3] === 'string' && row[3]) out.romanSource = row[3];
      }
    });
    out.text = parts.join('');

    // json[2] — detected source language code.
    if (typeof json[2] === 'string' && json[2]) out.detected = json[2];

    // json[8] — language-detection result, with confidence at [2][0].
    const ld = json[8];
    if (Array.isArray(ld) && Array.isArray(ld[2]) && typeof ld[2][0] === 'number') {
      out.confidence = ld[2][0];
    }

    // json[1] — dictionary: [part of speech, [translations], ...].
    if (Array.isArray(json[1])) {
      json[1].forEach((entry) => {
        if (!Array.isArray(entry)) return;
        const terms = Array.isArray(entry[1]) ? entry[1].filter((t) => typeof t === 'string') : [];
        if (!terms.length) return;
        out.senses.push({
          pos: typeof entry[0] === 'string' ? entry[0] : '',
          terms: terms.slice(0, 6)
        });
      });
      if (out.senses.length) out.pos = out.senses[0].pos;
    }

    // json[13] — example sentences, with <b> markup around the queried term.
    if (Array.isArray(json[13]) && Array.isArray(json[13][0])) {
      json[13][0].forEach((ex) => {
        const s = Array.isArray(ex) ? ex[0] : null;
        if (typeof s === 'string') out.examples.push(s.replace(/<\/?b>/g, ''));
      });
    }

    return out;
  }

  globalThis.GL = Object.assign(globalThis.GL || {}, { gtx: { parse } });
})();
