/**
 * #4688 — Offers audit 3/6: first-use creation and failed saves, MOUNTED.
 *
 * The earlier Offers tests read the source with a regex. These mount the three
 * zones (Visibility, Proof, Audience fit) on a synthetic document with the
 * network stubbed, and drive what a partner does: click the empty-state action,
 * type, save, watch the save fail, retry, reopen.
 *
 * What is proved, for all three zones:
 *   1. An EMPTY store can create its first record from the visible empty-state
 *      action, and reopening the editor afterwards shows blank fields.
 *   2. A refused save (validation, 401/403, conflict, network, 5xx) keeps the
 *      editor open and every field filled, shows the error inside the editor,
 *      and Retry repeats the same write without retyping; the success then
 *      closes the editor and the error is gone.
 *   3. A write that persisted but whose refresh failed says it saved, offers no
 *      second write, and a later successful read clears that note.
 *   4. An unreadable list says so (never "empty") and a successful retry clears it.
 *   5. A row editor behaves the same way on a failed save.
 *
 * The last test breaks the source in twelve ways and requires a journey to fail
 * each time, so the journeys cannot pass vacuously.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadZone, mountZone, stubApi, httpError } from './_offers_4688.mjs';

const ZONES = {
  visibility: {
    file: 'VisibilityZone.jsx',
    empty: 'No surface is recorded yet',
    emptyAction: 'Add a surface', headerAction: 'Add a surface',
    editorId: 'surface-editor', submit: 'Add surface',
    fill: { Name: 'Axal directory' }, shown: 'Axal directory',
    createApi: 'createPartnerSurface', updateApi: 'updatePartnerSurface',
    edit: { field: 'Name', value: 'Axal directory 2', save: 'Save' },
    row: (p, id) => ({ id, name: p.name, kind: p.kind, is_active: 1, engagement_count: 0, won_value: 0, views_note: 'n' }),
    reads: (rows) => ({
      getPartnerVisibility: async () => ({ items: rows(), engagement_total: 0, unattributed_count: 0 }),
      listPartnerAttribution: async () => ({ items: [] }),
    }),
  },
  proof: {
    file: 'ProofZone.jsx',
    empty: 'No proof is recorded yet',
    emptyAction: 'Add a case study', headerAction: 'Add an item',
    editorId: 'proof-editor', submit: 'Add item',
    fill: { Title: 'Seed round for a fintech' }, shown: 'Seed round for a fintech',
    createApi: 'createPartnerProof', updateApi: 'updatePartnerProof',
    edit: { field: 'Title', value: 'Seed round, revised', save: 'Save' },
    row: (p, id) => ({ id, title: p.title, kind: p.kind, detail: p.detail || '', outcome_note: null, is_published: 0, consents: [] }),
    reads: (rows) => ({ listPartnerProof: async () => ({ items: rows(), published_count: 0 }) }),
  },
  fit: {
    file: 'AudienceFitZone.jsx',
    empty: 'No fit rule is recorded yet',
    emptyAction: 'Write the first rule', headerAction: 'Add a rule',
    editorId: 'rule-editor', submit: 'Add rule',
    fill: { 'What it is about': 'Pre-seed fintech', 'The sentence a pass quotes': 'We start at seed.' }, shown: 'Pre-seed fintech',
    createApi: 'createPartnerFitRule', updateApi: 'updatePartnerFitRule',
    edit: { field: 'The sentence a pass quotes', value: 'We start at Series A.', save: 'Save rule' },
    row: (p, id) => ({ id, kind: p.kind, value: p.value, statement: p.statement, is_active: 1, floor_cents: null, signal: null, referred_to: null }),
    reads: (rows) => ({ listPartnerFitRules: async () => ({ items: rows(), unstated_count: 0 }) }),
  },
};

/** A store behind the stubbed API: rows, call logs, and switches a test flips. */
function store(cfg) {
  const s = {
    rows: [], creates: [], updates: [], readFails: 0, createFails: [], updateFails: [],
    stub() {
      const reads = cfg.reads(() => {
        if (s.readFails > 0) { s.readFails -= 1; throw httpError(503, 'The store is unavailable'); }
        return s.rows;
      });
      return stubApi({
        ...reads,
        [cfg.createApi]: async (payload) => {
          s.creates.push(JSON.parse(JSON.stringify(payload)));
          const fail = s.createFails.shift();
          if (fail) throw fail;
          s.rows.push(cfg.row(payload, s.rows.length + 1));
          return {};
        },
        [cfg.updateApi]: async (id, payload) => {
          s.updates.push([id, JSON.parse(JSON.stringify(payload))]);
          const fail = s.updateFails.shift();
          if (fail) throw fail;
          const at = s.rows.findIndex((r) => r.id === id);
          s.rows[at] = { ...s.rows[at], ...payload };
          return {};
        },
      });
    },
  };
  return s;
}

