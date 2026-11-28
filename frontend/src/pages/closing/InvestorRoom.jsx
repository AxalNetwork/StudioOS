/**
 * D8926 (#8926) — the investor's closing room at `/deals/:dealId/closing`,
 * built to the #6188 v2 canvas (`design/incoming/Deals v2 Terms and Closing
 * Room Page.dc.html`): DE35 (your line, Sign now), DE35b (the one primary
 * action by step), DE36 and DE36c (payment instructions, Sent), DE37 (after
 * Closed), DE38 (no closing opened yet), DE39 (the states), DE40a and DE40b
 * (phone 390) and DE41 (dark).
 *
 * It keeps every behaviour the room had for an investor (D1218, D6189,
 * D6197, D6198, D6199): their own line and the round's total only, Review
 * and sign, the payment sheet with the warning first and the reveal, "I have
 * sent it", the Mercury match, what is left, and after Closed their summary,
 * signed copy, duties and Portfolio link. The rules are in
 * `investorRoomModel.js` and `roomModel.js`. Nothing on this page moves money.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { closingsApi } from '../../lib/api/closings';
import { mercuryInvestorApi } from '../../lib/api/mercuryInvestor';
import { StateChip, Unreadable, usePhoneWidth } from '../../ui';
import { parseMinor } from '../../lib/money';
import { BTN } from '../account/AccountCenter';
import { tabHref } from '../dealPageModel';
import { moneyCents } from './deskModel';
import { SyndicatePanel } from './RoutePanels';
import PaperState from './PaperState';
import { CaptableDialog, MatchDialog, PaymentDrawer, ReceiptDrawer, SignDrawer, saveBlob } from './RoomDialogs';
import { CaptableCard, Money, NoAccess, Why, box, mutedText, pulse, useLoad, usePapers } from './roomShared';
import {
  INVESTOR_PART_CLAIM, NO_ACCESS, ROOM_FAILED, ROOM_WAITS, STEPS, captableView, investorDuties, investorLeft, investorPartUnreadable, investorSummary,
  liveEnvelope, matchesFor, portfolioCompanyHref, roomLines, roomTiles, stepStrip,
} from './roomModel';
import {
  ROOM_WORDS, commitmentFacts, conditionsView, evidenceSides, investorNow, investorStepText, lineChip, paperView, phoneStep, roomChip, roomSub, roomTitle, routeLine,
} from './investorRoomModel';

/** Literal classes, so the build keeps them (a class built from a number is not seen). */
const SPAN = { 3: 'col-span-3', 4: 'col-span-4', 5: 'col-span-5', 6: 'col-span-6', 8: 'col-span-8' };
const eye = 'text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400';
const card = `${box} gap-3`;
/** The canvas's transaction chip (`.ftx`): a left rule in the state's colour, never colour alone (each has its glyph and word). */
const TX = {
  wait: 'border-gray-300 border-l-amber-500 text-amber-800 dark:border-gray-600 dark:border-l-amber-400 dark:text-amber-300',
  done: 'border-gray-300 border-l-teal-700 text-teal-800 dark:border-gray-600 dark:border-l-teal-400 dark:text-teal-300',
  off: 'border-dashed border-gray-300 border-l-gray-400 text-gray-600 dark:border-gray-600 dark:border-l-gray-500 dark:text-gray-400',
};
const Chip = ({ tone = 'wait', glyph, children, testId }) => (
  <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md border border-l-[3px] bg-white px-2 py-px text-[11px] font-bold dark:bg-gray-900 ${TX[tone] || TX.wait}`} data-testid={testId}>
    {glyph ? <span aria-hidden="true">{glyph}</span> : null}{children}
  </span>
);
const COND_TONE = {
  wait: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
  off: 'border-dashed border-gray-300 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400',
};

/** DE35's header: back to the deal, "Your closing room", the company and round with the closing's chip, and the line under it. */
function RoomHead({ dealId, title, chip, sub }) {
  return (
    <header className="flex flex-col gap-1.5" data-testid="closing-head">
      <Link to={tabHref(dealId, 'overview')} className={`${BTN.link} w-fit`} data-testid="closing-back">‹ {ROOM_WORDS.back}</Link>
      <span className={eye}>{ROOM_WORDS.eyebrow}</span>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="m-0 text-[22px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
        {chip}
      </div>
      {sub ? <p className={mutedText}>{sub}</p> : null}
    </header>
  );
}

const headChip = (closing) => {
  const c = roomChip(closing);
  return <Chip tone={c.kind === 'closed' ? 'done' : c.kind === 'open' ? 'wait' : 'off'} glyph={c.glyph} testId="closing-status">{c.text}</Chip>;
};

const CIRCLE = {
  done: 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900',
  now: 'border-violet-600 bg-violet-600 text-white dark:border-violet-400 dark:bg-violet-500',
  next: 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
  unread: 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
};

/** The seven steps (DE35); on a phone, the step that is now as one card (DE40a). */
function Steps({ steps, nowView, mine, phone }) {
  if (phone) {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-violet-300 bg-violet-50 p-3 dark:border-violet-500/40 dark:bg-violet-500/15" data-testid="closing-steps">
        <span className="text-[11px] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-300">{phoneStep(steps)}</span>
        {nowView.text ? <b className="text-[13.5px] text-gray-900 dark:text-gray-100">{nowView.text}</b> : null}
      </div>
    );
  }
  return (
    <ol className="m-0 grid list-none grid-cols-7 overflow-hidden rounded-[10px] border border-gray-200 bg-white p-0 dark:border-gray-800 dark:bg-gray-900" aria-label="Closing steps" data-testid="closing-steps">
      {steps.map((s, i) => (
        <li key={s.name} aria-current={s.state === 'now' ? 'step' : undefined} data-testid={`closing-step-${i + 1}`} data-state={s.state}
          className={`flex min-w-0 flex-col gap-1 border-r border-gray-200 px-2.5 py-2 last:border-r-0 dark:border-gray-800 ${s.state === 'now' ? 'bg-violet-50 shadow-[inset_0_3px_0_#7c3aed] dark:bg-violet-500/15' : ''}`}>
          <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-gray-900 dark:text-gray-100">
            <span aria-hidden="true" className={`grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-[1.5px] font-mono text-[10px] font-bold ${CIRCLE[s.state] || CIRCLE.next}`}>{s.state === 'done' ? '✓' : i + 1}</span>
            {s.name}
          </span>
          <small className={`text-[11px] leading-snug ${s.state === 'now' ? 'font-bold text-violet-800 dark:text-violet-300' : 'text-gray-500 dark:text-gray-400'}`}>
            {s.state === 'now' ? 'Now · ' : ''}{investorStepText(s, nowView, mine)}
          </small>
        </li>
      ))}
    </ol>
  );
}

/** A block that a phone shows as one row to open (DE40a "Committee conditions · 1 open ›"); on a desktop, always open. */
function Fold({ phone, title, meta, testId, span, children }) {
  const [open, setOpen] = useState(false);
  if (!phone) return <section className={`${card} ${span}`} data-testid={testId}>{children}</section>;
  return (
    <section className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={`${testId}-toggle`}
        className="flex min-h-[52px] items-center justify-between rounded-[10px] border border-gray-200 bg-white px-3.5 text-left text-[13.5px] font-bold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        {title}<span className="font-mono text-[11.5px] font-medium text-gray-500 dark:text-gray-400">{meta} {open ? '▴' : '›'}</span>
      </button>
      {open ? <div className={card}>{children}</div> : null}
    </section>
  );
}

/** DE35 "Your line": its chip, the amount, the route, who it is held for, the money words and the round's total. */
function LineCard({ rows, line, tiles, span }) {
  const mine = rows.filter((r) => !r.withdrawn);
  const first = mine[0];
  const chip = lineChip(first ? line?.status : 'withdrawn');
  return (
    <section className={`${card} ${span}`} data-testid="closing-your-line">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[15px] font-bold">Your line</h3>
        <Chip tone={chip.tone} glyph={chip.glyph} testId="closing-your-line-chip">{chip.word}</Chip>
      </div>
      <span className="font-mono text-[24px] font-bold tracking-tight tabular-nums" data-testid="closing-your-amount"><Money text={tiles.mine} reason="No amount is recorded on your line." /></span>
      {mine.length > 1 ? <p className={mutedText}>{mine.length} lines of yours in this round.</p> : null}
      {!first ? <p className="m-0 text-[13px]" data-testid="closing-your-withdrawn">{ROOM_WORDS.withdrawnLine}</p> : (
        <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-gray-500 dark:text-gray-400">Route</dt>
          <dd className="m-0 font-semibold" data-testid="closing-your-route">{routeLine(line?.route) || <Why reason="The studio has not set your line’s route yet." />}</dd>
          <dt className="text-gray-500 dark:text-gray-400">Held for</dt>
          <dd className="m-0 font-semibold">{line?.investor_name || <Why reason="No name is recorded on your line." />}</dd>
          <dt className="text-gray-500 dark:text-gray-400">Money</dt>
          <dd className="m-0 font-semibold" data-testid="closing-your-money">{first.status}</dd>
          <dt className="text-gray-500 dark:text-gray-400">Round total</dt>
          <dd className="m-0 font-mono font-semibold" data-testid="closing-round"><Money text={tiles.committed} reason="The round’s total was not returned." /></dd>
        </dl>
      )}
      <p className="m-0 border-t border-gray-100 pt-2 text-[11.5px] text-gray-500 dark:border-gray-800 dark:text-gray-400">{ROOM_WORDS.lineFoot}</p>
    </section>
  );
}

/** DE35 "Your paper": the paper, who signs in what order, and Review and sign when it is the investor's turn. */
function PaperCard({ row, view, primary, phone, onSign, span }) {
  const full = phone ? 'min-h-[48px] w-full' : 'w-fit';
  return (
    <section className={`${card} ${span}`} data-testid="closing-your-paper">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={eye}>Your paper</span>
          <h3 className="m-0 text-[15px] font-bold">{view.state === 'ok' ? view.title : 'Your paper'}</h3>
        </div>
        {row ? <PaperState state={row.paperState} text={null} /> : null}
      </div>
      {view.state === 'reading' ? <div className={`h-16 ${pulse}`} />
        : view.state === 'unreadable' ? <Unreadable what="Your paper" claim="This is not a claim that there is none." />
          : view.state === 'none' ? <Why reason={ROOM_WORDS.noPaper} />
            : (
              <ol className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] border border-gray-200 p-0 dark:border-gray-800" data-testid="closing-your-signers">
                {view.signers.map((s) => (
                  <li key={s.key} className={`grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-200 px-3 py-2 text-[12.5px] last:border-b-0 dark:border-gray-800 ${s.yourTurn ? 'bg-violet-50 dark:bg-violet-500/15' : ''}`} data-testid={`closing-your-signer-${s.position}`}>
                    <span aria-hidden="true" className="font-mono text-[11px] font-bold text-gray-500 dark:text-gray-400">{s.state.startsWith('Signed') ? '✓' : s.position}</span>
                    <span className="min-w-0"><b className="block truncate">{s.who}</b><small className="block text-[11px] text-gray-500 dark:text-gray-400">{s.role}</small></span>
                    <span className="text-[11.5px] text-gray-600 dark:text-gray-400">{s.state}</span>
                  </li>
                ))}
              </ol>
            )}
      {row?.commitmentId != null && !(phone && primary) ? (
        <div className={`flex gap-2 ${phone ? 'flex-col' : 'flex-wrap items-center'}`}>
          <button type="button" className={`${primary ? BTN.primary : BTN.ghost} ${full}`} onClick={() => onSign(row)} data-testid="closing-review-sign">
            {primary ? 'Review and sign' : view.complete ? 'Open the signed paper' : 'Open the signing order'}
          </button>
          {view.state === 'ok' && view.nextWho ? <span className="text-[11.5px] text-gray-500 dark:text-gray-400">Who signs next: {view.nextWho}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

/** DE35 "Deadline", or Not recorded with its reason (D6199). */
function DeadlineTile({ tiles, span }) {
  return (
    <section className={`${card} ${span}`} data-testid="closing-your-deadline">
      <span className={eye}>Deadline</span>
      {tiles.deadline ? (
        <>
          <b className="font-mono text-[20px]">{tiles.deadline}</b>
          {tiles.left ? <span className="text-[12.5px] text-gray-600 dark:text-gray-400">{tiles.left}</span> : null}
          <p className="m-0 text-[11.5px] text-gray-500 dark:text-gray-400">{ROOM_WORDS.deadlineFoot}</p>
        </>
      ) : <Why reason={ROOM_WORDS.noDeadline} />}
    </section>
  );
}

/** DE35: the firm's committee conditions on this deal, open, met and waived. One failed read costs this block only (DE39). */
function ConditionsBody({ view, onRetry }) {
  if (view.state === 'reading') return <div className={`h-14 ${pulse}`} />;
  if (view.state === 'unreadable') return <Unreadable what="Your firm’s committee conditions" claim={ROOM_WORDS.conditionsClaim} onRetry={onRetry} />;
  if (view.state === 'refused') return <StateChip kind="refused" label="Refused · your firm’s decisions are not yours to read here" />;
  if (view.state === 'none') return <p className={mutedText} data-testid="closing-conditions-none">{ROOM_WORDS.conditionsNone}</p>;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="m-0 text-[14px] font-bold">{view.title}</h4>
        <span className="font-mono text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="closing-conditions-counts">{view.counts}</span>
      </div>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] border border-gray-200 p-0 dark:border-gray-800">
        {view.rows.map((c) => (
          <li key={c.uid} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 border-b border-gray-200 px-3 py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid={`closing-condition-${c.uid}`}>
            <b className="min-w-0 break-words">{c.body}</b>
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 text-[11px] font-bold leading-[1.75] ${COND_TONE[c.tone]}`}><span aria-hidden="true">{c.glyph}</span>{c.word}</span>
            <small className="col-span-2 text-[11px] text-gray-500 dark:text-gray-400">{c.since}</small>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[11.5px] text-gray-500 dark:text-gray-400">{ROOM_WORDS.conditionsFoot}</p>
    </>
  );
}

