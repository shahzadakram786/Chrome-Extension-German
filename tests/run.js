/**
 * Test suite for the parts of AksLingo that are pure logic: the scheduler,
 * the API response parser, the grammar hints and the storage layer.
 *
 *   node tests/run.js          unit tests only
 *   node tests/run.js --live   also calls the real translation endpoint
 *
 * The libs are classic scripts that attach to globalThis, so we load them the
 * same way the service worker does rather than converting them to modules.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------ harness --- */

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed += 1;
    failures.push(name + ': ' + e.message);
    console.log('  ✗ ' + name + '\n      ' + e.message);
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || 'value') + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function ok(cond, what) {
  if (!cond) throw new Error(what || 'expected a truthy value');
}

function section(title) {
  console.log('\n' + title);
}

/* ------------------------------------------------- chrome.storage stub --- */

const memory = {};
const chromeStub = {
  storage: {
    local: {
      get: async (keys) => {
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
        const out = {};
        list.forEach((k) => {
          if (k in memory) out[k] = JSON.parse(JSON.stringify(memory[k]));
        });
        return out;
      },
      set: async (obj) => {
        Object.assign(memory, JSON.parse(JSON.stringify(obj)));
      },
      remove: async (key) => {
        delete memory[key];
      }
    },
    onChanged: { addListener: () => {} }
  }
};

/* ------------------------------------------------------------- loading --- */

const sandbox = { console, chrome: chromeStub, Intl, Date, Math, JSON, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

[
  'src/lib/languages.js',
  'src/lib/srs.js',
  'src/lib/grammar.js',
  'src/lib/store.js',
  'src/lib/gtx.js',
  'src/lib/mymemory.js',
  'src/lib/byokey.js'
].forEach((rel) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
});

const GL = sandbox.GL;

/* --------------------------------------------------------- languages ---- */

section('languages');

check('resolves a known code', () => {
  eq(GL.langName('de'), 'German');
  eq(GL.bcp47('de'), 'de-DE');
});

check('marks right-to-left scripts', () => {
  eq(GL.isRtl('ur'), true, 'Urdu is RTL');
  eq(GL.isRtl('ar'), true, 'Arabic is RTL');
  eq(GL.isRtl('de'), false, 'German is not RTL');
});

check('follows aliases the API actually returns', () => {
  eq(GL.langName('zh'), 'Chinese (Simplified)', 'bare zh');
  eq(GL.langName('iw'), 'Hebrew', 'legacy Hebrew code');
});

check('degrades gracefully on an unknown code', () => {
  eq(GL.langName('xx'), 'xx');
  eq(GL.isRtl('xx'), false);
  eq(GL.bcp47('xx'), undefined);
});

check('canonicalises the codes a detector or a page can hand us', () => {
  eq(GL.canonical('de'), 'de');
  eq(GL.canonical('zh'), 'zh-CN', 'bare Chinese');
  eq(GL.canonical('de-AT'), 'de', 'regional variant falls back to the base');
  eq(GL.canonical('en-GB'), 'en');
  eq(GL.canonical('zh-CN'), 'zh-CN', 'an exact match is kept as-is');
  eq(GL.canonical('iw'), 'he', 'legacy code');
  eq(GL.canonical('xx'), null, 'unknown');
  eq(GL.canonical(''), null, 'empty');
  eq(GL.canonical(null), null, 'null');
});

check('sorted list puts auto first and is alphabetical after', () => {
  const codes = GL.sortedCodes(true);
  eq(codes[0], 'auto');
  const names = codes.slice(1).map(GL.langName);
  const sorted = names.slice().sort((a, b) => a.localeCompare(b));
  eq(names.join('|'), sorted.join('|'), 'alphabetical order');
  eq(GL.sortedCodes(false).indexOf('auto'), -1, 'auto excluded when not wanted');
});

/* --------------------------------------------------------------- srs ---- */

section('spaced repetition');

const DAY = GL.srs.DAY;
const MIN = GL.srs.MIN;
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

