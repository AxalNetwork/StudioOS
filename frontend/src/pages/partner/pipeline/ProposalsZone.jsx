import { formatMinor } from '../../../lib/money.js';
import { amountToCents } from '../../../lib/moneyInput.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { readAllPages } from '../../../lib/pagedRead';
import PartialRead from './PartialRead';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading,
  Section, Field, SaveNote, NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, moneyDollars, formatDay,
} from '../kit';
import { usePipelineZone } from './usePipelineZone';
import {
  TAB_LABEL, activityOf, lastActivity, nextAction, proposalStrip, sentPhrase, sheetTabs, stateOf,
} from './proposalsFollowUp';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import HeaderAsk from '../../../ui/HeaderAsk.jsx';
import { Pill } from '../../../ui';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Pipeline · Proposals — `/pipeline/proposals`.
 *
 * D4838 PP04 / PP04m (#5937): A FOLLOW-UP LIST. The canvas reads "Client · value ·
 * state · last activity · next action", and the version number is not a column: it
 * lives in the row's sheet, under Versions. On a phone each proposal is one card
 * with the same five facts and its next action as a 44px button.
 *
 * OPENS ARE NOT RECORDED, AND THE PAGE SAYS SO RATHER THAN GUESSING. `quotes` has no
 * open, no read receipt and no view count, and no founder-side surface records one —
 * an open is the client's act. The Worker sends `read_receipts: 'none'` with its
 * note; the strip's Opened tile reads Not recorded and the note is printed under it.
 * No "opened" and no "unopened" count is drawn anywhere. A sent proposal's state is
 * "no decision recorded", because a reply short of a decision is not recorded either.
 *
 * THE STRIP PRINTS ONLY WHAT THE READ SUPPORTS: open proposals and their value (the
 * Worker's whole-book counts), Opened (Not recorded), proposals with no decision for
 * seven days or more (the command centre's rule, over the rows read), and the win
 * rate from `commandCentre.winRateMetric`, so the root and this zone print one figure
 * with its denominator, or "No decided quotes".
 *
 * BULK NUDGE AND THE CSV EXPORT SIT UNDER More, as the canvas puts them. Neither was
 * removed: the export runs as it did, and the nudge stays disabled with its reason.
 *
 * THE ROW OPENS A SHEET. No shared opportunity sheet (PP08) exists yet, so this zone
 * draws its own, with the issue's tabs as the row's data allows: Overview, Proposal,
 * Activity, Versions and Outcome. Withdraw and the loss reason live under Outcome; the
 * version trail under Versions. When the shared sheet lands, the row hands it the same
 * row and tab.
 *
 * WHAT THE FIRM DOES OWN IS BUILT. Migration 234 gives a proposal a VERSION TRAIL —
 * append-only, self-numbering — and a LOSS REASON from a closed taxonomy. A loss with
 * no reason is counted separately, never folded into `Other`.
 */

const LOSS_LABEL = {
  price: 'Price',
  scope_mismatch: 'Scope mismatch',
  timing: 'Timing',
  other: 'Other',
};
const EMPTY_DRAFT = Object.freeze({ change_summary: '', note: '', price: '' });
const STATE_TONE = { Won: 'ok', Lost: 'danger', Sent: 'neutral', Withdrawn: 'neutral' };

/**
 * D395 — WITHDRAW MOVED HERE from the retired `/partner/operations/engagements`,
 * whose "My proposals" view was the only canvas-less place a firm could pull a
 * proposal back. `quoteTransition` in `routes/needs.ts` allows it from
 * `submitted` only and answers anything else with a 409; this mirrors that set,
 * and the Worker stays the boundary.
 */
export const canWithdraw = (r) => r?.status === 'submitted';

/** The strip tile, in the anatomy the artboards share. */
function ProposalTile({ label, value, note, nr = false, testid }) {
  return (
    <div data-testid={testid} className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/** The State cell: the read's state word as a pill, and what the record adds to it. */
function StateMark({ r }) {
  const s = stateOf(r);
  if (!s.word) return <NotRecorded />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={STATE_TONE[s.word] || 'neutral'} className="!text-[10px]">{s.word}</Pill>
      {s.reason ? <span className="text-[12px] text-axal-muted">{LOSS_LABEL[s.reason] || s.reason}</span> : null}
      {s.detail && s.word === 'Lost' ? <Pill tone="warn" className="!text-[10px]">No reason recorded</Pill> : null}
      {s.detail && s.word !== 'Lost' ? <span className="text-[12px] text-axal-muted">{s.detail}</span> : null}
    </span>
  );
}

/** The Last activity text, or Not recorded when the row carries no stamp and no age. */
function activityText(r) {
  const a = lastActivity(r);
  if (!a) return null;
  return a.at ? `${a.text} · ${formatDay(a.at)}` : a.text;
}

/** The Next action control: a button into the sheet, a link out, or words. */
function NextActionControl({ r, onOpen, block = false }) {
  const next = nextAction(r);
  if (!next) return <NotRecorded />;
  const cls = `${ghostButtonClass} ${block ? 'min-h-[44px] w-full justify-center' : ''} ${next.urgent ? '!border-amber-300 !text-amber-800 dark:!text-amber-300' : ''}`;
  if (next.to) return <Link to={next.to} className={`${cls} inline-flex items-center`}>{next.label}</Link>;
  if (!next.label) return <span className="text-[12px] text-axal-muted">{next.text}</span>;
  return (
    <button type="button" className={cls} onClick={() => onOpen(r.quote_id, next.tab)}>
      {next.label}
    </button>
  );
}

/**
 * More ▾ — the overflow the canvas puts Bulk nudge and the CSV export under. It draws
 * the zone's own action row (`rowActions`, built once below) unchanged: an
 * export runs its own `onClick`, and an unbuilt entry stays disabled with its reason
 * printed under it, since a menu has the room a hover title does not.
 */
function MoreMenu({ actions = [] }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus?.(); } };
    const onDown = (e) => { if (box.current && !box.current.contains?.(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  const items = actions.filter(Boolean);
  if (!items.length) return null;
  return (
    <div ref={box} className="relative" data-testid="proposals-more">
      <button
        ref={button} type="button" aria-haspopup="menu" aria-expanded={open}
        className={`${ghostButtonClass} min-h-[36px]`} onClick={() => setOpen((o) => !o)}
      >
        More ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[240px] overflow-hidden rounded-xl border border-axal-hairline bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {items.map((item) => (
            <button
              key={item.label} type="button" role="menuitem"
              disabled={item.disabled || item.busy || typeof item.onClick !== 'function'}
              title={item.title}
              className="block min-h-[44px] w-full px-3 py-2 text-left text-[13px] font-semibold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-100 dark:hover:bg-gray-800"
              onClick={() => { setOpen(false); item.onClick?.(); }}
            >
              {item.label}
              {item.disabled && item.title ? <span className="mt-0.5 block text-[11px] font-normal leading-snug text-axal-muted">{item.title}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The proposal sheet. Tabs come from `sheetTabs(row)`; every line says what the
 * record holds, and Not recorded where it holds nothing. Writes stay the zone's:
 * Withdraw and the loss reason go through the zone's `run`, so a failed write keeps
 * its own sentence and a refresh keeps the sheet open on the same row.
 */
function ProposalSheet({ row, tab, onTab, onClose, onRecordVersion, busy, run, note }) {
  const closeRef = useRef(null);
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  useEffect(() => {
    closeRef.current?.focus?.();
    if (typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const back = opener.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      if (back && typeof back.focus === 'function') back.focus();
    };
  }, [onClose]);
  if (!row) return null;
  const tabs = sheetTabs(row);
  const current = tabs.includes(tab) ? tab : tabs[0];
  const headingId = `proposal-sheet-${row.quote_id}`;
  const next = nextAction(row);
  const name = row.client || row.need_title || 'Client not recorded';
  const line = (label, value) => (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-axal-hairline py-2.5 text-[13px] dark:border-gray-800">
      <span className="font-semibold text-axal-muted">{label}</span>
      <span className="min-w-0 text-axal-ink dark:text-gray-100">{value ?? <NotRecorded />}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50" data-testid="proposal-sheet">
      <button type="button" aria-label="Close proposal" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default bg-black/30" onClick={onClose} />
      <aside
        role="dialog" aria-modal="true" aria-labelledby={headingId}
        className="absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col overflow-y-auto border-l border-axal-hairline bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950"
      >
        <div className="border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <Eyebrow>Proposal</Eyebrow>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close proposal"
              className="grid h-11 w-11 place-items-center rounded-lg text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800">✕</button>
          </div>
          <h2 id={headingId} className="mt-1 text-[20px] font-extrabold text-axal-ink dark:text-gray-100">{name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-axal-muted">
            <span className="font-mono font-bold text-axal-ink dark:text-gray-100">
              {row.price_dollars == null ? 'Value not recorded' : moneyDollars(row.price_dollars)}
            </span>
            <span>· {row.shape || 'Shape not recorded'}</span>
            <StateMark r={row} />
          </div>
          <nav className="mt-3 flex flex-wrap gap-1" aria-label="Proposal" role="tablist">
            {tabs.map((t) => (
              <button
                key={t} type="button" role="tab" aria-selected={t === current}
                className={`min-h-[36px] rounded-[7px] border px-2.5 text-[12px] font-semibold ${t === current
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}
                onClick={() => onTab(t)}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4" role="tabpanel" data-testid={`proposal-sheet-${current}`}>
          {current === 'overview' && (
            <>
              {line('Client', row.client || null)}
              {line('Need', row.need_title || null)}
              {line('State', <StateMark r={row} />)}
              {line('Last activity', activityText(row))}
              {line('Opened', <span><NotRecorded /> <span className="text-[12px] text-axal-muted">nothing records a client open</span></span>)}
              <section className={`rounded-xl border px-4 py-3 ${next?.urgent ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30' : 'border-axal-hairline dark:border-gray-800'}`}>
                <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Next action</h3>
                <p className="mt-0.5 text-[13px] text-axal-ink dark:text-gray-100">
                  {next?.key === 'follow-up'
                    ? 'Follow up with the client directly: nothing here sends mail. If the proposal changes, record the new version.'
                    : next?.label || next?.text || 'Nothing recorded to do.'}
                </p>
              </section>
            </>
          )}

          {current === 'proposal' && (
            <>
              {line('Value', row.price_dollars == null ? null : moneyDollars(row.price_dollars))}
              {line('Shape', row.shape || null)}
              {line('Timeline', row.timeline_weeks == null ? null : `${row.timeline_weeks} weeks`)}
              {line('Current version', `v${row.version}`)}
              <p className="text-[12px] text-axal-muted">The quote’s own price is the live figure; the version trail is the record behind it.</p>
            </>
          )}

          {current === 'activity' && (
            <>
              <ul className="space-y-2" data-testid="proposal-activity">
                {activityOf(row).map((a) => (
                  <li key={a.key} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-[13px]">
                    <span className="text-axal-muted">{a.at ? formatDay(a.at) : (a.days == null ? '' : sentPhrase(a.days)?.replace(/^Sent /, ''))}</span>
                    <span className="text-axal-ink dark:text-gray-100">{a.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-axal-muted">
                What this proposal’s own record holds: the send, each version and the decision. Opens are not recorded, and a
                lifecycle feed across Lead, Proposal and Negotiation does not exist yet.
              </p>
            </>
          )}

          {current === 'versions' && (
            <>
              {row.versions.length > 0 ? (
                <Instrument
                  testid="version-history"
                  title={`Version history · ${row.client || row.need_title || 'proposal'}`}
                  meta="What changed, and what it cost"
                  cols="1.15fr 1fr 1.4fr"
                  head={['Ver', 'What changed', 'Why']}
                  rows={row.versions.map((v) => ({
                    key: v.id,
                    cells: [
                      { text: `v${v.version}`, sub: formatDay(v.created_at) },
                      {
                        text: v.change_summary,
                        sub: v.price_cents == null ? undefined : formatMinor(v.price_cents, 'USD', { trimWhole: true }),
                      },
                      v.note ? { text: v.note } : { nr: true },
                    ],
                  }))}
                  note={'A version is appended, never edited: the trail is the record of what this firm conceded and when, and one that could be rewritten would not be worth keeping. The number is assigned here rather than chosen, so two people revising the same proposal cannot both claim v3. `quotes.price` stays the live figure — this is the trail behind it.'}
                />
              ) : (
                <p className="text-[13px] text-axal-muted">No revision recorded. v1 is the proposal as it was sent.</p>
              )}
              <button type="button" className={`${ghostButtonClass} min-h-[44px] self-start`} onClick={() => onRecordVersion(row.quote_id)}>
                Record a version
              </button>
            </>
          )}

          {current === 'outcome' && (
            <>
              {line('State', <StateMark r={row} />)}
              {line('Decided', row.decided ? formatDay(row.decided_at) : (row.state === 'Withdrawn' ? 'Withdrawn, not decided' : 'Not decided yet'))}
              {row.state === 'Lost' && (
                <Field label="Why it was lost" hint="From the taxonomy. A loss nobody gave a reason for stays Not recorded.">
                  <select
                    className={`${inputClass} max-w-[260px]`}
                    value={row.loss_reason || ''}
                    disabled={busy}
                    onChange={(e) => run(
                      () => api.setPartnerProposalOutcome(row.quote_id, { loss_reason: e.target.value || null }),
                      'Reason recorded.', `loss:${row.quote_id}`,
                    )}
                  >
                    <option value="">Not recorded</option>
                    {Object.entries(LOSS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
              )}
              {row.state === 'Won' && row.engagement_id ? (
                <Link to="/delivery/board" className="text-[13px] font-semibold text-amber-700 underline">The engagement is on Delivery</Link>
              ) : null}
              {canWithdraw(row) && (
                <div>
                  <button
                    type="button" className={`${ghostButtonClass} min-h-[44px]`} disabled={busy}
                    onClick={() => run(() => api.withdrawQuote(row.quote_id), 'Proposal withdrawn.', 'withdraw')}
                  >
                    Withdraw
                  </button>
                  <p className="mt-1 text-[12px] text-axal-muted">Only a proposal still waiting for a decision can be withdrawn. Withdrawing is not a loss.</p>
                </div>
              )}
              <SaveNote note={note?.scope === 'withdraw' || String(note?.scope || '').startsWith('loss:') ? note : null} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function PartnerProposalsZone() {
  const { state, load, run, busy, note } = usePipelineZone(
    () => readAllPages((cur) => api.listPartnerProposals(cur)), 'The proposals did not load.',
  );
  const [view, setView] = useState('all');
  // TWO SELECTIONS, NOT ONE (#4685). `sheet` is the proposal whose sheet is on
  // screen; `editId` is the proposal the version form will write to. Opening another
  // row's sheet never retargets a half-typed version. Drafts are keyed by quote id
  // for the same reason: switching proposals and back finds each one as it was left.
  const [sheet, setSheet] = useState(null);
  const [editId, setEditId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const formRef = useRef(null);
  const draft = (editId != null && drafts[editId]) || EMPTY_DRAFT;
  const setDraftField = (field, value) => {
    if (editId == null) return;
    setDrafts((all) => ({ ...all, [editId]: { ...(all[editId] || EMPTY_DRAFT), [field]: value } }));
  };
  const openSheet = useCallback((id, tab = 'overview') => setSheet({ id, tab }), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const lossRows = Array.isArray(d?.loss_reasons) ? d.loss_reasons : [];
  const lossMax = Math.max(1, ...lossRows.map((r) => r.count));
  const strip = proposalStrip(d);

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // ══ THE CHIP ROW ════════════════════════════════════════════════════════
  // Three of the five select. `Opened, unanswered` and `Never opened` are prose
  // for the reason the whole zone turns on: nothing records an open, so the two
  // states are one state here and a chip that split them would be inventing the
  // distinction it claims to filter on.
  const visible = (() => {
    if (view === 'won') return items.filter((r) => r.state === 'Won');
    if (view === 'lost') return items.filter((r) => r.state === 'Lost');
    return items;
  })();

  const sheetRow = sheet ? items.find((r) => r.quote_id === sheet?.id) : null;
  const price = amountToCents(draft.price);
  const priceBad = Boolean(price.error);

  const rowActions = partnerZoneActions('pipeline/proposals', { view: { header: ['Client', 'Shape', 'Value', 'Version', 'State', 'Loss reason', 'Days since sent'], rows: visible, cells: (r) => [r.client, r.shape, r.price_dollars, r.version, r.state, r.loss_reason, r.days_since_sent] } });

  // NOT AN EARLY RETURN ANY MORE. `ZoneBody` takes the no-firm line as a `notice`
  // above its states, and the zone renders underneath in its own empty state. The
  // gate itself is untouched: the read still 400s, so `isEmpty` is forced rather
  // than inferred from rows that never arrived, and `error` is cleared so the
  // shared "This did not load" card cannot fire.
  const unlinked = isNoPartnerProfile(state.error);

  return (
    <>
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store.
          A filter chip is a claim about ROWS; an action states what the zone
          DOES. The actions sit under More (PP04), with Ask beside it as the
          shared action row draws it. */}
      <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <ZoneToolbar
            role="partner"
            filters={unlinked ? [] : partnerZoneFilters('pipeline/proposals', { value: view, onChange: setView })}
            actions={[]}
          />
        </div>
        <div className="mt-3.5 flex items-center gap-2">
          <HeaderAsk testId="zone-actions-ask" />
          <MoreMenu actions={rowActions} />
        </div>
      </div>
      <ZoneBody
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={load}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || (items.length === 0)}
        empty={(
          <NothingYet
            title="No proposal sent yet"
            body={
              'A proposal is a bid on an open need. Accept a lead and quote it, '
              + 'and it appears here with its version history and — once it is '
              + 'decided — the reason it went the way it did.'
            }
            action={<Link to="/pipeline/leads" className="text-[12.5px] font-semibold text-amber-700 underline">Open the leads</Link>}
          />
        )}
      >
        <div className="space-y-6">
          <PartialRead data={state.data} noun="proposals" onRetry={load} />
          <ZoneHeading
            title="Proposals"
            blurb="Every proposal, what happened after it was sent, and what needs follow-up."
          />

          {/* ══ THE PP04 STRIP ════════════════════════════════════════════════
              `Open proposals · Opened · No decision 7+ days · Win rate`. Opened
              needs a read receipt nothing records, so it is Not recorded. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="proposals-strip">
            <ProposalTile
              label={strip.open.label}
              value={strip.open.value}
              // D4838: money only over proposals that exist; none live is not "$0 in play".
              note={d?.live_count ? `${moneyDollars(d.live_value_dollars ?? 0)} in play` : 'nothing in play'}
            />
            <ProposalTile label={strip.opened.label} nr note={strip.opened.note} />
            <ProposalTile label={strip.quiet.label} value={strip.quiet.value} note={strip.quiet.note} />
            {/* "No decided quotes" WITH NOTHING DECIDED. A rate over an empty
                denominator is not zero per cent; the rule is the command
                centre's, so the root and this zone print one figure. */}
            <ProposalTile testid="proposals-win-rate" label={strip.win.label} value={strip.win.value} note={strip.win.note} />
          </div>

          {d?.read_receipts_note && (
            <div className="flex gap-2 rounded-lg border border-axal-hairline bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-axal-muted dark:border-gray-800 dark:bg-gray-900" data-testid="read-receipts-note">
              <span aria-hidden="true" className="font-bold">i</span>
              <p><strong className="text-axal-ink dark:text-gray-100">Opens aren’t recorded.</strong> {d.read_receipts_note}</p>
            </div>
          )}

          {/* ══ THE PP04 LIST — desktop ═══════════════════════════════════════ */}
          <div className="hidden overflow-x-auto rounded-[10px] border border-axal-hairline bg-white md:block dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full text-left text-[13px]" data-testid="all-proposals">
              <caption className="sr-only">All proposals</caption>
              <thead>
                <tr className="border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {['Client', 'Value', 'State', 'Last activity', 'Next action'].map((c) => (
                    <th key={c} scope="col" className={`px-4 py-2.5 ${c === 'Value' ? 'text-right' : ''}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.quote_id} className={`border-b border-axal-hairline last:border-0 dark:border-gray-800 ${r.state === 'Lost' && !r.loss_reason ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}`}>
                    <td className="px-4 py-2.5">
                      <button type="button" className="text-left font-bold text-axal-ink hover:underline dark:text-gray-100" onClick={() => openSheet(r.quote_id)}>
                        {r.client || r.need_title || 'Client not recorded'}
                      </button>
                      {r.client && r.need_title ? <span className="block text-[11px] text-axal-muted">{r.need_title}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.price_dollars == null ? <NotRecorded /> : moneyDollars(r.price_dollars)}</td>
                    <td className="px-4 py-2.5"><StateMark r={r} /></td>
                    <td className="px-4 py-2.5 text-axal-muted">{activityText(r) ?? <NotRecorded />}</td>
                    <td className="px-4 py-2.5"><NextActionControl r={r} onOpen={openSheet} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ══ PP04m — one card per proposal on a phone ══════════════════════ */}
          <div className="grid gap-3 md:hidden" data-testid="proposal-cards">
            {visible.map((r) => (
              <div key={r.quote_id} className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-baseline justify-between gap-3">
                  <button type="button" className="min-h-[44px] text-left text-[14px] font-bold text-axal-ink dark:text-gray-100" onClick={() => openSheet(r.quote_id)}>
                    {r.client || r.need_title || 'Client not recorded'}
                  </button>
                  <span className="font-mono text-[14px] font-bold">{r.price_dollars == null ? <NotRecorded /> : moneyDollars(r.price_dollars)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-axal-muted">
                  <StateMark r={r} />
                  <span>· {activityText(r) ?? 'last activity not recorded'}</span>
                </div>
                <div className="mt-2"><NextActionControl r={r} onOpen={openSheet} block /></div>
              </div>
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-axal-muted">
            Last activity is the newest thing this proposal’s record holds — its decision, its latest version, or the send.
            It is deliberately not a read receipt: an open is the client’s act and nothing in this product records it, so a
            quiet proposal and an unread one are one state here. A lost proposal with no reason recorded is tinted and marked,
            because it is the one row that still needs a person.
          </p>

          {items.length > 0 && visible.length === 0 && (
            <p className="text-[12px] text-axal-muted">
              No proposal is in this state. {items.length} in total.
            </p>
          )}

          {sheetRow && (
            <ProposalSheet
              row={sheetRow}
              tab={sheet?.tab}
              onTab={(t) => setSheet((s) => (s ? { ...s, tab: t } : s))}
              onClose={closeSheet}
              onRecordVersion={(id) => {
                setEditId(id);
                setSheet(null);
                formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
              }}
              busy={busy}
              run={run}
              note={note}
            />
          )}

          {/* ══ LOSS REASONS — a taxonomy, not prose ══════════════════════════ */}
          <Instrument
            testid="loss-reasons"
            title="Loss reasons"
            meta="Taxonomy, not prose"
            cols="1.15fr 1fr"
            head={['Reason', 'Count']}
            rows={[
              ...lossRows.map((r) => ({
                key: r.reason,
                cells: [
                  { text: LOSS_LABEL[r.reason] || r.reason },
                  {
                    text: String(r.count),
                    barPct: Math.round((r.count / lossMax) * 100),
                    barColor: r.reason === 'price' ? '#b91c1c' : '#d97706',
                  },
                ],
              })),
              // COUNTED, NOT FOLDED INTO `Other`. "We did not ask" is not a
              // taxonomy entry, and hiding it inside one would make the chart
              // look complete while the firm learned nothing.
              ...(d?.losses_unstated
                ? [{
                  key: '__unstated',
                  cells: [
                    { text: 'No reason recorded', sub: 'not a taxonomy entry — nobody entered one' },
                    { text: String(d.losses_unstated) },
                  ],
                }]
                : []),
            ]}
            note={'Reasons are picked from a fixed taxonomy rather than typed, and the artboard gives the reason: free text would make this chart unreadable within a quarter. The set is the one Leads uses for a pass, minus the two that cannot apply to a bid you actually made — you do not lose a deal for being under your own floor, or for a capability you just quoted on. Losses with no reason recorded are a row of their own rather than a share of Other: a chart that folded them in would look complete while the firm learned nothing from it.'}
          />

          <ZoneDraft
            surface="pipeline/proposals"
            railOption="draft:win-loss-read"
            label="Draft · win/loss read"
            accept="Accept read"
            run="Read the book"
            foot="Reasons traced to the taxonomy."
            empty="What the decided proposals have in common — which reasons recur, which shapes close, and where a loss reason is missing so the pattern cannot be read at all."
            nothingToDraft="No proposal has been decided yet, so there is no pattern to read."
          />

          <div ref={formRef}>
          <Section title="Record a version, or why one was lost">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Proposal">
                <select className={inputClass} value={editId ?? ''}
                  onChange={(e) => setEditId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Choose one</option>
                  {items.map((r) => (
                    <option key={r.quote_id} value={r.quote_id}>
                      {r.client || r.need_title} · v{r.version}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="What changed" hint="In your words — “Split into 3 phases, same total”.">
                <input className={inputClass} value={draft.change_summary} maxLength={400}
                  disabled={editId == null}
                  onChange={(e) => setDraftField('change_summary', e.target.value)} />
              </Field>
              <Field label="Why" hint="Usually about the client: what they asked for.">
                <input className={inputClass} value={draft.note} maxLength={600}
                  disabled={editId == null}
                  onChange={(e) => setDraftField('note', e.target.value)} />
              </Field>
              <Field label="New price" hint={priceBad ? 'Type a figure in dollars, such as 41000.' : 'Leave empty where the shape changed and the money did not.'}>
                <input className={inputClass} value={draft.price} inputMode="decimal" placeholder="e.g. 41000"
                  disabled={editId == null}
                  onChange={(e) => setDraftField('price', e.target.value)} />
              </Field>
            </div>
            <button
              type="button" className={`${buttonClass} mt-3`}
              disabled={busy || editId == null || !draft.change_summary.trim() || priceBad}
              onClick={async () => {
                // The target and the text are read NOW. Nothing below reads
                // `editId` or `draft` again, so choosing another proposal while
                // this is in flight cannot retarget it or clear that one's draft.
                const id = editId;
                const sent = draft;
                if (priceBad) return;
                const saved = await run(
                  () => api.addPartnerProposalVersion(id, {
                    change_summary: sent.change_summary,
                    note: sent.note,
                    // DOLLARS IN THE BOX, CENTS ON THE WIRE. Every new money
                    // column in this bucket is integer cents; the field asks
                    // for the figure a person says out loud.
                    price_cents: price.cents,
                  }),
                  'Version recorded.', `version:${id}`,
                );
                // Cleared only after the server took it, and only that proposal's.
                if (saved) setDrafts((all) => { const n = { ...all }; delete n[id]; return n; });
              }}
            >
              Add the version
            </button>
            <SaveNote note={editId != null && note?.scope === `version:${editId}` ? note : null} />

            {items.some((r) => r.state === 'Lost') && (
              <div className="mt-5 border-t border-axal-hairline pt-4 dark:border-gray-700">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
                  Why a proposal was lost
                </div>
                <div className="mt-2 space-y-2">
                  {items.filter((r) => r.state === 'Lost').map((r) => (
                    <div key={r.quote_id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span className="font-semibold">{r.client || r.need_title}</span>
                      <select
                        className={`${inputClass} max-w-[220px]`}
                        value={r.loss_reason || ''}
                        disabled={busy}
                        onChange={(e) => run(
                          () => api.setPartnerProposalOutcome(r.quote_id, {
                            loss_reason: e.target.value || null,
                          }),
                          'Reason recorded.', `loss:${r.quote_id}`,
                        )}
                      >
                        <option value="">Not recorded</option>
                        {Object.entries(LOSS_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <SaveNote note={String(note?.scope || '').startsWith('loss:') ? note : null} />
              </div>
            )}
          </Section>
          </div>

          <StatedLimit title="What this page cannot see">
            <p>
              <strong>Nothing records that a client opened a proposal.</strong>{' '}
              There is no client-side surface to record it on, so a proposal that
              has gone quiet cannot be told from one that was never read — which
              is exactly the distinction the design asks for, and exactly the one
              this build has to refuse. Calling a silent proposal “never opened”
              would turn our own silence into a claim about their attention.
            </p>
            <p className="mt-2">
              <strong>A version trail is appended, never edited.</strong> It is
              the record of what this firm conceded and when, so nothing here
              rewrites an earlier version and the number is assigned rather than
              chosen. The quote’s own price stays the live figure.
            </p>
            <p className="mt-2">
              <strong>A loss reason comes from the taxonomy or it is absent.</strong>{' '}
              Free text would make the chart unreadable within a quarter, and a
              loss nobody gave a reason for is counted on its own rather than
              folded into <em>Other</em> — a chart that hid them would look
              complete while telling the firm nothing.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
