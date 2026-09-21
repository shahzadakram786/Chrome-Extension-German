/**
 * Builds the irregular-verb table from German Wiktionary.
 *
 * Why this exists: the engine treats "not in the table" as "regular", and
 * conjugates accordingly. That inference is only safe if the table is actually
 * complete — otherwise a strong verb nobody typed in gets silently turned into
 * a weak one, and the panel teaches "geschwört" instead of "geschworen".
 * Generating the table from Wiktionary makes the closed class of irregular
 * verbs genuinely closed.
 *
 * Wiktionary text is CC BY-SA 4.0; the generated file records that.
 * Development-time only — users never touch the network for grammar.
 *
 *   node tools/fetch-verbs.js            write src/lib/german-verbs.js
 *   node tools/fetch-verbs.js --limit 50 a quick partial run
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { api, wikitextBatch, parseTemplate, BATCH } = require('./wiktionary');

// Load the engine so the generator can reuse its prefix lists and check its
// own output by conjugating every entry it is about to write.
const ROOT = path.join(__dirname, '..');
const sandbox = { console, Intl, Date, Math, JSON, Map, Set, RegExp };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['src/lib/languages.js', 'src/lib/grammar.js', 'src/lib/german.js'].forEach((rel) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
});
const ENGINE = sandbox.GL.german;

// A .js file, not .json: content scripts are plain scripts and cannot import JSON.
const OUT = path.join(__dirname, '..', 'src', 'lib', 'german-verbs.js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

async function flexionNamespace() {
  const json = await api({ action: 'query', meta: 'siteinfo', siprop: 'namespaces' });
  const spaces = json.query.namespaces;
  const hit = Object.keys(spaces).find((id) => spaces[id].name === 'Flexion');
  if (!hit) throw new Error('could not find the Flexion namespace');
  return { id: hit, name: spaces[hit].name };
}

/** Every Flexion page whose source contains the irregular-verb template. */
async function findIrregularPages(ns, limit) {
  const titles = [];
  let offset = 0;
  for (;;) {
    const json = await api({
      action: 'query',
      list: 'search',
      srsearch: 'insource:"Deutsch Verb unregelmäßig"',
      srnamespace: ns,
      srlimit: '500',
      sroffset: String(offset)
    });
    const hits = (json.query && json.query.search) || [];
    hits.forEach((h) => titles.push(h.title));
    process.stdout.write('\r  found ' + titles.length + ' pages');
    if (limit && titles.length >= limit) break;
    const next = json.continue && json.continue.sroffset;
    if (next === undefined) break;
    offset = next;
  }
  process.stdout.write('\n');
  return limit ? titles.slice(0, limit) : titles;
}