check('a new card is due immediately and starts in learning', () => {
  const c = GL.srs.newCard({ term: 'Haus', translation: 'house' });
  eq(c.state, 'learning');
  eq(c.interval, 0);
  eq(c.reps, 0);
  ok(c.due <= Date.now() + 1000, 'due now');
  ok(c.id && c.id.length > 4, 'has an id');
});

check('Good twice graduates a card into review at one day', () => {
  let c = GL.srs.newCard({ term: 'Haus' });
  c = GL.srs.review(c, 2, T0);
  eq(c.state, 'learning', 'still learning after the first Good');
  eq(c.due - T0, 10 * MIN, 'second learning step is 10 minutes');

  c = GL.srs.review(c, 2, T0);
  eq(c.state, 'review', 'graduated');
  eq(c.interval, 1, 'one-day interval');
  eq(c.due - T0, DAY);
});

check('Easy graduates immediately at four days', () => {
  let c = GL.srs.newCard({ term: 'Haus' });
  c = GL.srs.review(c, 3, T0);
  eq(c.state, 'review');
  eq(c.interval, 4);
});

check('intervals grow by the ease factor once in review', () => {
  let c = GL.srs.newCard({ term: 'Haus' });
  c = GL.srs.review(c, 3, T0); // 4 days, ease 2.55
  const before = c.interval;
  c = GL.srs.review(c, 2, T0 + 4 * DAY);
  ok(c.interval > before, 'interval grew: ' + before + ' -> ' + c.interval);
  eq(c.interval, Math.round(before * c.ease), 'interval = previous x ease');
});

check('Again sends a review card back to learning and counts a lapse', () => {
  let c = GL.srs.newCard({ term: 'Haus' });
  c = GL.srs.review(c, 3, T0);
  const easeBefore = c.ease;
  c = GL.srs.review(c, 0, T0 + 4 * DAY);
  eq(c.state, 'relearning');
  eq(c.lapses, 1);
  eq(c.interval, 0);
  ok(c.ease < easeBefore, 'ease dropped');
  eq(c.due - (T0 + 4 * DAY), 1 * MIN, 'back to the first learning step');
});

check('ease stays inside its bounds however badly it goes', () => {
  let c = GL.srs.newCard({ term: 'x' });
  for (let i = 0; i < 40; i += 1) c = GL.srs.review(c, 0, T0 + i * DAY);
  ok(c.ease >= 1.3, 'floor held, got ' + c.ease);

  let d = GL.srs.newCard({ term: 'y' });
  for (let i = 0; i < 40; i += 1) d = GL.srs.review(d, 3, T0 + i * 400 * DAY);
  ok(d.ease <= 2.8, 'ceiling held, got ' + d.ease);
  ok(d.interval <= 365 * 4, 'interval capped, got ' + d.interval);
});

check('review is pure — the input card is never mutated', () => {
  const c = GL.srs.newCard({ term: 'Haus' });
  const snapshot = JSON.stringify(c);
  GL.srs.review(c, 2, T0);
  GL.srs.review(c, 0, T0);
  eq(JSON.stringify(c), snapshot, 'original untouched');
});

check('interval preview matches what each grade would actually schedule', () => {
  const c = GL.srs.newCard({ term: 'Haus' });
  const preview = GL.srs.intervalPreview(c, T0);
  eq(preview.again, '1m');
  eq(preview.good, '10m');
  eq(preview.easy, '4d');
  ok(preview.hard, 'hard has a label');
});

check('the queue puts learning cards before overdue reviews', () => {
  const learning = GL.srs.newCard({ term: 'learning', due: T0 - 60 * 1000 });
  const veryOverdue = GL.srs.newCard({ term: 'old', due: T0 - 90 * DAY, state: 'review', interval: 30 });
  const notDue = GL.srs.newCard({ term: 'future', due: T0 + 5 * DAY, state: 'review', interval: 10 });
  const q = GL.srs.buildQueue([veryOverdue, notDue, learning], T0);
  eq(q.length, 2, 'only due cards');
  eq(q[0].term, 'learning', 'learning first');
  eq(q[1].term, 'old');
});

