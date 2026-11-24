import { breakers, count, eligible, mode } from './rules.mjs';
import { selectQueueEntries } from './feeder-plan.mjs';
import { hold } from './concurrency.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;

function enabled({ env, event, dispatchPr }) {
  if (!count(env?.LANDING_BOT_FEED_PER_SWEEP)) return false;
  const configured = mode(env);
  if (event === 'workflow_dispatch') return configured !== 'off' && positive(dispatchPr);
  return event === 'schedule' && configured === 'all';
}

// Treat anything other than a green run as unsuccessful, including timeouts and cancellations.
// The configured threshold is a fraction, e.g. "0.20". An incomplete window cannot establish the rate.
function belowFailureThreshold(runs, configured) {
  if (typeof configured !== 'string' || !/^(0?\.\d+|1(?:\.0+)?)$/.test(configured)) return false;
  const threshold = Number(configured);
  if (!(threshold > 0 && threshold <= 1) || !Array.isArray(runs) || runs.length !== 20) return false;
  const ids = new Set(runs.map(r => r?.id));
  if (ids.size !== 20 || !runs.every(r => positive(r?.id) && r?.status === 'completed' && r.event === 'merge_group' &&
      typeof r.conclusion === 'string' && r.conclusion !== '')) return false;
  return runs.filter(r => r.conclusion !== 'success').length / runs.length < threshold;
}

async function snapshot({ reader, env }) {
  const [health, queue] = await Promise.all([reader.readMainHealth(), reader.readQueueState()]);
  const breaker = breakers('feeder', { ...health, env });
  if (breaker.open || !belowFailureThreshold(health.recentGroupRuns, env.LANDING_BOT_QUEUE_FAIL_BREAKER)) return null;
  const capacity = { perSweep: count(env.LANDING_BOT_FEED_PER_SWEEP), freeQueueSlots: queue.freeQueueSlots };
  return Object.values(capacity).every(positive) ? { capacity, breaker } : null;
}

async function orderedNumbers({ reader, event, dispatchPr }) {
  const entries = await reader.readOrderedList();
  if (!Array.isArray(entries) || entries.some(entry => !positive(entry?.number))) throw new Error('Incomplete landing order');
  // The list puts the owner's T2 and model-repaired PRs first. Avoid fetching their files, commits and
  // CI logs. This is only a prefilter: fresh, positive evidence is still required for every queue entry.
  const numbers = entries.filter(entry => (event !== 'workflow_dispatch' || entry.number === dispatchPr) &&
    ['T0', 'T1'].includes(entry.tier) && entry.modelChanged === false).map(entry => entry.number);
  return [...new Set(numbers)];
}

// #8076 (D8076): the queue's entries and a candidate's slot. A failed read is null: the candidate is held, never admitted.
async function queueEntries({ reader }) {
  try { const q = await reader.readQueueEntries(); return Array.isArray(q) ? q : null; } catch { return null; }
}
async function admissionFacts({ reader }, row) {
  let slot = null;
  try { slot = await reader.readOwningSlot(row.pull); } catch { /* null: held */ }
  return { number: row.pull.number, labels: row.pull.labels, slot };
}

async function readRow({ reader, env, event, dispatchPr, repo }, number, breaker) {
  const [facts, landing] = await Promise.all([reader.readCandidate(number), reader.readLandingDecision(number)]);
  const { pull, files } = facts;
  if (pull?.number !== number || facts.number !== number) throw new Error('GitHub returned a different PR');
  const common = eligible(pull, { kind: 'feeder', repo, files, breakers: breaker, env, event, dispatchPr });
  return { pull, landing, evidence: { ...facts, eligible: common.ok } };
}

/** Read-only plan. The workflow stores only PR numbers and exact heads in the reservation. */
export async function planSweep(options) {
  if (!enabled(options)) return [];
  const state = await snapshot(options);
  if (!state) return [];
  let cap = Math.min(...Object.values(state.capacity));
  let dailyChecked = false;
  const selected = [];
  const queued = await queueEntries(options);
  const admitted = [];
  for (const number of await orderedNumbers(options)) {
    const row = await readRow(options, number, state.breaker);
    const [entry] = selectQueueEntries([row], { ...state.capacity, remainingDaily: 1 });
    if (!entry) continue;
    const mine = await admissionFacts(options, row);
    const held = hold(mine, queued && [...queued, ...admitted]);
    if (held) { options.onHold?.(held); continue; }
    if (!dailyChecked) {
      const remaining = await options.readRemainingDaily();
      if (!positive(remaining)) return [];
      cap = Math.min(cap, remaining);
      dailyChecked = true;
    }
    selected.push(entry);
    admitted.push(mine);
    if (selected.length === cap) break;
  }
  return selected;
}

/**
 * Run after reservation in the same serialized workflow. readRemainingDaily() reports this run's verified
 * reservation still allowed by the daily cap, before subtracting this invocation's confirmed writes.
 * The plan supplies an upper bound; current repository facts determine every mutation.
 */
export async function applySweep(options, plan) {
  if (!enabled(options) || !Array.isArray(plan) || !plan.length) return [];
  const reserved = new Map();
  for (const item of plan) {
    if (!positive(item?.number) || !/^[a-f0-9]{40}$/.test(item.expectedHeadOid) || reserved.has(item.number)) {
      throw new Error('Invalid reserved queue plan');
    }
    reserved.set(item.number, item.expectedHeadOid);
  }
  const written = [];
  let slotsLeft = reserved.size;
  let verifiedReservation;
  const admitted = [];
  for (const number of await orderedNumbers(options)) {
    if (!reserved.has(number)) continue;
    const state = await snapshot(options);
    if (!state || written.length >= state.capacity.perSweep) break;
    slotsLeft = Math.min(slotsLeft, state.capacity.freeQueueSlots);
    const row = await readRow(options, number, state.breaker);
    const [entry] = selectQueueEntries([row], { ...state.capacity, remainingDaily: 1 });
    if (!entry || entry.expectedHeadOid !== reserved.get(number)) continue;
    // #8076: re-read the queue before each write; the plan's view of it may be stale.
    const inQueue = await queueEntries(options);
    const mine = await admissionFacts(options, row);
    // An entry this sweep wrote may not show in the queue read yet; count it once either way.
    const held = hold(mine, inQueue && [...inQueue, ...admitted.filter((a) => !inQueue.some((q) => q.number === a.number))]);
    if (held) { options.onHold?.(held); continue; }
    // The serialized run owns an immutable reservation. The writer enforces its UTC expiry for each attempt.
    if (verifiedReservation === undefined) verifiedReservation = await options.readRemainingDaily();
    if (!positive(verifiedReservation) || written.length >= verifiedReservation) break;
    const result = await options.enqueue({ ...entry, pullRequestId: row.pull.node_id });
    if (result?.status !== 'queued' || result.number !== number || result.expectedHeadOid !== entry.expectedHeadOid) {
      throw new Error(`Queue write for #${number} was ${result?.status === 'refused' ? 'refused' : 'unconfirmed'}; sweep stopped.`);
    }
    written.push(result);
    admitted.push(mine);
    // Queue counts can lag a successful write. Do not spend the same slot twice in this sweep.
    if (--slotsLeft === 0) break;
  }
  return written;
}
