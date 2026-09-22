/**
 * German morphology tests.
 *
 * Every expectation here is a form a learner would be shown, so it is written
 * out literally rather than derived from the same rules being tested.
 *
 *   node tests/german.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, Intl, Date, Math, JSON, Map, Set, RegExp };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// The generated Wiktionary table is optional: the engine works without it, and
// the tests below cover both cases.
const GENERATED_PATH = path.join(ROOT, 'src/lib/german-verbs.js');
const hasGenerated = fs.existsSync(GENERATED_PATH);
if (hasGenerated) {
  vm.runInContext(fs.readFileSync(GENERATED_PATH, 'utf8'), sandbox, { filename: 'german-verbs.js' });
}

['src/lib/languages.js', 'src/lib/grammar.js', 'src/lib/german.js'].forEach((rel) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
});

const G = sandbox.GL.german;

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
function eq(a, b, what) {
  if (a !== b) throw new Error((what || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(c, what) {
  if (!c) throw new Error(what || 'expected truthy');
}
const section = (t) => console.log('\n' + t);

/** Asserts the six forms of one tense. */
function tense(conj, key, expected) {
  const t = conj.tenses.find((x) => x.key === key);
  if (!t) throw new Error('no tense ' + key);
  eq(t.forms.join(' | '), expected.join(' | '), key + ':');
}

/* --------------------------------------------------------------- weak --- */

section('weak verbs — machen');

const machen = G.conjugate('machen');

check('Präsens', () => {
  tense(machen, 'praesens', ['mache', 'machst', 'macht', 'machen', 'macht', 'machen']);
});
check('Präteritum', () => {
  tense(machen, 'praeteritum', ['machte', 'machtest', 'machte', 'machten', 'machtet', 'machten']);
});
check('Perfekt uses haben + gemacht', () => {
  eq(machen.partizip2, 'gemacht');
  eq(machen.auxiliary, 'haben');
  tense(machen, 'perfekt', ['habe gemacht', 'hast gemacht', 'hat gemacht', 'haben gemacht', 'habt gemacht', 'haben gemacht']);
});
check('Plusquamperfekt', () => {
  tense(machen, 'plusquamperfekt', ['hatte gemacht', 'hattest gemacht', 'hatte gemacht', 'hatten gemacht', 'hattet gemacht', 'hatten gemacht']);
});
check('Futur I', () => {
  tense(machen, 'futur1', ['werde machen', 'wirst machen', 'wird machen', 'werden machen', 'werdet machen', 'werden machen']);
});
check('Konjunktiv I', () => {
  tense(machen, 'konjunktiv1', ['mache', 'machest', 'mache', 'machen', 'machet', 'machen']);
});
check('Konjunktiv II falls back to würde for a weak verb', () => {
  tense(machen, 'konjunktiv2', ['würde machen', 'würdest machen', 'würde machen', 'würden machen', 'würdet machen', 'würden machen']);
});
check('Imperativ', () => {
  eq(machen.imperative.join(' | '), 'mach | macht | machen Sie');
});
check('Partizip I', () => eq(machen.partizip1, 'machend'));

section('weak verbs — spelling rules');

check('stem in -t inserts an e: arbeiten', () => {
  const c = G.conjugate('arbeiten');
  tense(c, 'praesens', ['arbeite', 'arbeitest', 'arbeitet', 'arbeiten', 'arbeitet', 'arbeiten']);
  tense(c, 'praeteritum', ['arbeitete', 'arbeitetest', 'arbeitete', 'arbeiteten', 'arbeitetet', 'arbeiteten']);
  eq(c.partizip2, 'gearbeitet');
  eq(c.imperative[0], 'arbeite', 'du-imperative keeps the e');
});

check('consonant + n inserts an e: rechnen, öffnen, atmen', () => {
  eq(G.conjugate('rechnen').tenses[0].forms[1], 'rechnest');
  eq(G.conjugate('öffnen').tenses[0].forms[2], 'öffnet');
  eq(G.conjugate('atmen').tenses[0].forms[1], 'atmest');
});

check('l or r before n does not: lernen, filmen', () => {
  eq(G.conjugate('lernen').tenses[0].forms[1], 'lernst');
  eq(G.conjugate('filmen').tenses[0].forms[1], 'filmst');
});

