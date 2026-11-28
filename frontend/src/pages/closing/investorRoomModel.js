/**
 * D8926 (#8926) — the investor's closing room, built to the #6188 v2 canvas
 * (`design/incoming/Deals v2 Terms and Closing Room Page.dc.html`, boards
 * DE35 to DE41 in sections DX20, DX20b and DX20c). Pure, so
 * `frontend/test/closing_investor_room_v2_8926.test.mjs` holds each rule.
 *
 * WHAT IS READ. Nothing new: the investor's own closing read (`GET
 * /api/closings/:uid`, their lines, the round's total and `for_investor`),
 * each line's staged envelopes, their firm's committee conditions (`GET
 * /api/ic/conditions`, the decisions they may see, kept to this deal), and,
 * before a closing is opened, their own commitments on the deal (`GET
 * /api/deals/:id/commitments`). What none of them holds is Not recorded with
 * its reason; a failed read is Unavailable and never a zero or "none".
 *
 * THE ONE PRIMARY ACTION (DE35b). The step that is now decides it: Sign is
 * now and it is the investor's turn → Review and sign; Pay is now → See
 * payment instructions; the line is Sent → "Waiting for the company’s bank",
 * a status shown disabled with its reason. Nothing on this page moves money.
 */
import { dayOf, signingRows, liveEnvelope, evidenceRows } from './roomModel.js';
import { LINE_STATUS, moneyCents, routeWord } from './deskModel.js';
import { dealMoney } from '../../components/deals/dealMoney.js';

export const ROOM_WORDS = Object.freeze({
  eyebrow: 'Your closing room',
  back: 'Back to the deal',
  yourLineOnly: 'your line only',
  lineFoot: 'Only you, the founder and the studio team see this line. Other investors are never named.',
  deadlineFoot: 'Set by the studio on this closing.',
  noDeadline: 'No deadline is recorded on this closing.',
  nothingMoves: 'Nothing on this page moves money.',
  conditionsTitle: 'Your firm’s committee conditions',
  conditionsFoot: 'Only conditions on your firm’s decisions show here. Today they do not hold the closing.',
  conditionsNone: 'No committee condition is recorded on your firm’s decisions for this deal.',
  conditionsClaim: 'The rest of the closing room still shows.',
  evidenceEye: 'Evidence that money moved',
  evidenceTitle: 'Two sides, kept apart',
  receivingEye: 'Receiving side · the company’s bank',
  sendingEye: 'Sending side · you',
  receivingNone: 'Nothing recorded by the company’s bank yet.',
  sendingNone: 'You have not recorded or accepted a payment yet.',
  receivingWhy: 'The only side that makes your line Received.',
  sendingWhy: 'Your word: it makes your line Sent, not Received.',
  payBand: 'Pay from your own bank. Before you do, read the instructions and the warning.',
  waitingBank: 'Waiting for the company’s bank',
  waitingBankWhy: 'No action: the company’s bank confirms receipt.',
  notOpenedChip: 'Not opened',
  notOpenedTitle: 'The studio has not opened the closing for this deal yet.',
  notOpenedText: 'When it does, your paper, your line and the steps to Closed appear here.',
  backToInvestment: 'Back to Investment',
  noCommitment: 'You have no commitment on this deal.',
  commitmentUnread: 'Your commitment',
  withdrawnLine: 'Your line in this round was withdrawn. Nothing is owed on it.',
  cancelled: 'The studio cancelled this closing. No line will be received on it.',
  noPaper: 'No paper on your line yet.',
  portfolioText: (company) => `Opens ${company} in Portfolio.`,
});

/** The closing's own chip in the header (DE35, DE37, DE39): Open, Closed with its day, or Cancelled. */
export function roomChip(closing) {
  const s = closing?.status;
  if (s === 'closed') return { kind: 'closed', glyph: '✓', text: `Closed${dayOf(closing.closed_at) ? ` ${dayOf(closing.closed_at)}` : ''}` };
  if (s === 'cancelled') return { kind: 'cancelled', glyph: '✕', text: 'Cancelled' };
  if (s === 'open') return { kind: 'open', glyph: null, text: 'Closing · Open' };
  return { kind: 'unknown', glyph: null, text: 'Status not recorded' };
}

/** The room's heading: the company and the round, as the canvas draws it ("Acme Robotics · Seed round"). */
export function roomTitle(company, roundLabel) {
  const label = typeof roundLabel === 'string' && roundLabel.trim() ? roundLabel.trim() : null;
  if (!label) return `${company} · Closing`;
  return /\bround$/i.test(label) ? `${company} · ${label}` : `${company} · ${label} round`;
}