async function withZone(cfg, Zone, fn, setup = () => {}) {
  const s = store(cfg);
  setup(s);
  const restore = s.stub();
  const m = await mountZone(Zone);
  try { await m.flush(); await fn(m, s); } finally { await m.unmount(); restore(); }
}

const fillAll = async (cfg, m) => { for (const [label, v] of Object.entries(cfg.fill)) await m.fill(label, v); };
const typed = (cfg, m) => Object.keys(cfg.fill).map((label) => m.value(label));

// ---- the journeys, each taking a loaded zone module ------------------------

const journeys = {
  async createFirstThenReopen(cfg, Zone) {
    await withZone(cfg, Zone, async (m, s) => {
      assert.ok(m.text().includes(cfg.empty), 'a store that was read and is empty says so');
      assert.ok(!m.editor(cfg.editorId), 'no editor before the partner asks for one');
      await m.click(cfg.emptyAction);
      assert.ok(m.editor(cfg.editorId), 'the empty-state action mounts the editor');
      await fillAll(cfg, m);
      await m.click(cfg.submit);
      await m.flush();
      assert.equal(s.creates.length, 1, 'exactly one write');
      assert.ok(!m.editor(cfg.editorId), 'the editor closes after persistence');
      assert.ok(m.text().includes(cfg.shown), 'the new record is listed');
      await m.click(cfg.headerAction);
      assert.ok(m.editor(cfg.editorId), 'the editor reopens');
      assert.deepEqual(typed(cfg, m), Object.keys(cfg.fill).map(() => ''), 'reopened fields are blank');
      assert.ok(!m.textIn(cfg.editorId).includes('Retry'), 'no stale error on reopen');
    });
  },

  async failedSaveRetainsThenRetrySucceeds(cfg, Zone) {
    const failures = [
      httpError(400, 'Name is required'),
      httpError(403, 'Your account cannot write here'),
      httpError(409, 'That already exists'),
      new TypeError('Failed to fetch'),
      httpError(500, 'Internal error'),
    ];
    for (const failure of failures) {
      await withZone(cfg, Zone, async (m, s) => {
        await m.click(cfg.emptyAction);
        await fillAll(cfg, m);
        const entered = typed(cfg, m);
        await m.click(cfg.submit);
        await m.flush();
        assert.equal(s.creates.length, 1);
        assert.ok(m.editor(cfg.editorId), `${failure.message}: the editor stays open`);
        assert.deepEqual(typed(cfg, m), entered, `${failure.message}: every field is kept`);
        assert.ok(m.textIn(cfg.editorId).includes(failure.message), `${failure.message}: the error is shown beside the form`);
        assert.ok(m.has('Retry'), 'Retry is offered');
        assert.equal(s.rows.length, 0, 'nothing persisted');
        await m.click('Retry');
        await m.flush();
        assert.equal(s.creates.length, 2, 'Retry performs the write again');
        assert.deepEqual(s.creates[1], s.creates[0], 'the same write, without retyping');
        assert.ok(!m.editor(cfg.editorId), 'the success closes the editor');
        assert.ok(!m.has('Retry'), 'the error is gone');
        assert.ok(!m.text().includes(failure.message), 'no stale error text');
        assert.ok(m.text().includes(cfg.shown), 'the record is listed');
        assert.equal(s.rows.length, 1, 'persisted once');
      }, (s) => { s.createFails.push(failure); });
    }
  },

  async savedButRefreshFailedDoesNotInviteAWriteTwice(cfg, Zone) {
    await withZone(cfg, Zone, async (m, s) => {
      await m.click(cfg.emptyAction);
      await fillAll(cfg, m);
      s.readFails = 1; // the write works; the read after it does not
      await m.click(cfg.submit);
      await m.flush();
      assert.equal(s.creates.length, 1);
      assert.equal(s.rows.length, 1, 'it persisted');
      const t = m.text();
      assert.ok(/could not be refreshed/i.test(t), 'says the refresh failed');
      assert.ok(/not.*(added|saved)|nothing needs to be done again/i.test(t) || /Nothing needs to be done again/.test(t), 'says nothing needs doing again');
      assert.ok(!/did not save/i.test(t), 'it is not reported as a failed write');
      assert.ok(!m.has('Retry') && !m.has(cfg.submit), 'no second write is offered');
      assert.ok(!t.includes(cfg.empty), 'an unreadable list is not "empty"');
      assert.ok(m.has('Reload the list'), 'a reload of the read is offered');
      await m.click('Reload the list');
      await m.flush();
      assert.equal(s.creates.length, 1, 'reloading wrote nothing');
      assert.ok(!/could not be refreshed/i.test(m.text()), 'a good read clears the note');
      assert.ok(m.text().includes(cfg.shown));
    });
  },

  async unreadableThenRetryClearsIt(cfg, Zone) {
    await withZone(cfg, Zone, async (m) => {
      const t = m.text();
      assert.ok(t.includes('This did not load'), 'an unreadable store says unreadable');
      assert.ok(!t.includes(cfg.empty), 'and never claims to be empty');
      assert.ok(!m.has(cfg.emptyAction), 'no first-record action over a store that was not read');
      await m.click('Try again');
      await m.flush();
      assert.ok(!m.text().includes('This did not load'), 'a successful retry clears the error');
      assert.ok(m.text().includes(cfg.empty), 'now it can say empty, because it read it');
    }, (s) => { s.readFails = 1; });
  },

  async savedRefreshFailureIsClearedByTheListsOwnRetry(cfg, Zone) {
    await withZone(cfg, Zone, async (m, s) => {
      await m.click(cfg.emptyAction);
      await fillAll(cfg, m);
      s.readFails = 1;
      await m.click(cfg.submit);
      await m.flush();
      assert.ok(/could not be refreshed/i.test(m.text()));
      await m.click('Try again');
      await m.flush();
      assert.ok(!/could not be refreshed/i.test(m.text()), 'the stale note does not outlive a good read');
      assert.equal(s.creates.length, 1);
    });
  },

  async rowEditFailureKeepsTheEditor(cfg, Zone) {
    await withZone(cfg, Zone, async (m, s) => {
      assert.ok(m.text().includes(cfg.shown));
      await m.click('Edit');
      await m.fill(cfg.edit.field, cfg.edit.value);
      await m.click(cfg.edit.save);
      await m.flush();
      assert.equal(s.updates.length, 1);
      assert.equal(m.value(cfg.edit.field), cfg.edit.value, 'the edit is kept');
      assert.ok(m.has(cfg.edit.save), 'the row editor stays open');
      assert.ok(m.text().includes('Server error'), 'the error is shown');
      await m.click('Retry');
      await m.flush();
      assert.equal(s.updates.length, 2);
      assert.deepEqual(s.updates[1], s.updates[0], 'the same write');
      assert.ok(!m.has(cfg.edit.save), 'closed after the success');
      assert.ok(!m.text().includes('Server error'));
    }, (s) => {
      s.rows.push(cfg.row({
        name: 'Axal directory', kind: 'directory', title: 'Seed round for a fintech', detail: '',
        value: 'Pre-seed fintech', statement: 'We start at seed.',
      }, 1));
      s.updateFails.push(httpError(500, 'Server error'));
    });
  },
};

