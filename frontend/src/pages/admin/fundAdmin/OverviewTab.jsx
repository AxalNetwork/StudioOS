import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded } from '../../../ui';
import { LoadingRows } from '../../account/AccountCenter';
import { entityErrorWords, entityState } from './mercuryEntityModel';
import { BASE, ending, money } from './fundAdminModel';
import { activityRow, activityTime, attentionItems, fundPosition, healthRows } from './workspaceModel';
import { useRead } from './useRead';
import { Line, NUM, Note, Panel, ReadFailure as Unreadable, TAP, TH } from './parts';

/**
 * D4812 (#4812, board FA-01) — the Overview, attention first: Needs attention
 * (fund, issue, date, next action), the six-figure Fund position (NAV with its
 * own date), the compact Funds rows, Recent activity (the Worker's new
 * `/api/fund-admin/activity`), and Banking & entities last, folded to one
 * line when no entity is connected.
 *
 * Every part reads the fund scope (`fundId`, null for All funds). Each source
 * keeps its own state: a block that failed is Unreadable on its own, and
 * Needs attention never says "nothing waits" while a source it counts did not
 * read. Money is a figure, `Not recorded` with its reason, or `Unreadable`.
 */
const STATE_TONE = { Overdue: 'warn', 'Needs match': 'warn', Prepared: 'info', Awaiting: 'info', Open: 'neutral', Unreadable: 'danger' };
const MARK = { Overdue: '▲', 'Needs match': '▲', Prepared: '◐', Awaiting: '◐', Open: '○', Unreadable: '!' };
// The mark says the state beside the colour, so colour is never alone.
const StatePill = ({ state, children }) => <Pill tone={STATE_TONE[state] || 'neutral'}><span aria-hidden="true">{MARK[state] || '·'}</span> {children || state}</Pill>;

const SOURCE = {
  funds: ['The administered funds', 'This is not a claim that none waits.'],
  matches: ['The bank matches', 'This is not a claim that none waits.'],
  drafts: ['The reporting queue', 'This is not a claim that nothing waits for review.'],
  booklets: ['The subscription booklets', 'This is not a claim that none waits.'],
};

const amount = (cents) => money(cents) ?? <Unrecorded />;
const blockOk = (b) => b?.state === 'ok' && Array.isArray(b.items);
const KIND = { checking: 'Checking', savings: 'Savings' };

function NeedsAttention({ overview, fundId, readAt, onRetry }) {
  const { items, unreadable } = attentionItems(overview, fundId);
  const quiet = items.length === 0 && unreadable.length === 0;
  return (
    <Panel label="Needs attention" sub={quiet ? 'Nothing waiting' : items.length ? `${items.length} item${items.length === 1 ? '' : 's'} · overdue money first` : 'Not every source could be read'} testId="overview-attention">
      {quiet && (
        <div className="flex items-start gap-3 px-4 py-4 sm:px-5" data-testid="overview-attention-clear">
          <span aria-hidden="true" className="mt-0.5 text-axal-positive dark:text-emerald-300">✓</span>
          <div>
            <div className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Nothing currently requires action.</div>
            <div className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">Calls, report packs, booklets and bank matches were all read{readAt ? ` at ${readAt}` : ''}.</div>
          </div>
        </div>
      )}
      {items.map((a) => (
        <div key={a.key} className="grid grid-cols-1 gap-2 border-b border-axal-hairline px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto_auto] sm:items-center sm:gap-4 sm:px-5 dark:border-gray-800" data-testid={`overview-attention-${a.key}`}>
          <div className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{a.fund}</div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{a.issue}</div>
            <div className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">{a.meta}</div>
          </div>
          <div><StatePill state={a.state} /></div>
          <Link to={a.action.to} className="inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline px-3 text-[13px] font-bold text-axal-violet-deep hover:bg-axal-lavender sm:min-h-[36px] dark:border-gray-700 dark:text-violet-300" data-testid={`overview-attention-go-${a.key}`}>{a.action.label}</Link>
        </div>
      ))}
      {unreadable.map((k) => (
        <div key={k} className="px-4 py-3 sm:px-5" data-testid={`overview-${k}-unreadable`}>
          <Unreadable what={SOURCE[k][0]} claim={SOURCE[k][1]} onRetry={onRetry} />
        </div>
      ))}
    </Panel>
  );
}