/** The line under the heading: instrument, the round's total, who opened it and when, and that this is the viewer's line only. */
export function roomSub(closing, instrument) {
  const total = moneyCents(closing?.total_cents, closing?.currency || 'USD');
  const opened = dayOf(closing?.created_at);
  return [
    instrument || null,
    total ? `round ${total}` : null,
    opened ? `opened by the studio on ${opened}` : 'opened by the studio',
    ROOM_WORDS.yourLineOnly,
  ].filter(Boolean).join(' · ');
}

/** A line's own chip (DE35, DE36c, DE37, DE39): Open, Sent, Received, Withdrawn. */
export const LINE_CHIP = Object.freeze({
  open: { glyph: '○', word: 'Open', tone: 'wait' },
  sent: { glyph: '↗', word: 'Sent', tone: 'wait' },
  received: { glyph: '✓', word: 'Received', tone: 'done' },
  withdrawn: { glyph: '✕', word: 'Withdrawn', tone: 'off' },
});
export const lineChip = (status) => LINE_CHIP[status] || { glyph: '—', word: 'Not recorded', tone: 'off' };

const now = (steps) => {
  const i = (Array.isArray(steps) ? steps : []).findIndex((s) => s.state === 'now');
  return i < 0 ? null : { index: i, step: steps[i] };
};

/**
 * The sentence under the steps ("Sign is now. Your signature is next on your
 * SAFE.") and the one primary action it gives (DE35, DE35b):
 *   `sign`  the investor's turn to sign; `pay` their line is signed and not
 *   sent; `wait` their line is Sent and the company's bank has not confirmed
 *   it (drawn disabled, a status and not a control); null for none.
 */
export function investorNow(closing, steps, row, paperTitle) {
  if (closing?.status === 'closed') {
    return { key: 'closed', lead: `Closed${dayOf(closing.closed_at) ? ` on ${dayOf(closing.closed_at)}` : ''}.`, text: '', action: null };
  }
  if (closing?.status === 'cancelled') return { key: 'cancelled', lead: 'Cancelled.', text: ROOM_WORDS.cancelled, action: null };
  if (!row) return { key: 'none', lead: '', text: ROOM_WORDS.withdrawnLine, action: null };
  const n = now(steps);
  if (!n) return { key: 'reading', lead: '', text: '', action: null };
  const name = n.step.name;
  const lead = `${name} is now.`;
  if (name === 'Sign' && row.next?.you && /sign/.test(row.next.text)) {
    return { key: 'sign', lead, text: `Your signature is next on your ${paperTitle || 'paper'}.`, action: 'sign' };
  }
  if (row.next?.you && /send the payment/.test(row.next.text)) {
    return { key: 'pay', lead: 'Pay is now.', text: 'Your line is signed; it is not sent yet.', action: 'pay' };
  }
  if (row.status === LINE_STATUS.sent) {
    return { key: 'receipt', lead: 'Receipt is now.', text: 'You said you sent it. The company’s bank has not confirmed it yet.', action: 'wait' };
  }
  return { key: name.toLowerCase(), lead, text: row.next?.text ? `${row.next.text}.` : '', action: null };
}

/**
 * A step's small line as the investor reads it (DE35): the step that is now
 * says what waits ("Your signature is next"); a count of one line is "Your
 * line" when the investor has one line in the round.
 */
const NOW_SHORT = Object.freeze({ sign: 'Your signature is next', pay: 'Your line is not sent', receipt: 'Waiting for the company’s bank' });
export function investorStepText(step, nowView, mine) {
  if (step?.state === 'now' && nowView && NOW_SHORT[nowView.key]) return NOW_SHORT[nowView.key];
  const text = String(step?.text ?? '');
  return mine === 1 ? text.replace(/^1 line\b/, 'Your line') : text;
}

/** The phone's one line for the steps (DE40a): "Step 2 of 7 · Sign". */
export function phoneStep(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const n = now(list);
  if (!n) {
    const done = list.length && list.every((s) => s.state === 'done');
    return done ? `Step ${list.length} of ${list.length} · ${list[list.length - 1].name}` : `Steps · ${list[0]?.text || 'Reading…'}`;
  }
  return `Step ${n.index + 1} of ${list.length} · ${n.step.name}`;
}

/**
 * The investor's paper (DE35 "Your paper"): its title, the signers in order,
 * how many have signed, and whether it is their turn. A paper read that failed
 * is `unreadable`; no envelope yet is `none`; a prospect line has no paper.
 */
export function paperView(line, envelopes, holder) {
  if (line?.commitment_id == null) return { state: 'none' };
  if (envelopes === null) return { state: 'unreadable' };
  if (envelopes === undefined) return { state: 'reading' };
  const env = liveEnvelope(envelopes);
  if (!env) return { state: 'none' };
  const signers = signingRows(env, 'investor');
  const signed = signers.filter((s) => s.state.startsWith('Signed')).length;
  const next = signers.find((s) => !s.state.startsWith('Signed')) || null;
  const title = [env.title || null, holder || null].filter(Boolean).join(' · ') || 'Your paper';
  return {
    state: 'ok',
    title,
    kind: env.title || null,
    signers,
    signedOf: `${signed} of ${signers.length} signed`,
    complete: env.complete === true,
    yourTurn: signers.some((s) => s.yourTurn),
    nextWho: next ? (next.yourTurn ? 'you' : next.who) : null,
  };
}

