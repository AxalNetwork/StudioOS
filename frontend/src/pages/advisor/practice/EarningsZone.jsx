import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Lightbox, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import {
  SaveNote, StatedLimit, Unrecorded, ZoneHeading, buttonClass, ghostButtonClass, inputClass, isLicenceSentence,
  money, zoneError,
} from '../expertise/kit';
import {
  BILLING_STATE, PAYOUT_STATE_LABEL, PAYOUT_TONE, customWindow, draftFitsPeriod, earningsCards,
  latestOnly, lineWhen, noAdvisorProfile, noteIsDirty, noteIsStale, payoutWhen, periodWindow, ratePct,
} from './earningsLedger';
import SourceState from './SourceState';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import useAiSpend from '../../../hooks/useAiSpend';
import { formatCost } from '../../../ui/assistCost';
import { useRailOption } from '../../../ui/railCrumbs';

/**
 * Practice · Earnings — #4834 (D4834), built to Practice v2 PX-07 (ledger and
 * unsaved-note guard), PX-08 (per-source states) and PX-10 (phone), D4874.
 * `/practice/earnings`, tagged LEDGER. It replaced D4's quarter and by-client
 * layout (`design/canvases/backlog/Detail Layer Canvas II.dc.html`).
 *
 * "RECORDED", NEVER "YOU RECEIVED". The store holds what the advisor billed and
 * what they marked collected; money reaching them is a payout row. So the cards
 * are Recorded billed, Recorded collected, Outstanding and Platform fees, each
 * with the line it is built from, and "Paid out" is a card only over paid
 * payout rows (`earningsCards` in `earningsLedger.js`). No figure here is
 * labelled received, and none is computed: every cent arrives from the Worker.
 *
 * THE LEDGER IS THE RECORDS. One row per booking in the window, with the rate
 * and fee stamped on that record when it was priced (frozen facts: a later rate
 * or a billing-state change moves neither, #4679). A record with no stored
 * rate says so; nothing is filled in from today's rate.
 *
 * ONE PERIOD AT A TIME, AND ONLY ITS OWN. Every read takes a ticket
 * (`latestOnly`) and an older period's answer is dropped, not drawn under the
 * newer heading. The note is filed only against the period it was written for
 * (`draftFitsPeriod`), and unsaved note text is resolved in a dialog (Save ·
 * Discard · Stay) before the period changes.
 *
 * ONE FAILING SOURCE NEVER BLANKS THE PAGE. The ledger, the note, the payout
 * setup and the payout history each draw their own `SourceState`.
 *
 * Included pricing is not stored (D4874, backend required), so no card or line
 * shows it.
 */

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600';
const primaryBtn = `${buttonClass} ${FOCUS} min-h-[44px] lg:min-h-0`;
const ghostBtn = `${ghostButtonClass} ${FOCUS} min-h-[44px] lg:min-h-0`;

/**
 * The payout account's three states and the gate each implies (the Worker's
 * `PAYOUT_GATE`). Only the advisor's own state is drawn, with its sentence.
 */
const PAYOUT_STATES = {
  verified: ['Verified', 'ok', 'Paid sessions bookable and chargeable.'],
  pending: ['Pending', 'warn', 'Bookable, held uncharged until verification clears.'],
  blocked: ['Blocked', 'danger', 'Paid slots hidden from your profile. Free intro calls still bookable.'],
};

/**
 * The take rate as a reader sees it, from basis points. The one piece of money
 * arithmetic on this page, and a display conversion: 1500 bps IS 15%. An
 * absent rate is an absence, never 0%.
 */