check('suspended cards never enter the queue or the due count', () => {
  const live = GL.srs.newCard({ term: 'a', due: T0 - DAY });
  const dead = GL.srs.newCard({ term: 'b', due: T0 - DAY, suspended: true });
  eq(GL.srs.buildQueue([live, dead], T0).length, 1);
  eq(GL.srs.counts([live, dead], T0).due, 1);
});

check('session limit caps the queue', () => {
  const cards = [];
  for (let i = 0; i < 50; i += 1) cards.push(GL.srs.newCard({ term: 'w' + i, due: T0 - DAY }));
  eq(GL.srs.buildQueue(cards, T0, 20).length, 20);
});

check('counts classify cards by maturity', () => {
  const c = [
    GL.srs.newCard({ term: 'n' }),
    GL.srs.newCard({ term: 'y', state: 'review', interval: 5, due: T0 + 5 * DAY }),
    GL.srs.newCard({ term: 'm', state: 'review', interval: 40, due: T0 + 40 * DAY })
  ];
  const counts = GL.srs.counts(c, T0);
  eq(counts.total, 3);
  eq(counts.learning, 1);
  eq(counts.young, 1);
  eq(counts.mature, 1);
});

check('humanDelay reads naturally at every scale', () => {
  eq(GL.srs.humanDelay(0), 'now');
  eq(GL.srs.humanDelay(10 * MIN), '10m');
  eq(GL.srs.humanDelay(3 * 60 * MIN), '3h');
  eq(GL.srs.humanDelay(5 * DAY), '5d');
  eq(GL.srs.humanDelay(400 * DAY), '1.1y');
});

/* ----------------------------------------------------------- gtx parse -- */

section('translation response parser');

// A real response shape for: de -> en, q=Haus, dt=t&dt=bd&dt=rm&dt=ex
const RICH = [
  [['house', 'Haus', null, null, 10], [null, null, '', 'Haus']],
  [
    ['noun', ['house', 'home', 'building'], [['house', ['Haus'], null, 0.9]], 'Haus', 1],
    ['adjective', ['domestic'], [], 'Haus', 3]
  ],
  'de',
  null, null, null, null, null, // 3..7
  [['de'], null, [0.98], [['de']]], // 8 — ld_result
  null, null, null, null, // 9..12 (11 = synsets, 12 = definitions)
  [[['Das <b>Haus</b> ist alt.'], ['Ein grosses <b>Haus</b>.']]] // 13 — examples
];

check('pulls out translation, detection and confidence', () => {
  const r = GL.gtx.parse(RICH, 'auto');
  eq(r.text, 'house');
  eq(r.detected, 'de');
  eq(r.confidence, 0.98);
});

check('pulls out the dictionary senses and part of speech', () => {
  const r = GL.gtx.parse(RICH, 'de');
  eq(r.senses.length, 2);
  eq(r.senses[0].pos, 'noun');
  eq(r.senses[0].terms.join(','), 'house,home,building');
  eq(r.pos, 'noun');
});

check('strips the markup out of example sentences', () => {
  const r = GL.gtx.parse(RICH, 'de');
  eq(r.examples[0], 'Das Haus ist alt.');
  eq(r.examples.length, 2);
});

check('joins multi-sentence translations in order', () => {
  const json = [[['One. ', 'Eins. '], ['Two.', 'Zwei.']], null, 'de'];
  eq(GL.gtx.parse(json, 'de').text, 'One. Two.');
});

check('reads romanization out of the transliteration row', () => {
  const json = [[['hello', 'مرحبا'], [null, null, 'helo', 'marhaban']], null, 'ar'];
  const r = GL.gtx.parse(json, 'ar');
  eq(r.text, 'hello', 'the null row must not pollute the translation');
  eq(r.romanTarget, 'helo');
  eq(r.romanSource, 'marhaban');
});

check('survives every shape of junk without throwing', () => {
  const junk = [null, undefined, {}, [], 'string', 42, [[]], [null, null, null], [[[null]]], [[], 'notarray', 5]];
  junk.forEach((j) => {
    const r = GL.gtx.parse(j, 'de');
    eq(typeof r.text, 'string', 'text is always a string for ' + JSON.stringify(j));
    ok(Array.isArray(r.senses), 'senses is always an array');
    ok(Array.isArray(r.examples), 'examples is always an array');
  });
});

