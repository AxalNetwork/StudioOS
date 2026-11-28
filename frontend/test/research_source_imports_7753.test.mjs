/**
 * D7753 (#7753) — the Research source import console, part 1: the run model driven by a stub transport that keeps
 * the Worker's contract (D7745), over an invented 2,191-record, four-source package generated here. No data file is
 * committed: every value below is made up and carries a marker, so a test can prove where values never go.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_source_imports_7753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SourceImportsPage from '../src/pages/research/imports/SourceImportsPage.jsx';
import SourceImportRun from '../src/pages/research/imports/SourceImportRun.jsx';
import {
  CHUNK_BOUND, ImportProblem, PACE_MS, SENTENCES, buildPlan, checkPackage, createRun, emptyClasses, judge, listDigest,
  missingClass, previewRequests, readPackage, refusalSentence, removalWord, sha256Text,
  hasLoneSurrogate,
} from '../src/pages/research/imports/importRun.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MARK = 'QXMARK7753V';          // in every invented value
const CONTACT = 'QXCONTACT7753C';    // in every contact cell
const PERSON = 'QXPERSON7753P';      // in every record about a person

/** The audited shape (D7745): four sources of 120, 134, 84 and 1,853 records; two carry a contact column. */
const SHAPE = [
  { key: 'invented_funds', n: 120, fields: 5, contact: 0, persons: 0 },
  { key: 'invented_investors', n: 134, fields: 12, contact: 1, persons: 3 },
  { key: 'invented_vehicles', n: 84, fields: 11, contact: 2, persons: 0 },
  { key: 'invented_rounds', n: 1853, fields: 12, contact: 0, persons: 0 },
];

async function inventedPackage({ shape = SHAPE } = {}) {
  const records = [];
  const sources = shape.map((s) => ({ ...s, columns: Array.from({ length: s.fields }, (_, i) => (i < s.contact ? `contact_${i}` : `field_${i}`)) }));
  for (const s of sources) {
    for (let i = 0; i < s.n; i++) {
      const id = `${s.key.slice(9, 12)}-${String(i).padStart(5, '0')}`;
      const person = i < s.persons;
      const cells = s.columns.map((c, j) => {
        if (c.startsWith('contact_')) return [c, `person${i}@${CONTACT}.synthetic.invalid`];
        const value = j === 3 ? [`Seed ${MARK}`, `Series A ${MARK}`] : j === 4 && i % 7 === 0 ? '' : `${c} ${i} ${MARK}${person ? ` ${PERSON}` : ''}`;
        return [c, value];
      });
      records.push({ source_key: s.key, provider_record_id: id, stated_row_hash: await sha256Text(`${id}|${MARK}`), cells, ...(person ? { about_person: true } : {}) });
    }
  }
  const manifest = { sources: await Promise.all(sources.map(async (s) => {
    const mine = records.filter((r) => r.source_key === s.key);
    return { source_key: s.key, columns: s.columns, expected_records: s.n, expected_cells: s.n * s.fields, digest: await listDigest(mine) };
  })) };
  return { manifest, records };
}

const bytesOf = (doc) => new TextEncoder().encode(JSON.stringify(doc));
const classesFor = (pkg) => {
  const c = emptyClasses(pkg);
  for (const s of pkg.sources) for (const col of s.columns) c[s.source_key][col] = col.startsWith('contact_') ? 'contact' : col === 'field_5' ? 'prose' : 'fact';
  return c;
};

/* ------------------------------------------------------------------ a stub Worker with D7745's contract */

const refusal = (status, code, names = {}) => Object.assign(new Error(`refused ${code}`), { status, code, data: { names } });
const transportError = () => Object.assign(new Error('Failed to fetch'), {});
const SEPK = '\u001f';

