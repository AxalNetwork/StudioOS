import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import {
  ZoneBody, NothingYet, StatedLimit,
} from '../../advisor/expertise/kit';
import {
  DEAL_STAGE_LABEL, dealStage, dealMoneyExact,
  passReasonLabel, slaBand, slaPreset, DEFAULT_SLA,
} from '../../../lib/dealFlow';

/**
 * Deals · Pipeline — canvas **ID1**, `/deals/pipeline`. A WORK BOARD.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WAS NOT THE ARTBOARD. The zone rendered one
 * card: a heading, five stage columns of `DealCard`s, and a footnote. The
 * chrome around it — crumb, h1, architecture badge, zone pills — was already
 * right, and the toolbar's chips and ops were already declared in
 * `investorZoneFilters` / `investorZoneActions`. What the artboard draws and
 * the page did not was the BODY: a four-up strip, an instrument with six
 * columns and an SLA band per row, the note under it, and the AI band.
 *
 * THE INSTRUMENT IS A TABLE, AND THAT IS THE ARTBOARD'S CHOICE. "WORK BOARD" is
 * the architecture label, not the drawing: ID1's instrument is
 * `head:['Company','Sector','Stage','Ask','In stage','Owner']`. Six facts per
 * deal in one scan beats five columns of cards showing two, and the two facts
 * the cards could not carry at all — how long it has sat, and who owns it —
 * are the two the artboard's note is entirely about.
 *
 * THE SLA THRESHOLDS ARE NOT CHOSEN HERE. The artboard's `SLA_AMBER = 14,
 * SLA_RED = 30` are `slaPreset('standard')` in `lib/dealFlow.js`, which the
 * chip row already reads. One definition of "sat too long" across the product
 * is the point; a second copy in this file would drift the day someone tunes
 * one of them.
 *
 * THE FOURTH TILE IS NOT `From the Lab`. The artboard's fourth reads
 * "proprietary sourcing", and NO SOURCING CHANNEL IS STORED on a deal —
 * `deals` has no `source` column, and the Lab's own tables (`spinout_*`,
 * `cohort_applicants`) attach to people and applications rather than to deals.
 * Deriving it through project → founder → cohort would be a claim about
 * provenance the product never made. What IS recorded is whether a deal hangs
 * off a project on this platform, so the tile counts that and the Lab gap is
 * named in the limits below. A tile reading "Not recorded" because the PRODUCT
 * never built the store is design commentary on a customer's screen (D56), and
 * this is not one.
 *
 * A PASSED DEAL IS NOT ON THE BOARD. `dealStage` returns null for one and the
 * board excludes it, which is why the strip's "Live deals" and the Passed chip
 * can both be true at once.
 */