const COND = Object.freeze({
  open: { glyph: '○', word: 'Open', tone: 'wait' },
  met: { glyph: '✓', word: 'Met', tone: 'done' },
  waived: { glyph: '⤼', word: 'Waived', tone: 'off' },
});

/**
 * The investor's firm's committee conditions on this deal (DE35), from
 * `GET /api/ic/conditions` (the decisions they may see), kept to this deal.
 * `reading`, `unreadable` (failed, or no list in the answer), `refused`
 * (403/404), `none`, or `ok` with the rows, the first decision's title and
 * the counts.
 */
export function conditionsView(read, dealId) {
  if (!read || read.status === 'loading' || read.status === 'off') return { state: 'reading' };
  if (read.status === 'error') {
    const s = Number(read.error?.status);
    return s === 403 || s === 404 ? { state: 'refused' } : { state: 'unreadable' };
  }
  const items = read.data?.items;
  if (!Array.isArray(items)) return { state: 'unreadable' };
  const mine = items.filter((c) => c && dealId != null && String(c.deal_id) === String(dealId));
  if (!mine.length) return { state: 'none' };
  const rows = mine.map((c) => {
    const w = COND[c.status] || { glyph: '—', word: 'Not recorded', tone: 'off' };
    const since = c.status === 'open'
      ? (dayOf(c.created_at) ? `Open since ${dayOf(c.created_at)}` : 'Open, day not recorded')
      : (dayOf(c.resolved_at) ? `${w.word} ${dayOf(c.resolved_at)}` : `${w.word}, day not recorded`);
    return { uid: c.uid, body: c.body || 'Condition text not recorded', status: c.status, ...w, since };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    state: 'ok',
    title: mine[0].decision_title || 'Committee decision',
    counts: `${count('open')} open · ${count('met')} met · ${count('waived')} waived`,
    open: count('open'),
    rows,
  };
}

/**
 * The two sides of the evidence on the investor's line (DE35, DE36c, DE37),
 * kept apart: the receiving side (the company's bank; the only side that
 * makes a line Received) and the sending side (the investor's own Mercury, or
 * their declaration, D6198: Sent, never Received). Withdrawn evidence is left out.
 */
export function evidenceSides(line, declaration) {
  const rows = evidenceRows(line?.evidence).filter((e) => !e.withdrawn);
  const recv = rows.find((e) => e.receiving) || null;
  const send = rows.find((e) => e.side === 'Sending side') || null;
  return {
    receiving: recv ? { state: 'ok', words: recv.words, at: recv.at } : { state: 'none' },
    sending: send
      ? { state: 'ok', words: send.words, at: send.at }
      : declaration ? { state: 'ok', words: `You recorded that you sent ${declaration.amount || 'it'}`, at: dayOf(declaration.sentOn) || declaration.sentOn || null }
        : { state: 'none' },
  };
}

/** The route as the line card says it (DE35 "Direct · set by the studio"), or null when none is set. */
export function routeLine(route) {
  const w = routeWord(route);
  return w ? `${w} · set by the studio` : null;
}

const COMMIT_WORD = Object.freeze({ pending: 'Pending', confirmed: 'Confirmed', withdrawn: 'Withdrawn' });

/**
 * Before the studio opens a closing (DE38), and when the closing could not
 * be read (DE39): the investor's own commitment on the deal, from their
 * commitments read. Null when they have none (DE39 "Refused · no commitment").
 */
export function commitmentFacts(commitments, currency = 'USD') {
  const list = (Array.isArray(commitments) ? commitments : []).filter((c) => c && c.status !== 'withdrawn');
  const c = list[0];
  if (!c) return null;
  return {
    amount: dealMoney(c.amount, c.currency || currency),
    word: COMMIT_WORD[c.status] || 'Not recorded',
    heldFor: c.investor_name || null,
    recorded: dayOf(c.created_at),
    more: list.length - 1,
  };
}

/** The receiving account's change notice in the payment sheet (DE36): a revision past the first was a change. */
export function accountChange(account) {
  const rev = Number(account?.revision);
  if (!Number.isSafeInteger(rev) || rev < 2) return null;
  const on = dayOf(account.created_at);
  return {
    title: on ? `The company changed its receiving account on ${on}.` : 'The company changed its receiving account.',
    text: 'Call the company on a number you already hold before you pay. Every investor with an unpaid line was told.',
  };
}
