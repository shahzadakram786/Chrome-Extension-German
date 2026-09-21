/**
 * Packages the extension for the Chrome Web Store.
 *
 * The repository holds things that must not ship: the previous version in
 * legacy/ (which still builds its tooltip with innerHTML), the test suite, the
 * Wiktionary tooling, and the 1024px source artwork. Zipping the folder by hand
 * sweeps all of it into the upload, so the packaged file list is derived from
 * the manifest instead of from what happens to be on disk.
 *
 * The zip is written directly rather than shelled out to, because the archiver
 * available by default on Windows writes entry names with backslashes, which
 * the Web Store rejects.
 *
 *   node tools/build.js           check, then write dist/<name>-<version>.zip
 *   node tools/build.js --dry     list what would ship, write nothing
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DRY = process.argv.includes('--dry');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

/* ------------------------------------------------------------- file list -- */

/** Everything the manifest points at, which is by definition everything Chrome loads. */
function manifestFiles() {
  const out = new Set(['manifest.json']);
  const add = (p) => p && out.add(p);

  add(manifest.background && manifest.background.service_worker);
  add(manifest.options_page);
  add(manifest.action && manifest.action.default_popup);

  const icons = (entry) => {
    if (!entry) return;
    if (typeof entry === 'string') return add(entry);
    Object.keys(entry).forEach((k) => add(entry[k]));
  };
  icons(manifest.icons);
  icons(manifest.action && manifest.action.default_icon);

  (manifest.content_scripts || []).forEach((cs) => {
    (cs.js || []).forEach(add);
    (cs.css || []).forEach(add);
  });

  (manifest.web_accessible_resources || []).forEach((r) => (r.resources || []).forEach(add));
  return out;
}

/**
 * HTML pages pull in their own scripts and stylesheets, which the manifest says
 * nothing about. Missing one of these produces an extension that installs
 * cleanly and then breaks the moment the page is opened.
 */
function htmlDependencies(htmlRel, seen) {
  const full = path.join(ROOT, htmlRel);
  if (!fs.existsSync(full)) return;
  const html = fs.readFileSync(full, 'utf8');
  const dir = path.dirname(htmlRel);
  const refs = [];

  const patterns = [/<script[^>]+src=["']([^"']+)["']/gi, /<link[^>]+href=["']([^"']+)["']/gi];
  patterns.forEach((re) => {
    let m;
    while ((m = re.exec(html))) refs.push(m[1]);
  });

  refs.forEach((ref) => {
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) return;
    const rel = path.posix.normalize(path.posix.join(dir.split(path.sep).join('/'), ref));
    if (seen.has(rel)) return;
    seen.add(rel);
    if (rel.endsWith('.html')) htmlDependencies(rel, seen);
  });
}

/**
 * The service worker loads its libraries with importScripts, which the manifest
 * knows nothing about either. Leaving one out produces a worker that throws on
 * boot, which Chrome reports only on the extensions page — so every lookup fails
 * with nothing to explain why.
 */
