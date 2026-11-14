import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';
import { SearchInput } from '../../advisor/network/kit';
import { PASS_TAXONOMY, NEXT_ROUND_LINE, dayWithYear, passReasonLabel, passReturnWord } from '../../../lib/dealFlow';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { DealStrip, StripKey, useScopeStrips } from '../../../components/scoring/scorecard/Scorecard';
import { SCOPES, stripOf } from '../../../components/scoring/scorecard/scorecardModel';

/**
 * Deals · Screening — canvas **ID2**, `/deals/screening`. ANALYTICS.
 *
 * D1260 (#3283, part 7 of #2428; owner question 8 A): SCREENING READS THE
 * SCORECARD, AND NOTHING ELSE THAT SCORES.
 *
 * This desk used to draw the Lab scorer's newest snapshot per deal: a total,
 * a tier, six dimensions and its anomaly flags (`score_snapshots`). Those
 * scores come from the founder's own sliders, and the Lab scorer stays for
 * practice only. An Eadwyn memo cited them too, for every deal, to any reader.
 * Both are gone from this page.
 *
 * What it draws now:
 *   · Scorecards: each deal the reader may see (`GET /api/deals/screening`,
 *     which sends no score), with its eleven-scope strip from
 *     `POST /api/venture-scores/batch`. The batch applies the deal
 *     relationship, the founder's switch and the NDA itself. A locked or
 *     closed scorecard is an outline, never an empty bar.
 *   · Pass reasons: the firm's own passes (D6148, #6148), read from its deal
 *     flow (`GET /api/deals/flow/passes`), which is not a score. Each reason
 *     opens the deals passed for it, with when each comes back.
 *
 * D6148: THE STUDIO'S PASSES ARE NOT THE FIRM'S. This view used to read
 * `GET /api/deals/pass-analytics`, the studio's round-level passes
 * (`deals.status`), under the title "the fund's memory". An investor's own
 * passes live in `deal_flow_entries`, so that is what it reads now; the
 * studio's aggregate stays where it is named as the studio's, on Deal flow's
 * Studio lens for an admin or an Operating Partner.
 *
 * TWO STORES, TWO CALLS. The desk and the firm's passes are separate reads,
 * and the strip is a third, so one failing costs its own zone rather than
 * the page.
 */

const UNAVAILABLE = Symbol('unavailable');
/** D6148: an account with no investor licence has no deal flow, so no passes of its own. */
const NOT_INVESTOR = Symbol('not-investor');

/** The strip tile, in the anatomy every artboard shares. */
function ScreenTile({ label, value, note, tone = '' }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {value === null
          ? <NotRecorded />
          : <span className={`font-mono text-[16px] font-extrabold tracking-tight ${tone || 'text-axal-ink dark:text-gray-100'}`}>{value}</span>}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/** The row's one control, inside the cell whose subject it acts on. */
function OpenDeal({ id, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(`/deals/${id}`)}
      className="text-[10.5px] font-semibold text-axal-violet-deep underline underline-offset-2 hover:text-axal-violet dark:text-violet-300"
    >
      Open deal room
    </button>
  );
}

