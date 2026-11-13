/**
 * A19 (#3763): the legal drafts for counsel stay drafts.
 *
 *   · each draft carries the A19 DRAFT banner and a LEGAL_REVIEW.md entry;
 *   · each versioned draft is the live text plus only its new section, so a
 *     diff against the live file shows counsel exactly what changes;
 *   · nothing outside the template folder names a draft, and the live
 *     ToS and Privacy Policy are still the files the template module imports;
 *   · the marking spec names image tasks and an attribution line that exist.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/legal_drafts_a19.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LEGAL = 'cloudflare-worker/src/templates/legal';
const read = (p: string) => readFileSync(p, 'utf8');
const legal = (f: string) => read(join(LEGAL, f));
const DRAFTS = ['tos_v4.md', 'privacy_v3.md', 'dpa_v2.md', 'ai_image_marking_spec_v1.md'];
const BANNER = '<!-- DRAFT (A19, #3763) — for review by Delaware counsel before use. Not legal advice. Imported by nothing: publishing is B17 (#3793), after owner decisions V, W, X and Y. -->\n\n';

/** The text between `## <from>` and the next `## ` heading, which a draft adds. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `no section "${heading}"`);
  const next = text.indexOf('\n## ', start + 3);
  return text.slice(start, next + 1);
}

test('each draft carries the A19 banner and is listed in LEGAL_REVIEW.md', () => {
  const review = legal('LEGAL_REVIEW.md');
  for (const f of DRAFTS) {
    assert.ok(legal(f).startsWith(BANNER), `${f} starts with the DRAFT banner`);
    assert.ok(review.includes(`| \`${f}\` | **NEW DRAFT** (A19, #3763)`), `LEGAL_REVIEW.md's section A lists ${f} as a draft`);
    assert.ok(section(review, 'G. AI features').includes(`| \`${f}\` |`), `section G says what ${f} adds`);
  }
});

test('each versioned draft is the live text plus only its new section', () => {
  const tos = legal('tos_v4.md').slice(BANNER.length);
  assert.equal(tos.replace(section(tos, '4C. AI Features and Output'), ''), legal('tos_v3.md'));
  const privacy = legal('privacy_v3.md').slice(BANNER.length);
  assert.equal(privacy.replace(section(privacy, '3A. AI features'), ''), legal('privacy_v2.md'));
  const added = [
    'Cloudflare, Inc. (Workers AI, AI Gateway)', 'Cloudflare, Inc. (Vectorize)',
    'Cloudflare, Inc. (Browser Rendering)', 'Cloudflare, Inc. (Queues, Durable Objects, Analytics Engine)',
  ];
  const dpa = legal('dpa_v2.md').slice(BANNER.length).split('\n');
  for (const name of added) assert.equal(dpa.filter((l) => l.startsWith(`| ${name} |`)).length, 1, `one row for ${name}`);
  const live = legal('dpa_v1.md');
  const liveBody = live.slice(live.indexOf('\n\n') + 2);
  assert.equal(dpa.filter((l) => !added.some((name) => l.startsWith(`| ${name} |`))).join('\n'), liveBody);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx|js|jsx|mjs|json|toml|sql|py)$/.test(n)) out.push(p);
  }
  return out;
}

test('nothing outside the template folder names a draft; the live texts are unchanged in the template module', () => {
  const files = [...walk('cloudflare-worker/src'), ...walk('frontend/src'), ...walk('scripts'), 'wrangler.toml']
    .filter((p) => relative(LEGAL, p).startsWith('..'));
  for (const p of files) {
    const text = read(p);
    for (const f of DRAFTS) assert.ok(!text.includes(f.replace(/\.md$/, '')), `${p} names ${f}`);
  }
  const mod = read('cloudflare-worker/src/services/legalTemplates.ts');
  assert.match(mod, /import tos\s+from '\.\.\/templates\/legal\/tos_v3\.md\?raw';/);
  assert.match(mod, /import privacy\s+from '\.\.\/templates\/legal\/privacy_v2\.md\?raw';/);
});

test('the marking spec names image tasks and an attribution line that exist', () => {
  const spec = legal('ai_image_marking_spec_v1.md');
  const router = read('cloudflare-worker/src/services/aiRouter.ts');
  for (const task of ['deck_image', 'brand_logo', 'article_image']) {
    assert.ok(spec.includes(`\`${task}\``), `the spec covers ${task}`);
    assert.ok(router.split('\n').some((l) => l.trimStart().startsWith(`${task}:`) && l.includes("provider: 'workers-ai'")), `${task} is a router task`);
  }
  assert.match(read('frontend/src/pages/raise/pitch/imageModel.js'), /export function placedLine\(/);
  assert.match(read('frontend/src/pages/raise/pitch/ImageToolbar.jsx'), /\{placedLine\(image\)\}/);
  assert.ok(spec.includes('trainedAlgorithmicMedia'));
});