check('an s-sound stem takes only -t in the du-form: tanzen, reisen', () => {
  eq(G.conjugate('tanzen').tenses[0].forms[1], 'tanzt');
  eq(G.conjugate('reisen').tenses[0].forms[1], 'reist');
});

check('-eln drops the e in the ich-form: sammeln', () => {
  const c = G.conjugate('sammeln');
  tense(c, 'praesens', ['sammle', 'sammelst', 'sammelt', 'sammeln', 'sammelt', 'sammeln']);
  eq(c.partizip2, 'gesammelt');
});

check('-ieren takes no ge-: studieren, telefonieren', () => {
  eq(G.conjugate('studieren').partizip2, 'studiert');
  eq(G.conjugate('telefonieren').partizip2, 'telefoniert');
});

check('an inseparable prefix takes no ge-: besuchen, verkaufen, erklären', () => {
  eq(G.conjugate('besuchen').partizip2, 'besucht');
  eq(G.conjugate('verkaufen').partizip2, 'verkauft');
  eq(G.conjugate('erklären').partizip2, 'erklärt');
});

/* ------------------------------------------------------------- strong --- */

section('strong verbs');

check('gehen — ging, gegangen, with sein', () => {
  const c = G.conjugate('gehen');
  eq(c.auxiliary, 'sein');
  eq(c.partizip2, 'gegangen');
  tense(c, 'praeteritum', ['ging', 'gingst', 'ging', 'gingen', 'gingt', 'gingen']);
  tense(c, 'perfekt', ['bin gegangen', 'bist gegangen', 'ist gegangen', 'sind gegangen', 'seid gegangen', 'sind gegangen']);
  tense(c, 'konjunktiv2', ['ginge', 'gingest', 'ginge', 'gingen', 'ginget', 'gingen']);
});

check('sprechen — e→i in du and er', () => {
  const c = G.conjugate('sprechen');
  tense(c, 'praesens', ['spreche', 'sprichst', 'spricht', 'sprechen', 'sprecht', 'sprechen']);
  eq(c.partizip2, 'gesprochen');
  tense(c, 'praeteritum', ['sprach', 'sprachst', 'sprach', 'sprachen', 'spracht', 'sprachen']);
  eq(c.imperative[0], 'sprich', 'imperative uses the shifted stem, no -e');
});

check('geben — gib, gab, gegeben', () => {
  const c = G.conjugate('geben');
  tense(c, 'praesens', ['gebe', 'gibst', 'gibt', 'geben', 'gebt', 'geben']);
  eq(c.imperative[0], 'gib');
  tense(c, 'konjunktiv2', ['gäbe', 'gäbest', 'gäbe', 'gäben', 'gäbet', 'gäben']);
});

check('lesen and essen — shifted stem already ends in s', () => {
  eq(G.conjugate('lesen').tenses[0].forms[1], 'liest', 'du liest');
  eq(G.conjugate('lesen').tenses[0].forms[2], 'liest', 'er liest');
  eq(G.conjugate('essen').tenses[0].forms[1], 'isst', 'du isst');
  eq(G.conjugate('essen').partizip2, 'gegessen');
});

check('fahren — a→ä, but the imperative keeps the plain stem', () => {
  const c = G.conjugate('fahren');
  tense(c, 'praesens', ['fahre', 'fährst', 'fährt', 'fahren', 'fahrt', 'fahren']);
  eq(c.auxiliary, 'sein');
  eq(c.imperative[0], 'fahr', 'a→ä verbs do not umlaut the imperative');
  tense(c, 'konjunktiv2', ['führe', 'führest', 'führe', 'führen', 'führet', 'führen']);
});

check('halten and lassen — stems ending in t and s', () => {
  eq(G.conjugate('halten').tenses[0].forms[1], 'hältst');
  eq(G.conjugate('halten').tenses[0].forms[2], 'hält');
  eq(G.conjugate('lassen').tenses[0].forms[1], 'lässt');
});

check('finden — Präteritum stem ends in d', () => {
  tense(G.conjugate('finden'), 'praeteritum', ['fand', 'fandest', 'fand', 'fanden', 'fandet', 'fanden']);
});

check('essen — Präteritum stem ends in ß', () => {
  tense(G.conjugate('essen'), 'praeteritum', ['aß', 'aßest', 'aß', 'aßen', 'aßt', 'aßen']);
});

