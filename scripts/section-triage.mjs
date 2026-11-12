#!/usr/bin/env node
// D5681: operator-only, reproducible UI incidents. Run without --apply for an offline preview.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { githubApi } from './claim.mjs';

const repo = 'AxalNetwork/StudioOS';
const orchestrationOwner = 'guillaumelauzier';
const exampleEpisode = '00000000-0000-4000-8000-000000000000';
const cases = new Map([
  ['learning-discovery', { section: 'all-learning', name: 'Learning discovery list rendering',
    file: 'frontend/src/pages/learning/LearningHome.jsx', test: 'frontend/test/learning_discovery_4648.test.mjs' }],
  ['help-guide-placement', { section: 'all-help-center', name: 'Help Center guide placement',
    file: 'frontend/src/pages/docs/guidePlacement.js', test: 'frontend/test/help_placement_d626.test.mjs' }],
]);

export function prepare(input) {
  const fields = ['case', 'episode', 'count', 'revision', 'source', 'classification'];
  if (!input || Object.keys(input).length !== fields.length || !fields.every(k => Object.hasOwn(input, k)))
    throw new Error('Expected exactly the six documented evidence fields');
  const knownSource = input.source === 'operator-reproduced' || input.source === 'offline-fixture';
  const ordinary = knownSource && input.classification === 'ordinary-ui-regression';
  const spec = cases.get(input.case);
  if (!ordinary || !spec) throw new Error('Ineligible evidence or reproduction case');
  if (typeof input.episode !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.episode)
    || typeof input.revision !== 'string' || !/^[0-9a-f]{40}$/.test(input.revision)
    || !Number.isSafeInteger(input.count) || input.count < 1 || input.count > 1000000)
    throw new Error('Invalid episode UUID, source revision or cumulative count');
  const key = createHash('sha256').update(repo + '/ordinary-ui/v1/' + input.case + '/' + input.episode).digest('hex');
  const marker = '<!-- axal-section-incident:v1:' + key + ' -->';
  const source = 'https://github.com/' + repo + '/blob/' + input.revision + '/';
  const body = [spec.name + ' failed in a controlled reproduction.',
    'Section: ' + spec.section + '. Cumulative observations at filing: ' + input.count + '.',
    '[Source at the observed revision](' + source + spec.file + ') · [Regression test](' + source + spec.test + ')',
    'S01 triages the incident and authorizes any slot task. Recovery requires a verified release and healthy evidence.', marker].join('\n\n');
  return { key, marker, spec, revision: input.revision, count: input.count,
    issue: { title: 'UI regression: ' + spec.name, body, labels: ['bug', 'frontend', 'observability'] } };
}