function takeRatePct(rate) {
  const bps = rate?.bps;
  if (bps == null || !Number.isFinite(Number(bps))) return 'a rate that could not be read';
  const pct = Number(bps) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/**
 * Who wrote the period note being filed (migration 242's `source`): 'ai' when it
 * is the model's last text unchanged, 'edited' when a model draft was changed
 * (now, or in the note being re-filed), 'advisor' when no model text was
 * involved. `modelText` is the model's last draft, or the stored body of a note
 * already filed as 'ai'; null when the model wrote nothing here (D779, #2104).
 */
export function periodNoteSource(text, modelText, priorSource) {
  if (modelText != null && text === modelText) return 'ai';
  if (modelText != null || priorSource === 'ai' || priorSource === 'edited') return 'edited';
  return 'advisor';
}

/** A line's billing state: a word and a shape, never colour alone. */
function BillingPill({ state }) {
  const s = BILLING_STATE[state] || { label: state || 'Not recorded', tone: 'neutral', mark: '○' };
  return (
    <Pill tone={s.tone}>
      <span aria-hidden="true" className="mr-1">{s.mark}</span>{s.label}
    </Pill>
  );
}

/** The cells of one ledger record, shared by the table row and the phone card. */
function lineCells(line) {
  const when = lineWhen(line);
  const rate = ratePct(line.take_rate_bps);
  return {
    client: line.client_name || <Unrecorded>Client not recorded</Unrecorded>,
    session: line.topic || <Unrecorded>Session not named</Unrecorded>,
    price: money(line.amount_cents) ?? <Unrecorded />,
    billing: <BillingPill state={line.billing_state} />,
    collected: line.collected_cents != null
      ? money(line.collected_cents)
      : <Unrecorded>{line.billing_state === 'unpriced' ? 'Not recorded' : 'Not collected'}</Unrecorded>,
    rate: rate ?? <Unrecorded>{line.amount_cents == null ? 'Not recorded' : 'Not recorded · priced before rates were stamped'}</Unrecorded>,
    fee: money(line.platform_fee_cents) ?? <Unrecorded />,
    net: money(line.net_cents) ?? <Unrecorded />,
    date: when.text ?? <Unrecorded>No date</Unrecorded>,
  };
}

const COLUMNS = [
  ['client', 'Client'], ['session', 'Session / engagement'], ['price', 'Price', true],
  ['billing', 'Billing state'], ['collected', 'Recorded collected', true], ['rate', 'Platform rate', true],
  ['fee', 'Platform fee', true], ['net', 'Net', true], ['date', 'Date'],
];

function clockOf(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  try { return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return null; }
}

export default function EarningsZone() {
  const [view, setView] = useState('this_month');
  const [custom, setCustom] = useState({ from: '', until: '' });
  const [ledger, setLedger] = useState({ loading: true, error: '', data: null, unavailable: false });
  const [payout, setPayout] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [note, setNote] = useState(null);
  // #4714 (D4714): whether each secondary read answered. A failed read is
  // never drawn as "none": no account, no payouts or no note on file.
  const [restRead, setRestRead] = useState({ payout: true, payouts: true, note: true });
  const [restLoading, setRestLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  // D773 (#2099): while the band drafts, the run is the Earnings board's
  // `draft:period-narrative` (lib/railOptions/advisor.js).
  useRailOption(drafting ? 'draft:period-narrative' : null, 'Draft it');
  // The model's last text for this window, so Save can say who wrote what is filed.
  const [modelText, setModelText] = useState(null);
  // #4679 — tickets so only the latest read/draft for the CURRENT period writes,
  // and the period each piece of note text belongs to.
  const ledgerTicket = useRef(latestOnly());
  const restTicket = useRef(latestOnly());
  const draftTicket = useRef(latestOnly());
  const [draftKey, setDraftKey] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveNote, setSaveNote] = useState(null);
  const [exportNote, setExportNote] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectNote, setConnectNote] = useState(null);
  // #4834: the period the reader asked for while the note had unsaved text.
  const [pendingView, setPendingView] = useState(null);
  const stayRef = useRef(null);
  const noteId = useId();

  // The window is derived ONCE per view change and reused by the ledger read,
  // the note key and the heading, so the three cannot name different periods.
  // EVERY CHIP KEY IS NAMED HERE, in the page that mounts the chip row
  // (`profile_zone_filters.test.mjs`): 'this_month', 'last_month', 'quarter',
  // 'year', 'custom'.
  const window_ = useMemo(() => {
    const now = new Date();
    if (view === 'custom') {
      return customWindow(custom.from, custom.until)
        || { key: null, label: 'Custom range', from: null, until: null, unchosen: true };
    }
    if (view === 'last_month') return periodWindow('last_month', now);
    if (view === 'quarter') return periodWindow('quarter', now);
    if (view === 'year') return periodWindow('year', now);
    return periodWindow('this_month', now);
  }, [view, custom.from, custom.until]);

  const { spend } = useAiSpend({ enabled: true });

  const loadLedger = useCallback(async (w) => {
    const t = ledgerTicket.current.begin();
    // The previous window's figures are cleared, not kept under the new
    // heading while the read is in flight.
    setLedger({ loading: true, error: '', data: null, unavailable: false });
    try {
      const data = await api.getMyAdvisorLedger({ from: w.from, until: w.until });
      if (!ledgerTicket.current.isCurrent(t)) return;
      setLedger({ loading: false, error: '', data, unavailable: false });
    } catch (e) {
      if (!ledgerTicket.current.isCurrent(t)) return;
      setLedger({ loading: false, error: zoneError(e, e?.message || 'This period could not be read.', 'practice'), data: null, unavailable: noAdvisorProfile(e) });
    }
  }, []);

  const loadRest = useCallback(async (w) => {
    // TOLERATED, NOT REQUIRED. Each of the three says its own absence rather
    // than taking the page down.
    const t = restTicket.current.begin();
    setRestLoading(true);
    const FAILED = Symbol('failed');
    const [acct, hist, n] = await Promise.all([
      api.getMyAdvisorPayoutAccount().catch(() => FAILED),
      api.listMyAdvisorPayouts().catch(() => FAILED),
      // A custom range has no note key, so nothing is read for it.
      w.key ? api.getMyAdvisorPeriodNote(w.key).catch(() => FAILED) : Promise.resolve(null),
    ]);
    if (!restTicket.current.isCurrent(t)) return;
    setRestLoading(false);
    setRestRead({ payout: acct !== FAILED, payouts: hist !== FAILED, note: n !== FAILED });
    setPayout(acct === FAILED ? null : acct);
    setPayouts(hist !== FAILED && Array.isArray(hist?.items) ? hist.items : []);
    if (n === FAILED || !w.key) {
      setNote(null); setDraft(''); setDraftKey(null); setModelText(null); setEditing(false);
      return;
    }
    setNote(n?.note || null);
    setDraft(n?.note?.body || '');
    setDraftKey(w.key);
    setModelText(n?.note?.source === 'ai' ? n.note.body : null);
    setEditing(false);
  }, []);

  useEffect(() => {
    // A new period invalidates any model draft still in flight for the old one,
    // and the text on screen no longer belongs to the period shown.
    draftTicket.current.cancel();
    setDrafting(false); setDraftKey(null); setSaveNote(null);
    // #4713: the old period's note leaves the screen at once, not when the new
    // one lands, so it is never read (or filed) under the new period's label.
    setNote(null); setDraft(''); setModelText(null); setEditing(false);
    if (window_.unchosen) {
      // No range yet: nothing is read, and nothing older stays on screen.
      ledgerTicket.current.cancel(); restTicket.current.cancel();
      setLedger({ loading: false, error: '', data: null, unavailable: false });
      loadRest(window_);
      return;
    }
    loadLedger(window_); loadRest(window_);
  }, [loadLedger, loadRest, window_]);

  const dirty = noteIsDirty(note, draft);

  // #4713 / #4834: typed or drafted text that is not filed is resolved before
  // the period changes, in the canvas's dialog (PX-07 B): Save · Discard · Stay.
  const changeView = (next) => {
    if (next === view) return;
    if (dirty) { setPendingView(next); return; }
    setView(next);
  };

  const L = ledger.data;
  const totals = L?.totals;
  const cards = earningsCards(L);
  const lines = L?.lines;

  // MEASURED, NEVER MODELLED (D16). The caller's own average for this task, or
  // nothing. A modelled estimate would quote a price from a guess.
  const observedRun = useMemo(() => {
    const rows = spend?.by_task || [];
    const row = rows.find((r) => r.task === 'workspace_explain');
    if (!row || !row.calls) return null;
    return { cost: Number(row.cost_usd) / Number(row.calls), calls: Number(row.calls) };
  }, [spend]);

  const stale = noteIsStale(note, totals);

  // ── The two ops ──────────────────────────────────────────────────────────

  const exportCsv = useCallback(() => {
    // Built from the records on screen, so nothing leaves the browser and no
    // endpoint is needed. An absent figure exports as an empty cell, never as
    // 0 — the CSV must not assert a price, rate or fee nobody recorded.
    const rows = lines?.items || [];
    const cell = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
    const cents = (v) => (v == null ? '' : (Number(v) / 100).toFixed(2));
    const out = [
      ['Client', 'Session', 'Date', 'Price', 'Billing state', 'Recorded collected', 'Platform rate', 'Platform fee', 'Net'].join(','),
      ...rows.map((r) => [
        cell(r.client_name), cell(r.topic), cell(r.session_at || r.created_at),
        cents(r.amount_cents), cell(r.billing_state), cents(r.collected_cents),
        cell(ratePct(r.take_rate_bps)), cents(r.platform_fee_cents), cents(r.net_cents),
      ].join(',')),
      // #4702: records past the cap are one summed row, so the file's records
      // plus this row equal the Total and nobody is silently dropped.
      ...(lines?.other ? [[
        cell(`${lines.other.records} older records, summed`), '', '', cents(lines.other.gross_cents), '', '', '',
        cents(lines.other.fee_cents), cents(lines.other.net_cents),
      ].join(',')] : []),
      ['Total recorded', '', '', cents(totals?.gross_cents), '', '', '', cents(totals?.cut_cents), cents(totals?.net_cents)].join(','),
      ['Unpriced sessions', '', '', totals?.unpriced_sessions ?? '', '', '', '', '', ''].join(','),
    ];
    const blob = new Blob([out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `axal-earnings-${window_.key || 'custom'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [lines, totals, window_]);

  const downloadTaxSummary = useCallback(async () => {
    setExportNote(null);
    try {
      // FETCHED, NOT DERIVED FROM THE TABLE ON SCREEN. A tax year and the
      // reader's chosen window are different spans.
      const year = Number(String(window_.key || window_.from || '').slice(0, 4)) || new Date().getFullYear();
      const s = await api.getMyAdvisorTaxSummary(year);
      const cents = (v) => (v == null ? '' : (Number(v) / 100).toFixed(2));
      const out = [
        ['Field', 'Value'].join(','),
        ['Year', s.year].join(','),
        ['Currency', s.currency].join(','),
        ['Gross', cents(s.gross_cents)].join(','),
        ['Platform cut', cents(s.platform_cut_cents)].join(','),
        ['Net', cents(s.net_cents)].join(','),
        ['Sessions', s.sessions].join(','),
        ['Priced sessions', s.priced_sessions].join(','),
        ['Sessions with no price recorded', s.unpriced_sessions].join(','),
        ['Clients', s.clients].join(','),
        // THE DISCLAIMER TRAVELS WITH THE FILE: a number exported without it
        // is a number somebody may take for a tax document.
        ['Basis', `"${s.basis}"`].join(','),
        ['Note', `"${String(s.document?.note || '').replace(/"/g, '""')}"`].join(','),
      ];
      const blob = new Blob([out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `axal-${s.year}-summary.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setExportNote({ ok: true, text: `Downloaded the ${s.year} summary. It is not a tax document.` });
    } catch (e) {
      setExportNote({ ok: false, text: e?.message || 'The summary could not be built.' });
    }
  }, [window_]);

  const opsHandlers = {
    exportCsv: { onClick: exportCsv, disabled: !(lines?.items || []).length,
      title: !(lines?.items || []).length ? 'nothing in this period to export' : undefined },
    taxSummary: { onClick: downloadTaxSummary },
  };

  // ── The note and its Eadwyn draft ────────────────────────────────────────

  const narrate = useCallback(async () => {
    const t = draftTicket.current.begin();
    const forKey = window_.key;
    setDrafting(true); setSaveNote(null);
    try {
      // COVERAGE LINES, NOT ROWS: the page's own summary of itself, with no
      // client's name in it. Nothing here calls any figure "received".
      const st = L?.states;
      const coverage = [
        `${window_.label} recorded billed ${money(totals?.gross_cents) ?? 'not recorded'}`,
        `platform fees ${money(totals?.cut_cents) ?? 'not recorded'}, each at its own record's rate (today's rate is ${takeRatePct(L?.take_rate)})`,
        `recorded collected ${money(st?.collected?.gross_cents) ?? 'not recorded'}`,
        `outstanding, billed and not marked collected ${money(st?.billed?.gross_cents) ?? 'not recorded'}`,
        `written off ${money(st?.written_off?.gross_cents) ?? 'not recorded'}`,
        `${totals?.priced_sessions ?? 'an unknown number of'} priced sessions, ${totals?.unpriced_sessions ?? 'an unknown number'} with no price recorded`,
        'money reaching the advisor is recorded only as a paid payout, never inferred from collected',
      ];
      const res = await api.aiWorkspaceExplain({ workspace: 'Practice', zone: 'Earnings', coverage });
      const text = String(res?.text || res?.answer || '').trim();
      if (!text) throw new Error('The model returned nothing to read.');
      // A response for an earlier period is dropped, not filed under this one.
      if (!draftTicket.current.isCurrent(t)) return;
      setDraftKey(forKey);
      setDraft(text); setModelText(text); setEditing(true);
    } catch (e) {
      if (!draftTicket.current.isCurrent(t)) return;
      setSaveNote({ ok: false, text: e?.message || 'Nothing was drafted.' });
    } finally { if (draftTicket.current.isCurrent(t)) setDrafting(false); }
  }, [L, totals, window_]);

  /** Files the note for the period on screen. Resolves true when it was saved. */
  const accept = useCallback(async () => {
    // The text must belong to the period on screen; otherwise nothing is sent.
    if (!draftFitsPeriod(draftKey, window_.key)) {
      setSaveNote({ ok: false, text: 'This text was written for another period, so it was not saved.' });
      return false;
    }
    setBusy(true); setSaveNote(null);
    try {
      // `source`: 'edited' when the advisor changed a draft, 'ai' when they
      // kept it as written, 'advisor' when no draft was involved (242).
      const res = await api.saveMyAdvisorPeriodNote(window_.key, {
        body: draft,
        source: periodNoteSource(draft, modelText, note?.source),
        period_key: window_.key,
        figures: totals ? {
          gross_cents: totals.gross_cents, cut_cents: totals.cut_cents, net_cents: totals.net_cents,
        } : null,
      });
      setNote(res.note); setDraft(res.note?.body ?? draft); setEditing(false);
      setSaveNote({ ok: true, text: `Note saved for ${window_.label}.` });
      return true;
    } catch (e) {
      setSaveNote({ ok: false, text: e?.message || 'The note was not saved.' });
      return false;
    } finally { setBusy(false); }
  }, [draft, draftKey, modelText, note, totals, window_]);

  const discard = useCallback(async () => {
    setBusy(true); setSaveNote(null);
    try {
      await api.deleteMyAdvisorPeriodNote(window_.key);
      setNote(null); setDraft(''); setModelText(null); setEditing(false);
      setSaveNote({ ok: true, text: `Note deleted for ${window_.label}.` });
    } catch (e) {
      setSaveNote({ ok: false, text: e?.message || 'The note was not deleted.' });
    } finally { setBusy(false); }
  }, [window_]);

  // The unsaved-changes dialog's three answers.
  const stay = () => setPendingView(null);
  const discardAndSwitch = () => {
    const next = pendingView;
    setPendingView(null); setDraft(note?.body || ''); setEditing(false);
    setView(next);
  };
  const saveAndSwitch = async () => {
    const next = pendingView;
    if (await accept()) { setPendingView(null); setView(next); }
  };
  const pendingLabel = pendingView === 'custom'
    ? 'a custom range'
    : pendingView ? periodWindow(pendingView, new Date()).label : '';

  // ── Payout setup (PR5b) ──────────────────────────────────────────────────
  // NEITHER CONTROL MOVES MONEY. Connecting returns a URL the advisor visits
  // and checking reads a status back; both work while advisory charging is off.
  const connect = useCallback(async () => {
    setConnecting(true); setConnectNote(null);
    try {
      const res = await api.connectMyAdvisorPayoutAccount();
      if (!res?.url) throw new Error('No onboarding link came back.');
      window.location.assign(res.url);
    } catch (e) {
      setConnectNote({ ok: false, text: e?.message || 'That could not be started.' });
      setConnecting(false);
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    setConnecting(true); setConnectNote(null);
    try {
      const res = await api.refreshMyAdvisorPayoutAccount();
      const fresh = await api.getMyAdvisorPayoutAccount().catch(() => null);
      if (fresh) setPayout(fresh);
      // A FAILED REFRESH IS REPORTED AS A FAILED REFRESH, not as a state.
      setConnectNote(res?.refreshed
        ? { ok: true, text: `Checked with the provider — ${res.state}.` }
        : { ok: false, text: 'The provider could not be reached, so the state shown is the last one recorded.' });
    } catch (e) {
      setConnectNote({ ok: false, text: e?.message || 'Nothing was checked.' });
    } finally { setConnecting(false); }
  }, []);

  // ── No advisor profile: nothing here is anyone's ─────────────────────────
  if (ledger.unavailable) {
    return (
      <section className="rounded-[12px] border border-dashed border-axal-hairline p-5 dark:border-gray-700" data-testid="earnings-unavailable" aria-labelledby={`${noteId}-unavail`}>
        <h2 id={`${noteId}-unavail`} className="text-sm font-extrabold tracking-tight">Earnings unavailable</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">No advisor profile is attached to this account.</p>
        <details className="mt-3 text-[12px] leading-relaxed text-axal-muted dark:text-gray-400">
          <summary className={`cursor-pointer font-semibold text-emerald-700 dark:text-emerald-300 ${FOCUS}`}>Learn why</summary>
          <p className="mt-2 max-w-xl">
            Earnings are the sessions, prices and payouts recorded against one advisor&rsquo;s profile.
            This account has none, so there is nothing of its own to total, and no figure is shown
            rather than a zero. An admin previewing the Advisor role sees this; impersonating a
            specific advisor opens theirs.
          </p>
        </details>
      </section>
    );
  }

  const acctState = restRead.payout ? (payout?.state || 'pending') : null;
  const [acctLabel, acctTone, acctGate] = PAYOUT_STATES[acctState] || [];
  const lastPaid = payouts.find((p) => p.state === 'paid');
  const nextScheduled = payouts.find((p) => p.state === 'scheduled');

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Earnings"
        blurb="A ledger of what you billed and what you recorded as collected."
        action={totals?.unpriced_sessions > 0 ? <Pill tone="warn">{totals.unpriced_sessions} unpriced</Pill> : null}
      />

      <ZoneToolbar
        role="advisor"
        filters={advisorZoneFilters('practice/earnings', { value: view, onChange: changeView })}
        actions={advisorZoneActions('practice/earnings', { handlers: opsHandlers })}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        {view === 'custom' ? (
          <div className="flex flex-wrap items-end gap-3" data-testid="earnings-custom-range">
            <label className="block text-[12px]">
              <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">From</span>
              <input type="date" className={`${inputClass} min-h-[44px] lg:min-h-0`} value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} data-testid="input-earnings-from" />
            </label>
            <label className="block text-[12px]">
              <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">To</span>
              <input type="date" className={`${inputClass} min-h-[44px] lg:min-h-0`} value={custom.until}
                onChange={(e) => setCustom((c) => ({ ...c, until: e.target.value }))} data-testid="input-earnings-until" />
            </label>
          </div>
        ) : <span />}
        <span className="font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400" aria-live="polite" data-testid="earnings-period">
          {window_.label}
        </span>
      </div>

      <SaveNote note={exportNote} />

      {/* ── Cards and ledger: one source, one state ───────────────────────── */}
      {window_.unchosen ? (
        <SourceState kind="empty" title="Choose a range." testid="earnings-range-unchosen">
          Pick the first and last day; both are included. Nothing is read until the range is complete.
        </SourceState>
      ) : ledger.loading ? (
        <SourceState kind="loading" source="Earnings" testid="earnings-loading" />
      ) : isLicenceSentence(ledger.error) ? (
        // #5363: the coded licence refusal is not a failed read; reading
        // again cannot change it, so it says what it needs and offers no retry.
        <p className="rounded-[10px] border border-axal-hairline px-3 py-2.5 text-[12px] font-semibold dark:border-gray-700 dark:text-gray-200"
          role="status" data-testid="earnings-licence-required">
          {ledger.error}
        </p>
      ) : ledger.error ? (
        <SourceState kind="unreadable" source={`Earnings for ${window_.label}`} onRetry={() => loadLedger(window_)} testid="earnings-unreadable">
          No figure is shown rather than a zero.
        </SourceState>
      ) : L && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="earnings-cards">
            {cards.map((c) => (
              <Card key={c.key} padding="md" data-testid={`earnings-card-${c.key}`}>
                <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint">{c.label}</div>
                <div className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums">
                  {c.unread
                    ? <span className="text-[13px] font-bold text-red-700 dark:text-red-300">Could not be read</span>
                    : (money(c.cents) ?? <Unrecorded />)}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-axal-faint dark:text-gray-400">{c.basis}</p>
              </Card>
            ))}
          </div>

          <Card padding="md" className="mt-3">
            {!lines?.read ? (
              <SourceState kind="unreadable" source="The ledger records" onRetry={() => loadLedger(window_)} testid="ledger-lines-unreadable">
                The totals above were read; the records behind them were not.
              </SourceState>
            ) : !lines.items?.length ? (
              <SourceState kind="empty" title="No sessions in this period." testid="ledger-empty">
                Once you price a session under <Link to="/practice/sessions" className={`text-emerald-700 underline dark:text-emerald-300 ${FOCUS}`}>Sessions</Link>, it appears here.
              </SourceState>
            ) : (
              <>
                {/* Desktop: a table. Under 768px the same records as stacked cards. */}
                <div className="hidden overflow-x-auto md:block" data-testid="ledger-table">
                  <table className="w-full min-w-[860px] text-[12px]">
                    <caption className="pb-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">
                      Ledger · showing {lines.listed} of {lines.total ?? lines.listed} · rates are fixed when a record is priced
                    </caption>
                    <thead>
                      <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                        {COLUMNS.map(([k, h, num]) => (
                          <th key={k} scope="col" className={`px-2 py-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint ${num ? 'text-right' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.items.map((line) => {
                        const c = lineCells(line);
                        return (
                          <tr key={line.id} data-testid={`ledger-line-${line.id}`} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                            {COLUMNS.map(([k, , num]) => (
                              <td key={k} className={`px-2 py-2.5 ${num ? 'whitespace-nowrap text-right tabular-nums' : ''} ${k === 'date' ? 'whitespace-nowrap' : ''} ${k === 'client' ? 'font-bold' : ''}`}>{c[k]}</td>
                            ))}
                          </tr>
                        );
                      })}
                      {lines.other && (
                        <tr data-testid="ledger-line-other" className="border-t border-axal-hairline dark:border-gray-700">
                          <td className="px-2 py-2.5 text-axal-muted dark:text-gray-400" colSpan={2}>
                            {lines.other.records} older record{lines.other.records === 1 ? '' : 's'}, summed
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{money(lines.other.gross_cents)}</td>
                          <td className="px-2 py-2.5" colSpan={3} />
                          <td className="px-2 py-2.5 text-right tabular-nums">{money(lines.other.fee_cents)}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{money(lines.other.net_cents)}</td>
                          <td className="px-2 py-2.5" />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden" data-testid="ledger-records">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-faint">
                    Ledger · showing {lines.listed} of {lines.total ?? lines.listed} · rates are fixed when a record is priced
                  </p>
                  <ul className="mt-2 grid gap-2">
                    {lines.items.map((line) => {
                      const c = lineCells(line);
                      return (
                        <li key={line.id} data-testid={`ledger-record-${line.id}`} className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-bold">{c.client}</div>
                              <div className="text-[12px] text-axal-muted dark:text-gray-400">{c.session} · {c.date}</div>
                            </div>
                            {c.billing}
                          </div>
                          <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12px]">
                            {COLUMNS.filter(([k]) => ['price', 'collected', 'rate', 'fee', 'net'].includes(k)).map(([k, h]) => (
                              <React.Fragment key={k}>
                                <dt className="text-axal-faint dark:text-gray-400">{h}</dt>
                                <dd className="text-right tabular-nums">{c[k]}</dd>
                              </React.Fragment>
                            ))}
                          </dl>
                        </li>
                      );
                    })}
                    {lines.other && (
                      <li data-testid="ledger-record-other" className="rounded-[10px] border border-dashed border-axal-hairline p-3 text-[12px] dark:border-gray-700">
                        {lines.other.records} older record{lines.other.records === 1 ? '' : 's'}, summed: {money(lines.other.gross_cents)} priced, {money(lines.other.fee_cents)} in fees, {money(lines.other.net_cents)} net.
                      </li>
                    )}
                  </ul>
                </div>
              </>
            )}

            <div className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed text-axal-faint dark:text-gray-400" data-testid="ledger-notes">
              {lines?.read && lines.complete === false && (
                <p>The newest {lines.listed} of {lines.total} records are listed and the rest are summed in one row; the cards count all {lines.total}.</p>
              )}
              {lines?.unfrozen > 0 && (
                <p>
                  {lines.unfrozen} record{lines.unfrozen === 1 ? ' was' : 's were'} priced before rates were stamped
                  on each record, so {lines.unfrozen === 1 ? 'it has' : 'they have'} no rate or fee of {lines.unfrozen === 1 ? 'its' : 'their'} own here.
                </p>
              )}
              <p>
                A record&rsquo;s rate and fee are fixed when it is priced. Marking it billed, collected or
                written off changes neither, and a price changes only when you reprice it on Sessions.
              </p>
              <p data-testid="ledger-retainer-basis">
                Engagement retainers are contract values per cycle, not billed records, so they are not lines in
                this ledger.
              </p>
              {/* RENDERED FROM THE RESPONSE (D75): the rate is recorded and
                  `settlement` says whether anything moved under it. */}
              <p>
                Amounts are in {L.currency || 'USD'} and are your own record. Axal does not invoice your
                clients and holds no money on your behalf.{' '}
                {L.settlement === 'none' ? (
                  <>
                    A platform rate of {takeRatePct(L.take_rate)} applies to newly priced records,
                    and <strong>nothing has been charged under it</strong> — no payment is taken through
                    Axal today.
                  </>
                ) : (
                  <>Payments are running in <strong>{L.settlement}</strong> mode.</>
                )}
              </p>
            </div>
          </Card>
        </>
      )}

      {/* ── Note and payouts, each its own source ─────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-12">
        <Card padding="md" className="lg:col-span-7" data-testid="earnings-note">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-extrabold tracking-tight" id={`${noteId}-h`}>
              {window_.key ? `Note for ${window_.label}` : 'Note'}
            </h3>
            {note?.updated_at && !dirty && clockOf(note.updated_at) && (
              <span className="font-mono text-[10.5px] text-axal-faint">Saved {clockOf(note.updated_at)}</span>
            )}
          </div>
          {!window_.key ? (
            <p className="mt-2 text-[12px] leading-relaxed">
              <SourceState kind="not_recorded" testid="note-custom">
                a note is kept for a month, quarter or year, not for a custom range
              </SourceState>
            </p>
          ) : restLoading ? (
            <div className="mt-2"><SourceState kind="loading" source="This period's note" /></div>
          ) : !restRead.note ? (
            <div className="mt-2">
              <SourceState kind="unreadable" source="This period's note" onRetry={() => loadRest(window_)} testid="note-unreadable">
                Nothing is drafted or saved over it until it is read.
              </SourceState>
            </div>
          ) : note && !editing ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed">{note?.body}</p>
              <p className="mt-1.5 text-[10.5px] text-axal-faint">
                {note?.source === 'ai' ? 'Drafted by Eadwyn, kept as written.'
                  : note?.source === 'edited' ? 'Drafted by Eadwyn, edited by you.'
                    : 'Written by you.'}
                {stale === true && ' The figures have moved since this was written.'}
                {stale === false && ' Still matches the figures above.'}
              </p>
            </>
          ) : (
            <label className="mt-2 block" htmlFor={`${noteId}-ta`}>
              <span className="sr-only">Note for {window_.label}</span>
              <textarea
                id={`${noteId}-ta`}
                className={`${inputClass} min-h-[96px]`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What happened this period, in your words."
                data-testid="input-period-note" />
            </label>
          )}
          {window_.key && !restLoading && restRead.note && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {(editing || !note) && (
                <button type="button" className={primaryBtn} onClick={accept} disabled={busy || !draft.trim()}>
                  {busy ? 'Saving…' : 'Save note'}
                </button>
              )}
              {note && !editing && (
                <button type="button" className={ghostBtn} onClick={() => setEditing(true)}>Edit</button>
              )}
              <button type="button" className={ghostBtn} onClick={narrate} disabled={drafting || busy}
                aria-describedby={`${noteId}-cost`}>
                {drafting ? 'Drafting…' : 'Draft it'}
              </button>
              {note && (
                <button type="button" className={ghostBtn} onClick={discard} disabled={busy}>Delete note</button>
              )}
            </div>
          )}
          <SaveNote note={saveNote} testid="earnings-note-status" />
          {window_.key && (
            <p className="mt-2 text-[10.5px] leading-relaxed text-axal-faint" id={`${noteId}-cost`}>
              Draft it asks Eadwyn for a first version from the figures above as summary lines, never the
              records behind them, so no client&rsquo;s name reaches the model. Nothing is saved until you
              save it.{' '}
              {observedRun
                ? `≈ ${formatCost(observedRun.cost)} · your average over ${observedRun.calls} run${observedRun.calls === 1 ? '' : 's'}.`
                : 'No runs of this yet, so there is no average to quote.'}
            </p>
          )}
        </Card>

        <Card padding="md" className="lg:col-span-5" data-testid="earnings-payouts">
          <h3 className="text-[13px] font-extrabold tracking-tight">Payouts</h3>

          <section className="mt-3" aria-labelledby={`${noteId}-setup`}>
            <h4 id={`${noteId}-setup`} className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Payout setup</h4>
            {restLoading ? (
              <div className="mt-1.5"><SourceState kind="loading" source="Payout setup" /></div>
            ) : !restRead.payout ? (
              <div className="mt-1.5">
                <SourceState kind="unreadable" source="Payout setup" onRetry={() => loadRest(window_)} testid="payout-unreadable" />
              </div>
            ) : (
              <>
                <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="payout-state">
                  <Pill tone={acctTone}>{acctLabel}</Pill>
                  <span className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">{acctGate}</span>
                </div>
                {payout?.blocked_reason && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-red-700 dark:text-red-400">{payout.blocked_reason}</p>
                )}
                <p className="mt-1.5 text-[11px] leading-relaxed text-axal-faint">
                  {payout?.started
                    ? (payout?.last_checked_at
                      ? `Last checked against ${payout?.provider}.`
                      : 'Never checked against the provider, so this is the last state recorded rather than the current one.')
                    : 'No payout account has been started.'}{' '}
                  {payout?.settlement === 'none'
                    ? 'Connecting an account does not start any charging — nothing is taken through Axal today.'
                    : `Payments are running in ${payout?.settlement} mode.`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className={payout?.started ? ghostBtn : primaryBtn}
                    onClick={connect} disabled={connecting} data-testid="button-connect-payout">
                    {connecting ? 'Working…' : payout?.started ? 'Continue setup' : 'Connect a payout account'}
                  </button>
                  {payout?.started && (
                    <button type="button" className={ghostBtn} onClick={refreshAccount} disabled={connecting}>
                      Check with the provider
                    </button>
                  )}
                </div>
                <SaveNote note={connectNote} />
              </>
            )}
          </section>

          <section className="mt-4" aria-labelledby={`${noteId}-bal`}>
            <h4 id={`${noteId}-bal`} className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Recorded balance</h4>
            <p className="mt-1.5 text-[12px]">
              <SourceState kind="not_recorded" testid="payout-balance">
                Axal holds no balance on your behalf, so there is none to show
              </SourceState>
            </p>
          </section>

          <section className="mt-4" aria-labelledby={`${noteId}-hist`}>
            <h4 id={`${noteId}-hist`} className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Payout history</h4>
            {restLoading ? (
              <div className="mt-1.5"><SourceState kind="loading" source="Payout information" /></div>
            ) : !restRead.payouts ? (
              <div className="mt-1.5">
                <SourceState kind="unreadable" source="Payout information" onRetry={() => loadRest(window_)} testid="payouts-unreadable" />
              </div>
            ) : payouts.length === 0 ? (
              <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="payouts-none">
                No payouts recorded. Nothing settles through Axal today.
              </p>
            ) : (
              <>
                <dl className="mt-1.5 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="text-axal-faint">Last payout</dt>
                  <dd>{lastPaid ? `${money(lastPaid.amount_cents) ?? 'Amount not recorded'} · paid ${payoutWhen(lastPaid).text ?? 'on a date not recorded'}` : 'None paid yet'}</dd>
                  <dt className="text-axal-faint">Next</dt>
                  <dd>{nextScheduled ? `Scheduled ${payoutWhen(nextScheduled).text ?? '— date not recorded'}` : 'None scheduled'}</dd>
                </dl>
                <ul className="mt-2 grid gap-1.5">
                  {payouts.slice(0, 6).map((p) => {
                    const when = payoutWhen(p);
                    return (
                      <li key={p.uid} data-testid={`payoutrow-${p.uid}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-axal-hairline p-2 dark:border-gray-700">
                        <span className="text-[11px] tabular-nums text-axal-faint">
                          {when.text ?? <Unrecorded>No date</Unrecorded>}{when.kind === 'scheduled' && ' · expected'}
                        </span>
                        <span className="text-[12px] font-bold tabular-nums">{money(p.amount_cents) ?? <Unrecorded />}</span>
                        <Pill tone={PAYOUT_TONE[p.state] || 'neutral'}>{PAYOUT_STATE_LABEL[p.state] || p.state}</Pill>
                        {p.failure_reason && <span className="w-full text-[10.5px] text-red-700 dark:text-red-400">{p.failure_reason}</span>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </Card>
      </div>

      <StatedLimit title="No margin here, only revenue">
        Every figure on this page is an amount you recorded against a session, less the platform fee
        recorded with it. Nothing records what a session cost you to deliver, so &ldquo;Net&rdquo; is
        price less the platform fee and not profit, and the page does not offer a margin it cannot
        compute.
      </StatedLimit>

      {pendingView && (
        <Lightbox label="You have unsaved changes" title="You have unsaved changes" onClose={stay} width={560}
          phone="sheet" testId="earnings-unsaved" initialFocus={stayRef}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" ref={stayRef} className={ghostBtn} onClick={stay} data-testid="unsaved-stay">Stay</button>
              <button type="button" className={ghostBtn} onClick={discardAndSwitch} data-testid="unsaved-discard">Discard</button>
              <button type="button" className={primaryBtn} onClick={saveAndSwitch} disabled={busy} data-testid="unsaved-save">
                {busy ? 'Saving…' : 'Save note'}
              </button>
            </div>
          )}>
          <div className="px-5 py-4">
            <p className="text-[13px] leading-relaxed">
              Your note for <b>{window_.label}</b> hasn&rsquo;t been saved. Switching to {pendingLabel} will
              not carry it over.
            </p>
            <SaveNote note={saveNote && !saveNote.ok ? saveNote : null} />
          </div>
        </Lightbox>
      )}
    </div>
  );
}
