// D713 (#1778, F29b to F29d): "Match to my Mercury" for one of the member's
// own targets: an engagement invoice, a payout or a partner-deal settlement.
//
// Nothing is read until the member asks: the panel then reads
// GET /api/mercury/personal/matches?target=<kind> once, finds this target's
// item (its candidate lines) or its confirmed match, and offers Confirm on a
// line or Withdraw with a reason. The Worker re-reads and re-checks every line
// before it writes, and it is the Worker that says whether a line fits.
// Nothing here sends, transfers or requests money.
//
// Drawn with each page's own parts; the canvas PR lays it out to boards F29b
// to F29d.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { mercuryPersonalApi } from '../lib/api/mercuryPersonal';
import { reportError } from '../lib/log';
import { Unreadable, Unrecorded } from '../ui';
import { fmtLedgerCents, mercuryReadOutcome } from '../lib/revenueLedger';

export const WITHDRAW_REASON_MIN = 10;
const TARGET_NOUN = { invoice: 'invoice', payout: 'payout', settlement: 'settlement' };
const BTN = 'rounded-md border border-teal-300 px-2.5 py-1 text-[12px] font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-700 dark:text-teal-300';

/** This target's open item and its confirmed match, from one `/matches` read. */
export function matchTargetOf(data, targetId) {
  const id = Number(targetId);
  const items = Array.isArray(data?.items) ? data.items : [];
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  return {
    item: items.find((i) => Number(i?.target_id) === id) || null,
    match: matches.find((m) => Number(m?.target_id) === id && m?.state === 'confirmed') || null,
  };
}

/** "Received 2026-10-01 on ••0042", from a read side's match; null when there is none. */
export function receivedLine(match) {
  if (!match?.posted_on) return null;
  return `Received ${match.posted_on}${match.last_four ? ` on ••${match.last_four}` : ''}`;
}