function stubWorker({ faults = {} } = {}) {
  const store = new Map();          // source␟id → stated hash
  const removed = new Set();
  const runs = [];
  const log = [];                   // { op, path, body }
  let uidN = 0;
  const attempts = new Map();
  const tick = (k) => { const n = (attempts.get(k) ?? 0) + 1; attempts.set(k, n); return n; };
  const fault = (name, ...a) => { const f = faults[name]; const e = f ? f(...a) : null; if (e) throw e; };

  const summary = (r) => ({
    uid: r.uid, status: r.status, acted_by_user_id: 7, worker_version: 'synthetic-commit', started_at: '2026-11-27T10:00:00.000Z',
    verified_at: r.status === 'complete' ? '2026-11-27T10:02:00.000Z' : null, counts: counts(r), uncertain_chunks: [...r.uncertain],
    file_digest: { sha256: r.file_sha, status: 'declared_not_checked' }, row_hashes: 'declared_not_checked',
  });
  function counts(r) {
    const outcomes = {};
    const cells = {};
    for (const m of r.members.values()) {
      outcomes[m.outcome] = (outcomes[m.outcome] ?? 0) + 1;
      for (const [col, kind] of Object.entries(m.cells)) {
        cells[m.source_key] ??= {};
        const t = (cells[m.source_key][col] ??= { stored: 0, withheld: 0, blank: 0 });
        t[kind === 's' ? 'stored' : kind === 'w' ? 'withheld' : 'blank'] += 1;
      }
    }
    if (faults.skewWithheld) for (const s of Object.values(cells)) { const first = Object.values(s)[0]; first.withheld += 1; first.stored -= 1; }
    return { outcomes, cells };
  }
  const byUid = (uid) => { const r = runs.find((x) => x.uid === uid); if (!r) throw refusal(404, 'run_not_found'); return r; };

  const api = {
    async preview(body) {
      log.push({ op: 'preview', path: '/research-source-imports/preview', body });
      fault('preview', tick('preview'));
      assert.ok(body.pages.every((p) => p.length >= 1 && p.length <= 500));
      const out = new Map(body.manifest.sources.map((s) => [s.source_key, { source_key: s.source_key, expected_records: s.expected_records, sent: 0, new: 0, unchanged: 0, changed: 0, removed: 0, private_fields_removed: 0 }]));
      for (const [s, i, h] of body.pages.flat()) {
        const t = out.get(s);
        t.sent += 1;
        const k = `${s}${SEPK}${i}`;
        if (removed.has(k)) t.removed += 1;
        else if (store.get(k) === h) t.unchanged += 1;
        else if (store.has(k)) t.changed += 1;
        else t.new += 1;
      }
      return { writes: 'none', sources: [...out.values()].map((t) => ({ ...t, list_digest_matches: null })) };
    },
    async runs() {
      log.push({ op: 'runs', path: '/research-source-imports/runs' });
      fault('runs', tick('runs'));
      return { runs: [...runs].reverse().map(summary), limit: 50 };
    },
    async run(uid, offset = 0) {
      log.push({ op: 'run', path: `/research-source-imports/runs/${encodeURIComponent(uid)}${offset ? `?offset=${offset}` : ''}` });
      fault('run', tick('run'));
      const r = byUid(uid);
      const members = [...r.members.values()].sort((a, b) => (a.source_key + a.provider_record_id < b.source_key + b.provider_record_id ? -1 : 1));
      const digests = {};
      for (const s of r.manifest.sources) {
        const kept = members.filter((m) => m.source_key === s.source_key && m.outcome !== 'refused');
        const recomputed = await listDigest(kept);
        digests[s.source_key] = { declared: s.digest, recomputed, matches: recomputed === s.digest, members: kept.length };
      }
      const page = members.slice(offset, offset + 1000).map((m) => ({ source_key: m.source_key, provider_record_id: m.provider_record_id, stated_row_hash: m.stated_row_hash, outcome: m.outcome, refusal_code: m.refusal_code ?? null, chunk_index: m.chunk_index }));
      return { run: summary(r), held_chunks: [...r.chunks.keys()].sort((a, b) => a - b), list_digests: digests, members: page, members_total: members.length, offset, next_offset: offset + 1000 < members.length ? offset + 1000 : null };
    },
    async openRun(body) {
      log.push({ op: 'open', path: '/research-source-imports/runs', body });
      fault('open', tick('open'));
      const prior = runs.find((r) => r.key === body.idempotency_key);
      if (prior) return { run: summary(prior), replayed: true };
      const open = runs.find((r) => ['running', 'uncertain', 'partial'].includes(r.status));
      if (open) throw refusal(409, 'run_open', { run_uid: open.uid, status: open.status });
      for (const s of body.manifest.sources) for (const c of s.columns) {
        const k = body.column_classes[s.source_key][c];
        assert.ok(k && ['fact', 'prose', 'contact'].includes(k.class));
        if (k.class === 'contact') assert.equal(k.contact, 'withheld');
      }
      const r = { uid: `00000000-0000-4000-8000-${String(++uidN).padStart(12, '0')}`, key: body.idempotency_key, file_sha: body.file_sha256, manifest: body.manifest, classes: body.column_classes, status: 'running', chunks: new Map(), members: new Map(), uncertain: [] };
      runs.push(r);
      return { run: summary(r), replayed: false, chunk_bound: { records: CHUNK_BOUND.records, bytes: CHUNK_BOUND.bytes } };
    },
    async sendChunk(uid, body) {
      log.push({ op: 'chunk', path: `/research-source-imports/runs/${encodeURIComponent(uid)}/chunks`, body });
      fault('chunk', body.chunk_index, tick(`chunk${body.chunk_index}`));
      const raw = JSON.stringify(body);
      assert.ok(new TextEncoder().encode(raw).byteLength <= CHUNK_BOUND.bytes, 'chunk within the byte bound');
      assert.ok(body.records.length >= 1 && body.records.length <= CHUNK_BOUND.records, 'chunk within the record bound');
      const r = byUid(uid);
      if (!['running', 'uncertain'].includes(r.status)) throw refusal(409, 'run_not_open');
      for (const rec of body.records) {
        for (const [c] of rec.cells) if (r.classes[rec.source_key][c].class === 'contact') throw refusal(422, 'contact_column_refused');
        assert.equal(await sha256Text(JSON.stringify(rec.cells)), rec.body_sha256, 'body hash as the Worker recomputes it');
      }
      const keys = body.records.map((x) => `${x.source_key}${SEPK}${x.provider_record_id}`);
      if (r.chunks.has(body.chunk_index) && !r.uncertain.includes(body.chunk_index)) {
        assert.deepEqual(r.chunks.get(body.chunk_index), keys, 'a held index replays only the same records');
        return { run_uid: uid, chunk_index: body.chunk_index, status: 'replayed', written: false, counts: null, refused: [] };
      }
      for (const rec of body.records) {
        const k = `${rec.source_key}${SEPK}${rec.provider_record_id}`;
        const src = r.manifest.sources.find((s) => s.source_key === rec.source_key);
        const present = new Map(rec.cells);
        const cells = Object.fromEntries(src.columns.map((c) => [c, r.classes[rec.source_key][c].class === 'contact' ? 'w' : (present.has(c) && present.get(c) !== '' && present.get(c) !== null ? 's' : 'b')]));
        const outcome = store.get(k) === rec.stated_row_hash ? 'unchanged' : store.has(k) ? 'new_version' : 'new';
        r.members.set(k, { source_key: rec.source_key, provider_record_id: rec.provider_record_id, stated_row_hash: rec.stated_row_hash, outcome, cells, chunk_index: body.chunk_index });
        store.set(k, rec.stated_row_hash);
      }
      r.chunks.set(body.chunk_index, keys);
      r.uncertain = r.uncertain.filter((i) => i !== body.chunk_index);
      if (r.status === 'uncertain' && !r.uncertain.length) r.status = 'running';
      if (faults.lostAnswer?.(body.chunk_index, attempts.get(`chunk${body.chunk_index}`))) throw transportError();
      return { run_uid: uid, chunk_index: body.chunk_index, status: 'written', written: true, counts: {}, refused: [], refused_count: 0 };
    },
    async seal(uid, body) {
      log.push({ op: 'seal', path: `/research-source-imports/runs/${encodeURIComponent(uid)}/seal`, body });
      fault('seal', tick('seal'));
      const r = byUid(uid);
      let complete = true;
      const sources = {};
      for (const s of r.manifest.sources) {
        const expected = body.expected.filter((e) => e[0] === s.source_key);
        assert.equal(await listDigest(expected.map(([, i, h]) => ({ provider_record_id: i, stated_row_hash: h }))), s.digest, 'expected list matches the manifest sent');
        const kept = [...r.members.values()].filter((m) => m.source_key === s.source_key && m.outcome !== 'refused');
        const present = kept.length;
        if (present !== s.expected_records) complete = false;
        sources[s.source_key] = { expected: s.expected_records, present };
      }
      r.status = r.uncertain.length ? 'uncertain' : complete ? 'complete' : 'partial';
      return { run_uid: uid, status: r.status, sources, uncertain_chunks: [...r.uncertain], named: {} };
    },
    async reconcile(uid, body) {
      log.push({ op: 'reconcile', path: `/research-source-imports/runs/${encodeURIComponent(uid)}/reconcile`, body });
      const r = byUid(uid);
      if (body.action === 'resume') { assert.equal(r.status, 'partial'); r.status = 'running'; }
      else r.status = 'failed';
      return { run: summary(r), action: body.action };
    },
  };
  return { api, log, runs, store };
}