check('falls back to the requested language when none is detected', () => {
  eq(GL.gtx.parse([[['x', 'y']]], 'fr').detected, 'fr');
});

/* ------------------------------------------------- fallback provider --- */

section('fallback provider parser');

function throws(fn, test, what) {
  let caught = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  if (!caught) throw new Error((what || 'call') + ' should have thrown but did not');
  if (test) test(caught);
  return caught;
}

check('maps auto onto the code the provider accepts', () => {
  eq(GL.mymemory.langPair('auto', 'en'), 'Autodetect|en');
  eq(GL.mymemory.langPair('de', 'ur'), 'de|ur');
});

check('reads a successful response', () => {
  const r = GL.mymemory.parse(
    { responseStatus: 200, responseData: { translatedText: 'The house is very large', match: 0.85, detectedLanguage: 'de' } },
    'auto'
  );
  eq(r.text, 'The house is very large');
  eq(r.detected, 'de', 'detected language is used instead of "auto"');
  eq(r.confidence, 0.85);
});

// This is the bug the live check caught: HTTP 200 with responseStatus 403 and
// the error text sitting in translatedText.
check('rejects a refusal that arrives as HTTP 200', () => {
  const err = throws(
    () =>
      GL.mymemory.parse(
        {
          responseStatus: 403,
          responseData: { translatedText: "'AUTO' IS AN INVALID SOURCE LANGUAGE . EXAMPLE: LANGPAIR=EN|IT" }
        },
        'auto'
      ),
    (e) => eq(e.status, 403, 'carries the status'),
    'a 403 response'
  );
  ok(err.message.indexOf('403') !== -1, 'message names the status');
});

check('rejects error text even when the status looks fine', () => {
  throws(
    () => GL.mymemory.parse({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }, 'de'),
    null,
    'a warning in the translation field'
  );
});

check('treats an exhausted quota as a rate limit so the breaker backs off', () => {
  throws(
    () => GL.mymemory.parse({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'House' } }, 'de'),
    (e) => eq(e.status, 429, 'reported as rate limiting'),
    'quotaFinished'
  );
});

check('rejects empty and malformed bodies', () => {
  throws(() => GL.mymemory.parse(null, 'de'), null, 'null body');
  throws(() => GL.mymemory.parse({}, 'de'), null, 'empty object');
  throws(() => GL.mymemory.parse({ responseStatus: 200, responseData: {} }, 'de'), null, 'no translation');
  throws(() => GL.mymemory.parse({ responseStatus: 200, responseData: { translatedText: '' } }, 'de'), null, 'empty string');
});

check('falls back to the requested language when none is detected', () => {
  const r = GL.mymemory.parse({ responseStatus: 200, responseData: { translatedText: 'House' } }, 'de');
  eq(r.detected, 'de');
  ok(r.confidence > 0, 'a default confidence is supplied');
});

/*
 * Captured live for "Haus" de->ur. The headline answer is "مچھلي" (fish) with a
 * perfect match score but quality 0, while the correct "مکان" (house) sits
 * second. Taking translatedText at face value shows the user "fish".
 */
const BAD_HEAD = {
  responseStatus: 200,
  responseData: { translatedText: 'مچھلي', match: 1 },
  matches: [
    { translation: 'مچھلي', match: 1, quality: 0, 'usage-count': 2, 'created-by': 'Public_Corpora' },
    { translation: 'مکان', match: 1, quality: 0, 'usage-count': 2, 'created-by': 'Wikipedia' },
    { translation: 'گھر منتخب کريں', match: 0.4, quality: 0, 'usage-count': 2, 'created-by': 'Public_Corpora' }
  ]
};

check('prefers a trusted source over the noisy corpus at equal quality', () => {
  const r = GL.mymemory.parse(BAD_HEAD, 'de');
  eq(r.text, 'مکان', 'picked the Wikipedia candidate, not the corpus dump');
});

