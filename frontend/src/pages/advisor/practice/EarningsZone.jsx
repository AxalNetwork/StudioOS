import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  NothingYet, Pill, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass, money,
} from '../expertise/kit';
import {
  PAYOUT_STATE_LABEL, PAYOUT_TONE, cutNote, noteIsStale, payoutWhen, periodWindow,
} from './earningsLedger';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import useAiSpend from '../../../hooks/useAiSpend';
import { formatCost } from '../../../ui/assistCost';

/**
 * Practice · Earnings — canvas **D4**, `/practice/earnings`, tagged LEDGER.
 *
 * D4 IS NOT IN THE PRACTICE CANVAS. `Advisor Detail · Practice.dc.html` marks
 * PR5 "drawn in full as D4", and D4 lives in
 * `design/canvases/backlog/Detail Layer Canvas II.dc.html`. That file stays in
 * `backlog/` by decision: it is read for intent, not promoted.
 *
 * WHAT THE PAGE IS FOR, in its own words: *"The compressed zone answers 'did I
 * get paid'. The detail page answers the three questions it cannot: which
 * clients actually carry the practice, what the platform took across a
 * quarter, and why last month looks wrong."*
 *
 * EVERY FIGURE IS A SUM OF ROWS AN ADVISOR ENTERED, and every division of one
 * happens in the worker. Nothing here is a forecast, a run-rate or an
 * estimate, and the page performs no money arithmetic: gross, cut and net
 * arrive already reconciling in integer cents, because a rounding choice made
 * in a component is one nobody can audit (`services/advisorMoney.ts`).
 *
 * THE CUT IS RECORDED AND NOTHING IS CHARGED, and the page must say both. The
 * take rate lands in migration 241 as an admin-configurable setting; the
 * advisory Stripe Connect leg is behind a flag that ships off. So every money
 * response carries `settlement`, this page renders what it says, and no
 * surface here may read as a receipt while it says `'none'`. D75.
 *
 * `unpriced_sessions` IS REPORTED, NOT HIDDEN, and it is the one that matters
 * most. A total that quietly ignored the sessions nobody priced would be a
 * smaller number presented as a complete one — the most plausible way a money
 * page lies. It is surfaced per client as well as in the total, so a reader
 * can see WHICH row understates itself.
 *
 * THE BY-STATE TABLE STAYS. D4 does not draw it and the artboard's omission is
 * not an instruction to delete a working feature: billed / collected / written
 * off is the advisor's own bookkeeping over migration 205's columns, and it
 * answers a question the by-client table does not — whether the money arrived.
 *
 * THE AI BAND'S COST IS MEASURED, NEVER MODELLED (D16). D4 draws "≈ $0.0041"
 * before the run; the honest version of that is the caller's own observed
 * average for this task, and an explicit absence before their first run. A
 * modelled number would be a price quoted from a guess.
 */

const ROW = {
  billed: ['Billed', 'warn', 'Priced and owed to you. Nothing has been collected yet.'],
  collected: ['Collected', 'ok', 'You have been paid.'],
  written_off: ['Written off', 'danger', 'You decided not to pursue it.'],
  unpriced: ['Unpriced', 'neutral', 'Sessions with no amount recorded. Not counted in any total above.'],
};

/**
 * D4's three payout states, each with the gate it implies — the artboard's own
 * sentences, and the same three the worker holds in `PAYOUT_GATE`. Drawn as a
 * SET rather than as the current one alone, because the artboard's own
 * sub-label is "All three states · gates charging": an advisor deciding
 * whether to verify needs to see what the other two would mean.
 */
const PAYOUT_STATES = [
  ['verified', 'Verified', 'ok', 'Paid sessions bookable and chargeable.'],
  ['pending', 'Pending', 'warn', 'Bookable, held uncharged until verification clears.'],
  ['blocked', 'Blocked', 'danger', 'Paid slots hidden from your profile. Free intro calls still bookable.'],
];

