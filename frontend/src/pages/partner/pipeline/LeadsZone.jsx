import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { readAllLeadPages } from '../../../lib/pagedRead';
import PartialRead from './PartialRead';
import RankByFit from '../../../ui/RankByFit';
import Lightbox from '../../../ui/Lightbox';
import { applyRank } from '../../../lib/rankByFit';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill,
  Field, SaveNote, NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, moneyDollars,
} from '../kit';
import { usePipelineZone } from './usePipelineZone';
import {
  PASS_REASONS, PASS_REASON_LABEL, emptyViewLine, fitLine, inState, leadReasons, leadStrip, recentFirst, whyThisScore,
} from './leadsModel';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Pipeline · Leads — `/pipeline/leads`.
 *
 * WHAT THIS ROUTE USED TO RENDER. `NeedsBoardPage` — the shared marketplace
 * needs board, the same component a founder and an admin see, with a partner
 * export row bolted on. It listed open needs and stopped there: no score, no
 * provenance, no pass, and no way to tell a need this firm had already bid on
 * from one it had never opened.
 *
 * THE THREE SETS ARE THE ARTBOARD'S WHOLE ARGUMENT, and they are enforced
 * rather than asserted: "a lead you already bid is not a lead, and a lead you
 * declined is not one either." A need this firm quoted on is a PROPOSAL and
 * lives on `/pipeline/proposals`; a need with a row in `partner_lead_passes` is
 * a PASS; everything else open is a LEAD. Each read excludes the other two, so
 * no status column has to be kept in step and one client cannot appear twice.
 *
 * A PASS WITHOUT A REASON IS A LEAD YOU RE-EVALUATE NEXT QUARTER. That is the
 * artboard's sentence and migration 233's reason for existing. Nothing recorded
 * a decision NOT to bid, so a need somebody read and declined looked exactly
 * like one nobody had opened, and the firm spent the same hour twice.
 *
 * THE SCORE IS THE FIRM'S OWN RULES, COUNTED — NOT A MODEL. `partner_fit_rules`
 * (209/229) has been the firm's register of what it takes and passes on since
 * it was built, and `/offers/fit-rules` has answered `enforcement: 'none'` all
 * that time with the accurate note that "these rules are a record a person
 * reads before passing on a lead". This zone is the reader. Every receipt on a
 * row names the rule it came from, because a score whose derivation is hidden
 * is a number to argue with rather than one to act on.
 *
 * A FIRM WITH NO RULES GETS NO SCORE. Not fifty, not "unrated but probably
 * fine" — `score: null` with the reason, and the `Strong fit` tile goes absent
 * with it. And an EXCLUDED lead carries no number at all: "we do not do native
 * mobile" is not twenty out of a hundred, and putting it on the same axis would
 * rank a lead the firm has already ruled out above one it merely fits badly.
 */

const CARD_ACTION = 'min-h-[44px] w-full justify-center sm:w-auto';

/**
 * The toolbar's views (PP03), keyed as `partnerZoneFilters('pipeline/leads')`
 * keys them. Every view keeps the order it was given (Rank by fit's, when one
 * ran) except Recent, which is newest first.
 */
const VIEW_ROWS = {
  all: (rows) => rows,
  strong: (rows) => rows.filter(inState('strong')),
  unscored: (rows) => rows.filter(inState('unscored')),
  excluded: (rows) => rows.filter(inState('excluded')),
  recent: recentFirst,
};

/**
 * The strip tile, in the anatomy the artboards share. `value: null` is Not
 * recorded, and the note says why.
 */
