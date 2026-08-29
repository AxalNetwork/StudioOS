/**
 * `image-size` must not reach the shipped bundle.
 *
 * Dependabot reports a High advisory against `image-size@1.2.1`: crafted ICNS,
 * JXL and HEIF headers drive its parsers into unbounded work (denial of
 * service). It reaches this repo transitively, in both lockfiles:
 *
 *     workspace / frontend  ->  pptxgenjs@4.0.1  ->  image-size@1.2.1
 *
 * There is NO transitive bump that fixes it. `pptxgenjs@4.0.1` is the latest
 * release and pins `"image-size": "^1.2.1"`; the advisory is fixed in 2.x,
 * outside that caret range. `npm audit --json` offers exactly one "fix" —
 * `pptxgenjs@1.1.5`, `isSemVerMajor: true` — a three-major downgrade that
 * would take the deck export with it. So the lockfile entry stays.
 *
 * What makes that acceptable is that the vulnerable code is not shipped.
 * `pptxgenjs` declares `image-size` as Node-only and stubs it for browser
 * targets, in its own package.json:
 *
 *     "browser": { "fs": false, "https": false, "image-size": false, ... }
 *
 * Vite honours that field for the client build, and PPTX generation in this
 * app runs in the BROWSER — `decks/spinout/buildDeck.js` imports `pptxgen`,
 * the Worker deliberately does not (see `routes/pptx.ts` and
 * `PitchDeckPage.jsx:404`). So the parsers the advisory names are compiled
 * out, and no user-supplied image is ever handed to them.
 *
 * That conclusion is a fact about a build, not about a lockfile, and builds
 * change: a bundler upgrade that stops reading `browser`, a pptxgenjs release
 * that drops the stub, or someone importing `pptxgenjs` on a server path would
 * each quietly make the advisory real while `npm audit` output stayed exactly
 * the same. This test is what notices. It asserts against the committed
 * `docs/` bundle — the artifact the Worker actually serves.
 *
 * If it fails, the advisory has become live: either restore the exclusion, or
 * treat the DoS as reachable and handle it on its merits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ASSETS = resolve(process.cwd(), 'docs/assets');
const IMAGE_SIZE = resolve(process.cwd(), 'node_modules/image-size/dist');

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
  const files = jsFilesUnder(IMAGE_SIZE);
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
    'image-size (High: ICNS/JXL/HEIF DoS) is in the browser bundle. It is meant '
    + 'to be stubbed by pptxgenjs\'s `"browser": { "image-size": false }` field. '
    + 'Either that stub broke or something imports it directly — the advisory is '
    + 'now reachable and needs handling, not a lockfile note.',
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
