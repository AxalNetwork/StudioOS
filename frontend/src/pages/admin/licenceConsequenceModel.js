/**
 * D4819 part 4 (#5927) — Licences v2 board L17: the one consequence sheet for
 * a licence's lifecycle actions, and which of them the header's More menu
 * offers.
 *
 * Every sheet answers the canvas's four questions as headings: what will
 * happen, what else it affects, what reason is recorded, and whether it can be
 * undone. The sentences describe what `admin_licences_lifecycle.ts` does, as
 * it is today; nothing here changes a write. Where a write takes no reason
 * (activate, reinstate, renew) the sheet says that no reason is recorded,
 * rather than asking for one the Worker would throw away.
 *
 * The suspension and release rules moved here from the reason dialog
 * (`licenceReasonModel.js`): the action says what it will do.
 */
import { REASON_MAX } from './licenceReasonModel';

/**
 * The four questions every sheet answers, in order (L17). D4819 part 5 (#5931): the New licence Issue step asks
 * the same four, so they are named once here.
 */
export const CONSEQUENCE_QUESTIONS = Object.freeze(['What will happen', 'What else it affects', 'Reason recorded', 'Can it be undone?']);

/** The lifecycle actions, in the order More lists them. */
export const LIFECYCLE_ACTIONS = Object.freeze(['activate', 'reinstate', 'renew', 'suspend', 'terminate']);

/**
 * The actions this licence's state allows, mirroring the Worker's state
 * machine (`services/licenceTransitions.ts`): activate a draft or pending
 * licence with no blockers; reinstate a suspended one; renew or terminate
 * anything not terminated; suspend an active one. A terminated licence is
 * offered nothing.
 */
const FROM = Object.freeze({
  activate: ['draft', 'pending_activation'],
  reinstate: ['suspended'],
  renew: ['draft', 'pending_activation', 'active', 'suspended'],
  suspend: ['active'],
  terminate: ['draft', 'pending_activation', 'active', 'suspended'],
});

export function lifecycleActionsFor(l) {
  const status = String(l?.status || '');
  const blocked = Array.isArray(l?.blockers) && l.blockers.length > 0;
  return LIFECYCLE_ACTIONS.filter((a) => FROM[a].includes(status) && !(a === 'activate' && blocked));
}

