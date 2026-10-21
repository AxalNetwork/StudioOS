import { useCallback, useEffect, useState } from 'react';
import { mercuryInvestorApi } from '../../lib/api/mercuryInvestor';

/**
 * D840 part 4 (#2349) — "From Mercury", the investor's own Mercury in one of
 * their sections, as D782's "From GitHub" part sits in a founder's module.
 *
 *   commit     FACT. "Capacity: $N available as of <date>", the accounts it
 *              counts by last four; Read and Delete. Shown on this page only.
 *   closing    PROPOSAL. "This $N wire to <counterparty> on <date> funded <deal>?"
 *   calls      PROPOSAL. A credit matched to an open capital-call line.
 *   ledger     PROPOSAL. A ledger entry; the first Accept of a category asks
 *              for its accounts, and later ones reuse them.
 *   reporting  FACT month-end cash; PROPOSAL attach that month's statement.
 *   portfolio  Nothing: Mercury feeds nothing here, and the part says so.
 *
 * Nothing is written without Accept. A refusal (no Mercury, a branch, the
 * wrong role) reads "Not recorded" with the reason; a failed read reads
 * "Unreadable", never zero.
 */
const KIND = { closing: 'closing', calls: 'call', ledger: 'ledger', reporting: 'statement' };

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
const BTN = 'rounded-md bg-indigo-700 px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400';
const BTN2 = 'rounded-md border border-axal-hairline px-3 py-1 text-[12px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200';

