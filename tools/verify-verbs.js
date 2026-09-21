/**
 * Checks every verb in the bundled table against German Wiktionary.
 *
 * The table in src/lib/german.js is typed by hand, which is exactly the kind of
 * data that rots quietly. This compares each entry's Partizip II, Präteritum,
 * Konjunktiv II, shifted present stem and auxiliary against Wiktionary's
 * Flexion page and prints the differences.
 *
 * Development-time only — nothing here ships or runs on a user's machine.
 *
 *   node tools/verify-verbs.js            check every verb in the table
 *   node tools/verify-verbs.js gehen ...  check only the named verbs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { wikitext, parseTemplate } = require('./wiktionary');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, Intl, Date, Math, JSON, Map, Set, RegExp };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['src/lib/languages.js', 'src/lib/grammar.js', 'src/lib/german.js'].forEach((rel) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
});
const G = sandbox.GL.german;

/** The infinitives the table knows, read back out of the source. */
function tableVerbs() {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/german.js'), 'utf8');
  const block = src.slice(src.indexOf('const IRREGULAR = {'), src.indexOf('delete IRREGULAR.koennen'));
  const found = [];
  const re = /^\s{4}([a-zäöüß]+):\s*\{/gm;
  let m;
  while ((m = re.exec(block))) found.push(m[1]);
  return found;
}

const norm = (s) => (s || '').trim().toLowerCase();

async function checkVerb(inf) {
  const conj = G.conjugate(inf);
  if (!conj) return { inf, problems: ['not conjugated by the bundled engine'] };

  const text = await wikitext('Flexion:' + inf);
  if (!text) return { inf, missing: true, problems: [] };

  const w = parseTemplate(text);
  if (!w) return { inf, missing: true, problems: [] };

  const problems = [];

  if (w.regular) {
    problems.push('Wiktionary lists this as a REGULAR verb, but the table has it as irregular');
    return { inf, problems };
  }

  // Partizip II — the one a learner is most likely to be taught wrongly.
  if (w.partizip2 && norm(w.partizip2) !== norm(conj.partizip2)) {
    problems.push('Partizip II: table "' + conj.partizip2 + '" vs Wiktionary "' + w.partizip2 + '"');
  }

  // Präteritum, 1st person singular.
  const ours = conj.tenses.find((t) => t.key === 'praeteritum').forms[0];
  // Wiktionary gives the bare stem for strong verbs and the full form for the
  // mixed ones; a separable verb carries its prefix on our side only.
  const oursBase = ours.replace(/\s+\S+$/, '');
  if (w.praet) {
    const theirs = (w.prefix ? '' : '') + w.praet;
    if (norm(oursBase) !== norm(theirs) && norm(oursBase) !== norm(theirs + 'e')) {
      problems.push('Präteritum (ich): table "' + oursBase + '" vs Wiktionary "' + theirs + '"');
    }
  }

  // Konjunktiv II — Wiktionary may offer two acceptable stems.
  const k2 = conj.tenses.find((t) => t.key === 'konjunktiv2');
  if (w.konj2 && k2 && !/würde/.test(k2.forms[0])) {
    const oursK2 = k2.forms[0].replace(/\s+\S+$/, '');
    const accepted = [w.konj2, w.konj2alt].filter(Boolean).map((s) => norm(s) + 'e');
    if (accepted.length && accepted.indexOf(norm(oursK2)) === -1) {
      problems.push(
        'Konjunktiv II: table "' + oursK2 + '" vs Wiktionary ' +
          accepted.map((a) => '"' + a + '"').join(' or ')
      );
    }
  }

  // Auxiliary.
  if (w.aux !== conj.auxiliary) {
    problems.push('Auxiliary: table "' + conj.auxiliary + '" vs Wiktionary "' + w.aux + '"');
  }

  // Shifted present stem, checked through the er-form it produces. Verbs whose
  // forms Wiktionary spells out by hand (sein) carry a stem that is not used as
  // a stem at all, so there is nothing to compare.
  if (w.shifted && !w.spelledOut) {
    const er = conj.tenses[0].forms[2].replace(/\s+\S+$/, '');
    const expected = norm(w.shifted);
    if (!norm(er).startsWith(expected) && !expected.startsWith(norm(er))) {
      problems.push('Präsens (er): table "' + er + '" vs Wiktionary stem "' + w.shifted + '"');
    }
  }

  return { inf, problems };
}

(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const verbs = only.length ? only : tableVerbs();

  console.log('Checking ' + verbs.length + ' verbs against de.wiktionary.org\n');

  const mismatched = [];
  const missing = [];
  let clean = 0;

  for (let i = 0; i < verbs.length; i += 1) {
    const inf = verbs[i];
    let result;
    try {
      result = await checkVerb(inf);
    } catch (e) {
      console.log('  ?  ' + inf + ' — ' + e.message);
      continue;
    }

    if (result.missing) {
      missing.push(inf);
      process.stdout.write('.');
    } else if (result.problems.length) {
      mismatched.push(result);
      process.stdout.write('X');
    } else {
      clean += 1;
      process.stdout.write('.');
    }
    if ((i + 1) % 60 === 0) process.stdout.write('  ' + (i + 1) + '\n');
  }

  console.log('\n\n' + '='.repeat(60));
  console.log(clean + ' verified, ' + mismatched.length + ' with differences, ' + missing.length + ' not on Wiktionary');

  if (mismatched.length) {
    console.log('\nDifferences:');
    mismatched.forEach((r) => {
      console.log('\n  ' + r.inf);
      r.problems.forEach((p) => console.log('    - ' + p));
    });
  }
  if (missing.length) console.log('\nNo Flexion page: ' + missing.join(', '));

  process.exit(mismatched.length ? 1 : 0);
})();
