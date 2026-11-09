/**
 * D4819 (#4819), Build part 3 — a licence's identity header and its Overview
 * (Licences v2 boards L03 and L04), as pure functions over reads that already
 * exist:
 *
 *   licence      GET /api/admin/licences/:uid           (status, terms, sync, deployment)
 *   contract     GET /api/admin/licences/:uid/contract  (the licence agreement)
 *   deployment   GET /api/admin/licences/:uid/deployment (the provisioning attempts)
 *   requests     GET /api/admin/licences/:uid/requests?limit=1 (open requests, oldest first)
 *   invoices     GET /api/admin/licences/:uid/fee-invoices
 *   admins       GET /api/admin/licences/:uid/admins
 *
 * Each read is `undefined` while it is on its way, `false` when it failed, or
 * its reply. Seven facts are kept apart (Licence, Agreement, Commercial,
 * Access, Branch, Billing, Requests) and are never folded into one badge or a
 * score: a licence can be Active, Executed, out of sync, overdue and have two
 * requests waiting all at once (L04).
 *
 * A fact's `state` is one of
 *   ok | attention | problem | neutral   a value the read carries, and how it stands;
 *   none                                 the read succeeded and there is nothing;
 *   not_recorded                         no value is on the record;
 *   unavailable                          the read failed (offered with Try again);
 *   not_instrumented                     no read carries it at all;
 *   reading                              not answered yet.
 * The page draws every state with a word and a shape, never colour alone, and
 * none of them is ever a 0.
 */
import { bpsPercent as pct } from '../../lib/bps';
import { TOKEN_SPLIT_HQ_LABEL } from '../../lib/tokenSplit';
import { toUtcInstant } from '../../lib/notices';
import { agreementOf } from './licenceTermsAmendModel';
import { renewalApproaching, renewalCell, territoryCell } from './licenceLedgerModel';
import { money } from './licenceFeeInvoicesModel';

export const NOT_RECORDED = 'Not recorded';
export const UNAVAILABLE = 'Unavailable';
export const NOT_INSTRUMENTED = 'Not instrumented';
export const READING = 'Reading…';

/** The reads the Overview makes beside the licence, in the order it makes them. */
export const OVERVIEW_READS = Object.freeze(['contract', 'deployment', 'requests', 'invoices', 'admins']);

const fact = (key, label, state, word, detail = null, extra = {}) => ({ key, label, state, word, detail, ...extra });
const day = (v) => (v ? String(v).slice(0, 10) : null);

/** Whole days between two instants (b − a), or null when either is not a date. */
function daysBetween(a, b) {
  const x = Date.parse(toUtcInstant(a) || '');
  const y = Date.parse(toUtcInstant(b) || '');
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.floor((y - x) / 86400000);
}