function fakeClock() {
  let t = 1_000_000;
  const starts = [];
  return {
    starts,
    now: () => t,
    sleep: async (ms) => { t += Math.max(0, ms); },
    mark() { starts.push(t); },
  };
}

/** The stub's methods, each marking the paced clock when a request starts. */
const paced = (api, clock) => Object.fromEntries(Object.entries(api).map(([k, f]) => [k, (...a) => { clock.mark(); return f(...a); }]));

async function prepared(opts) {
  const doc = await inventedPackage(opts);
  const pkg = await readPackage(bytesOf(doc));
  const plan = await buildPlan(pkg, classesFor(pkg));
  return { doc, pkg, plan };
}

/* ------------------------------------------------------------------ the file check */

test('the invented package is 2,191 records in four sources, and checks against its own manifest in the browser', async () => {
  const { pkg, plan } = await prepared();
  assert.equal(pkg.records, 2191);
  assert.deepEqual(pkg.sources.map((s) => s.records.length), [120, 134, 84, 1853]);
  assert.match(pkg.sha256, /^[0-9a-f]{64}$/);
  // Three records about people are checked with their source and left out of what is sent.
  assert.equal(plan.entries.length, 2188);
  assert.equal(plan.manifest.sources[1].excluded_person_records, 3);
  assert.equal(plan.manifest.sources[1].expected_records, 131);
  assert.equal(plan.manifest.sources[1].expected_cells, 131 * 12);
  // Withheld cells: every record sent times its source's contact columns.
  assert.deepEqual(plan.sources.map((s) => s.withheld_cells), [0, 131, 168, 0]);
});