function LeadTile({ label, value, note }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid="lead-tile">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {value == null ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/**
 * The pass dialog (PP03b): a required reason from the Worker's own list and an
 * optional note. A failed write keeps the dialog, the reason and the note.
 */
export function PassDialog({ row, busy, note, onPass, onClose }) {
  const [draft, setDraft] = useState({ reason: '', note: '' });
  const name = row.who || row.title;
  const failed = note?.scope === `lead:${row.need_id}` && note?.ok === false ? note : null;
  return (
    <Lightbox
      label={`Pass on ${name}?`} title={`Pass on ${name}?`}
      sub="A pass is not a loss. It keeps this lead off your list."
      onClose={onClose} width={560} phone="sheet" testId="lead-pass-dialog"
      footer={(
        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" className={`${ghostButtonClass} ${CARD_ACTION}`} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button" className={`${buttonClass} ${CARD_ACTION}`}
            disabled={busy || !draft.reason} data-testid="lead-pass-confirm"
            onClick={async () => { if (await onPass(row, draft)) onClose(); }}
          >
            Pass on this lead
          </button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Reason · required</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Reason">
            {PASS_REASONS.map(([key, label]) => (
              <label key={key} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[9px] border border-axal-hairline px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
                <input
                  type="radio" name={`pass-reason-${row.need_id}`} value={key}
                  checked={draft.reason === key}
                  onChange={() => setDraft((x) => ({ ...x, reason: key }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Note · optional" hint="What the next person reading this lead needs to know.">
          <textarea className={`${inputClass} min-h-[64px]`} value={draft.note} maxLength={600}
            data-testid="lead-pass-note"
            onChange={(e) => setDraft((x) => ({ ...x, note: e.target.value }))} />
        </Field>
        <SaveNote note={failed} />
      </div>
    </Lightbox>
  );
}

/**
 * One lead, in the canvas's order (PP03): name, source provenance, the fit
 * explanation (reasons first, then the score), budget, need summary, action.
 *
 * THE CARD IS TINTED ONLY ON A STRONG FIT, the way the artboard tints it — and
 * an excluded lead is not tinted red either. It is not a bad lead; it is not a
 * lead, and the row says which rule said so in the firm's own words.
 */
function LeadCard({ row, onPass }) {
  const [why, setWhy] = useState(false);
  const fit = fitLine(row);
  const reasons = leadReasons(row);
  const explain = whyThisScore(row);
  const strong = fit.state === 'strong';

  return (
    <article
      data-testid="lead-card"
      className={`grid gap-4 rounded-[11px] border p-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] ${
        fit.state === 'excluded'
          ? 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-900'
          : (strong
            ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/15'
            : 'border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900')
      }`}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
            {row.who || row.title}
          </h3>
          {/* PROVENANCE, and there is one kind of it on this build. */}
          <Pill tone="seam">{row.source_label}</Pill>
          {row.days_old != null && (
            <span className="text-[11px] text-axal-faint">{row.days_old}d ago</span>
          )}
        </div>

        {/* THE REASONS COME FIRST, then the score: a number whose derivation is
            hidden is a number to argue with. */}
        {reasons.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="lead-reasons">
            {reasons.map((r, i) => (
              <li key={`${r.label}-${i}`} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={r.met ? 'font-extrabold text-emerald-700 dark:text-emerald-400' : 'font-extrabold text-red-700 dark:text-red-400'}>
                  {r.met ? '✓' : '✕'}
                </span>
                <span><span className="sr-only">{r.met ? 'Met: ' : 'Missed: '}</span>{r.label}</span>
              </li>
            ))}
          </ul>
        )}

        {/* NOT A NUMBER WHERE THERE IS NO NUMBER. An exclusion and an
            unscorable lead are two different absences and read as two. */}
        <div className="text-[12px] font-bold text-axal-muted dark:text-gray-400" data-testid="lead-fit">
          {fit.state === 'excluded' || fit.state === 'unscored'
            ? <Pill tone="neutral">{fit.text}</Pill>
            : <>{fit.text} · <span className="font-mono">{fit.score}</span></>}
        </div>
        {row.excluded_by && (
          <p className="m-0 text-[12px] leading-relaxed text-axal-muted">{row.excluded_by}</p>
        )}
        {fit.state === 'unscored' && (
          <p className="m-0 text-[12px] leading-relaxed text-axal-muted">
            {row.score_note || 'No fit rule applies to this need, so it isn’t scored.'}
          </p>
        )}
        {explain && (
          <div>
            <button type="button" className="text-[12px] font-bold text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
              aria-expanded={why} onClick={() => setWhy((v) => !v)}>
              Why this score? {why ? '▴' : '▾'}
            </button>
            {why && (
              <div className="mt-1.5 rounded-lg border border-axal-hairline bg-axal-ground p-3 text-[12px] dark:border-gray-700 dark:bg-gray-950" data-testid="lead-why">
                <ul className="m-0 list-none p-0">
                  {explain.receipts.map((r, i) => (
                    <li key={`${r.label}-${i}`}><strong>{r.word}</strong> · {r.label}</li>
                  ))}
                </ul>
                <p className="m-0 mt-1.5 text-axal-muted">{explain.sum}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-axal-muted">Budget</span>
        {/* DOLLARS STRAIGHT THROUGH. `founder_needs.budget_*` is the old
            REAL-dollars pipeline and `moneyDollars` formats dollars, so a
            `* 100` here — the conversion the SCORE needs, because the fit
            rule's floor is in cents — would print $3.2M over a $32,000
            budget. The two comparisons are in different units and only one
            of them converts. */}
        <span className="font-mono font-bold text-axal-ink dark:text-gray-100" data-testid="lead-budget">
          {row.budget_max != null
            ? (row.budget_min != null && row.budget_min !== row.budget_max
              ? `${moneyDollars(row.budget_min)}–${moneyDollars(row.budget_max)}`
              : moneyDollars(row.budget_max))
            : (row.budget_min != null ? `from ${moneyDollars(row.budget_min)}` : <NotRecorded />)}
        </span>
        <span className="mt-1 text-axal-muted">Need</span>
        <span className="text-axal-ink dark:text-gray-100">
          {row.title}{row.timeline ? ` · ${row.timeline}` : ''}
        </span>
        {row.need && <span className="text-[12px] text-axal-faint">{row.need}</span>}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          {/* #2338 — "Accept · bid on it" linked to `/needs/<uid>`, a route
              that never existed, and the owner removed bidding from Leads. The
              canvas's Draft proposal waits on the owner (D4838), so Pass is the
              one action. */}
          <button type="button" className={`${ghostButtonClass} ${CARD_ACTION}`} onClick={() => onPass(row)}>
            Pass
          </button>
        </div>
      </div>
    </article>
  );
}

export default function PartnerLeadsZone() {
  const { state, load, run, busy, note } = usePipelineZone(
    () => readAllLeadPages((cur, pcur) => api.listPartnerLeads(cur, pcur)), 'The lead list did not load.',
  );
  const [view, setView] = useState('all');
  const [passing, setPassing] = useState(null);
  // #3938 (IN10): Rank by fit orders the open leads against the firm's own audience fit, as a view.
  const [rank, setRank] = useState(null);



  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const passed = Array.isArray(d?.passed) ? d.passed : [];

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself.
  // ══ THE `p1` CHIP ROW ════════════════════════════════════════════════════
  // `Passed` IS THE ONLY ONE THAT LEAVES THE OPEN LIST, which is the point: it
  // shows the other set, and the table below is where its reasons live. `Warm
  // intros` is prose — every lead here is a marketplace need, so it would
  // select the whole list and call that a filter.
  const ranked = applyRank(items, (r) => r.need_id, rank);
  const visible = (VIEW_ROWS[view] || VIEW_ROWS.all)(ranked.list);
  const tiles = leadStrip(d);

  const rowActions = partnerZoneActions('pipeline/leads', { view: { header: ['Lead', 'Need', 'Score', 'Source', 'Budget max', 'Timeline'], rows: visible, cells: (r) => [r.who, r.title, r.score, r.source_label, r.budget_max, r.timeline] } });

  // NOT AN EARLY RETURN ANY MORE. This was
  //   `if (isNoPartnerProfile(state.error)) return <UnlinkedZone … />;`
  // which drew a card INSTEAD of the zone — on twelve zones, so an admin
  // reading this workspace saw twelve copies of one card and never a page.
  // `ZoneBody` takes the line as a `notice` above its states, and the zone
  // renders underneath in its own empty state, which is also the state that
  // says what this zone holds. The gate itself is untouched: the read still
  // 400s, so `isEmpty` is forced rather than inferred from rows that never
  // arrived, and `error` is cleared so the shared "This did not load" card —
  // the exact confusion `isNoPartnerProfile` exists to prevent — cannot fire.
  const unlinked = isNoPartnerProfile(state.error);

  return (
    <>
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store.
          An action states what the zone DOES and an export over nothing
          loaded renders disabled and says so; a filter chip is a claim about
          ROWS, and a selectable `Published` over a store this account cannot
          read is the "an empty set reads as an answer" failure
          `zoneFilterBuilder.js` exists to prevent, reached from a new
          direction. `profile_zone_actions.test.mjs` asserts both halves. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : partnerZoneFilters('pipeline/leads', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={load}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || (items.length === 0 && passed.length === 0)}
        empty={(
          <NothingYet
            title="No open lead right now"
            body={
              'A lead is an open marketplace need this firm has neither bid on '
              + 'nor passed on. Pass and it moves to the table of passes with '
              + 'your reason, so nobody reads it again next quarter.'
            }
          />
        )}
      >
        <div className="space-y-6">
          <PartialRead data={state.data} noun="leads" onRetry={load} />
          <ZoneHeading
            title="Leads"
            blurb="Every opportunity this firm has not bid on or passed, scored against the firm’s own fit rules."

          />

          {/* ══ THE PP03 STRIP ═══════════════════════════════════════════════
              `Open leads · Strong fit · Unscored · Passed this period`. A zero
              prints only beside its population; a count the loaded rows
              cannot settle is Not recorded with its reason (leadsModel.js). */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="lead-strip">
            {tiles.map((t) => <LeadTile key={t.label} label={t.label} value={t.value} note={t.note} />)}
          </div>

          {d?.population_note && (
            <p className="text-[12.5px] leading-relaxed text-axal-muted">{d.population_note}</p>
          )}
          {d?.scoring === 'none' && (
            <p className="text-[12.5px] leading-relaxed text-axal-muted">{d.scoring_note}</p>
          )}

          {items.length > 1 && (
            <RankByFit run={(query) => api.rankPartnerLeads(query)} onRanked={setRank} ranked={rank ? ranked.ranked : null} total={items.length}
              label="What work do you want next? (optional)" testid="partner-leads-rank" />
          )}

          <div className="space-y-3">
            {visible.map((row) => (
              <LeadCard key={row.need_id} row={row} onPass={setPassing} />
            ))}
            {items.length > 0 && visible.length === 0 && (
              <p className="text-[12px] text-axal-muted" data-testid="lead-view-empty">
                {emptyViewLine(view, items.length)}
              </p>
            )}
          </div>
          {passing && (
            <PassDialog
              row={passing} busy={busy} note={note}
              onClose={() => setPassing(null)}
              onPass={(r, draftValue) => run(
                () => api.passPartnerLead(r.need_id, {
                  reason: draftValue.reason, note: draftValue.note,
                }),
                'Pass recorded.', `lead:${r.need_id}`,
              )}
            />
          )}

          <ZoneDraft
            surface="pipeline/leads"
            railOption="draft:proposal"
            label="Proposal · drafted on accept"
            accept="Open the draft"
            run="Draft the proposal"
            foot="Shaped from your own catalogue and floor."
            empty="For the strongest open lead: a proposal shaped the way this firm actually wins — a retainer rather than a project where the record says retainers are what closes — with the client’s stated budget checked against your floor."
            nothingToDraft="No lead is open, so there is nothing to draft a proposal for."
          />

          {/* ══ THE RECORD THAT STOPS RE-LITIGATION ═══════════════════════════
              The artboard's own label for this table, and its own subtitle. */}
          <Instrument
            testid="passed-leads"
            title="Passed · with reasons"
            meta="Only here · the record that stops re-litigation"
            cols="1.1fr .8fr 1.6fr"
            head={['Lead', 'Reason', 'Note']}
            rows={passed.map((p) => ({
              key: p.id,
              cells: [
                p.who ? { text: p.who, sub: p.title } : { text: p.title },
                { pill: PASS_REASON_LABEL[p.reason] || p.reason, pillTone: 'neutral' },
                p.note
                  ? {
                    text: p.note,
                    node: (
                      <button
                        type="button" className={ghostButtonClass} disabled={busy}
                        title="Puts the lead back on the open list. The pass is removed rather than kept as a reversal — the lead is either passed or it is open."
                        onClick={() => run(() => api.unpassPartnerLead(p.need_id), 'Back on the list.', `unpass:${p.need_id}`)}
                      >
                        Un-pass
                      </button>
                    ),
                  }
                  : {
                    nr: true,
                    node: (
                      <button
                        type="button" className={ghostButtonClass} disabled={busy}
                        onClick={() => run(() => api.unpassPartnerLead(p.need_id), 'Back on the list.', `unpass:${p.need_id}`)}
                      >
                        Un-pass
                      </button>
                    ),
                  },
              ],
            }))}
            note={'These never became proposals, which is what separates this table from a loss. A lost bid is on Proposals with its reason; a pass is a bid you chose not to make, and the two live in different tables so neither moves your win rate by accident. A lead you already bid on is not a lead and a lead you declined is not one either — the open list above excludes both, so no client appears in two of the three sets.'}
          />
          <SaveNote note={String(note?.scope || '').startsWith('unpass:') ? note : null} />

          <StatedLimit title="What the score is, and what it is not">
            <p>
              <strong>It is your own rules, counted.</strong> Every receipt on a
              row names the rule it came from — a service you list, a budget
              floor you set, a profile you called best fit on{' '}
              <Link to="/offers/audience-fit" className="underline">Offers · Audience fit</Link>.
              Nothing here is a model, and the matching is a plain search for
              your own words in the client’s, which is why the phrase that
              matched is shown rather than hidden behind a number.
            </p>
            <p className="mt-2">
              <strong>No rules means no score.</strong> A firm that has stated no
              fit rule and listed no service has told this product nothing to
              judge a lead against, so leads read as unscored rather than as
              average. And an excluded lead carries no number at all: “we do not
              do this” is a different answer from a low one, and ranking it
              against fits would put a lead you have already ruled out above one
              you merely fit badly.
            </p>
            <p className="mt-2">
              <strong>Every lead here came from the marketplace.</strong> Nothing
              records a lead arriving through an investor, a referral or a
              conversation, so the provenance chip says the one thing it can say
              truthfully, and there is no warm-intro view to choose.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