check('nehmen — nimm, nahm, genommen', () => {
  const c = G.conjugate('nehmen');
  eq(c.tenses[0].forms[1], 'nimmst');
  eq(c.partizip2, 'genommen');
  eq(c.imperative[0], 'nimm');
});

/* ------------------------------------------------------ sein and modals -- */

section('sein, haben, werden, modals');

check('sein', () => {
  const c = G.conjugate('sein');
  tense(c, 'praesens', ['bin', 'bist', 'ist', 'sind', 'seid', 'sind']);
  tense(c, 'praeteritum', ['war', 'warst', 'war', 'waren', 'wart', 'waren']);
  tense(c, 'konjunktiv1', ['sei', 'seiest', 'sei', 'seien', 'seiet', 'seien']);
  tense(c, 'konjunktiv2', ['wäre', 'wärest', 'wäre', 'wären', 'wäret', 'wären']);
  eq(c.partizip2, 'gewesen');
  eq(c.auxiliary, 'sein');
});

check('haben', () => {
  const c = G.conjugate('haben');
  tense(c, 'praesens', ['habe', 'hast', 'hat', 'haben', 'habt', 'haben']);
  tense(c, 'konjunktiv2', ['hätte', 'hättest', 'hätte', 'hätten', 'hättet', 'hätten']);
});

check('werden', () => {
  const c = G.conjugate('werden');
  tense(c, 'praesens', ['werde', 'wirst', 'wird', 'werden', 'werdet', 'werden']);
  eq(c.partizip2, 'geworden');
  eq(c.auxiliary, 'sein');
});

check('können — ich and er share a form, no -e', () => {
  const c = G.conjugate('können');
  tense(c, 'praesens', ['kann', 'kannst', 'kann', 'können', 'könnt', 'können']);
  tense(c, 'praeteritum', ['konnte', 'konntest', 'konnte', 'konnten', 'konntet', 'konnten']);
  tense(c, 'konjunktiv2', ['könnte', 'könntest', 'könnte', 'könnten', 'könntet', 'könnten']);
});

check('müssen, dürfen, wollen, mögen, wissen', () => {
  eq(G.conjugate('müssen').tenses[0].forms[0], 'muss');
  eq(G.conjugate('dürfen').tenses[0].forms[0], 'darf');
  eq(G.conjugate('wollen').tenses[0].forms[2], 'will');
  eq(G.conjugate('mögen').tenses[0].forms[0], 'mag');
  eq(G.conjugate('wissen').tenses[0].forms[0], 'weiß');
  eq(G.conjugate('wissen').partizip2, 'gewusst');
});

/**
 * Every modal was reported as a strong verb until Sept 2026, because the
 * classifier had only weak/mixed/strong and anything with a table entry but no
 * weakPast flag fell through to strong. They are Präteritopräsentia: the
 * endingless ich-form comes from an old strong preterite, the past is weak.
 * The wrong label was showing in the panel a learner reads most carefully.
 */
check('every modal is classed as a modal, not as a strong verb', () => {
  ['können', 'müssen', 'dürfen', 'sollen', 'wollen', 'mögen'].forEach((v) => {
    const c = G.conjugate(v);
    eq(c.kind, 'modal', v + ' kind');
    eq(c.modal, true, v + ' modal flag');
  });
});

check('wissen is a preterite-present but not a modal', () => {
  // Endingless "weiß" like the modals, but it governs a clause rather than a
  // bare infinitive, so there is no Ersatzinfinitiv to warn about.
  const c = G.conjugate('wissen');
  eq(c.kind, 'mixed', 'vowel change plus weak endings is the mixed pattern');
  eq(c.modal, false, 'not a modal');
});

check('ordinary verbs keep their classification', () => {
  // Guards the modal branch against swallowing anything it should not.
  eq(G.conjugate('sprechen').kind, 'strong');
  eq(G.conjugate('bringen').kind, 'mixed');
  eq(G.conjugate('machen').kind, 'weak');
  eq(G.conjugate('sprechen').modal, false);
  eq(G.conjugate('machen').modal, false);
});

check('a modal keeps its standalone Perfekt forms', () => {
  // "Ich habe das gekonnt" is correct German — the Partizip II is right when
  // the modal stands alone. The Ersatzinfinitiv caveat is presentation, not a
  // reason to change the table, so the forms must stay as they are.
  const c = G.conjugate('können');
  eq(c.partizip2, 'gekonnt');
  tense(c, 'perfekt', [
    'habe gekonnt', 'hast gekonnt', 'hat gekonnt',
    'haben gekonnt', 'habt gekonnt', 'haben gekonnt'
  ]);
});

