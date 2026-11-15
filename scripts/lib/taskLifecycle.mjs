/**
 * #6326: the slot protocol's decisions, apart from GitHub, for the
 * `task-lifecycle` skill (AGENTS.md § Task protocol, § STATUS, § Owner answers).
 * Which issue a slot pulls next, what a STATUS block says, which labels go with
 * each STATUS state, which comments on a blocked issue are the owner's answer,
 * and what a slot must do with each claim ref it holds (renew, release, leave).
 * Owned by `../task-lifecycle.mjs`; tested in `taskLifecycle.test.mjs`.
 */

/** AGENTS.md § STATUS: each STATUS `state:` goes with one label. */
export const STATES = ['IN_PROGRESS', 'BLOCKED', 'READY_FOR_REVIEW', 'DONE'];
export const STATE_LABELS = ['state:ready', 'state:in-progress', 'state:blocked', 'state:review'];
const LABEL_FOR = { IN_PROGRESS: 'state:in-progress', BLOCKED: 'state:blocked', READY_FOR_REVIEW: 'state:review', DONE: null };
/** AGENTS.md § Who gives instructions. */
export const OWNER = 'guillaumelauzier';
/** Renew a claim once less than this is left of its TTL. */
export const RENEW_WITHIN_HOURS = 6;

/**
 * `S05`, `s5` or `s39` → `S05` / `S39`; anything else → null. The standard
 * slots are S01 to S37 (AGENTS.md), but D5617 keeps explicitly assigned later
 * slots such as `s38` and `s39`, which have labels, issues and claim refs, so
 * any `S1` to `S99` is accepted. `claim.mjs` stores the slot as typed, so
 * compare stored slots through this, never as raw strings.
 */
export function normSlot(value) {
  const m = /^S(\d{1,2})$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? `S${String(n).padStart(2, '0')}` : null;
}

/** True when `label` is `slot:<slot>` in any case or padding (`slot:s39`, `slot:S05`). */
export const isSlotLabel = (label, slot) => {
  const m = /^slot:(.+)$/i.exec(String(label ?? ''));
  return !!m && normSlot(m[1]) !== null && normSlot(m[1]) === normSlot(slot);
};

export const labelsOf = issue => (issue?.labels ?? []).map(l => (typeof l === 'string' ? l : l.name));

/**
 * AGENTS.md § Task protocol step 1: the open issues labelled with the slot and
 * `state:ready`, oldest first. Pull requests are never tasks.
 */
export function readyQueue(issues, slot) {
  const s = normSlot(slot);
  if (!s) throw new Error('slot must look like S05');
  return issues
    .filter(i => !i.pull_request && i.state !== 'closed')
    .filter(i => { const l = labelsOf(i); return l.some(x => isSlotLabel(x, s)) && l.includes('state:ready'); })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);
}

const field = (v, dflt) => {
  const text = String(v ?? '').replace(/\s+/g, ' ').trim();
  return text || dflt;
};

/** The STATUS block of AGENTS.md § STATUS, inside a `text` fence. */
export function renderStatus({ issue, slot, agent, branch, state, files, blockers, questions, tests, pr }) {
  if (!/^[1-9]\d*$/.test(String(issue))) throw new Error('issue must be a positive integer');
  const s = normSlot(slot);
  if (!s) throw new Error('slot must look like S05');
  if (!STATES.includes(state)) throw new Error(`state must be one of ${STATES.join(', ')}`);
  if (!field(agent)) throw new Error('agent is required');
  if (!field(branch)) throw new Error('branch is required');
  const body = [
    'STATUS',
    `task: #${issue}   slot: ${s}   agent: ${field(agent)}`,
    `branch: ${field(branch)}`,
    `state: ${state}`,
    `files: ${field(files, 'none yet')}`,
    `blockers: ${field(blockers, 'none')}`,
    `questions: ${field(questions, 'none')}`,
    `tests: ${field(tests, 'none run')}`,
    `pr: ${field(pr, 'none yet')}`,
  ];
  if (body.some(line => line.includes('```'))) throw new Error('a field may not contain a code fence');
  return ['```text', ...body, '```'].join('\n');
}

/**
 * The label change that goes with a STATUS state, from the issue's current
 * labels. Every other `state:*` label comes off. `needs-decision` goes on only
 * for BLOCKED with `needsDecision`, and comes off for IN_PROGRESS and
 * READY_FOR_REVIEW (an owner answer settles it, § Owner answers). DONE changes
 * nothing: the issue closes when its PR merges.
 */
export function labelPlan(current, state, { needsDecision = false } = {}) {
  if (!STATES.includes(state)) throw new Error(`state must be one of ${STATES.join(', ')}`);
  if (needsDecision && state !== 'BLOCKED') throw new Error('needs-decision goes only with BLOCKED');
  const have = new Set(current);
  if (state === 'DONE') return { add: [], remove: [] };
  const target = LABEL_FOR[state];
  const add = [];
  const remove = STATE_LABELS.filter(l => l !== target && have.has(l));
  if (!have.has(target)) add.push(target);
  if (state === 'BLOCKED' && needsDecision && !have.has('needs-decision')) add.push('needs-decision');
  if (state !== 'BLOCKED' && have.has('needs-decision')) remove.push('needs-decision');
  return { add, remove };
}

