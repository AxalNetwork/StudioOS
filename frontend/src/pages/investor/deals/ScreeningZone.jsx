import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { dealViewsApi } from '../../../lib/api/dealViews.js';
import { reportError } from '../../../lib/log';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';
import { SearchInput } from '../../advisor/network/kit';
import { PASS_TAXONOMY, passReasonRevisit } from '../../../lib/dealFlow';
import { DealStrip, StripKey, useScopeStrips } from '../../../components/scoring/scorecard/Scorecard';
import { SCOPES, stripOf } from '../../../components/scoring/scorecard/scorecardModel';
import { PassDialog } from '../dealflow/StageDialogs';
import { fitCell } from '../dealflow/flowModel';
import { confidenceCell, decisionOf, flowStateOf, screeningSummary } from './screeningModel';

/**
 * Deals · Screening — `/deals/screening`, drawn to board **DE06** (canvas
 * section DX6 of `design/incoming/Deals v2 Page.dc.html`, D4815 / #5909).
 * It began as canvas ID2; D1260 (#3283, owner question 8 A) made it read the
 * venture scorecard and nothing else that scores.
 *
 * A DECISION TABLE FIRST, THE FUND'S MEMORY SECOND. The page leads with four
 * figures (Deals to screen, Scorecards ready, Low-confidence scorecards,
 * Stale screens) and one row per venture: Venture, Scorecard, Fit, Material
 * risks, Confidence, Last change and Your decision, with Move to diligence
 * and Pass. Pass reasons is a secondary view, behind a disclosure under the
 * table (or the Pass reasons chip); the taxonomy never leads the page.
 *
 * WHAT EACH COLUMN READS (no Worker change in #5909):
 *   · the deals: `GET /api/deals/screening` (no score in it);
 *   · Scorecard and Confidence: `POST /api/venture-scores/batch`, each
 *     scope's band and confidence word. Confidence is the count of scored
 *     scopes per word, never one word for a scorecard that has no total;
 *   · Fit: `GET /api/deals/fit` (D1239), the investor's own thesis;
 *   · Your decision: `GET /api/deals/flow` (D1238). Move to diligence moves
 *     the deal in your deal flow; Pass opens the deal flow's reason dialog
 *     (`PassDialog`), so Passed is reached only with a reason;
 *   · Pass reasons: `GET /api/deals/pass-analytics`, the studio's passes;
 *   · Material risks, Last change and Stale screens: no read carries them,
 *     so each says Not recorded (named in D4815).
 *
 * EACH READ FAILS ALONE. A failed read costs its own column or figure, which
 * says Unreadable; it never prints 0, and an unreadable flow offers Try
 * again, never Pass.
 */

const UNAVAILABLE = Symbol('unavailable');
const LINK = 'text-[10.5px] font-semibold text-axal-violet-deep underline underline-offset-2 hover:text-axal-violet dark:text-violet-300';
const MUTED = 'text-[11.5px] text-gray-600 dark:text-gray-400';
// 44px targets on a phone, as the deal rooms (D4815 slice 2); compact from md up.
const BTN = 'inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-[8px] px-2.5 text-[11.5px] font-semibold disabled:opacity-50 md:min-h-[30px]';
const BTN_PRIMARY = `${BTN} bg-axal-violet-deep text-white hover:bg-axal-violet dark:bg-violet-600 dark:hover:bg-violet-500`;
const BTN_GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

const TILE_WORD = { loading: 'Reading…', unreadable: 'Unreadable' };

