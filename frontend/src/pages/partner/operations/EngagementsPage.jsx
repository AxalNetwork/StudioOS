import React, { useEffect, useMemo, useState } from 'react';
import { Handshake, FileText, Receipt, Send } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, SlideOver, EmptyState, Badge, RowCard, SearchInput, FilterChips,
  formatDay, formatRelativeDay, moneyUsd,
} from './kit';
import ZoneActions from '../../../workspaces/ZoneActions';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';

// Engagements — the live BD pipeline (Wave 1a; previously fixture projects).
//
// Three views over the real needs → quotes → engagements state machine:
//   Open requests — founder needs a partner can propose on (with the RFP),
//                   including the proposal builder (BD Console canvas zone).
//   My proposals  — submitted quotes with status and withdraw.
//   Engagements   — accepted work with its lifecycle actions and the
//                   invoice ledger (invoiced + awaiting-invoice rows).
const VIEWS = [
  { id: 'requests', label: 'Open requests' },
  { id: 'proposals', label: 'My proposals' },
  { id: 'engagements', label: 'Engagements' },
];

// `view`: which of the three views this mount opens on. `/partner/operations/
// engagements` opens on Open requests as it always has; the Partner shell
// mounts this same page twice with a different opening view, because
// `/pipeline/proposals` and `/delivery/board` are two zones over one store —
// the proposal desk and the engagement board are the second and third views
// here. Before this, neither zone reached this page at all: both resolved to
// the operations workspace's fallback tab and rendered its Overview, under a
// header that read "Delivery · Ship the work" on a Pipeline route.
//
// It is the OPENING view, not a lock: the chips stay, so a partner who lands
// on the proposal desk can still cross to the board without going back to the
// sidebar. A view this page does not have falls back to the original default.
const DEFAULT_VIEW = 'requests';

