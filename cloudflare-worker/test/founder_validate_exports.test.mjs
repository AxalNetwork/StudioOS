/**
 * The three Validate exports, as pure functions.
 *
 * These files leave the product. A number that is wrong on screen is a bug a
 * founder can see and re-read; the same number wrong in a CSV goes into an
 * investor update, and nothing carries it back. So the cases pinned here are
 * the ones where a plausible-looking cell would be a lie:
 *
 *   · consent that was never asked, written as `false` — a spreadsheet saying
 *     every pre-211 interviewee declined to be quoted
 *   · a verdict of `null` written as "unproven" — evidence that has not decided
 *     is not evidence that decided against
 *   · a pain theme's frequency counted in phrasings rather than in people
 *   · a carriage return inside a field, unquoted — one pasted Windows line
 *     ending splitting a row in half for any RFC 4180 reader
 *
 * Run with:
 *   node --test cloudflare-worker/test/founder_validate_exports.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transpileTs as transpile } from './_transpile-ts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The same mirror-the-tree loader `admin.user-conversations.test.mjs` uses. */
async function load(entry, deps) {
  const tmp = await mkdtemp(join(tmpdir(), 'validate-exports-'));
  let first = '';
  for (const rel of [entry, ...deps]) {
    const src = await readFile(resolve(__dirname, '../src', rel), 'utf8');
    const out = join(tmp, rel.replace(/\.ts$/, '.mjs'));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, transpile(src).replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'"));
    if (!first) first = out;
  }
  return import(pathToFileURL(first).href);
}

const mod = () => load('routes/_founder_validate_exports.ts', ['services/csv.ts', 'services/painGroups.ts']);

