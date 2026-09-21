/**
 * Small, honest grammar hints for learners. These are heuristics, not a
 * dictionary — the UI labels them as guesses and only shows the ones that
 * are reliable enough to be worth reading.
 */
(function () {
  // German noun endings whose gender is effectively exceptionless in practice.
  const DE_SUFFIX_GENDER = [
    ['heit', 'die'], ['keit', 'die'], ['schaft', 'die'], ['ung', 'die'],
    ['tion', 'die'], ['sion', 'die'], ['tät', 'die'], ['ität', 'die'],
    ['ik', 'die'], ['ur', 'die'], ['enz', 'die'], ['anz', 'die'], ['ei', 'die'],
    ['chen', 'das'], ['lein', 'das'], ['ment', 'das'], ['tum', 'das'],
    ['um', 'das'], ['ing', 'das'], ['nis', 'das'],
    ['ling', 'der'], ['ismus', 'der'], ['ant', 'der'], ['ent', 'der'],
    ['ist', 'der'], ['or', 'der'], ['eur', 'der'], ['ich', 'der'], ['ig', 'der']
  ];

  const DE_SEPARABLE_PREFIXES = [
    'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'fest', 'her', 'hin', 'los',
    'mit', 'nach', 'vor', 'weg', 'zu', 'zurück', 'zusammen'
  ];

  /**
   * Returns { article, note } for a likely German noun, or null when we have
   * nothing trustworthy to say.
   */
  function germanHint(word) {
    if (!word) return null;
    const w = word.trim();
    if (/\s/.test(w) || w.length < 4) return null;

    const lower = w.toLowerCase();

    // Capitalised single word → almost certainly a noun in German.
    const looksNoun = /^[A-ZÄÖÜ]/.test(w);

    if (looksNoun) {
      for (const [suffix, article] of DE_SUFFIX_GENDER) {
        if (lower.endsWith(suffix)) {
          return { article, note: '-' + suffix + ' nouns are almost always ' + article };
        }
      }
      return null;
    }

    // Infinitive verb with a separable prefix — the thing that trips learners up.
    if (lower.endsWith('en') || lower.endsWith('eln') || lower.endsWith('ern')) {
      for (const p of DE_SEPARABLE_PREFIXES) {
        if (lower.startsWith(p) && lower.length > p.length + 3) {
          return {
            article: '',
            note: 'separable verb: “' + lower.slice(p.length) + ' … ' + p + '” in a main clause'
          };
        }
      }
    }

    return null;
  }

  globalThis.GL = Object.assign(globalThis.GL || {}, {
    grammar: { germanHint }
  });
})();
