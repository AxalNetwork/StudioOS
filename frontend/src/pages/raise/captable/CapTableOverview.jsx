import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { capTableHolderApi } from '../../../lib/api/capTableHolder';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { useAuth } from '../../../hooks/useAuthSync';
import { hasTier } from '../../../sidebarConfig';
import { Lightbox, Unreadable } from '../../../ui';
import { Tag } from './CapTableTag';
import { HOME_PATH, harbour, tabSearch } from './capTableModel';
import HolderDrawer from './HolderDrawer';
import {
  AS_OF_NONE, COFOUNDER_LINE, EMPTY_LINE, EMPTY_TITLE, EXPLORER_LINE, EXPLORER_TITLE, FD_LEGEND, MODEL_LINE, MODEL_TITLE,
  OTHER_LINE, OTHER_TITLE, PLANS_PATH, PLAN_LINE, SAVE_BLOCKED, UNREADABLE_LINE,
  asOf, bars, byClass, cartaChip, harbourChip, instruments, needsYou, proposalsFromModel, tiles, whoOwns,
} from './overviewModel';

/**
 * D1022 (#2859, part 7 of #2432) — Overview's record blocks (CT1, CT1c, CT16,
 * CT19–CT22, CT24) and the holder drawer (CT2), drawn under the tool's tabs on
 * the Cap table module page. Every figure comes from a read; see
 * `overviewModel.js`. Each read answers alone: a failed one says so where its
 * block would be, and a failed record read offers nothing to save.
 *
 * Record an issuance and Void are part 10's dialogs (#2862): the tool bar and
 * the drawer take them as `onRecord` and `onVoid` and draw nothing until they
 * are given one.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] px-3 text-[12.5px] font-bold disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const CHIP = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const BAR_FILL = {
  founders: 'bg-violet-600 dark:bg-violet-400',
  investors: 'bg-teal-600 dark:bg-teal-400',
  people: 'bg-amber-500 dark:bg-amber-400',
  other: 'bg-slate-500 dark:bg-slate-400',
  pool: 'bg-[repeating-linear-gradient(45deg,#c4b5fd_0_4px,#ede9fe_4px_8px)] dark:bg-[repeating-linear-gradient(45deg,#6d28d9_0_4px,#312e81_4px_8px)]',
};

/** One read, answering alone: loading, ready, refused (403 or 404) or error. */
function useRead(load, key, reload) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (key == null) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(() => load(key))
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', data: null, error }); });
    return () => { alive = false; };
  }, [load, key, reload]);
  return state;
}

const readRecord = (id) => capTableRecordApi.read(id);
const readCompare = (id) => api.getCapTableCompare(id);
const read409a = (id) => api.get409a(id);
const readIntegrations = () => api.integrationsList();
const readGrants = (id) => capTableHolderApi.grants(id);

