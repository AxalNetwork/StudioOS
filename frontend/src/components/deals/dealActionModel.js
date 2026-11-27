/**
 * D5914 (#5914, Deals v2 board DE14, canvas section DX14): the rules the
 * consequential deal dialogs share (Pass, Move to diligence, Commit, Withdraw,
 * Record transfer), kept pure so a test reads them without a page.
 *
 *   - A refusal is the Worker's own sentence, kept in the dialog. A failure
 *     with no sentence (the network, a crash) reads as the caller's fallback,
 *     never as a raw error.
 *   - In Super Admin Investor preview (D5915, the owner's answer B) the action
 *     is not offered: the dialog says so and offers Return to HQ instead.
 *   - Commit names the amount, the currency, the firm and asks for a
 *     confirmation. Record transfer says when an open IC condition holds it.
 */
import { dealMoney } from './dealMoney.js';

export const PREVIEW_NOTICE = 'You are previewing the Investor interface as Super Admin.';
export const PREVIEW_LINE = 'Return to HQ to perform this action. Nothing is recorded from the preview.';
export const PREVIEW_ACT = 'Return to HQ';
export const NOTHING_RECORDED = 'Nothing was recorded.';

/** The tab is in Super Admin Investor preview: the same test the shell uses to send `X-Axal-Preview-Shell`. */
export function previewActive(mode) {
  return !!(mode && mode.superAdmin === true && mode.viewMode === 'investor' && !mode.isImpersonating);
}

/**
 * The sentence a refusal prints: the Worker's own (a request error carries a
 * `status` or a `code`), else `fallback`. A string is a local check's sentence.
 */
export function refusalWords(e, fallback) {
  if (typeof e === 'string') return e;
  const said = e && (e.status || e.code) && typeof e.message === 'string' ? e.message.trim() : '';
  return said || fallback;
}

/** Whether a sentence already says that nothing changed, so the dialog does not say it twice. */
export function saysNothingChanged(sentence) {
  return /\bnothing\b[^.]*\b(recorded|changed|saved|moved|written)\b|\bnot (recorded|saved)\b|\bnothing changed\b/i.test(String(sentence || ''));
}

// ---------------------------------------------------------------- Commit

/** The checks before a commitment is sent: a positive amount, at least the minimum, and the confirmation ticked. */
export function commitCheck({ amount, minimum, currency = 'USD', confirmed }) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return 'Enter a positive amount.';
  if (minimum && amt < Number(minimum)) return `Minimum check is ${dealMoney(minimum, currency) || 'Not recorded'}.`;
  if (!confirmed) return 'Tick the confirmation to commit.';
  return null;
}

/** The commit button: "Commit €100,000", or "Commit" while no amount reads; a change says "Save the change". */
export function commitActLabel(amount, currency = 'USD', changing = false) {
  if (changing) return 'Save the change';
  const amt = Number(amount);
  const money = Number.isFinite(amt) && amt > 0 ? dealMoney(amt, currency) : null;
  return money ? `Commit ${money}` : 'Commit';
}

export const COMMIT_ACK = 'I confirm this commitment. It is recorded, not transferred.';

/**
 * The firm a commitment is held under: the Worker takes it from the company
 * switcher, or the only firm the investor belongs to (`transferFirm`). With
 * none chosen the dialog says so and does not guess one.
 */
export function firmLine(company) {
  const name = String(company?.company_name || '').trim();
  if (name) return { named: true, text: name };
  return { named: false, text: 'None chosen in the company switcher. With one firm it is held under that firm; with none, as your own.' };
}

// ---------------------------------------------------------------- Withdraw

/** The line above the reason: what is withdrawn, and what it stops. */
export function withdrawLine({ amount, venture, confirmed }) {
  const what = `${amount || 'Your commitment'}${venture ? ` to ${venture}` : ''}`;
  return `${what} · ${confirmed ? 'Confirmed' : 'Pending'}. It stops counting toward the round. Your reason is kept with the withdrawal in the studio’s record.`;
}

// ---------------------------------------------------------------- Record transfer

/**
 * The warning a transfer gate read gives (`GET /api/deals/:id/transfer-gate`,
 * D1155): an open IC condition holds the wire, and the Worker refuses the
 * record until it is resolved. A condition on a decision the recorder cannot
 * see holds it without a count. A failed read is said, never read as clear.
 */
export function transferGateLine(read) {
  if (!read || read.state === 'loading') return { tone: 'muted', text: 'Checking whether an open IC condition holds this transfer…' };
  if (read.state === 'unreadable') return { tone: 'warn', text: 'Whether an open IC condition holds this transfer could not be read. The Worker checks again when you record it.' };
  const g = read.value || {};
  if (!g.held) return null;
  const n = Number(g.open_conditions);
  if (Number.isInteger(n) && n > 0) {
    return { tone: 'warn', text: `${n} IC condition${n === 1 ? ' is' : 's are'} still open on this deal. The transfer is refused until ${n === 1 ? 'it is' : 'they are'} resolved in the commit room.` };
  }
  return { tone: 'warn', text: 'An open IC condition on a decision you cannot see holds this transfer. Its committee resolves it in the commit room.' };
}
