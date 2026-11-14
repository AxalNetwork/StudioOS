/**
 * #6265: every `<ZoneHeading>` passes only the props `ZoneHeading` reads.
 *
 * `ZoneHeading` (`pages/advisor/expertise/kit.jsx`, re-exported by
 * `pages/partner/kit.jsx`) takes `title`, `blurb` and `action`. Three Research
 * zones passed `sub` and `right` instead, and React drops an unknown prop
 * without a word: Diligence lost its sub-line and its "N rooms granted" pill,
 * Benchmarking its sub-line and its peer-set pill, Client prep its sub-line.
 * The names this test allows are read from the component's own signature, so
 * a prop added there is allowed here with no edit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const kit = readFileSync(join(src, 'pages/advisor/expertise/kit.jsx'), 'utf8');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * The top-level attribute names of each `<ZoneHeading ...>` in `text`. Skips
 * `{...}` expressions (nested), quoted strings and comments, so a `>` inside a
 * pill or an apostrophe in a comment between props cannot end the tag early.
 */
export function zoneHeadingProps(text) {
  const out = [];
  const open = /<ZoneHeading(?![\w$])/g;
  let m;
  while ((m = open.exec(text))) {
    const names = [];
    let i = m.index + m[0].length;
    let depth = 0;
    let spread = false;
    for (; i < text.length; i += 1) {
      const c = text[i];
      if (text.startsWith('/*', i)) { i = text.indexOf('*/', i + 2) + 1; continue; }
      if (text.startsWith('//', i)) { i = text.indexOf('\n', i); continue; }
      if (c === '"' || c === "'" || c === '`') { i = text.indexOf(c, i + 1); continue; }
      if (c === '{') { if (depth === 0 && text.startsWith('{...', i)) spread = true; depth += 1; continue; }
      if (c === '}') { depth -= 1; continue; }
      if (depth > 0) continue;
      if (c === '>') break;
      const name = /^[A-Za-z_$][\w$-]*/.exec(text.slice(i));
      if (name && /[\s<]/.test(text[i - 1] || ' ')) { names.push(name[0]); i += name[0].length - 1; }
    }
    out.push({ line: text.slice(0, m.index).split('\n').length, names, spread });
  }
  return out;
}

const signature = /export function ZoneHeading\(\{([^}]*)\}\)/.exec(kit);

test('ZoneHeading still reads its props from one destructured signature', () => {
  assert.ok(signature, 'kit.jsx no longer declares `export function ZoneHeading({ ... })`');
  assert.equal((kit.match(/function ZoneHeading\b/g) || []).length, 1);
  for (const f of walk(src)) {
    if (f.endsWith('advisor/expertise/kit.jsx')) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /(function|const|class) ZoneHeading\b/,
      `${relative(src, f)} defines a second ZoneHeading; this test assumes one`);
  }
});

test('no ZoneHeading caller passes a prop the component does not read', () => {
  const allowed = new Set(signature[1].split(',').map((s) => s.trim().split(/[\s=]/)[0]).filter(Boolean));
  assert.deepEqual([...allowed].sort(), ['action', 'blurb', 'title']);
  const offenders = [];
  let calls = 0;
  for (const f of walk(src)) {
    const text = readFileSync(f, 'utf8');
    for (const { line, names, spread } of zoneHeadingProps(text)) {
      calls += 1;
      if (spread) offenders.push(`${relative(src, f)}:${line} spreads props, which this scan cannot check`);
      for (const n of names) if (!allowed.has(n)) offenders.push(`${relative(src, f)}:${line} passes \`${n}\``);
    }
  }
  assert.ok(calls >= 40, `expected at least 40 <ZoneHeading> calls, found ${calls}: the scan broke`);
  assert.deepEqual(offenders, [],
    `ZoneHeading reads only ${[...allowed].join(', ')}; anything else is silently dropped:\n  ${offenders.join('\n  ')}`);
});

test('the scanner reads attribute names and nothing inside them', () => {
  const sample = `<ZoneHeading
    title="A > b"
    /* it's a comment: right= */
    sub={x ? <Pill tone="ok">{'n'}</Pill> : null}
    right={null}
  />`;
  assert.deepEqual(zoneHeadingProps(sample)[0].names, ['title', 'sub', 'right']);
  assert.deepEqual(zoneHeadingProps('<ZoneHeadingRow a="1" />'), []);
});

test('the three Research headings draw their sub-line and pill (#6265)', () => {
  const read = (rel) => readFileSync(join(src, rel), 'utf8');
  const heading = (text) => text.slice(text.indexOf('<ZoneHeading'), text.indexOf('/>', text.indexOf('<ZoneHeading')) + 2);
  const diligence = heading(read('pages/research/DiligenceZone.jsx'));
  assert.match(diligence, /blurb="The rooms founders have opened to you, and how much of each they actually staged\."/);
  assert.match(diligence, /action=\{data \? <Pill tone=\{data\.granted_count \? 'ok' : 'neutral'\}>\{`\$\{data\.granted_count\} rooms granted`\}<\/Pill> : null\}/);
  const bench = heading(read('pages/research/BenchmarkingZone.jsx'));
  assert.match(bench, /blurb="What you are measuring, what the peer set says, and how many it was measured over\."/);
  assert.match(bench, /action=\{data \? <Pill tone="neutral">/);
  assert.match(heading(read('pages/research/ClientPrepZone.jsx')), /blurb="One client\. Founder-sourced rows are read-only\."/);
});