/** DE35, DE36c, DE37: the receiving side and the sending side of the evidence, kept apart. */
function EvidenceBody({ sides, onReceipt }) {
  const Side = ({ k, label, side, none, why }) => (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[10px] border border-gray-200 p-3 dark:border-gray-800" data-testid={`closing-evidence-${k}`}>
      <span className={eye}>{label}</span>
      {side.state === 'ok' ? (
        <>
          <b className="text-[13px]">{side.words}</b>
          <Chip tone={k === 'receiving' ? 'done' : 'wait'} glyph={k === 'receiving' ? '✓' : '↗'}>{side.at ? `Recorded ${side.at}` : 'Recorded, day not recorded'}</Chip>
          <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{why}</span>
        </>
      ) : (
        <>
          <StateChip kind="none" label="None" className="self-start" />
          <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{none}</span>
        </>
      )}
    </div>
  );
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <span className={eye}>{ROOM_WORDS.evidenceEye}</span>
        <h3 className="m-0 text-[15px] font-bold">{ROOM_WORDS.evidenceTitle}</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Side k="receiving" label={ROOM_WORDS.receivingEye} side={sides.receiving} none={ROOM_WORDS.receivingNone} why={ROOM_WORDS.receivingWhy} />
        <Side k="sending" label={ROOM_WORDS.sendingEye} side={sides.sending} none={ROOM_WORDS.sendingNone} why={ROOM_WORDS.sendingWhy} />
      </div>
      {onReceipt ? <button type="button" className={`${BTN.link} w-fit`} onClick={onReceipt} data-testid="closing-evidence-open">See the evidence on your line</button> : null}
    </>
  );
}