export default function InvestorScreeningZone() {
  const navigate = useNavigate();
  const [desk, setDesk] = useState(null);
  const [passes, setPasses] = useState(null);
  const [view, setView] = useState('scorecards');
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState(null);

  const load = useCallback(() => {
    setDesk(null);
    setPasses(null);
    api.dealScreening().then(setDesk, () => setDesk(UNAVAILABLE));
    dealFlowApi.passes().then(setPasses, (e) => setPasses(e?.code === 'investor_required' ? NOT_INVESTOR : UNAVAILABLE));
  }, []);
  useEffect(() => { load(); }, [load]);

  const deskReady = desk && desk !== UNAVAILABLE;
  const passesReady = passes && passes !== UNAVAILABLE && passes !== NOT_INVESTOR;
  const whose = passesReady && passes.scope === 'you' ? 'your' : 'your firm’s';
  const deals = deskReady ? desk.desk : null;
  const dealRows = useMemo(() => (deals?.available ? deals.rows : []), [deals]);
  const strips = useScopeStrips(dealRows.map((r) => r.deal_id));

  /** How many deals have a scorecard open to this reader with at least one scored scope. */
  const scoredCount = useMemo(() => {
    if (strips.status !== 'ready') return null;
    return dealRows.filter((r) => {
      const s = stripOf(strips.items.get(Number(r.deal_id)));
      return s.state === 'open' && s.scopes.some((x) => x.state === 'scored');
    }).length;
  }, [strips, dealRows]);

  /** The firm's passed deals for the reason opened, newest first (the read's order). */
  const passedFor = useMemo(() => (passesReady && reason ? (passes.items || []).filter((i) => i.reason === reason) : []), [passesReady, passes, reason]);

  /** The chip row's narrowing: Scorecards lists the deals; Pass reasons is a taxonomy, not a deal list. */
  const rows = useMemo(() => (view === 'scorecards' ? dealRows : []), [view, dealRows]);
  const searchable = view === 'scorecards';
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchable || !q) return rows;
    return rows.filter((r) => String(r.company || '').toLowerCase().includes(q));
  }, [rows, query, searchable]);

  const rowActions = investorZoneActions('deals/screening', {
    view: {
      header: ['Company', 'Sector', 'Deal status'],
      rows: dealRows,
      cells: (r) => [r.company || `Deal #${r.deal_id}`, r.sector || '', r.deal_status || ''],
    },
  });

  const anyRead = deskReady || passesReady;
  const bothFailed = desk === UNAVAILABLE && (passes === UNAVAILABLE || passes === NOT_INVESTOR);

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
      {searchable && (
        <div className="mb-3 flex" data-testid="screening-search">
          <SearchInput value={query} onChange={setQuery} placeholder="Search company" />
        </div>
      )}
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
              + 'you pass on a deal in Deal flow. Both reads are readable and empty, which is a different '
              + 'fact from a desk that could not be read.'
            }
          />
        )}
      >
        <div className="space-y-6">
          {/* ══ THE ID2 STRIP ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="screening-strip">
            <ScreenTile
              label="Deals"
              value={deals?.available ? String(deals.total_deals) : null}
              note={deals?.available ? 'the deals you can read' : (deals?.reason || 'the deals could not be read')}
            />
            <ScreenTile
              label="Scorecards"
              value={scoredCount === null ? null : `${scoredCount} of ${dealRows.length}`}
              note={strips.status === 'error'
                ? 'the scorecards could not be read'
                : `with a scope scored and open to you · ${SCOPES.length} scopes, never one total`}
            />
            <ScreenTile
              label="Your passes"
              value={passesReady ? String(passes.total) : null}
              note={passesReady
                ? `passed in ${whose} deal flow`
                : passes === NOT_INVESTOR ? 'passes are an investor’s own' : 'your passes could not be read'}
            />
          </div>

          {/* ══ THE DEALS AND THEIR SCORECARDS ══════════════════════════════ */}
          {view === 'scorecards' && (
            deals && !deals.available ? (
              <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="screening-deals-unreadable">
                <NotRecorded /> — the deals could not be read. That is not a claim that there are none.
              </p>
            ) : (
              <Instrument
                testid="screening-scorecards"
                title="Scorecards"
                meta="Each deal's venture scorecard · eleven scopes, no total"
                cols="1.3fr .9fr 1fr"
                head={['Company', 'Deal status', 'Scorecard']}
                rows={visible.map((r) => ({
                  key: r.deal_id,
                  cells: [
                    {
                      text: r.company || `Deal #${r.deal_id}`,
                      sub: r.sector || undefined,
                      node: <OpenDeal id={r.deal_id} onOpen={navigate} />,
                    },
                    r.deal_status ? { text: String(r.deal_status).replaceAll('_', ' ') } : { nr: true },
                    { text: '', node: <span className="inline-flex items-center gap-2"><DealStrip read={strips} dealId={r.deal_id} /><Link to={`/deals/${r.deal_id}/scorecard`} className="text-[10.5px] font-semibold text-axal-violet-deep underline underline-offset-2 dark:text-violet-300">Scorecard</Link></span> },
                  ],
                }))}
                note="A scorecard closed to you, or one its founder has not shared, is an outline, never a low score. Each scope is computed from the venture's own records; Scorecard opens the deal's panel."
              />
            )
          )}
          {view === 'scorecards' && dealRows.length > 0 && (
            <div className="flex flex-col gap-1" data-testid="screening-strip-key">
              <StripKey />
              <Link to="/scoring/method" className="w-fit text-[12px] font-semibold text-axal-violet-deep underline underline-offset-2 dark:text-violet-300">How scoring works</Link>
            </div>
          )}

          {/* ══ THE INSTRUMENT THE ARTBOARD NAMES ═══════════════════════════ */}
          {view === 'passes' && (
            passesReady ? (
              <>
                <Instrument
                  testid="screening-passes"
                  title={`Pass reasons — ${whose} passes`}
                  meta="From your deal flow · a pass is data, not a deletion"
                  cols="1.1fr .7fr 1fr 1.9fr"
                  head={['Reason', 'Passes', 'Share', 'What it means']}
                  rows={passes.buckets.map((b) => ({
                    key: b.reason,
                    rowClass: reason === b.reason ? 'bg-violet-50/60 dark:bg-violet-950/30' : '',
                    cells: [
                      {
                        text: b.label,
                        node: b.count > 0 ? (
                          <button
                            type="button"
                            onClick={() => setReason(reason === b.reason ? null : b.reason)}
                            aria-expanded={reason === b.reason}
                            className="text-[10.5px] font-semibold text-axal-violet-deep underline underline-offset-2 hover:text-axal-violet dark:text-violet-300"
                            data-testid={`screening-passes-open-${b.reason}`}
                          >
                            {reason === b.reason ? 'Hide its deals' : 'Show its deals'}
                          </button>
                        ) : undefined,
                      },
                      { text: String(b.count) },
                      b.pct === null ? { nr: true } : { text: `${b.pct}%`, barPct: b.pct },
                      { text: PASS_TAXONOMY.find((r) => r.key === b.reason)?.hint || '' },
                    ],
                  }))}
                  note={passes.total === 0
                    ? `No passes in ${whose} deal flow yet. A pass appears here once you pass on a deal in Deal flow, with its reason and when it comes back.`
                    : `These are ${whose} own passes in Deal flow, the same ones its Passed column holds. A pass with a date comes back in New for you on that date. ${NEXT_ROUND_LINE}`}
                />
                {reason && (
                  <Instrument
                    testid="screening-passes-deals"
                    title={`Passed for ${passReasonLabel(reason).toLowerCase()}`}
                    meta={`${passedFor.length} deal${passedFor.length === 1 ? '' : 's'}`}
                    cols="1.4fr 1fr 1.2fr"
                    head={['Venture', 'Passed on', 'Comes back']}
                    rows={passedFor.map((i) => ({
                      key: i.deal_id,
                      cells: [
                        {
                          text: i.venture || `Deal #${i.deal_id}`,
                          sub: i.sector || undefined,
                          node: i.can_open ? <OpenDeal id={i.deal_id} onOpen={navigate} /> : undefined,
                        },
                        dayWithYear(i.passed_at) ? { text: dayWithYear(i.passed_at) } : { nr: true },
                        passReturnWord(i)
                          ? { text: passReturnWord(i), sub: i.due ? 'due: listed in New for you' : i.revisit === 'next_round' ? 'not detected; look again yourself' : undefined }
                          : { nr: true },
                      ],
                    }))}
                    note="Moving a deal off Passed in Deal flow takes it out of this list and keeps its history."
                  />
                )}
              </>
            ) : passes === NOT_INVESTOR ? (
              <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="screening-passes-not-investor">
                Pass reasons counts an investor firm&rsquo;s own passes, and this account holds no investor
                licence. The studio&rsquo;s round-level passes are on the studio&rsquo;s own Deal flow, for an admin or an Operating Partner.
              </p>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="screening-passes-unreadable">
                <NotRecorded /> — your passes could not be read. That is not a claim that you have
                passed on nothing.
              </p>
            )
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
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
