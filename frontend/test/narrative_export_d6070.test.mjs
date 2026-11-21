/**
 * D6070 (#6070) — RAN22, "Take vN out": the export model, the PDF's pages and
 * watermark, and the dialog's order of work (record first, then the file or an
 * admin's copy).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_export_d6070.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  copyLabel, defaultInclude, exportBlocks, exportFailure, exportFilename, exportHeading, exportLogLine, exportModel, exportText,
  figureLine, hasWords, includedSections, leftOut, watermark,
} from '../src/pages/raise/narrative/exportModel.js';
import { renderNarrativePdf } from '../src/pages/raise/narrative/narrativePdf.js';

const NOW = '2026-11-15T10:00:00Z';
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// Invented words and figures: no real venture or investor.
function read({ sections, bindings = [], bindingsState = 'ok', oneLiner = 'Close the books in a day.', revision = 7 } = {}) {
  const items = sections || [
    { key: 'problem', body: 'Finance teams close the month by hand.', audience_note: 'Seed funds ask about pain first.', source: { kind: null, label: 'typed', ref: null } },
    { key: 'solution', body: 'One ledger for revenue data.', audience_note: null, source: null },
    { key: 'why_now', body: null, audience_note: null, source: null },
    { key: 'traction', body: 'We reached $18,400 MRR in October.', audience_note: null, source: { kind: 'module', label: 'recorded', ref: null } },
  ];
  return {
    version: 4,
    meta: { state: 'ok', investor_type: 'seed_fund', revision },
    sections: { state: 'ok', items },
    positioning: { state: 'ok', effective: oneLiner ? [{ kind: 'one_liner', position: 0, text: oneLiner }] : [] },
    bindings: bindingsState === 'ok' ? { state: 'ok', items: bindings } : { state: 'unreadable' },
  };
}
const registry = (items) => ({ status: 'ok', items });
const mrr = (value, hash = 'aaaaaaaaaaaaaaaaaaaaaaaa') => ({
  source_key: 'raise.mrr', label: 'MRR', state: 'recorded', value, unit: 'usd', source: 'Mercury', as_of: '2026-11-01', grade: 'Measured', snapshot_hash: hash,
});
const binding = (hash = 'aaaaaaaaaaaaaaaaaaaaaaaa') => ({ section: 'traction', position: 0, source_key: 'raise.mrr', record_ref: null, as_of: '2026-11-01', grade: 'Measured', snapshot_hash: hash });

test('1. the export names the version, its audience, the date and the revision; the PDF name carries the date', () => {
  const m = exportModel(read(), registry([]), NOW);
  assert.deepEqual(exportHeading(m), ['Investor narrative · v4', 'For seed fund · exported 15 Nov 2026 · revision 7']);
  assert.equal(exportFilename(m), 'investor-narrative-v4-2026-11-15.pdf');
  const noAudience = exportModel({ ...read(), meta: { state: 'ok', investor_type: null, revision: 0 } }, registry([]), NOW);
  assert.equal(exportHeading(noAudience)[1], 'For an audience not recorded · exported 15 Nov 2026 · revision 0');
});

test('2. Not recorded sections are left out and named; the checklist cannot put one back; the one-liner leads', () => {
  const m = exportModel(read(), registry([]), NOW);
  const inc = defaultInclude(m);
  assert.deepEqual(leftOut(m).map((s) => s.key), ['why_now']);
  assert.deepEqual(includedSections(m, inc).map((s) => s.key), ['problem', 'solution', 'traction']);
  inc.keys.add('why_now');
  assert.deepEqual(includedSections(m, inc).map((s) => s.key), ['problem', 'solution', 'traction']);
  const text = exportText(m, inc);
  assert.ok(!text.includes('Why now'));
  assert.equal(text.split('\n\n')[2], 'Close the books in a day.');
  assert.equal(copyLabel(includedSections(m, inc).length), 'Copy text · 3 sections');
  inc.keys.delete('solution');
  assert.ok(!exportText(m, inc).includes('One ledger'));
  // Notes and sources go out only when chosen.
  assert.ok(!text.includes('Audience note'));
  assert.ok(exportText(m, { ...inc, notes: true }).includes('Audience note: Seed funds ask about pain first.'));
  assert.ok(exportText(m, { ...inc, sources: true }).includes('Source: typed'));
  assert.ok(!exportText(m, { ...inc, oneLiner: false }).includes('Close the books'));
});

test('3. a bound figure goes out with the value shown now: in the words when placed, listed with its record when not', () => {
  // Placed: the words hold the record's value, so no extra line.
  const placed = exportModel(read({ bindings: [binding()] }), registry([mrr(18400)]), NOW);
  assert.deepEqual(placed.sections.find((s) => s.key === 'traction').figures, []);
  // Stale: the record moved on; the words keep the old number and the record's current value is listed.
  const stale = exportModel(read({ bindings: [binding()] }), registry([mrr(21000, 'bbbbbbbbbbbbbbbbbbbbbbbb')]), NOW);
  const line = stale.sections.find((s) => s.key === 'traction').figures;
  assert.equal(line.length, 1);
  assert.match(line[0], /^MRR: \$21[,.]?0?/);
  assert.match(line[0], /Mercury/);
  assert.match(line[0], /Measured/);
  assert.ok(exportText(stale, defaultInclude(stale)).includes(`Bound figures: ${line[0]}`));
  // A record with no value is Not recorded, never 0.
  const gone = exportModel(read({ bindings: [binding()] }), registry([{ source_key: 'raise.mrr', label: 'MRR', state: 'not_recorded' }]), NOW);
  assert.deepEqual(gone.sections.find((s) => s.key === 'traction').figures, ['MRR: Not recorded']);
  assert.equal(figureLine({ label: 'MRR', value: null }), 'MRR: Not recorded');
  // Bindings that could not be read: none is printed and the export says so.
  const unread = exportModel(read({ bindingsState: 'unreadable' }), registry([]), NOW);
  assert.ok(exportText(unread, defaultInclude(unread)).endsWith('The bound figures could not be read, so none is listed.'));
});

test('4. empty and unreadable: every section Not recorded has no words; a failed sections read is null, never empty', () => {
  const none = exportModel(read({ sections: [{ key: 'problem', body: null }, { key: 'team', body: '  ' }] }), registry([]), NOW);
  assert.equal(hasWords(none), false);
  assert.equal(includedSections(none, defaultInclude(none)).length, 0);
  assert.equal(exportModel({ ...read(), sections: { state: 'unreadable' } }, registry([]), NOW), null);
});

test('5. every PDF page carries the watermark with the version and the date, and the pages hold the copy text', () => {
  const long = 'Word '.repeat(4000).trim();
  const m = exportModel(read({ sections: [{ key: 'problem', body: long }, { key: 'solution', body: 'One ledger.' }] }), registry([]), NOW);
  const calls = [];
  let pages = 1; let page = 1;
  const doc = {
    setFont() {}, setFontSize() {}, setTextColor() {},
    splitTextToSize: (t) => t.match(/.{1,80}(\s|$)/g).map((s) => s.trim()),
    text: (t) => calls.push({ page, t }),
    addPage: () => { pages += 1; page = pages; },
    getNumberOfPages: () => pages,
    setPage: (p) => { page = p; },
  };
  const n = renderNarrativePdf(doc, m, defaultInclude(m));
  assert.ok(n > 1, `expected several pages, got ${n}`);
  for (let p = 1; p <= n; p += 1) {
    assert.ok(calls.some((c) => c.page === p && c.t === watermark(m, p, n)), `page ${p} has no watermark`);
  }
  assert.equal(watermark(m, 2, 3), 'Investor narrative v4 · exported 15 Nov 2026 · page 2 of 3');
  const printed = calls.map((c) => c.t).join(' ');
  for (const b of exportBlocks(m, defaultInclude(m)).filter((x) => x.kind !== 'body')) assert.ok(printed.includes(b.text), b.text);
  assert.ok(printed.includes('One ledger.'));
});

test('6. refusals read as their own sentence; the log names format, version, who and day', () => {
  assert.match(exportFailure({ status: 503, code: 'export_not_recorded' }), /no file was made/);
  assert.match(exportFailure({ status: 503, code: 'export_not_recorded' }, { admin: true }), /nothing was copied/);
  assert.match(exportFailure({ status: 403, code: 'admin_copy_only' }), /text only/);
  assert.match(exportFailure({ status: 403, data: { error: 'read_reason_required' } }, { admin: true }), /read reason has expired/);
  assert.match(exportFailure({ status: 500 }), /no file was made/);
  assert.equal(exportLogLine({ version: 4, format: 'pdf', by: 'founder', created_at: '2026-11-12 09:30:00' }), 'Exported v4 as PDF · 12 Nov');
  assert.equal(exportLogLine({ version: 4, format: 'text', by: 'admin', created_at: '2026-11-12 09:30:00' }), 'An admin copied v4 as text · 12 Nov');
});

test('7. the dialog records before it makes the PDF or an admin copy, offers an admin Copy only, and keeps DOCX unoffered', () => {
  const s = src('pages/raise/narrative/ExportDialog.jsx');
  const pdf = s.slice(s.indexOf('const pdf = async'), s.indexOf('const title ='));
  assert.ok(pdf.indexOf("record('pdf')") > -1 && pdf.indexOf("record('pdf')") < pdf.indexOf('downloadNarrativePdf('), 'the PDF is made only after it is recorded');
  assert.match(pdf, /catch \(e\) \{ setState\(\{[^}]*error: exportFailure\(e\)[^}]*\}\); return; \}/);
  const copy = s.slice(s.indexOf('const copy = async'), s.indexOf('const pdf = async'));
  assert.ok(copy.indexOf("record('text')") > -1 && copy.indexOf("record('text')") < copy.indexOf('toClipboard('), 'an admin copy is recorded first');
  assert.match(copy, /if \(admin\)/);
  assert.match(s, /const offered = f\.ready && \(!admin \|\| f\.id === 'text'\)/);
  assert.match(s, /format === 'pdf' && !admin/);
  // Story offers it on a saved version only, as the founder's Export and copy or the admin's Copy text.
  const story = src('pages/raise/narrative/StoryTab.jsx');
  assert.match(story, /exportAs && !isLiveDeck\(read\.data\)/);
  assert.match(src('pages/raise/narrative/NarrativeTool.jsx'), /exportAs=\{admin \? 'admin' : readOnly \? null : 'founder'\}/);
});