/** D6199: what is left: the steps that wait on the investor, and a count of the rest, never another investor's line. */
function LeftCard({ left, unreadable, onRetry, full, onSign, onPay, span }) {
  return (
    <section className={`${card} ${span}`} data-testid="closing-left">
      <span className={eye}>What is left</span>
      {unreadable ? <Unreadable what="What is left" claim={INVESTOR_PART_CLAIM} onRetry={onRetry} />
        : !left ? <Why reason={ROOM_WAITS.investorLeft} />
          : (
            <>
              {left.items.length === 0 ? <p className={mutedText} data-testid="closing-left-none">Nothing waits on you now.</p> : left.items.map((it) => (
                <div key={it.key} className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800" data-testid={`closing-left-${it.step}`}>
                  <span className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">Waits on you: {it.text}</span>
                  {it.step === 'sign'
                    ? <button type="button" className={`${BTN.ghost} ${full}`} onClick={() => onSign(it.row)} data-testid="closing-left-sign-open">Open the signing order</button>
                    : <button type="button" className={`${BTN.ghost} ${full}`} onClick={() => onPay(it.row)} data-testid="closing-left-pay-open">See payment instructions</button>}
                </div>
              ))}
              <div className={mutedText} data-testid="closing-left-rest">
                {left.restText ?? <Why reason={ROOM_WAITS.investorLeft} />}
                {left.restParts.length ? ` ${left.restParts.join('; ')}.` : ''}
              </div>
            </>
          )}
    </section>
  );
}

