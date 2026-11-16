import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { readAllPages } from '../../../lib/pagedRead';
import PartialRead from './PartialRead';
import { usePipelineZone } from './usePipelineZone';
import NegotiationTermsSheet, {
  STAGE_LABEL, BallMark, whoOf, waitedText,
} from './NegotiationTermsSheet';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import { Eyebrow, NotRecorded } from '../../../workspaces/canvasKit';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  SaveNote, NoPartnerProfile, isNoPartnerProfile, ghostButtonClass, moneyDollars,
} from '../kit';

/**
 * Pipeline · Negotiations — `/pipeline/negotiations`, boards PP05 (the board),
 * PP05b (the terms sheet) and PP05m (phone, a stage selector) of the
 * `Pipeline v2` canvas. D5938 (#5938, part of #4838).
 *
 * THE STORES. Migration 208 gave this zone two: `quote_negotiations` (stage,
 * whose move it is, the one open question, `last_moved_at`) and `quote_terms`
 * (a clause with three positions rather than one value). `GET /negotiations`
 * reads both; `PUT /negotiations/:quoteId` and the negotiation-terms routes
 * write them. This file reads and writes them as they are.
 *
 * THE BOARD IS THE RECORDED STAGES. Scoping, Terms, Legal and Ready to sign
 * are four lanes; `closed` is a fifth stage and not a lane, because a board is
 * what is in play. Each lane header names the stage and counts its cards. No
 * WIP limit is drawn: none is stored (D4838, Backend required).
 *
 * EACH CARD ANSWERS FIVE QUESTIONS: who, how much, what is still open, who has
 * the ball, and how long it has waited. "Waited" is days since the last
 * RECORDED move (`days_stalled`, computed by the Worker from `last_moved_at`);
 * a stage or ball change or "Log a move" advances it, rewording the open
 * question does not. A negotiation with no recorded move says Not recorded,
 * never 0.
 *
 * MOVING A CARD IS TWO BUTTONS, NOT A DRAG. Each card carries "back to" and
 * "on to" the neighbouring stage; both are buttons, so a keyboard moves a card
 * exactly as a pointer does, and focus follows the card to its new lane.
 *
 * PHONE IS A STAGE SELECTOR AND ONE LIST. Four lanes at 390px would be four
 * unreadable columns, so the phone draws the stages as a radio group with
 * their counts and the chosen stage's cards stacked below.
 */

// The four the board draws as lanes. `closed` is a fifth stage and not a
// lane: a board is what is in play, and a closed negotiation is not.
const LANES = [['scoping', 'Scoping'], ['terms', 'Terms'], ['legal', 'Legal'], ['ready_to_sign', 'Ready to sign']];
// The phone selector's own short words (PP05m draws "Ready 0").
const SHORT = { scoping: 'Scoping', terms: 'Terms', legal: 'Legal', ready_to_sign: 'Ready' };

/** The strip tile, in the anatomy the artboards share. */
function NegotiationTile({ label, value, note, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
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

/** "How long it has waited", or the absence said with its reason. */
function Waited({ days }) {
  const text = waitedText(days);
  if (!text) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        <NotRecorded />
        <span className="text-[11px] font-normal text-axal-faint">no move logged</span>
      </span>
    );
  }
  // Seven days is the strip's threshold, and a stalled card says so in words.
  return (Number(days) >= 7)
    ? <span className="text-red-700 dark:text-red-300">{text} · stalled</span>
    : <span>{text}</span>;
}

