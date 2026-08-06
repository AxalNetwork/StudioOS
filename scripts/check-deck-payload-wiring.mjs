#!/usr/bin/env node
/**
 * Axal Spin-Out deck — payload↔consumer wiring guard.
 *
 * WHY THIS EXISTS. `fillAxalSpinoutDemoDay` runs ~30 queries to assemble
 * `SpinoutDemoDayData` from every Lab module a founder has worked in. Nothing
 * connected that assembly to the code that consumes it, so a field could be
 * queried, computed, shaped and returned — at full cost — and reach nothing at
 * all. That failure is silent: the deck renders, every test passes, and the
 * only symptom is a founder's evidence quietly missing.
 *
 * WHAT IT CHECKS, EXACTLY. Every field declared on `SpinoutDemoDayData` is
 * referenced by at least one of the consumers listed in CONSUMERS, matching
 * against code with comments stripped. Comment-stripping is the load-bearing
 * part: an early draft of this guard counted a field named in a `//` comment
 * as "read", which is precisely how an orphan would escape it.
 *
 * WHAT IT DOES NOT CHECK — and this matters, because the two bugs that
 * motivated it are NOT what it catches:
 *
 *   • #224 (Axal score composite) and #225 (revenue proof) were both fields
 *     that DID reach a consumer — the deck editor's JSON round-trip — but did
 *     not reach `spinoutDeckData.ts`, the renderer an investor actually sees.
 *     Both were fixed by adding a renderer read. This guard would have passed
 *     on both.
 *   • A stricter "must reach the renderer" rule was measured and rejected for
 *     now: the renderer reads 28 of 60 fields, and most of the rest are
 *     `eyebrow` labels the renderer deliberately owns itself. Encoding that
 *     would need a ~32-entry allowlist whose entries cannot each be justified
 *     without first auditing how the 13 deck templates consume editor fields.
 *     A guard with an unjustified allowlist is worse than no guard: it reads
 *     as coverage it does not have.
 *
 * So: this catches a field wired to NOTHING. It does not catch a field wired
 * only to the editor. The second is the more interesting gap and is still
 * open — see the renderer-coverage note in the PR that introduced this file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DECKS = join(ROOT, 'cloudflare-worker/src/services/decks');
const SOURCE = join(DECKS, 'axalSpinoutDemoDay.ts');

/**
 * Fields deliberately assembled without any consumer.
 * Key: "block.field". Value: why nobody needs to read it.
 * Keep this SHORT — every entry is a claim that assembled data is dead weight.
 */
const ALLOWED_UNREAD = {
  // (empty — every declared field currently reaches at least one consumer)
};

const fail = (msg) => { console.error(`\n✖ check-deck-payload-wiring: ${msg}\n`); process.exit(1); };

if (!existsSync(SOURCE)) fail(`payload source not found at ${SOURCE}`);
const src = readFileSync(SOURCE, 'utf8');

/** Strip block and line comments so prose mentions never count as a read. */
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// --- the payload shape -----------------------------------------------------
const typeStart = src.indexOf('export type SpinoutDemoDayData');
if (typeStart === -1) fail('SpinoutDemoDayData type not found — did the payload get renamed?');
const typeBody = src.slice(typeStart, src.indexOf('\n};', typeStart));

const blocks = new Map();
let currentBlock = null;
for (const line of typeBody.split('\n')) {
  const top = /^ {2}(\w+)\??:/.exec(line);
  if (top) { currentBlock = top[1]; if (!blocks.has(currentBlock)) blocks.set(currentBlock, []); continue; }
  if (!/^ {4}\w+\??:/.test(line) || !currentBlock) continue;
  // The type packs several fields onto one line — `eyebrow: string; headline:
  // string;` — so capture EVERY declaration on the line. Matching only the
  // first silently dropped `headline` and `vision` from the checked set.
  //
  // But mask nested spans first. `holders: Array<{ name: string; role: string
  // }>` declares ONE field on this block; `role` belongs to the element type
  // and is read as `h.role`, not `cap_table.role`. Counting those as block
  // fields turns the guard into 25 false positives, which is how a guard gets
  // switched off.
  const masked = line
    .replace(/<[^<>]*>/g, (s) => ' '.repeat(s.length))
    .replace(/\{[^{}]*\}/g, (s) => ' '.repeat(s.length));
  for (const m of masked.matchAll(/(?:^ {4}|;\s*)(\w+)\??:/g)) {
    blocks.get(currentBlock).push(m[1]);
  }
}
if (blocks.size === 0) fail('parsed zero blocks out of SpinoutDemoDayData — the parser is broken, not the code');