export function openLedger(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS filing (key TEXT PRIMARY KEY, actor TEXT NOT NULL, issue INTEGER);
    CREATE TABLE IF NOT EXISTS queue_reservations (case_id TEXT PRIMARY KEY, key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS milestones (key TEXT NOT NULL, bucket INTEGER NOT NULL, actor TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(key,bucket));`);
  return db;
}

const validLogin = value => typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
async function optional(api, path) {
  try { return { found: true, value: await api('GET', path) }; }
  catch (e) { if (e.status === 404) return { found: false }; throw e; }
}
async function eligibleOwner(api, owner) {
  if (owner == null) return null;
  if (!validLogin(owner.login) || !/^S(0[1-9]|[1-9][0-9])$/.test(owner.slot))
    throw new Error('Invalid operator-owned assignee/slot mapping');
  if (!(await optional(api, 'assignees/' + owner.login)).found) return null;
  return (await optional(api, 'labels/' + encodeURIComponent('slot:' + owner.slot))).found ? owner : null;
}
function sameIssue(issue, row, plan) {
  return issue && !issue.pull_request && issue.user?.login?.toLowerCase() === row.actor.toLowerCase()
    && issue.body?.split('\n').includes(plan.marker) && Number.isSafeInteger(issue.number) && issue.number > 0;
}
async function findInHistory(api, path, matches) {
  for (let page = 1; page <= 20; page++) {
    const entries = await api('GET', path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
    if (entries.some(matches)) return true;
    if (entries.length < 100) return false;
  }
  return null; // incomplete history
}

export async function triage({ input, db, api, actor, owner, linkIssue, workOrder = false, queueForSlot = false }) {
  const plan = prepare(input);
  if (input.source !== 'operator-reproduced' || input.episode === exampleEpisode) throw new Error('Offline examples cannot be applied');
  if (!validLogin(actor)) throw new Error('An authenticated operator GitHub login is required');
  if (queueForSlot && actor.toLowerCase() !== orchestrationOwner) throw new Error('Only the repository orchestration owner can authorize a ready slot task');
  const key = plan.key;
  let row = db.prepare('SELECT * FROM filing WHERE key=?').get(key);
  let issue;
  if (linkIssue != null) {
    if (!row || !Number.isSafeInteger(linkIssue) || linkIssue <= 0 || (row.issue && row.issue !== linkIssue))
      throw new Error('Conflicting issue receipt or missing durable intent');
    issue = await api('GET', 'issues/' + linkIssue);
    if (!sameIssue(issue, row, plan)) throw new Error('Issue author or marker did not match the original filing');
    db.prepare('UPDATE filing SET issue=? WHERE key=? AND issue IS NULL').run(linkIssue, key);
    row.issue = linkIssue;
  }
  if (row && !row.issue) return { state: 'filing-uncertain', marker: plan.marker };
  if (row && !issue) issue = await api('GET', 'issues/' + row.issue);
  if (row && !sameIssue(issue, row, plan)) throw new Error('Stored issue identity does not match; review privately');
  if (issue?.state === 'closed') return { state: 'closed-needs-recovery-verification', issue: issue.number };

  const assigned = await eligibleOwner(api, owner);
  if (!row) {
    if (queueForSlot && !assigned) throw new Error('Queue authorization requires a verified assignee and slot mapping');
    const comparison = await api('GET', 'compare/' + plan.revision + '...main');
    if (!['ahead', 'identical'].includes(comparison.status) || comparison.merge_base_commit?.sha !== plan.revision)
      throw new Error('Observed revision is not on repository main');
    // S01 may promote at first filing only. Existing human labels/assignments are never overwritten.
    const draft = { ...plan.issue, ...(assigned ? { assignees: [assigned.login] } : {}) };
    if (queueForSlot) {
      // A different episode of the same defect may already have repair work. Keep one active work order.
      const existing = await findInHistory(api, 'issues?state=open&labels=bug%2Cfrontend%2Cobservability',
        x => !x.pull_request && x.title === draft.title);
      if (existing !== false) return { state: 'similar-task-or-incomplete-history', workOrder: 'held-for-S01' };
      if (!(await optional(api, 'labels/' + encodeURIComponent('state:ready'))).found) throw new Error('Repository ready label is unavailable');
      const previous = db.prepare('SELECT key FROM queue_reservations WHERE case_id=?').get(input.case);
      if (previous && previous.key !== key) {
        const prevIssue = db.prepare('SELECT issue FROM filing WHERE key=?').get(previous.key)?.issue;
        if (!prevIssue || (await api('GET', 'issues/' + prevIssue)).state !== 'closed')
          return { state: 'similar-task-or-incomplete-history', workOrder: 'held-for-S01' };
        db.prepare('DELETE FROM queue_reservations WHERE case_id=? AND key=?').run(input.case, previous.key);
      }
      draft.body = 'S1: Reproduce and repair the verified UI regression. Open one draft PR with the linked regression test under the slot protocol.\n\n' + draft.body;
      draft.labels = [...draft.labels, 'slot:' + assigned.slot, 'state:ready'];
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const won = db.prepare('INSERT OR IGNORE INTO filing(key,actor) VALUES (?,?)').run(key, actor).changes;
      const reserved = !queueForSlot || db.prepare('INSERT OR IGNORE INTO queue_reservations(case_id,key) VALUES (?,?)').run(input.case, key).changes;
      if (!won || !reserved) {
        db.exec('ROLLBACK');
        return { state: 'concurrent-filing-retry' };
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    // Commit intent BEFORE POST. If its outcome is ambiguous, a retry cannot create a second issue.
    try {
      issue = await api('POST', 'issues', draft);
    } catch (error) {
      if ([401, 403, 422, 429].includes(error.status)) {
        db.prepare('DELETE FROM queue_reservations WHERE case_id=? AND key=?').run(input.case, key);
        db.prepare('DELETE FROM filing WHERE key=? AND issue IS NULL').run(key);
      }
      throw error;
    }
    if (!sameIssue(issue, { actor }, plan)) throw new Error('Filing outcome unverified; reconcile the original intent');
    db.prepare('UPDATE filing SET issue=? WHERE key=?').run(issue.number, key);
    if (queueForSlot) {
      const names = issue.labels.map(l => typeof l === 'string' ? l : l.name);
      const confirmed = names.includes('slot:' + assigned.slot) && names.includes('state:ready')
        && issue.assignees?.some(a => a.login.toLowerCase() === assigned.login.toLowerCase());
      return { state: confirmed ? 'queued-for-slot' : 'partial-queue-needs-S01', issue: issue.number, slot: assigned.slot };
    }
  } else {
    // Updates are cumulative threshold observations, never raw event increments. No edits to human-authored text.
    const initial = Number(/Cumulative observations at filing: (\d+)\./.exec(issue.body)?.[1]);
    if (!Number.isSafeInteger(initial) || initial < 1) throw new Error('Initial observation receipt missing');
    const bucket = 2 ** Math.floor(Math.log2(plan.count));
    if (bucket > initial) {
      const receipt = '<!-- axal-section-count:v1:' + key + ':' + bucket + ' -->';
      const won = db.prepare('INSERT OR IGNORE INTO milestones(key,bucket,actor) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM milestones WHERE key=? AND bucket>=?)').run(key, bucket, actor, key, bucket).changes;
      if (won) {
        try { await api('POST', 'issues/' + issue.number + '/comments', { body: 'Cumulative observations reached at least ' + bucket + '.\n\n' + receipt }); }
        catch (error) {
          if ([401, 403, 422, 429].includes(error.status)) db.prepare('DELETE FROM milestones WHERE key=? AND bucket=?').run(key,bucket);
          throw error;
        }
        db.prepare('UPDATE milestones SET confirmed=1 WHERE key=? AND bucket=?').run(key, bucket);
      } else {
        const pending = db.prepare('SELECT actor FROM milestones WHERE key=? AND bucket=? AND confirmed=0').get(key, bucket);
        if (pending) {
          const delivered = await findInHistory(api, 'issues/' + issue.number + '/comments', c =>
            c.user?.login?.toLowerCase() === pending.actor.toLowerCase() && c.body?.split('\n').includes(receipt));
          if (delivered !== true) return { state: 'count-delivery-uncertain', issue: issue.number };
          db.prepare('UPDATE milestones SET confirmed=1 WHERE key=? AND bucket=?').run(key, bucket);
        }
      }
    }
  }
  const result = { state: 'linked', issue: issue.number };
  if (queueForSlot && row) return { ...result, workOrder: 'existing-issue-needs-S01-review' };
  if (!workOrder) return result;
  const labels = issue.labels.map(l => typeof l === 'string' ? l : l.name);
  if (!assigned || !issue.assignees?.some(a => a.login?.toLowerCase() === assigned.login.toLowerCase())
    || issue.assignees.length !== 1 || labels.some(l=>/^(slot:|state:|needs-|security$|bounty:|feature:)/i.test(l)))
    return { ...result, workOrder: 'held-for-S01' };
  const held = await optional(api, 'git/ref/heads/claim/' + issue.number);
  if (held.found || (await findInHistory(api, 'issues/' + issue.number + '/timeline', x => x.source?.issue?.pull_request && x.source.issue.state === 'open')) !== false) return { ...result, workOrder: 'existing-work-or-incomplete-history' };
  return { ...result, workOrder: { disposition: 'proposal-for-S01', slot: assigned.slot, assignee: assigned.login,
    issue: issue.number, source: plan.spec.file, regressionTest: plan.spec.test,
    instructions: 'S01 checks current claims and PRs, then authorizes the task using AGENTS.md. The winning slot prepares one draft PR with a regression test. Require CI and owner review.' } };
}

export async function main(args) {
  const [inputPath,...flags] = args;
  if (!inputPath || inputPath.startsWith('--')) throw new Error('Usage: node scripts/section-triage.mjs evidence.json [--apply] [--work-order | --queue-for-slot] [--link-issue NUMBER]');
  const allowed = new Set(['--apply','--work-order','--queue-for-slot','--link-issue']);
  let linkIssue;
  for (let i=0; i<flags.length; i++) {
    if (!allowed.delete(flags[i])) throw new Error('Unknown or repeated flag');
    if (flags[i] === '--link-issue') {
      if (!/^[1-9]\d*$/.test(flags[i+1] || '')) throw new Error('Invalid issue number');
      linkIssue = Number(flags[++i]);
    }
  }
  if (flags.includes('--work-order') && flags.includes('--queue-for-slot')) throw new Error('Choose work-order preview or authorized queue enrollment');
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const plan = prepare(input);
  if (!flags.includes('--apply')) return { state: 'offline-preview', issue: plan.issue, test: plan.spec.test };
  if (!process.env.SECTION_TRIAGE_LEDGER || process.env.SECTION_TRIAGE_LEDGER === ':memory:')
    throw new Error('Set SECTION_TRIAGE_LEDGER to the shared persistent operator ledger');
  if (input.source === 'offline-fixture' || input.episode === exampleEpisode) throw new Error('Offline examples cannot be applied');
  const owners = JSON.parse(process.env.SECTION_TRIAGE_OWNERS || '{}');
  const actor = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
  const db = openLedger(process.env.SECTION_TRIAGE_LEDGER);
  try { return await triage({ input, api: githubApi(repo), db, actor, owner: owners[plan.spec.section], linkIssue, workOrder: flags.includes('--work-order'), queueForSlot: flags.includes('--queue-for-slot') }); }
  finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(e => {
    if ('status' in e || e.cmd) console.error('GitHub request failed. Inspect the saved receipt before retrying.');
    else console.error('Triage stopped: ' + (e instanceof SyntaxError ? 'invalid JSON' : e.message));
    process.exitCode = 1;
  });
}