const rows = (csv) => csv.split('\r\n');
const cells = (line) => {
  // Enough CSV parsing to read a row back: quoted fields, doubled quotes.
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

const interview = (over = {}) => ({
  id: 1, interviewee_name: 'Dana Okafor', interviewee_role: 'Head of Ops',
  interviewee_company: 'Meridian', interview_date: '2026-08-14', icp_fit: 'strong',
  quote_consent: 1, featured: 0, validation_rating: 4, validation_comment: null,
  notes: 'Reconciles by hand every Friday.', pains_json: '["manual reconciliation"]',
  ...over,
});

test('interviews: consent that was never asked is blank, not "no"', async () => {
  const { serializeInterviewsCsv } = await mod();
  const csv = serializeInterviewsCsv([
    interview({ id: 1, quote_consent: 1 }),
    interview({ id: 2, quote_consent: 0 }),
    interview({ id: 3, quote_consent: null }),
  ]);
  const header = cells(rows(csv)[0]);
  const iConsent = header.indexOf('quote_consent');
  const iDeck = header.indexOf('deck_eligible');
  assert.ok(iConsent > 0 && iDeck > 0, 'the consent columns are missing from the header');
  const body = rows(csv).slice(1).map(cells);
  assert.deepEqual(body.map((r) => r[iConsent]), ['yes', 'no', ''],
    'never-asked must be empty — writing "no" would report a refusal nobody made');
  assert.deepEqual(body.map((r) => r[iDeck]), ['yes', 'no', ''],
    'deck eligibility derives from consent and carries the same third state');
});

test('interviews: a malformed pains blob is no pains, not a crash', async () => {
  const { serializeInterviewsCsv } = await mod();
  const csv = serializeInterviewsCsv([interview({ pains_json: '{not json' })]);
  const header = cells(rows(csv)[0]);
  const body = cells(rows(csv)[1]);
  assert.equal(body[header.indexOf('pains')], '');
});

test('interviews: a field carrying a carriage return is quoted', async () => {
  const { serializeInterviewsCsv } = await mod();
  // No comma, no newline — only a CR. Two of the worker's three older escapers
  // would leave this unquoted and an RFC 4180 reader would split the record.
  const csv = serializeInterviewsCsv([interview({ notes: 'line one\rline two' })]);
  assert.ok(csv.includes('"line one\rline two"'), 'a bare CR must still force quoting');
  const bodyLines = csv.split('\r\n');
  assert.equal(bodyLines.length, 2, `the record split into ${bodyLines.length} lines`);
});

test('interviews: a value containing quotes and commas round-trips', async () => {
  const { serializeInterviewsCsv } = await mod();
  const csv = serializeInterviewsCsv([interview({ notes: 'She said "maybe", then left' })]);
  const header = cells(rows(csv)[0]);
  assert.equal(cells(rows(csv)[1])[header.indexOf('notes')], 'She said "maybe", then left');
});

test('pain map: frequency is interviews, and ungrouped phrases are not hidden', async () => {
  const { serializePainMapCsv } = await mod();
  const csv = serializePainMapCsv({
    project_id: 7,
    interview_total: 8,
    groups: [{
      id: 1, title: 'Manual reconciliation', sort_order: 0, count: 4,
      // Three wordings, four interviews: a count taken from `phrases.length`
      // would report 3 and understate the theme.
      phrases: [
        { phrase_norm: 'a', display_phrase: 'reconciling by hand' },
        { phrase_norm: 'b', display_phrase: 'manual recs' },
        { phrase_norm: 'c', display_phrase: 'spreadsheet matching' },
      ],
    }],
    ungrouped: [{ phrase_norm: 'z', display_phrase: 'slow onboarding', count: 1 }],
  });
  const header = cells(rows(csv)[0]);
  const first = cells(rows(csv)[1]);
  assert.equal(first[header.indexOf('interviews')], '4', 'the count is distinct interviews, not phrasings');
  assert.equal(first[header.indexOf('share_of_interviews')], '50%');
  const last = cells(rows(csv)[2]);
  assert.match(last[0], /^\(ungrouped\)/, 'ungrouped phrases must appear, marked as such');
});

test('pain map: no interviews means no share, not a division by zero', async () => {
  const { serializePainMapCsv } = await mod();
  const csv = serializePainMapCsv({
    project_id: 7, interview_total: 0,
    groups: [{ id: 1, title: 'T', sort_order: 0, count: 0, phrases: [] }],
    ungrouped: [],
  });
  const header = cells(rows(csv)[0]);
  assert.equal(cells(rows(csv)[1])[header.indexOf('share_of_interviews')], '',
    'a share with no denominator is absent, never 0% or NaN');
});

const hyp = (over = {}) => ({
  code: 'H1', claim: 'Ops leads will pay.', lane: 'testing', verdict: null,
  evidence: { supporting: 2, contradicting: 0, fitUnrecorded: 1 },
  bar_note: '3 more ICP interviews to validate', retired_at: null, ...over,
});

test('summary: a null verdict is blank, never "unproven"', async () => {
  const { serializeSummaryCsv } = await mod();
  const csv = serializeSummaryCsv([hyp({ verdict: null }), hyp({ code: 'H2', verdict: 'unproven' })], null);
  const header = cells(rows(csv)[0]);
  const i = header.indexOf('verdict');
  assert.equal(cells(rows(csv)[1])[i], '', 'no verdict yet is not the same as the verdict "unproven"');
  assert.equal(cells(rows(csv)[2])[i], 'unproven');
});

test('summary: a withheld distance-to-bar is blank, not zero', async () => {
  const { serializeSummaryCsv } = await mod();
  const csv = serializeSummaryCsv([hyp({ bar_note: null })], null);
  const header = cells(rows(csv)[0]);
  assert.equal(cells(rows(csv)[1])[header.indexOf('distance_to_bar')], '');
});

test('summary: the decision is a trailing block, and its absence is stated', async () => {
  const { serializeSummaryCsv } = await mod();
  const withNone = serializeSummaryCsv([hyp()], null);
  assert.ok(withNone.includes('not recorded'),
    'no decision must say so — an empty tail would read as a file that got cut off');

  const withOne = serializeSummaryCsv([hyp()], {
    decision: 'proceed', reasoning: 'Four ICP interviews cleared the bar.', decided_at: '2026-09-01',
  });
  const blocks = withOne.split('\r\n\r\n');
  assert.equal(blocks.length, 2, 'the decision rides in its own block, below the claims');
  assert.match(blocks[1], /^decision,reasoning,decided_at/);
  assert.ok(blocks[1].includes('proceed'));
});

test('csv: the shared escaper leaves an ordinary value alone', async () => {
  const { csvEsc, toCsv } = await load('services/csv.ts', []);
  assert.equal(csvEsc('plain'), 'plain');
  assert.equal(csvEsc(null), '', 'null is a blank cell, not the four characters "null"');
  assert.equal(csvEsc(undefined), '');
  assert.equal(csvEsc(0), '0', 'zero is a value and must survive');
  assert.equal(csvEsc('a,b'), '"a,b"');
  assert.equal(csvEsc('say "hi"'), '"say ""hi"""');
  assert.equal(toCsv(['a', 'b'], [[1, 2]]), 'a,b\r\n1,2', 'RFC 4180 line endings');
});