/** One negotiation on the board (and in the phone list). */
function BoardCard({ row, laneIndex, onOpen, onMove, busy, note, openRef, phone }) {
  const n = row.negotiation;
  const who = whoOf(row);
  const openTerms = (row.terms || []).filter((t) => t.state === 'open').length;
  const stalled = (n.days_stalled ?? 0) >= 7;
  const prev = LANES[laneIndex - 1];
  const next = LANES[laneIndex + 1];
  const name = who || `Quote ${row.quote_uid || row.quote_id}`;
  const tall = phone ? 'min-h-[44px]' : '';
  return (
    <article
      data-neg-card={row.quote_id}
      aria-label={name}
      className={`flex flex-col gap-1 rounded-[10px] border p-3 text-[12.5px] ${
        stalled
          ? 'border-red-200 bg-white dark:border-red-900 dark:bg-gray-900'
          : 'border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900'
      }`}
    >
      <b className="text-[13.5px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
        {who || <Unrecorded>Client not recorded</Unrecorded>}
      </b>
      <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">
        {row.price != null ? moneyDollars(row.price) : <Unrecorded>Amount not recorded</Unrecorded>}
        {row.need_category ? ` · ${row.need_category}` : ''}
      </span>
      <dl className="mt-0.5 grid grid-cols-[86px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <dt className="text-axal-muted dark:text-gray-400">Open question</dt>
        <dd className="font-bold text-axal-ink dark:text-gray-100">
          {/* THE ONE OPEN QUESTION IS THE CARD'S REASON FOR EXISTING, so a
              card without one says that rather than looking complete. */}
          {n.open_question
            || <Unrecorded>No blocker named</Unrecorded>}
          {openTerms > 0 && (
            <span className="block text-[11px] font-normal text-axal-muted dark:text-gray-400">
              {openTerms === 1 ? '1 open term' : `${openTerms} open terms`}
            </span>
          )}
        </dd>
        <dt className="text-axal-muted dark:text-gray-400">Ball</dt>
        <dd><BallMark ball={n.ball} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Waiting</dt>
        <dd className="font-bold"><Waited days={n.days_stalled} /></dd>
      </dl>
      <div className={`mt-1.5 flex flex-wrap gap-1.5 ${phone ? 'flex-col' : ''}`}>
        <button type="button" ref={openRef} className={`${ghostButtonClass} ${tall}`} onClick={() => onOpen(row)}>
          Open terms
        </button>
        <div className="flex flex-wrap gap-1.5">
          {prev && (
            <button type="button" className={`${ghostButtonClass} ${tall}`} disabled={busy}
              aria-label={`Move ${name} back to ${prev[1]}`}
              onClick={() => onMove(row, prev[0])}>
              <span aria-hidden="true">← </span>{prev[1]}
            </button>
          )}
          {next && (
            <button type="button" className={`${ghostButtonClass} ${tall}`} disabled={busy}
              aria-label={`Move ${name} on to ${next[1]}`}
              onClick={() => onMove(row, next[0])}>
              {next[1]}<span aria-hidden="true"> →</span>
            </button>
          )}
        </div>
      </div>
      <SaveNote note={note?.scope === row.quote_id ? note : null} />
    </article>
  );
}

/** PP05m: the stages as one radio group, arrows moving between them. */
function StageSelector({ counts, value, onChange }) {
  const refs = useRef({});
  const onKeyDown = (e) => {
    const i = LANES.findIndex(([k]) => k === value);
    let to = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % LANES.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + LANES.length) % LANES.length;
    if (e.key === 'Home') to = 0;
    if (e.key === 'End') to = LANES.length - 1;
    if (to === null) return;
    e.preventDefault();
    const key = LANES[to][0];
    onChange(key);
    refs.current[key]?.focus?.();
  };
  return (
    <div role="radiogroup" aria-label="Stage" onKeyDown={onKeyDown}
      className="grid grid-cols-4 gap-0.5 rounded-[9px] border border-axal-hairline bg-axal-ground p-[3px] dark:border-gray-700 dark:bg-gray-900">
      {LANES.map(([key, label]) => {
        const on = key === value;
        return (
          <button
            key={key}
            ref={(el) => { refs.current[key] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${label}, ${counts[key]}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(key)}
            className={`min-h-[44px] rounded-[7px] px-1 text-[11.5px] ${
              on
                ? 'bg-white font-bold text-axal-ink shadow-[0_0_0_1px_#e4e4e7] dark:bg-gray-800 dark:text-gray-100 dark:shadow-[0_0_0_1px_#374151]'
                : 'font-semibold text-axal-muted dark:text-gray-400'
            }`}
          >
            {SHORT[key]} {counts[key]}
          </button>
        );
      })}
    </div>
  );
}