check('flags an answer that carries no quality signal', () => {
  eq(GL.mymemory.parse(BAD_HEAD, 'de').lowConfidence, true);
});

check('a real quality score wins over match score and is not flagged', () => {
  const r = GL.mymemory.parse(
    {
      responseStatus: 200,
      responseData: { translatedText: 'wrong', match: 1 },
      matches: [
        { translation: 'wrong', match: 1, quality: 0, 'usage-count': 99, 'created-by': 'Public_Corpora' },
        { translation: 'right', match: 0.85, quality: 74, 'usage-count': 2, 'created-by': 'MateCat' }
      ]
    },
    'de'
  );
  eq(r.text, 'right');
  eq(r.lowConfidence, false, 'a scored answer is trusted');
  eq(r.confidence, 0.74, 'confidence comes from the quality score');
});

check('ignores candidates that answer a different question', () => {
  const best = GL.mymemory.pickBest([
    { translation: 'unrelated', match: 0.4, quality: 90, 'created-by': 'MateCat' },
    { translation: 'relevant', match: 0.9, quality: 50, 'created-by': 'MateCat' }
  ]);
  eq(best.text, 'relevant', 'a low match score disqualifies a candidate');
});

check('ranking survives missing and malformed candidate fields', () => {
  eq(GL.mymemory.pickBest(null), null);
  eq(GL.mymemory.pickBest([]), null);
  eq(GL.mymemory.pickBest([{}, null, { translation: '   ' }]), null, 'nothing usable');
  const best = GL.mymemory.pickBest([{ translation: 'ok', match: '0.9', quality: '70' }]);
  eq(best.text, 'ok', 'numeric strings are coerced');
  eq(best.quality, 70);
});

check('still works when the response has no matches array at all', () => {
  const r = GL.mymemory.parse({ responseStatus: 200, responseData: { translatedText: 'House', match: 0.9 } }, 'de');
  eq(r.text, 'House');
  eq(r.lowConfidence, true, 'no quality signal means no assurance');
});

/* ---------------------------------------------- user-supplied key providers -- */

section('bring-your-own-key providers');

check('a free-tier DeepL key is sent to the free host', () => {
  eq(GL.byokey.deepl.host('abc123:fx'), 'https://api-free.deepl.com');
  eq(GL.byokey.deepl.host('abc123'), 'https://api.deepl.com', 'paid key');
});

check('DeepL targets that need a variant get one', () => {
  eq(GL.byokey.deepl.pair('de', 'en').target, 'EN-US');
  eq(GL.byokey.deepl.pair('de', 'pt').target, 'PT-PT');
  eq(GL.byokey.deepl.pair('en', 'de').target, 'DE');
});

check('auto source is sent as no source at all, which is how DeepL detects', () => {
  eq(GL.byokey.deepl.pair('auto', 'de').source, '');
  eq(GL.byokey.deepl.pair('fr', 'de').source, 'FR');
});

check('languages DeepL does not translate are reported as unsupported', () => {
  // Urdu is the oldest pair this extension served; DeepL has never had it.
  eq(GL.byokey.deepl.supports('ur'), false, 'urdu');
  eq(GL.byokey.deepl.supports('hi'), false, 'hindi');
  eq(GL.byokey.deepl.supports('de'), true, 'german');
  eq(GL.byokey.deepl.supports('auto'), true, 'auto always passes');
});

check('reads a DeepL response', () => {
  const r = GL.byokey.deepl.parse(
    { translations: [{ detected_source_language: 'DE', text: 'house' }] },
    'auto'
  );
  eq(r.text, 'house');
  eq(r.detected, 'de', 'lower-cased to match every other provider');
});

check('a malformed DeepL body costs the translation, not a throw', () => {
  eq(GL.byokey.deepl.parse(null, 'de').text, '');
  eq(GL.byokey.deepl.parse({}, 'de').text, '');
  eq(GL.byokey.deepl.parse({ translations: [] }, 'de').text, '');
});