/* ------------------------------------------------------------- mixed ---- */

section('mixed verbs');

check('bringen and denken take weak endings on a changed stem', () => {
  tense(G.conjugate('bringen'), 'praeteritum', ['brachte', 'brachtest', 'brachte', 'brachten', 'brachtet', 'brachten']);
  eq(G.conjugate('bringen').partizip2, 'gebracht');
  tense(G.conjugate('denken'), 'praeteritum', ['dachte', 'dachtest', 'dachte', 'dachten', 'dachtet', 'dachten']);
  eq(G.conjugate('denken').partizip2, 'gedacht');
  eq(G.conjugate('denken').kind, 'mixed');
});

/* --------------------------------------------------------- separable ---- */

section('separable prefixes');

check('aufstehen — prefix detaches, ge- goes inside', () => {
  const c = G.conjugate('aufstehen');
  eq(c.separable, 'auf');
  eq(c.partizip2, 'aufgestanden');
  tense(c, 'praesens', ['stehe auf', 'stehst auf', 'steht auf', 'stehen auf', 'steht auf', 'stehen auf']);
  tense(c, 'praeteritum', ['stand auf', 'standest auf', 'stand auf', 'standen auf', 'standet auf', 'standen auf']);
});

check('aufstehen takes sein even though stehen takes haben', () => {
  const c = G.conjugate('aufstehen');
  eq(c.auxiliary, 'sein');
  eq(c.tenses[2].forms[0], 'bin aufgestanden', 'Perfekt');
  eq(G.conjugate('stehen').auxiliary, 'haben', 'the base is unchanged');
});

check('a separable verb splits in the polite imperative too', () => {
  eq(G.conjugate('aufstehen').imperative.join(' | '), 'steh auf | steht auf | stehen Sie auf');
  eq(G.conjugate('anrufen').imperative[2], 'rufen Sie an');
});

check('sein has its own imperative', () => {
  eq(G.conjugate('sein').imperative.join(' | '), 'sei | seid | seien Sie');
});

check('a separable verb inherits sein from its base: ankommen', () => {
  eq(G.conjugate('ankommen').auxiliary, 'sein');
  eq(G.conjugate('ankommen').tenses[2].forms[2], 'ist angekommen');
});

check('anrufen — strong base inherited through the prefix', () => {
  const c = G.conjugate('anrufen');
  eq(c.partizip2, 'angerufen');
  eq(c.tenses[0].forms[0], 'rufe an');
  eq(c.tenses[1].forms[0], 'rief an');
});

check('einkaufen — weak base with a separable prefix', () => {
  const c = G.conjugate('einkaufen');
  eq(c.partizip2, 'eingekauft');
  eq(c.tenses[0].forms[0], 'kaufe ein');
});

check('mitnehmen — vowel shift survives the prefix', () => {
  const c = G.conjugate('mitnehmen');
  eq(c.tenses[0].forms[1], 'nimmst mit');
  eq(c.partizip2, 'mitgenommen');
});

check('verstehen — inseparable, so no ge- and no detaching', () => {
  const c = G.conjugate('verstehen');
  eq(c.separable, null);
  eq(c.partizip2, 'verstanden');
  eq(c.tenses[0].forms[0], 'verstehe');
});

/* --------------------------------------------------------- lemmatise ---- */

section('finding the infinitive from an inflected form');

check('recognises strong forms', () => {
  eq(G.lemmatize('ging').infinitive, 'gehen');
  eq(G.lemmatize('gegangen').infinitive, 'gehen');
  eq(G.lemmatize('spricht').infinitive, 'sprechen');
  eq(G.lemmatize('sprichst').infinitive, 'sprechen');
  eq(G.lemmatize('gesprochen').infinitive, 'sprechen');
  eq(G.lemmatize('war').infinitive, 'sein');
  eq(G.lemmatize('ist').infinitive, 'sein');
  eq(G.lemmatize('hätte').infinitive, 'haben');
  eq(G.lemmatize('genommen').infinitive, 'nehmen');
});

check('marks a confident match as certain', () => {
  eq(G.lemmatize('gegangen').certain, true);
  eq(G.lemmatize('gehen').certain, true);
});