function Figure({ f }) {
  if (f.state === 'unreadable') return <span className="text-[14px] font-bold text-red-700 dark:text-red-300" data-testid={`position-${f.key}-unreadable`}>! Unreadable</span>;
  if (f.state === 'loading') return <span className="inline-block h-5 w-20 rounded bg-gray-200 dark:bg-gray-700" aria-label="Reading" />;
  if (f.state === 'not_recorded') return <span className="text-[14px]"><Unrecorded reason={f.reason}>— Not recorded</Unrecorded></span>;
  return <span className={`text-[22px] font-bold tracking-[-.02em] text-axal-ink dark:text-gray-100 ${NUM}`}>{money(f.cents)}</span>;
}

function FundPosition({ overview, performance, fundId, scopeLabel, onRetry }) {
  const figures = fundPosition(overview, performance, fundId);
  return (
    <section aria-label="Fund position" data-testid="overview-position">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={TH}>Fund position</h3>
        <span className="text-[12px] text-axal-muted dark:text-gray-400">{scopeLabel}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-axal-hairline py-4 sm:grid-cols-3 lg:grid-cols-6 dark:border-gray-800">
        {figures.map((f) => (
          <div key={f.key} data-testid={`position-${f.key}`}>
            <dt className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{f.label}</dt>
            <dd className="m-0 mt-1"><Figure f={f} /></dd>
            {f.state === 'not_recorded' && f.reason && <dd className="m-0 mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">{f.reason}</dd>}
            {f.note && <dd className="m-0 mt-0.5 font-mono text-[12px] text-axal-muted dark:text-gray-400">{f.note}</dd>}
          </div>
        ))}
      </dl>
      {performance?.status === 'unreadable' && <div className="mt-2"><Unreadable what="NAV and distributions" claim="This is not a claim that they are $0." onRetry={performance.reload || onRetry} /></div>}
    </section>
  );
}

function Funds({ overview, performance, fundId, onRetry }) {
  const rows = healthRows(overview, performance, fundId);
  return (
    <Panel label="Funds" testId="overview-funds">
      {rows == null
        ? <div className="px-4 py-3 sm:px-5" data-testid="overview-funds-list-unreadable"><Unreadable what="The administered funds" claim="This is not a claim that there is none." onRetry={onRetry} /></div>
        : rows.length === 0
          ? <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center" data-testid="overview-no-fund"><span aria-hidden="true" className="text-3xl text-axal-muted dark:text-gray-400">○</span><h3 className="font-bold text-axal-ink dark:text-gray-100">No Axal VC fund is recorded yet.</h3><p className="max-w-md text-sm text-axal-muted dark:text-gray-400">No administered fund. A fund whose general partner of record is an outside GP is run from its own fund page.</p></div>
          : rows.map((r) => (
            <div key={r.id} className="grid grid-cols-1 gap-2 border-b border-axal-hairline px-4 py-3.5 last:border-b-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-center sm:gap-4 sm:px-5 dark:border-gray-800" data-testid={`overview-fund-${r.id}`}>
              <div className="min-w-0">
                <Link to={`${BASE}/funds/${r.id}`} className={`${TAP} text-[14px] font-bold text-axal-ink hover:text-axal-violet-deep hover:underline dark:text-gray-100 dark:hover:text-violet-300`}>{r.name}</Link>
                <div className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">{r.ident || <Unrecorded>Status not read</Unrecorded>}</div>
              </div>
              <div className={`text-[13px] text-zinc-700 dark:text-gray-200 ${NUM}`}>
                <div>{amount(r.committed)} committed</div>
                <div className="text-axal-muted dark:text-gray-400">{amount(r.outstanding)} outstanding</div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
                {r.chips.map((c) => <StatePill key={c.key} state={c.state}>{c.text}</StatePill>)}
                {r.quiet.length > 0 && <span>{r.quiet.join(' · ')}</span>}
                <span className="basis-full">{r.fee.state === 'unreadable' ? <span className="text-red-700 dark:text-red-300" data-testid={`overview-fund-fee-unreadable-${r.id}`}>Fee periods unreadable</span> : r.fee.state === 'ok' ? r.fee.text : <Unrecorded>{r.fee.text}</Unrecorded>}</span>
              </div>
              <Link to={r.setup ? `${BASE}/lps?add=1&fund=${r.id}` : `${BASE}/funds/${r.id}`} className="inline-flex min-h-[44px] items-center text-[13px] font-bold text-axal-violet-deep hover:underline sm:min-h-0 dark:text-violet-300" data-testid={`overview-open-${r.id}`}>{r.setup ? 'Complete setup →' : 'Open fund →'}</Link>
            </div>
          ))}
      {blockOk(overview?.funds) && !blockOk(overview?.fees) && <div className="px-4 py-3 sm:px-5" data-testid="overview-fees-unreadable"><Unreadable what="The fee periods" claim="This is not a claim that no fee is due." onRetry={onRetry} /></div>}
    </Panel>
  );
}