check('reads a Google Cloud response', () => {
  const r = GL.byokey.gcloud.parse(
    { data: { translations: [{ translatedText: 'house', detectedSourceLanguage: 'DE' }] } },
    'auto'
  );
  eq(r.text, 'house');
  eq(r.detected, 'de');
});

check('Google Cloud HTML-escapes its output, so we decode it', () => {
  // The v2 endpoint escapes even when format=text, so this is the common case.
  eq(GL.byokey.gcloud.decodeEntities('sie sagte &gt;hallo&lt;'), 'sie sagte >hallo<');
  eq(GL.byokey.gcloud.decodeEntities('Fisch &amp; Chips'), 'Fisch & Chips');
  eq(GL.byokey.gcloud.decodeEntities('it&#39;s'), "it's");
  eq(GL.byokey.gcloud.decodeEntities('plain text'), 'plain text', 'left alone');
});

check('a malformed Google Cloud body costs the translation, not a throw', () => {
  eq(GL.byokey.gcloud.parse(null, 'de').text, '');
  eq(GL.byokey.gcloud.parse({ data: {} }, 'de').text, '');
});

check('every provider returns the same shape', () => {
  const shape = (o) => Object.keys(o).sort().join(',');
  const expected = shape(GL.gtx.parse([], 'de'));
  eq(shape(GL.byokey.deepl.parse({}, 'de')), expected, 'deepl');
  eq(shape(GL.byokey.gcloud.parse({}, 'de')), expected, 'gcloud');
});

check('an obviously wrong key is caught before it costs a round trip', () => {
  ok(GL.byokey.validateKey('gcloud', ''), 'empty');
  ok(GL.byokey.validateKey('gcloud', 'not-a-google-key'), 'wrong prefix');
  ok(GL.byokey.validateKey('deepl', 'short'), 'too short');
  ok(GL.byokey.validateKey('deepl', 'abcdefghij klmnopqrstuvwxyz'), 'contains a space');
  eq(GL.byokey.validateKey('gcloud', 'AIza' + 'x'.repeat(35)), '', 'a plausible key passes');
  eq(GL.byokey.validateKey('deepl', 'x'.repeat(36) + ':fx'), '', 'a plausible key passes');
});

/* ------------------------------------------------------------- grammar -- */

section('german grammar hints');

check('derives gender from reliable noun suffixes', () => {
  eq(GL.grammar.germanHint('Zeitung').article, 'die', '-ung');
  eq(GL.grammar.germanHint('Freiheit').article, 'die', '-heit');
  eq(GL.grammar.germanHint('Mädchen').article, 'das', '-chen');
  eq(GL.grammar.germanHint('Eigentum').article, 'das', '-tum');
  eq(GL.grammar.germanHint('Kapitalismus').article, 'der', '-ismus');
});

check('stays quiet when it does not know', () => {
  eq(GL.grammar.germanHint('Haus'), null, 'no suffix rule covers Haus');
  eq(GL.grammar.germanHint('ist'), null, 'too short');
  eq(GL.grammar.germanHint('guten Tag'), null, 'multiple words');
  eq(GL.grammar.germanHint(''), null, 'empty');
  eq(GL.grammar.germanHint(null), null, 'null');
});

check('spots separable verbs', () => {
  const h = GL.grammar.germanHint('aufstehen');
  ok(h && /separable/.test(h.note), 'aufstehen is separable');
  ok(/stehen … auf/.test(h.note), 'shows the split form, got: ' + (h && h.note));
  eq(GL.grammar.germanHint('verstehen'), null, 'ver- is not separable');
});

/* --------------------------------------------------------------- store -- */

section('storage layer');