export default function EngagementsPage({ view: initialView = DEFAULT_VIEW }) {
  const [view, setView] = useState(
    VIEWS.some((v) => v.id === initialView) ? initialView : DEFAULT_VIEW,
  );
  const [needs, setNeeds] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [q, setQ] = useState('');
  const [openNeed, setOpenNeed] = useState(null);
  const [openEng, setOpenEng] = useState(null);
  const [proposal, setProposal] = useState({ price: '', timeline_weeks: '', deliverables: '', notes: '' });
  const [sending, setSending] = useState(false);
  const [actionNote, setActionNote] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    const [n, mq, eng] = await Promise.allSettled([
      api.listNeeds(), api.myQuotes(), api.listEngagements(),
    ]);
    if (n.status === 'fulfilled') setNeeds(n.value.items || []); else setError('Could not load open requests.');
    if (mq.status === 'fulfilled') setQuotes(mq.value.items || []);
    if (eng.status === 'fulfilled') setEngagements(eng.value.items || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const quotedNeedIds = useMemo(() => new Set(quotes.map((x) => x.need_id)), [quotes]);
  const filteredNeeds = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needs.filter((n) => !needle
      || (n.title || '').toLowerCase().includes(needle)
      || (n.description || '').toLowerCase().includes(needle)
      || (n.category || '').toLowerCase().includes(needle));
  }, [needs, q]);

  const active = engagements.filter((e) => ['accepted', 'in_progress'].includes(e.status));
  const wrapped = engagements.filter((e) => ['delivered', 'reviewed'].includes(e.status));
  const invoiced = engagements.filter((e) => e.status === 'invoiced');

  // Canvas-aligned stats: computed from the pipeline record, not asserted.
  //
  // A WIN RATE IS OVER DECIDED PROPOSALS, NOT SUBMITTED ONES. `quotes.status`
  // is submitted|accepted|rejected|withdrawn. Dividing by every quote counts
  // the ones still waiting for an answer as losses, so a partner with two
  // accepted and eight pending reads 20% — and the note under it claimed "2 of
  // 10 decided", which eight of them are not. `withdrawn` is excluded too: the
  // partner pulled the proposal, so it was never lost to anyone.
  const openNeeds = needs.length;
  const myQuotes = quotes.length;
  const acceptedQuotes = quotes.filter((x) => x.status === 'accepted').length;
  const rejectedQuotes = quotes.filter((x) => x.status === 'rejected').length;
  const decidedQuotes = acceptedQuotes + rejectedQuotes;
  const winRate = decidedQuotes > 0 ? Math.round((acceptedQuotes / decidedQuotes) * 100) : null;
  // `engagements.price` is the column and is NOT NULL — the DTO emits `price`,
  // which this file already reads for every individual row. An earlier revision
  // summed `agreed_price`, a field that exists nowhere in the product, so the
  // total was always 0 and rendered "$0" beside a live engagement count.
  const activeValue = active.reduce((a, e) => a + (Number(e.price) || 0), 0);

  const startProposal = (n) => {
    setOpenNeed(n);
    setProposal({
      price: '',
      timeline_weeks: '',
      // BD Console canvas: scope is pulled from the RFP rather than retyped.
      deliverables: n?.rfp?.deliverables_md || '',
      notes: '',
    });
  };

  const submitProposal = async () => {
    setSending(true); setError('');
    try {
      const price = Number(proposal.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error('Enter the proposal price in USD.');
      if (!proposal.deliverables.trim()) throw new Error('Describe the deliverables.');
      await api.submitQuote(openNeed.id, {
        price,
        timeline_weeks: proposal.timeline_weeks === '' ? null : Number(proposal.timeline_weeks),
        deliverables: proposal.deliverables.trim(),
        notes: proposal.notes.trim() || null,
      });
      setNotice(`Proposal sent for "${openNeed.title}".`);
      setOpenNeed(null);
      await load();
      setView('proposals');
    } catch (e) {
      setError(e?.message || 'Could not submit the proposal.');
    }
    setSending(false);
  };

  const withdraw = async (quote) => {
    setError('');
    try { await api.withdrawQuote(quote.id); await load(); }
    catch (e) { setError(e?.message || 'Could not withdraw the proposal.'); }
  };

  const engAction = async (e, action) => {
    setError('');
    try {
      if (action === 'start') await api.startEngagement(e.id);
      else if (action === 'deliver') await api.deliverEngagement(e.id, { delivery_notes: actionNote.trim() || undefined });
      else if (action === 'cancel') await api.cancelEngagement(e.id, { reason: actionNote.trim() || undefined });
      else if (action === 'invoice') await api.invoiceEngagement(e.id);
      setActionNote('');
      setOpenEng(null);
      await load();
    } catch (err) {
      setError(err?.message || `Could not ${action} the engagement.`);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading your pipeline…</div>;
  }

  return (
    <div className="space-y-5">
      {/* This page is two zones: `/delivery/board` renders it with
          view="engagements" and `/pipeline/proposals` with view="proposals".
          Only the first has canvas actions — `Pages · Partner Pipeline`
          specifies none — and the reader can switch views without changing
          route, so the row follows what is on screen rather than the URL. */}
      {view === 'engagements' && (
        <ZoneActions items={partnerZoneActions('delivery/board', { view: {
          header: ['Engagement', 'Founder', 'Project', 'Category', 'Status', 'Price'],
          rows: engagements,
          cells: (e) => [e.need_title, e.founder_name, e.project_name, e.need_category, e.status, e.price],
        } })} />
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-600 text-xs font-medium">Dismiss</button>
        </div>
      )}

      <FilterChips options={VIEWS} value={view} onChange={setView} />

      {/* Canvas stats strip — computed from the pipeline record. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Open requests', value: String(openNeeds), note: 'founder needs accepting proposals' },
          { label: 'My proposals', value: String(myQuotes), note: `${acceptedQuotes} accepted` },
          {
            label: 'Win rate',
            value: winRate != null ? `${winRate}%` : '—',
            note: decidedQuotes
              ? `${acceptedQuotes} of ${decidedQuotes} decided`
              : myQuotes ? `${myQuotes} still awaiting a decision` : 'no proposals yet',
          },
          { label: 'Active value', value: moneyUsd(activeValue), note: `${active.length} engagement${active.length === 1 ? '' : 's'} in flight` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-gray-500 dark:text-gray-400">{s.label}</div>
            <div className="mt-1 text-lg font-extrabold tabular-nums text-gray-900 dark:text-gray-100">{s.value}</div>
            <div className="mt-0.5 text-[10.5px] text-gray-500 dark:text-gray-400">{s.note}</div>
          </div>
        ))}
      </div>

      {view === 'requests' && (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Search open founder requests" />
          {filteredNeeds.length === 0 ? (
            <EmptyState>
              {needs.length === 0
                ? 'No open founder requests right now. New requests appear here as founders post them.'
                : 'No requests match your search.'}
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {filteredNeeds.map((n) => (
                <RowCard key={n.id} onClick={() => startProposal(n)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{n.title}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Chip tone="violet">{n.category}</Chip>
                        <Badge>{n.status}</Badge>
                        {n.rfp && <Chip tone="blue"><FileText size={10} /> RFP attached</Chip>}
                        {quotedNeedIds.has(n.id) && <Chip tone="emerald">You proposed</Chip>}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{n.description}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {n.budget_min != null || n.budget_max != null
                          ? `${n.budget_min != null ? moneyUsd(n.budget_min) : '…'}–${n.budget_max != null ? moneyUsd(n.budget_max) : '…'}`
                          : 'Budget open'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{n.timeline || 'Timeline open'}</div>
                      <div className="text-[11px] text-gray-400 mt-1">{n.quote_count} proposal{n.quote_count === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                </RowCard>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'proposals' && (
        quotes.length === 0 ? (
          <EmptyState>No proposals yet. Browse Open requests and send your first one.</EmptyState>
        ) : (
          <div className="space-y-2.5">
            {quotes.map((qt) => (
              <div key={qt.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {qt.need_title || `Request #${qt.need_id}`}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={qt.status === 'accepted' ? 'emerald' : qt.status === 'rejected' ? 'rose' : qt.status === 'withdrawn' ? 'gray' : 'amber'}>
                        {qt.status}
                      </Badge>
                      {qt.need_category && <Chip tone="violet">{qt.need_category}</Chip>}
                      {qt.timeline_weeks != null && <Chip>{qt.timeline_weeks} wk</Chip>}
                      <span className="text-[11px] text-gray-400">sent {formatRelativeDay(qt.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{qt.deliverables}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{moneyUsd(qt.price)}</div>
                    {qt.status === 'submitted' && (
                      <button
                        onClick={() => withdraw(qt)}
                        className="mt-2 px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:border-rose-300 hover:text-rose-500"
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {view === 'engagements' && (
        <div className="space-y-6">
          <Section title={`Active (${active.length})`}>
            {active.length === 0 ? (
              <EmptyState>No active engagements. Accepted proposals become engagements here.</EmptyState>
            ) : (
              <div className="space-y-2.5">
                {active.map((e) => <EngagementRow key={e.id} e={e} onOpen={() => { setOpenEng(e); setActionNote(''); }} />)}
              </div>
            )}
          </Section>

          <Section title="Invoice ledger">
            {wrapped.length === 0 && invoiced.length === 0 ? (
              <EmptyState>Nothing to invoice yet — deliver an engagement and it appears here.</EmptyState>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {wrapped.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{e.need_title || `Engagement ${e.uid?.slice(0, 8)}`}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {e.project_name || e.founder_name || '—'} · delivered {formatDay(e.delivered_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-semibold tabular-nums">{moneyUsd(e.price)}</span>
                      <button
                        onClick={() => engAction(e, 'invoice')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700"
                      >
                        <Receipt size={12} /> Issue invoice
                      </button>
                    </div>
                  </div>
                ))}
                {invoiced.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{e.need_title || `Engagement ${e.uid?.slice(0, 8)}`}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Invoice {e.invoice_id} · {formatDay(e.invoiced_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-semibold tabular-nums">{moneyUsd(e.price)}</span>
                      <Badge tone="blue">invoiced</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {/* Need detail + proposal builder */}
      <SlideOver
        open={!!openNeed}
        onClose={() => setOpenNeed(null)}
        title={openNeed?.title || ''}
        subtitle={openNeed ? `${openNeed.category} · ${openNeed.quote_count} proposal${openNeed.quote_count === 1 ? '' : 's'} so far` : ''}
      >
        {openNeed && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{openNeed.description}</p>
            {openNeed.rfp ? (
              <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/10 p-3.5">
                <div className="text-[11px] uppercase tracking-wide text-blue-600 dark:text-blue-400 font-semibold mb-1.5">RFP scope</div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{openNeed.rfp.scope_md}</p>
                {openNeed.rfp.deadline_at && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Deadline {formatDay(openNeed.rfp.deadline_at)}</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-500 dark:text-gray-400">No formal RFP attached — propose against the description.</div>
            )}

            <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold mt-3 mb-2">Your proposal</div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">Price (USD)</span>
                    <input
                      value={proposal.price}
                      onChange={(e) => setProposal((p) => ({ ...p, price: e.target.value }))}
                      inputMode="numeric"
                      placeholder="e.g. 18000"
                      className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">Timeline (weeks)</span>
                    <input
                      value={proposal.timeline_weeks}
                      onChange={(e) => setProposal((p) => ({ ...p, timeline_weeks: e.target.value }))}
                      inputMode="numeric"
                      placeholder="e.g. 6"
                      className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">Deliverables{openNeed.rfp?.deliverables_md ? ' (prefilled from the RFP — edit to your scope)' : ''}</span>
                  <textarea
                    value={proposal.deliverables}
                    onChange={(e) => setProposal((p) => ({ ...p, deliverables: e.target.value }))}
                    rows={5}
                    className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">Notes to the founder (optional)</span>
                  <textarea
                    value={proposal.notes}
                    onChange={(e) => setProposal((p) => ({ ...p, notes: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
                  />
                </label>
                <button
                  onClick={submitProposal}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  <Send size={14} /> {sending ? 'Sending…' : 'Send proposal'}
                </button>
              </div>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Engagement lifecycle actions */}
      <SlideOver
        open={!!openEng}
        onClose={() => setOpenEng(null)}
        title={openEng?.need_title || (openEng ? `Engagement ${openEng.uid?.slice(0, 8)}` : '')}
        subtitle={openEng ? `${openEng.project_name || openEng.founder_name || ''} · ${moneyUsd(openEng.price)}` : ''}
      >
        {openEng && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge>{openEng.status}</Badge>
              <Chip>Accepted {formatDay(openEng.created_at)}</Chip>
              {openEng.delivered_at && <Chip tone="blue">Delivered {formatDay(openEng.delivered_at)}</Chip>}
            </div>

            <label className="block">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                Note (delivery notes, or a cancellation reason)
              </span>
              <textarea
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                rows={3}
                className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {openEng.status === 'accepted' && (
                <button onClick={() => engAction(openEng, 'start')} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700">
                  Start work
                </button>
              )}
              {['accepted', 'in_progress'].includes(openEng.status) && (
                <button onClick={() => engAction(openEng, 'deliver')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
                  Mark delivered
                </button>
              )}
              {!['reviewed', 'invoiced', 'cancelled'].includes(openEng.status) && (
                <button onClick={() => engAction(openEng, 'cancel')} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:border-rose-300 hover:text-rose-500">
                  Cancel engagement
                </button>
              )}
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}

function EngagementRow({ e, onOpen }) {
  return (
    <RowCard onClick={onOpen}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
            <Handshake size={15} className="text-violet-500 flex-shrink-0" />
            <span className="truncate">{e.need_title || `Engagement ${e.uid?.slice(0, 8)}`}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge>{e.status}</Badge>
            {e.need_category && <Chip tone="violet">{e.need_category}</Chip>}
            {(e.project_name || e.founder_name) && <Chip>{e.project_name || e.founder_name}</Chip>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{moneyUsd(e.price)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">since {formatDay(e.created_at)}</div>
        </div>
      </div>
    </RowCard>
  );
}