/**
 * The take rate as a reader sees it, from the basis points the worker sends.
 *
 * DIVIDED HERE AND NOWHERE ELSE, and it is the one piece of money arithmetic
 * this page does — because it is a display conversion, not a calculation: 1500
 * bps IS 15%, exactly, at every value. Every cent figure is computed server
 * side for the opposite reason.
 *
 * An absent rate renders as an absence rather than as 0% — "the platform
 * charges nothing" is a claim, and a missing response field is not evidence
 * for it (D56/D68).
 */
function takeRatePct(rate) {
  const bps = rate?.bps;
  if (bps == null || !Number.isFinite(Number(bps))) return 'a rate that could not be read';
  const pct = Number(bps) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

function Stat({ label, value, note, tone }) {
  return (
    <Card padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">{label}</div>
      <div className={`mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums ${
        tone === 'warn' ? 'text-amber-700 dark:text-amber-400'
          : tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">{note}</div>
    </Card>
  );
}

function Figure({ label, cents, hint, strong = false }) {
  return (
    <Card variant={strong ? 'accent' : 'plain'} padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</div>
      <div className={`mt-1 tabular-nums font-extrabold ${strong ? 'text-[22px]' : 'text-[18px]'}`}>
        {/* A roll-up over zero rows is a real zero — the advisor has recorded
            nothing collected. That is different from Sessions, where a NULL
            price means "not answered"; here the sum is a fact. */}
        {money(cents) ?? <Unrecorded />}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-axal-ink-3">{hint}</p>}
    </Card>
  );
}

export default function EarningsZone() {
  const [view, setView] = useState('this_quarter');
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [ledger, setLedger] = useState({ loading: true, error: '', data: null });
  const [payout, setPayout] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [note, setNote] = useState(null);
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveNote, setSaveNote] = useState(null);
  const [exportNote, setExportNote] = useState(null);

  // The window is derived ONCE per view change and reused by the ledger read,
  // the note key and the chip label, so the three cannot name different
  // quarters. `earningsLedger.js`'s header says which half is a calendar
  // label and which is a UTC instant.
  // EVERY CHIP KEY IS NAMED HERE, in the page that mounts the chip row —
  // `'this_quarter'`, `'last_quarter'`, `'ytd'`, `'all'`. A key resolved one
  // import away lets a chip be declared live over a page that cannot serve
  // it; `profile_zone_filters.test.mjs` enforces the rule, and it caught this
  // page passing `view` straight through to `periodWindow` without ever
  // mentioning two of the four. PR4b's Sessions had the identical fault on
  // its first draft, reading its window from `VIEW_DAYS[forView]`.
  const window_ = useMemo(() => {
    const now = new Date();
    if (view === 'last_quarter') return periodWindow('last_quarter', now);
    if (view === 'ytd') return periodWindow('ytd', now);
    if (view === 'all') return periodWindow('all', now);
    return periodWindow('this_quarter', now);
  }, [view]);

  // EACH CHIP KEY IS NAMED HERE, in the page that mounts the chip row. A key
  // resolved one import away lets a chip be declared live over a page that
  // cannot serve it, and `profile_zone_filters.test.mjs` enforces the rule —
  // it caught exactly that on PR4b's first draft.
  //
  // The two quarter chips are a DYNAMIC group because their labels are not
  // fixed: D4's fixture reads "Q3 2026 · Q2 2026", which are the right two
  // chips and the wrong two literals — hard-coded, the page names one quarter
  // for ever. The other two are static because "Year to date" and "All time"
  // are true whatever the date.
  const quarterChips = useMemo(() => ([
    { key: 'this_quarter', label: periodWindow('this_quarter', new Date()).label },
    { key: 'last_quarter', label: periodWindow('last_quarter', new Date()).label },
  ]), []);

  const { spend } = useAiSpend({ enabled: true });

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const data = await api.getMyAdvisorEarnings();
      setState({ loading: false, error: '', data });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your earnings could not be read.', data: null });
    }
  }, []);

  const loadLedger = useCallback(async (w) => {
    setLedger((c) => ({ ...c, loading: true, error: '' }));
    try {
      const data = await api.getMyAdvisorLedger({ from: w.from, until: w.until });
      setLedger({ loading: false, error: '', data });
    } catch (e) {
      setLedger({ loading: false, error: e?.message || 'This window could not be read.', data: null });
    }
  }, []);

  const loadRest = useCallback(async (w) => {
    // TOLERATED, NOT REQUIRED. The ledger is the page; the payout cards beside
    // it are configuration and history. A reader whose payout account fails to
    // load should still see what they earned, and each card says its own
    // absence rather than taking the page down.
    const [acct, hist, n] = await Promise.all([
      api.getMyAdvisorPayoutAccount().catch(() => null),
      api.listMyAdvisorPayouts().catch(() => null),
      api.getMyAdvisorPeriodNote(w.key).catch(() => null),
    ]);
    setPayout(acct);
    setPayouts(Array.isArray(hist?.items) ? hist.items : []);
    setNote(n?.note || null);
    setDraft(n?.note?.body || '');
    setEditing(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLedger(window_); loadRest(window_); }, [loadLedger, loadRest, window_]);

  const d = state.data;
  const L = ledger.data;
  const totals = L?.totals;

  const nothingRecorded = d
    && !d.billed_cents && !d.collected_cents && !d.written_off_cents && !d.unpriced_count;

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
    // Built from rows already on screen, so nothing leaves the browser and no
    // endpoint is needed. An UNPRICED session exports as an empty cell, never
    // as 0 — the CSV must not assert a price the advisor never set.
    const rows = L?.clients || [];
    const cell = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
    const cents = (v) => (v == null ? '' : (Number(v) / 100).toFixed(2));
    const lines = [
      ['Client', 'Sessions', 'Unpriced sessions', 'Retainer', 'Gross', 'Platform cut', 'You receive'].join(','),
      ...rows.map((r) => [
        cell(r.client_name), r.sessions, r.unpriced_sessions,
        cents(r.retainer_cents), cents(r.gross_cents), cents(r.cut_cents), cents(r.net_cents),
      ].join(',')),
      ['Total', totals?.sessions ?? '', totals?.unpriced_sessions ?? '', '',
        cents(totals?.gross_cents), cents(totals?.cut_cents), cents(totals?.net_cents)].join(','),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `axal-earnings-${window_.key}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [L, totals, window_]);

  const downloadTaxSummary = useCallback(async () => {
    setExportNote(null);
    try {
      // FETCHED, NOT DERIVED FROM THE TABLE ON SCREEN. A tax year and the
      // reader's chosen window are different spans, and computing one from
      // the other is how a summary comes to cover the wrong months.
      const year = Number(window_.key.slice(0, 4)) || new Date().getFullYear();
      const s = await api.getMyAdvisorTaxSummary(year);
      const cents = (v) => (v == null ? '' : (Number(v) / 100).toFixed(2));
      const lines = [
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
        // THE DISCLAIMER TRAVELS WITH THE FILE. It is in the payload for
        // exactly this reason: a number exported without it is a number
        // somebody may take for a tax document.
        ['Basis', `"${s.basis}"`].join(','),
        ['Note', `"${String(s.document?.note || '').replace(/"/g, '""')}"`].join(','),
      ];
      const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
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
    exportCsv: { onClick: exportCsv, disabled: !(L?.clients || []).length,
      title: !(L?.clients || []).length ? 'nothing in this window to export' : undefined },
    taxSummary: { onClick: downloadTaxSummary },
  };

  // ── The AI band ──────────────────────────────────────────────────────────

  const narrate = useCallback(async () => {
    setDrafting(true); setSaveNote(null);
    try {
      // COVERAGE LINES, NOT ROWS. The same rule the rail follows: these are
      // the page's own summary of itself, they carry no personal data, and
      // sending the records behind them would put a client's name in a prompt
      // to satisfy a feature nobody asked for that of. The top client is named
      // only as a share, never with their figures.
      const coverage = [
        `${window_.label} gross ${money(totals?.gross_cents) ?? 'not recorded'}`,
        `platform cut ${money(totals?.cut_cents) ?? 'not recorded'} at ${takeRatePct(L?.take_rate)}`,
        `you received ${money(totals?.net_cents) ?? 'not recorded'}`,
        `${totals?.priced_sessions ?? 0} priced sessions, ${totals?.unpriced_sessions ?? 0} with no price recorded`,
        L?.concentration
          ? `top client is ${L.concentration.pct}% of gross`
          : 'no concentration figure — nothing priced in this window',
        `${(L?.clients || []).length} clients in the table`,
      ];
      const res = await api.aiWorkspaceExplain({ workspace: 'Practice', zone: 'Earnings', coverage });
      const text = String(res?.text || res?.answer || '').trim();
      if (!text) throw new Error('The model returned nothing to read.');
      setDraft(text); setEditing(true);
    } catch (e) {
      setSaveNote({ ok: false, text: e?.message || 'Nothing was drafted.' });
    } finally { setDrafting(false); }
  }, [L, totals, window_]);

  const accept = useCallback(async () => {
    setBusy(true); setSaveNote(null);
    try {
      const res = await api.saveMyAdvisorPeriodNote(window_.key, {
        body: draft,
        // 'edited' when the advisor changed a draft, 'ai' when they accepted
        // it as written. Over-crediting the model and hiding it are both
        // wrong, so the distinction is stored (migration 242).
        source: note?.source === 'ai' || drafting ? 'ai' : 'edited',
        figures: totals ? {
          gross_cents: totals.gross_cents, cut_cents: totals.cut_cents, net_cents: totals.net_cents,
        } : null,
      });
      setNote(res.note); setEditing(false);
      setSaveNote({ ok: true, text: `Filed against ${window_.label}.` });
    } catch (e) {
      setSaveNote({ ok: false, text: e?.message || 'That note was not filed.' });
    } finally { setBusy(false); }
  }, [draft, note, drafting, totals, window_]);

  const discard = useCallback(async () => {
    setBusy(true); setSaveNote(null);
    try {
      await api.deleteMyAdvisorPeriodNote(window_.key);
      setNote(null); setDraft(''); setEditing(false);
      setSaveNote({ ok: true, text: 'Discarded.' });
    } catch (e) {
      setSaveNote({ ok: false, text: e?.message || 'Nothing was discarded.' });
    } finally { setBusy(false); }
  }, [window_]);

  const empty = (
    <NothingYet
      title="Nothing recorded yet"
      body="Once you price a session under Sessions, it appears here. This page only ever sums amounts you entered yourself."
      action={<Link to="/practice/sessions" className="text-[12px] text-emerald-700 underline">Price your sessions →</Link>}
    />
  );

  const currentState = payout?.state || 'pending';

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="What the practice has earned"
        blurb="Revenue by client and by type, the platform rate recorded against each priced session, and the payout account state that decides whether any of it could be charged."
        action={d?.unpriced_count > 0 ? <Pill tone="warn">{d.unpriced_count} unpriced</Pill> : null}
      />

      <ZoneToolbar
        role="advisor"
        filters={advisorZoneFilters('practice/earnings', {
          value: view,
          onChange: setView,
          dynamic: { quarters: quarterChips },
        })}
        actions={advisorZoneActions('practice/earnings', { handlers: opsHandlers })}
      />

      <SaveNote note={exportNote} />

      <ZoneBody loading={ledger.loading} error={ledger.error} onRetry={() => loadLedger(window_)}
        isEmpty={!ledger.loading && !ledger.error && !(L?.clients || []).length}
        empty={empty}>
        {L && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={`${window_.label} gross`}
                value={money(totals?.gross_cents) ?? <Unrecorded />}
                note="sessions and retainers you priced" />
              <Stat label="Platform rate" tone="warn"
                value={money(totals?.cut_cents) ?? <Unrecorded />}
                note={`${takeRatePct(L.take_rate)} of gross, recorded per line`} />
              <Stat label="You received" tone="ok"
                value={money(totals?.net_cents) ?? <Unrecorded />}
                note={`across ${(L.clients || []).length} client${(L.clients || []).length === 1 ? '' : 's'}`} />
              {/* A SHARE OF NOTHING IS NOT NOUGHT PER CENT. 0% reads as "well
                  spread", which is the opposite of what an empty window
                  means, so the worker answers null and the tile says so. */}
              <Stat label="Concentration"
                value={L.concentration ? `${L.concentration.pct}%` : <Unrecorded>Not recorded</Unrecorded>}
                note={L.concentration
                  ? `${L.concentration.client_name || 'one client'} alone`
                  : 'nothing priced in this window to concentrate'} />
            </div>

            <Card padding="md" className="mt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-extrabold tracking-tight">By client · {window_.label}</h3>
                <span className="text-[10.5px] text-axal-ink-3">
                  Only here · the compressed zone shows one month, unsplit
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-[12px]">
                  <thead>
                    <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                      {['Client', 'Sessions', 'Retainer', 'Gross', 'Cut', 'You receive'].map((h, i) => (
                        <th key={h} className={`px-2 py-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3 ${i ? 'text-right' : ''}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(L.clients || []).map((r) => (
                      <tr key={r.client_user_id ?? r.client_name ?? 'none'}
                        data-testid={`ledger-d4-${r.client_user_id ?? 'x'}`}
                        className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                        <td className="px-2 py-2.5">
                          <div className="font-bold">
                            {r.client_name || <Unrecorded>Client not recorded</Unrecorded>}
                          </div>
                          {r.unpriced_sessions > 0 && (
                            <div className="mt-0.5 text-[10.5px] text-amber-700 dark:text-amber-400">
                              {r.unpriced_sessions} session{r.unpriced_sessions === 1 ? '' : 's'} with no price —
                              this row understates them
                            </div>
                          )}
                          {r.engagement_shape === 'equity' && (
                            <div className="mt-0.5 text-[10.5px] text-axal-ink-3">
                              Paid in equity — real compensation a cash ledger cannot hold
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{r.sessions}</td>
                        {/* NULL IS AN ABSENCE, NOT A ZERO. An engagement with
                            no retainer recorded has not agreed a retainer of
                            nothing (migration 238). */}
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {money(r.retainer_cents) ?? <Unrecorded>—</Unrecorded>}
                        </td>
                        <td className="px-2 py-2.5 text-right font-bold tabular-nums">{money(r.gross_cents)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                          {r.cut_cents ? `−${money(r.cut_cents)}` : money(r.cut_cents)}
                        </td>
                        <td className="px-2 py-2.5 text-right font-bold tabular-nums">{money(r.net_cents)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-axal-hairline dark:border-gray-700" data-testid="ledger-d4-total">
                      <td className="px-2 py-2.5 text-[12.5px] font-extrabold">{window_.label} total</td>
                      <td className="px-2 py-2.5 text-right font-extrabold tabular-nums">{totals?.sessions}</td>
                      <td className="px-2 py-2.5" />
                      <td className="px-2 py-2.5 text-right font-extrabold tabular-nums">{money(totals?.gross_cents)}</td>
                      <td className="px-2 py-2.5 text-right font-extrabold tabular-nums text-amber-700 dark:text-amber-400">
                        {totals?.cut_cents ? `−${money(totals.cut_cents)}` : money(totals?.cut_cents)}
                      </td>
                      <td className="px-2 py-2.5 text-right font-extrabold tabular-nums">{money(totals?.net_cents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
                {cutNote({
                  cutLabel: money(totals?.cut_cents),
                  concentration: L.concentration,
                  equityClients: L.equity_clients || 0,
                })}
              </p>
              {totals?.unpriced_sessions > 0 && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-300">
                  {totals.unpriced_sessions} session{totals.unpriced_sessions === 1 ? '' : 's'} in this
                  window carr{totals.unpriced_sessions === 1 ? 'ies' : 'y'} no amount. They are in none
                  of the figures above, and this line exists so that absence is visible rather than
                  silently shrinking the numbers.{' '}
                  <Link to="/practice/sessions" className="text-emerald-700 underline">Price them →</Link>
                </p>
              )}
            </Card>
          </>
        )}
      </ZoneBody>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card padding="md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-extrabold tracking-tight">Payout account</h3>
            <span className="text-[10.5px] text-axal-ink-3">All three states · gates charging</span>
          </div>
          <div className="mt-3 grid gap-2">
            {PAYOUT_STATES.map(([key, label, tone, gate]) => (
              <div key={key} data-testid={`payout-d4-${key}`}
                className={`rounded-[10px] border p-3 ${
                  key === currentState
                    ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                    : 'border-axal-hairline dark:border-gray-700'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Pill tone={tone}>{label}</Pill>
                  {key === currentState && <Pill tone="ok">Yours</Pill>}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">{gate}</p>
              </div>
            ))}
          </div>
          {payout?.blocked_reason && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-700 dark:text-red-400">
              {payout?.blocked_reason}
            </p>
          )}
          {/* NOT YET ASKED IS NOT REFUSED, and the two look identical in the
              card above. `last_checked_at` is what separates them. */}
          <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">
            {payout == null
              ? 'Your payout account could not be read, so the state above is not yours — reload to try again.'
              : payout?.started
                ? (payout?.last_checked_at
                  ? `Last checked against ${payout?.provider}.`
                  : 'Never checked against the provider, so this is the last state recorded rather than the current one.')
                : 'No payout account has been started. Nothing is charged through Axal today either way.'}
          </p>
        </Card>

        <Card padding="md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-extrabold tracking-tight">Payout history</h3>
            <span className="text-[10.5px] text-axal-ink-3">Audit trail · only here</span>
          </div>
          {payouts.length === 0 ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
              No payout has been recorded. Nothing settles through Axal today, so this is the honest
              state rather than an empty list waiting to fill.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {payouts.map((p) => {
                const when = payoutWhen(p);
                return (
                  <li key={p.uid} data-testid={`payoutrow-d4-${p.uid}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-axal-hairline p-2.5 dark:border-gray-700">
                    <span className="text-[11px] tabular-nums text-axal-ink-3">
                      {when.text ?? <Unrecorded>No date</Unrecorded>}
                      {when.kind === 'scheduled' && ' · expected'}
                    </span>
                    <span className="text-[12px] font-bold tabular-nums">{money(p.amount_cents)}</span>
                    <Pill tone={PAYOUT_TONE[p.state] || 'neutral'}>
                      {PAYOUT_STATE_LABEL[p.state] || p.state}
                    </Pill>
                    {p.failure_reason && (
                      <span className="w-full text-[10.5px] text-red-700 dark:text-red-400">{p.failure_reason}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* ── The AI band ───────────────────────────────────────────────
              D4 draws it here, inside this card, and its contract is the D1
              one: the cost is shown BEFORE it runs, and Accept / Edit /
              Discard are all real. */}
          <div className="mt-3 rounded-[11px] border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20"
            data-testid="aiband-d4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="ok">Proposal · {window_.label} narrated</Pill>
              <span className="ml-auto text-[10.5px] tabular-nums text-emerald-800 dark:text-emerald-300">
                {observedRun
                  ? `≈ ${formatCost(observedRun.cost)} · your average over ${observedRun.calls} run${observedRun.calls === 1 ? '' : 's'}`
                  : 'No runs of this yet, so there is no average to quote'}
              </span>
            </div>
            {note && !editing ? (
              <>
                <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed">{note?.body}</p>
                <p className="mt-1.5 text-[10.5px] text-axal-ink-3">
                  {note?.source === 'ai' ? 'Drafted by Eadwyn, accepted as written.'
                    : note?.source === 'edited' ? 'Drafted by Eadwyn, edited by you.'
                      : 'Written by you.'}
                  {/* WHETHER IT STILL DESCRIBES THE TABLE. Migration 242
                      stamps the figures the note was written against so the
                      page can say, rather than showing two numbers and no
                      reason. `null` is "no stamped figures", which is not
                      "still current" — so nothing is claimed. */}
                  {stale === true && ' The figures have moved since this was written.'}
                  {stale === false && ' Still matches the figures above.'}
                </p>
              </>
            ) : (
              <textarea
                className={`${inputClass} mt-2 min-h-[96px] w-full`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Draft a short read of this window, or write your own."
                data-testid="input-aiband-d4" />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={ghostButtonClass} onClick={narrate} disabled={drafting || busy}>
                {drafting ? 'Drafting…' : note ? 'Draft again' : 'Draft it'}
              </button>
              {(editing || !note) && (
                <button type="button" className={buttonClass} onClick={accept}
                  disabled={busy || !draft.trim()}>
                  {busy ? 'Filing…' : 'Accept'}
                </button>
              )}
              {note && !editing && (
                <button type="button" className={ghostButtonClass} onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {(note || draft) && (
                <button type="button" className={ghostButtonClass} onClick={discard} disabled={busy}>
                  Discard
                </button>
              )}
            </div>
            <SaveNote note={saveNote} />
            <p className="mt-2 text-[10.5px] leading-relaxed text-axal-ink-3">
              The draft is written from the figures above as summary lines — counts and totals this
              page already shows — and never from the rows behind them, so no client's name reaches
              the model.
            </p>
          </div>
        </Card>
      </div>

      {/* ── What happened to the money, the advisor's own record ───────────
          D4 does not draw this and the omission is not an instruction to
          delete it: billed / collected / written off is migration 205's own
          bookkeeping, it has exactly one writer in the product, and it answers
          a question the by-client table above does not — whether the money
          arrived. */}
      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={Boolean(nothingRecorded)} empty={empty}>
        {d && (
          <Card padding="md">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-extrabold tracking-tight">Whether it arrived</h3>
              <span className="text-[10.5px] text-axal-ink-3">Your own bookkeeping · all time</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Figure strong label="Collected" cents={d.collected_cents}
                hint="Money you have actually been paid." />
              <Figure label="Outstanding" cents={d.outstanding_cents}
                hint="Priced and billed, not yet collected." />
              <Figure label="Written off" cents={d.written_off_cents}
                hint="Priced, then decided against pursuing." />
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                    <th className="px-2 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">State</th>
                    <th className="px-2 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Sessions</th>
                    <th className="px-2 py-2 text-right text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.by_state || []).map((row) => {
                    const [label, tone, hint] = ROW[row.state] || [row.state, 'neutral', ''];
                    return (
                      <tr key={row.state} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                        <td className="px-2 py-2.5">
                          <Pill tone={tone}>{label}</Pill>
                          <div className="mt-1 text-[11px] text-axal-ink-3">{hint}</div>
                        </td>
                        <td className="px-2 py-2.5 tabular-nums">{row.bookings}</td>
                        <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                          {/* An unpriced row's total is meaningless by
                              definition — the sessions in it have no amount. */}
                          {row.state === 'unpriced' ? <Unrecorded>—</Unrecorded> : money(row.total_cents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* RENDERED FROM THE RESPONSE, NOT WRITTEN ONCE. The clause this
                replaces denied the platform cut outright, which migration 241
                made false: a take rate is recorded and stamped on every line
                as it is priced. What is still true is that no money has moved
                under it, and `settlement` is what says so — so the page states
                the rate AND the absence of any charge, and stops claiming
                either one on its own.

                The denial is not quoted here on purpose: the guard in
                `advisor_bucket_overview.test.mjs` bans that exact phrase, and
                `codeOnly` spares an INDENTED block comment by design — a `/*`
                inside a className must not be allowed to open one. A comment
                explaining a ban must therefore not reproduce the banned
                string. D75. */}
            <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">
              Amounts are in {d.currency || 'USD'} and are your own record. Axal does not invoice
              your clients and holds no money on your behalf.{' '}
              {d.settlement === 'none' ? (
                <>
                  A platform rate of {takeRatePct(d.take_rate)} is recorded against each priced
                  session, and <strong>nothing has been charged under it</strong> — no payment is
                  taken through Axal today, so the figures above are what you recorded, not what
                  was collected.
                </>
              ) : (
                <>
                  Payments are running in <strong>{d.settlement}</strong> mode and a platform rate
                  of {takeRatePct(d.take_rate)} applies to each priced session.
                </>
              )}
            </p>
          </Card>
        )}
      </ZoneBody>

      {/* Stated rather than left as an absence a reader has to notice: the
          per-client shares this page computes are of GROSS, and D4 draws no
          margin, no cost base and no time-per-client, because nothing records
          any of the three. */}
      <StatedLimit title="No margin here, only revenue">
        Every figure on this page is an amount you recorded against a session, divided by the
        recorded platform rate. Nothing records what a session cost you to deliver — preparation,
        travel, the hours behind a retainer — so "You receive" is revenue less the platform rate
        and not profit, and the page does not offer a margin it cannot compute.
      </StatedLimit>
    </div>
  );
}