async function storeTests() {
  section('storage layer (async)');

  await GL.store.setSettings({});
  const defaults = await GL.store.getSettings();
  check('materialises defaults', () => {
    eq(defaults.targetLang, 'en');
    eq(defaults.trigger, 'both');
    eq(defaults.enabled, true);
  });

  await GL.store.setSettings({ targetLang: 'ur' });
  const patched = await GL.store.getSettings();
  check('a patch changes one key and leaves the rest', () => {
    eq(patched.targetLang, 'ur');
    eq(patched.trigger, 'both', 'untouched key survives');
  });

  const first = await GL.store.addCard({ term: 'Haus', translation: 'house', source: 'de', target: 'en' });
  check('adds a card', () => {
    eq(first.added, true);
    eq(first.total, 1);
  });

  // Age the card so a reset would be obvious.
  let deck = await GL.store.getDeck();
  deck[0].state = 'review';
  deck[0].interval = 30;
  deck[0].reps = 9;
  await GL.store.saveDeck(deck);

  const dup = await GL.store.addCard({
    term: 'haus',
    translation: 'house',
    source: 'de',
    target: 'en',
    context: 'Das Haus ist alt.'
  });
  deck = await GL.store.getDeck();
  check('re-saving a known word does not reset its progress', () => {
    eq(dup.added, false, 'reported as not added');
    eq(deck.length, 1, 'no duplicate row');
    eq(deck[0].interval, 30, 'interval preserved');
    eq(deck[0].reps, 9, 'reps preserved');
    eq(deck[0].context, 'Das Haus ist alt.', 'but new context is filled in');
  });

  await GL.store.addCard({ term: 'Haus', translation: 'گھر', source: 'de', target: 'ur' });
  deck = await GL.store.getDeck();
  check('the same word into a different language is a separate card', () => {
    eq(deck.length, 2);
  });

  const kept = await GL.store.removeCards([deck[0].id]);
  check('removes by id', () => {
    eq(kept.length, 1);
    eq(kept[0].target, 'ur');
  });

  const stats = await GL.store.getStats();
  check('counts activity for today', () => {
    const todayKey = GL.store.today();
    ok(stats.days[todayKey], 'today has a bucket');
    ok(stats.days[todayKey].saves >= 2, 'saves were counted, got ' + stats.days[todayKey].saves);
  });

  check('streak counts back over consecutive active days', () => {
    const d = (n) => GL.store.today(Date.now() - n * 86400000);
    eq(GL.store.streakOf({ [d(0)]: { lookups: 1 }, [d(1)]: { lookups: 1 }, [d(2)]: { lookups: 3 } }), 3);
    eq(GL.store.streakOf({ [d(1)]: { lookups: 1 }, [d(2)]: { lookups: 1 } }), 2, 'idle today keeps the streak');
    eq(GL.store.streakOf({ [d(0)]: { lookups: 1 }, [d(3)]: { lookups: 1 } }), 1, 'a gap ends it');
    eq(GL.store.streakOf({}), 0, 'no history');
    eq(GL.store.streakOf({ [d(0)]: { lookups: 0, reviews: 0, saves: 0 } }), 0, 'an empty day is not activity');
  });

  check('today() formats a local calendar day', () => {
    eq(GL.store.today(new Date(2026, 8, 5)), '2026-09-05', 'zero padded');
  });
}

/* ---------------------------------------------------------------- live -- */