/** The open panel's body for one state; pure, so each state renders in node --test. */
export function MercuryMatchView({ target, state, on }) {
  const noun = TARGET_NOUN[target] || 'item';
  const { read, busy, err, reason } = state;
  if (read.status === 'loading') return <p className="text-[12px] text-gray-500" data-testid="mercury-match-loading"><Loader2 size={12} className="inline animate-spin" /> Reading your Mercury account…</p>;
  if (read.status === 'failed') {
    const out = read.outcome;
    if (out.kind === 'not_recorded') {
      return (
        <p className="text-[12px] text-gray-500" data-testid="mercury-match-not-recorded">
          <Unrecorded reason={out.reason}>Not recorded</Unrecorded> · {out.reason} <Link to="/account/connectors" className="font-semibold text-teal-700 dark:text-teal-300">Open Connectors</Link>
        </p>
      );
    }
    if (out.kind === 'refused') return <p className="text-[12px] text-amber-700 dark:text-amber-300" role="alert" data-testid="mercury-match-refused">{out.reason}</p>;
    return <div data-testid="mercury-match-unreadable"><Unreadable what="Your Mercury account" claim={`This is not a claim that no line pays this ${noun}.`} onRetry={on.retry} /></div>;
  }
  const { item, match } = read;
  if (match) {
    const ok = String(reason || '').trim().length >= WITHDRAW_REASON_MIN;
    return (
      <div className="space-y-1.5 text-[12px]" data-testid="mercury-match-withdraw">
        <p className="text-gray-600 dark:text-gray-300">Matched to the line posted {match.posted_on || 'on a day not recorded'}{match.last_four ? ` on ••${match.last_four}` : ''}. Withdraw it only if that line does not pay this {noun}.</p>
        <textarea value={reason || ''} onChange={(ev) => on.reason(ev.target.value)} maxLength={1000} rows={2} aria-label="Why withdraw this match"
          placeholder={`Why, in at least ${WITHDRAW_REASON_MIN} characters`} data-testid="mercury-match-reason"
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] dark:border-gray-700 dark:bg-gray-800" />
        {err && <p className="text-rose-600" role="alert" data-testid="mercury-match-error">{err}</p>}
        <button type="button" className={BTN} disabled={!ok || busy} onClick={() => on.withdraw(match.uid)} data-testid="mercury-match-withdraw-button">
          {busy ? 'Withdrawing…' : 'Withdraw match'}
        </button>
      </div>
    );
  }
  if (!item) {
    return <p className="text-[12px] text-gray-500" data-testid="mercury-match-not-open">This {noun} is not open to a match: it is not yours, not issued, or not in US dollars.</p>;
  }
  const candidates = Array.isArray(item.candidates) ? item.candidates : [];
  return (
    <div className="space-y-1.5 text-[12px]" data-testid="mercury-match-candidates">
      <p className="text-gray-500">
        A {item.direction === 'debit' ? 'payment out of' : 'credit to'} your account of {fmtLedgerCents(item.amount_cents) ?? 'an amount not recorded'}, posted {item.window?.from || '—'} to {item.window?.to || '—'}.
      </p>
      {candidates.length === 0 ? (
        <p className="text-gray-500" data-testid="mercury-match-empty">No line in your Mercury account fits this {noun} yet. The amount, the dates and the counterparty must all fit.</p>
      ) : (
        <ul className="space-y-1">
          {candidates.map((l) => (
            <li key={l.transaction_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 px-2 py-1.5 dark:border-gray-800" data-testid={`mercury-line-${l.transaction_id}`}>
              <span>
                <span className="font-mono">{l.posted_on || 'Not recorded'}</span> · {l.counterparty_name || 'Counterparty not recorded'} · <span className="font-mono">{fmtLedgerCents(Math.abs(l.amount_cents)) ?? '—'}</span> · ••{l.last_four || '—'}
              </span>
              <button type="button" className={BTN} disabled={busy} onClick={() => on.confirm(l.transaction_id)} data-testid={`mercury-confirm-${l.transaction_id}`}>
                {busy ? 'Confirming…' : 'This line pays it'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-rose-600" role="alert" data-testid="mercury-match-error">{err}</p>}
    </div>
  );
}

/**
 * The button and, once pressed, the panel. `target` is `invoice`, `payout` or
 * `settlement`; `matched` is the read side's match (or null) and only decides
 * the button's words; `onChanged` reloads the page's own record after a write.
 */
export default function MercuryMatch({ target, targetId, matched, onChanged }) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState('');

  const load = async () => {
    setRead({ status: 'loading' });
    try {
      const res = await mercuryPersonalApi.matches(target);
      if (!Array.isArray(res?.items) || !Array.isArray(res?.matches)
        || res.items.some((item) => !Array.isArray(item?.candidates))) {
        throw new Error('The Mercury matches response could not be read.');
      }
      setRead({ status: 'ok', ...matchTargetOf(res, targetId) });
    } catch (e) {
      reportError(`mercury-match:${target}`, e);
      setRead({ status: 'failed', outcome: mercuryReadOutcome(e) });
    }
  };
  const write = async (run, fallback) => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await run();
      setReason('');
      setOpen(false);
      await onChanged?.();
    } catch (e) {
      reportError(`mercury-match:${target}-write`, e);
      setErr(e?.message || fallback);
    } finally { setBusy(false); }
  };
  const on = {
    retry: load,
    reason: setReason,
    confirm: (transaction_id) => write(
      () => mercuryPersonalApi.confirm({ target_kind: target, target_id: Number(targetId), transaction_id }),
      'That line could not be matched. Nothing changed.',
    ),
    withdraw: (uid) => write(() => mercuryPersonalApi.withdraw(uid, reason.trim()), 'The match could not be withdrawn. It still stands.'),
  };

  return (
    <div className="space-y-1.5" data-testid={`mercury-match-${target}-${targetId}`}>
      <button type="button" className={BTN} onClick={() => { if (open) setOpen(false); else { setOpen(true); setErr(''); load(); } }}
        aria-expanded={open} data-testid={`mercury-match-open-${target}-${targetId}`}>
        {open ? 'Close' : matched ? 'Change the Mercury match' : 'Match to my Mercury'}
      </button>
      {open && <MercuryMatchView target={target} state={{ read, busy, err, reason }} on={on} />}
    </div>
  );
}
