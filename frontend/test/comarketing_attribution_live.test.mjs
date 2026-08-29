/**
 * Co-marketing: the attribution trail stops being a five-number badge (Wave 2).
 *
 * `GET /api/comarketing/me/attributions` shipped with T15 and
 * `api.listMyCoMarketingAttributions` has sat in api.js ever since with no
 * caller. A partner whose published campaign was generating tracked traffic
 * could see four counters and nothing else — no timeline, no source, no lead.
 *
 * This file pins the two halves of the port that are easy to get wrong:
 *
 *   1. Every figure in the drawer comes from a stored row. The canvas asks for
 *      per-channel *reach*, and reach is recorded nowhere, so it is absent
 *      rather than estimated. Lead *names* are recorded nowhere either.
 *   2. The endpoint caps its result set, so the drawer must not present a
 *      partial window as a total, and must not draw a zero week for a period
 *      it has no rows for.
 *
 * The same canvas also asks for an "Angle" and a "what you bring" field on the
 * pitch form. Those were held back in the first pass because they are two
 * columns `comarketing_pitches` did not have — a migration, not a port.
 * Migration 183 adds them; the last three tests here pin that they are real
 * nullable columns rather than something overloaded onto `summary`, that the
 * create and edit paths enforce the same length caps, and that the review
 * queue actually shows the angle the review is supposed to turn on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const PAGE = 'frontend/src/pages/CoMarketingPage.jsx';

// Comments explain what is *not* rendered, and name the very fields the
// assertions below forbid. Strip them before checking behaviour.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the stripper removes both comment styles and keeps code', () => {
  const out = stripComments('const a = 1; // note\n/* block */ const b = 2;');
  assert.ok(!out.includes('note') && !out.includes('block'));
  assert.ok(out.includes('const a = 1;') && out.includes('const b = 2;'));
  // A protocol-relative URL must survive — this is why the // rule needs the
  // leading-character guard.
  assert.ok(stripComments("const u = 'https://x.test/a';").includes('x.test/a'));
});

test('the dead api method now has a caller, and the drawer is mounted', () => {
  const s = read(PAGE);
  assert.ok(s.includes('api.listMyCoMarketingAttributions('),
    'GET /comarketing/me/attributions had no consumer anywhere in the frontend');
  assert.match(s, /<PitchDetailDrawer\s/, 'defining the drawer is not shipping it');
  assert.match(read('frontend/src/lib/api.js'), /listMyCoMarketingAttributions: \(pitchUid\)/);
});

test('every api.* call on the page resolves to a real method', () => {
  // A misnamed method fails inside a catch and renders as an empty panel.
  const called = new Set([...read(PAGE).matchAll(/\bapi\.([A-Za-z0-9_]+)\(/g)].map((m) => m[1]));
  const defined = new Set([...read('frontend/src/lib/api.js').matchAll(/^\s{2}([A-Za-z0-9_]+):\s/gm)].map((m) => m[1]));
  const missing = [...called].filter((m) => !defined.has(m));
  assert.deepEqual(missing, [], `api.js does not define: ${missing.join(', ')}`);
});

test('totals come from the server count, the chart from the rows it returned', () => {
  const s = stripComments(read(PAGE));
  // The four tiles read pitch.attribution — the worker's own GROUP BY, which
  // is complete regardless of the row LIMIT.
  assert.match(s, /const counts = pitch\.attribution \|\| \{\}/);
  assert.match(s, /rows\.length < counts\.total/, 'the drawer must detect a clipped window');
  assert.match(s, /most recent \{rows\.length\} of \{counts\.total\} events/,
    'a clipped window must say so rather than reading as the whole history');
});

test('no week is drawn older than the oldest row actually held', () => {
  // Rows arrive newest-first under a LIMIT, so the missing events are always
  // the old ones. Charting a fixed 12-week window would render those as
  // confident zeroes.
  const s = stripComments(read(PAGE));
  assert.match(s, /const oldestHeld = rowWeeks\[0\] \|\| null/);
  assert.match(s, /cursor = oldestHeld > floor \? oldestHeld : floor/,
    'the window must start at the later of the 12-week floor and the oldest row');
});

test('channel reach is absent, not estimated', () => {
  const s = read(PAGE);
  assert.match(s, /reach per channel is\s+not recorded/i,
    'the drawer must state why reach is missing');
  // Ban the *figure*, not the word: the sentence above has to be allowed to
  // name the thing it says is missing. A rendered number would be a property
  // read off a row or a key built into one.
  const code = stripComments(s);
  for (const bad of [/\.reach\b/, /\breach:/, /impressions/, /audience_size/, /\bestimate[ds]?\b/]) {
    assert.ok(!bad.test(code), `the drawer must not render a ${bad.source} figure`);
  }
  // And the premise: no such column exists to read one from.
  const sql = sqlCorpus();
  assert.ok(!/^\s*\w*reach\w*\s+(TEXT|INTEGER|REAL|NUMERIC)/im.test(sql),
    'if reach is now a column, render it');
});

test('a lead is shown by the address on file, never by an invented name', () => {
  const code = stripComments(read(PAGE));
  assert.match(code, /initialsOf\(l\.lead_email\)/, 'initials must derive from the stored address');
  assert.match(code, /l\.lead_email \|\| 'Email not recorded'/, 'absence must read as absence');
  // comarketing_attributions stores no person's name; reading one would be
  // reading a field that is never written.
  for (const bad of ['l.name', 'l.full_name', 'l.lead_name', 'l.first_name']) {
    assert.ok(!code.includes(bad), `attribution rows carry no ${bad}`);
  }
});

function sqlCorpus() {
  const dir = resolve(root, 'cloudflare-worker/sql');
  const parts = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(resolve(d, e.name));
      else if (e.name.endsWith('.sql')) parts.push(readFileSync(resolve(d, e.name), 'utf8'));
    }
  };
  walk(dir);
  return parts.join('\n');
}