async function liveTests() {
  section('live fallback provider (--live)');

  const callFallback = async (text, sl, tl) => {
    const url =
      'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
      '&langpair=' + encodeURIComponent(GL.mymemory.langPair(sl, tl));
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return GL.mymemory.parse(await res.json(), sl);
  };

  try {
    const auto = await callFallback('Das Haus ist sehr gross', 'auto', 'en');
    check('auto-detect works through the fallback', () => {
      eq(auto.detected, 'de', 'detected language');
      ok(/house/i.test(auto.text), 'got "' + auto.text + '"');
    });
    console.log('      → "' + auto.text + '" (detected ' + auto.detected + ')');

    // "Haus" de->ur is the case where the headline answer is "مچھلي" (fish) and
    // the ranking has to reach past it for "مکان" (house).
    const ur = await callFallback('Haus', 'de', 'ur');
    check('ranks past a bad headline answer on a live response', () => {
      ok(/[؀-ۿ]/.test(ur.text), 'result is in Arabic script: "' + ur.text + '"');
      ok(ur.text.indexOf('مچھل') === -1, 'did not return "fish", got "' + ur.text + '"');
      ok(ur.text.indexOf('مکان') !== -1 || ur.text.indexOf('گھر') !== -1, 'means house, got "' + ur.text + '"');
    });
    console.log('      → "Haus" = "' + ur.text + '"');
  } catch (e) {
    failed += 1;
    failures.push('live fallback: ' + e.message);
    console.log('  ✗ fallback unreachable: ' + e.message);
  }

  section('live primary endpoint (--live)');

  const call = async (text, sl, tl) => {
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + sl + '&tl=' + tl +
      '&dt=t&dt=bd&dt=rm&dt=ex&q=' + encodeURIComponent(text);
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return GL.gtx.parse(await res.json(), sl);
  };

  try {
    // The extension resolves "auto" to a concrete language before asking, so
    // this is the request it actually sends for a hovered word.
    const de = await call('Haus', 'de', 'en');
    check('translates a word with an explicit source language', () => {
      ok(/house|home/i.test(de.text), 'translation was "' + de.text + '"');
    });
    check('the dictionary comes back populated for a single word', () => {
      ok(de.senses.length > 0, 'got ' + de.senses.length + ' sense groups');
      ok(de.senses[0].pos, 'first sense has a part of speech: ' + de.senses[0].pos);
    });
    console.log('      → "Haus" = "' + de.text + '" (' + de.senses.length + ' senses, ' +
      de.examples.length + ' examples)');

    /*
     * Why the extension no longer sends "auto" for a bare word: the endpoint
     * reads the German "Haus" as English and hands it straight back. Detection
     * needs a sentence, which is what content.js feeds it.
     */
    const bareWord = await call('Haus', 'auto', 'en');
    const sentence = await call('Das Haus ist sehr gross und alt.', 'auto', 'en');
    check('auto-detect is unreliable on one word but works on a sentence', () => {
      eq(sentence.detected, 'de', 'sentence detected correctly');
      ok(/house/i.test(sentence.text), 'sentence translated: "' + sentence.text + '"');
    });
    console.log('      → bare word "Haus" detected as "' + bareWord.detected +
      '" (confidence ' + bareWord.confidence + ') vs sentence detected as "' +
      sentence.detected + '"');

    const ur = await call('Schmetterling', 'de', 'ur');
    check('translates German into Urdu', () => {
      ok(ur.text && ur.text.length > 0, 'got "' + ur.text + '"');
      ok(/[؀-ۿ]/.test(ur.text), 'result is in Arabic script');
    });
    console.log('      → "Schmetterling" = "' + ur.text + '"' +
      (ur.romanTarget ? ' (roman: ' + ur.romanTarget + ')' : ''));

    const zh = await call('蝴蝶', 'auto', 'en');
    check('handles a script with no spaces between words', () => {
      eq(zh.detected.slice(0, 2), 'zh', 'detected ' + zh.detected);
      ok(/butterfl/i.test(zh.text), 'got "' + zh.text + '"');
    });

    const multi = await call('Guten Morgen. Wie geht es dir?', 'de', 'en');
    check('a multi-sentence request comes back whole', () => {
      ok(/morning/i.test(multi.text), 'got "' + multi.text + '"');
      ok(/how are you/i.test(multi.text), 'second sentence present');
    });
    console.log('      → "' + multi.text + '"');
  } catch (e) {
    if (/HTTP 429/.test(e.message)) {
      // The public endpoint rate-limits by IP. That is a fact about the network
      // this ran on, not a defect — and it is exactly the case the extension
      // handles by falling back, which the section above just proved works.
      console.log('  ~ skipped: the endpoint is rate limiting this IP (HTTP 429).');
      console.log('    The fallback provider covers this case; see the section above.');
      return;
    }
    failed += 1;
    failures.push('live primary endpoint: ' + e.message);
    console.log('  ✗ live endpoint unreachable: ' + e.message);
  }
}

/* ---------------------------------------------------------------- main -- */

(async () => {
  await storeTests();
  if (process.argv.includes('--live')) await liveTests();

  console.log('\n' + '-'.repeat(52));
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(failed ? 1 : 0);
})();