function workerDependencies(workerRel, seen) {
  const full = path.join(ROOT, workerRel);
  if (!fs.existsSync(full)) return;
  const src = fs.readFileSync(full, 'utf8');
  const call = /importScripts\s*\(([\s\S]*?)\)/g;
  let m;
  while ((m = call.exec(src))) {
    const literal = /['"]([^'"]+)['"]/g;
    let f;
    while ((f = literal.exec(m[1]))) {
      seen.add(f[1].replace(/^\//, ''));
    }
  }
}

function collect() {
  const files = manifestFiles();
  Array.from(files)
    .filter((f) => f.endsWith('.html'))
    .forEach((f) => htmlDependencies(f, files));
  if (manifest.background && manifest.background.service_worker) {
    workerDependencies(manifest.background.service_worker, files);
  }
  return Array.from(files).sort();
}

/* ---------------------------------------------------------------- checks -- */

const NEVER_SHIP = [/^legacy\//, /^tests\//, /^tools\//, /^dist\//, /^\.git/, /^node_modules\//];

function preflight(files) {
  const problems = [];

  files.forEach((rel) => {
    if (!fs.existsSync(path.join(ROOT, rel))) problems.push('missing file: ' + rel);
    const posix = rel.split(path.sep).join('/');
    NEVER_SHIP.forEach((re) => {
      if (re.test(posix)) problems.push('must not ship: ' + rel);
    });
  });

  if (!/^\d+\.\d+(\.\d+){0,2}$/.test(manifest.version)) {
    problems.push('version "' + manifest.version + '" is not a dotted integer the Web Store accepts');
  }
  // The store truncates past these, so anything longer is silently cut.
  if ((manifest.name || '').length > 75) problems.push('name is over 75 characters');
  if ((manifest.description || '').length > 132) {
    problems.push('description is over 132 characters (' + manifest.description.length + ')');
  }
  if (!manifest.icons || !manifest.icons['128']) problems.push('no 128px icon declared');

  // Remote code is a flat policy violation, and the usual way it sneaks in is a
  // CDN <script> in a page that nobody looked at twice.
  files
    .filter((f) => f.endsWith('.html'))
    .forEach((f) => {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      if (/<script[^>]+src=["'](https?:)?\/\//i.test(html)) {
        problems.push('remote script tag in ' + f + ' — the Web Store forbids remotely hosted code');
      }
    });

  return problems;
}

/** The repo's own checks, so a broken build cannot be packaged. */
function runChecks() {
  ['check-wiring.js', 'check-worker.js', 'run.js', 'german.js'].forEach((t) => {
    const rel = path.join('tests', t);
    process.stdout.write('  ' + rel + ' … ');
    try {
      execFileSync(process.execPath, [path.join(ROOT, rel)], { stdio: 'pipe' });
      console.log('ok');
    } catch (e) {
      console.log('FAILED');
      console.log(String(e.stdout || '').split('\n').slice(-12).join('\n'));
      throw new Error(rel + ' failed — not packaging');
    }
  });
}

/* ------------------------------------------------------------------- zip -- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * A fixed timestamp keeps the build reproducible: the same source produces a
 * byte-identical zip, so you can tell a real change from a repackage.
 */
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  entries.forEach(({ name, data }) => {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    // Storing is smaller than deflating for tiny or already-compressed files.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    // >>> 0 because the shift overflows into a negative signed 32-bit int.
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  });

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* ------------------------------------------------------------------ main -- */

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

function main() {
  const files = collect();

  console.log('Checking the package…');
  const problems = preflight(files);
  if (problems.length) {
    problems.forEach((p) => console.log('  ✗ ' + p));
    process.exit(1);
  }
  console.log('  ok   ' + files.length + ' files, all present, nothing excluded leaking in');

  console.log('\nRunning the test suite…');
  runChecks();

  const entries = files.map((rel) => ({
    // Zip entry names are always forward-slashed, whatever the host OS uses.
    name: rel.split(path.sep).join('/'),
    data: fs.readFileSync(path.join(ROOT, rel))
  }));

  const total = entries.reduce((n, e) => n + e.data.length, 0);
  console.log('\nShipping:');
  entries.forEach((e) => console.log('  ' + e.name.padEnd(36) + kb(e.data.length).padStart(10)));
  console.log('  ' + '—'.repeat(46));
  console.log('  ' + 'uncompressed'.padEnd(36) + kb(total).padStart(10));

  const skipped = ['legacy/', 'tests/', 'tools/', 'README.md', 'PRIVACY.md', 'logo.png'];
  console.log('\nLeft out: ' + skipped.join('  '));

  if (DRY) {
    console.log('\n--dry: nothing written.');
    return;
  }

  const out = path.join(DIST, 'akslingo-' + manifest.version + '.zip');
  fs.mkdirSync(DIST, { recursive: true });
  const buf = zip(entries);
  fs.writeFileSync(out, buf);

  console.log('\nWrote ' + path.relative(ROOT, out) + '  (' + kb(buf.length) + ')');
  console.log('Upload it at https://chrome.google.com/webstore/devconsole');
}

main();