/** One summary figure: its value, or the word for why there is none. Never a 0 for a read that did not answer. */
function ScreenTile({ label, value, state = 'ready', note, testid }) {
  return (
    <div className="flex flex-col gap-1 bg-white p-3 dark:bg-gray-900" data-testid={testid}>
      <Eyebrow>{label}</Eyebrow>
      <div>
        {value === null
          ? (state === 'not_recorded' ? <NotRecorded /> : <span className="text-[12.5px] font-semibold text-gray-600 dark:text-gray-400" data-testid={`${testid}-state`}>{TILE_WORD[state] || 'Unreadable'}</span>)
          : <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>}
      </div>
      <div className="text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/** The Fit cell: the investor's thesis fit, or why there is none. */
function fitOfRead(fits, dealId) {
  if (fits === null) return { kind: 'loading', word: 'Reading…' };
  if (fits?.refused) return { kind: 'refused', word: 'Not available', title: fits.refused };
  if (fits === UNAVAILABLE) return fitCell('failed');
  return fitCell(fits.get(String(dealId)) || { state: 'unavailable' });
}

function Decision({ row, decision, busy, error, onMove, onPass, onRetry }) {
  if (decision.kind === 'open') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => onMove(row)} data-testid={`screening-move-${row.deal_id}`}>
            {busy ? 'Moving…' : 'Move to diligence'}
          </button>
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => onPass(row)} data-testid={`screening-pass-${row.deal_id}`}>
            Pass…
          </button>
        </div>
        {error && <p className="m-0 text-[11px] text-red-700 dark:text-red-300" role="alert" data-testid={`screening-refused-${row.deal_id}`}>{error}</p>}
      </div>
    );
  }
  if (decision.kind === 'unreadable') {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-testid={`screening-decision-unread-${row.deal_id}`}>
        <span className={MUTED}>Unreadable</span>
        <button type="button" className={BTN_GHOST} onClick={onRetry}>Try again</button>
      </span>
    );
  }
  return <span className={decision.kind === 'not_investor' ? MUTED : 'text-[12px] font-semibold text-axal-ink dark:text-gray-100'} data-testid={`screening-decision-${row.deal_id}`}>{decision.text}</span>;
}

