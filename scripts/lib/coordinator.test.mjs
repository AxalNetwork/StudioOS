// #6312: the coordinator's label, slot, staleness, marker, delta and digest rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentPulls } from '../coordinator.mjs';
import {
  planLabels, slotOf, isStandardSlotLabel, slotPicker, slotLoad, classifyProposal, proposalLabels,
  marker, parseMarkers, alreadyDone, staleReasons, renderNote, planFromFindings, deltaSelect,
  landedName, parseDigests, compareDigests, boardsOf,
  prRelationships, claimEvidence, lifecycleSuggestion, verifiedClosure, applyReviewedItem,
} from './coordinator.mjs';

test('planLabels swaps the state, keeps one slot, and reports what changed', () => {
  const r = planLabels(['task', 'slot:S01', 'state:ready'], { state: 'state:blocked', add: ['needs-decision'], slot: 'S07' });
  assert.deepEqual(r.labels.sort(), ['needs-decision', 'slot:S07', 'state:blocked', 'task']);
  assert.deepEqual(r.added.sort(), ['needs-decision', 'slot:S07', 'state:blocked']);
  assert.deepEqual(r.removed.sort(), ['slot:S01', 'state:ready']);
});

test('planLabels folds a lower-case slot label into the standard one', () => {
  assert.deepEqual(planLabels(['slot:s39', 'state:ready'], { slot: 'S12' }).labels.sort(), ['slot:S12', 'state:ready']);
});

test('planLabels refuses what AGENTS.md does not allow', () => {
  assert.throws(() => planLabels(['state:blocked'], { state: 'state:ready', add: ['needs-decision'] }), /needs-decision needs state:blocked/);
  assert.throws(() => planLabels(['state:blocked', 'needs-design'], { remove: ['state:blocked'] }), /no state label/);
  assert.throws(() => planLabels(['needs-decision'], {}), /needs-decision needs state:blocked, not no state label/);
  assert.throws(() => planLabels([], { slot: 'S40' }), /non-standard slot/);
  assert.throws(() => planLabels([], { state: 'state:in-review' }), /unknown state/);
  assert.throws(() => planLabels(['state:ready', 'state:review'], {}), /two state labels/);
});

test('moving to a state other than blocked drops the needs-* flags', () => {
  const r = planLabels(['state:blocked', 'needs-design', 'needs-decision'], { state: 'state:ready' });
  assert.deepEqual(r.labels, ['state:ready']);
  assert.deepEqual(r.removed.sort(), ['needs-decision', 'needs-design', 'state:blocked']);
});

test('slot moves: never into S18 or S32, S01 only for coordinator work, never an active claim', () => {
  assert.throws(() => planLabels(['slot:S05'], { slot: 'S18' }), /S18 takes no moved work/);
  assert.throws(() => planLabels(['slot:S05'], { slot: 'slot:s32' }), /S32/);
  assert.throws(() => planLabels(['slot:S05'], { slot: 'S01' }, { kind: 'task' }), /only trackers/);
  assert.deepEqual(planLabels(['slot:S05'], { slot: 'S01' }, { kind: 'tracker' }).labels, ['slot:S01']);
  assert.throws(() => planLabels(['slot:S05', 'state:in-progress'], { slot: 'S07' }, { activeClaim: true }), /active claim/);
  assert.equal(planLabels(['slot:S18'], { slot: 'S18' }).changed, false);
});

test('planLabels with no change reports none', () => {
  assert.equal(planLabels(['task', 'state:ready'], {}).changed, false);
  assert.equal(planLabels(['task', 'state:ready'], { state: 'state:ready' }).changed, false);
});

test('slot labels: only S01 to S39 in upper case are standard; the admin slot is not a build slot', () => {
  assert.equal(slotOf('slot:s38'), 'S38');
  assert.equal(slotOf('state:ready'), null);
  assert.equal(slotOf('slot:chatgptpro'), null);
  assert.equal(isStandardSlotLabel('slot:S37'), true);
  assert.equal(isStandardSlotLabel('slot:S39'), true);
  assert.equal(isStandardSlotLabel('slot:S40'), false);
  assert.equal(isStandardSlotLabel('slot:chatgptpro'), false);
  assert.equal(isStandardSlotLabel('slot:s05'), false);
});

