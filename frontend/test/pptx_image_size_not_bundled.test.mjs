/**
 * `image-size` must not be the vulnerable 1.2.1 tarball, and must not
 * reach the shipped bundle.
 *
 * Dependabot #161 (CVE-2025-71330 / CVE-2025-71329) reports a High
 * advisory against official `image-size` through 2.0.2: crafted ICNS,
 * JXL and HEIF headers drive its parsers into an infinite loop. It
 * reaches this repo transitively, in both lockfiles:
 *
 *     workspace / frontend  ->  pptxgenjs@4.0.1  ->  image-size@^1.2.1
 *
 * There is NO official patch. `pptxgenjs@4.0.1` is the latest release
 * and pins `"image-size": "^1.2.1"`; upstream `image-size` is archived
 * and never published 2.0.3. `npm audit --json` offers exactly one
 * "fix" — `pptxgenjs@1.1.5`, `isSemVerMajor: true` — a three-major
 * downgrade that would take the deck export with it.
 *
 * The lockfile fix is an npm override onto the community 1.x fork:
 *
 *     "overrides": { "image-size": "npm:image-size-next@1.2.2" }
 *
 * 1.2.2 keeps the CJS default-export API pptxgenjs expects and rejects
 * zero-length ICNS entries / zero-size JXL-HEIF boxes. 2.x of the same
 * fork is a different API; do not jump to it without checking pptxgenjs.
 *
 * Separately, the parsers still must not ship. `pptxgenjs` declares
 * `image-size` as Node-only and stubs it for browser targets:
 *
 *     "browser": { "fs": false, "https": false, "image-size": false, ... }
 *
 * Vite honours that field for the client build, and PPTX generation in
 * this app runs in the BROWSER — `decks/spinout/buildDeck.js` imports
 * `pptxgen`, the Worker deliberately does not (see `routes/pptx.ts` and
 * `PitchDeckPage.jsx:404`). So no user-supplied image is handed to these
 * parsers in production either. The bundle scan below is what notices if
 * that exclusion breaks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSETS = resolve(process.cwd(), 'docs/assets');
const OVERRIDE = 'npm:image-size-next@1.2.2';
// Integrity of official image-size@1.2.1 (the Dependabot #161 tarball) and of
// the image-size-next@1.2.2 replacement. Hashes, not hostnames — CodeQL's
// js/regex/missing-regexp-anchor and incomplete-url-sanitization rules treat
// a registry hostname in a test as if it were a URL allow-list.
const VULN_INTEGRITY = 'sha512-rH+46sQJ2dlwfjfhCyNx5thzrv+dtmBIhPHk0zgRUukHzZ/kRueTJXoYYsclBaKcSMBWuGbOFXtioLpzTb5euw==';
const FORK_INTEGRITY = 'sha512-Pd3CJ2+Ifk2H2jWikkoz2BSZgnuF3Qsea4gQmj2gtiOtYpGWBl7elj8EXnFMiY5PaYNruTTLD0hQ0UWK7pz9xA==';

const IMAGE_SIZE_CANDIDATES = [
  resolve(process.cwd(), 'node_modules/image-size'),
  resolve(process.cwd(), 'node_modules/pptxgenjs/node_modules/image-size'),
  resolve(process.cwd(), 'frontend/node_modules/image-size'),
  resolve(process.cwd(), 'frontend/node_modules/pptxgenjs/node_modules/image-size'),
];

function installedImageSize() {
  return IMAGE_SIZE_CANDIDATES.find((p) => existsSync(p)) || null;
}

/**
 * Markers distinctive to image-size, chosen so a hit means that library and
 * not a coincidence.
 *
 * They are all STRING LITERALS, and that is the whole design. `docs/` is a
 * minified Rollup bundle, so an identifier-based marker is mangled to a single
 * letter and can never fire — a list of them scans clean over a bundle that
 * does contain the library. The first draft of this file had four such
 * markers, two of which (`detectorTypes`, `ftypheic`) do not exist in
 * image-size at all. String literals survive minification intact.
 *
 * `readUInt32BE` is deliberately absent: it is generic buffer reading,
 * `react-pdf` contains three of them, and an assertion that fires on an
 * unrelated package teaches people to delete the assertion.
 *
 * The `markers are real` test below holds this list to its claim.
 */
const IMAGE_SIZE_MARKERS = [
  'icns',                        // ICNS magic, compared in types/icns.js
  'jxlc',                        // JXL box name, found in types/jxl.js
  'Invalid HEIF, no size found', // the HEIF parser named by the advisory
  'Invalid Tiff. Missing tags',
  'Invalid JPG, no size found',
];

function jsFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8'));
}

