/**
 * D5920 (#5920) — the territory licence agreement's lifecycle (board L08 of Licences v2), pure so the tests read it
 * without a page. Input is `GET /api/admin/licences/:uid/contract`'s `contracts` (every instantiated contract,
 * newest first; `status` follows the envelope when one exists, D451).
 *
 * VERSIONS. A contract's agreement version is its place in instantiation order: the first is v1. The template's own
 * version is a different number and is shown as the template's.
 *
 * THE EXECUTED AGREEMENT is the newest contract whose status is `signed`. A re-issue supersedes every earlier row
 * (`superseded_at`), the executed one included, but until the new version is executed the old one is still what the
 * parties signed (L09: "Until v5 is signed, v4 stays the executed agreement"). An older executed contract is
 * Superseded.
 *
 * FOUR THINGS, NEVER ONE BADGE. Ledger terms, the draft, the one out for signature and the executed agreement each
 * have their own state. A draft or a sent contract counts only while it is current (not superseded). The ledger
 * terms' comparison with the executed agreement is Not instrumented: no read makes it (D5920 §3).
 *
 * The word is "Executed", never "Signed" (#5796).
 */
import { dateWord } from '../licenceRegistryModel.js';

export const NOT_INSTRUMENTED = 'Not instrumented';

/** Every contract with its agreement version, oldest first. */
function numbered(contracts) {
  return [...(contracts || [])]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((k, i) => ({ ...k, agreement_version: i + 1 }));
}

/** The newest executed contract, numbered, or null. */
export function executedAgreement(contracts) {
  const signed = numbered(contracts).filter((k) => k.status === 'signed');
  return signed.length ? signed[signed.length - 1] : null;
}

/** The current (not superseded) contract, numbered, or null. */
export function currentContract(contracts) {
  return numbered(contracts).filter((k) => !k.superseded_at).pop() || null;
}

/** One contract's state in words, given which one is executed. */
export function versionState(k, executed) {
  if (k.status === 'signed') return executed && k.uid === executed.uid ? 'Executed' : 'Superseded';
  if (k.superseded_at) return 'Superseded';
  if (k.status === 'void') return 'Void';
  if (k.status === 'sent') return 'Sent for signature';
  return 'Draft';
}

/** The date that goes with a state: executed on, sent on, else instantiated on. */
export function versionDate(k) {
  const day = (v) => dateWord(String(v).slice(0, 10));
  if (k.status === 'signed' && k.signed_at) return `Executed ${day(k.signed_at)}`;
  if (k.sent_at) return `Sent ${day(k.sent_at)}`;
  return k.created_at ? `Instantiated ${day(k.created_at)}` : 'Not recorded';
}

/** The version history, newest first. */
export function versionRows(contracts) {
  const executed = executedAgreement(contracts);
  return numbered(contracts).reverse().map((k) => ({
    uid: k.uid,
    version: `v${k.agreement_version}`,
    state: versionState(k, executed),
    date: versionDate(k),
    template: `${k.template_slug || 'Not recorded'} v${k.template_version ?? '?'}`,
    envelopeUnreadable: !!k.envelope_unreadable,
  }));
}

/**
 * The four stage cards: Ledger terms, Draft agreement, Sent for signature, Executed. Each is
 * `{ label, state, line }`; `state` is the card's own word, and None means the read succeeded and holds none.
 */
export function stageCards(contracts) {
  const executed = executedAgreement(contracts);
  const current = currentContract(contracts);
  const draft = current && current.status === 'draft' ? current : null;
  const sent = current && current.status === 'sent' ? current : null;
  const missing = draft?.unfilled_fields?.length || 0;
  return [
    { label: 'Ledger terms', state: NOT_INSTRUMENTED, line: 'No read compares the ledger terms with an agreement.' },
    draft
      ? { label: 'Draft agreement', state: 'Draft', line: `v${draft.agreement_version} · ${missing ? `${missing} ${missing === 1 ? 'field' : 'fields'} missing` : 'ready to send'}` }
      : { label: 'Draft agreement', state: 'None', line: 'No draft is open.' },
    sent
      ? { label: 'Sent for signature', state: 'Sent for signature', line: `v${sent.agreement_version} · ${versionDate(sent)}` }
      : { label: 'Sent for signature', state: 'None', line: 'Nothing is out for signature.' },
    executed
      ? { label: 'Executed', state: 'Executed', line: `v${executed.agreement_version} · ${executed.signed_at ? dateWord(String(executed.signed_at).slice(0, 10)) : 'date not recorded'}` }
      : { label: 'Executed', state: 'None', line: 'No agreement has been executed.' },
  ];
}