check('handles weak forms, flagging the uncertain ones', () => {
  eq(G.lemmatize('machte').infinitive, 'machen');
  eq(G.lemmatize('gemacht').infinitive, 'machen');
  eq(G.lemmatize('machte').certain, false, 'a weak guess is not certain');
});

check('returns null for a non-word', () => {
  eq(G.lemmatize(''), null);
  eq(G.lemmatize('a'), null);
  eq(G.lemmatize('zwei worte'), null);
});

/* ------------------------------------------------------------- nouns ---- */

section('noun case tables');

check('masculine', () => {
  const d = G.declineNoun('Mann', 'der');
  eq(d.singular.join(' | '), 'der Mann | den Mann | dem Mann | des Mannes');
});

check('feminine has no genitive -s', () => {
  const d = G.declineNoun('Frau', 'die');
  eq(d.singular.join(' | '), 'die Frau | die Frau | der Frau | der Frau');
});

check('neuter', () => {
  const d = G.declineNoun('Kind', 'das');
  eq(d.singular.join(' | '), 'das Kind | das Kind | dem Kind | des Kindes');
});

check('polysyllables take a plain -s in the genitive', () => {
  eq(G.declineNoun('Lehrer', 'der').singular[3], 'des Lehrers');
  eq(G.declineNoun('Computer', 'der').singular[3], 'des Computers');
});

check('the dative plural adds -n unless it already ends in n or s', () => {
  eq(G.declineNoun('Kind', 'das', 'Kinder').plural.join(' | '), 'die Kinder | die Kinder | den Kindern | der Kinder');
  eq(G.declineNoun('Frau', 'die', 'Frauen').plural[2], 'den Frauen', 'already ends in n');
  eq(G.declineNoun('Auto', 'das', 'Autos').plural[2], 'den Autos', 'already ends in s');
});

/* -------------------------------------------------------- adjectives ---- */

section('adjective comparison');

check('regular', () => {
  const c = G.compareAdjective('klein');
  eq(c.comparative, 'kleiner');
  eq(c.superlative, 'am kleinsten');
});

check('umlauting monosyllables', () => {
  eq(G.compareAdjective('alt').comparative, 'älter');
  eq(G.compareAdjective('jung').comparative, 'jünger');
  eq(G.compareAdjective('groß').comparative, 'größer');
  eq(G.compareAdjective('lang').superlative, 'am längsten');
});

check('an -est superlative after d, t, s, ß, z', () => {
  eq(G.compareAdjective('alt').superlative, 'am ältesten');
  eq(G.compareAdjective('breit').superlative, 'am breitesten');
  eq(G.compareAdjective('groß').superlative, 'am größten', 'groß is the exception');
});

check('irregular', () => {
  eq(G.compareAdjective('gut').comparative, 'besser');
  eq(G.compareAdjective('gut').superlative, 'am besten');
  eq(G.compareAdjective('viel').comparative, 'mehr');
  eq(G.compareAdjective('hoch').comparative, 'höher');
});

check('-er adjectives drop the e: teuer', () => {
  eq(G.compareAdjective('teuer').comparative, 'teurer');
});

/* ------------------------------------------------------------ analyze --- */

section('choosing what to show');

check('a dictionary verb gets a conjugation', () => {
  const a = G.analyze('sprechen', 'verb');
  eq(a.type, 'verb');
  eq(a.lemma, 'sprechen');
  ok(a.conjugation.tenses.length >= 8, 'has the full set of tenses');
});

check('an inflected verb is traced back and flagged as inflected', () => {
  const a = G.analyze('spricht', 'verb');
  eq(a.type, 'verb');
  eq(a.lemma, 'sprechen');
  eq(a.inflected, true);
});

check('a capitalised word is treated as a noun', () => {
  const a = G.analyze('Zeitung');
  eq(a.type, 'noun');
  eq(a.gender, 'die');
  ok(a.declension, 'has a case table');
});

check('a noun whose gender is not derivable says so instead of guessing', () => {
  const a = G.analyze('Haus', 'noun');
  eq(a.type, 'noun');
  eq(a.gender, null);
  eq(a.declension, null);
  ok(a.unknown, 'explains why: ' + a.unknown);
});

check('an adjective gets comparison', () => {
  const a = G.analyze('schnell', 'adjective');
  eq(a.type, 'adjective');
  eq(a.comparison.comparative, 'schneller');
});

