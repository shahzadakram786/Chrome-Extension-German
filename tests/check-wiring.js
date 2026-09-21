/**
 * Static wiring check: every file the manifest, the service worker and the
 * HTML pages point at must actually exist, and every script a page depends on
 * must be loaded before the script that uses it.
 *
 * Chrome fails these silently-ish (a broken content script just stops working),
 * so it is worth checking before loading the extension by hand.
 *
 *   node tests/check-wiring.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const problems = [];
const checked = [];

function must(rel, why) {
  const full = path.join(ROOT, rel);
  const exists = fs.existsSync(full);
  checked.push({ rel, why, exists });
  if (!exists) problems.push('missing: ' + rel + '  (referenced by ' + why + ')');
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

/* --------------------------------------------------------------- manifest -- */

/**
 * An icon entry is either one path or a {size: path} map. Both are legal, so
 * the check takes either rather than assuming the shape.
 */
function mustIcons(entry, why) {
  if (!entry) return [];
  const paths = typeof entry === 'string' ? [entry] : Object.keys(entry).map((k) => entry[k]);
  paths.forEach((p) => must(p, why));
  return paths;
}

must(manifest.background.service_worker, 'background.service_worker');
must(manifest.action.default_popup, 'action.default_popup');
must(manifest.options_page, 'options_page');

const iconPaths = new Set([
  ...mustIcons(manifest.action.default_icon, 'action.default_icon'),
  ...mustIcons(manifest.icons, 'icons')
]);

/**
 * The extension once shipped a JPEG named .png. Chrome tolerated it locally,
 * but the Web Store validates icons on upload, so the failure would not have
 * surfaced until submission. Checking the magic bytes and the declared size
 * costs nothing and catches both that and a mislabelled 48 that is really 128.
 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function checkPng(rel, expectedSize) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  const fd = fs.openSync(full, 'r');
  const head = Buffer.alloc(24);
  fs.readSync(fd, head, 0, 24, 0);
  fs.closeSync(fd);

  if (!head.subarray(0, 8).equals(PNG_MAGIC)) {
    problems.push('not a real PNG: ' + rel + '  (magic bytes are ' + head.subarray(0, 4).toString('hex') + ')');
    return;
  }
  // IHDR is always the first chunk: width and height at bytes 16..24.
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  if (w !== h) problems.push('icon is not square: ' + rel + ' is ' + w + '×' + h);
  if (expectedSize && w !== Number(expectedSize)) {
    problems.push('icon size mismatch: ' + rel + ' is declared ' + expectedSize + ' but is ' + w + '×' + h);
  }
}

Object.keys(manifest.icons || {}).forEach((size) => checkPng(manifest.icons[size], size));
if (manifest.action.default_icon && typeof manifest.action.default_icon === 'object') {
  Object.keys(manifest.action.default_icon).forEach((size) =>
    checkPng(manifest.action.default_icon[size], size)
  );
}
iconPaths.forEach((p) => checkPng(p, null));

const contentJs = [];
manifest.content_scripts.forEach((cs, i) => {
  (cs.js || []).forEach((f) => {
    must(f, 'content_scripts[' + i + '].js');
    contentJs.push(f);
  });
  (cs.css || []).forEach((f) => must(f, 'content_scripts[' + i + '].css'));
});

/* -------------------------------------------------------- importScripts -- */