/** A comment carrying a STATUS block (fenced or not). */
export function isStatusComment(body) {
  return /^\s*(?:```text\s*\n)?STATUS[ \t]*\r?\n\s*task:/m.test(String(body ?? ''));
}

const AGENT_FOOTER = /_Generated by \[[^\]]+\]\([^)]*\)_|Generated with \[Claude Code\]/;
/**
 * Report-shaped openings agents use when they post as the owner account
 * without a footer: a STATUS line in any form (`STATUS S31: ...`), a local
 * verification note, a draft or PR note. A hint only; a person-style read decides.
 */
const REPORT_SHAPE = /^\s*(?:\**\s*)?(?:STATUS\b|Local\b|Draft\b|Verification\b|CI\b|PR\s*#|Opened\b|Pushed\b|Rebased\b|Merged\b)/i;
/** A comment that may be an agent's note rather than the owner's answer. */
export const looksLikeAgentNote = body => AGENT_FOOTER.test(String(body ?? '')) || REPORT_SHAPE.test(String(body ?? ''));
/** A STATUS block whose state is BLOCKED: the question an answer replies to. */
export const isBlockedStatus = body => isStatusComment(body) && /^\s*state:\s*BLOCKED\b/m.test(String(body ?? ''));
/** Notes a script writes carry a marker (coordinator audit, CI digest, claims reaper): never an answer. */
const MACHINE_MARKER = /<!--\s*(?:coordinator-audit|studioos-[\w-]+|expired-claim)[:\s]/;

/**
 * AGENTS.md § Owner answers: an answer is a comment by the owner account that
 * does not start with `S1:` and carries no STATUS block. The candidates are
 * the comments after the issue's last BLOCKED STATUS (the question), so a
 * later STATUS from any slot does not hide an answer; with no BLOCKED STATUS
 * they are the comments after the last STATUS of any state. Agents post as
 * the same account, often with no footer, so every candidate may still be an
 * agent's note: one with a footer or a report-shaped opening is flagged
 * `maybeAgent`, and only a comment that answers the lettered options counts.
 * A note carrying a script's marker is skipped. `relays` are Session 1's
 * `S1:` comments in the same window, which relay answers too.
 */
export function ownerAnswers(comments, { owner = OWNER } = {}) {
  const sorted = [...comments].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let anchor = -1;
  let anchorKind = null;
  sorted.forEach((c, i) => { if (isBlockedStatus(c.body)) { anchor = i; anchorKind = 'BLOCKED'; } });
  if (anchor < 0) sorted.forEach((c, i) => { if (isStatusComment(c.body)) { anchor = i; anchorKind = 'STATUS'; } });
  const after = sorted.slice(anchor + 1).filter(c => c.user?.login === owner && !isStatusComment(c.body));
  const answers = [];
  const relays = [];
  for (const c of after) {
    const body = String(c.body ?? '');
    if (MACHINE_MARKER.test(body)) continue;
    if (/^\s*S1:/.test(body)) relays.push(c);
    else answers.push({ ...c, maybeAgent: looksLikeAgentNote(body) });
  }
  return { anchorAt: anchor >= 0 ? sorted[anchor].created_at : null, anchorKind, answers, relays };
}

/**
 * What a slot does with one claim ref (D5617; AGENTS.md § Task protocol step 2:
 * never delete another holder's ref). `state` describes the ref: `release`
 * (issue closed), `expired`, `renew` (less than `renewWithinHours` left) or
 * `ok`. `mine` is true only when slot, agent and session are all given and all
 * match the stored claim (the slot through normSlot, since `claim.mjs` stores
 * it as typed); `action` is `state` when mine and `leave` otherwise, so a
 * missing `agent` or `session` never makes another session's claim actionable.
 * Mine and expired → release, then claim again if the work goes on (`renew`
 * refuses an expired claim).
 */
export function claimAction(claim, { now = Date.now(), issueState, slot, agent, session, renewWithinHours = RENEW_WITHIN_HOURS } = {}) {
  if (!claim) return { state: 'unreadable', action: 'unreadable', mine: false, hoursLeft: null };
  const end = Date.parse(claim.at) + claim.ttlHours * 3600000;
  const hoursLeft = Math.round(((end - new Date(now).getTime()) / 3600000) * 10) / 10;
  const mine = !!(normSlot(slot) && agent && session)
    && normSlot(claim.slot) === normSlot(slot) && claim.agent === agent && claim.session === session;
  const state = issueState === 'closed' ? 'release' : hoursLeft <= 0 ? 'expired' : hoursLeft < renewWithinHours ? 'renew' : 'ok';
  return { state, action: mine ? state : 'leave', mine, hoursLeft };
}

/** `--name value` pairs and bare `--flag`s after the subcommand. */
export function parseArgs(argv, { flags = [] } = {}) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z][a-z-]*)$/.exec(argv[i]);
    if (!m) throw new Error(`unexpected argument: ${argv[i]}`);
    if (flags.includes(m[1])) { out[m[1]] = true; continue; }
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`--${m[1]} needs a value`);
    out[m[1]] = argv[++i];
  }
  return out;
}
