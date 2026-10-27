import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';
import { SearchInput } from '../../advisor/network/kit';
import { PASS_TAXONOMY, passReasonRevisit } from '../../../lib/dealFlow';
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
 *   · Pass reasons: the fund's own record, which is not a score.
 *
 * TWO STORES, TWO CALLS. The desk and the pass taxonomy are separate reads,
 * and the strip is a third, so one failing costs its own zone rather than
 * the page.
 */

const UNAVAILABLE = Symbol('unavailable');

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

  const load = useCallback(() => {
    setDesk(null);
    setPasses(null);
    api.dealScreening().then(setDesk, () => setDesk(UNAVAILABLE));
    api.dealPassAnalytics().then(setPasses, () => setPasses(UNAVAILABLE));
  }, []);
  useEffect(() => { load(); }, [load]);

  const deskReady = desk && desk !== UNAVAILABLE;
  const passesReady = passes && passes !== UNAVAILABLE;
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

  const revisitable = useMemo(() => PASS_TAXONOMY.filter((r) => r.revisit), []);

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
              + 'one has been recorded with its reason. Both reads are readable and empty, which is a different '
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
              label="Pass taxonomy"
              value={passesReady ? `${passes.buckets.length} reasons` : null}
              note={passesReady
                ? `${passes.total} pass${passes.total === 1 ? '' : 'es'} recorded`
                : 'the pass record could not be read'}
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
                note={`Passes are kept because they are the most queryable thing a fund owns — "show everything we passed on valuation" is a real question, and these rows are what answers it. ${revisitable.length} of the ${PASS_TAXONOMY.length} reasons carry an explicit re-entry condition, which turns a no into a maybe with a trigger on it: ${revisitable.map((r) => r.label.toLowerCase()).join(' and ')}. A pass recorded before a reason was required stays unrecorded rather than being backfilled — a guessed reason would corrupt the record.`}
              />
            ) : (
              <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="screening-passes-unreadable">
                <NotRecorded /> — the pass record could not be read. That is not a claim that the fund has
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