function RecentActivity({ apis, fundId, refreshKey }) {
  const [pages, setPages] = useState([]);
  const first = useRead(() => apis.fundAdmin.activity({ fund: fundId }), [apis, fundId, refreshKey]);
  const [older, setOlder] = useState({ status: 'idle', error: null });
  const all = first.status === 'ready' ? [...(first.data?.items || []), ...pages.flatMap((p) => p.items)] : [];
  const next = pages.length ? pages[pages.length - 1].next_before : first.data?.next_before ?? null;
  const more = async () => {
    setOlder({ status: 'loading', error: null });
    try {
      const page = await apis.fundAdmin.activity({ fund: fundId, before: next });
      setPages((p) => [...p, { items: page?.items || [], next_before: page?.next_before ?? null }]);
      setOlder({ status: 'idle', error: null });
    } catch (error) { setOlder({ status: 'unreadable', error }); }
  };
  return (
    <Panel label="Recent activity" sub="Fund acts taken by HQ admins, newest first" testId="overview-activity">
      {(first.status === 'loading' || first.status === 'idle') && <div className="p-5"><LoadingRows lines={3} /></div>}
      {first.status === 'unreadable' && <div className="px-4 py-3 sm:px-5" data-testid="overview-activity-unreadable"><Unreadable what="Recent activity" claim="This is not a claim that nothing happened." onRetry={first.reload} /></div>}
      {first.status === 'ready' && all.length === 0 && <Note testId="overview-activity-empty">No fund activity yet.</Note>}
      {all.length > 0 && (
        <ol className="m-0 list-none p-0">
          {all.map((item) => {
            const r = activityRow(item);
            return (
              <li key={r.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-axal-hairline px-4 py-2.5 last:border-b-0 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,2.2fr)_auto_minmax(0,1fr)] sm:items-center sm:px-5 dark:border-gray-800" data-testid={`overview-activity-${r.id}`}>
                <time dateTime={String(item.at || '').replace(' ', 'T')} className={`text-[12px] text-axal-muted dark:text-gray-400 ${NUM}`}>{activityTime(item.at)}</time>
                <span className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{r.fund}</span>
                <span className="col-start-2 text-[13px] text-zinc-700 sm:col-start-auto dark:text-gray-200">{r.what}</span>
                <span className={`col-start-2 text-[13px] font-semibold text-axal-ink sm:col-start-auto sm:text-right dark:text-gray-100 ${NUM}`}>{r.amount || ''}</span>
                <span className="col-start-2 text-[12px] text-axal-muted sm:col-start-auto dark:text-gray-400">{r.actor} · <span className={NUM}>{r.ref}</span></span>
              </li>
            );
          })}
        </ol>
      )}
      {first.status === 'ready' && next != null && (
        <div className="border-t border-axal-hairline px-4 py-2 sm:px-5 dark:border-gray-800">
          <button type="button" className="min-h-[44px] text-[13px] font-bold text-axal-violet-deep hover:underline disabled:opacity-50 sm:min-h-[36px] dark:text-violet-300" disabled={older.status === 'loading'} onClick={more} data-testid="overview-activity-more">Show older</button>
          {older.status === 'unreadable' && <Unreadable what="The older activity" claim="The rows above are still the newest." onRetry={more} />}
        </div>
      )}
    </Panel>
  );
}

function EntityCard({ e }) {
  const state = entityState(e.connection);
  const error = e.connection ? entityErrorWords(e.connection.last_error) : null;
  return (
    <div className="overflow-hidden rounded-axal-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid={`overview-entity-${e.entity_key}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{e.name}</div>
          <div className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">
            {e.connection
              ? `${e.connection.org_name || 'Organization not recorded'} · ${e.connection.last_synced_at ? `last synced ${e.connection.last_synced_at}` : 'not synced yet'}`
              : <Unrecorded reason={e.reason}>{e.reason || 'Not recorded'}</Unrecorded>}
          </div>
        </div>
        <Pill tone={state.tone}>{state.text}</Pill>
      </div>
      {error && <p className="mx-4 mt-2 text-[12px] text-red-700 sm:mx-5 dark:text-red-300" data-testid={`overview-entity-error-${e.entity_key}`}>{error}</p>}
      <div className="mt-3 border-t border-axal-hairline dark:border-gray-800">
        {e.accounts.length === 0
          ? <Note testId={`overview-entity-no-account-${e.entity_key}`}>{e.connection ? <Unrecorded reason={e.reason}>{e.reason || 'No bank account yet'}</Unrecorded> : 'No bank account yet'}</Note>
          : e.accounts.map((a) => (
            <Line key={a.uid} a={`${KIND[a.kind] || 'Account'} · ${ending(a.ending)}${a.nickname ? ` · ${a.nickname}` : ''}`}
              b={<>Available {amount(a.available_cents)}{a.balance_read_at ? ` · as of ${a.balance_read_at}` : ''}</>}
              figure={amount(a.current_cents)} />
          ))}
      </div>
    </div>
  );
}

