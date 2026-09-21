/**
 * Parser for the MyMemory fallback provider.
 *
 * Two traps, both found against the live API:
 *
 * 1. It answers HTTP 200 even when refusing the request, signalling the real
 *    outcome in `responseStatus` and putting the error text where the
 *    translation would be. Skip that check and the user is shown
 *    "'AUTO' IS AN INVALID SOURCE LANGUAGE" as if it were a translation.
 *
 * 2. `responseData.translatedText` is not the best answer, just the first one.
 *    For "Haus" de->ur it returns "مچھلي" (fish) with match 1.0 but quality 0,
 *    while the correct "مکان" sits further down the `matches` list. The usable
 *    signal is `quality` (0 = an unvetted corpus dump, 70+ = a real
 *    translation memory), so we rank the candidates instead of taking the head.
 */
(function () {
  // Error text it returns in the translation field rather than as a status.
  const ERROR_TEXT = /MYMEMORY WARNING|QUERY LENGTH|INVALID|NO TARGET LANGUAGE|PLEASE (SELECT|SPECIFY)/i;

  // Unvetted scrape; correct entries carry a real quality score instead.
  const NOISY_SOURCES = /public_corpora/i;

  // Below this the candidate is answering a different question than we asked.
  const MIN_MATCH = 0.7;

  /** MyMemory has no "auto" code, but it accepts the literal "Autodetect". */
  const langPair = (sl, tl) => (sl === 'auto' ? 'Autodetect' : sl) + '|' + tl;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  /**
   * Ranks the candidate translations and returns the best, or null when none
   * is usable. Ordering: real quality score first, then non-noisy sources,
   * then closeness of match, then how often it has been reused.
   */
  function pickBest(matches) {
    if (!Array.isArray(matches)) return null;

    const usable = matches
      .filter((m) => m && typeof m.translation === 'string' && m.translation.trim())
      .filter((m) => !ERROR_TEXT.test(m.translation))
      .filter((m) => num(m.match) >= MIN_MATCH)
      .map((m) => ({
        text: m.translation.trim(),
        quality: num(m.quality),
        match: num(m.match),
        uses: num(m['usage-count']),
        trusted: !NOISY_SOURCES.test(String(m['created-by'] || ''))
      }));

    if (!usable.length) return null;

    usable.sort(
      (a, b) =>
        b.quality - a.quality ||
        Number(b.trusted) - Number(a.trusted) ||
        b.match - a.match ||
        b.uses - a.uses
    );
    return usable[0];
  }

  /**
   * @returns a normalized result; `lowConfidence` marks an answer that came
   *          back with no quality signal at all and should be shown with a caveat
   * @throws {Error} with `.status` set when the provider refused the request
   */
  function parse(json, sl) {
    if (!json || typeof json !== 'object') throw new Error('mymemory: no response body');

    const status = Number(json.responseStatus);
    if (status && status !== 200) {
      const err = new Error('mymemory: responseStatus ' + status);
      // 403 here means a bad request, not a server fault — do not retry it.
      err.status = status;
      throw err;
    }

    if (json.quotaFinished) {
      const err = new Error('mymemory: daily quota exhausted');
      err.status = 429; // treated as a rate limit, so the breaker backs off properly
      throw err;
    }

    const data = json.responseData || {};
    const head = typeof data.translatedText === 'string' ? data.translatedText.trim() : '';
    const best = pickBest(json.matches);

    // Prefer a ranked candidate; fall back to the headline answer.
    const text = best ? best.text : head;
    if (!text || ERROR_TEXT.test(text)) throw new Error('mymemory: unusable translation');

    const quality = best ? best.quality : 0;

    return {
      text,
      // It reports what it detected, so "auto" still resolves without Google.
      detected: (data.detectedLanguage || sl || '').toLowerCase() || sl,
      confidence: quality > 0 ? quality / 100 : num(data.match) || 0.5,
      lowConfidence: quality === 0,
      senses: [],
      pos: '',
      romanSource: '',
      romanTarget: '',
      examples: []
    };
  }

  globalThis.GL = Object.assign(globalThis.GL || {}, { mymemory: { parse, langPair, pickBest } });
})();