export default function PartnerNegotiationsZone() {
  const { state, load, run, busy, note } = usePipelineZone(
    () => readAllPages((cur) => api.listPartnerNegotiations(cur)), 'The negotiation record did not load.',
  );
  const [view, setView] = useState('all');
  const phone = usePhoneWidth();
  const [phoneStage, setPhoneStage] = useState(null);
  // The sheet holds a quote id, not a row: the row is re-read from the latest
  // load on every render, so a background refresh updates the open sheet.
  const [sheetFor, setSheetFor] = useState(null);
  // Where focus goes once a moved card has re-rendered in its new lane.
  const [focusCard, setFocusCard] = useState(null);
  const openRefs = useRef({});

  /**
   * `run` comes from `usePipelineZone`: one write, resolving true only when the
   * server accepted it, with its result reported ON THE CARD THAT MADE IT —
   * `scope` is the quote id, so saving one deal never prints "Saved." under
   * another.
   */

  const d = state.data;
  // A bare array, a missing key or an object are all survivable: an empty list, never a throw on `.map`.
  const items = Array.isArray(d?.items) ? d.items : [];
  const tracked = useMemo(() => items.filter((r) => r.negotiation), [items]);
  // ══ THE CHIP ROW ═════════════════════════════════════════════════════════
  // All four run off columns migration 208 stores. `Stalled 7d+` reads
  // `days_stalled`, which the WORKER computes from `last_moved_at`.
  // A CLOSED NEGOTIATION IS IN NONE OF THEM. The board is what is in play.
  const open = useMemo(
    // D4693: the Worker's own rule (`negotiation.open`): not closed AND the quote behind it still waiting.
    () => tracked.filter((r) => r.negotiation.open ?? r.negotiation.stage !== 'closed'),
    [tracked],
  );
  // The chip row's narrowing, drawn by the lanes below. `All` is the board
  // (`open`), never every engagement.
  const visible = useMemo(() => {
    if (view === 'us') return open.filter((r) => r.negotiation.ball === 'us');
    if (view === 'them') return open.filter((r) => r.negotiation.ball === 'them');
    if (view === 'stalled') return open.filter((r) => (r.negotiation.days_stalled ?? 0) >= 7);
    return open;
  }, [view, open]);
  const stalled = useMemo(
    () => tracked.filter((r) => (r.negotiation.days_stalled ?? 0) >= 7 && (r.negotiation.open ?? r.negotiation.stage !== 'closed')),
    [tracked],
  );
  const ourCourt = useMemo(
    () => tracked.filter((r) => r.negotiation.ball === 'us' && (r.negotiation.open ?? r.negotiation.stage !== 'closed')),
    [tracked],
  );
  const openIds = useMemo(() => new Set(open.map((r) => r.quote_id)), [open]);
  // Off the board: a quote nobody is tracking yet, and a negotiation that is
  // closed or whose quote is decided. Listed so each can still be opened.
  const offBoard = useMemo(() => items.filter((r) => !openIds.has(r.quote_id)), [items, openIds]);

  const lanes = useMemo(() => LANES.map(([key, name], i) => ({
    key, name, i, cards: visible.filter((r) => r.negotiation.stage === key),
  })), [visible]);
  const counts = Object.fromEntries(lanes.map((l) => [l.key, l.cards.length]));
  const shownStage = phoneStage || (lanes.find((l) => l.cards.length) || lanes[0]).key;

  const sheetRow = sheetFor == null ? null : items.find((r) => r.quote_id === sheetFor) || null;

  useEffect(() => {
    if (focusCard == null) return;
    // `run` resolves only after its refresh has rendered, so the moved card is
    // already in its new lane here. Cleared either way: a card the chip row
    // now hides has nothing to focus, and must not grab focus later.
    openRefs.current[focusCard]?.focus?.();
    setFocusCard(null);
  }, [focusCard]);

  const moveCard = async (row, stage) => {
    const ok = await run(
      () => api.savePartnerNegotiation(row.quote_id, { stage }),
      `Moved to ${STAGE_LABEL[stage]}.`, row.quote_id,
    );
    if (ok) {
      if (phone) setPhoneStage(stage);
      setFocusCard(row.quote_id);
    }
  };

  const cardProps = (r, laneIndex) => ({
    row: r,
    laneIndex,
    busy,
    note,
    phone,
    onOpen: (x) => setSheetFor(x.quote_id),
    onMove: moveCard,
    openRef: (el) => { openRefs.current[r.quote_id] = el; },
  });

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // The row is `{ quote_id, price, need_title, need_category, founder_name,
  // negotiation: {stage, ball, open_question} | null, terms }`; `negotiation`
  // is null for a quote nobody has started tracking, so the last three are
  // optional-chained rather than assumed.
  const rowActions = partnerZoneActions('pipeline/negotiations', { view: {
        header: ['Client', 'Shape', 'Value', 'Stage', 'Ball', 'Open question'],
        rows: items,
        cells: (r) => [r.founder_name, r.need_category, r.price,
          r.negotiation?.stage, r.negotiation?.ball, r.negotiation?.open_question],
      } });

  // NOT AN EARLY RETURN. `ZoneBody` takes the no-profile line as a `notice`
  // above its states, and the zone renders underneath in its own empty state.
  const unlinked = isNoPartnerProfile(state.error);

  return (
    <>
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store: a
          filter chip is a claim about ROWS, and a selectable chip over a store
          this account cannot read reads as an answer. The ops half renders
          nothing on purpose: its one op, a WIP limit, is `unbuilt` because no
          per-stage limit is stored. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : partnerZoneFilters('pipeline/negotiations', { value: view, onChange: setView })}
        actions={rowActions}
      />
    <ZoneBody
      loading={state.loading}
      error={unlinked ? null : state.error}
      onRetry={load}
      notice={unlinked ? <NoPartnerProfile /> : null}
      isEmpty={unlinked || (items.length === 0)}
      empty={(
        <NothingYet
          title="No quote is out yet"
          body={
            'A negotiation hangs off a quote this firm has sent. Quote a founder '
            + 'need and it appears here, ready to track — stage, whose move it is, '
            + 'and the one question blocking it.'
          }
          action={<Link to="/pipeline/leads" className="text-[12.5px] font-semibold text-amber-700 underline">Open leads</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <PartialRead data={state.data} noun="negotiations" onRetry={load} />
        <ZoneHeading
          title="Negotiations"
          blurb="Every live commercial discussion, its one unresolved blocker, and who owes the next move."
        />

        {/* ══ THE STRIP ═════════════════════════════════════════════════════
            `Live negotiations · Awaiting you · Awaiting them · Stalled 7d+`,
            the Worker's whole-book counts. PP05 puts its counts on the chips;
            the chips here are the shared filter row's, so the counts stay on
            the strip (a departure D5938 lists). */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NegotiationTile
            label="Live negotiations"
            value={String(d?.live_count ?? open.length)}
            // D4838: money only over negotiations that exist; none live is not "$0 carried".
            note={(d?.live_count ?? open.length) ? `${moneyDollars(d?.live_value_dollars ?? 0)} carried` : 'nothing carried'}
          />
          <NegotiationTile
            label="Awaiting you"
            value={String(d?.awaiting_us_count ?? ourCourt.length)}
            note="your move to make"
          />
          <NegotiationTile
            label="Awaiting them"
            value={String(d?.awaiting_them_count ?? 0)}
            note="waiting on a client"
          />
          <NegotiationTile
            label="Stalled 7d+"
            value={String(d?.stalled_count ?? stalled.length)}
            note="no recorded move either way"
          />
        </div>

        {/* ══ THE BOARD (PP05) ══════════════════════════════════════════════
            Four stages across, one card per negotiation. THE COUNT IS A COUNT,
            NOT A LIMIT: no per-stage limit is stored, and printing a canvas
            sample would police this firm's board with somebody else's number. */}
        {phone ? (
          <section aria-label="Negotiations by stage" data-testid="negotiation-stage-list" className="space-y-3">
            <StageSelector counts={counts} value={shownStage} onChange={setPhoneStage} />
            {(() => {
              const lane = lanes.find((l) => l.key === shownStage);
              return (
                <div className="space-y-2" aria-label={`${lane.name}, ${lane.cards.length} negotiations`} role="list">
                  {lane.cards.length === 0
                    ? <p className="px-1.5 text-[12px] text-axal-faint">None at this stage</p>
                    : lane.cards.map((r) => (
                      <div role="listitem" key={r.quote_id}><BoardCard {...cardProps(r, lane.i)} /></div>
                    ))}
                </div>
              );
            })()}
          </section>
        ) : (
          <div className="grid grid-cols-4 items-start gap-3" data-testid="negotiation-lanes">
            {lanes.map(({ key, name, i, cards }) => (
              <section
                key={key}
                aria-label={`${name}, ${cards.length} negotiations`}
                className="flex min-h-[260px] flex-col gap-2 rounded-xl border border-axal-hairline bg-axal-ground p-2.5 dark:border-gray-700 dark:bg-gray-900/40"
              >
                <h3 className="flex items-center justify-between px-1 text-[13px] font-extrabold text-axal-ink dark:text-gray-100">
                  {name}
                  <span className="font-mono text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">{cards.length}</span>
                </h3>
                {cards.length === 0
                  ? <p className="px-1.5 text-[12px] text-axal-faint">None at this stage</p>
                  : cards.map((r) => <BoardCard key={r.quote_id} {...cardProps(r, i)} />)}
              </section>
            ))}
          </div>
        )}

        {/* ══ THE EADWYN COUNTER ════════════════════════════════════════════
            `research_zone_drafts`, surface `pipeline/negotiations`: one counter
            drafted over the book's open negotiations, the one still longest
            first, from the clauses on record. It is not scoped to one
            negotiation, which is why it sits on the board and not in the terms
            sheet. "Not sent" and the three controls appear only while a draft
            exists. Accepting stamps the draft; it writes no term and sends
            nothing. */}
        <ZoneDraft
          surface="pipeline/negotiations"
          railOption="draft:counter"
          label="Eadwyn counter proposal"
          status="Not sent"
          accept="Accept counter draft"
          editLabel="Edit terms"
          run="Draft the counter"
          foot="Accepting keeps this draft as accepted here. It writes no term and nothing is sent to the client."
          empty="For the negotiation that has been still longest: a counter built only from the clauses already on the table, and the one line that says why the two positions cannot both hold."
          nothingToDraft="No negotiation is open, so there is nothing to counter."
        />

        {offBoard.length > 0 && (
          <section aria-labelledby="neg-off-board" className="rounded-xl border border-axal-hairline p-3 dark:border-gray-700">
            <h3 id="neg-off-board" className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
              Not on the board · {offBoard.length}
            </h3>
            <p className="mt-1 text-[11.5px] text-axal-faint">
              Quotes nobody is tracking yet, and negotiations that are closed or whose quote is decided.
            </p>
            <ul className="mt-2 divide-y divide-axal-hairline dark:divide-gray-800">
              {offBoard.map((r) => (
                <li key={r.quote_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                  <span className="min-w-0">
                    <span className="font-bold">{whoOf(r) || <Unrecorded>Client not recorded</Unrecorded>}</span>
                    <span className="ml-2 font-mono text-axal-muted dark:text-gray-400">
                      {r.price != null ? moneyDollars(r.price) : 'amount not recorded'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {r.negotiation
                      ? <Pill tone="neutral">{r.negotiation.label || STAGE_LABEL[r.negotiation.stage] || r.negotiation.stage}</Pill>
                      : <Pill tone="neutral">Not tracked</Pill>}
                    <button type="button" className={`${ghostButtonClass} ${phone ? 'min-h-[44px]' : ''}`}
                      onClick={() => setSheetFor(r.quote_id)}>
                      {r.negotiation ? 'Open terms' : 'Start tracking'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <StatedLimit title="What “stalled” counts, and what is not forecast">
          <p>
            <strong>No recorded move</strong>, not silence. The
            clock advances on a stage or ball change, or on an explicit “Log a
            move”; it does not advance when the open question is reworded. An
            email nobody logged here does not move it either — so a deal can be
            alive and read as stalled. That is the honest failure direction:
            the count over-reports rather than reassuring.
          </p>
          <p className="mt-2">
            <strong>Nothing here forecasts a close.</strong> Proposals now
            records WHY a bid was lost, which is a taxonomy rather than a rate —
            a handful of decided deals cannot support a probability conditioned
            on the stage a deal happens to be sitting in, and a percentage drawn
            from stage alone would be the stage relabelled as a forecast. The
            lanes say where each deal is and how long it has been there, which
            is what the record can actually support.
          </p>
          <p className="mt-2">
            <strong>The lane count is a count, not a limit.</strong> No
            per-stage limit is stored anywhere, so no lane draws one; printing a
            design’s sample figure would police this firm’s board with somebody
            else’s number.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
      {sheetRow && (
        <NegotiationTermsSheet
          row={sheetRow}
          busy={busy}
          note={note}
          // The sheet returns focus to the control that opened it.
          onClose={() => setSheetFor(null)}
          onSaveNegotiation={(r, patch) => run(
            () => api.savePartnerNegotiation(r.quote_id, patch),
            'Saved.', r.quote_id,
          )}
          onAddTerm={(r, t) => run(
            () => api.createPartnerNegotiationTerm(r.quote_id, t),
            'Term added.', r.quote_id,
          )}
          onSaveTerm={(t, dr) => run(
            () => api.updatePartnerNegotiationTerm(t.id, dr),
            'Term saved.', sheetRow.quote_id,
          )}
          onDeleteTerm={(t) => run(
            () => api.deletePartnerNegotiationTerm(t.id),
            'Term removed.', sheetRow.quote_id,
          )}
        />
      )}
    </>
  );
}