export const money = (cents) => (Number.isSafeInteger(cents)
  ? (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  : 'Not recorded');

/** What a proposal asks, in the issue's words. */
export function proposalText(section, p) {
  const amount = money(Math.abs(Number(p.amount_cents)));
  const on = p.posted_on ? ` on ${p.posted_on}` : '';
  if (section === 'closing') return `This ${amount} wire${p.counterparty ? ` to ${p.counterparty}` : ''}${on} funded your commitment?`;
  if (section === 'calls') return `This ${amount} payment${p.counterparty ? ` from ${p.counterparty}` : ''}${on} pays capital-call line ${p.target_id}?`;
  if (section === 'ledger') return `${Number(p.amount_cents) < 0 ? 'Paid' : 'Received'} ${amount}${p.counterparty ? ` · ${p.counterparty}` : ''}${on} · ${p.category || 'Uncategorised'}`;
  return `Attach the statement ending ${p.posted_on} (••${p.account_last_four}) to this period's report?`;
}

export default function FromMercury({ section, fundId = null }) {
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [picks, setPicks] = useState({});

  const load = useCallback(async () => {
    if (section === 'portfolio') { setState({ loading: false }); return; }
    if (section !== 'commit' && section !== 'closing' && !fundId) { setState({ loading: false, empty: 'Pick a fund to see what Mercury brings to it.' }); return; }
    try {
      if (section === 'commit') {
        const r = await mercuryInvestorApi.capacity();
        setState({ loading: false, capacity: r?.capacity ?? null });
      } else if (section === 'reporting') {
        const r = await mercuryInvestorApi.reporting(fundId);
        setState({ loading: false, cash: r?.month_end_cash ?? [], proposals: (r?.statements ?? []).map((s) => ({ ...s, posted_on: s.period_end })) });
      } else {
        const r = await mercuryInvestorApi.proposals(KIND[section], fundId);
        const map = section === 'ledger' ? await mercuryInvestorApi.ledgerMap(fundId) : null;
        setState({ loading: false, proposals: r?.proposals ?? [], map });
      }
    } catch (e) {
      setState({ loading: false, refused: e?.status === 403 || e?.status === 404 || e?.status === 409 || e?.status === 402, reason: e?.message || '' });
    }
  }, [section, fundId]);

  useEffect(() => { load(); }, [load]);

  const act = async (key, fn) => {
    setBusy(key); setError('');
    try { await fn(); await load(); } catch (e) { setError(e?.message || 'That did not go through. Nothing changed.'); } finally { setBusy(null); }
  };

  return (
    <section id="from-mercury" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid={`from-mercury-${section}`} aria-labelledby={`from-mercury-${section}-title`}>
      <h2 id={`from-mercury-${section}-title`} className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From Mercury</h2>
      {section === 'portfolio' ? (
        <p className={LINE} data-testid="from-mercury-portfolio-none">Mercury feeds nothing in Portfolio: portfolio figures belong to the companies, not to your bank account.</p>
      ) : state.loading ? (
        <p className={FAINT}>Reading…</p>
      ) : state.empty ? (
        <p className={LINE}>{state.empty}</p>
      ) : state.reason !== undefined ? (
        <p className={LINE} data-testid="from-mercury-reason">{state.refused ? `Not recorded: ${state.reason || 'your Mercury is not connected here.'}` : `Unreadable: ${state.reason || 'your Mercury could not be read. Nothing changed.'}`}</p>
      ) : (
        <>
          {section === 'commit' && <Capacity capacity={state.capacity} busy={busy} picks={picks} setPicks={setPicks} act={act} />}
          {section === 'reporting' && <MonthEndCash cash={state.cash} busy={busy} act={act} />}
          {section !== 'commit' && (
            <Proposals section={section} proposals={state.proposals} map={state.map} busy={busy} act={act} fundId={fundId} />
          )}
          {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="from-mercury-error">{error}</p>}
        </>
      )}
    </section>
  );
}

function Capacity({ capacity, busy, picks, setPicks, act }) {
  const [accounts, setAccounts] = useState(null);
  const chosen = Object.keys(picks).filter((k) => picks[k]);
  return (
    <div className="flex flex-col gap-1.5" data-testid="from-mercury-capacity">
      <h3 className={SUB}>Capacity</h3>
      {capacity ? (
        <>
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">Capacity: {money(capacity.available_cents)} available as of {capacity.as_of}</p>
          <span className={FAINT}>Across ••{capacity.account_last_fours.join(', ••')} · only you see this</span>
        </>
      ) : (
        <p className={LINE}>Not recorded: pick the accounts that count, and Mercury's available balance is read once.</p>
      )}
      {accounts && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {accounts.map((a) => (
            <li key={a.id}>
              <label className={LINE}>
                <input type="checkbox" checked={!!picks[a.id]} onChange={(e) => setPicks({ ...picks, [a.id]: e.target.checked })} /> {a.name || a.kind} ••{a.last_four}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 pt-1">
        {accounts ? (
          <button type="button" className={BTN} disabled={busy != null || !chosen.length} onClick={() => act('capacity', async () => { await mercuryInvestorApi.setCapacity(chosen); setAccounts(null); })}>
            {busy === 'capacity' ? 'Reading…' : 'Read capacity'}
          </button>
        ) : (
          <button type="button" className={BTN} disabled={busy != null} onClick={() => act('accounts', async () => setAccounts((await mercuryInvestorApi.accounts())?.accounts ?? []))}>
            {capacity ? 'Change accounts' : 'Pick accounts'}
          </button>
        )}
        {capacity && (
          <>
            <button type="button" className={BTN2} disabled={busy != null} onClick={() => act('refresh', () => mercuryInvestorApi.sync({ section: 'commit' }))}>Refresh</button>
            <button type="button" className={BTN2} disabled={busy != null} onClick={() => act('delete', () => mercuryInvestorApi.deleteCapacity())}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

function MonthEndCash({ cash, busy, act }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="from-mercury-cash">
      <h3 className={SUB}>Month-end cash</h3>
      {cash.length === 0 ? (
        <p className={LINE}>Not recorded: no statement has been read for this fund yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {cash.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={LINE}>{m.month}: {money(m.cash_cents)} <span className={FAINT}>· ••{m.account_last_fours.join(', ••')}</span></span>
              <button type="button" className={BTN2} disabled={busy != null} onClick={() => act(`cash-${m.id}`, () => mercuryInvestorApi.deleteMonthEndCash(m.id))}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Proposals({ section, proposals, map, busy, act, fundId }) {
  const [ledger, setLedger] = useState({});
  const open = proposals.filter((p) => p.state === 'proposed');
  const done = proposals.filter((p) => p.state === 'accepted');
  const mapped = (cat) => (map?.map ?? []).some((m) => m.category === (cat || 'Uncategorised'));
  const accept = (p) => act(p.uid, () => mercuryInvestorApi.accept(p.uid, section === 'ledger' ? {
    period_id: Number(ledger.period_id || map?.periods?.[0]?.id),
    ...(mapped(p.category) ? {} : { ledger_account_id: Number(ledger[`${p.uid}:ledger`]), cash_account_id: Number(ledger[`${p.uid}:cash`]) }),
  } : {}));
  return (
    <div className="flex flex-col gap-1.5" data-testid={`from-mercury-proposals-${section}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={SUB}>Proposed from Mercury</h3>
        <button type="button" className={BTN2} disabled={busy != null} data-testid={`from-mercury-sync-${section}`}
          onClick={() => act('sync', () => mercuryInvestorApi.sync({ section, fund_id: fundId ?? undefined }))}>{busy === 'sync' ? 'Reading…' : 'Read Mercury'}</button>
      </div>
      {section === 'ledger' && (map?.periods ?? []).length > 1 && (
        <label className={LINE}>Post into{' '}
          <select value={ledger.period_id || ''} onChange={(e) => setLedger({ ...ledger, period_id: e.target.value })}>
            {map.periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      )}
      {open.length === 0 ? (
        <p className={LINE}>Nothing is waiting. Read Mercury to look for new items; nothing is written until you accept it.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {open.map((p) => (
            <li key={p.uid} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`mercury-proposal-${p.uid}`}>
              <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{proposalText(section, p)}</p>
              <span className={FAINT}>{p.account_last_four ? `••${p.account_last_four} · ` : ''}Proposed by Mercury</span>
              {section === 'ledger' && !mapped(p.category) && (
                <div className="flex flex-wrap gap-2">
                  {['ledger', 'cash'].map((side) => (
                    <label key={side} className={FAINT}>{side === 'ledger' ? `"${p.category || 'Uncategorised'}" posts to` : 'against'}{' '}
                      <select value={ledger[`${p.uid}:${side}`] || ''} onChange={(e) => setLedger({ ...ledger, [`${p.uid}:${side}`]: e.target.value })}>
                        <option value="">Pick an account</option>
                        {(map?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" className={BTN} disabled={busy != null} onClick={() => accept(p)} data-testid={`mercury-accept-${p.uid}`}>{busy === p.uid ? 'Saving…' : 'Accept'}</button>
                <button type="button" className={BTN2} disabled={busy != null} onClick={() => act(p.uid, () => mercuryInvestorApi.dismiss(p.uid))} data-testid={`mercury-dismiss-${p.uid}`}>Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <h3 className={SUB}>Accepted</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {done.map((p) => (
              <li key={p.uid} className={LINE}>
                {section === 'reporting' ? `Statement ending ${p.posted_on} (••${p.account_last_four}) attached to this period's report` : proposalText(section, p)}{' '}
                <span className={FAINT}>· Accepted{section === 'reporting' ? '' : ', citing the transaction'}</span>
                {section === 'reporting' && (
                  <button type="button" className={`${BTN2} ml-2`} disabled={busy != null} data-testid={`mercury-statement-pdf-${p.uid}`}
                    onClick={() => act(`pdf-${p.uid}`, async () => {
                      const { blob, filename } = await mercuryInvestorApi.statementPdfBlob(p.uid);
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url; link.download = filename; link.click();
                      URL.revokeObjectURL(url);
                    })}>Download PDF</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