const swSource = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
const impBlock = swSource.match(/importScripts\(([\s\S]*?)\)/);
const workerScripts = impBlock ? (impBlock[1].match(/'[^']+'/g) || []).map((q) => q.slice(1, -1)) : [];
workerScripts.forEach((s) => must(s.replace(/^\//, ''), 'importScripts'));

/* ------------------------------------------------------------ html pages -- */

const pages = [manifest.action.default_popup, manifest.options_page];
const pageScripts = {};

pages.forEach((page) => {
  const dir = path.dirname(page);
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const refs = html.match(/(?:src|href)="([^"]+)"/g) || [];
  const scripts = [];
  refs.forEach((raw) => {
    const rel = raw.match(/"([^"]+)"/)[1];
    if (/^(https?:|data:|#|mailto:)/.test(rel)) return;
    const resolved = path.posix.join(dir.split(path.sep).join('/'), rel);
    must(resolved, page);
    if (rel.endsWith('.js')) scripts.push(resolved);
  });
  pageScripts[page] = scripts;

  // Every id the page's script reaches for with $('id') must exist in the HTML.
  const ids = new Set((html.match(/id="([^"]+)"/g) || []).map((m) => m.match(/"([^"]+)"/)[1]));
  scripts
    .filter((s) => !s.includes('/lib/'))
    .forEach((s) => {
      const js = fs.readFileSync(path.join(ROOT, s), 'utf8');
      const used = new Set(
        (js.match(/\$\('([A-Za-z0-9_-]+)'\)/g) || []).map((m) => m.match(/'([^']+)'/)[1])
      );
      used.forEach((id) => {
        // Range labels are addressed as `id + 'Val'`, which is built at runtime.
        if (!ids.has(id) && !ids.has(id + 'Val')) {
          problems.push('element #' + id + ' used by ' + s + ' is not in ' + page);
        }
      });
      // The reverse direction for the settings ranges.
      (js.match(/\$\(id \+ 'Val'\)/g) || []).forEach(() => {
        ['sHoverDelay', 'sFontSize', 'sSpeechRate', 'sSessionLimit'].forEach((base) => {
          if (!ids.has(base + 'Val')) problems.push('element #' + base + 'Val is not in ' + page);
        });
      });
    });
});

/* ------------------------------------------------------- load-order check -- */

/**
 * Each lib attaches itself to a namespace, so a file that reads GL.<thing> must
 * be listed after the lib that defines it.
 */
const PROVIDERS = {
  'src/lib/languages.js': ['langs', 'lang', 'langName', 'langFlag', 'isRtl', 'bcp47', 'sortedCodes'],
  'src/lib/srs.js': ['srs'],
  'src/lib/store.js': ['store'],
  'src/lib/grammar.js': ['grammar'],
  'src/lib/gtx.js': ['gtx'],
  'src/lib/mymemory.js': ['mymemory'],
  'src/lib/byokey.js': ['byokey']
};

function checkOrder(label, files) {
  const defined = new Set();
  files.forEach((file) => {
    const rel = file.replace(/^\//, '');
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    const src = fs.readFileSync(full, 'utf8');

    // What this file uses off the namespace.
    const used = new Set((src.match(/\bGL\.([A-Za-z0-9_]+)/g) || []).map((m) => m.slice(3)));
    used.forEach((name) => {
      const owner = Object.keys(PROVIDERS).find((p) => PROVIDERS[p].indexOf(name) !== -1);
      if (!owner) return;
      if (owner === rel) return;
      if (!defined.has(name)) {
        problems.push(label + ': ' + rel + ' uses GL.' + name + ' before ' + owner + ' is loaded');
      }
    });

    (PROVIDERS[rel] || []).forEach((name) => defined.add(name));
  });
}

checkOrder('content_scripts', contentJs);
checkOrder('service worker', workerScripts);
Object.keys(pageScripts).forEach((page) => checkOrder(page, pageScripts[page]));

/* ------------------------------------------------- content script globals -- */

// The tooltip class and the stylesheets are plain globals, not on the namespace.
const GLOBALS = { 'src/content/ui.js': ['GL_Tooltip'], 'src/content/styles.js': ['GL_TOOLTIP_CSS', 'GL_IMMERSION_CSS'] };
const definedGlobals = new Set();
contentJs.forEach((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  ['GL_Tooltip', 'GL_TOOLTIP_CSS', 'GL_IMMERSION_CSS'].forEach((name) => {
    const owner = Object.keys(GLOBALS).find((p) => GLOBALS[p].indexOf(name) !== -1);
    if (owner === rel) return;
    if (src.indexOf(name) !== -1 && !definedGlobals.has(name)) {
      problems.push('content_scripts: ' + rel + ' uses ' + name + ' before ' + owner + ' is loaded');
    }
  });
  (GLOBALS[rel] || []).forEach((n) => definedGlobals.add(n));
});

/* ------------------------------------------------------------------ report -- */

checked.forEach((c) => console.log((c.exists ? '  ok    ' : '  MISS  ') + c.rel));
console.log('\n' + checked.length + ' referenced paths checked');

if (problems.length) {
  console.log('\n' + problems.length + ' problem(s):');
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log('No wiring problems found.');