test('a file that does not match its manifest is refused before any request, in a fixed sentence', async () => {
  const doc = await inventedPackage();
  const short = structuredClone(doc);
  short.records.splice(5, 1);
  await assert.rejects(readPackage(bytesOf(short)), (e) => e instanceof ImportProblem && e.code === 'count_mismatch' &&
    e.message === 'The file does not match its manifest: source invented_funds declares 120 records and the file holds 119.');

  const altered = structuredClone(doc);
  altered.records[200].stated_row_hash = 'f'.repeat(64);
  await assert.rejects(readPackage(bytesOf(altered)), (e) => e.code === 'digest_mismatch' && !e.message.includes(MARK));

  const cells = structuredClone(doc);
  cells.manifest.sources[0].expected_cells += 1;
  await assert.rejects(readPackage(bytesOf(cells)), (e) => e.code === 'cells_mismatch');

  const stray = structuredClone(doc);
  stray.records[3].cells.push(['not_a_column', `x ${MARK}`]);
  await assert.rejects(readPackage(bytesOf(stray)), (e) => e.code === 'unknown_column' && e.message === 'Source invented_funds, record 4 has a column the manifest does not list: not_a_column. Nothing was sent.');

  // A JSON parse error would quote the text; the sentence never does.
  const broken = new TextEncoder().encode(`{"manifest": {"sources": []}, "records": [${MARK} ${CONTACT}`);
  await assert.rejects(readPackage(broken), (e) => e.code === 'not_json' && e.message === SENTENCES.not_json() && !e.message.includes(MARK));
  await assert.rejects(readPackage(new Uint8Array([0xff, 0xfe, 0x00])), (e) => e.code === 'not_text');
  await assert.rejects(checkPackage({ records: [] }, { sha256: '0', size: 0 }), (e) => e.code === 'no_manifest');
});

test('every column needs a class before a plan is made; a contact column is withheld', async () => {
  const doc = await inventedPackage();
  const pkg = await readPackage(bytesOf(doc));
  const classes = classesFor(pkg);
  classes.invented_vehicles.field_7 = null;
  assert.deepEqual(missingClass(pkg, classes), { source: 'invented_vehicles', column: 'field_7' });
  await assert.rejects(buildPlan(pkg, classes), (e) => e.code === 'class_missing' && e.message === 'Set a class for field_7 in source invented_vehicles first.');
});

/* ------------------------------------------------------------------ preview */

