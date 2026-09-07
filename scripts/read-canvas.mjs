#!/usr/bin/env node
/**
 * Turn a published Claude Design artifact back into the `.dc.html` canvas this
 * repo already stores.
 *
 * WHY THIS EXISTS. A design arrives as an artifact URL, and reading one looked
 * like it needed a browser: the page served is a bundler shell whose real
 * content sits gzipped and base64'd inside `<script type="__bundler/manifest">`,
 * with the design itself in `<script type="__bundler/template">`. Three canvases
 * were nearly triaged by opening them in Chromium and describing what they
 * looked like.
 *
 * They did not need a browser. Decoded, the template is EXACTLY the format
 * `design/canvases/` is already full of — `<x-dc>`, `<helmet>`, and a
 * `text/x-dc` script whose class extends `DCLogic`. 124 files under `design/`
 * are that shape. So an artifact is not a foreign object to be screenshotted;
 * it is a canvas that happens to be wrapped, and unwrapping it puts the design
 * where `design/incoming/README.md`'s intake pipeline can already handle it:
 * reviewable in a diff, greppable, and diffable against the next revision.
 *
 * WHAT IT REWRITES, and why each is not just cosmetic:
 *
 *   · The runtime. The bundle ships `dc-runtime` as an asset and points the
 *     head's `<script src>` at its uuid. Repo canvases instead reference
 *     `./support.js` — one shared copy in `design/canvases/shared/` rather than
 *     69KB inlined into every file. Rewritten to match, so a canvas costs the
 *     diff its own design and nothing else.
 *
 *   · The fonts. The bundle inlines ~35 `@font-face` rules, one per unicode
 *     subset, each pointing at a woff2 asset uuid — around 250KB of base64 that
 *     would land in the repository as noise. Repo canvases link Inter from
 *     Google Fonts instead. The whole font `<style>` block is replaced by that
 *     link, which is why the block is found BY CONTENT (it is the one containing
 *     `@font-face`) rather than by position: a canvas with no fonts, or with the
 *     design CSS first, must not lose its stylesheet to an index.
 *
 * WHAT IT REFUSES TO DO. It never substitutes a remaining asset uuid with a
 * `data:` URI. An image or a font this script does not recognise stays an
 * unresolved uuid and is REPORTED, because a canvas that silently drops an asset
 * is worse than one that says which asset it could not place.
 *
 *     node scripts/read-canvas.mjs <artifact.html> <out.dc.html>
 *
 * The input is the file the Artifact tool saves when it reads an artifact — the
 * whole published page, shell included.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/read-canvas.mjs <artifact.html> <out.dc.html>');
  process.exit(2);
}
if (!existsSync(inPath)) {
  console.error(`read-canvas: no such file — ${inPath}`);
  process.exit(1);
}

const html = readFileSync(inPath, 'utf8');

/**
 * The two islands the bundler leaves in the shell, read in one pass.
 *
 * ONE HARDCODED PATTERN, not one built per type. The first version took the
 * island name as an argument and interpolated it into `new RegExp(...)`, which
 * Semgrep's `detect-non-literal-regexp` flagged. The ReDoS it exists to catch
 * is not reachable here — this is a local CLI whose only two call sites passed
 * the literals below — but the rule was still worth taking rather than
 * arguing, for the same reason it was taken in `frontend/src/lib/reloadGuard.js`
 * on 2026-09-07: the construct it pushes you toward is better. There are
 * exactly two island types, an alternation says so in one place, and reading
 * both in a single pass replaces two scans of a ~2MB document with one.
 *
 * `matchAll` clones the regex internally, so the module-level `g` flag carries
 * no `lastIndex` between runs. First occurrence wins, which is what `.exec()`
 * returned before.
 */
const ISLAND = /<script type="__bundler\/(manifest|template)">\s*([\s\S]*?)\s*<\/script>/g;
const islands = new Map();
for (const m of html.matchAll(ISLAND)) {
  if (!islands.has(m[1])) islands.set(m[1], m[2]);
}

const manifestRaw = islands.get('manifest');
const templateRaw = islands.get('template');
if (!manifestRaw || !templateRaw) {
  console.error('read-canvas: this file is not a bundled artifact — no manifest/template island.');
  process.exit(1);
}

const manifest = JSON.parse(manifestRaw);
// The template island is a JSON *string*, not an object: the whole document
// arrives escaped.
let template = JSON.parse(templateRaw);

/** Decode one manifest entry far enough to know what it is. */
function decode(entry) {
  const bytes = Buffer.from(entry.data, 'base64');
  return entry.compressed ? gunzipSync(bytes) : bytes;
}

const RUNTIME_MARK = 'GENERATED from dc-runtime';
let runtimeUuid = null;
const fontUuids = new Set();
const other = [];

for (const [uuid, entry] of Object.entries(manifest)) {
  const mime = String(entry.mime || '');
  if (mime.startsWith('font/') || /^application\/(x-)?font-/.test(mime)) {
    fontUuids.add(uuid);
    continue;
  }
  if (mime.startsWith('text/javascript')) {
    // The runtime identifies itself in its own first line; React and ReactDOM
    // ship alongside it and are loaded BY it, not by the template, so they need
    // no rewrite — they simply never appear in the template's markup.
    const head = decode(entry).subarray(0, 200).toString('utf8');
    if (head.includes(RUNTIME_MARK)) { runtimeUuid = uuid; continue; }
    if (!template.includes(uuid)) continue;
  }
  if (template.includes(uuid)) other.push({ uuid, mime });
}