test('slotPicker never picks S01, S18 or S32 and spreads a batch over the least loaded', () => {
  const load = {};
  for (let n = 1; n <= 39; n++) load[`S${String(n).padStart(2, '0')}`] = 5;
  load.S04 = 1; load.S09 = 2;
  const pick = slotPicker(load);
  const got = Array.from({ length: 6 }, pick);
  assert.deepEqual(got.slice(0, 5), ['S04', 'S04', 'S09', 'S04', 'S09']);
  for (const s of Array.from({ length: 200 }, pick)) assert.ok(!['S01', 'S18', 'S32'].includes(s));
});

test('slotLoad counts lower-case labels under their standard slot', () => {
  assert.deepEqual(slotLoad([{ labels: [{ name: 'slot:s39' }] }, { labels: ['slot:S39', 'task'] }]), { S39: 2 });
});

test('a proposal is a build task, a brief or a decision, and is labelled to match', () => {
  assert.equal(classifyProposal({ type: 'design-brief', title: 'x' }), 'brief');
  assert.equal(classifyProposal({ type: 'frontend', title: 'Claude Design brief: Grow Markets' }), 'brief');
  assert.equal(classifyProposal({ type: 'frontend', title: 'Owner decision: watermark' }), 'decision');
  assert.deepEqual(proposalLabels({ type: 'design-brief', title: 'b' }, {}).labels, ['task', 'slot:S01', 'state:blocked', 'needs-design']);
  assert.deepEqual(proposalLabels({ type: 'full-stack', title: 'b' }, { slot: 'S07', ready: true }).labels, ['task', 'frontend', 'worker', 'slot:S07', 'state:ready']);
  assert.deepEqual(proposalLabels({ type: 'worker', title: 'b' }, { slot: 'S07', ready: false }).labels, ['task', 'worker', 'slot:S07', 'state:blocked']);
  assert.throws(() => proposalLabels({ type: 'worker', title: 'b' }, { slot: 'S40' }), /standard slot/);
  assert.throws(() => proposalLabels({ type: 'worker', title: 'b' }, { slot: 'chatgptpro' }), /standard slot/);
});

test('markers round-trip, and alreadyDone finds this run only', () => {
  const m = marker('2026-11-14a', 'file', 'sec:founder-grow-a:3');
  assert.deepEqual(parseMarkers(`text\n${m}`), [{ version: 'v1', run: '2026-11-14a', kind: 'file', key: 'sec:founder-grow-a:3' }]);
  assert.equal(alreadyDone([`x ${m}`], '2026-11-14a', 'file', 'sec:founder-grow-a:3'), true);
  assert.equal(alreadyDone([`x ${m}`], '2026-11-21a', 'file', 'sec:founder-grow-a:3'), false);
  assert.throws(() => marker('bad run id!', 'note'), /run id/);
});

test('staleReasons ignores this run\'s own comments and nothing else', () => {
  const snap = { state: 'open', title: 'T', body: 'b', labels: ['a', 'b'] };
  const own = { body: `note ${marker('r1', 'note')}` };
  assert.deepEqual(staleReasons(snap, { ...snap, labels: ['b', 'a'] }, [own], 'r1'), []);
  assert.deepEqual(staleReasons(snap, { ...snap, state: 'closed', body: 'c', labels: ['a'] }, [own, { body: 'a slot STATUS' }], 'r1'),
    ['closed since the snapshot', 'body edited', 'labels changed', '1 new comment(s)']);
});

test('the status note starts with S1: and ends with the marker', () => {
  const body = renderNote({ verdict: 'release_to_ready', evidence: 'E', remaining_work: 'R' }, { runId: 'r1', mainSha: 'abcdef1234567', date: '2026-11-14', labelText: 'added `state:ready`.' });
  assert.match(body, /^S1: coordinator audit, 2026-11-14\. Checked against main `abcdef1234`/);
  assert.match(body, /\*\*Labels changed:\*\* added `state:ready`\./);
  assert.ok(body.endsWith(marker('r1', 'note')));
  const sup = renderNote({ verdict: 'close_superseded' }, { runId: 'r1', mainSha: 'a', date: 'd', closing: 'not_planned' });
  assert.match(sup, /Closing as not planned \(superseded\)/);
  assert.doesNotMatch(sup, /Closing as completed/);
  assert.throws(() => marker(undefined, 'note'), /run id/);
  assert.throws(() => marker('--go', 'note'), /run id/);
});