function Banking({ overview, onRetry }) {
  if (!blockOk(overview?.entities)) {
    return <Panel label="Banking & entities" testId="overview-banking"><div className="px-4 py-3 sm:px-5" data-testid="overview-entities-unreadable"><Unreadable what="The entity connections" claim="This is not a claim that none is connected." onRetry={onRetry} /></div></Panel>;
  }
  const all = overview.entities.items;
  const connected = all.filter((e) => e.connection);
  const rest = all.filter((e) => !e.connection);
  return (
    <Panel label="Banking & entities" testId="overview-banking">
      {connected.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5" data-testid="overview-banking-none">
          <span aria-hidden="true" className="text-axal-muted dark:text-gray-400">○</span>
          <div className="min-w-0 flex-1 basis-64">
            <div className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">No Axal entity is connected to Mercury yet.</div>
            <div className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">Balances and bank matches appear once one is.</div>
          </div>
          <Link to={`${BASE}/banking`} className="inline-flex min-h-[44px] items-center text-[13px] font-bold text-axal-violet-deep hover:underline sm:min-h-0 dark:text-violet-300" data-testid="overview-banking-setup">Set up banking</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2 sm:p-5">{connected.map((e) => <EntityCard key={e.entity_key} e={e} />)}</div>
      )}
      {rest.length > 0 && (
        <details className="border-t border-axal-hairline px-4 py-2.5 sm:px-5 dark:border-gray-800" data-testid="overview-entities-more">
          <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-bold text-axal-violet-deep sm:min-h-0 dark:text-violet-300">
            {connected.length === 0 ? `View entities (${all.length})` : `${rest.length} other entit${rest.length === 1 ? 'y is' : 'ies are'} not connected · View entities (${all.length})`}
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-3 pb-2 lg:grid-cols-2">{rest.map((e) => <EntityCard key={e.entity_key} e={e} />)}</div>
        </details>
      )}
    </Panel>
  );
}

export function OverviewTab({ overview, performance, apis, fundId = null, scopeLabel = 'All funds', readAt = null, refreshKey = 0 }) {
  if (overview.status === 'loading' || overview.status === 'idle') {
    return (
      <div className="mx-4 mt-5 flex flex-col gap-4 sm:mx-6" aria-busy="true" data-testid="fund-admin-loading">
        <Panel label="Needs attention"><div className="p-5"><LoadingRows lines={3} /></div></Panel>
        <Panel label="Fund position"><div className="p-5"><LoadingRows lines={2} /></div></Panel>
        <Panel label="Funds"><div className="p-5"><LoadingRows lines={3} /></div></Panel>
      </div>
    );
  }
  if (overview.status === 'unreadable') {
    const audit = overview.error?.status === 503;
    return (
      <div className="mx-4 mt-5 sm:mx-6" data-testid="overview-unreadable">
        <Unreadable what="The fund administration overview"
          claim={audit ? 'Nothing was read, because its audit row could not be written.' : 'This is not a claim that there is nothing to administer.'}
          onRetry={overview.reload} />
      </div>
    );
  }
  const o = overview.data || {};
  return (
    <section className="mx-4 mt-5 flex flex-col gap-5 sm:mx-6" aria-label="Overview" data-testid="overview">
      <NeedsAttention overview={o} fundId={fundId} readAt={readAt} onRetry={overview.reload} />
      <FundPosition overview={o} performance={performance} fundId={fundId} scopeLabel={scopeLabel} onRetry={overview.reload} />
      <Funds overview={o} performance={performance} fundId={fundId} onRetry={overview.reload} />
      {apis?.fundAdmin?.activity && <RecentActivity key={`${fundId ?? 'all'}-${refreshKey}`} apis={apis} fundId={fundId} refreshKey={refreshKey} />}
      <Banking overview={o} onRetry={overview.reload} />
    </section>
  );
}