if (!runtimeUuid) {
  console.error('read-canvas: no dc-runtime asset found — is this a Claude Design canvas?');
  process.exit(1);
}

// ── 1. the runtime → the repo's shared copy ────────────────────────────────
const before = template;
template = template.split(runtimeUuid).join('./support.js');
if (template === before) {
  console.error('read-canvas: the runtime uuid does not appear in the template.');
  process.exit(1);
}

// ── 2. the inlined font faces → the link every other canvas uses ───────────
// Found by content, never by position: the font block is whichever <style>
// carries `@font-face`. A canvas that ships no fonts keeps its CSS untouched.
//
// THE FAMILIES ARE READ OUT OF THE BLOCK, NOT ASSUMED. A first version wrote a
// hard-coded Inter link, which silently dropped Roboto Mono from a canvas that
// uses it for its code samples — the decode would have looked right and set the
// wrong type. Whatever `@font-face` families and weights the bundle inlined are
// what the link asks for.
function fontLinkFor(block) {
  const families = new Map();
  for (const face of block.match(/@font-face\s*\{[^}]*\}/g) || []) {
    const fam = /font-family:\s*['"]([^'"]+)['"]/.exec(face)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(face)?.[1];
    if (!fam) continue;
    if (!families.has(fam)) families.set(fam, new Set());
    if (weight) families.get(fam).add(Number(weight));
  }
  if (!families.size) return '';
  const parts = [...families].map(([fam, weights]) => {
    const name = fam.replace(/ /g, '+');
    const w = [...weights].sort((a, b) => a - b);
    return w.length ? `family=${name}:wght@${w.join(';')}` : `family=${name}`;
  });
  return `<link href="https://fonts.googleapis.com/css2?${parts.join('&')}`
    + '&display=swap" rel="stylesheet">';
}

let replacedFontBlocks = 0;
let fontLink = '';
template = template.replace(/<style>[\s\S]*?<\/style>/g, (block) => {
  if (!block.includes('@font-face')) return block;
  replacedFontBlocks += 1;
  if (replacedFontBlocks > 1) return '';
  fontLink = fontLinkFor(block);
  return fontLink;
});

// ── 3. the publisher's watermark → gone ────────────────────────────────────
// A PUBLISHED artifact carries a dismissible "Made with Claude Design" badge
// that the committed canvases do not: one `<div id="__claude_design_branding">`
// appended after the design, holding its own `<style>`, an anchor and a close
// button. Leaving it in is not cosmetic — it is the ONLY thing that differed
// between two of these decodes and the copies already in `design/canvases/`,
// so every future export would diff against its predecessor by a badge instead
// of by its design, which is exactly the signal this pipeline exists to read.
//
// Matched from its id to its own closing tag rather than to end-of-document:
// the block sits last today, and a regex anchored on that would quietly take
// the rest of the page with it the day something is appended after it. It
// contains no nested `<div>`, which is checked rather than assumed — if it ever
// does, this leaves the file alone and says so.
{
  const open = template.indexOf('<div id="__claude_design_branding">');
  if (open >= 0) {
    const close = template.indexOf('</div>', open);
    const inner = close >= 0 ? template.slice(open + 1, close) : '';
    if (close < 0 || inner.includes('<div')) {
      console.error('read-canvas: the branding block is nested or unterminated — left in place.');
    } else {
      template = template.slice(0, open) + template.slice(close + '</div>'.length);
      template = template.replace(/\n{3,}(<\/body>)/, '\n$1');
    }
  }
}

// ── 4. un-mangle the attributes the publisher's serialiser flattened ───────
// A published artifact has been through a DOM round-trip, and HTML attribute
// names are case-insensitive: `dangerouslySetInnerHTML` comes back out as
// `sc-camel-dangerously-set-inner-h-t-m-l`. The runtime the repo's canvases run
// against reads the camelCase form, so leaving the mangled one in produces a
// file that renders without its inline SVG icons — a silent, visual-only loss
// that a byte comparison catches and a glance does not.
//
// Rebuilt rather than table-matched: the transform is mechanical (each capital
// became `-<lower>`), so reversing it handles attributes this canvas does not
// happen to use.
template = template.replace(/\bsc-camel-([a-z0-9-]+)=/g, (_, kebab) => {
  const camel = kebab.replace(/-([a-z0-9])/g, (__, ch) => ch.toUpperCase());
  return `${camel}=`;
});

// NO `design_doc_mode` META IS ADDED, and that is a correction rather than an
// omission. An earlier version inserted one because several repo canvases carry
// it — but `Trust Center v2.dc.html` and `Help Center.dc.html`, the two this
// decoder was verified against, do not. Adding it made the output differ from a
// known-good reference for no reason at all. Whatever the exporter emitted is
// what lands; this script normalises the bundle, it does not editorialise.

// ── 4. report anything still unresolved, rather than papering over it ──────
const leftover = [...fontUuids, ...other.map((o) => o.uuid)]
  .filter((u) => template.includes(u));

writeFileSync(outPath, template.endsWith('\n') ? template : `${template}\n`);

console.log(`✓ read-canvas: ${outPath}`);
console.log(`  ${(template.length / 1024).toFixed(1)}KB · runtime → ./support.js`
  + ` · ${fontUuids.size} font asset(s) → one stylesheet link`);
if (leftover.length) {
  console.error(`\n  ⚠ ${leftover.length} asset uuid(s) remain in the output and were not placed:`);
  for (const u of leftover.slice(0, 10)) {
    console.error(`      ${u}  ${manifest[u]?.mime || 'unknown mime'}`);
  }
  console.error('  The canvas will render without them. Resolve before triaging it.');
  process.exit(1);
}