// --- everything that consumes the payload ----------------------------------
// A new renderer that is not listed here will make its fields look orphaned,
// which is the correct, loud failure: add it.
const CONSUMERS = {
  'slides (deck editor)': src.slice(
    src.indexOf('export function buildAxalSpinoutDemoDaySlides'),
    src.indexOf('export type AxalSpinoutCoverageCell'),
  ),
  'coverage map': src.slice(src.indexOf('export function buildAxalSpinoutCoverage')),
  'rendered deck': readFileSync(join(DECKS, 'spinoutDeckData.ts'), 'utf8'),
  'pptx export': readFileSync(join(DECKS, 'pptx.ts'), 'utf8'),
  'deck methods': readFileSync(join(DECKS, 'methods.ts'), 'utf8'),
};
for (const [name, text] of Object.entries(CONSUMERS)) {
  if (!text || text.length < 100) fail(`consumer "${name}" resolved to nothing — a slice index is stale`);
}
const CODE = Object.fromEntries(Object.entries(CONSUMERS).map(([k, v]) => [k, codeOnly(v)]));

/**
 * Local names a consumer binds to a payload block, so `const ct =
 * data.cap_table; … ct.holders` resolves. Covers the `data.` and `src.`
 * spellings both consumers use.
 */
function aliasesFor(text, block) {
  const names = [];
  // The bare block name counts ONLY where the consumer actually reaches the
  // payload through it. Consumers carry unrelated locals with colliding names
  // — `brand` in pptx.ts is the deck watermark, nothing to do with the
  // payload's `brand` block — and accepting the bare name unconditionally let
  // `brand.headline` there vouch for a payload field nobody reads.
  if (new RegExp(`(?:data|src)\\??\\.${block}\\b`).test(text)) names.push(block);
  const re = new RegExp(`const\\s+(\\w+)\\s*=\\s*(?:data|src)\\??\\.${block}\\b`, 'g');
  let m;
  while ((m = re.exec(text))) names.push(m[1]);
  return names;
}

const readers = (block, field) => Object.entries(CODE)
  .filter(([, text]) => aliasesFor(text, block)
    .some((n) => new RegExp(`\\b${n}\\??\\.\\s*${field}\\b`).test(text)))
  .map(([name]) => name);

// --- report ----------------------------------------------------------------
const orphans = [];
let checked = 0;
for (const [block, fields] of blocks) {
  for (const field of fields) {
    checked += 1;
    if (`${block}.${field}` in ALLOWED_UNREAD) continue;
    if (readers(block, field).length === 0) orphans.push(`${block}.${field}`);
  }
}

const stale = Object.keys(ALLOWED_UNREAD).filter((p) => {
  const [b, f] = p.split('.');
  return !blocks.has(b) || !blocks.get(b).includes(f);
});
if (stale.length) {
  fail(`ALLOWED_UNREAD lists fields that no longer exist: ${stale.join(', ')}\n`
    + '  Remove them — a stale allowlist hides the next real orphan.');
}

if (orphans.length) {
  console.error('\n✖ check-deck-payload-wiring: assembled deck data that nothing consumes.\n');
  for (const p of orphans) console.error(`    ${p}`);
  console.error(`\n  ${orphans.length} field(s) are queried and shaped by fillAxalSpinoutDemoDay,`);
  console.error('  then reach no slide, no export and no coverage cell. Either consume them,');
  console.error('  or add them to ALLOWED_UNREAD in scripts/check-deck-payload-wiring.mjs');
  console.error('  with a reason.\n');
  process.exit(1);
}

console.log(
  `✓ check-deck-payload-wiring: ${checked} deck payload fields across `
  + `${blocks.size} blocks all reach a consumer.`,
);