/**
 * D6198 (#6198): the investor records that they sent it, without Mercury:
 * the day, the amount and an optional short label. It reads Sent, not yet
 * confirmed, and never Received; no account or card number is taken.
 */
function SentDeclaration({ closing, row, full, onDone }) {
  const currency = closing.currency || 'USD';
  const [form, setForm] = useState(null);
  const [state, setState] = useState({ busy: false, err: '' });
  const d = row.declaration;
  if (row.status === 'Received' || row.withdrawn) return null;
  const withdraw = async () => {
    setState({ busy: true, err: '' });
    try { await closingsApi.withdrawDeclaration(closing.uid, row.uid); setState({ busy: false, err: '' }); onDone?.(); }
    catch (e) { setState({ busy: false, err: e?.message || 'It was not withdrawn. Try again.' }); }
  };
  if (d) {
    return (
      <div className="flex flex-col gap-1" data-testid="closing-declared">
        <p className="m-0 text-[13px]">You recorded that you sent <Money text={d.amount} reason="No amount" /> on {d.sentOn}{d.reference ? ` (${d.reference})` : ''}. Sent, not yet confirmed.</p>
        <button type="button" className={`${BTN.ghost} ${full}`} disabled={state.busy} onClick={withdraw} data-testid="closing-declared-withdraw">Withdraw what I recorded</button>
        {state.err ? <p className="m-0 text-[12px] text-red-700 dark:text-red-300" role="alert">{state.err}</p> : null}
      </div>
    );
  }
  if (!form) return <button type="button" className={`${BTN.ghost} ${full}`} onClick={() => setForm({ sentOn: '', amount: '', reference: '' })} data-testid="closing-declare">Record that I sent it</button>;
  const send = async () => {
    const amount = parseMinor(form.amount, currency);
    if (!form.sentOn) { setState({ busy: false, err: 'Choose the day you sent it.' }); return; }
    if (!amount.ok || amount.minor <= 0) { setState({ busy: false, err: amount.ok ? 'Enter the amount you sent.' : amount.message || 'Enter the amount you sent.' }); return; }
    setState({ busy: true, err: '' });
    try {
      await closingsApi.declareSent(closing.uid, row.uid, { sent_on: form.sentOn, amount_cents: amount.minor, reference: form.reference.trim() || null });
      setForm(null); setState({ busy: false, err: '' }); onDone?.();
    } catch (e) { setState({ busy: false, err: e?.message || 'It was not recorded. Try again.' }); }
  };
  const field = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="closing-declare-form">
      <label className="text-[12px] font-semibold">The day you sent it<input type="date" value={form.sentOn} onChange={(e) => setForm((f) => ({ ...f, sentOn: e.target.value }))} className={field} /></label>
      <label className="text-[12px] font-semibold">Amount ({currency})<input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={field} /></label>
      <label className="text-[12px] font-semibold">A short label, optional<input maxLength={40} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className={field} /></label>
      <p className={mutedText}>Leave out account and card numbers.</p>
      {state.err ? <p className="m-0 text-[12px] text-red-700 dark:text-red-300" role="alert">{state.err}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN.ghost} onClick={() => setForm(null)}>Cancel</button>
        <button type="button" className={BTN.ghost} disabled={state.busy} onClick={send} data-testid="closing-declare-send">{state.busy ? 'Recording…' : 'Record it'}</button>
      </div>
    </div>
  );
}

/** D6198, D1218: "I have sent it" — the investor's own word, and the payments from their Mercury that fit the line. */
function PaymentCard({ closing, row, full, onRetry, span }) {
  return (
    <section className={`${card} ${span}`} data-testid="closing-your-payment">
      <span className={eye}>I have sent it</span>
      <p className={mutedText} data-testid="closing-sent-word">{ROOM_WAITS.sentWord} The line is Received when {closing.companyName}’s bank confirms it.</p>
      <SentDeclaration closing={closing} row={row} full={full} onDone={onRetry} />
    </section>
  );
}