/** The strip tile, in the anatomy every artboard shares. */
function PipelineTile({ label, value, note, tone = '' }) {
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

/**
 * The row's one control, INSIDE the cell whose subject it acts on.
 *
 * `Instrument` draws the artboard's columns and nothing else — a row carries a
 * key and its cells, and no click handler. Passing one would have been dropped
 * silently, leaving a table that looks clickable and is not. `Cell`'s `node`
 * exists for exactly this: the deal room is reachable without a sixth column
 * the artboard does not draw.
 */
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

/** The artboard's `In stage` cell: a number with the band it earns, or nothing. */
function InStage({ days, preset }) {
  if (typeof days !== 'number' || !Number.isFinite(days)) {
    return { text: '', nr: true };
  }
  const band = slaBand(days, preset);
  return {
    text: `${days} d`,
    pill: band === 'red' ? 'Overdue' : band === 'amber' ? 'Stale' : null,
    pillTone: band === 'red' ? 'danger' : 'warn',
  };
}

export default function InvestorPipelineZone() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', deals: null });
  const [view, setView] = useState('all');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const rows = await api.listDeals(undefined, 'mine');
      setState({ loading: false, error: '', deals: Array.isArray(rows) ? rows : [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The pipeline did not load.', deals: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const preset = DEFAULT_SLA;
  const bands = slaPreset(preset);
  const all = state.deals || [];

  /** Every deal with a stage — a passed one has none, and is not live. */
  const live = useMemo(() => all.filter((d) => dealStage(d) !== null), [all]);
  const passed = useMemo(() => all.filter((d) => dealStage(d) === null), [all]);

  /**
   * The total ask, and how much of the board it actually covers.
   *
   * A DEAL WITH NO RECORDED ASK IS SKIPPED, NOT COUNTED AS ZERO. Summing it in
   * as 0 costs nothing arithmetically and everything in meaning: the
   * artboard's "… in asks" reads as the whole board's number, and it is only
   * the number for the deals that have one. So the ones without are counted
   * separately and the tile says so — a total that quietly covers four of six
   * deals is the kind of figure people plan against.
   *
   * (The artboard's own total is not quoted here on purpose: the guard for
   * this zone fails on any of the canvas's sample figures appearing in this
   * file, and it reads comments too — which is the right call, since a
   * fixture in a docblock is one copy-paste from being a fixture on screen.)
   */
  const asks = useMemo(() => {
    let sum = 0;
    let missing = 0;
    for (const d of live) {
      const ask = Number(d.target_raise) || Number(d.amount);
      if (Number.isFinite(ask) && ask > 0) sum += ask;
      else missing += 1;
    }
    return { sum, missing };
  }, [live]);
  const amber = useMemo(
    () => live.filter((d) => ['amber', 'red'].includes(slaBand(d.days_in_stage, preset))),
    [live, preset],
  );
  const red = useMemo(
    () => live.filter((d) => slaBand(d.days_in_stage, preset) === 'red'),
    [live, preset],
  );
  const unassigned = useMemo(() => live.filter((d) => !d.lead_partner_id), [live]);
  // The one sourcing fact the record actually carries. See the docblock.
  const onPlatform = useMemo(() => live.filter((d) => d.project_id), [live]);

  /**
   * THE CHIP ROW'S NARROWING, AND IT RENDERS.
   *
   * `Mine` is not here because the whole page is already scoped to `mine` —
   * the filter table marks it `unbuilt` for that reason and the builder drops
   * it, so no chip claims a narrowing that would select everything.
   */
  const visible = useMemo(() => {
    if (view === 'passed') return passed;
    if (view === 'unassigned') return unassigned;
    if (view === 'stale') return amber;
    return live;
  }, [view, live, passed, unassigned, amber]);

  const rowActions = investorZoneActions('deals/pipeline', {
    view: {
      header: ['Company', 'Sector', 'Stage', 'Ask', 'In stage', 'Owner'],
      rows: visible,
      cells: (d) => [
        d.project_name || `Deal #${d.id}`,
        d.project_sector || '',
        dealStage(d) ? DEAL_STAGE_LABEL[dealStage(d)] : 'Passed',
        dealMoneyExact(d.target_raise || d.amount) || '',
        typeof d.days_in_stage === 'number' ? `${d.days_in_stage} d` : '',
        d.lead_partner_name || '',
      ],
    },
  });

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="investor"
        filters={investorZoneFilters('deals/pipeline', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={all.length === 0}
        empty={(
          <NothingYet
            title="No deal is on this board yet"
            body={
              'A deal appears here when a founder raises on the platform or a '
              + 'partner shares one with you. Nothing is seeded — an empty board '
              + 'is an empty board, not a page that failed to load.'
            }
          />
        )}
      >
        <div className="space-y-6">
          {/* NO `ZoneHeading` HERE, AND THAT IS THE FIX RATHER THAN THE GAP.
              The shell above already draws `<h1>Pipeline</h1>` and the bucket's
              intro line; an `<h2>Pipeline</h2>` repeating the same sentence
              underneath is what the browser actually showed. The instrument
              carries its own title, so the section is named where it needs to
              be and said once. */}
          {/* ══ THE ID1 STRIP ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="pipeline-strip">
            <PipelineTile
              label="Live deals"
              value={String(live.length)}
              note={dealMoneyExact(asks.sum)
                ? `${dealMoneyExact(asks.sum)} in asks${asks.missing ? ` · ${asks.missing} with none recorded` : ''}`
                : 'no ask is recorded on any of them'}
            />
            <PipelineTile
              label={`Past ${bands.amber}-day SLA`}
              value={String(amber.length)}
              note={`${red.length} past ${bands.red} days`}
              tone={red.length ? 'text-red-700 dark:text-red-300' : ''}
            />
            <PipelineTile
              label="Unassigned"
              value={String(unassigned.length)}
              note={unassigned.length
                ? `${unassigned.filter((d) => slaBand(d.days_in_stage, preset) !== 'ok').length} of them are also stale`
                : 'every deal has a lead partner'}
              tone={unassigned.length ? 'text-amber-700 dark:text-amber-300' : ''}
            />
            <PipelineTile
              label="On-platform"
              value={String(onPlatform.length)}
              note="hang off a project here · sourcing channel not recorded"
            />
          </div>

          {/* ══ THE INSTRUMENT ══════════════════════════════════════════════ */}
          <Instrument
            testid="pipeline-board"
            title={view === 'passed' ? 'Passed deals' : 'Pipeline board'}
            meta={view === 'passed'
              ? 'A pass is data, not a deletion'
              : `Amber at ${bands.amber} days in stage, red at ${bands.red}`}
            cols={view === 'passed' ? '1.1fr .9fr 1fr 1.9fr' : '1.1fr .9fr 1.1fr .9fr .9fr .7fr'}
            head={view === 'passed'
              ? ['Company', 'State', 'Reason', 'Note']
              : ['Company', 'Sector', 'Stage', 'Ask', 'In stage', 'Owner']}
            rows={visible.map((d) => ({
              key: d.id,
              cells: view === 'passed'
                ? [
                  { text: d.project_name || `Deal #${d.id}`, node: <OpenDeal id={d.id} onOpen={navigate} /> },
                  { text: '', pill: 'Passed', pillTone: 'danger' },
                  d.pass_reason ? { text: passReasonLabel(d.pass_reason) } : { nr: true },
                  d.pass_note ? { text: d.pass_note } : { nr: true },
                ]
                : [
                  {
                    text: d.project_name || `Deal #${d.id}`,
                    sub: d.partner_name || undefined,
                    node: <OpenDeal id={d.id} onOpen={navigate} />,
                  },
                  d.project_sector ? { text: d.project_sector } : { nr: true },
                  { text: '', pill: DEAL_STAGE_LABEL[dealStage(d)], pillTone: 'info' },
                  dealMoneyExact(d.target_raise || d.amount)
                    ? { text: dealMoneyExact(d.target_raise || d.amount) }
                    : { nr: true },
                  InStage({ days: d.days_in_stage, preset }),
                  d.lead_partner_name
                    ? { text: d.lead_partner_name }
                    : { text: 'unassigned', sub: 'nobody is moving it' },
                ],
            }))}
            note={view === 'passed'
              ? 'A pass is kept because it is the most queryable thing a fund owns — "show everything we passed on valuation" is a real question, and these rows are what answers it. A pass recorded before a reason was required stays unrecorded rather than being backfilled: a guessed reason would corrupt the record.'
              : `Amber and red come from the same SLA preset the chip row reads, so "sat too long" means one thing across the product. A deal with no recorded age gets no band at all rather than a green one — an unknown age is not a healthy one, and colouring it would invent urgency the data does not support.${unassigned.length ? ' An unassigned deal is a deal nobody is moving, which is why the strip counts them beside the stale ones.' : ''}`}
          />

          <ZoneDraft
            surface="deals/pipeline"
            label={`Draft · ${amber.length} stale-deal note${amber.length === 1 ? '' : 's'}`}
            accept="Accept the notes"
            run="Draft the notes"
            foot="Nothing changes stage until you accept."
            empty="One note per stale deal: how long it has sat, who owns it, and the honest option — assign an owner, or pass and record the reason."
            nothingToDraft="No deal is past its SLA, so there is nothing to chase."
          />

          <StatedLimit title="What this board cannot see">
            <p>
              <strong>No sourcing channel is recorded on a deal.</strong>{' '}
              The artboard&rsquo;s fourth tile counts deals that came from the
              Spin-Out Lab, and <code>deals</code> has no column for where a deal
              came from. The Lab&rsquo;s own records attach to people and
              applications rather than to deals, so deriving it would be a claim
              about provenance nobody made. The tile counts what IS recorded —
              whether the deal hangs off a project on this platform.
            </p>
            <p className="mt-2">
              <strong>Stages are the deal record&rsquo;s stored status, translated.</strong>{' '}
              <code>deals.status</code> is a CHECKed set of five and this
              bucket&rsquo;s five stages are not the same five, so
              <em> Configure stages</em> is not offered: the columns are not
              editable, and a control that reordered labels without moving a deal
              would be a settings screen for a lie.
            </p>
            <p className="mt-2">
              <strong>A view is not saved between visits.</strong> The chip you
              pick is this page load only. Nothing stores a saved view, so
              <em> Save view</em> says so rather than appearing to work.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