/** "14:30 UTC" for an instant, or the text as it came when it is not one. */
export function clockText(iso) {
  if (!iso) return null;
  const d = new Date(toUtcInstant(iso) || '');
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`;
}

/** A read that failed, said the same way for every fact: Unavailable, with the read to try again. */
const unavailable = (key, label, what, retry) => fact(key, label, 'unavailable', UNAVAILABLE, `${what} could not be read. This is not a sign that there is none.`, { retry });
const reading = (key, label) => fact(key, label, 'reading', READING);

/* ------------------------------------------------------------------ *
 * The seven facts                                                     *
 * ------------------------------------------------------------------ */

export const STATUS_WORD = Object.freeze({
  active: 'Active', suspended: 'Suspended', pending_activation: 'Pending activation', draft: 'Draft', terminated: 'Terminated',
});
const STATUS_STATE = Object.freeze({
  active: 'ok', suspended: 'problem', pending_activation: 'attention', draft: 'neutral', terminated: 'neutral',
});

/** Licence: its status, from the ledger row. */
export function licenceFact(l) {
  const word = STATUS_WORD[l?.status] || NOT_RECORDED;
  const state = STATUS_STATE[l?.status] || 'not_recorded';
  let detail = null;
  if (l?.status === 'active') detail = l.starts_on ? `Since ${day(l.starts_on)}` : `Start date ${NOT_RECORDED.toLowerCase()}`;
  else if (l?.status === 'suspended') detail = l.status_note ? `Suspended: ${l.status_note}` : 'Still holds its countries while suspended';
  else if (l?.status === 'terminated') detail = l.terminated_at ? `Terminated ${day(l.terminated_at)}` : null;
  else if (Array.isArray(l?.blockers) && l.blockers.length) detail = `${l.blockers.length} ${l.blockers.length === 1 ? 'thing' : 'things'} to do before it can be activated`;
  return fact('licence', 'Licence', state, word, detail);
}

/**
 * Agreement: the licence agreement the contract read holds. Whether today's
 * terms still match an executed agreement is NOT instrumented: a contract
 * records its template and hash, not the terms revision it was issued from,
 * so it is said as that rather than guessed from event times.
 */
export function agreementFact(contract) {
  const label = 'Agreement';
  if (contract === undefined) return reading('agreement', label);
  if (contract === false || contract?.contracts_available === false) return unavailable('agreement', label, 'The licence agreements', 'contract');
  const a = agreementOf(contract.contracts);
  if (!a) return fact('agreement', label, 'none', 'None issued', 'No licence agreement has been issued.');
  const name = `${a.template_title || 'Licence agreement'} · template v${a.template_version ?? '?'}`;
  const match = { note: `Whether today’s terms still match it: ${NOT_INSTRUMENTED}` };
  if (a.status === 'signed') return fact('agreement', label, 'ok', 'Executed', `${name}${a.signed_at ? ` · signed ${day(a.signed_at)}` : ''}`, { ...match, signedOn: day(a.signed_at) });
  if (a.status === 'sent') return fact('agreement', label, 'attention', 'Out for signature', `${name}${a.sent_at ? ` · sent ${day(a.sent_at)}` : ''}`, match);
  const missing = Array.isArray(a.unfilled_fields) ? a.unfilled_fields.length : 0;
  return fact('agreement', label, 'attention', 'Draft', `${name} · ${missing ? `${missing} ${missing === 1 ? 'field' : 'fields'} not filled` : 'not sent'}`);
}

/** Commercial: the core terms on the ledger row. A term nobody set reads Not recorded, never 0. */
export function commercialFact(l) {
  const feeCents = l?.annual_fee_cents;
  const hasFee = feeCents !== null && feeCents !== undefined;
  const currency = l?.currency || null;
  const fee = hasFee ? (currency ? `${money(Math.round(Number(feeCents)), currency)} / year` : `${NOT_RECORDED} currency`) : null;
  const share = pct(l?.revenue_share_bps);
  if (!fee && !share) return fact('commercial', 'Commercial', 'not_recorded', NOT_RECORDED, 'No annual fee or revenue share is recorded.');
  const word = `${fee || `Annual fee ${NOT_RECORDED.toLowerCase()}`} · ${share ? `${share} revenue share` : `revenue share ${NOT_RECORDED.toLowerCase()}`}`;
  const split = pct(l?.token_split_bps);
  return fact('commercial', 'Commercial', 'neutral', word, `${TOKEN_SPLIT_HQ_LABEL}: ${split || NOT_RECORDED}`);
}

/** Access: administrators from the admins read; seats from the ledger row; utilisation is not recorded. */
export function accessFact(l, admins) {
  const label = 'Access';
  const seatKeys = l?.seats && typeof l.seats === 'object' ? Object.keys(l.seats) : [];
  const seats = seatKeys.length ? `${Number(l.seats_licensed) || 0} seats licensed` : `Seats ${NOT_RECORDED.toLowerCase()}`;
  const detail = `${seats} · utilisation ${NOT_RECORDED.toLowerCase()}`;
  if (admins === undefined) return fact('access', label, 'reading', READING, detail);
  if (admins === false || !Array.isArray(admins?.items)) return unavailable('access', label, 'The administrators', 'admins');
  const n = admins.items.length;
  if (!n) {
    // Only a running licence needs one; a draft is issued before anybody is named on it.
    const needs = ['active', 'suspended'].includes(l?.status);
    return fact('access', label, needs ? 'attention' : 'none', 'No administrator', detail, needs ? { need: 'admin' } : {});
  }
  return fact('access', label, 'neutral', `${n} ${n === 1 ? 'administrator' : 'administrators'}`, detail);
}

/** Why a push has not landed, in an operator's words (#4686's failure codes). */
export const SYNC_FAILURE_SENTENCES = Object.freeze({
  not_bound: 'HQ has no connection to this branch yet.',
  unreachable: 'The branch did not answer.',
  refused: 'The branch refused the copy.',
  partial: 'The branch holds the licence but not every section of it.',
  stale_revision: 'The branch already holds a later revision.',
  assemble_failed: 'HQ could not assemble the copy.',
  licence_unreadable: 'HQ could not read the licence to send it.',
  deployment_unreadable: 'HQ could not tell which branch to send it to.',
  termination: 'The termination copy has not reached the branch yet.',
});
export const syncFailureSentence = (code) => (code ? SYNC_FAILURE_SENTENCES[code] || 'It has not landed yet.' : null);

const DEPLOY_WORD = Object.freeze({
  refused: ['problem', 'Deployment failed'],
  unknown: ['attention', 'Deployment outcome unknown'],
  partial: ['attention', 'Partly provisioned'],
  pending: ['attention', 'Deploying'],
});

/**
 * Branch: where the licence's branch stands. Built from the deployment
 * registry (is there a branch, and did its provisioning finish) and #4686's
 * sync record (`sync` on the licence read): the last revision HQ numbered and
 * the last one a branch accepted in answer to a push. HQ does not ask a branch
 * what it holds on its own, so "accepted" is the branch's answer to HQ's last
 * push, and the fact says so instead of claiming a live reading.
 */
export function branchFact(l, deployment) {
  const label = 'Branch';
  if (l?.deployment_available === false) return unavailable('branch', label, 'The deployment registry', 'licence');
  if (!l?.deployment) return fact('branch', label, 'none', 'No branch deployed', 'Nothing is sent until a branch is deployed for this licence.');
  const host = l.deployment.hostname || null;
  const phase = deployment && deployment !== false ? deployment.deployment?.phase : null;
  if (phase && DEPLOY_WORD[phase]) {
    const [state, word] = DEPLOY_WORD[phase];
    const failed = deployment.deployment?.last_failure;
    const detail = phase === 'refused' && failed?.settled_at ? `Last attempt failed ${clockText(failed.settled_at)}` : host;
    return fact('branch', label, state, word, detail, phase === 'refused' ? { need: 'deploy' } : {});
  }
  const sync = l.sync;
  if (!sync || sync.available === false) return unavailable('branch', label, 'The branch sync record', 'licence');
  const p = sync.pending;
  if (p) {
    const of = sync.hq_revision ? ` · branch on ${sync.branch_revision ?? NOT_RECORDED.toLowerCase()} of ${sync.hq_revision}` : '';
    const when = p.last_attempt_at ? ` · last attempt ${clockText(p.last_attempt_at)}` : '';
    return fact('branch', label, 'problem', 'Update pending', `${syncFailureSentence(p.failure_code) || 'It has not landed yet.'}${of}${when}`, { need: 'sync' });
  }
  if (sync.hq_revision == null) {
    return fact('branch', label, 'not_recorded', NOT_RECORDED, 'HQ has not numbered a revision for this branch yet.');
  }
  if (sync.branch_revision != null && sync.branch_revision >= sync.hq_revision) {
    return fact('branch', label, 'ok', `Synced · revision ${sync.hq_revision}`,
      sync.last_success_at ? `Accepted ${clockText(sync.last_success_at)}` : `Accepted at a time ${NOT_RECORDED.toLowerCase()}`);
  }
  // HQ numbered a revision the branch has not accepted, and no retry is queued for it.
  return fact('branch', label, 'problem', 'Out of sync',
    `Revision ${sync.branch_revision ?? NOT_RECORDED.toLowerCase()} of ${sync.hq_revision}`, { need: 'sync' });
}

/** Billing: the annual-fee invoices. Overdue is an issued invoice with money outstanding past its due date. */
export function billingFact(invoices, now = new Date().toISOString()) {
  const label = 'Billing';
  if (invoices === undefined) return reading('billing', label);
  if (invoices === false || !Array.isArray(invoices?.invoices)) return unavailable('billing', label, 'The annual fee invoices', 'invoices');
  const live = invoices.invoices.filter((i) => i.status !== 'void');
  const overdue = live.filter((i) => i.status === 'issued' && Number(i.outstanding_cents) > 0 && daysBetween(i.due_at, now) > 0);
  if (overdue.length) {
    const oldest = overdue.reduce((a, b) => (String(a.due_at) <= String(b.due_at) ? a : b));
    const owed = overdue.reduce((s, i) => s + Number(i.outstanding_cents), 0);
    return fact('billing', label, 'problem', `Overdue · ${money(owed, oldest.currency)}`,
      `Due ${day(oldest.due_at)} · ${daysBetween(oldest.due_at, now)} days overdue`, { need: 'overdue' });
  }
  const open = live.filter((i) => i.status === 'issued' && Number(i.outstanding_cents) > 0);
  if (open.length) {
    const next = open.reduce((a, b) => (String(a.due_at) <= String(b.due_at) ? a : b));
    return fact('billing', label, 'neutral', `Issued · ${money(Number(next.outstanding_cents), next.currency)} outstanding`, `Due ${day(next.due_at)}`);
  }
  if (live.length) {
    const last = live[0];
    return fact('billing', label, 'ok', 'Paid', `${last.period_label || 'Latest licence year'}${last.paid_at ? ` · paid ${day(last.paid_at)}` : ''}`);
  }
  const noFee = !Number.isSafeInteger(invoices.annual_fee_cents) || invoices.annual_fee_cents <= 0;
  return fact('billing', label, 'none', 'No invoices issued', noFee ? 'No annual fee is recorded, so nothing can be invoiced.' : null);
}

/** Requests: open requests from the Administrator, from the requests read (oldest first). */
export function requestsFact(requests, now = new Date().toISOString()) {
  const label = 'Requests';
  if (requests === undefined) return reading('requests', label);
  if (requests === false || requests?.available === false || !Number.isFinite(requests?.total)) return unavailable('requests', label, 'HQ’s request board', 'requests');
  const branchNote = requests.branch_readable === false ? 'The branch’s own requests could not be looked up.' : null;
  // None at HQ while the branch's lane could not be looked up is not None: it is partly unknown.
  if (!requests.total) {
    return branchNote
      ? fact('requests', label, 'unavailable', 'Partly unavailable', `None at HQ. ${branchNote}`, { retry: 'requests' })
      : fact('requests', label, 'none', 'None');
  }
  const oldest = Array.isArray(requests.items) ? requests.items[0] : null;
  const age = oldest?.created_at ? daysBetween(oldest.created_at, now) : null;
  const detail = [age === null ? null : `Oldest ${age === 0 ? 'today' : `${age} ${age === 1 ? 'day' : 'days'}`}`, branchNote].filter(Boolean).join(' · ') || null;
  return fact('requests', label, 'attention', `${requests.total} waiting`, detail, { need: 'requests', count: requests.total });
}

/** The seven facts, in the canvas's order. */
export function overviewFacts(l, reads = {}, now) {
  return [
    licenceFact(l),
    agreementFact(reads.contract),
    commercialFact(l),
    accessFact(l, reads.admins),
    branchFact(l, reads.deployment),
    billingFact(reads.invoices, now),
    requestsFact(reads.requests, now),
  ];
}

/* ------------------------------------------------------------------ *
 * What needs HQ (the L04 strip)                                       *
 * ------------------------------------------------------------------ */

const NEED_TEXT = Object.freeze({
  requests: (f) => `${f.count} ${f.count === 1 ? 'request' : 'requests'} waiting`,
  overdue: () => 'Annual invoice overdue',
  sync: () => 'Branch has not received the current revision',
  deploy: () => 'Branch deployment failed',
  admin: () => 'No administrator appointed',
});

/**
 * The items that need HQ, from the facts, plus the renewal from the ledger
 * row. `unknown` names the facts whose read failed, so a strip with nothing in
 * it never reads as "nothing needs HQ" when it could not look.
 */
export function attentionItems(l, facts) {
  const items = [];
  for (const f of facts) if (f.need && NEED_TEXT[f.need]) items.push({ key: f.need, section: f.key, text: NEED_TEXT[f.need](f) });
  if (renewalApproaching(l)) {
    const r = renewalCell(l);
    items.push({ key: 'renewal', section: 'licence', text: r.state === 'overdue' ? 'Renewal date has passed' : 'Renewal approaching' });
  }
  const unknown = facts.filter((f) => f.state === 'unavailable').map((f) => f.label);
  const pending = facts.some((f) => f.state === 'reading');
  return { items, unknown, pending };
}

/* ------------------------------------------------------------------ *
 * The identity header                                                 *
 * ------------------------------------------------------------------ */

export const KIND_WORD = Object.freeze({ subsidiary: 'Axal subsidiary', white_label: 'White-label' });

/**
 * The header's facts, each `{ label, state, text }`: reference, territory,
 * type, primary status, renewal, the executed agreement and the branch. The
 * agreement and branch lines are the Overview's own facts, so the two never
 * disagree.
 */
export function identityFacts(l, facts) {
  const by = Object.fromEntries(facts.map((f) => [f.key, f]));
  const terr = territoryCell(l);
  const ren = renewalCell(l);
  const ag = by.agreement;
  const br = by.branch;
  return [
    { key: 'ref', label: 'Reference', state: l?.licence_ref ? 'neutral' : 'not_recorded', text: l?.licence_ref || NOT_RECORDED },
    { key: 'territory', label: 'Territory', state: terr.state === 'value' ? 'neutral' : terr.state, text: terr.label },
    { key: 'type', label: 'Type', state: KIND_WORD[l?.kind] ? 'neutral' : 'not_recorded', text: KIND_WORD[l?.kind] || NOT_RECORDED },
    { key: 'status', label: 'Status', state: by.licence.state, text: by.licence.word },
    {
      key: 'renewal', label: 'Renewal',
      state: ren.state === 'value' ? 'neutral' : ren.state === 'overdue' ? 'problem' : ren.state === 'due' ? 'attention' : ren.state,
      text: ren.label,
    },
    {
      key: 'agreement', label: 'Executed agreement', state: ag.state, retry: ag.retry,
      text: ag.state === 'ok' ? `Executed${ag.signedOn ? ` · signed ${ag.signedOn}` : ''}`
        : ag.state === 'none' ? 'None issued'
          : ag.state === 'attention' ? `Not executed · ${ag.word.toLowerCase()}` : ag.word,
    },
    { key: 'branch', label: 'Branch sync', state: br.state, retry: br.retry, text: br.word },
  ];
}

/* ------------------------------------------------------------------ *
 * Sources                                                             *
 * ------------------------------------------------------------------ */

/**
 * Where the facts come from and how fresh each is. The ledger is read when
 * the licence opens; the branch line is what the branch last answered to a
 * push, never a reading HQ took of the branch itself (D4819, Backend required).
 */
export function sourcesOf(l, readAt) {
  const out = [{ key: 'ledger', label: 'HQ ledger', text: readAt ? `Read ${clockText(readAt)}` : READING }];
  const sync = l?.sync;
  if (l?.deployment_available === false || sync?.available === false) {
    out.push({ key: 'branch', label: 'Branch', text: UNAVAILABLE, state: 'unavailable' });
  } else if (!l?.deployment) {
    out.push({ key: 'branch', label: 'Branch', text: 'No branch deployed', state: 'none' });
  } else {
    const rev = sync?.branch_revision != null ? ` · revision ${sync.branch_revision}` : '';
    out.push({
      key: 'branch', label: l.deployment.hostname ? `Branch at ${l.deployment.hostname}` : 'Branch',
      text: sync?.last_success_at ? `Last accepted a copy ${clockText(sync.last_success_at)}${rev}` : `Last accepted copy ${NOT_RECORDED.toLowerCase()}`,
      state: sync?.last_success_at ? 'neutral' : 'not_recorded',
    });
  }
  return out;
}