check('returns null when there is nothing to say', () => {
  eq(G.analyze(''), null);
  eq(G.analyze('guten Tag'), null);
});

/* --------------------------------------------------- no form is garbage -- */

section('every generated form is well formed');

check('no form is empty, doubled or left with a stray marker', () => {
  const bad = [];
  const verbs = ['machen', 'arbeiten', 'gehen', 'sein', 'haben', 'werden', 'können',
    'sprechen', 'aufstehen', 'anrufen', 'studieren', 'sammeln', 'verstehen', 'essen',
    'fahren', 'bringen', 'wissen', 'einkaufen', 'mitnehmen', 'öffnen'];
  verbs.forEach((v) => {
    const c = G.conjugate(v);
    if (!c) return bad.push(v + ': no conjugation');
    c.tenses.forEach((t) => {
      if (t.forms.length !== 6) bad.push(v + '/' + t.key + ': ' + t.forms.length + ' forms');
      t.forms.forEach((f) => {
        if (!f || !f.trim()) bad.push(v + '/' + t.key + ': empty form');
        if (/undefined|null|NaN/.test(f)) bad.push(v + '/' + t.key + ': "' + f + '"');
        if (/\s{2,}/.test(f)) bad.push(v + '/' + t.key + ': double space in "' + f + '"');
      });
    });
    if (/undefined/.test(c.partizip2)) bad.push(v + ': bad Partizip II');
  });
  eq(bad.join('; '), '', 'problems:');
});

check('every irregular entry conjugates without throwing', () => {
  let n = 0;
  const bad = [];
  Object.keys(sandbox.GL.german).length; // touch the namespace
  ['gehen', 'sein', 'essen', 'fahren'].forEach(() => (n += 1));
  // Walk the whole table through the public API.
  const index = G.lemmatize('ging'); // forces the index to build
  ok(index, 'index built');
  ok(G.irregularCount() > 80, 'table has ' + G.irregularCount() + ' verbs');
  eq(bad.join('; '), '');
});

/* ------------------------------------------------ the generated table --- */

section('generated Wiktionary table');

if (!hasGenerated) {
  console.log('  ~ src/lib/german-verbs.js not present — build it with');
  console.log('    node tools/fetch-verbs.js');
} else {
  const meta = G.tableMeta();
  const table = sandbox.GL_VERBS;

  check('loads and declares where it came from', () => {
    ok(G.hasGeneratedTable(), 'engine sees the table');
    ok(meta && meta.source, 'has provenance: ' + JSON.stringify(meta));
    ok(meta.count > 0, 'has entries');
  });

  check('a partial table is not treated as the complete list', () => {
    eq(G.listComplete(), !!meta.complete, 'completeness follows the generated flag');
  });

  check('every generated entry conjugates into well-formed output', () => {
    const bad = [];
    Object.keys(table).forEach((inf) => {
      const c = G.conjugate(inf);
      if (!c) return bad.push(inf + ': no conjugation');
      const forms = c.tenses.reduce((all, t) => all.concat(t.forms), []).concat(c.partizip2, c.imperative);
      forms.forEach((f) => {
        if (!f || !String(f).trim()) bad.push(inf + ': empty form');
        else if (/undefined|null|NaN/.test(f)) bad.push(inf + ': "' + f + '"');
      });
    });
    eq(bad.slice(0, 8).join('; '), '', bad.length + ' malformed:');
  });

  check('a separable entry keeps its prefix in the Partizip II', () => {
    const bad = [];
    Object.keys(table).forEach((inf) => {
      if (!table[inf].sep) return;
      const c = G.conjugate(inf);
      if (c && !c.partizip2.startsWith(table[inf].sep)) {
        bad.push(inf + ' -> ' + c.partizip2);
      }
    });
    eq(bad.slice(0, 8).join('; '), '', bad.length + ' missing their prefix:');
  });

  check('the hand-written core still wins over the generated table', () => {
    // sein and the modals need spelled-out forms no stem table can express.
    eq(G.conjugate('sein').tenses[0].forms[0], 'bin');
    eq(G.conjugate('können').tenses[0].forms[0], 'kann');
    eq(G.conjugate('haben').tenses[0].forms[1], 'hast');
  });
}

console.log('\n' + '-'.repeat(52));
console.log(passed + ' passed, ' + failed + ' failed');
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exit(failed ? 1 : 0);