test('preview calls only the preview route, in pages of at most 500, and writes nothing', async () => {
  const { plan } = await prepared();
  const w = stubWorker();
  const clock = fakeClock();
  const run = createRun({ plan, transport: paced(w.api, clock), clock });
  const s = await run.preview();
  assert.deepEqual([...new Set(w.log.map((l) => l.op))], ['preview']);
  assert.equal(previewRequests(plan).length, 1);
  assert.equal(w.log[0].body.pages.length, 5);
  assert.equal(s.phase, 'previewed');
  assert.equal(s.preview.total, 2188);
  assert.equal(s.preview.sources.reduce((a, x) => a + x.new, 0), 2188);
  assert.equal(s.preview.all_unchanged, false);
  assert.equal(w.store.size, 0);
});

/* ------------------------------------------------------------------ apply */

test('apply sends every permitted record once, in chunks within the bound, and is Complete only after read-back equals the package', async () => {
  const { plan } = await prepared();
  const w = stubWorker();
  const clock = fakeClock();
  const phases = [];
  const run = createRun({ plan, transport: paced(w.api, clock), clock, onChange: (s) => phases.push(s.phase) });
  const s = await run.apply();
  assert.equal(s.phase, 'complete', s.sentence);
  const chunks = w.log.filter((l) => l.op === 'chunk');
  assert.equal(chunks.length, 44);
  const sent = chunks.flatMap((c) => c.body.records.map((r) => `${r.source_key}/${r.provider_record_id}`));
  assert.equal(sent.length, 2188);
  assert.equal(new Set(sent).size, 2188, 'each record once');
  assert.ok(chunks.every((c) => c.body.records.length <= 50));
  // Never the whole file: no request body holds more than one chunk's records.
  assert.ok(w.log.every((l) => !l.body?.records || l.body.records.length <= 50));
  // The read-back came after the seal, and Complete came after both.
  const ops = w.log.map((l) => l.op);
  assert.ok(ops.lastIndexOf('run') > ops.indexOf('seal'));
  assert.equal(phases.at(-1), 'complete');
  assert.ok(phases.indexOf('reading') < phases.lastIndexOf('complete'));
  assert.ok(!phases.slice(0, phases.indexOf('reading')).includes('complete'), 'no Complete before the read-back');
  assert.deepEqual(s.readback.sources.map((x) => x.cells.withheld), [0, 131, 168, 0]);
  // Paced: no 60-second window holds more than 60 request starts.
  for (const t of clock.starts) assert.ok(clock.starts.filter((u) => u >= t && u < t + 60_000).length <= 60);
  assert.ok(clock.starts.every((t, i) => i === 0 || t - clock.starts[i - 1] >= PACE_MS));
});

test('a read-back whose withheld cells differ from what was left out is not Complete', async () => {
  const { plan } = await prepared();
  const w = stubWorker({ faults: { skewWithheld: true } });
  const clock = fakeClock();
  const s = await createRun({ plan, transport: w.api, clock }).apply();
  assert.equal(s.phase, 'partial');
  // judge() alone: equal counts with the Worker saying partial is still not Complete.
  const readback = await w.api.run(w.runs[0].uid);
  assert.equal(judge(plan, { status: 'complete' }, { ...readback, run: { ...readback.run, status: 'partial' } }).complete, false);
});

test('a withheld column, a contact value and a record about a person are in no request', async () => {
  const { plan } = await prepared();
  const w = stubWorker();
  const clock = fakeClock();
  await createRun({ plan, transport: w.api, clock }).apply();
  const everything = JSON.stringify(w.log);
  assert.ok(everything.includes(MARK), 'permitted values do travel, in chunk bodies');
  assert.ok(!everything.includes(CONTACT), 'no contact value');
  assert.ok(!everything.includes(PERSON), 'no record about a person');
  for (const l of w.log.filter((x) => x.op === 'chunk')) {
    for (const r of l.body.records) assert.ok(r.cells.every(([c]) => !c.startsWith('contact_')), 'no contact column, even blank');
  }
  assert.ok(w.log.every((l) => !l.path.includes(MARK) && !/[?&](?!offset=)/.test(l.path)), 'no value in an address');
});

