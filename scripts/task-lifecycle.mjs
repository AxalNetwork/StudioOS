#!/usr/bin/env node
/**
 * #6326: the read side of the slot protocol, for the `task-lifecycle` skill.
 * Reads GitHub only (GET); it never claims, labels, comments, pushes or merges.
 *
 *   next    --slot SNN                          the slot's oldest state:ready task, and who holds its claim ref
 *   answers --slot SNN                          owner answers on the slot's needs-decision / state:blocked issues
 *   claims  --slot SNN [--agent A --session S]  the slot's claim refs: ok, renew, expired, release (issue closed);
 *                                               commands are printed only for refs whose stored slot, agent and
 *                                               session all match the flags; without both flags it lists only
 *   status  --issue N --slot SNN --agent A --branch B --state STATE
 *           [--files F] [--blockers X] [--questions Q] [--tests T] [--pr URL] [--needs-decision] [--offline]
 *                                               prints the STATUS comment and the label change to make with it
 *
 * Decisions live in `lib/taskLifecycle.mjs`. GitHub access is `gh()` from
 * `coordinator.mjs`: curl with GH_TOKEN or GITHUB_TOKEN when set, so it works
 * behind a proxy that injects credentials.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gh } from './coordinator.mjs';
import { parseClaim } from './lib/claims.mjs';
import {
  normSlot, isSlotLabel, labelsOf, readyQueue, renderStatus, labelPlan, ownerAnswers, claimAction, parseArgs, STATES,
} from './lib/taskLifecycle.mjs';

function pages(path) {
  const all = [];
  for (let p = 1; p <= 100; p++) {
    const rows = gh('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${p}`);
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw new Error('pagination cap reached');
}

function readClaim(issue) {
  try {
    const ref = gh('GET', `/git/ref/heads/claim/${issue}`);
    return { sha: ref.object.sha, claim: parseClaim(gh('GET', `/git/commits/${ref.object.sha}`).message) };
  } catch (e) { if (e.status === 404) return null; throw e; }
}

const need = (opts, name) => { if (!opts[name]) throw new Error(`--${name} is required`); return opts[name]; };
const slotOpt = opts => { const s = normSlot(need(opts, 'slot')); if (!s) throw new Error('--slot must look like S05 (S01 to S37, or an assigned later slot such as S39)'); return s; };
const enc = encodeURIComponent;

function next(opts) {
  const slot = slotOpt(opts);
  const queue = readyQueue(pages(`/issues?labels=${enc(`slot:${slot}`)},state:ready&state=open&sort=created&direction=asc`), slot);
  if (!queue.length) { console.log(`${slot}: no open state:ready task.`); return 0; }
  for (const issue of queue) {
    const held = readClaim(issue.number);
    const who = !held ? 'no claim ref' : held.claim ? `claim ref held by ${held.claim.slot} · ${held.claim.agent} · ${held.claim.session} since ${held.claim.at}` : 'claim ref unreadable';
    console.log(`#${issue.number}  ${issue.created_at.slice(0, 10)}  ${issue.title}\n        ${who}`);
    if (!held) { console.log(`\nTake #${issue.number}.`); return 0; }
  }
  console.log(`\nAll ${queue.length} state:ready task(s) have a claim ref: leave held ones alone (claim.mjs exit 3) and ask on the issue if one looks abandoned.`);
  return 0;
}

function answers(opts) {
  const slot = slotOpt(opts);
  const byNumber = new Map();
  for (const label of ['needs-decision', 'state:blocked']) {
    for (const i of pages(`/issues?labels=${enc(`slot:${slot}`)},${enc(label)}&state=open`)) if (!i.pull_request && labelsOf(i).some(l => isSlotLabel(l, slot))) byNumber.set(i.number, i);
  }
  let found = 0;
  for (const issue of [...byNumber.values()].sort((a, b) => a.number - b.number)) {
    const { anchorAt, anchorKind, answers: list, relays } = ownerAnswers(pages(`/issues/${issue.number}/comments`));
    if (!list.length && !relays.length) continue;
    found++;
    console.log(`#${issue.number}  [${labelsOf(issue).filter(l => /^(state:|needs-)/.test(l)).join(', ')}]  ${issue.title}`);
    console.log(`        since: ${anchorAt ? `last ${anchorKind} STATUS ${anchorAt}` : 'the first comment (no STATUS)'}`);
    for (const c of list) console.log(`        owner account ${c.created_at}${c.maybeAgent ? ' (looks like an agent note)' : ''}: ${String(c.body).trim().split('\n')[0].slice(0, 160)}\n          ${c.html_url}`);
    for (const c of relays) console.log(`        S1 relay ${c.created_at}: ${String(c.body).trim().split('\n')[0].slice(0, 160)}\n          ${c.html_url}`);
  }
  if (!found) console.log(`${slot}: no owner-account comment after the last BLOCKED STATUS on any needs-decision or state:blocked issue (${byNumber.size} checked).`);
  else console.log('\nAgents post as the owner account too: a candidate counts as an answer only if it answers the lettered options.');
  return 0;
}

function claims(opts) {
  const slot = slotOpt(opts);
  const identified = !!(opts.agent && opts.session);
  const rows = [];
  // matching-refs ignores per_page/page and returns every ref at once: one GET, no paging.
  for (const ref of gh('GET', '/git/matching-refs/heads/claim')) {
    const m = /^refs\/heads\/claim\/([1-9]\d*)$/.exec(ref.ref);
    if (!m) continue;
    const claim = parseClaim(gh('GET', `/git/commits/${ref.object.sha}`).message);
    if (!claim || normSlot(claim.slot) !== slot) continue;
    const issue = gh('GET', `/issues/${m[1]}`);
    rows.push({ number: Number(m[1]), claim, issue, ...claimAction(claim, { issueState: issue.state, slot, agent: opts.agent, session: opts.session }) });
  }
  if (!rows.length) { console.log(`${slot}: holds no claim ref.`); return 0; }
  rows.sort((a, b) => a.number - b.number);
  for (const r of rows) {
    const id = `--slot ${r.claim.slot} --agent "${r.claim.agent}" --session ${r.claim.session}`;
    console.log(`#${r.number}  ${r.state.toUpperCase().padEnd(7)}  ${r.hoursLeft}h left  issue ${r.issue.state}  ${r.claim.slot} · ${r.claim.agent} · ${r.claim.session}${r.mine ? '  (yours)' : ''}`);
    if (!r.mine) {
      if (identified) console.log(`        another session's claim: not yours to renew or release${r.hoursLeft <= 0 ? '; expired, it stays held until its holder releases it or the owner hands it back' : ''}`);
      continue;
    }
    if (r.action === 'renew') console.log(`        node scripts/claim.mjs renew ${r.number} ${id}`);
    if (r.action === 'release' || r.action === 'expired') console.log(`        node scripts/claim.mjs release ${r.number} ${id}${r.action === 'expired' && r.issue.state === 'open' ? `   (then claim again if you are still working on it)` : ''}`);
  }
  if (!identified) console.log('\nListed for information only: pass --agent and --session to get the commands for your own claims. Never renew or release a claim that is not yours.');
  return 0;
}

function status(opts) {
  const state = need(opts, 'state');
  if (!STATES.includes(state)) throw new Error(`--state must be one of ${STATES.join(', ')}`);
  const issue = need(opts, 'issue');
  const text = renderStatus({ issue, slot: opts.slot, agent: opts.agent, branch: opts.branch, state, files: opts.files,
    blockers: opts.blockers, questions: opts.questions, tests: opts.tests, pr: opts.pr });
  const current = opts.offline ? [] : labelsOf(gh('GET', `/issues/${issue}`));
  const plan = labelPlan(current, state, { needsDecision: !!opts['needs-decision'] });
  console.log(text);
  console.log(`\nlabels${opts.offline ? ' (offline: current labels not read)' : ''}: add [${plan.add.join(', ')}]  remove [${plan.remove.join(', ')}]`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  const opts = parseArgs(rest, { flags: ['needs-decision', 'offline'] });
  if (cmd === 'next') return next(opts);
  if (cmd === 'answers') return answers(opts);
  if (cmd === 'claims') return claims(opts);
  if (cmd === 'status') return status(opts);
  console.error('usage: task-lifecycle.mjs next|answers|claims|status (see the header)');
  return 2;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
