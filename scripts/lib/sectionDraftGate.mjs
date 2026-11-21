// D5985 (#5985): may a reproduced section defect get one automatic draft fix?
// A pure eligibility check. It reads only the observation it is handed, makes no
// GitHub call, starts no workflow and calls no agent. Dispatch is #5986's.
import { cases } from '../section-triage.mjs';

// Budget. Owner review: these limits are a first proposal (D5985).
export const MAX_ATTEMPTS_PER_ISSUE = 2;
export const MAX_CONCURRENT_DRAFTS = 1;
export const MAX_BRANCHES_PER_ISSUE = 1;
export const MAX_PRS_PER_ISSUE = 1;

// The only evidence, event and classification that can open a draft.
export const TRUSTED_SOURCE = 'operator-reproduced';
export const TRUSTED_EVENT = 'operator-reproduced';
export const ORDINARY_DEFECT = 'ordinary-ui-regression';

// Every reason the gate can give. A refusal carries exactly one of these.
export const REASONS = Object.freeze({
  stopped: 'stopped',
  invalidInput: 'invalid-input',
  unexpectedField: 'unexpected-field',
  untrustedText: 'excluded-untrusted-text',
  mention: 'excluded-mention',
  security: 'excluded-security-finding',
  permissions: 'excluded-permissions',
  financialLegal: 'excluded-financial-legal-record',
  credentials: 'excluded-production-credentials',
  migration: 'excluded-data-migration',
  deploy: 'excluded-deploy',
  selfGenerated: 'self-generated-event',
  untrustedEvent: 'untrusted-event',
  caseNotAllowlisted: 'case-not-allowlisted',
  notOrdinary: 'not-ordinary-defect',
  untrustedEvidence: 'evidence-untrusted',
  notReproduced: 'not-reproduced',
  triageUnmet: 'triage-criteria-unmet',
  duplicate: 'duplicate-incident',
  noOwner: 'no-eligible-owner',
  claim: 'existing-claim',
  openPr: 'open-pr',
  inFlight: 'in-flight-work',
  branchBudget: 'branch-exists',
  prBudget: 'pr-exists',
  attemptBudget: 'attempt-budget-exhausted',
  concurrencyBudget: 'concurrency-budget-exhausted',
});

// #5681's excluded inputs. A classification or a touched area named here is
// refused with its own code; any other classification is not-ordinary-defect.
const EXCLUDED = new Map([
  ['security', REASONS.security],
  ['permissions', REASONS.permissions],
  ['financial-record', REASONS.financialLegal],
  ['legal-record', REASONS.financialLegal],
  ['production-credentials', REASONS.credentials],
  ['data-migration', REASONS.migration],
  ['deploy', REASONS.deploy],
]);
export const EXCLUDED_AREAS = Object.freeze([...EXCLUDED.keys()]);

// Free text has no field in the input. A key that looks like one is refused as
// untrusted report text before any other unknown key.
const TEXT_KEYS = new Set(['text', 'body', 'title', 'report', 'comment', 'message', 'description', 'summary', 'url']);

const SHAPE = {
  top: ['stop', 'issue', 'case', 'baseCommit', 'event', 'evidence', 'classification', 'touches', 'triage', 'work', 'budget'],
  event: ['kind', 'actor', 'origin'],
  evidence: ['source', 'reproduced'],
  triage: ['criteriaMet', 'duplicate', 'ownerVerified'],
  work: ['claim', 'openPr', 'inFlight'],
  budget: ['attempts', 'branches', 'prs', 'concurrentDrafts'],
};

const no = reason => Object.freeze({ eligible: false, reason });
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isBool = v => v === true || v === false;
const isCount = v => Number.isSafeInteger(v) && v >= 0;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?$/i;

// The case allowlist is section-triage's own map, read once. New cases need a
// reviewed change there.
const allowlist = new Map([...cases].map(([key, spec]) => [key, Object.freeze({ source: spec.file, test: spec.test })]));