test('planFromFindings closes only what the verifier allowed and drops unsupported notes', () => {
  const evidence = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(number => [number,
    { issue: { number }, facts: { claim: { state: 'absent' } } }]));
  const steps = planFromFindings([
    { number: 1, verdict: 'close_done', verification: { safe_to_close: true, note_supported: true } },
    { number: 2, verdict: 'close_done', verification: { safe_to_close: false, unfinished: 'U', label_change_ok: true, note_supported: true }, label_change: { state: 'state:ready' } },
    { number: 7, verdict: 'close_done', verification: { safe_to_close: true, note_supported: false } },
    { number: 8, verdict: 'needs_status_fix', label_change: { state: 'state:ready' }, verification: {} },
    { number: 9, verdict: 'needs_status_fix', label_change: { state: 'state:ready' }, verification: { note_supported: false, label_change_ok: true } },
    { number: 3, verdict: 'needs_status_fix', label_change: { state: 'state:blocked' }, verification: { note_supported: false, label_change_ok: false } },
    { number: 4, verdict: 'keep_as_is', verification: {} },
    { number: 5, verdict: 'split_or_rescope', remaining_work: 'old', verification: { note_supported: true, corrected: { remaining_work: 'new' } } },
    { number: 6, verdict: 'close_superseded', verification: { safe_to_close: true, note_supported: true } },
  ], { evidence, canClose: () => true });
  const st = n => steps.find(x => x.number === n);
  assert.equal(st(1).close, 'completed');
  assert.equal(st(2).close, null); assert.equal(st(2).note.unfinished, 'U'); assert.deepEqual(st(2).labelChange, { state: 'state:ready' });
  assert.equal(st(3).note, null); assert.equal(st(3).labelChange, null);
  assert.equal(st(4).note, null);
  assert.equal(st(5).note.remaining_work, 'new');
  assert.equal(st(6).close, 'not_planned');
  assert.equal(st(7).close, null, 'no close without its note');
  assert.equal(st(8).labelChange, null, 'a label change nobody verified is dropped');
  assert.equal(st(9).labelChange, null, 'a label change needs a supported note for apply and recovery');
  assert.throws(() => planFromFindings([{ number: 1, verdict: 'keep_as_is' }, { number: 1, verdict: 'keep_as_is' }]), /two findings/);
});

