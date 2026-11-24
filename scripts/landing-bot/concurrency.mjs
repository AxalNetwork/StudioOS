// #8076: which queue candidates the feeder holds back, and why: one privileged PR at a time, at most N per slot. Pure.
import { PER_SLOT_IN_QUEUE, PRIVILEGED_IN_QUEUE } from './rules.mjs';

export const PRIVILEGED_LABEL = 'pr:privileged';
const SLOT = /^S\d+$/i;

/**
 * Shared-state workflows and the concurrency group each must declare (D8076). A group serialises runs that write the
 * same state, so two never interleave; `cancel-in-progress: false` lets a running write finish.
 * `job` names a job-level group (the deploy's retention ledger is written by its release job only).
 */
export const SHARED_STATE_GROUPS = Object.freeze([
  Object.freeze({ workflow: '.github/workflows/labels-sync.yml', state: 'repository labels from .github/labels.yml', group: 'labels-sync' }),
  Object.freeze({ workflow: '.github/workflows/landing-conflict-indicator.yml', state: 'the PR-list conflict label', group: 'studioos-landing-conflict-indicator' }),
  Object.freeze({ workflow: '.github/workflows/landing-bot-keeper.yml', state: 'keeper pushes and their reservation artifacts', group: 'studioos-landing-bot-keeper' }),
  Object.freeze({ workflow: '.github/workflows/landing-feeder.yml', state: 'merge queue entries and the daily feed ledger', group: 'studioos-landing-feeder' }),
  Object.freeze({ workflow: '.github/workflows/cloudflare-worker-deploy.yml', job: 'deploy', state: 'the docs/assets retention ledger and the production release', group: 'studioos-production-release' }),
]);

const names = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l?.name));

/**
 * One PR's admission facts.
 * @param p { number, labels, slot } — slot is 'S07', '' when the PR names no issue with a slot, or null when unread
 */
export function facts(p) {
  const slot = p?.slot;
  return {
    number: p?.number ?? null,
    privileged: names(p?.labels).includes(PRIVILEGED_LABEL),
    slot: typeof slot === 'string' ? (SLOT.test(slot) ? slot.toUpperCase() : '') : null,
  };
}

/**
 * Whether one candidate is held, given what is in the queue (including entries this sweep already made).
 * @param inQueue [{ number, labels, slot }] | null — null when the queue's entries could not be read
 * @returns null (admit) or { number, reason: 'unread'|'privileged'|'slot', slot?, blockers: [number], line }
 */
export function hold(candidate, inQueue, limits = {}) {
  const privilegedCap = limits.privileged ?? PRIVILEGED_IN_QUEUE;
  const slotCap = limits.perSlot ?? PER_SLOT_IN_QUEUE;
  const c = facts(candidate);
  const held = (reason, extra) => ({ number: c.number, reason, ...extra, line: holdLine({ reason, ...extra }, { privilegedCap, slotCap }) });
  if (!Array.isArray(inQueue)) return held('unread', { blockers: [] });
  const queued = inQueue.map(facts);
  if (queued.some((q) => q.slot === null)) return held('unread', { blockers: [] });
  if (c.slot === null) return held('unread', { blockers: [] });
  if (c.privileged) {
    const p = queued.filter((q) => q.privileged);
    if (p.length >= privilegedCap) return held('privileged', { blockers: p.map((q) => q.number) });
  }
  if (c.slot) {
    const same = queued.filter((q) => q.slot === c.slot);
    if (same.length >= slotCap) return held('slot', { slot: c.slot, blockers: same.map((q) => q.number) });
  }
  return null;
}

/**
 * The whole sweep in order: each admitted candidate counts against the ones after it.
 * @returns { admit: [candidate], held: [hold] }
 */
export function holds(candidates, inQueue, limits = {}) {
  const admit = [];
  const held = [];
  const queue = Array.isArray(inQueue) ? [...inQueue] : null;
  for (const c of candidates || []) {
    const h = hold(c, queue, limits);
    if (h) { held.push(h); continue; }
    admit.push(c);
    queue.push(c);
  }
  return { admit, held };
}

/** The one line that explains a hold, for the run summary and the PR's sticky comment. */
export function holdLine(h, { privilegedCap = PRIVILEGED_IN_QUEUE, slotCap = PER_SLOT_IN_QUEUE } = {}) {
  const list = (ns) => ns.map((n) => `#${n}`).join(', ');
  if (h.reason === 'privileged') {
    return `Held from the merge queue: ${privilegedCap === 1 ? 'a privileged PR is' : `${h.blockers.length} privileged PRs are`} already queued (${list(h.blockers)}), and the most is ${privilegedCap}. It is admitted once ${h.blockers.length === 1 ? 'that one leaves' : 'one leaves'} the queue.`;
  }
  if (h.reason === 'slot') {
    return `Held from the merge queue: slot ${h.slot} already has ${h.blockers.length} PRs queued (${list(h.blockers)}), and the most is ${slotCap}. It is admitted once one leaves the queue.`;
  }
  return 'Held from the merge queue: the queue\'s entries or this PR\'s slot could not be read, so nothing is admitted until they can.';
}