function shapeProblem(input) {
  const groups = [[input, SHAPE.top]];
  for (const name of ['event', 'evidence', 'triage', 'work', 'budget']) {
    if (!isObject(input[name])) return REASONS.invalidInput;
    groups.push([input[name], SHAPE[name]]);
  }
  for (const [object] of groups) if (Object.keys(object).some(k => TEXT_KEYS.has(k.toLowerCase()))) return REASONS.untrustedText;
  for (const [object, keys] of groups) if (Object.keys(object).some(k => !keys.includes(k))) return REASONS.unexpectedField;
  // Every field is type-checked below, so a missing one is invalid-input too.
  const { event, evidence, triage, work, budget } = input;
  const valid = Number.isSafeInteger(input.issue) && input.issue > 0
    && typeof input.case === 'string' && typeof input.classification === 'string'
    && typeof input.baseCommit === 'string' && /^[0-9a-f]{40}$/.test(input.baseCommit)
    && Array.isArray(input.touches) && input.touches.every(t => typeof t === 'string')
    && typeof event.kind === 'string' && typeof event.origin === 'string'
    && typeof event.actor === 'string' && LOGIN.test(event.actor)
    && typeof evidence.source === 'string' && isBool(evidence.reproduced)
    && isBool(triage.criteriaMet) && isBool(triage.duplicate) && isBool(triage.ownerVerified)
    && isBool(work.claim) && isBool(work.openPr) && isBool(work.inFlight)
    && SHAPE.budget.every(k => isCount(budget[k]));
  return valid ? null : REASONS.invalidInput;
}

// eligible(input) → { eligible: true, job } or { eligible: false, reason }.
// The rules run in a fixed order; the first that fails names the refusal.
export function eligible(input) {
  // Stop switch: anything but an explicit `stop: false` stops every call.
  if (!isObject(input) || input.stop !== false) return no(REASONS.stopped);
  const problem = shapeProblem(input);
  if (problem) return no(problem);
  const { event, evidence, triage, work, budget } = input;

  if (event.origin === 'automation' || /\[bot\]$/i.test(event.actor)) return no(REASONS.selfGenerated);
  if (event.kind === 'mention') return no(REASONS.mention);
  if (event.kind === 'report') return no(REASONS.untrustedText);
  if (event.kind !== TRUSTED_EVENT || event.origin !== 'operator') return no(REASONS.untrustedEvent);

  const spec = allowlist.get(input.case);
  if (!spec) return no(REASONS.caseNotAllowlisted);

  if (EXCLUDED.has(input.classification)) return no(EXCLUDED.get(input.classification));
  const touched = EXCLUDED_AREAS.find(area => input.touches.includes(area));
  if (touched) return no(EXCLUDED.get(touched));
  if (input.touches.length > 0) return no(REASONS.invalidInput);
  if (input.classification !== ORDINARY_DEFECT) return no(REASONS.notOrdinary);

  if (evidence.source !== TRUSTED_SOURCE) return no(REASONS.untrustedEvidence);
  if (evidence.reproduced !== true) return no(REASONS.notReproduced);

  if (triage.criteriaMet !== true) return no(REASONS.triageUnmet);
  if (triage.duplicate) return no(REASONS.duplicate);
  if (triage.ownerVerified !== true) return no(REASONS.noOwner);

  if (work.claim) return no(REASONS.claim);
  if (work.openPr) return no(REASONS.openPr);
  if (work.inFlight) return no(REASONS.inFlight);

  if (budget.branches >= MAX_BRANCHES_PER_ISSUE) return no(REASONS.branchBudget);
  if (budget.prs >= MAX_PRS_PER_ISSUE) return no(REASONS.prBudget);
  if (budget.attempts >= MAX_ATTEMPTS_PER_ISSUE) return no(REASONS.attemptBudget);
  if (budget.concurrentDrafts >= MAX_CONCURRENT_DRAFTS) return no(REASONS.concurrencyBudget);

  // The job carries fixed fields only. Paths come from the allowlist, never the input.
  const job = Object.freeze({ issue: input.issue, caseKey: input.case, sourcePath: spec.source, testPath: spec.test, baseCommit: input.baseCommit });
  return Object.freeze({ eligible: true, job });
}

export const JOB_FIELDS = Object.freeze(['issue', 'caseKey', 'sourcePath', 'testPath', 'baseCommit']);
