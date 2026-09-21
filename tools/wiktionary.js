/**
 * Shared helpers for talking to German Wiktionary.
 *
 * Wiktionary's `Flexion:` pages carry each irregular verb's stems in a
 * structured template, which is the same shape `src/lib/german.js` stores:
 *
 *   {{Deutsch Verb unregelmäßig|2=sprech|3=sprach|4=spräch|5=gesprochen|6=sprich}}
 *
 *   2  present stem            5  Partizip II
 *   3  Präteritum, 1st sg      6  shifted present stem (du / er)
 *   4  Konjunktiv II stem      9  alternative Konjunktiv II stem
 *   Hilfsverb=sein             perfect auxiliary; absent means haben
 *   (first positional)         separable prefix
 *
 * Content is CC BY-SA 4.0. This is used at development time to check and extend
 * the bundled table, so nothing is fetched on a user's machine.
 *
 * Wikimedia asks for a descriptive User-Agent and reasonable request rates;
 * both are handled here.
 */
const API = 'https://de.wiktionary.org/w/api.php';

const UA =
  'AksLingo-dev/3.1 (Chrome extension grammar data check; contact via repository) node-fetch';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;
const MIN_GAP = 350; // stay well inside Wikimedia's limits

async function api(params) {
  const gap = Date.now() - lastCall;
  if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
  lastCall = Date.now();

  const url = API + '?format=json&formatversion=2&' + new URLSearchParams(params).toString();
  for (let attempt = 0; attempt < 7; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    } catch (e) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      // Back off generously; being throttled is a request to slow down.
      await sleep(3000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      // The API answers with plain text when it is throttling.
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error(
    'wiktionary: gave up on ' + JSON.stringify(params.page || params.titles || params.srsearch || '')
  );
}

/** Every page title in a category, following continuations. */
async function categoryMembers(category, cap) {
  const out = [];
  let cont = null;
  do {
    const params = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: category,
      cmlimit: '500',
      cmnamespace: '0'
    };
    if (cont) params.cmcontinue = cont;
    const json = await api(params);
    const members = (json.query && json.query.categorymembers) || [];
    members.forEach((m) => out.push(m.title));
    cont = json.continue && json.continue.cmcontinue;
    if (cap && out.length >= cap) break;
  } while (cont);
  return out;
}

/** Wikitext of a page, or null when it does not exist. */
async function wikitext(page) {
  const json = await api({ action: 'parse', page, prop: 'wikitext' });
  if (json.error) return null;
  return (json.parse && json.parse.wikitext) || null;
}

/** How many page titles the API accepts in one content request. */
const BATCH = 50;

/**
 * Wikitext for many pages at once.
 *
 * The API takes up to 50 titles per request, which turns a few thousand
 * fetches into a few dozen. Doing this one page at a time gets you throttled,
 * and rightly so.
 *
 * @param {string[]} titles
 * @returns {Promise<Map<string, string>>} title -> wikitext, missing pages omitted
 */
async function wikitextBatch(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += BATCH) {
    const slice = titles.slice(i, i + BATCH);
    const json = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: slice.join('|')
    });
    const pages = (json.query && json.query.pages) || [];
    pages.forEach((p) => {
      if (p.missing) return;
      const rev = p.revisions && p.revisions[0];
      const content = rev && rev.slots && rev.slots.main && rev.slots.main.content;
      if (content) out.set(p.title, content);
    });
  }
  return out;
}

/**
 * Pulls the conjugation template out of a Flexion page.
 * @returns {object|null} { prefix, stem, praet, konj2, konj2alt, partizip2, shifted, aux, regular }
 */
function splitParams(body) {
  const parts = body.split('|').map((s) => s.trim()).filter(Boolean);
  const named = {};
  const positional = [];
  parts.forEach((p) => {
    const eq = p.indexOf('=');
    if (eq > -1) named[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
    else positional.push(p);
  });
  return { named, positional };
}

/**
 * The auxiliary is stated two ways: `Hilfsverb=sein`, or `haben=0` meaning the
 * verb does not take haben. An empty `haben=` is not the same as `haben=0`.
 */
function auxOf(named) {
  if (named.Hilfsverb === 'sein') return 'sein';
  if (named.haben === '0') return 'sein';
  return 'haben';
}

function parseTemplate(text) {
  if (!text) return null;

  // A page can carry several templates: German has verbs that are strong in one
  // sense and weak in another — wachsen (grew / waxed), hängen (hung / hung
  // something), schaffen (created / managed). The irregular reading is the one
  // the engine needs, so it wins; a page with only a regular template really is
  // a regular verb.
  const irregulars = text.match(/\{\{Deutsch Verb unregelmäßig([^}]*)\}\}/g) || [];

  if (irregulars.length) {
    const body = /unregelmäßig([^}]*)\}\}/.exec(irregulars[0])[1];
    const { named, positional } = splitParams(body);
    return {
      regular: false,
      alsoRegular: /\{\{Deutsch Verb regelmäßig/.test(text),
      variants: irregulars.length,
      prefix: positional.length ? positional[0] : null,
      stem: named['2'] || null,
      praet: named['3'] || null,
      konj2: named['4'] || null,
      konj2alt: named['9'] || null,
      partizip2: named['5'] || null,
      shifted: named['6'] || null,
      aux: auxOf(named),
      // sein and its like spell every form out in named parameters instead.
      spelledOut: Object.keys(named).some((k) => /^(Indikativ|Imperativ|Konjunktiv)/.test(k)),
      explicit: named
    };
  }

  const regular = /\{\{Deutsch Verb regelmäßig([^}]*)\}\}/.exec(text);
  if (!regular) return null;
  const { named, positional } = splitParams(regular[1]);
  return {
    regular: true,
    // The last positional parameter is the Partizip II.
    partizip2: positional.length ? positional[positional.length - 1] : null,
    aux: auxOf(named)
  };
}

module.exports = { api, categoryMembers, wikitext, wikitextBatch, parseTemplate, UA, BATCH };