/** CP2's "From Mercury": the investor's own proposals that fit their lines. Accepting records Sent, not yet confirmed (DE36b, ⚑ Q4 A). */
function MercuryCard({ lines, currency, company, phone, onAccepted, span }) {
  const read = useLoad(() => mercuryInvestorApi.proposals('closing'), []);
  const [open, setOpen] = useState(null);
  const matches = read.status === 'ok' ? matchesFor(read.data?.proposals, lines) : [];
  return (
    <section className={`${card} ${span}`} data-testid="closing-mercury">
      <div className="flex items-center gap-2"><span className={eye}>From your Mercury</span><span className="flex-1" /><span className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300">Connector</span></div>
      {read.status === 'loading' ? <div className={`h-12 ${pulse}`} />
        : read.status === 'error' ? <Unreadable what="Your Mercury" claim="The rest of the closing room still shows. A block that could not be read is never shown as zero." onRetry={read.retry} />
          : matches.length === 0 ? <p className={mutedText} data-testid="closing-mercury-none">No payment from your Mercury fits this line yet. A match appears here after your Mercury is read.</p>
            : matches.map((m) => (
              <div key={m.uid} className="flex flex-col gap-2 rounded-[10px] border border-gray-200 p-3 dark:border-gray-800" data-testid={`closing-match-${m.uid}`}>
                <p className="m-0 text-[13px]">A payment of <Money text={moneyCents(m.cents, currency)} reason="Mercury gave no amount." /> on {m.postedOn || 'a day not recorded'}{m.lastFour ? ` from ••••${m.lastFour}` : ''} fits this commitment.</p>
                <div className={`flex gap-2 ${phone ? 'flex-col' : 'items-center justify-between'}`}>
                  <span className="text-[11.5px] text-gray-500 dark:text-gray-400">Accepting records Sent, not Confirmed</span>
                  <button type="button" className={`${BTN.ghost} ${phone ? 'min-h-[44px] w-full' : 'w-fit'}`} onClick={() => setOpen(m)} data-testid={`closing-match-open-${m.uid}`}>Review the match</button>
                </div>
              </div>
            ))}
      <p className={mutedText}>Accepting records it as Sent, not yet confirmed, from your Mercury. {company}’s bank confirms receipt.</p>
      {open ? <MatchDialog match={open} currency={currency} company={company} onClose={() => setOpen(null)} onDone={() => { setOpen(null); read.retry(); onAccepted?.(); }} /> : null}
    </section>
  );
}

/** D6199: the investor's own signed copy, fetched only when its button is pressed. */
function SignedCopy({ id, full }) {
  const [state, setState] = useState('idle');
  if (id == null) return <Why reason={ROOM_WAITS.signedCopy} />;
  const download = async () => {
    setState('pending');
    try {
      const { blob, filename } = await closingsApi.signedCopyBlob(id);
      saveBlob(blob, filename);
      setState('idle');
    } catch { setState('failed'); }
  };
  return (
    <span className="flex flex-col gap-1">
      <button type="button" className={`${BTN.ghost} ${full}`} disabled={state === 'pending'} onClick={download} data-testid="closing-signed-copy">{state === 'pending' ? 'Downloading…' : 'Download your signed copy'}</button>
      {state === 'failed' ? <span role="alert" className="text-[12px] text-red-700 dark:text-red-400">The signed copy could not be downloaded. Try again.</span> : null}
    </span>
  );
}

const SUMMARY_KEYS = Object.freeze({ Amount: 'amount', Signed: 'signed', Received: 'received', 'Signed copy': 'copy' });