test('a 429 is waited out and the run completes under the same key, with no chunk sent under a new one', async () => {
  const { plan } = await prepared();
  const w = stubWorker({ faults: {
    open: (n) => (n === 1 ? refusal(429, 'rate_limited') : null),
    chunk: (i, n) => (i === 10 && n === 1 ? refusal(429, 'rate_limited') : null),
  } });
  const clock = fakeClock();
  const phases = [];
  const s = await createRun({ plan, transport: paced(w.api, clock), clock, onChange: (x) => phases.push(x.phase) }).apply();
  assert.equal(s.phase, 'complete');
  assert.ok(phases.includes('waiting'));
  assert.ok(!phases.includes('failed') && !phases.includes('uncertain'));
  const opens = w.log.filter((l) => l.op === 'open');
  assert.equal(opens.length, 2);
  assert.equal(new Set(opens.map((o) => o.body.idempotency_key)).size, 1, 'the resend uses the same key');
  assert.equal(w.runs.length, 1, 'one run on the Worker');
  assert.equal(w.log.filter((l) => l.op === 'chunk' && l.body.chunk_index === 10).length, 2);
});

test('a lapsed step-up is a wait: nothing fails, and the same chunk is sent again once confirmed', async () => {
  const { plan } = await prepared();
  const w = stubWorker({ faults: { chunk: (i, n) => (i === 20 && n === 1 ? refusal(403, 'step_up_required') : null) } });
  let asked = 0;
  const phases = [];
  const s = await createRun({ plan, transport: w.api, clock: fakeClock(), confirmStepUp: async () => { asked += 1; }, onChange: (x) => phases.push(x.phase) }).apply();
  assert.equal(asked, 1);
  assert.ok(phases.includes('step_up'));
  assert.equal(s.phase, 'complete');
});

test('a transport failure mid-run ends Outcome uncertain, and Reconcile completes it', async () => {
  const { plan } = await prepared();
  // The Worker stores chunk 12 but its answer never arrives.
  const w = stubWorker({ faults: { lostAnswer: (i, n) => i === 12 && n === 1 } });
  const clock = fakeClock();
  const run = createRun({ plan, transport: w.api, clock });
  const s = await run.apply();
  assert.equal(s.phase, 'uncertain');
  assert.deepEqual(s.unconfirmed, [12]);
  assert.equal(w.log.filter((l) => l.op === 'seal').length, 0);
  const r = await run.reconcile();
  assert.equal(r.phase, 'complete', r.sentence);
  // Reconcile asked which chunks the Worker holds and did not send chunk 12 (held) again.
  assert.equal(w.log.filter((l) => l.op === 'chunk' && l.body.chunk_index === 12).length, 1);
  assert.equal(w.log.filter((l) => l.op === 'chunk').length, 44);
});

test('a stopped run resumes from the Worker\'s run record and sends only what the Worker does not hold', async () => {
  const { plan } = await prepared();
  const w = stubWorker();
  const clock = fakeClock();
  let run;
  let stopAt = 0;
  run = createRun({ plan, transport: w.api, clock, onChange: (x) => { if (x.chunks_done === 17 && !stopAt) { stopAt = 17; run.stop(); } } });
  const first = await run.apply();
  assert.equal(first.phase, 'stopped');
  const sentBefore = w.log.filter((l) => l.op === 'chunk').map((l) => l.body.chunk_index);
  assert.equal(sentBefore.length, 17);
  // A new visit: nothing kept but what the Worker holds for this file's digest.
  const again = createRun({ plan, transport: w.api, clock });
  const s = await again.apply();
  assert.equal(s.phase, 'complete');
  const sentAfter = w.log.filter((l) => l.op === 'chunk').map((l) => l.body.chunk_index).slice(17);
  assert.equal(sentAfter.length, 27);
  assert.ok(sentAfter.every((i) => !sentBefore.includes(i)));
  assert.equal(w.log.filter((l) => l.op === 'open').length, 1, 'the resume opens no second run');
});

test('the same file again previews every record unchanged', async () => {
  const { plan } = await prepared();
  const w = stubWorker();
  const clock = fakeClock();
  await createRun({ plan, transport: w.api, clock }).apply();
  const s = await createRun({ plan, transport: w.api, clock }).preview();
  assert.equal(s.preview.all_unchanged, true);
  assert.equal(s.preview.sources.reduce((a, x) => a + x.unchanged, 0), 2188);
});