test('Angle and "what you bring" are stored columns, not overloaded fields', () => {
  // These were deliberately NOT built in the first pass: they are two columns
  // `comarketing_pitches` did not have, and faking them into `summary` or
  // `co_branding_notes` would have made the review read the wrong field.
  // Migration 183 adds them, nullable, with no backfill — an older pitch has
  // no angle on file and inventing one from its summary would put words in a
  // partner's mouth.
  const sql = sqlCorpus();
  const i = sql.indexOf('CREATE TABLE IF NOT EXISTS comarketing_pitches');
  assert.ok(i > 0, 'comarketing_pitches must exist');
  const ddl = sql.slice(i, sql.indexOf(');', i));
  // Literal patterns, not a constructed RegExp: Semgrep flags dynamic regex
  // construction, and there are only two columns to name.
  assert.match(ddl, /\bangle TEXT/, 'angle must be a nullable TEXT column');
  assert.match(ddl, /\bwhat_you_bring TEXT/, 'what_you_bring must be a nullable TEXT column');

  const mig = read('cloudflare-worker/sql/migrations/183_comarketing_angle.sql');
  assert.match(mig, /ALTER TABLE comarketing_pitches ADD COLUMN angle TEXT;/);
  assert.match(mig, /ALTER TABLE comarketing_pitches ADD COLUMN what_you_bring TEXT;/);
  assert.ok(!/NOT NULL|DEFAULT|UPDATE |INSERT /i.test(mig),
    'the migration must be additive and nullable, with no backfill');
});

test('both columns are writable on create and on edit, under the same caps', () => {
  const w = read('cloudflare-worker/src/routes/comarketing.ts');
  // Create.
  const ins = w.slice(w.indexOf("r.post('/me/pitches'"), w.indexOf("r.get('/me/pitches'"));
  assert.match(ins, /angle, what_you_bring, status/, 'the insert must name both columns');
  assert.match(ins, /String\(body\.angle\)\.slice\(0, ANGLE_MAX\)/);
  assert.match(ins, /String\(body\.what_you_bring\)\.slice\(0, BRING_MAX\)/);

  // Edit, under the SAME caps — an edit path that skipped them would let a
  // 50KB angle in through the back door.
  const pat = w.slice(w.indexOf("r.patch('/me/pitches/:uid'"), w.indexOf("r.post('/me/pitches/:uid/withdraw'"));
  assert.match(pat, /'angle', 'what_you_bring'/, 'both must be in the update allowlist');
  assert.match(pat, /angle: ANGLE_MAX, what_you_bring: BRING_MAX/,
    'the edit path must apply the create path caps');
});

test('the review surface shows the field the review turns on', () => {
  // The canvas copy is explicit that approval favours specific angles. A
  // reviewer who cannot see the angle is reviewing on the summary instead.
  const s = read(PAGE);
  const q = s.slice(s.indexOf('function AdminQueueRow'), s.indexOf('function AdminView'));
  assert.match(q, /pitch\.angle/, 'the review queue must show the angle');
  assert.match(q, /pitch\.what_you_bring/, 'the review queue must show what they bring');

  // And the form must collect them, or the columns stay empty forever.
  const f = s.slice(s.indexOf('function PitchForm'), s.indexOf('function AttributionBadge'));
  assert.match(f, /draft\.angle/);
  assert.match(f, /draft\.what_you_bring/);
  assert.match(f, /angle: draft\.angle \|\| null/, 'the submit must send it');
  assert.match(f, /what_you_bring: draft\.what_you_bring \|\| null/);
  // Client caps must match the server's, so the UI never silently truncates
  // differently from the API.
  assert.match(f, /maxLength=\{500\}/);
  assert.match(f, /maxLength=\{1000\}/);
});
