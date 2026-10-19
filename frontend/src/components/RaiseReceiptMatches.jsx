// D752 (#1989): "Match to my Mercury" on Raise › Capital relationships. A
// founder matches an investor's wire, a credit in their own Mercury, to the
// committed prospect it pays. Drawn for a founder only; nothing is read until
// they press the button, which reads GET /api/mercury/personal/matches?target=raise
// once. The Worker lists their committed prospects, each with the credits that
// fit it, and their confirmed matches; each prospect is drawn with #1848's
// `MercuryMatchView`. The Worker re-reads and re-checks a line before it writes.
// Once confirmed, the stage reads "Committed · received <date>" from the
// Worker; nobody else sees the bank line. Nothing here sends, transfers or
// requests money.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { mercuryPersonalApi } from '../lib/api/mercuryPersonal';
import { reportError } from '../lib/log';
import { fmtLedgerCents, mercuryReadOutcome } from '../lib/revenueLedger';
import { BrandIcon } from '../ui';
import { MercuryMatchView, matchTargetOf } from './MercuryMatch';

const BTN = 'rounded-md border border-teal-300 px-2.5 py-1 text-[12px] font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-700 dark:text-teal-300';
export const RAISE_PANEL_LEAD = 'Match a committed investor\'s wire to a credit in your own Mercury. Once matched, the stage reads "Committed · received" with its date. Only you see the bank line; others see the stage.';

/** Each committed prospect the read lists, with its own item and confirmed match. */
export function raiseTargetsOf(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((it) => ({ id: Number(it.target_id), label: it.label || `Prospect ${it.target_id}`, amount: fmtLedgerCents(it.amount_cents), ...matchTargetOf(data, it.target_id) }));
}

/** The opened panel's body for one state; pure, so each state renders in node --test. */
export function RaiseReceiptsView({ read, busy, err, reasons, on }) {
  if (read.status === 'loading') return <p className="text-[12px] text-gray-500" data-testid="raise-match-loading"><Loader2 size={12} className="inline animate-spin" /> Reading your Mercury account…</p>;
  if (read.status === 'failed') return <MercuryMatchView target="raise" state={{ read, busy, err, reason: '' }} on={on} />;
  const targets = raiseTargetsOf(read.data);
  if (!targets.length) return <p className="text-[12px] text-gray-500" data-testid="raise-match-none">No prospect in your raise pipeline is at Committed, so there is nothing to match.</p>;
  return (
    <ul className="space-y-3" data-testid="raise-match-list">
      {targets.map((t) => (
        <li key={t.id} className="rounded-lg border border-gray-100 p-2.5 dark:border-gray-800" data-testid={`raise-match-${t.id}`}>
          <div className="mb-1 flex flex-wrap justify-between gap-2 text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">
            <span>{t.label}</span><span className="font-mono">{t.amount ?? 'Amount not recorded'}</span>
          </div>
          <MercuryMatchView target="raise" state={{ read: { status: 'ok', item: t.item, match: t.match }, busy: busy === t.id, err: err?.id === t.id ? err.message : '', reason: reasons[t.id] || '' }}
            on={{ retry: on.retry, reason: (v) => on.reason(t.id, v), confirm: (tx) => on.confirm(t.id, tx), withdraw: (uid) => on.withdraw(t.id, uid) }} />
        </li>
      ))}
    </ul>
  );
}

/** The founder's door on Capital relationships; `onChanged` re-reads the module so the stage shows the date. */
export default function RaiseReceiptMatches({ role, onChanged, api = mercuryPersonalApi }) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [reasons, setReasons] = useState({});
  if (role !== 'founder') return null;

  const load = async () => {
    setRead({ status: 'loading' });
    try {
      const res = await api.matches('raise');
      if (!Array.isArray(res?.items) || !Array.isArray(res?.matches) || res.items.some((i) => !Array.isArray(i?.candidates))) {
        throw new Error('The Mercury matches response could not be read.');
      }
      setRead({ status: 'ok', data: res });
    } catch (e) {
      reportError('mercury-match:raise', e);
      setRead({ status: 'failed', outcome: mercuryReadOutcome(e) });
    }
  };
  const write = async (id, run, fallback) => {
    if (busy != null) return;
    setBusy(id); setErr(null);
    try {
      await run();
      setReasons((r) => ({ ...r, [id]: '' }));
      await load();
      await onChanged?.();
    } catch (e) {
      reportError('mercury-match:raise-write', e);
      setErr({ id, message: e?.message || fallback });
    } finally { setBusy(null); }
  };
  const on = {
    retry: load,
    reason: (id, v) => setReasons((r) => ({ ...r, [id]: v })),
    confirm: (id, transaction_id) => write(id, () => api.confirm({ target_kind: 'raise', target_id: id, transaction_id }), 'That line could not be matched. Nothing changed.'),
    withdraw: (id, uid) => write(id, () => api.withdraw(uid, String(reasons[id] || '').trim()), 'The match could not be withdrawn. It still stands.'),
  };

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="raise-receipts">
      <div className="mb-1 flex items-center gap-2">
        <BrandIcon provider="mercury" name="Mercury" size={24} />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Investor wires</h3>
      </div>
      <p className="mb-2 text-[12px] text-gray-500 dark:text-gray-400">{RAISE_PANEL_LEAD}</p>
      <button type="button" className={BTN} aria-expanded={open} data-testid="raise-match-open"
        onClick={() => { if (open) setOpen(false); else { setOpen(true); setErr(null); load(); } }}>
        {open ? 'Close' : 'Match to my Mercury'}
      </button>
      {open && <div className="mt-2"><RaiseReceiptsView read={read} busy={busy} err={err} reasons={reasons} on={on} /></div>}
    </section>
  );
}