test('a 403 ends in the refused state, and an open run for another file blocks a new one', async () => {
  const { plan } = await prepared();
  const w = stubWorker({ faults: { runs: () => refusal(403, 'super_admin_required') } });
  const s = await createRun({ plan, transport: w.api, clock: fakeClock() }).apply();
  assert.equal(s.phase, 'refused');
  assert.deepEqual(w.log.map((l) => l.op), ['runs']);

  const other = stubWorker();
  const otherPlan = { ...plan, sha256: 'a'.repeat(64) };
  const stopper = createRun({ plan: otherPlan, transport: other.api, clock: fakeClock(), onChange: (x) => { if (x.chunks_done === 1) stopper.stop(); } });
  await stopper.apply();
  const blocked = await createRun({ plan, transport: other.api, clock: fakeClock() }).apply();
  assert.equal(blocked.phase, 'blocked');
  assert.equal(blocked.blocking_run.uid, other.runs[0].uid);
  assert.equal(other.log.filter((l) => l.op === 'open').length, 1);
});

test('a refused first chunk writes nothing and ends Failed, the run closed so it blocks nothing', async () => {
  const { plan } = await prepared();
  const w = stubWorker({ faults: { chunk: (i) => (i === 0 ? refusal(422, 'body_hash_mismatch', { records: [{ provider_record_id: `x ${MARK}` }] }) : null) } });
  const s = await createRun({ plan, transport: w.api, clock: fakeClock() }).apply();
  assert.equal(s.phase, 'failed');
  assert.equal(s.sentence, refusalSentence({ code: 'body_hash_mismatch' }));
  assert.equal(w.runs[0].status, 'failed');
  assert.ok(!JSON.stringify(s).includes(MARK));
});

/* ------------------------------------------------------------------ private data */

test('the planted marker appears in no console call, report, storage write, address or thrown message', async () => {
  const seen = { console: [], report: [], storage: [], thrown: [] };
  const original = { ...console };
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => { seen.console.push(a); };
  const storage = () => ({ setItem: (...a) => seen.storage.push(a), getItem: () => null, removeItem: () => {}, clear: () => {} });
  const had = { local: globalThis.localStorage, session: globalThis.sessionStorage };
  Object.defineProperty(globalThis, 'localStorage', { value: storage(), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage(), configurable: true, writable: true });
  try {
    const { doc, plan } = await prepared();
    const w = stubWorker({ faults: {
      chunk: (i, n) => (i === 3 && n === 1 ? refusal(429, 'rate_limited') : i === 30 && n === 1 ? Object.assign(new Error(`boom ${MARK}`), { status: 500 }) : null),
    } });
    const report = (...a) => seen.report.push(a);
    const run = createRun({ plan, transport: w.api, clock: fakeClock(), report });
    const states = [];
    const r1 = await run.apply();
    states.push(r1);
    states.push(await run.reconcile());
    // Broken files of every kind.
    const bad = [];
    const short = structuredClone(doc); short.records.pop(); bad.push(bytesOf(short));
    const stray = structuredClone(doc); stray.records[1].cells[0][1] = '\uD800'; bad.push(bytesOf(stray));
    bad.push(new TextEncoder().encode(`[{"x": "${MARK}" ${CONTACT}`));
    for (const b of bad) { try { await readPackage(b); } catch (e) { seen.thrown.push(e.message, String(e.stack ?? '')); } }
    // A transport throwing a value-bearing error: the run's own state never carries it.
    const leaky = stubWorker({ faults: { seal: () => Object.assign(new Error(`seal ${MARK}`), { status: 400, code: `bad ${MARK}` }) } });
    states.push(await createRun({ plan, transport: leaky.api, clock: fakeClock(), report }).apply());
    const outside = JSON.stringify({ seen, states, addresses: [...w.log, ...leaky.log].map((l) => l.path) });
    for (const m of [MARK, CONTACT, PERSON]) assert.ok(!outside.includes(m), `${m} leaked`);
    assert.equal(seen.storage.length, 0);
    assert.equal(seen.console.length, 0);
    assert.ok(seen.thrown.length >= 3);
  } finally {
    Object.assign(console, original);
    Object.defineProperty(globalThis, 'localStorage', { value: had.local, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: had.session, configurable: true, writable: true });
  }
});

const pageFiles = () => readdirSync(resolve(ROOT, 'frontend/src/pages/research/imports')).filter((f) => /\.(jsx?|mjs)$/.test(f))
  .map((f) => [f, readFileSync(resolve(ROOT, 'frontend/src/pages/research/imports', f), 'utf8')]);