/** DE37 "What you hold" (D6199): instrument, amount, signed and received days, the signed copy. */
function HoldCard({ closing, instrument, phone, onRetry, span }) {
  const lines = investorSummary(closing);
  const full = phone ? 'min-h-[48px] w-full' : 'w-fit';
  return (
    <section className={`${card} ${span}`} data-testid="closing-your-summary">
      <h3 className="m-0 text-[15px] font-bold">What you hold</h3>
      <p className="m-0 text-[12.5px]"><span className="text-gray-500 dark:text-gray-400">Instrument </span><b>{instrument || 'Not recorded'}</b></p>
      {investorPartUnreadable(closing) ? <Unreadable what="Your closing’s summary" claim={INVESTOR_PART_CLAIM} onRetry={onRetry} />
        : lines == null ? <Why reason="Your line’s summary is not in this read of the closing." />
          : lines.length === 0 ? <p className={mutedText}>Your line in this round was withdrawn.</p>
            : lines.map((l) => (
              <div key={l.key} className="grid grid-cols-1 gap-2 border-t border-gray-100 pt-2 text-[13px] dark:border-gray-800" data-testid={`closing-summary-${l.key}`}>
                {[['Amount', <Money key="a" text={l.amount} reason="No amount is recorded on your line." />],
                  ['Signed', l.signed || <Why key="s" reason="No day the paper was fully signed is recorded." />],
                  ['Received', l.received || <Why key="r" reason="No receiving-side evidence day is recorded." />],
                  ['Signed copy', <SignedCopy key="c" id={l.copyId} full={full} />]].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3" data-testid={`closing-summary-${SUMMARY_KEYS[k]}`}>
                    <span className="text-[12.5px] text-gray-500 dark:text-gray-400">{k}</span>
                    <span className="font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            ))}
    </section>
  );
}

/** DE37 "Your reporting duties" (D6199): the duties the signed paper names on the investor's own line. */
function ReportingCard({ closing, onRetry, span }) {
  const duties = investorPartUnreadable(closing) ? { state: 'unreadable', rows: [] } : investorDuties(closing);
  return (
    <section className={`${card} ${span}`} data-testid="closing-reporting">
      <h3 className="m-0 text-[15px] font-bold">Your reporting duties</h3>
      {duties.state === 'unreadable' ? <div data-testid="closing-reporting-unread"><Unreadable what="Your reporting duties" claim={ROOM_WAITS.investorReportingUnread} onRetry={onRetry} /></div>
        : duties.state !== 'ok' ? <Why reason="Your reporting duties are not in this read of the closing." />
          : duties.rows.length === 0 ? <p className={mutedText} data-testid="closing-reporting-empty">{ROOM_WAITS.investorReporting}</p>
            : duties.rows.map((d) => (
              <div key={d.uid} className="flex flex-col gap-0.5 border-t border-gray-100 pt-2 text-[12.5px] dark:border-gray-800" data-testid={`closing-duty-${d.uid}`}>
                <span className="font-semibold">{d.title}</span>
                <span>{[d.cadence, d.due].filter(Boolean).join(' · ') || 'Cadence not recorded'}</span>
                <span className="text-gray-600 dark:text-gray-400">{d.from}{d.signed ? ', in the signed paper' : ', in the closing template'}</span>
                {d.defaulted ? <span className="w-fit rounded-full bg-amber-100 px-2 text-[11px] font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Default, not in the paper</span> : null}
              </div>
            ))}
    </section>
  );
}

/** DE37 "Keep it in Portfolio": the one primary after Closed. */
function PortfolioCard({ closing, company, phone, span }) {
  const href = portfolioCompanyHref(closing);
  return (
    <section className={`${card} ${span}`} data-testid="closing-portfolio">
      <div className="flex flex-col gap-0.5"><span className={eye}>Next</span><h3 className="m-0 text-[15px] font-bold">Keep it in Portfolio</h3></div>
      {href ? (
        <>
          <p className={mutedText}>{ROOM_WORDS.portfolioText(company)}</p>
          <Link className={`${BTN.primary} ${phone ? 'min-h-[48px] w-full' : 'w-fit'}`} to={href} data-testid="closing-portfolio-link">Open in Portfolio</Link>
        </>
      ) : <div data-testid="closing-portfolio-none"><Why reason={ROOM_WAITS.portfolio} /></div>}
    </section>
  );
}

/** DE35b: the one primary action. Pay → See payment instructions; Sent → the bank's wait, shown disabled with its reason. */
function ActionBar({ nowView, row, phone, onSign, onPay, signReason }) {
  const full = 'min-h-[48px] w-full';
  if (nowView.action === 'sign' && phone) {
    return <><span className="text-[11.5px] text-gray-500 dark:text-gray-400">{signReason}</span><button type="button" className={`${BTN.primary} ${full}`} onClick={() => onSign(row)} data-testid="closing-review-sign">Review and sign</button></>;
  }
  if (nowView.action === 'pay') {
    return (
      <div className={phone ? 'flex flex-col gap-1.5' : 'flex flex-wrap items-center justify-between gap-3'}>
        {phone ? null : <div className="flex flex-col gap-0.5"><span className={eye}>Pay</span><p className="m-0 text-[13px]">{ROOM_WORDS.payBand}</p></div>}
        <button type="button" className={`${BTN.primary} ${phone ? full : 'w-fit'}`} onClick={() => onPay(row)} data-testid="closing-see-instructions">See payment instructions</button>
      </div>
    );
  }
  if (nowView.action === 'wait') {
    return (
      <div className={phone ? 'flex flex-col gap-1.5' : 'flex flex-wrap items-center justify-between gap-3'}>
        <p className="m-0 text-[13px]">{ROOM_WORDS.waitingBankWhy}</p>
        <button type="button" className={`${BTN.primary} ${phone ? full : 'w-fit'} opacity-60`} aria-disabled="true" onClick={(e) => e.preventDefault()} data-testid="closing-waiting-bank">{ROOM_WORDS.waitingBank}</button>
      </div>
    );
  }
  return null;
}

function Shell({ dealId, title, chip, sub, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="closing-room">
      <RoomHead dealId={dealId} title={title} chip={chip} sub={sub} />
      {children}
    </div>
  );
}

/**
 * DE38 (no closing opened yet) and DE39 (the closing read Unavailable; no
 * commitment): the investor's own commitment on the deal, read from their
 * commitments. `failed` draws the closing read's failure above it.
 */
export function InvestorNotOpened({ dealId, deal, failed = false, onRetry }) {
  const read = useLoad(() => api.dealCommitments(dealId), [dealId]);
  const company = deal?.project_name || 'This deal';
  const facts = read.status === 'ok' ? commitmentFacts(read.data, deal?.currency || 'USD') : null;
  const chip = failed ? <StateChip kind="unavailable" /> : <StateChip kind="not_recorded" label={ROOM_WORDS.notOpenedChip} data-testid="closing-status" />;
  const body = read.status === 'loading' ? <div className={`h-16 ${pulse}`} />
    : read.status === 'error' ? <Unreadable what={ROOM_WORDS.commitmentUnread} claim="This is not a claim that you have none." onRetry={read.retry} />
      : !facts ? (
        <div className="flex flex-col gap-2" data-testid="closing-no-commitment">
          <StateChip kind="refused" label="Refused · no commitment" />
          <h3 className="m-0 text-[15px] font-bold">{ROOM_WORDS.noCommitment}</h3>
        </div>
      ) : (
        <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]" data-testid="closing-commitment">
          <dt className="text-gray-500 dark:text-gray-400">Your commitment</dt>
          <dd className="m-0 flex flex-wrap items-center gap-2 font-mono font-semibold"><Money text={facts.amount} reason="No amount is recorded on your commitment." /><Chip tone={facts.word === 'Confirmed' ? 'done' : 'wait'} glyph={facts.word === 'Confirmed' ? '✓' : '◔'}>{facts.word}</Chip></dd>
          <dt className="text-gray-500 dark:text-gray-400">Held for</dt>
          <dd className="m-0 font-semibold">{facts.heldFor || <Why reason="No name is recorded on your commitment." />}</dd>
          <dt className="text-gray-500 dark:text-gray-400">Recorded</dt>
          <dd className="m-0 font-mono">{facts.recorded || <Why reason="No day is recorded on your commitment." />}</dd>
        </dl>
      );
  return (
    <Shell dealId={dealId} title={`${company} · Closing`} chip={chip} sub={deal?.instrument ? `${deal.instrument} · ${ROOM_WORDS.yourLineOnly}` : ROOM_WORDS.yourLineOnly}>
      <section className={`${card} max-w-[820px] p-6`} data-testid={failed ? 'closing-record-unread' : 'closing-not-opened'}>
        {failed ? (
          <>
            <h3 className="m-0 text-[18px] font-bold">{ROOM_FAILED.title}</h3>
            <p className={mutedText}>{ROOM_FAILED.claim}</p>
            <button type="button" className={`${BTN.ghost} w-fit`} onClick={onRetry} data-testid="closing-record-retry">Try again</button>
          </>
        ) : (
          <>
            <h3 className="m-0 text-[18px] font-bold" data-testid="closing-record-none">{ROOM_WORDS.notOpenedTitle}</h3>
            <p className={mutedText}>{ROOM_WORDS.notOpenedText}</p>
          </>
        )}
        {body}
        {facts || failed
          ? <Link className={`${failed ? BTN.ghost : BTN.primary} w-fit`} to={tabHref(dealId, 'commitment')} data-testid="closing-back-investment">{ROOM_WORDS.backToInvestment}</Link>
          : <Link className={`${BTN.ghost} w-fit`} to={tabHref(dealId, 'overview')}>{ROOM_WORDS.back}</Link>}
      </section>
    </Shell>
  );
}

/** The investor's room from the closings store (DE35 to DE41). `entry` is the deal's closing from `GET /api/closings`. */
export default function InvestorRoom({ entry, deal }) {
  const phone = usePhoneWidth();
  const read = useLoad(() => closingsApi.read(entry.uid), [entry.uid]);
  const closing = read.status === 'ok' ? read.data : null;
  const { papers, retry: retryPapers } = usePapers(closing?.lines);
  const dealId = closing?.deal_id ?? entry.deal_id ?? deal?.id ?? null;
  const condRead = useLoad(() => api.icConditions(), [dealId], closing != null);
  const [drawer, setDrawer] = useState(null);
  const companyName = entry.project_name || deal?.project_name || 'The company';
  const instrument = entry.instrument || closing?.instrument || deal?.instrument || null;
  const title = roomTitle(companyName, entry.round_label || closing?.round_label);
  const rows = useMemo(() => (closing ? roomLines(closing, papers, 'investor', { company: companyName }) : []), [closing, papers, companyName]);
  const steps = useMemo(() => (closing ? stepStrip(closing, papers) : STEPS.map((name) => ({ name, state: 'unread', text: 'Reading…' }))), [closing, papers]);

  if (read.status === 'error') {
    if (Number(read.error?.status) === 404) return <NoAccess text={NO_ACCESS.line} back={<Link className={`${BTN.ghost} w-fit`} to="/deals">Back to your deals</Link>} />;
    return (
      <Shell dealId={dealId} title={title} chip={<StateChip kind="unavailable" />}>
        <section className={card} data-testid="closing-room-failed">
          <h3 className="m-0 text-[15px] font-bold">{ROOM_FAILED.title}</h3>
          <p className={mutedText}>{ROOM_FAILED.claim}</p>
          <button type="button" className={`${BTN.primary} w-fit`} onClick={read.retry}>Try again</button>
        </section>
      </Shell>
    );
  }

  // DE39 Loading: the header and the steps draw at once, reading, never Done; the blocks are skeletons in their shape.
  if (!closing) {
    return (
      <Shell dealId={dealId} title={title} chip={null} sub={null}>
        <Steps steps={steps} nowView={{ text: '' }} mine={0} phone={phone} />
        <div className={phone ? 'flex flex-col gap-3' : 'grid grid-cols-12 gap-4'} data-testid="closing-room-loading" aria-busy="true">
          {['col-span-4', 'col-span-5', 'col-span-3'].map((s) => <div key={s} className={`h-40 ${pulse} ${phone ? '' : s}`} />)}
        </div>
      </Shell>
    );
  }

  const tiles = roomTiles(closing, papers);
  const currency = closing.currency || 'USD';
  const mine = rows.filter((r) => !r.withdrawn);
  const first = mine[0] || null;
  const line = first ? (closing.lines || []).find((l) => l.uid === first.uid) : (closing.lines || [])[0] || null;
  const paper = first ? paperView(line, papers[first.uid], line?.investor_name) : { state: 'none' };
  const nowView = investorNow(closing, steps, first, paper.kind);
  const open = closing.status === 'open';
  const closed = closing.status === 'closed';
  const ctx = { ...closing, companyName };
  const openLine = (kind) => (r) => setDrawer({ kind, row: r, line: (closing.lines || []).find((l) => l.uid === r.uid) });
  const onPay = (r) => setDrawer({ kind: 'pay', row: r });
  const sides = evidenceSides(line, first?.declaration);
  const conds = conditionsView(condRead, dealId);
  const sp = (n) => (phone ? '' : SPAN[n]);
  const grid = phone ? 'flex flex-col gap-3' : 'grid grid-cols-12 items-start gap-4';
  const full = phone ? 'min-h-[48px] w-full' : 'w-fit';
  const summary = closed ? investorSummary(closing) : null;
  const receivedOn = summary?.find((s) => s.received)?.received || null;
  const papersFailed = rows.some((r) => r.paper === 'Could not be read');
  const bar = <ActionBar nowView={nowView} row={first} phone={phone} onSign={openLine('sign')} onPay={onPay} signReason={paper.nextWho ? `Who signs next: ${paper.nextWho}` : ''} />;

  return (
    <Shell dealId={dealId} title={title} chip={headChip(closing)} sub={roomSub(closing, instrument)}>
      <Steps steps={steps} nowView={nowView} mine={mine.length} phone={phone} />
      {!phone && (nowView.lead || nowView.text) ? (
        <p className="m-0 text-[12.5px] text-gray-900 dark:text-gray-100" data-testid="closing-why">
          {nowView.lead ? <b className="text-violet-800 dark:text-violet-300">{nowView.lead}</b> : null}
          {nowView.text ? ` ${nowView.text}` : ''}
          {closed && receivedOn ? ` Your line was received on the company’s side on ${receivedOn}.` : ''}
          {' '}<span className="text-gray-500 dark:text-gray-400">{ROOM_WORDS.nothingMoves}</span>
        </p>
      ) : null}
      {phone && (closed || closing.status === 'cancelled') ? <p className="m-0 text-[12.5px]" data-testid="closing-why"><b>{nowView.lead}</b> {nowView.text}</p> : null}
      {papersFailed ? (
        <section className={box} data-testid="closing-papers-failed">
          <Unreadable what="Your paper" claim="Its paper and signed count show as not read, never as none." onRetry={retryPapers} />
        </section>
      ) : null}
      {closed ? (
        <div className={grid}>
          <LineCard rows={rows} line={line} tiles={tiles} span={sp(4)} />
          <HoldCard closing={closing} instrument={instrument} phone={phone} onRetry={read.retry} span={sp(4)} />
          <ReportingCard closing={closing} onRetry={read.retry} span={sp(4)} />
          <Fold phone={phone} title="Evidence" meta={sides.receiving.state === 'ok' ? 'Received' : 'None yet'} testId="closing-evidence-sides" span={sp(6)}>
            <EvidenceBody sides={sides} onReceipt={first ? () => openLine('receipt')(first) : null} />
          </Fold>
          <PortfolioCard closing={closing} company={companyName} phone={phone} span={sp(6)} />
        </div>
      ) : (
        <div className={grid}>
          <LineCard rows={rows} line={line} tiles={tiles} span={sp(4)} />
          {first ? <PaperCard row={first} view={paper} primary={nowView.action === 'sign'} phone={phone} onSign={openLine('sign')} span={sp(5)} /> : null}
          {open ? <DeadlineTile tiles={tiles} span={sp(first ? 3 : 8)} /> : null}
          {!phone && (nowView.action === 'pay' || nowView.action === 'wait') ? <section className={`${card} col-span-12`} data-testid="closing-action">{bar}</section> : null}
          <Fold phone={phone} title="Committee conditions" meta={conds.state === 'ok' ? `${conds.open} open` : conds.state === 'none' ? 'None' : conds.state === 'reading' ? 'Reading…' : 'Unavailable'} testId="closing-conditions" span={sp(6)}>
            <span className={eye}>{ROOM_WORDS.conditionsTitle}</span>
            <ConditionsBody view={conds} onRetry={condRead.retry} />
          </Fold>
          <Fold phone={phone} title="Evidence" meta={sides.receiving.state === 'ok' || sides.sending.state === 'ok' ? 'Recorded' : 'None yet'} testId="closing-evidence-sides" span={sp(6)}>
            <EvidenceBody sides={sides} onReceipt={first ? () => openLine('receipt')(first) : null} />
          </Fold>
          {open && first ? <LeftCard left={investorLeft(closing, rows)} unreadable={investorPartUnreadable(closing)} onRetry={read.retry} full={full} onSign={openLine('sign')} onPay={onPay} span={sp(6)} /> : null}
          <div className={`flex min-w-0 flex-col gap-4 ${sp(6)}`}>
            <CaptableCard view={captableView(closing, 'investor')} onOpen={() => setDrawer({ kind: 'captable' })} />
          </div>
          {first && open ? <PaymentCard closing={ctx} row={first} full={full} onRetry={read.retry} span={sp(6)} /> : null}
          {open ? <MercuryCard lines={closing.lines} currency={currency} company={companyName} phone={phone} onAccepted={read.retry} span={sp(6)} /> : null}
        </div>
      )}
      {(closing.lines || []).filter((l) => l.route === 'syndicate' && l.vehicle_ref).map((l) => <SyndicatePanel key={l.uid} line={l} currency={currency} />)}
      {phone && nowView.action ? (
        <div className="sticky bottom-0 z-10 flex flex-col gap-1.5 border-t border-gray-200 bg-white py-3 dark:border-gray-800 dark:bg-gray-900" data-testid="closing-sticky">{bar}</div>
      ) : null}
      {drawer?.kind === 'sign' ? (
        <SignDrawer row={drawer.row} envelope={liveEnvelope(papers[drawer.row.uid])} failed={papers[drawer.row.uid] === null} viewer="investor" company={companyName} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.kind === 'receipt' ? <ReceiptDrawer row={drawer.row} viewer="investor" dealId={closing.deal_id} onClose={() => setDrawer(null)} /> : null}
      {drawer?.kind === 'pay' ? (
        // D6189: the company's account for this project, revealed for this line's own commitment (DE36, DE36b).
        <PaymentDrawer company={companyName} amount={tiles.mine} route={routeLine(line?.route)?.split(' · ')[0] || null} projectId={closing.project_id ?? entry.project_id} dealId={closing.deal_id ?? entry.deal_id} commitmentId={drawer.row?.commitmentId ?? null} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.kind === 'captable' ? (
        <CaptableDialog closing={closing} view={captableView(closing, 'investor')} rows={rows} instrument={instrument} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); read.retry(); }} />
      ) : null}
    </Shell>
  );
}