(async () => {
  console.log('Building the irregular-verb table from de.wiktionary.org\n');

  const ns = await flexionNamespace();
  console.log('Flexion namespace id: ' + ns.id);

  const limit = Number(arg('--limit', 0)) || 0;
  const pages = await findIrregularPages(ns.id, limit);
  console.log('Fetching ' + pages.length + ' conjugation pages…\n');

  const verbs = {};
  let skipped = 0;

  // Only single-word lower-case infinitives; the namespace also holds
  // reflexive entries and other shapes the engine does not model.
  const wanted = pages.filter((title) => {
    if (/^[a-zäöüß]+$/.test(title.replace(/^Flexion:/, '').trim())) return true;
    skipped += 1;
    return false;
  });
  console.log('  ' + wanted.length + ' usable titles, fetched ' + BATCH + ' per request\n');

  for (let i = 0; i < wanted.length; i += BATCH) {
    const slice = wanted.slice(i, i + BATCH);

    let batch;
    try {
      batch = await wikitextBatch(slice);
    } catch (e) {
      console.log('\n  stopped early (' + e.message + ') — writing what was collected');
      break;
    }

    for (const title of slice) {
    const infinitive = title.replace(/^Flexion:/, '').trim();
    const parsed = parseTemplate(batch.get(title) || null);

    if (!parsed || parsed.regular || !parsed.partizip2 || !parsed.praet) {
      skipped += 1;
    } else {
      // Wiktionary gives the 1st-person-singular Präteritum. For a strong verb
      // that is the bare stem ("ging"); for a mixed verb it is the full weak
      // form ("brachte"), which the engine builds from a stem plus -e. Only the
      // weak marker -te can end a Präteritum, so it identifies the mixed ones.
      const weak = /te$/.test(parsed.praet);
      const entry = {
        p2: parsed.partizip2,
        pt: weak ? parsed.praet.slice(0, -1) : parsed.praet,
        k2: parsed.konj2 || parsed.praet
      };
      if (weak) entry.weak = 1;
      if (parsed.shifted) entry.s2 = parsed.shifted;
      if (parsed.aux === 'sein') entry.aux = 'sein';
      // A separable verb's stems are stored without the prefix, so the engine
      // can detach it: "auf" + "steh" -> "ich stehe auf".
      // Wiktionary is a wiki, so the prefix parameter occasionally carries
      // something that is not a prefix at all — a run in Sept 2026 found pages
      // passing "-Test". Anything the infinitive does not actually start with,
      // or that is not a German separable prefix, is upstream noise: drop it and
      // fall through to inference rather than writing a malformed entry.
      let prefix = parsed.prefix;
      if (prefix && !(infinitive.startsWith(prefix) && ENGINE.SEPARABLE.includes(prefix))) {
        prefix = '';
      }

      // Some pages give base stems but omit the prefix parameter — abschwimmen
      // arrives as {p2: "geschwommen", pt: "schwamm"} with no "ab". Taken at
      // face value that yields "geschwommen" for a verb whose participle is
      // "abgeschwommen", so infer the prefix when the participle plainly lacks it.
      if (!prefix) {
        const guess = ENGINE.SEPARABLE.find(
          (pre) => infinitive.startsWith(pre) && infinitive.length > pre.length + 2
        );
        if (guess && !entry.p2.startsWith(guess) && infinitive.slice(guess.length).length > 2) {
          prefix = guess;
        }
      }
      if (prefix) entry.sep = prefix;
      verbs[infinitive] = entry;
    }
    }

    process.stdout.write(
      '\r  ' + Math.min(i + BATCH, wanted.length) + '/' + wanted.length +
      ' — kept ' + Object.keys(verbs).length + ', skipped ' + skipped + '   '
    );
  }

  console.log('\n');

  // Check the table by using it: load it into the engine and conjugate every
  // entry, dropping anything that comes out malformed. Shipping a wrong form is
  // worse than shipping one fewer verb.
  console.log('Checking every entry by conjugating it…');
  sandbox.GL_VERBS = verbs;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/lib/german.js'), 'utf8'), sandbox, {
    filename: 'german.js (recheck)'
  });
  const reloaded = sandbox.GL.german;

  const rejected = [];
  Object.keys(verbs).forEach((inf) => {
    const c = reloaded.conjugate(inf);
    const why = [];
    if (!c) why.push('does not conjugate');
    else {
      const flat = c.tenses.reduce((all, t) => all.concat(t.forms), []).concat(c.partizip2);
      if (flat.some((f) => !f || /undefined|null/.test(f))) why.push('produced an empty form');
      // The participle of a separable verb must carry its prefix.
      if (verbs[inf].sep && !c.partizip2.startsWith(verbs[inf].sep)) {
        why.push('Partizip II "' + c.partizip2 + '" is missing the prefix "' + verbs[inf].sep + '"');
      }
      // …and any other participle should still relate to the infinitive.
      if (!verbs[inf].sep && !/^(ge|.{0,3})/.test(c.partizip2)) why.push('odd Partizip II');
    }
    if (why.length) {
      rejected.push(inf + ': ' + why.join('; '));
      delete verbs[inf];
    }
  });

  if (rejected.length) {
    console.log('  dropped ' + rejected.length + ' entries that did not check out:');
    rejected.slice(0, 15).forEach((r) => console.log('    - ' + r));
    if (rejected.length > 15) console.log('    … and ' + (rejected.length - 15) + ' more');
  } else {
    console.log('  all ' + Object.keys(verbs).length + ' entries conjugate cleanly');
  }

  const sorted = {};
  Object.keys(verbs).sort().forEach((k) => (sorted[k] = verbs[k]));

  const header = [
    '/**',
    ' * German irregular verbs — GENERATED FILE, do not edit by hand.',
    ' *',
    ' * Source: German Wiktionary (de.wiktionary.org), Flexion: pages carrying the',
    ' * "Deutsch Verb unregelmäßig" template. Text there is licensed CC BY-SA 4.0.',
    ' * Regenerate with: node tools/fetch-verbs.js',
    ' *',
    ' * Generated ' + new Date().toISOString().slice(0, 10) + ' — ' + Object.keys(sorted).length + ' verbs.',
    ' *',
    ' * Fields:',
    ' *   p2   Partizip II',
    ' *   pt   Präteritum stem (1st sg; the -e is added back for weak entries)',
    ' *   k2   Konjunktiv II stem',
    ' *   s2   Präsens stem for du / er-sie-es, when the vowel shifts',
    ' *   aux  perfect auxiliary; absent means haben',
    ' *   sep  separable prefix; stems are stored without it',
    ' *   weak 1 when the Präteritum takes weak endings on a changed stem',
    ' *',
    ' * complete:false marks a partial run. The engine only treats "absent from',
    ' * this list" as proof that a verb is regular when the list is complete.',
    ' */',
    'globalThis.GL_VERBS_META = ' +
      JSON.stringify({
        complete: !limit,
        generated: new Date().toISOString().slice(0, 10),
        count: Object.keys(sorted).length,
        license: 'CC BY-SA 4.0',
        source: 'de.wiktionary.org'
      }) +
      ';',
    'globalThis.GL_VERBS = '
  ].join('\n');

  fs.writeFileSync(OUT, header + JSON.stringify(sorted) + ';\n', 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('Wrote ' + Object.keys(verbs).length + ' verbs to ' + path.relative(path.join(__dirname, '..'), OUT) + ' (' + kb + ' KB)');
})();
