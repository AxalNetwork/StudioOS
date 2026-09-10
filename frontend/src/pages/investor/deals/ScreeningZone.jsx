import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';
import { PASS_TAXONOMY, passReasonRevisit } from '../../../lib/dealFlow';

/**
 * Deals · Screening — canvas **ID2**, `/deals/screening`. ANALYTICS.
 *
 * WHAT WAS HERE: one card reading "No deals are currently in screening or
 * diligence", with a disabled Export beside it. It was accurate about the deal
 * record and wrong about the desk — because the desk's store was never read.
 *
 * THE OPS ROW SAID THERE WAS NOTHING TO READ, AND IT WAS WRONG TWICE.
 * `investorZoneActions` marked `New batch run` unbuilt because "no scoring run
 * is stored" and `Edit rubric` because "no rubric is stored". `score_snapshots`
 * is a stored scoring run carrying SIX dimensions — market, team, product,
 * capital, fit, distribution — each with its sub-scores and a total beside
 * `total_score` and `tier`, which is exactly the artboard's "Rubric · 6 dims".
 * It also carries `anomaly_flags` and `admin_review_status`, which is a
 * red-flag store under another name. Both reasons are corrected in the table.
 *
 * WHAT IS GENUINELY NOT BUILT, and is stated rather than drawn: batching (a
 * run is started against one project), editable WEIGHTS (fixed in
 * `services/scoring.ts`, with no per-firm store), and red-flag RULES a person
 * can write (`detectAnomalies` produces flags from fixed heuristics).
 *
 * THE INSTRUMENT IS THE PASS TAXONOMY, WHICH IS THE ARTBOARD'S OWN CHOICE on
 * an analytics page about scoring — and it earns it: `instTitle:'Pass reasons
 * — the fund's memory'`. A pass is the most queryable thing a fund owns, and
 * the scores are the strip above it rather than the table, because a score
 * without its rubric is a number with an opinion attached.
 *
 * TWO STORES, TWO CALLS. The score history and the pass taxonomy are separate
 * reads, so one failing costs its own zone rather than the page.
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

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

export default function InvestorScreeningZone() {
  const navigate = useNavigate();
  const [desk, setDesk] = useState(null);
  const [passes, setPasses] = useState(null);
  const [view, setView] = useState('scored');

  const load = useCallback(() => {
    setDesk(null);
    setPasses(null);
    api.dealScreening().then(setDesk, () => setDesk(UNAVAILABLE));
    api.dealPassAnalytics().then(setPasses, () => setPasses(UNAVAILABLE));
  }, []);
  useEffect(() => { load(); }, [load]);

  const deskReady = desk && desk !== UNAVAILABLE;
  const passesReady = passes && passes !== UNAVAILABLE;
  const scored = deskReady ? desk.scored : null;
  const flags = deskReady ? desk.flags : null;
  const rubric = deskReady ? desk.rubric : null;

  /** Every deal that carries a score, newest first — the artboard's `Scored`. */
  const scoredRows = useMemo(
    () => (scored?.available ? scored.rows.filter((r) => r.total_score !== null) : []),
    [scored],
  );
  const flagRows = useMemo(() => (flags?.available ? flags.rows : []), [flags]);

  /**
   * The pass buckets, and the two that carry a re-entry condition.
   *
   * `PASS_TAXONOMY` is the shared vocabulary the worker's CHECK constraint
   * accepts, and exactly two of its five entries define a `revisit` — too
   * early and valuation. That is not a coincidence and it is not decoration:
   * those are the two passes a price or a milestone can reverse, which turns a
   * no into a maybe with a date on it.
   */
  const revisitable = useMemo(() => PASS_TAXONOMY.filter((r) => r.revisit), []);

  /** The chip row's narrowing, and it renders. */
  const rows = useMemo(() => {
    if (view === 'flags') return flagRows;
    if (view === 'rubric') return [];
    if (view === 'passes') return passesReady ? passes.buckets : [];
    return scoredRows;
  }, [view, scoredRows, flagRows, passesReady, passes]);

  const rowActions = investorZoneActions('deals/screening', {
    view: {
      header: ['Company', 'Tier', 'Score', 'Review', 'Scored'],
      rows: scoredRows,
      cells: (r) => [
        r.company || `Deal #${r.deal_id}`,
        r.tier || '',
        r.total_score === null ? '' : String(r.total_score),
        r.review_status || '',
        day(r.scored_at) || '',
      ],
    },
  });

  const anyRead = deskReady || passesReady;
  const bothFailed = desk === UNAVAILABLE && passes === UNAVAILABLE;

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="investor"
        filters={investorZoneFilters('deals/screening', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={desk === null && passes === null}
        error={bothFailed ? 'Neither the score history nor the pass record could be read.' : ''}
        onRetry={load}
        isEmpty={Boolean(anyRead) && scoredRows.length === 0 && (!passesReady || passes.total === 0)}
        empty={(
          <NothingYet
            title="Nothing has been screened yet"
            body={
              'A deal appears here once it has been scored, and a pass appears once '
              + 'one has been recorded with its reason. Both stores are readable and '
              + 'empty, which is a different fact from a desk that could not be read.'
            }
          />
        )}
      >
        <div className="space-y-6">
          {/* ══ THE ID2 STRIP ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="screening-strip">
            <ScreenTile
              label="Scored"
              value={scored?.available ? `${scored.scored_deals} of ${scored.total_deals}` : null}
              note={scored?.available
                ? `${scored.unscored_deals} not yet screened · sandbox runs excluded`
                : (scored?.reason || 'the score history could not be read')}
            />
            <ScreenTile
              label="Rubric"
              value={rubric?.available ? `${rubric.dimensions.length} dims` : null}
              note={rubric?.available ? 'fixed in code · no per-firm weighting stored' : 'unreadable'}
            />
            <ScreenTile
              label="Open flags"
              value={flags?.available ? String(flags.open) : null}
              note={flags?.available
                ? (Object.keys(flags.by_severity).length
                  ? Object.entries(flags.by_severity).map(([sev, n]) => `${n} ${sev}`).join(' · ')
                  : 'no flag on any scored deal')
                : (flags?.reason || 'unreadable')}
              tone={flags?.available && flags.open ? 'text-amber-700 dark:text-amber-300' : ''}
            />
            <ScreenTile
              label="Pass taxonomy"
              value={passesReady ? `${passes.buckets.length} reasons` : null}
              note={passesReady
                ? `${passes.total} pass${passes.total === 1 ? '' : 'es'} recorded`
                : 'the pass record could not be read'}
            />
          </div>

          {/* ══ THE RUBRIC, when the chip asks for it ═══════════════════════ */}
          {view === 'rubric' && rubric?.available && (
            <Instrument
              testid="screening-rubric"
              title="The rubric"
              meta="Six dimensions · weights fixed in code"
              cols="1fr 2fr"
              head={['Dimension', 'What it scores']}
              rows={rubric.dimensions.map((d) => ({
                key: d.key,
                cells: [
                  { text: d.label },
                  { text: d.parts.join(', ').replaceAll('_', ' ') },
                ],
              }))}
              note={rubric.editable_reason}
            />
          )}

          {/* ══ THE SCORED DEALS ════════════════════════════════════════════ */}
          {(view === 'scored' || view === 'flags') && (
            <Instrument
              testid="screening-scored"
              title={view === 'flags' ? 'Flagged for review' : 'Scored deals'}
              meta={view === 'flags'
                ? 'A flag is the scorer disagreeing with itself, not a verdict'
                : 'Latest official snapshot per deal · sandbox excluded'}
              cols="1.2fr .8fr .7fr .9fr 1fr"
              head={['Company', 'Tier', 'Score', 'Review', 'Scored']}
              rows={rows.map((r) => ({
                key: r.deal_id,
                cells: [
                  {
                    text: r.company || `Deal #${r.deal_id}`,
                    sub: r.sector || undefined,
                    node: <OpenDeal id={r.deal_id} onOpen={navigate} />,
                  },
                  r.tier ? { text: '', pill: r.tier, pillTone: 'info' } : { nr: true },
                  r.total_score === null ? { nr: true } : { text: String(r.total_score) },
                  r.review_status === 'flagged'
                    ? {
                      text: '',
                      pill: 'Flagged',
                      pillTone: 'warn',
                      sub: r.flags.map((f) => `${f.type} · ${f.severity}`).join(', ') || undefined,
                    }
                    : r.review_status
                      ? { text: String(r.review_status).replaceAll('_', ' ') }
                      : { nr: true },
                  day(r.scored_at) ? { text: day(r.scored_at) } : { nr: true },
                ],
              }))}
              note={view === 'flags'
                ? 'A flag is raised when a score jumps against the same project’s own history, or against its practice runs — the scorer disagreeing with itself. It is a reason to look, never a verdict on the company, and it is shown with its type and severity rather than as a red dot nobody can act on.'
                : 'One snapshot per deal, the newest official one. A SANDBOX run is a rehearsal and is excluded, because a practice score that moved the desk’s numbers would make the numbers untrustworthy. A deal with no snapshot is not badly scored — it has not been screened, and it renders as unrecorded rather than as a zero.'}
            />
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

          <ZoneDraft
            surface="deals/screening"
            label="Draft · screening memo against the rubric"
            accept="Accept the memo"
            run="Draft the memo"
            foot="Every dimension traced to its recorded sub-scores."
            empty="A memo written against the six dimensions the score actually used, saying where the record is silent rather than scoring that dimension zero."
            nothingToDraft="No deal has been scored yet, so there is nothing to write a memo against."
          />

          <StatedLimit title="What this desk cannot do">
            <p>
              <strong>A scoring run is started against one project.</strong>{' '}
              `POST /api/scoring/score` scores a single project and locks the
              snapshot for the week. Nothing batches them, so
              <em> New batch run</em> is not offered — a button that scored one
              project while calling itself a batch would be the wrong claim
              about what happened.
            </p>
            <p className="mt-2">
              <strong>The weights are fixed in code.</strong> The six dimensions
              are real and stored per snapshot; what no store holds is a
              per-firm weighting, so there is nothing for <em>Edit rubric</em>
              {' '}to write to. This is narrower than &ldquo;no rubric is
              stored&rdquo;, which is what this row used to say and was not
              true.
            </p>
            <p className="mt-2">
              <strong>No red-flag rule is written by a person.</strong> Flags
              come from fixed heuristics — a jump in inputs, a jump against the
              project&rsquo;s own practice runs — and carry a type and a
              severity. The artboard draws a rules editor; there is no rules
              table for one to edit.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