/** The More menu's label for each action. */
export const ACTION_LABELS = Object.freeze({
  activate: 'Activate', reinstate: 'Reinstate', renew: 'Renew', suspend: 'Suspend', terminate: 'Terminate',
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The licence's countries as a phrase: "France (FR)" style is not stored, so the codes. */
function countries(l) {
  const t = Array.isArray(l?.territories) ? l.territories : [];
  if (!t.length) return { n: 0, text: 'no country' };
  return { n: t.length, text: t.length === 1 ? t[0] : `${t.length} countries (${t.join(', ')})` };
}

/** The administrators, from the Overview's read: a count, or why there is none. */
function adminsNote(admins) {
  if (admins === undefined) return 'Still reading how many administrators it has.';
  if (admins === false || !Array.isArray(admins?.items)) return 'How many administrators it has could not be read.';
  if (!admins.items.length) return 'It has no administrator today.';
  return plural(admins.items.length, 'administrator');
}

/** Open fee invoices, from the Overview's read. */
function invoicesNote(invoices) {
  if (invoices === undefined) return 'Still reading its fee invoices.';
  if (invoices === false || !Array.isArray(invoices?.invoices)) return 'Its fee invoices could not be read.';
  const open = invoices.invoices.filter((i) => Number(i?.outstanding_cents) > 0);
  if (!open.length) return 'No fee invoice is open.';
  return `${plural(open.length, 'open fee invoice')} ${open.length === 1 ? 'stays' : 'stay'} open.`;
}

function branchNote(l) {
  if (l?.deployment_available === false) return 'Which branch it deploys to could not be read.';
  const host = l?.deployment?.hostname;
  return host ? `The branch at ${host}.` : 'No branch is deployed for this licence yet.';
}

/**
 * The sheet for `action` on licence `l`. `reads` are the Overview's reads
 * (`admins`, `invoices`), used only to say what else is affected.
 *
 * `{ title, confirm, tone, happens, affects, reason, undo }`: `happens` and
 * `affects` are rows `{ text, note? }`; `reason` is `{ min, max, question }`
 * when the write records one, else `{ min: null, statement }`; `undo` is
 * `{ reversible, text }`.
 */
export function licenceConsequence(action, l, reads = {}) {
  const name = l?.brand_name || 'this licence';
  const c = countries(l);
  switch (action) {
    case 'activate': return {
      title: `Activate ${name}`, confirm: 'Activate licence', tone: 'ok',
      happens: [
        { text: 'The licence becomes active', note: 'Its holder can operate under it.' },
        { text: c.n ? `It holds ${c.text}` : 'It holds no country yet' },
      ],
      affects: [
        { text: 'The branch is sent the active licence', note: branchNote(l) },
        { text: 'A pending signature does not block activation' },
      ],
      reason: { min: null, statement: 'No reason is recorded. History records who activated it, and when.' },
      undo: { reversible: true, text: 'It can be suspended or terminated later. It cannot go back to a draft.' },
    };
    case 'reinstate': return {
      title: `Reinstate ${name}`, confirm: 'Reinstate licence', tone: 'ok',
      happens: [
        { text: 'The licence is active again', note: 'It must still meet everything activation needs.' },
        { text: 'Its administrators are told, and their account can make changes again' },
      ],
      affects: [
        { text: 'The branch is sent the active licence', note: branchNote(l) },
      ],
      reason: { min: null, statement: 'No reason is recorded. History records who reinstated it, and when.' },
      undo: { reversible: true, text: 'It can be suspended again.' },
    };
    case 'renew': {
      const years = Number(l?.term_years) || 1;
      return {
        title: `Renew ${name}`, confirm: 'Renew licence', tone: 'ok',
        happens: [
          {
            text: `The renewal date moves out by ${plural(years, 'year')}`,
            note: l?.renews_on ? `From ${l.renews_on}, not from today.` : 'No renewal date is recorded, so it counts from today.',
          },
        ],
        affects: [
          { text: 'The branch is sent the new renewal date', note: branchNote(l) },
          { text: 'A terms form opened before this renewal can no longer save over it' },
        ],
        reason: { min: null, statement: 'No reason is recorded. History records who renewed it, the new date, and when.' },
        undo: { reversible: true, text: 'The renewal date can be amended on Terms.' },
      };
    }
    case 'suspend': return {
      title: `Suspend ${name}`, confirm: 'Suspend licence', tone: 'warn',
      happens: [
        { text: 'The licence is suspended', note: 'Its account can read, and cannot make changes.' },
        {
          text: c.n ? `It still holds ${c.text}` : 'It still holds its countries',
          note: 'A suspended licence still holds its countries, so no other licence can be issued over them. Releasing them is a termination, not a suspension.',
        },
      ],
      affects: [
        { text: 'Its administrators are told, with the reason', note: adminsNote(reads.admins) },
        { text: 'The branch is sent the suspended state', note: branchNote(l) },
      ],
      reason: { min: 1, max: REASON_MAX, question: 'Why is this licence being suspended? Its holder reads this.' },
      undo: { reversible: true, text: 'Reinstate makes it active again, once it meets everything activation needs.' },
    };
    case 'terminate': return {
      title: `Terminate ${name}`, confirm: 'Terminate licence', tone: 'danger',
      happens: [
        { text: 'The licence ends' },
        {
          text: c.n ? `${c.n === 1 ? c.text : `All ${c.text}`} ${c.n === 1 ? 'is' : 'are'} released for another licence` : 'No country is held, so none is released',
          note: 'Terminating releases every country this licence holds, permanently. Suspension would keep them held.',
        },
        { text: 'Its administrators lose their access', note: `${adminsNote(reads.admins)} Each is demoted, detached and deactivated; a Super Admin is skipped, with the reason.` },
      ],
      affects: [
        { text: 'The branch is sent the terminated state, and its administrators are unbound there', note: branchNote(l) },
        { text: 'Its open compliance notices are withdrawn' },
        { text: 'Its agreements, fee invoices and history are kept', note: invoicesNote(reads.invoices) },
      ],
      reason: { min: 1, max: REASON_MAX, question: 'Why is this licence being terminated? Its administrators read this.' },
      undo: { reversible: false, text: 'This cannot be undone. A terminated licence cannot be reactivated.' },
    };
    // D4819 part 21 (#5928, L18): the other writes the canvas names go through the same sheet. `reads.target`
    // carries what the write is about (the account, the invoice, the agreement, the attempt).
    case 'addAdmin': {
      const t = reads.target || {};
      const who = String(t.email || '').trim() || 'This account';
      const ref = l?.licence_ref || name;
      return {
        title: 'Add an administrator', confirm: 'Add administrator', tone: 'warn',
        happens: [
          { text: `${who} becomes a ${t.adminRole === 'delegate' ? 'delegate' : 'principal'} administrator of ${ref}`, note: 'The account is given the admin role and bound to this licence in one step.' },
          ...(l?.status === 'suspended' ? [{ text: 'This licence is suspended; the appointment still takes effect now' }] : []),
        ],
        affects: [
          { text: 'Its holder is told' },
          { text: 'An account that held a member licence keeps it' },
        ],
        reason: { min: 10, max: REASON_MAX, question: 'Why this account? It is recorded in the licence history and the audit log.', initial: t.initial || '' },
        undo: { reversible: true, text: 'Undoing it is two steps: remove the administrator, then detach the account.' },
      };
    }
    case 'removeAdmin': {
      const a = reads.target || {};
      const who = a.name || a.email || 'This administrator';
      return {
        title: `Remove ${who}`, confirm: 'Remove administrator', tone: 'danger',
        happens: [
          { text: `${who} loses the admin role now`, note: `They can no longer administer ${l?.licence_ref || name}.` },
          { text: 'The account stays bound to this licence until you detach it', note: 'Detach is the second step, offered once the role is gone.' },
        ],
        affects: [
          { text: 'Its holder is told' },
          { text: 'An account holding the Super Admin elevation is refused, and nothing changes' },
        ],
        reason: { min: 10, max: REASON_MAX, question: 'Why is this administrator being removed? It is recorded in the audit log.' },
        undo: { reversible: true, text: 'The account can be appointed again with Add administrator.' },
      };
    }
    case 'issueInvoice': {
      const t = reads.target || {};
      return {
        title: `Issue a fee invoice for ${name}`, confirm: 'Issue invoice', tone: 'warn',
        happens: [
          { text: t.amount ? `An invoice for ${t.amount} is issued` : 'An invoice is issued from the ledger’s annual fee', note: 'For the licence year that holds today. A year already invoiced is refused.' },
        ],
        affects: [
          { text: 'It is issued with a reference and a PDF, as the record is now', note: 'A later fee change applies from the next licence year, not to this invoice.' },
          { text: 'The audit log records who issued it' },
        ],
        reason: { min: null, statement: 'No reason is recorded. The audit log records who issued it, the amount and when.' },
        undo: { reversible: true, text: 'An invoice with nothing paid on it can be voided, with a reason. It is never deleted.' },
      };
    }
    case 'voidInvoice': {
      const inv = reads.target || {};
      const ref = inv.reference || 'this invoice';
      return {
        title: `Void ${ref}`, confirm: 'Void invoice', tone: 'danger',
        happens: [
          { text: `${ref} is voided`, note: 'Only an invoice with nothing paid on it can be voided.' },
        ],
        affects: [
          { text: 'It stays on the list, marked void, with the reason' },
          { text: 'The audit log records who voided it' },
        ],
        reason: { min: 10, max: REASON_MAX, question: 'Why is this invoice void? It is shown beside the invoice and recorded.' },
        undo: { reversible: false, text: 'A void invoice cannot be restored.' },
      };
    }
    case 'sendAgreement': {
      const k = reads.target || {};
      return {
        title: `Send the agreement for ${name}`, confirm: 'Send for signature', tone: 'warn',
        happens: [
          { text: `${k.label || 'The agreement'} is sent for signature` },
        ],
        affects: [
          { text: 'The signer receives it to sign' },
          { text: 'History records that it was sent', note: 'A pending signature does not block activation.' },
        ],
        reason: { min: null, statement: 'No reason is recorded. History records who sent it, and when.' },
        undo: { reversible: true, text: 'A sent agreement is not recalled from here; a new version can be drafted and sent.' },
      };
    }
    case 'deploy': return {
      title: `Deploy the branch for ${name}`, confirm: 'Deploy branch', tone: 'warn',
      happens: [
        { text: 'A branch is provisioned for this licence', note: 'HQ starts the provisioning run; it finishes on its own.' },
      ],
      affects: [
        { text: 'Its hostname is claimed for this licence' },
        { text: 'The branch receives the licence copy once it runs' },
      ],
      reason: { min: null, statement: 'No reason is recorded. The deployment record keeps who started it, and when.' },
      undo: { reversible: false, text: 'A deployed branch is not removed from here.' },
    };
    case 'retryDeploy': {
      const a = reads.target || {};
      return {
        title: 'Retry the deployment', confirm: 'Retry deployment', tone: 'warn',
        happens: [
          { text: `A new attempt replaces failed attempt ${a.attempt_no ?? ''}`.trim(), note: 'Sent twice, it starts once.' },
        ],
        affects: [
          { text: 'The branch is provisioned again', note: branchNote(l) },
        ],
        reason: { min: null, statement: 'No reason is recorded. The attempts list records each try.' },
        undo: { reversible: true, text: 'A retry that fails can be retried or reconciled again.' },
      };
    }
    case 'reconcileDeploy': return {
      title: 'Reconcile the deployment', confirm: 'Reconcile', tone: 'ok',
      happens: [
        { text: 'HQ reads what the provisioning run did, and records it', note: 'Reconcile never starts a run.' },
      ],
      affects: [
        { text: 'The current attempt’s state is updated from that read' },
      ],
      reason: { min: null, statement: 'No reason is recorded. It only reads, and records what it found.' },
      undo: { reversible: true, text: 'Nothing is changed but the recorded state, which the next read can correct.' },
    };
    case 'syncRetry': return {
      title: `Retry branch sync for ${name}`, confirm: 'Retry branch sync', tone: 'ok',
      happens: [
        { text: 'HQ sends the licence’s current copy to its branch now', note: 'HQ’s own record does not change; it numbers the copy and records what the branch answers.' },
      ],
      affects: [
        { text: 'The branch is sent the copy', note: branchNote(l) },
        { text: 'HQ’s own hourly re-send carries on either way' },
      ],
      reason: { min: null, statement: 'No reason is recorded. The audit log records who retried it, the revision sent and how it ended.' },
      undo: { reversible: true, text: 'It only re-sends what HQ already holds.' },
    };
    default: return null;
  }
}

/** D4819 part 21 (#5928): every write that goes through the sheet, the nine L18 names first. */
export const SHEET_ACTIONS = Object.freeze([
  'addAdmin', 'removeAdmin', 'issueInvoice', 'voidInvoice', 'sendAgreement', 'deploy', 'retryDeploy', 'reconcileDeploy', 'syncRetry',
  ...LIFECYCLE_ACTIONS,
]);