for (const [name, cfg] of Object.entries(ZONES)) {
  for (const [jname, journey] of Object.entries(journeys)) {
    test(`${name}: ${jname}`, async () => { await journey(cfg, await loadZone(cfg.file)); });
  }
}

// ---- mutation check: break the source, a journey must fail -------------------

const HOOK_MUTATIONS = {
  'helper swallows the error': [['await write();', 'await write().catch(() => {});']],
  'success cleanup runs on failure': [['      setBusy(false);\n      return { ok: false };', '      onSaved?.();\n      setBusy(false);\n      return { ok: false };']],
  'cleanup runs before persistence is confirmed': [['    try {\n      await write();', '    try { onSaved?.(); } catch { /* x */ }\n    try {\n      await write();']],
  'retry is not retained': [['retry: () => save(write, opts),', 'retry: undefined,']],
  'retry performs a different write': [['retry: () => save(write, opts),', 'retry: () => save(async () => {}, opts),']],
  'retry skips the success cleanup': [['retry: () => save(write, opts),', 'retry: () => save(write, { ...opts, onSaved: undefined }),']],
  'stale refresh note is not cleared by a good read': [['if (ok) setNote((n) => (n?.refreshFailed ? null : n));', 'void ok;']],
  'refresh failure is treated as a write failure (duplicate write invited)': [[
    'const refreshed = await loadRef.current();',
    "const refreshed = await loadRef.current();\n    if (!refreshed) { setNote({ ok: false, scope, text: 'That did not save.', retry: () => save(write, opts) }); setBusy(false); return { ok: false }; }",
  ]],
  'the error is not shown beside the form': [['export const scopedNote = (note, scope) => (note &&', 'export const scopedNote = (note, scope) => (false && note &&']],
};
const mutation = (cfg) => ({
  'the editor sits behind the list (needs an existing row)': { zone: [['{adding && (\n        <div className="mb-6', '{adding && items.length > 0 && (\n        <div className="mb-6']] },
  'the draft is dropped when a save fails': {
    visibility: { zone: [["() => api.createPartnerSurface(newSurface), 'Surface added.'", "() => { const d = newSurface; setNewSurface({ name: '', kind: 'directory' }); return api.createPartnerSurface(d); }, 'Surface added.'"]] },
    proof: { zone: [["() => api.createPartnerProof(newItem), 'Added.'", "() => { const d = newItem; setNewItem({ title: '', kind: 'case_study', detail: '', outcome_note: '' }); return api.createPartnerProof(d); }, 'Added.'"]] },
    fit: { zone: [['<RuleForm\n            busy={busy}', '<RuleForm\n            key={note ? "n" : "x"}\n            busy={busy}']] },
  }[cfg.name],
  ...Object.fromEntries(Object.entries(HOOK_MUTATIONS).map(([k, v]) => [k, { hook: v }])),
});

test('mutation check: every guarded behaviour fails a mounted journey when broken', async () => {
  const report = [];
  for (const [name, cfg] of Object.entries(ZONES)) {
    for (const [label, mut] of Object.entries(mutation({ ...cfg, name }))) {
      const Zone = await loadZone(cfg.file, mut);
      let failed = null;
      for (const [jname, journey] of Object.entries(journeys)) {
        try { await journey(cfg, Zone); } catch (e) { failed = `${jname}: ${e.message.split('\n')[0]}`; break; }
      }
      assert.ok(failed, `${name}: breaking "${label}" must fail a journey`);
      report.push(`${name} | ${label} -> ${failed}`);
    }
  }
  assert.ok(report.length >= 8 * 3, `ran ${report.length} mutations`);
  if (process.env.SHOW_MUTATIONS) console.log(report.join('\n'));
});