export default function InvestorScreeningZone() {
  const [desk, setDesk] = useState(null);
  const [passes, setPasses] = useState(null);
  const [flowRead, setFlowRead] = useState({ status: 'loading' });
  const [view, setView] = useState('scorecards');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [refusals, setRefusals] = useState({});
  const [result, setResult] = useState('');

  const loadFlow = useCallback(() => {
    setFlowRead({ status: 'loading' });
    dealFlowApi.flow().then(
      (data) => setFlowRead({ status: 'ready', data }),
      (e) => { if (e?.status !== 403) reportError('Screening:flow', e); setFlowRead({ status: 'error', error: { status: e?.status ?? null } }); },
    );
  }, []);
  const load = useCallback(() => {
    setDesk(null);
    setPasses(null);
    api.dealScreening().then(setDesk, () => setDesk(UNAVAILABLE));
    api.dealPassAnalytics().then(setPasses, () => setPasses(UNAVAILABLE));
    loadFlow();
  }, [loadFlow]);
  useEffect(() => { load(); }, [load]);

  const deskReady = desk && desk !== UNAVAILABLE;
  const passesReady = passes && passes !== UNAVAILABLE;
  const deals = deskReady ? desk.desk : null;
  const dealRows = useMemo(() => (deals?.available ? deals.rows : []), [deals]);
  const ids = useMemo(() => dealRows.map((r) => r.deal_id), [dealRows]);
  const strips = useScopeStrips(dealRows.map((r) => r.deal_id));
  const flow = useMemo(() => flowStateOf(flowRead), [flowRead]);

  // Fit, the investor's own thesis (D1239): 50 deals a call, as Deal flow reads it.
  const [fits, setFits] = useState(null);
  const idKey = ids.join(',');
  useEffect(() => {
    let alive = true;
    setFits(null);
    if (!ids.length) { setFits(new Map()); return undefined; }
    const parts = [];
    for (let i = 0; i < ids.length; i += 50) parts.push(ids.slice(i, i + 50));
    Promise.all(parts.map((c) => dealViewsApi.fit(c)))
      .then((outs) => { if (alive) setFits(new Map(outs.flatMap((o) => o?.items || []).map((f) => [String(f.deal_id), f]))); })
      .catch((e) => {
        if (!alive) return;
        if (e?.status === 403) { setFits({ refused: e?.message || 'Fit is the investor’s own thesis.' }); return; }
        reportError('Screening:fit', e);
        setFits(UNAVAILABLE);
      });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  /** How many deals have a scorecard open to this reader with at least one scored scope. */
  const scoredCount = useMemo(() => {
    if (strips.status !== 'ready') return null;
    return dealRows.filter((r) => {
      const s = stripOf(strips.items.get(Number(r.deal_id)));
      return s.state === 'open' && s.scopes.some((x) => x.state === 'scored');
    }).length;
  }, [strips, dealRows]);
  const summary = useMemo(() => screeningSummary({ deals, strips, flow }), [deals, strips, flow]);

  const revisitable = useMemo(() => PASS_TAXONOMY.filter((r) => r.revisit), []);

  /** The decision table always leads; search narrows its rows. Pass reasons is the secondary view under it. */
  const rows = dealRows;
  const passesOpen = view === 'passes';
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.company || '').toLowerCase().includes(q));
  }, [rows, query]);

  const rowActions = investorZoneActions('deals/screening', {
    view: {
      header: ['Company', 'Sector', 'Deal status'],
      rows: dealRows,
      cells: (r) => [r.company || `Deal #${r.deal_id}`, r.sector || '', r.deal_status || ''],
    },
  });

  /** One flow row back from the Worker replaces this deal's entry. */
  const keep = (next) => setFlowRead((cur) => {
    if (cur.status !== 'ready' || !next) return cur;
    const items = (cur.data?.items || []).filter((f) => Number(f.deal_id) !== Number(next.deal_id));
    return { status: 'ready', data: { ...cur.data, items: [next, ...items] } };
  });
  const nameOf = (r) => r.company || `Deal #${r.deal_id}`;
  const moveToDiligence = async (r) => {
    const d = decisionOf(flow, r.deal_id);
    if (d.kind !== 'open') return;
    setBusyId(r.deal_id);
    setRefusals((x) => ({ ...x, [r.deal_id]: '' }));
    try {
      const next = d.entry
        ? await dealFlowApi.update(r.deal_id, { stage: 'diligence' })
        : await dealFlowApi.add({ deal_id: r.deal_id, stage: 'diligence' });
      keep(next);
      setResult(`Moved ${nameOf(r)} to Diligence in your deal flow.`);
    } catch (e) {
      reportError('Screening:move', e);
      setRefusals((x) => ({ ...x, [r.deal_id]: e?.message || `${nameOf(r)} could not be moved. Nothing changed.` }));
    } finally {
      setBusyId(null);
    }
  };

  const anyRead = deskReady || passesReady;
  const bothFailed = desk === UNAVAILABLE && passes === UNAVAILABLE;

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="investor"
        filters={investorZoneFilters('deals/screening', {
          value: view,
          onChange: setView,
          counts: { scorecards: dealRows.length },
        })}
        actions={rowActions}
      />
      <div className="mb-3 flex" data-testid="screening-search">
        <SearchInput value={query} onChange={setQuery} placeholder="Search company" />
      </div>
      <ZoneBody
        loading={desk === null && passes === null}
        error={bothFailed ? 'Neither the deals nor the pass record could be read.' : ''}
        onRetry={load}
        isEmpty={Boolean(anyRead) && dealRows.length === 0 && (!passesReady || passes.total === 0)}
        empty={(
          <NothingYet
            title="Nothing to screen yet"
            body={
              'A deal appears here once you can read it, with its venture scorecard, and a pass appears once '
              + 'one has been recorded with its reason. Both reads are readable and empty, which is a different '
              + 'fact from a desk that could not be read.'
            }
          />
        )}
      >
        <div className="space-y-4">
          {result && <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" role="status" data-testid="screening-result">{result}</p>}

          {/* ══ THE DE06 SUMMARY ════════════════════════════════════════════ */}
          <div
            className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-axal-hairline bg-axal-hairline md:grid-cols-4 dark:border-gray-800 dark:bg-gray-800"
            data-testid="screening-strip"
          >
            <ScreenTile
              testid="screening-to-screen"
              label="Deals to screen"
              value={summary.toScreen.value}
              state={summary.toScreen.state}
              note={deals && !deals.available ? (deals.reason || 'the deals could not be read') : 'deals you can read with no decision of yours yet'}
            />
            <ScreenTile
              testid="screening-ready"
              label="Scorecards ready"
              value={scoredCount === null ? null : String(scoredCount)}
              state={summary.ready.state}
              note={`open to you, with a scope scored · ${SCOPES.length} scopes, never one total`}
            />
            <ScreenTile
              testid="screening-low"
              label="Low-confidence scorecards"
              value={summary.low.value}
              state={summary.low.state}
              note="ready, and every scored scope reads Low confidence"
            />
            <ScreenTile
              testid="screening-stale"
              label="Stale screens"
              value={summary.stale.value}
              state={summary.stale.state}
              note="no read records when a screen last changed"
            />
          </div>

          {/* ══ THE DECISION TABLE ══════════════════════════════════════════ */}
          {deals && !deals.available ? (
            <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="screening-deals-unreadable">
              <NotRecorded /> — the deals could not be read. That is not a claim that there are none.
            </p>
          ) : (
            <section className="overflow-hidden rounded-[12px] border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="screening-scorecards">
              {/* Sideways on a phone, as the sibling zones' instruments are. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-axal-hairline dark:border-gray-800">
                      {['Venture', 'Scorecard', 'Fit', 'Material risks', 'Confidence', 'Last change', 'Your decision'].map((hd) => (
                        <th key={hd} scope="col" className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">{hd}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const fit = fitOfRead(fits, r.deal_id);
                      const conf = confidenceCell(strips, r.deal_id);
                      const decision = decisionOf(flow, r.deal_id);
                      return (
                        <tr key={r.deal_id} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800" data-testid="screening-row">
                          <td className="px-3 py-2.5">
                            <Link to={`/deals/${r.deal_id}`} className="font-bold text-axal-ink hover:underline dark:text-gray-100">{nameOf(r)}</Link>
                            <div className={MUTED}>{[r.sector, r.deal_status ? String(r.deal_status).replaceAll('_', ' ') : null].filter(Boolean).join(' · ') || <NotRecorded />}</div>
                          </td>
                          <td className="w-[150px] px-3 py-2.5">
                            <div className="flex flex-col gap-1">
                              <DealStrip read={strips} dealId={r.deal_id} />
                              <Link to={`/deals/${r.deal_id}/scorecard`} className={LINK}>Scorecard</Link>
                            </div>
                          </td>
                          <td className="px-3 py-2.5" title={fit.title || undefined} data-testid={`screening-fit-${r.deal_id}`}>
                            {fit.kind === 'scored' ? `${fit.word}${fit.confidence ? ` · ${fit.confidence}` : ''}` : <span className={MUTED}>{fit.word}</span>}
                          </td>
                          <td className="px-3 py-2.5"><NotRecorded /></td>
                          <td className="px-3 py-2.5" data-testid={`screening-confidence-${r.deal_id}`}>
                            {conf.kind === 'scored' ? conf.text : <span className={MUTED}>{conf.text}</span>}
                          </td>
                          <td className="px-3 py-2.5"><NotRecorded /></td>
                          <td className="px-3 py-2.5">
                            <Decision
                              row={r}
                              decision={decision}
                              busy={busyId === r.deal_id}
                              error={refusals[r.deal_id]}
                              onMove={moveToDiligence}
                              onPass={(row) => { setResult(''); setDialog(row); }}
                              onRetry={loadFlow}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="m-0 border-t border-axal-hairline px-3 py-2.5 text-[11px] leading-relaxed text-gray-600 dark:border-gray-800 dark:text-gray-400">
                A scorecard closed to you, or one its founder has not shared, is an outline, never a low score. Confidence counts the scored scopes by the word each carries. Your decision is your own deal flow: the round stays open for other investors.
              </p>
            </section>
          )}
          {dealRows.length > 0 && (
            <div className="flex flex-col gap-1" data-testid="screening-strip-key">
              <StripKey />
              <Link to="/scoring/method" className="w-fit text-[12px] font-semibold text-axal-violet-deep underline underline-offset-2 dark:text-violet-300">How scoring works</Link>
            </div>
          )}

          {/* ══ PASS REASONS: THE SECONDARY VIEW ════════════════════════════ */}
          <button
            type="button"
            aria-expanded={passesOpen}
            aria-controls="screening-pass-reasons"
            onClick={() => setView(passesOpen ? 'scorecards' : 'passes')}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[12px] border border-axal-hairline bg-white px-4 py-3 text-left dark:border-gray-800 dark:bg-gray-900"
            data-testid="screening-passes-toggle"
          >
            <span className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:gap-3">
              <b className="text-[13px] text-axal-ink dark:text-gray-100">Pass reasons</b>
              <span className={MUTED}>What the fund has passed on, and why — fund memory</span>
            </span>
            <span aria-hidden="true" className="text-gray-500">{passesOpen ? '▴' : '▾'}</span>
          </button>
          {passesOpen && (
            <div id="screening-pass-reasons">
              {passesReady ? (
                <Instrument
                  testid="screening-passes"
                  title="Pass reasons — the fund’s memory"
                  meta="Queryable · a pass is data, not a deletion"
                  cols="1.1fr .7fr 1fr 1.9fr"
                  head={['Reason', 'Passes', 'Share', 'What it means']}
                  rows={[
                    ...passes.buckets.map((b) => ({
                      key: b.reason,
                      cells: [
                        { text: b.label },
                        { text: String(b.count) },
                        b.pct === null ? { nr: true } : { text: `${b.pct}%`, barPct: b.pct },
                        {
                          text: PASS_TAXONOMY.find((r) => r.key === b.reason)?.hint || '',
                          sub: passReasonRevisit(b.reason) || undefined,
                        },
                      ],
                    })),
                    ...(passes.unrecorded
                      ? [{
                        key: '__unrecorded',
                        cells: [
                          { text: 'No reason recorded', sub: 'not a taxonomy entry' },
                          { text: String(passes.unrecorded) },
                          { nr: true },
                          { text: passes.unrecorded_note || '' },
                        ],
                      }]
                      : []),
                  ]}
                  note={`These are the studio's passes, each of which closes a round; a pass you record in the table above is your own and stays in your deal flow. Passes are kept because they are the most queryable thing a fund owns — "show everything we passed on valuation" is a real question, and these rows are what answers it. ${revisitable.length} of the ${PASS_TAXONOMY.length} reasons carry an explicit re-entry condition, which turns a no into a maybe with a trigger on it: ${revisitable.map((r) => r.label.toLowerCase()).join(' and ')}. A pass recorded before a reason was required stays unrecorded rather than being backfilled — a guessed reason would corrupt the record.`}
                />
              ) : passes === null ? (
                <p className={MUTED}>Reading…</p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="screening-passes-unreadable">
                  <NotRecorded /> — the pass record could not be read. That is not a claim that the fund has
                  passed on nothing.
                </p>
              )}
            </div>
          )}

          <StatedLimit title="What this desk does not do">
            <p>
              <strong>It scores nothing itself.</strong> Each deal&rsquo;s scores are its
              venture scorecard, computed from the venture&rsquo;s own records. There is no
              total and no tier: each investor sorts by their own weighting on Deal flow.
            </p>
            <p className="mt-2">
              <strong>The Lab scorer is practice.</strong> Its sliders are the founder&rsquo;s
              own answers, so its snapshots are not shown to investors here (owner question 8).
            </p>
            <p className="mt-2">
              <strong>No score moves a deal.</strong> A person decides; a scorecard informs.
            </p>
            <p className="mt-2">
              <strong>Material risks, Last change and Stale screens are Not recorded.</strong> No
              read this page makes carries a deal&rsquo;s named risks or when its screen last
              changed, so none is guessed.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
      {dialog && (
        <PassDialog
          row={{ id: dialog.deal_id, name: nameOf(dialog) }}
          invited={decisionOf(flow, dialog.deal_id).entry?.entered_via === 'invited'}
          onClose={() => setDialog(null)}
          onPassed={(next) => {
            keep(next);
            setResult(`You passed on ${nameOf(dialog)}. The round stays open for other investors.`);
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