test('deltaSelect re-reads new issues, issues named by merged PRs, and issues with activity after their last note', () => {
  const since = '2026-11-14T00:00:00Z';
  const issues = [
    { number: 1, created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T00:00:00Z' },
    { number: 2, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
    { number: 3, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' },
    { number: 4, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-14T02:05:00Z' },
    { number: 5, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
  ];
  const got = deltaSelect({ issues, since, lastNoteAt: { 3: '2026-11-14T02:00:00Z', 4: '2026-11-14T02:00:00Z' }, mergedPrBodies: ['Closes #5'] });
  assert.deepEqual([...got.keys()].sort(), [1, 3, 5]);
});

test('partial handback #4570 stays separate from closure intent and quoted examples', () => {
  const links = prRelationships('Closes #4570 and #123. Details in #8\n\nPart of #4570\nRefs #9\nCloses https://github.com/Elsewhere/Project/issues/44\n```txt\nCloses #99\n```');
  assert.deepEqual([...links], [[4570, 'partial'], [123, 'closing'], [9, 'partial']]);
  assert.deepEqual([...prRelationships('Finish lifecycle reconciliation. Closes #8661. Refs #6312.\n`Closes #18`\n> Closes #20')],
    [[8661, 'closing'], [6312, 'partial']]);
});

test('expired claims stay held and a 403 or a label receipt cannot supply absence', () => {
  const issue = { number: 8661, labels: ['task', 'state:ready'] };
  const holder = { version: 1, issue: 8661, slot: 'S24', agent: 'Codex', session: 'test', at: '2025-11-01T00:00:00Z', ttlHours: 24 };
  assert.deepEqual(claimEvidence(8661, { ref: 'a', message: JSON.stringify(holder) }, issue, []), { state: 'held', ref: 'a', holder });
  assert.equal(claimEvidence(8661, { status: 403 }, issue, []).state, 'unknown');
  assert.equal(claimEvidence(8661, {}, issue, []).state, 'unknown');
  assert.equal(claimEvidence(8661, { status: 404 }, issue, [{ body: 'STATUS\nClaimed by label' }]).state, 'unknown');
  assert.equal(claimEvidence(8661, { status: 404 }, { ...issue, assignees: ['current-holder'] }, []).state, 'unknown');
  assert.equal(claimEvidence(8661, { status: 404 }, issue, []).state, 'absent');
  const comments = [
    { id: 17, body: 'STATUS\nClaimed by label', created_at: '2026-01-01' },
    { id: 18, body: 'Hand back this task to the coordinator.', created_at: '2026-01-02', author_association: 'OWNER', html_url: 'https://example.test/18' },
  ];
  assert.equal(claimEvidence(8661, { status: 404, handbackComment: 18 }, issue, comments).state, 'absent');
  assert.equal(claimEvidence(8661, { ref: 'a', message: JSON.stringify(holder), handbackComment: 18 }, issue, comments).state, 'held');
  assert.equal(claimEvidence(8661, { status: 404, handbackComment: 18 }, { ...issue, labels: ['state:in-progress'] }, comments).state, 'unknown');
});

test('rolling alerts and landing lists are observations, and unlabelled tasks still get triage', () => {
  const facts = { claim: { state: 'absent' }, prs: [], dependencies: [] };
  for (const body of ['<!-- studioos-landing-list:v1 -->', '<!-- studioos-scan-alert:v1 -->']) {
    assert.equal(lifecycleSuggestion({ body, labels: ['task'] }, facts).action, 'observe');
  }
  for (const labels of [['task'], ['task', 'state:review'], ['task', 'state:ready', 'state:blocked']]) {
    assert.equal(lifecycleSuggestion({ labels }, facts).action, 'triage');
  }
  assert.match(lifecycleSuggestion({ labels: ['task', 'state:ready', 'needs-design'] }, facts).reason, /design or owner gate/);
  const blocked = { labels: ['task', 'state:blocked', 'needs-design'] };
  assert.equal(lifecycleSuggestion(blocked, { ...facts, dependencies: [{ state: 'closed', url: 'https://example.test/1' }] }).action, 'verify_blockers');
  assert.equal(lifecycleSuggestion(blocked, { ...facts, claim: { state: 'held' } }).action, 'observe');
});

test('delta revisits dependents and explicit events without declaring any gate resolved', () => {
  const since = '2026-11-26T00:00:00Z';
  const quiet = { created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
  const issues = [1, 2, 3].map(number => ({ ...quiet, number }));
  const pick = deltaSelect({ issues, since, lastNoteAt: {}, changedDependencies: new Map([[1, 34]]), eventIssues: [2] });
  assert.deepEqual([...pick], [[1, 'dependency #34 changed'], [2, 'event concerns this issue']]);
});

test('a busy or unreadable PR feed keeps verified rows and identifies incomplete evidence', () => {
  const since = '2026-11-26T00:00:00Z';
  const pull = { updated_at: '2026-11-26T01:00:00Z', merged_at: '2026-11-26T01:00:00Z' };
  const page = Array.from({ length: 100 }, () => pull);
  const capped = recentPulls(since, () => page);
  assert.equal(capped.rows.length, 1000);
  assert.match(capped.incomplete, /page cap/);
  const interrupted = recentPulls(since, path => {
    if (path.endsWith('&page=1')) return page;
    throw new Error('read failed');
  });
  assert.equal(interrupted.rows.length, 100);
  assert.match(interrupted.incomplete, /could not be read/);
  assert.deepEqual(recentPulls(since, () => [pull]), { rows: [pull], incomplete: null });
});

test('topic merges #8518/#8529/#8585/#8591 need verified main files; a partial PR does not close', () => {
  const repo = 'AxalNetwork/StudioOS', blob = 'a'.repeat(40), mainSha = 'b'.repeat(40);
  // The four issue records were delivered through #8567, #8582, #8602 and #8600.
  // These synthetic GitHub rows model the period before their final main inclusion.
  const prs = [8567, 8582, 8602, 8600].map(number => ({ number, baseRepo: repo, mergedAt: '2026-11-25', base: 'topic', state: 'closed', relationship: 'partial', inclusion: 'not_an_ancestor' }));
  const documents = number => ({ pr: number, path: `topic/${number}.mjs`, blob });
  const verification = { scope_complete: true, source_prs: prs.map(pr => pr.number), main_paths: prs.map(pr => documents(pr.number)) };
  const finding = { verdict: 'close_done', verification };
  const evidence = { facts: { mainSha, prs, dependencies: [] } };
  const pullFiles = n => [{ filename: documents(n).path, sha: blob, status: 'added' }];
  const reads = { repo, readBlob: (_path, sha) => ({ type: 'file', sha: sha === mainSha ? blob : null }), readPullFiles: pullFiles };
  assert.equal(verifiedClosure(finding, evidence, reads), false, 'partial-only scope stays open');
  prs[3].relationship = 'closing';
  reads.readPullFiles = () => [];
  assert.equal(verifiedClosure(finding, evidence, reads), false, 'topic merge without a squash witness cannot close');
  reads.readPullFiles = n => [{ ...pullFiles(n)[0], sha: 'c'.repeat(40) }];
  assert.equal(verifiedClosure(finding, evidence, reads), false, 'topic merge requires the exact delivered blob');
  reads.readPullFiles = pullFiles;
  assert.equal(verifiedClosure(finding, evidence, reads), true, 'matching blobs can prove squash inclusion');
  assert.equal(verifiedClosure({ ...finding, verification: { ...verification, unfinished: 'one criterion' } }, evidence, reads), false);
});

test('a PR ancestor still needs a witnessed file it changed', () => {
  const repo = 'AxalNetwork/StudioOS', blob = 'a'.repeat(40);
  const pr = { number: 301, baseRepo: repo, mergedAt: '2026-11-25', state: 'closed', relationship: 'closing', inclusion: 'ancestor' };
  const data = { facts: { mainSha: 'b'.repeat(40), prs: [pr], dependencies: [] } };
  const finding = { verdict: 'close_done', verification: { scope_complete: true, source_prs: [301], main_paths: [{ pr: 301, path: 'unrelated.mjs', blob }] } };
  const reads = { repo, readBlob: () => ({ type: 'file', sha: blob }), readPullFiles: () => [{ filename: 'delivered.mjs', sha: 'c'.repeat(40), status: 'added' }] };
  assert.equal(verifiedClosure(finding, data, reads), false);
  finding.verification.main_paths[0].path = 'delivered.mjs';
  assert.equal(verifiedClosure(finding, data, reads), true, 'an independently verified later edit can be the current main blob');
});

test('a completed parent requires recorded closed children and an independently verified full scope', () => {
  const finding = { verdict: 'close_done', verification: { scope_complete: true, completed_children: [1, 2] } };
  const data = { facts: { prs: [], dependencies: [{ number: 1, state: 'closed', stateReason: 'completed' }, { number: 2, state: 'open' }] } };
  assert.equal(verifiedClosure(finding, data, {}), false);
  data.facts.dependencies[1] = { number: 2, state: 'closed', stateReason: 'not_planned' };
  assert.equal(verifiedClosure(finding, data, {}), false);
  data.facts.dependencies[1].stateReason = 'completed';
  assert.equal(verifiedClosure(finding, data, {}), true);
  assert.equal(verifiedClosure({ ...finding, verification: { ...finding.verification, scope_complete: false } }, data, {}), false);
});

test('a PR that opens during #8626-style review skips the entire apply item', async () => {
  const issue = { number: 8626, labels: ['state:blocked'], state: 'open', updated_at: 'old' };
  const facts = { mainSha: 'old-main', prs: [], commentDigest: 'old-comments', claim: { state: 'absent' } };
  const evidence = { issue, facts };
  const writes = [];
  const options = { evidence, patch: { labels: ['state:ready'] }, note: 'reviewed note', go: true,
    post: () => writes.push('note'), change: () => writes.push('state') };
  const newFacts = { ...facts, prs: [{ number: 33, state: 'open' }] };
  const result = await applyReviewedItem({ ...options, read: () => ({ issue, facts: newFacts }) });
  assert.match(result.stale, /evidence changed/);
  assert.deepEqual(writes, []);
});

test('interrupted apply recovers the exact posted note and applied state without its ledger', async () => {
  const issue = { number: 1, labels: ['state:blocked'], state: 'open', updated_at: 'old' };
  const facts = { prs: [], commentDigest: 'old-comments', claim: { state: 'absent' } };
  const evidence = { issue, facts }, patch = { labels: ['state:ready'] };
  let current = { issue, facts, noteDone: false };
  let posts = 0, changes = 0;
  const options = { evidence, patch, note: 'reviewed note', go: true, read: () => current,
    post: () => {
      posts++;
      current = { ...current, issue: { ...issue, updated_at: 'our-note' }, noteDone: true };
      throw new Error('lost response after posting');
    },
    change: () => {
      changes++;
      current = { ...current, issue: { ...issue, ...patch, updated_at: 'our-change' } };
    },
  };
  await assert.rejects(applyReviewedItem(options), /lost response/);
  assert.equal((await applyReviewedItem(options)).applied, true);
  assert.equal((await applyReviewedItem(options)).recovered, true);
  assert.deepEqual([posts, changes], [1, 1]);
});

test('an owner correction after posting the note fences the pending state change', async () => {
  const issue = { number: 1, labels: ['state:blocked'], state: 'open', updated_at: 'old' };
  const facts = { mainSha: 'main', commentDigest: 'reviewed' };
  let current = { issue, facts, noteDone: false };
  const result = await applyReviewedItem({ evidence: current, patch: { labels: ['state:ready'] }, note: 'reviewed note', go: true,
    read: () => current,
    post: () => { current = { issue, facts: { ...facts, commentDigest: 'edited-owner-answer' }, noteDone: true }; },
    change: () => assert.fail('stale change applied'),
  });
  assert.match(result.stale, /evidence changed/);
});

test('landedName gives boards files the repo name and leaves pages alone', () => {
  assert.equal(landedName('Build v2.dc.html'), 'Build v2 · Boards.dc.html');
  assert.equal(landedName('Build v2 Page.dc.html'), 'Build v2 Page.dc.html');
  assert.equal(landedName('Build v2 · Boards.dc.html'), 'Build v2 · Boards.dc.html');
  assert.throws(() => landedName('notes.md'), /not a canvas/);
});

test('parseDigests pairs each file with its own digest and trusts only owner, member or collaborator text', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
  assert.deepEqual(parseDigests([`| \`X Page.dc.html\` | \`${a}\` | \`X.dc.html\` | \`${b}\` |`]), { 'X Page.dc.html': a, 'X.dc.html': b });
  assert.deepEqual(parseDigests([`\`Build v2.dc.html\`: was ${a}, now ${c}`]), { 'Build v2.dc.html': c });
  assert.deepEqual(parseDigests([`SHA-256 of \`Build v2.dc.html\` is ${a.toUpperCase()}`]), { 'Build v2.dc.html': a });
  assert.deepEqual(parseDigests([{ body: `\`X.dc.html\` ${a}`, trusted: true }, { body: `\`X.dc.html\` ${b}`, trusted: false }]), { 'X.dc.html': a });
  assert.deepEqual(parseDigests([`\`X.dc.html\` ${a}`, `\`X.dc.html\` ${b}`]), { 'X.dc.html': 'conflict' });
});

test('compareDigests accepts a digest recorded under the landed name, and reports every outcome', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const rows = compareDigests({ 'Build v2 Page.dc.html': a, 'Build v2.dc.html': b, 'X.dc.html': a, 'Y.dc.html': a, 'Z.dc.html': a },
    { 'Build v2 Page.dc.html': a, 'Build v2 · Boards.dc.html': b, 'X.dc.html': b, 'Y.dc.html': 'conflict' });
  assert.deepEqual(rows.map(r => r.result), ['match', 'match', 'mismatch', 'conflict', 'unrecorded']);
});

test('boardsOf reads the board list a boards file renders', () => {
  const html = "const boards = [\n['BD-0', 'Audit, journey', 'cap', []],\n['BD14m', 'Phone parity', 'cap', []],\n['GR-01', 'Grow Overview · sparse', 'c', []]";
  assert.deepEqual(boardsOf(html).map(b => b.id), ['BD-0', 'BD14m', 'GR-01']);
});