function Chip({ chip, testId }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${CHIP[chip.tone] || CHIP.muted}`} title={chip.title || undefined} data-testid={testId}>{chip.text}</span>;
}

function Block({ title, tag, aside, children, testId }) {
  return (
    <section className={CARD} data-testid={testId}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className={`m-0 flex items-center gap-2 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{title} {tag}</h2>
          {aside}
        </div>
      ) : null}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Center({ mark, title, line, children, testId }) {
  return (
    <div className={`${CARD} flex flex-col items-center gap-2 px-6 py-10 text-center`} data-testid={testId}>
      <span className={`text-[22px] ${MUTED}`} aria-hidden="true">{mark}</span>
      <p className={`m-0 text-[15px] font-extrabold ${INK}`}>{title}</p>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{line}</p>
      {children ? <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

function Seg({ options, value, onChange, label, testId }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] border border-axal-hairline p-0.5 dark:border-gray-700" data-testid={testId}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
          className={`rounded-[7px] px-2.5 py-1 text-[11.5px] font-bold ${value === id ? 'bg-axal-violet text-white' : MUTED}`}
          data-testid={`${testId}-${id}`}>{text}</button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── the tool bar

function ToolBar({ record, harbourRead, cartaRead, need, role, plan, onRecord }) {
  const failed = record.status === 'error';
  const loading = record.status === 'loading';
  const chips = loading
    ? [{ text: 'Reading…', tone: 'muted' }, cartaChip(null, 'loading'), harbourChip(null, 'loading')]
    : failed
      ? [{ text: 'As of · could not be read', tone: 'warn' }]
      : [
        { text: record.status === 'ready' ? asOf(record.data) : AS_OF_NONE, tone: 'muted' },
        cartaChip(cartaRead.data, cartaRead.status),
        harbourChip(harbourRead.data, harbourRead.status),
        ...(need?.count ? [{ text: `● ${need.meta}`, tone: 'warn' }] : []),
      ];
  let actions = null;
  if (failed) actions = <span className={`text-[12.5px] font-semibold ${MUTED}`} data-testid="captable-save-blocked">{SAVE_BLOCKED}</span>;
  else if (!plan && role !== 'reader') {
    actions = (
      <>
        <span className="inline-flex min-h-[30px] items-center rounded-full border border-axal-lavender-edge bg-axal-lavender px-3 text-[12.5px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300" data-testid="captable-plan-gate">{PLAN_LINE}</span>
        <Link className={GHOST} to={PLANS_PATH}>See plans</Link>
      </>
    );
  } else if (onRecord && role === 'owner') actions = <button type="button" className={PRIMARY} onClick={() => onRecord('record')} data-testid="captable-record">Record an issuance</button>;
  else if (onRecord && role === 'cofounder') actions = <button type="button" className={PRIMARY} onClick={() => onRecord('propose')} data-testid="captable-propose">Propose an issuance</button>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="captable-toolbar">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c, i) => <Chip key={i} chip={c} testId={`captable-chip-${i}`} />)}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── Needs you

function NeedsYou({ need, role, onReview }) {
  if (!need.count) return null;
  return (
    <Block title="Needs you" aside={<span className="font-mono text-[11.5px] font-bold text-amber-700 dark:text-amber-300" data-testid="captable-needs-meta">{need.meta}</span>} testId="captable-needs">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {need.rows.map((r) => (
          <li key={r.uid} className="flex flex-wrap items-center gap-2 border-b border-axal-ground pb-2 last:border-b-0 last:pb-0 dark:border-gray-800" data-testid="captable-need">
            <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${CHIP.muted}`}>{r.pill}</span>
            <span className={`min-w-0 flex-1 text-[12.5px] ${INK}`}>{r.lead} {r.text}</span>
            <button type="button" className={GHOST} onClick={() => onReview(r)} data-testid="captable-need-review">{role === 'owner' ? 'Review' : 'Open'}</button>
          </li>
        ))}
      </ul>
      {need.count > need.rows.length ? <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`}>{need.count - need.rows.length} more wait in the record.</p> : null}
    </Block>
  );
}

/** A proposal opened from Needs you: what it records, who sees it, then Accept or Dismiss (the owner's). */
function ProposalDialog({ projectId, item, role, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const act = (what) => {
    setBusy(true); setError(null);
    const call = what === 'accept' ? capTableRecordApi.accept(projectId, item.uid, {}) : capTableRecordApi.dismiss(projectId, item.uid, reason.trim() ? { reason: reason.trim() } : {});
    call.then(() => { setBusy(false); onDone(); }, (e) => {
      setBusy(false);
      const missing = Array.isArray(e?.data?.missing) && e.data.missing.length ? ` It still needs: ${e.data.missing.join(', ')}.` : '';
      setError(`${e?.message || 'That did not go through. Nothing changed.'}${missing}`);
    });
  };
  const owner = role === 'owner';
  return (
    <Lightbox label="Proposal" title="A proposal waits" width={540} onClose={() => !busy && onClose()} testId="captable-proposal-dialog"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Close</button>
          {owner ? <button type="button" className={GHOST} onClick={() => act('dismiss')} disabled={busy} data-testid="captable-proposal-dismiss">Dismiss</button> : null}
          {owner ? <button type="button" className={PRIMARY} onClick={() => act('accept')} disabled={busy} data-testid="captable-proposal-accept">Record it</button> : null}
        </div>
      )}>
      <div className="flex flex-col gap-2.5 text-[13px]">
        <p className={`m-0 ${INK}`}>{item.lead} {item.text}</p>
        {item.reason ? <p className={`m-0 ${MUTED}`}>Reason given: {item.reason}</p> : null}
        <p className={`m-0 ${MUTED}`} data-testid="captable-proposal-says">
          {owner
            ? 'Record it puts this issuance on the record: it counts in who owns and in every figure tagged On record. You, your co-founders and anyone you have granted Investor or Full see it. Dismiss keeps it in the history and changes nothing.'
            : 'Only the owner records or dismisses a proposal. It changes nothing until then.'}
        </p>
        {owner ? <input className="rounded-[9px] border border-axal-hairline px-2.5 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-950" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why you dismiss it (optional)" aria-label="Reason to dismiss" /> : null}
        {error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="captable-proposal-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

// ─────────────────────────────────────────────────────────── Who owns

function WhoOwns({ record, search, view, setView, basis, setBasis }) {
  const owns = whoOwns(record, basis, search);
  const classes = byClass(record);
  const toggles = (
    <span className="flex flex-wrap gap-2">
      {view === 'holder' ? <Seg label="Count" options={[['out', 'Outstanding'], ['fd', 'Fully diluted']]} value={basis} onChange={setBasis} testId="captable-basis" /> : null}
      <Seg label="Group by" options={[['holder', 'By holder'], ['class', 'By class']]} value={view} onChange={setView} testId="captable-view" />
    </span>
  );
  if (view === 'class') {
    return (
      <Block title="By class" tag={<Tag kind="record" />} aside={toggles} testId="captable-by-class">
        {!classes.available ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-by-class-unavailable">{classes.sentence || 'The classes cannot be counted.'}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{['Class', 'Authorized', 'Issued', 'Outstanding', 'Price per share', 'Liquidation preference', 'Conversion ratio', 'Holders'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
              <tbody>
                {classes.rows.map((c) => (
                  <tr key={c.uid} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-class-row">
                    <td className={`${TD} font-bold`}>{c.name}</td>
                    <td className={`${TD} ${MONO}`}>{c.authorized}</td>
                    <td className={`${TD} ${MONO}`}>{c.issued}</td>
                    <td className={`${TD} ${c.kind === 'option_pool' ? MUTED : MONO}`}>{c.outstanding}</td>
                    <td className={`${TD} ${MONO}`}>{c.price}</td>
                    <td className={TD}>{c.preference}</td>
                    <td className={`${TD} ${MONO}`}>{c.ratio}</td>
                    <td className={`${TD} ${MONO}`}>{c.holders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {classes.foot ? <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`} data-testid="captable-by-class-foot">{classes.foot}</p> : null}
          </div>
        )}
      </Block>
    );
  }
  return (
    <Block title="Who owns the company" tag={<Tag kind="record" />} aside={toggles} testId="captable-who-owns">
      {!owns.available ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-who-owns-unavailable">{owns.sentence || 'Who owns cannot be counted from the record.'}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{['Holder', 'Class', basis === 'out' ? 'Shares' : 'Shares and options', '% fully diluted', '% outstanding', 'Source', 'Last change'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
            <tbody>
              {owns.groups.map((g) => (
                <React.Fragment key={g.id}>
                  <tr className="bg-axal-ground dark:bg-gray-800/60" data-testid="captable-group">
                    <td className={`${TD} ${EYEBROW} !text-axal-ink dark:!text-gray-100`}>{g.label}</td>
                    <td className={TD} />
                    <td className={`${TD} ${MONO} font-extrabold`}>{g.shares.toLocaleString('en-US')}</td>
                    <td className={`${TD} ${MONO} font-extrabold`}>{g.pctFd}</td>
                    <td className={`${TD} ${MONO} ${g.pctOut === '—' ? MUTED : 'font-extrabold'}`}>{g.pctOut}</td>
                    <td className={TD} /><td className={TD} />
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.key} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-holder-row">
                      <td className={`${TD} font-bold`}>{r.href ? <Link className={LINK} to={r.href}>{r.name}</Link> : r.name}</td>
                      <td className={TD}>{r.classes}</td>
                      <td className={`${TD} ${MONO}`}>{r.shares.toLocaleString('en-US')}</td>
                      <td className={`${TD} ${MONO}`}>{r.pctFd}</td>
                      <td className={`${TD} ${MONO} ${r.pctOut === '—' ? MUTED : ''}`} title={r.pctOut === '—' ? 'Not outstanding: options and the unallocated pool are left out.' : undefined}>{r.pctOut}</td>
                      <td className={TD}>{r.source}</td>
                      <td className={`${TD} ${MONO}`}>{r.changed}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {owns.grantedLine ? <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`}>{owns.grantedLine}</p> : null}
          {owns.fdSentence ? <p className="m-0 mt-2 text-[11.5px] text-amber-800 dark:text-amber-300" data-testid="captable-fd-sentence">{owns.fdSentence}</p> : null}
          <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`} data-testid="captable-who-owns-foot">{owns.foot}</p>
        </div>
      )}
    </Block>
  );
}

// ─────────────────────────────────────────────────────────── the side column

function Bars({ list }) {
  return (
    <Block title="Ownership by group" testId="captable-bars">
      <div className="flex flex-col gap-3">
        {list.map((b) => (
          <div key={b.label} className="flex flex-col gap-1" data-testid={b.modelled ? 'captable-bar-after' : 'captable-bar'}>
            <span className={`flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold ${INK}`}>{b.label} <Tag kind={b.modelled ? 'modelled' : 'record'} /></span>
            {b.parts ? (
              <div className="flex h-[18px] w-full overflow-hidden rounded-[4px]" role="img" aria-label={`${b.label}: ${b.parts.map((p) => `${p.label} ${p.pct.toFixed(2)}%`).join(', ')}`}>
                {b.parts.map((p) => <span key={p.id} className={`${BAR_FILL[p.id] || BAR_FILL.other} h-full`} style={{ width: `${p.pct}%` }} title={`${p.label} · ${p.pct.toFixed(2)}%`} />)}
              </div>
            ) : (
              <div className={`flex min-h-[18px] items-center rounded-[4px] border border-dashed border-gray-300 px-2 text-[10.5px] ${MUTED} dark:border-gray-600`} data-testid="captable-bar-note">{b.note}</div>
            )}
          </div>
        ))}
        {list[0].parts ? (
          <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
            {list[0].parts.map((p) => <li key={p.id} className={`flex items-center gap-1 text-[11px] ${MUTED}`}><span className={`inline-block h-2.5 w-2.5 rounded-sm ${BAR_FILL[p.id] || BAR_FILL.other}`} />{p.label} {p.pct.toFixed(2)}%</li>)}
          </ul>
        ) : null}
        <p className={`m-0 text-[11px] ${MUTED}`}>{FD_LEGEND}</p>
      </div>
    </Block>
  );
}

function Side({ record, compare, harbourRead, search, retry }) {
  const t = tiles(record.data);
  const list = bars(record.data, compare.status === 'ready' ? compare.data : null);
  const inst = instruments(record.data);
  const h = harbourRead.status === 'ready' ? harbour(harbourRead.data) : null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="captable-side">
      <span className="flex flex-wrap items-center gap-2"><Tag kind="record" /><span className={`font-mono text-[11px] ${MUTED}`}>{asOf(record.data)}</span></span>
      <div className="grid grid-cols-2 gap-2" data-testid="captable-tiles">
        {t.map((x) => (
          <div key={x.label} className={`${CARD} flex flex-col gap-0.5 px-3 py-2.5`} data-testid="captable-tile">
            <span className={EYEBROW}>{x.label}</span>
            <span className={`${MONO} text-[17px] font-extrabold ${INK}`}>{x.value}</span>
            <span className={`text-[11px] ${MUTED}`}>{x.sub}</span>
          </div>
        ))}
      </div>
      {compare.status === 'error' ? <div data-testid="captable-after-unreadable"><Unreadable what="Your model" claim="The bars from the record still draw." onRetry={retry} /></div> : null}
      <Bars list={list} />
      <Block title="Outstanding instruments" aside={<span className={`font-mono text-[11.5px] ${MUTED}`}>{inst.length}</span>} testId="captable-instruments">
        {inst.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No SAFE or note is on record.</p> : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {inst.map((i) => (
              <li key={i.uid} className="flex flex-col" data-testid="captable-instrument">
                <span className={`text-[12.5px] font-bold ${INK}`}>{i.holder} <span className={`ml-1 text-[10.5px] font-semibold ${MUTED}`}>{i.source}</span></span>
                <span className={`font-mono text-[11.5px] ${MUTED}`}>{i.line}</span>
              </li>
            ))}
          </ul>
        )}
        <Link className={`${LINK} mt-2 inline-block text-[12px]`} to={`${HOME_PATH}/instruments${tabSearch(search)}`}>Open Instruments</Link>
      </Block>
      <Block title="409A" testId="captable-409a-line">
        {harbourRead.status === 'loading' ? <p className={`m-0 text-[12px] ${MUTED}`}>Reading…</p>
          : !h ? <div data-testid="captable-409a-line-unreadable"><Unreadable what="409A" claim="This is not a claim that none is on file." onRetry={retry} /></div>
            : (
              <div className="flex flex-col gap-0.5 text-[12.5px]">
                <span className={`font-bold ${INK}`}>{h.reason}</span>
                <span className={`font-mono text-[11.5px] ${MUTED}`}>FMV {h.fmv} per common share · {h.provider}</span>
              </div>
            )}
      </Block>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── the page

/** The skeleton CT20 draws while the record reads: the table and the tiles, never a number. */
function Reading() {
  return (
    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="captable-overview-loading" aria-busy="true">
      <div className="h-64 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" />
      <div className="grid grid-cols-2 gap-2">
        {['Founders', 'Investors', 'Pool granted', 'Pool unallocated'].map((l) => (
          <div key={l} className={`${CARD} flex flex-col gap-0.5 px-3 py-2.5`}><span className={EYEBROW}>{l}</span><span className={`text-[11px] ${MUTED}`}>Reading…</span></div>
        ))}
      </div>
    </div>
  );
}

function FromModel({ projectId, scenario, onClose, onDone }) {
  const list = proposalsFromModel(scenario);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true); setError(null);
    let made = 0;
    try {
      for (const body of list) { await capTableRecordApi.propose(projectId, body); made += 1; }
      setBusy(false); onDone();
    } catch (e) {
      setBusy(false);
      setError(`${made} of ${list.length} became proposals; then: ${e?.message || 'the next one was refused'}. What was proposed stays in Needs you.`);
    }
  };
  const founders = list.filter((b) => b.kind === 'founding').length;
  return (
    <Lightbox label="Record them from the model" title="Record them from the model?" width={540} onClose={() => !busy && onClose()} testId="captable-from-model"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={run} disabled={busy || !list.length} data-testid="captable-from-model-run">{busy ? 'Proposing…' : 'Propose them'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 text-[13px]">
        <p className={`m-0 ${INK}`} data-testid="captable-from-model-says">
          {list.length
            ? `${founders} founder${founders === 1 ? '' : 's'}' shares and ${list.length - founders} SAFE${list.length - founders === 1 ? '' : 's'} or note${list.length - founders === 1 ? '' : 's'} from your saved model become proposals, with the figures the model holds.`
            : 'Your saved model holds no founder or SAFE to propose.'}
        </p>
        <p className={`m-0 ${MUTED}`}>Nothing counts until you record each one in Needs you, where you add its class, date and document. You and your co-founders see the proposals; nobody else does.</p>
        {error ? <p role="alert" className="m-0 font-semibold text-red-700 dark:text-red-300" data-testid="captable-from-model-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

export function CapTableOverview({ projectId, search = '', holderId = null, onRecord = null, onVoid = null }) {
  const { user } = useAuth() || {};
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const explorer = String(user?.role || '').toLowerCase() === 'exploring';
  const key = explorer ? null : projectId || null;
  const record = useRead(readRecord, key, reload);
  const compare = useRead(readCompare, key, reload);
  const harbourRead = useRead(read409a, key, reload);
  const cartaRead = useRead(readIntegrations, key, reload);
  const grants = useRead(readGrants, key, reload);
  const [view, setView] = useState('holder');
  const [basis, setBasis] = useState('fd');
  const [review, setReview] = useState(null);
  const [fromModel, setFromModel] = useState(false);

  if (explorer) {
    return (
      <Center mark="⊘" title={EXPLORER_TITLE} line={EXPLORER_LINE} testId="captable-explorer">
        <Link className={PRIMARY} to="/exploring">Set up your profile</Link>
        <Link className={GHOST} to="/">Go to your home</Link>
      </Center>
    );
  }
  if (!projectId) return <Reading />;
  // The owner records; a co-founder proposes; anyone else who reads (an advisor, an admin) reads only.
  const role = grants.status === 'ready' ? (grants.data?.can_change ? 'owner' : 'cofounder') : 'reader';
  const plan = hasTier(user, 'studio');
  const need = record.status === 'ready' ? needsYou(record.data) : null;
  const closeDrawer = () => navigate(`${HOME_PATH}${tabSearch(search)}`);

  let body;
  if (record.status === 'loading') body = <Reading />;
  else if (record.status === 'refused') {
    body = (
      <Center mark="⊘" title={OTHER_TITLE} line={OTHER_LINE} testId="captable-other-company">
        <Link className={GHOST} to={HOME_PATH}>Switch company</Link>
      </Center>
    );
  } else if (record.status === 'error') {
    body = (
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3`} role="alert" data-testid="captable-record-unreadable">
        <span className="text-[13px] font-semibold text-red-700 dark:text-red-300">{UNREADABLE_LINE}</span>
        <button type="button" className={GHOST} onClick={retry}>Try again</button>
      </div>
    );
  } else {
    const empty = record.data?.by_holder?.reason === 'nothing_recorded';
    const model = compare.status === 'ready' ? compare.data?.canonical || null : null;
    const offer = role === 'owner' && plan && !(need?.count);
    body = (
      <div className="flex flex-col gap-3.5">
        {role === 'cofounder' ? <p className={`m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] ${INK} dark:border-gray-700 dark:bg-gray-800`} data-testid="captable-cofounder">{COFOUNDER_LINE}</p> : null}
        <NeedsYou need={need} role={role} onReview={setReview} />
        {empty ? (
          model ? (
            <Center mark="◇" title={MODEL_TITLE} line={MODEL_LINE} testId="captable-empty-model">
              {offer ? <button type="button" className={PRIMARY} onClick={() => setFromModel(true)} data-testid="captable-from-model-open">Record them from the model</button> : null}
            </Center>
          ) : (
            <Center mark="+" title={EMPTY_TITLE} line={EMPTY_LINE} testId="captable-empty">
              {onRecord && role === 'owner' && plan ? <button type="button" className={PRIMARY} onClick={() => onRecord('founding')}>Record founding shares</button> : null}
            </Center>
          )
        ) : (
          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <WhoOwns record={record.data} search={tabSearch(search)} view={view} setView={setView} basis={basis} setBasis={setBasis} />
            <Side record={record} compare={compare} harbourRead={harbourRead} search={search} retry={retry} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-testid="captable-overview">
      <ToolBar record={record} harbourRead={harbourRead} cartaRead={cartaRead} need={need} role={role} plan={plan} onRecord={onRecord} />
      {body}
      {review ? <ProposalDialog projectId={projectId} item={review} role={role} onClose={() => setReview(null)} onDone={() => { setReview(null); retry(); }} /> : null}
      {fromModel ? <FromModel projectId={projectId} scenario={compare.data?.canonical} onClose={() => setFromModel(false)} onDone={() => { setFromModel(false); retry(); }} /> : null}
      {holderId != null ? (
        <HolderDrawer projectId={projectId} holderId={holderId} record={record} grants={grants} role={role} onClose={closeDrawer} onVoid={onVoid} />
      ) : null}
    </div>
  );
}