test('both manifests override image-size onto image-size-next 1.2.2', () => {
  for (const rel of ['package.json', 'frontend/package.json']) {
    const pkg = readJson(rel);
    assert.equal(
      pkg.overrides?.['image-size'], OVERRIDE,
      `${rel} must pin ${OVERRIDE} or Dependabot #161 returns`,
    );
  }
});

test('neither lockfile installs the vulnerable image-size tarball', () => {
  for (const rel of ['package-lock.json', 'frontend/package-lock.json']) {
    const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
    assert.ok(
      !text.includes(VULN_INTEGRITY),
      `${rel} still pins official image-size@1.2.1 — the ICNS DoS is back`,
    );
    assert.ok(
      text.includes(FORK_INTEGRITY),
      `${rel} must pin image-size-next@1.2.2`,
    );
    const lock = JSON.parse(text);
    const entries = Object.entries(lock.packages || {}).filter(
      ([key]) => key === 'node_modules/image-size' || key.endsWith('/node_modules/image-size'),
    );
    assert.ok(entries.length > 0, `${rel} has no image-size entry`);
    for (const [key, pkg] of entries) {
      assert.equal(pkg.name, 'image-size-next', key);
      assert.equal(pkg.version, '1.2.2', key);
    }
  }
});

test('a zero-length ICNS entry returns instead of hanging', { timeout: 2000 }, () => {
  // CVE-2025-71330: official image-size <= 2.0.2 never advances the offset
  // when the ICNS entry length field is 0, so the while loop never exits.
  const root = installedImageSize();
  if (!root) return;
  const req = createRequire(pathToFileURL(join(root, 'package.json')).href);
  const sizeOf = req('.');
  const buf = Buffer.alloc(16);
  buf.write('icns', 0, 4, 'ascii');
  buf.writeUInt32BE(16, 4);
  buf.write('ic08', 8, 4, 'ascii');
  buf.writeUInt32BE(0, 12);
  assert.throws(
    () => sizeOf(buf),
    (err) => err instanceof TypeError && /ICNS/i.test(String(err.message)),
  );
});

test('the committed bundle exists to be checked', () => {
  assert.ok(
    jsFilesUnder(ASSETS).length > 0,
    `no JS chunks under ${ASSETS} — run \`npm run build\``,
  );
});

test('pptxgenjs ships, so a hit on it would have been found', () => {
  // Guards the assertion below against passing vacuously: if the scan cannot
  // find pptxgenjs either, it is not reading the right files.
  const found = jsFilesUnder(ASSETS).some((f) => readFileSync(f, 'utf8').includes('PptxGenJS'));
  assert.ok(found, 'pptxgenjs is expected in the deck chunks; the scan looks wrong');
});

test('every marker is real — each one appears in image-size itself', () => {
  // Without this, a typo or a renamed internal turns the scan below into a
  // guaranteed pass over a bundle nobody has actually checked.
  const root = installedImageSize();
  const files = root ? jsFilesUnder(join(root, 'dist')) : [];
  if (files.length === 0) return; // dependency-free checkout; the rest still runs
  const sources = files.map((f) => readFileSync(f, 'utf8'));
  const dead = IMAGE_SIZE_MARKERS.filter((m) => !sources.some((s) => s.includes(m)));
  assert.deepEqual(
    dead, [],
    'these markers do not occur in the installed image-size, so they can never '
    + 'fire. Replace them with string literals taken from its current source — '
    + 'not identifiers, which minification renames away.',
  );
});

test('no image-size parser reaches the shipped bundle', () => {
  const hits = [];
  for (const file of jsFilesUnder(ASSETS)) {
    const src = readFileSync(file, 'utf8');
    for (const marker of IMAGE_SIZE_MARKERS) {
      if (src.includes(marker)) hits.push(`${file}: ${marker}`);
    }
  }
  assert.deepEqual(
    hits, [],
    'image-size parsers are in the browser bundle. They are meant '
    + 'to be stubbed by pptxgenjs\'s `"browser": { "image-size": false }` field. '
    + 'Either that stub broke or something imports it directly.',
  );
});

test('pptxgenjs still declares the browser stub this rests on', () => {
  // The exclusion is upstream's choice, not ours; a release could drop it.
  const pkg = resolve(process.cwd(), 'node_modules/pptxgenjs/package.json');
  if (!existsSync(pkg)) return;
  const { browser, dependencies } = JSON.parse(readFileSync(pkg, 'utf8'));
  assert.equal(
    browser?.['image-size'], false,
    'pptxgenjs no longer stubs image-size for browsers — the bundle assertion '
    + 'above is now the only thing keeping it out, and it will start failing.',
  );
  assert.ok(
    dependencies?.['image-size'],
    'if pptxgenjs has dropped image-size entirely, delete this file: the '
    + 'advisory no longer applies and the test is just noise.',
  );
});