test('the console\'s source writes to no storage and puts nothing from the file in an address', () => {
  const files = pageFiles();
  assert.ok(files.length >= 3);
  for (const [f, src] of files) {
    assert.doesNotMatch(src, /\b(?:localStorage|sessionStorage|indexedDB|caches)\s*[.[]|\.setItem\(|history\.(?:push|replace)State/, `${f} writes to storage`);
    assert.doesNotMatch(src, /e\.message|err\.message|error\.message/, `${f} prints an error's own message`);
    assert.doesNotMatch(src, /console\./, `${f} logs to the console`);
  }
  const api = readFileSync(resolve(ROOT, 'frontend/src/lib/api/researchSourceImports.js'), 'utf8');
  // The only things in a path are the Worker's run id and a page offset.
  for (const m of api.matchAll(/request\(`([^`]+)`/g)) assert.match(m[1], /^\/research-source-imports\/runs\/\$\{encodeURIComponent\(uid\)\}(\$\{pageOf\(offset\)\}|\/[a-z]+)$/);
});

test('the route area is lazy, Super Admin only on HQ, and an admin without the elevation gets the existing notice', () => {
  const routes = readFileSync(resolve(ROOT, 'frontend/src/routes/researchSourceImports.jsx'), 'utf8');
  const lines = [...routes.matchAll(/<Route path="([^"]+)" element=\{([^\n]+)\} \/>/g)];
  assert.deepEqual(lines.map((m) => m[1]), ['/research/source-imports', '/research/source-imports/runs/:uid']);
  for (const m of lines) assert.match(m[2], /^guard\(\['admin'\], hqOnly\(<[A-Za-z]+ \/>\)\)$/);
  assert.doesNotMatch(routes, /^import [A-Za-z]+ from '\.\.\/pages/m, 'pages are lazy');
  // hqOnly draws the existing SuperAdminOnlyNotice, so the page never mounts and makes no request.
  const app = readFileSync(resolve(ROOT, 'frontend/src/App.jsx'), 'utf8');
  assert.match(app, /const hqOnly = \(component\) => \(\s*isSuperAdminUser\(user\) \? component : <SuperAdminOnlyNotice \/>/);
  // A 403 at runtime draws the same notice.
  const page = readFileSync(resolve(ROOT, 'frontend/src/pages/research/imports/SourceImportsPage.jsx'), 'utf8');
  assert.match(page, /SuperAdminOnlyNotice/);
  // The door: one Super Admin only line beside the Sheets card.
  const zone = readFileSync(resolve(ROOT, 'frontend/src/pages/research/FundsZone.jsx'), 'utf8');
  const door = zone.split('\n').filter((l) => l.includes('/research/source-imports'));
  assert.equal(door.length, 1);
  assert.match(door[0], /canSyncSheets \?/);
});

test('removal asks for the typed word the board draws', () => {
  assert.equal(removalWord('source', 'invented_funds'), 'remove source invented_funds');
  assert.equal(removalWord('record', 'invented_funds'), 'remove');
  assert.equal(removalWord('private_fields', 'invented_funds'), 'remove');
});

test('both pages draw their first frame: the gate marks, the crumb and a skeleton, never a zero or an empty list', () => {
  const h = React.createElement;
  const list = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/research/source-imports'] }, h(SourceImportsPage)));
  assert.match(list, /Source imports/);
  assert.match(list, /Super admin only/);
  assert.match(list, /HQ only/);
  assert.match(list, /Choose a file/);
  assert.match(list, /Loading runs/);
  assert.doesNotMatch(list, /Nothing is staged yet/);
  const one = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/research/source-imports/runs/00000000-0000-4000-8000-000000000001'] },
    h(Routes, null, h(Route, { path: '/research/source-imports/runs/:uid', element: h(SourceImportRun) }))));
  assert.match(one, /Run 00000000/);
  assert.match(one, /Counts only: no record content on this page/);
  assert.match(one, /Loading the run/);
});

test('a lone surrogate is caught without a regex lookbehind (Safari before 16.4 cannot parse one)', () => {
  // Mutation checked: the low-surrogate branch removed, and a high surrogate accepted without its pair.
  for (const ok of ['', 'plain', 'caf\u00e9', '\uD83D\uDE00', 'a\uD83D\uDE00b\uD83D\uDE00']) assert.equal(hasLoneSurrogate(ok), false, JSON.stringify(ok));
  for (const bad of ['\uD800', 'x\uD800', '\uD800x', '\uDC00', 'x\uDC00y', '\uDE00\uD83D', '\uD83D\uD83D\uDE00']) assert.equal(hasLoneSurrogate(bad), true, JSON.stringify(bad));
});
