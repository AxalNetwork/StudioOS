import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card, EmptyState, ErrorState, WorkerRail, Skeleton } from '../../ui';
import WorkspaceShell, { NotRecorded } from '../WorkspaceShell';
import ZoneToolbar from '../ZoneToolbar';
import { founderZoneFilters } from '../founderZoneFilters';
import { founderZoneActions } from '../founderZoneActions';
import ValidateProposals from './ValidateProposals';
import InterviewRecording from './InterviewRecording';
import useAssistMode from '../../hooks/useAssistMode';
import LogInterviewModal from '../../components/discovery/LogInterviewModal';
import { NewHypothesisDialog, LinkPainDialog } from './ValidateDialogs';
import { bucketForPath, bucketTitle, zoneForPath } from '../shellConfig';

/**
 * Validate — the four evidence stages, as four routes.
 *
 * THE SHAPE THIS REPLACES. Validate used to be organised around three tools:
 * Discovery (with its own leads/interviews/insights tabs), the Needs
 * Marketplace, and AI Advisory. The canvas organises it around evidence
 * instead — interviews feed a pain map, pain feeds hypotheses, hypotheses feed
 * a verdict — which is a different shape, not a rename.
 *
 * WHAT MOVED AND WHAT DID NOT. Interviews and Pain map read the SAME live
 * records Discovery always did: `api.listInterviews` and `api.painGroups`.
 * Nothing was copied, forked or re-derived — this is a second door onto one
 * record, which is why editing an interview here and there cannot disagree.
 * The Needs Marketplace and AI Advisory keep their own routes; the canvas has
 * no seat for them and quietly dropping two working tools to make a taxonomy
 * fit is not a migration, so they are linked from Interviews rather than
 * deleted.
 *
 * HYPOTHESES AND VERDICT HAVE A BACKEND NOW, and this header used to say they
 * did not. Migration 211 added `hypotheses`, `hypothesis_pain_links` and
 * `validation_decisions`, plus `discovery_interviews.quote_consent` — so the
 * boards read live records and the consent column is real.
 *
 * `quote_consent` HAS A WRITER, AND THIS HEADER USED TO SAY IT DID NOT. That
 * sentence was true when it was written and is not now: `progress.ts` accepts
 * `quote_consent` by name on the interview create and update, and
 * `DiscoveryPage`'s interview modal carries the control that sends it. The claim
 * mattered because it is the fourth step of the filter check — a column with no
 * screen behind it can only ever be NULL — so leaving it standing would have
 * argued a live chip out of existence. `interview_pain_severities` is the half
 * that is STILL true: it exists with no reader and no writer anywhere, which is
 * why `/validate/pain-map`'s "Need-to-have" is prose rather than a chip.
 *
 * THE HEADER'S ACTION SLOT. `WorkspaceShell` has always had one; the first
 * version of this file was the first zone page in the product to pass it, which
 * is why a page built to log interviews had no way to log one. The row lives in
 * the bodies now, as a `ZoneToolbar` over the shared tables — see the note above
 * `zoneKey` below, and D67.
 */

const useProjectId = () => {
  const [projectId, setProjectId] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    api.listProjects?.()
      .then((rows) => {
        if (!alive) return;
        const list = Array.isArray(rows) ? rows : (rows?.projects || []);
        setProjectId(list[0]?.id ?? null);
      })
      .catch(() => { if (alive) setProjectId(null); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  return { projectId, ready };
};

function StatRow({ items }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label} className="px-3 py-2.5">
          <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{it.label}</div>
          {it.value === null || it.value === undefined
            ? <div className="mt-1.5"><NotRecorded /></div>
            : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{it.value}</div>}
          {it.note && <div className="mt-1 text-[10px] leading-snug text-axal-ink-3">{it.note}</div>}
        </Card>
      ))}
    </div>
  );
}

// The canvas's four views of the interview log, and the record field each one
// reads. Both fields are three-state and both are WRITTEN — `progress.ts`
// accepts `icp_fit` and `quote_consent` by name and `DiscoveryPage`'s modal
// sends them — which is the step `/research/funds` failed with three chips over
// a column no screen could set.
//
// `null` IS NOT `none`, ON EITHER FIELD. An unassessed interview is not "not our
// customer" and an unasked consent question is not a refusal, so `Not ICP` reads
// `=== 'none'` rather than `!== 'strong'`, and `Deck-eligible` reads `=== true`.
// The stat strip below already counts them apart for the same reason.
const INTERVIEW_VIEWS = {
  all: () => true,
  deck: (r) => r.quote_consent === true,
  strong: (r) => r.icp_fit === 'strong',
  'not-icp': (r) => r.icp_fit === 'none',
};

function Interviews({ projectId, ready, reloadKey = 0, onLog, zoneFilters, zoneActions }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('all');
  // Read here as well as on the shell: attaching a recording is data entry and
  // is always available, transcribing spends money and sits behind the switch.
  // The hook is one shared store, so both readers see the same answer.
  const [fillsOn] = useAssistMode('Validate');
  // Bumped after an upload or a transcription so the row re-reads itself
  // rather than holding a stale copy of the record it just changed.
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    if (!ready || !projectId) return undefined;
    let alive = true;
    api.listInterviews(projectId)
      .then((r) => { if (alive) setRows(Array.isArray(r) ? r : (r?.interviews || [])); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
    // `reloadKey` is the signal from the header's "Log an interview" action:
    // the modal lives on the shell, the list lives here, and this is the seam.
    // `localKey` is the same seam for a change made inside a row.
  }, [projectId, ready, reloadKey, localKey]);

  if (!ready) return <Skeleton className="h-40" />;
  if (!projectId) {
    return (
      <EmptyState
        title="No venture yet"
        description="Validate reads the interviews logged against a venture. Create one and the evidence stages fill from it."
        action={<Link to="/build" className="text-axal-violet underline">Go to projects</Link>}
      />
    );
  }
  if (error) return <ErrorState error={error} />;
  if (!rows) return <Skeleton className="h-40" />;

  const withPain = rows.filter((r) => (r.pain_points || r.pains || []).length > 0);
  // Migration 211 gave an interview `quote_consent`, and it is three-state on
  // purpose — true, false, or never asked. Folding null into false would report
  // "declined" for every interview logged before the column existed, so the
  // count below is consenting interviews only and the note carries the rest.
  const consented = rows.filter((r) => r.quote_consent === true).length;
  const consentUnasked = rows.filter((r) => r.quote_consent === null || r.quote_consent === undefined).length;
  // The stat strip keeps counting the WHOLE log — it reports the evidence base,
  // and a base that shrank when a chip was clicked would be a different claim.
  // Only the list narrows.
  const shown = rows.filter(INTERVIEW_VIEWS[view] || INTERVIEW_VIEWS.all);

  return (
    <div className="space-y-4">
      <ZoneToolbar
        role="founder"
        filters={zoneFilters ? zoneFilters({ value: view, onChange: setView }) : []}
        actions={zoneActions ? zoneActions() : []}
      />
      <StatRow items={[
        { label: 'Interviews logged', value: rows.length, note: 'the base every later stage counts against' },
        { label: 'With a pain recorded', value: withPain.length, note: 'an interview with no pain feeds nothing downstream' },
        { label: 'Consent to quote', value: consented, note: consentUnasked ? `${consentUnasked} never asked — not the same as declined` : 'recorded on the interview' },
        { label: 'Deck-eligible', value: consented, note: 'an interview may be quoted in the deck only with consent on file' },
      ]} />

      {rows.length === 0 ? (
        <EmptyState
          title="No interviews logged"
          description="Log the first conversation and the pain map, hypotheses and verdict all start from it. Nothing here is inferred — an empty log means an empty page, on purpose."
          action={(
            <button type="button" onClick={onLog} data-testid="link-empty-log-interview" className="text-axal-violet underline">
              Log an interview
            </button>
          )}
        />
      ) : (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">Interview log</span>
            <span className="text-[11px] text-axal-ink-3">
              {view === 'all' ? 'One venture · newest first' : `${shown.length} of ${rows.length} · newest first`}
            </span>
          </div>
          {/*
            A live filter returning nothing is a real answer, and it has to be
            SAID. Left as a bare empty list it reads as "no interviews logged",
            which is the sentence the empty state above owns and which is not
            true here — the log has rows, none of them in this view.
          */}
          {shown.length === 0 && (
            <p className="py-2 text-[11px] text-axal-ink-3" data-testid="text-interviews-view-empty">
              No interview in this log matches that view. The count in the strip above is the full log.
            </p>
          )}
          <ul className="divide-y divide-axal-border-soft">
            {shown.slice(0, 25).map((r) => {
              const pains = r.pain_points || r.pains || [];
              return (
                <li key={r.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-4">
                  {/*
                    THE REAL COLUMN NAMES. This block read `r.contact_name ||
                    r.name` and `r.company || r.segment` — four keys the worker
                    has never emitted. `serializeInterview` returns
                    `interviewee_name`, `interviewee_role` and
                    `interviewee_company`, so every row in this log rendered
                    "Unnamed contact" and "No segment recorded" no matter what
                    had been typed into it. The date was the same mistake one
                    step quieter: `r.date` is undefined, so it fell through to
                    `created_at` and showed when the row was written rather than
                    when the conversation happened.
                  */}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-axal-ink">
                      {r.interviewee_name || <NotRecorded>Name not recorded</NotRecorded>}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-axal-ink-3">
                      {r.interviewee_company || r.interviewee_role || <NotRecorded>No company recorded</NotRecorded>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] tabular-nums text-axal-ink-2">
                      {r.interview_date || <NotRecorded>No date</NotRecorded>}
                    </div>
                    <div className="mt-0.5 text-[10px] text-axal-ink-3">
                      {pains.length ? `${pains.length} pain${pains.length === 1 ? '' : 's'}` : 'no pain recorded'}
                    </div>
                    </div>
                  </div>
                  {/*
                    The recording, and the text it becomes. Attaching is data
                    entry and is always offered; transcribing spends money and
                    sits behind the rail's switch, so a founder who turned that
                    off finds no control here that still runs a model.
                  */}
                  <InterviewRecording
                    interview={r}
                    fillsOn={fillsOn}
                    onChanged={() => setLocalKey((n) => n + 1)}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-t border-axal-border-soft pt-3 text-[11px] leading-relaxed text-axal-ink-3">
            These are the same records Discovery writes — one log, two doors. Consent to quote is a real field on
            an interview and it is three-state: yes, no, or never asked. Never-asked is counted apart from
            declined rather than folded into it, and nothing here presumes an interview quotable — that is the one
            mistake this stage cannot make. No screen writes the field yet, so on most rows it is still unasked.
          </p>
        </Card>
      )}

      <Card className="p-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Still here, still working</div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-2">
          The Needs Marketplace and AI Advisory have no zone in the four evidence stages, so they keep their own
          routes rather than being dropped to make the taxonomy fit — {' '}
          <Link to="/build/marketplace" className="text-axal-violet underline">Marketplace</Link> and{' '}
          <Link to="/advisory" className="text-axal-violet underline">Advisory</Link>. Where they belong in the new
          shell is a decision, not an accident.
        </p>
      </Card>
    </div>
  );
}

// No filter state here, and that is the table's answer rather than an omission:
// all four of this zone's canvas labels are `unbuilt`, so `zoneFilters` returns
// an empty array and the toolbar draws its action side only. See
// `founderZoneFilters.js` for why a grouped view cannot narrow by ICP.
function PainMap({ projectId, ready, zoneFilters, zoneActions }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ready || !projectId) return undefined;
    let alive = true;
    api.painGroups(projectId)
      .then((v) => { if (alive) setView(v || { groups: [], ungrouped: [], interview_total: 0 }); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [projectId, ready]);

  if (!ready) return <Skeleton className="h-40" />;
  if (!projectId) return <EmptyState title="No venture yet" description="Pain themes are grouped per venture." />;
  if (error) return <ErrorState error={error} />;
  if (!view) return <Skeleton className="h-40" />;

  const groups = view.groups || [];
  const ungrouped = view.ungrouped || [];
  const total = view.interview_total || 0;
  const ranked = [...groups].sort((a, b) => (b.phrases?.length || 0) - (a.phrases?.length || 0));
  const top = ranked[0];

  return (
    <div className="space-y-4">
      <ZoneToolbar
        role="founder"
        filters={zoneFilters ? zoneFilters({}) : []}
        actions={zoneActions ? zoneActions() : []}
      />
      <StatRow items={[
        // WAS "founder-curated, never AI-grouped", and that stopped being
        // true when migration 214 landed. What is still true, and is the
        // distinction worth keeping, is that a THEME is only ever named by a
        // person: Eadwyn sorts phrases into themes the founder wrote, and the
        // proposal parser refuses any group id that is not already one of
        // theirs.
        { label: 'Themes', value: groups.length, note: 'you name them; nothing else does' },
        { label: 'Interviews behind them', value: total, note: 'the denominator for every frequency below' },
        { label: 'Ungrouped phrases', value: ungrouped.length, note: 'logged, not yet themed' },
        { label: 'Severity tiering', value: null, note: 'need / good / nice is not a field a pain carries yet' },
      ]} />

      {groups.length === 0 && ungrouped.length === 0 ? (
        <EmptyState
          title="No pains logged yet"
          description="Pain themes are grouped from the pains recorded against interviews. Until one is logged this map has nothing to draw, and drawing it anyway would be inventing the finding."
          action={<Link to="/validate/interviews" className="text-axal-violet underline">Back to interviews</Link>}
        />
      ) : (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">Pain themes</span>
            <span className="text-[11px] text-axal-ink-3">Frequency across {total} interview{total === 1 ? '' : 's'}</span>
          </div>
          <ul className="space-y-2.5">
            {ranked.map((g) => {
              const n = g.phrases?.length || 0;
              const pct = total ? Math.round((n / total) * 100) : 0;
              return (
                <li key={g.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs font-semibold">{g.title}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-axal-ink-3">
                      {n} phrase{n === 1 ? '' : 's'}{total ? ` · ${pct}%` : ''}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-axal-surface-2">
                    <div className="h-full rounded-full bg-axal-violet" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {ungrouped.length > 0 && (
            <p className="mt-3 text-[11px] text-axal-ink-3">
              {ungrouped.length} phrase{ungrouped.length === 1 ? '' : 's'} not yet in a theme. They count in the log and
              not in the map — a phrase in no theme is evidence, not a finding.
            </p>
          )}
          <p className="mt-3 border-t border-axal-border-soft pt-3 text-[11px] leading-relaxed text-axal-ink-3">
            Percentages are phrases over interviews, so a theme two people named twice each does not read as four
            people. {top ? `“${top.title}” leads at ${total ? Math.round(((top.phrases?.length || 0) / total) * 100) : 0}%.` : ''}{' '}
            Severity tiering — need-to-have, good-to-have, nice-to-have — is what the canvas adds here, and it needs a
            field on the pain record that does not exist yet, so the column reads “Not recorded” instead of guessing.
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * BOTH ZONES READ ONE ENDPOINT, AND NEITHER INVENTS A NUMBER.
 *
 * `NotBackedYet` used to stand here and said "nothing in the product stores
 * either". Migration 211 gave both a store, so the card was deleted rather than
 * reworded — a no-store card in front of a store is as false as one that
 * overstates, it merely fails in the direction that looks humble.
 *
 * The card was also wrong about the past: `discovery_interviews.hypotheses_json`
 * had held per-interview hypotheses all along, and the demo-day deck and the
 * discovery signals score both read them. What was missing was a claim as ONE
 * object across interviews, which is what the board is.
 *
 * `verdict: null` IS A REAL STATE HERE, not a loading flicker. The worker
 * refuses a verdict when interviews touching a claim have no ICP fit recorded,
 * because counting an unrecorded fit as "not our customer" would print
 * "Unproven" on every claim in the product, in the same font as a verdict
 * somebody earned.
 */
const LANES = [
  ['none', 'No evidence'],
  ['testing', 'Testing'],
  ['validated', 'Validated'],
  ['invalidated', 'Invalidated'],
  ['unknown', 'Fit not recorded'],
];

const VERDICT_LABEL = { validated: 'Validated', invalidated: 'Invalidated', unproven: 'Unproven' };

/**
 * One shared load, so both zones agree about the same interviews.
 *
 * It is called ONCE, at the top of this file's default export, and handed down
 * — rather than by each zone that wants it. That is what lets the header's
 * "New hypothesis" and "Link to a pain" actions refresh the board they just
 * wrote to: `reloadKey` is the only channel between a dialog above the body and
 * the data below it.
 */
function useBoard(projectId, ready, reloadKey = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!ready || !projectId) return undefined;
    let alive = true;
    setData(null); setError(null);
    api.getValidationBoard(projectId)
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [projectId, ready, reloadKey]);
  return { data, error };
}

function NoVenture({ what }) {
  return (
    <EmptyState
      title="No venture yet"
      description={`${what} reads the interviews logged against a venture. Create one and the evidence stages fill from it.`}
      action={<Link to="/build" className="text-axal-violet underline">Go to projects</Link>}
    />
  );
}

/** The line that stops a zero reading as a finding. */
function FitGap({ base }) {
  if (!base || !base.fit_not_recorded) return null;
  return (
    <Card className="border-dashed bg-axal-surface-2 px-3.5 py-2.5">
      <p className="text-[12px] leading-relaxed text-axal-ink-2">
        <span className="font-semibold">{base.fit_not_recorded}</span>
        {base.fit_not_recorded === 1 ? ' interview has ' : ' interviews have '}
        no ICP fit recorded. Those cannot count toward a claim, so any verdict that
        depends on them is withheld rather than guessed — an unrecorded fit is not
        the same as “not our customer”.{' '}
        <Link to="/build/discovery?tab=interviews" className="text-axal-violet underline">
          Record it on the interview
        </Link>
        .
      </p>
    </Card>
  );
}

// `Blocking the verdict` is not a new computation — `buildBoard` already writes
// `_note` on exactly these claims, because a null verdict has to be explained
// rather than rendered as a blank cell. The chip narrows to the claims that note
// is about. `Retired` reads `retired_at`, which migration 211 created FOR this
// label and which nothing could write until the control below existed.
const HYPOTHESIS_VIEWS = {
  all: (h) => !h.retired_at,
  blocking: (h) => !h.retired_at && h.verdict === null,
  retired: (h) => Boolean(h.retired_at),
};

function HypothesisBoard({ projectId, ready, board, onNew, onRetire, retiring, zoneFilters, zoneActions }) {
  const { data, error } = board;
  const [view, setView] = useState('all');
  if (!ready) return <Skeleton className="h-40" />;
  if (!projectId) return <NoVenture what="The hypothesis board" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Skeleton className="h-40" />;

  const items = data.hypotheses || [];
  const live = items.filter((h) => !h.retired_at);
  const base = data.evidence_base || {};
  const shown = items.filter(HYPOTHESIS_VIEWS[view] || HYPOTHESIS_VIEWS.all);
  const byLane = (lane) => shown.filter((h) => h.lane === lane);

  return (
    <div className="space-y-4">
      <ZoneToolbar
        role="founder"
        filters={zoneFilters ? zoneFilters({ value: view, onChange: setView }) : []}
        actions={zoneActions ? zoneActions() : []}
      />
      <StatRow items={[
        { label: 'Hypotheses', value: live.length, note: `${byLane('validated').length} validated, ${byLane('invalidated').length} invalidated` },
        { label: 'Awaiting evidence', value: byLane('testing').length + byLane('none').length, note: 'not yet at the bar either way' },
        { label: 'Bar per claim', value: data.bar, note: 'ICP interviews to validate · not configurable yet' },
        // A count that cannot be computed is shown as absent, not as zero.
        { label: 'Verdict withheld', value: byLane('unknown').length || null, note: 'claims whose evidence has no ICP fit recorded' },
      ]} />

      <FitGap base={base} />

      {items.length === 0 ? (
        <EmptyState
          title="No hypotheses yet"
          description="A hypothesis names what you believe and which pain themes would prove or disprove it. Add one and the interviews already logged start counting toward it. Nothing here is inferred — an empty board means an empty board, on purpose."
          action={(
            <button type="button" onClick={onNew} data-testid="link-empty-new-hypothesis" className="text-axal-violet underline">
              Add a hypothesis
            </button>
          )}
        />
      ) : shown.length === 0 ? (
        // A live chip that matches nothing has to say which question it just
        // answered. Falling through to the board's own "No hypotheses yet" would
        // report an empty board, which is a different and untrue claim.
        <p className="text-[12px] text-axal-ink-3" data-testid="text-hypotheses-view-empty">
          {view === 'retired'
            ? 'No claim has been retired. A retired claim stays on the record — it is never deleted — so this view fills the first time you retire one.'
            : 'No claim is waiting on an ICP fit. Every hypothesis on the board has the evidence it needs for a verdict.'}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {LANES.map(([lane, label]) => {
            const cards = byLane(lane);
            if (!cards.length) return null;
            return (
              <Card key={lane} className="p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</span>
                  <span className="text-[11px] tabular-nums text-axal-ink-3">{cards.length}</span>
                </div>
                <ul className="mt-2.5 space-y-2.5">
                  {cards.map((h) => (
                    <li key={h.id} className="rounded-lg border border-axal-border-soft p-2.5">
                      <div className="text-[12.5px] font-semibold leading-snug">
                        <span className="text-axal-ink-3">{h.code} · </span>{h.claim}
                      </div>
                      <div className="mt-1 text-[11px] tabular-nums text-axal-ink-3">
                        {h.evidence.supporting} support · {h.evidence.contradicting} contradict
                        {h.evidence.fitUnrecorded > 0 && ` · ${h.evidence.fitUnrecorded} of unknown fit`}
                      </div>
                      <div className="mt-0.5 text-[11px] text-axal-ink-3">
                        {h.bar_note || 'Distance to the bar cannot be computed until the fits above are recorded.'}
                      </div>
                      {/*
                        RETIRE, NEVER DELETE. The worker has taken both
                        directions since migration 211 and `retired_at` was
                        created for the canvas's "Retired" filter — but nothing
                        in the product called `api.updateHypothesis`, so the
                        column could only ever be NULL and both labels that read
                        it filtered an empty set. This is the caller it was
                        missing. An abandoned claim is evidence about how the
                        venture thought, which is why it comes back rather than
                        going away.
                      */}
                      {onRetire && (
                        <button
                          type="button"
                          onClick={() => onRetire(h.id, !h.retired_at)}
                          disabled={retiring === h.id}
                          data-testid={`button-retire-hypothesis-${h.id}`}
                          className="mt-1.5 text-[11px] font-semibold text-axal-ink-3 underline decoration-dotted underline-offset-2 hover:text-axal-violet disabled:opacity-50"
                        >
                          {retiring === h.id
                            ? 'Saving…'
                            : h.retired_at ? 'Restore this claim' : 'Retire this claim'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-axal-ink-3">
        Lanes are computed from the evidence, never dragged: a claim sits where its
        interviews put it. The canvas also draws “Recently moved”, and nothing
        records a claim changing lanes — so that chip is not shown at all, rather
        than shown over a set it cannot compute.
      </p>
    </div>
  );
}

// The summary's two live views. `Current` is the working set — the claims still
// standing — and `Retired claims` is the record of the ones that are not, which
// exists because a retired claim is never deleted. The canvas's other two labels
// ask for the board as it stood at a past moment, and no such moment is stored.
const SUMMARY_VIEWS = {
  current: (h) => !h.retired_at,
  retired: (h) => Boolean(h.retired_at),
};

function ValidationSummary({ projectId, ready, board, zoneFilters, zoneActions }) {
  const { data, error } = board;
  const [decision, setDecision] = useState(undefined);
  const [view, setView] = useState('current');

  useEffect(() => {
    if (!ready || !projectId) return undefined;
    let alive = true;
    api.getValidationDecision(projectId)
      // A 403 here is the designed outcome for a partner, not a failure: the
      // decision is the founder's own and the board above is not.
      .then((r) => { if (alive) setDecision(r); })
      .catch(() => { if (alive) setDecision(null); });
    return () => { alive = false; };
  }, [projectId, ready]);

  if (!ready) return <Skeleton className="h-40" />;
  if (!projectId) return <NoVenture what="The validation summary" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Skeleton className="h-40" />;

  const items = data.hypotheses || [];
  const live = items.filter((h) => !h.retired_at);
  const base = data.evidence_base || {};
  const current = decision === undefined ? undefined : decision?.current || null;
  // The strip keeps reporting the standing claims whichever view is selected:
  // "Validated 3 of 4" is a statement about the venture, not about the table
  // below it, and it would be a different sentence over the retired set.
  const shown = items.filter(SUMMARY_VIEWS[view] || SUMMARY_VIEWS.current);

  return (
    <div className="space-y-4">
      <ZoneToolbar
        role="founder"
        filters={zoneFilters ? zoneFilters({ value: view, onChange: setView }) : []}
        actions={zoneActions ? zoneActions() : []}
      />
      <StatRow items={[
        { label: 'Validated', value: live.filter((h) => h.verdict === 'validated').length, note: `of ${live.length} claims` },
        { label: 'Evidence base', value: base.interviews ?? 0, note: `${base.icp ?? 0} recorded as ICP · bar is ${data.bar}` },
        // Consent is a three-state fact; when nobody has been asked, the tile
        // says so rather than reporting zero people willing to be quoted.
        { label: 'Quotable', value: base.consent_not_recorded === base.interviews && base.interviews > 0 ? null : base.quotable, note: 'consent on file' },
        { label: 'Deck anchors', value: null, note: 'the anchor rule is not built' },
      ]} />

      <FitGap base={base} />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing to reconcile yet"
          description="The summary reads the hypothesis board. Add a claim there and its evidence appears here with the interviews behind it."
          action={<Link to="/validate/hypotheses" className="text-axal-violet underline">See hypotheses</Link>}
        />
      ) : shown.length === 0 ? (
        <p className="text-[12px] text-axal-ink-3" data-testid="text-summary-view-empty">
          No claim has been retired. Retiring one on the hypothesis board keeps it
          here rather than deleting it, and this view is where it lands.
        </p>
      ) : (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">
              {view === 'retired' ? 'Retired claims, with their receipts' : 'Every verdict, with its receipts'}
            </span>
            <span className="text-[11px] text-axal-ink-3">Computed from the interview log</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                  <th className="py-1.5 pr-3">Hypothesis</th>
                  <th className="py-1.5 pr-3 text-right">For</th>
                  <th className="py-1.5 pr-3 text-right">Against</th>
                  <th className="py-1.5 pr-3">Verdict</th>
                  <th className="py-1.5">Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-axal-border-soft">
                {shown.map((h) => (
                  <tr key={h.id} className="align-top">
                    <td className="py-2 pr-3">
                      <span className="text-axal-ink-3">{h.code} · </span>{h.claim}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{h.evidence.supporting}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{h.evidence.contradicting}</td>
                    <td className="py-2 pr-3">
                      {h.verdict ? VERDICT_LABEL[h.verdict] : <NotRecorded />}
                    </td>
                    <td className="py-2 text-[11px] text-axal-ink-3">
                      {h.bar_note || h._note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          What the venture decided
        </div>
        {current === undefined ? <div className="mt-2"><Skeleton className="h-10" /></div>
          : current === null ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
              {decision === null
                ? 'Not shown here. A venture’s proceed, pivot or stop is its own — the board above is read by studio staff and service partners, and this is not.'
                : 'No decision recorded. The summary above is evidence; this is the call a person makes in front of it, and nobody has made one yet.'}
            </p>
          ) : (
            <>
              <div className="mt-1.5 text-base font-extrabold capitalize tracking-tight">{current.decision}</div>
              {current.reasoning && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-axal-ink-2">{current.reasoning}</p>
              )}
              <div className="mt-1.5 text-[11px] text-axal-ink-3">
                Recorded {String(current.decided_at || '').slice(0, 10)}
                {(decision?.history?.length || 0) > 1 && ` · ${decision.history.length - 1} earlier decision(s) kept`}
              </div>
            </>
          )}
      </Card>
    </div>
  );
}

export default function FounderValidateWorkspace() {
  const location = useLocation();
  const { projectId, ready } = useProjectId();
  const bucket = bucketForPath('founder', location.pathname);
  // The root opt-out every sibling route module carries — NetworkWorkspace,
  // ResearchWorkspace, AdvisorBucketRoutes, PartnerBucketRoutes. `zoneForPath`
  // answers a bucket root with its FIRST zone, so without this a root that
  // mounted here would light "Interviews" in the pill row and title itself
  // Interviews. `/validate` routes elsewhere today, which is precisely why
  // this was the one module missing the guard: nothing made it visible.
  const isRoot = Boolean(bucket) && location.pathname === bucket.prefix;
  const zone = zoneForPath(bucket, location.pathname);

  // The modal lives here rather than in `Interviews` because the button that
  // opens it lives in the SHELL's header, above the body — one owner for both.
  const [logOpen, setLogOpen] = useState(false);
  const [hypOpen, setHypOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [boardKey, setBoardKey] = useState(0);
  const board = useBoard(projectId, ready, boardKey);

  const saveInterview = async (payload) => {
    await api.createInterview(projectId, payload);
    setLogOpen(false);
    setReloadKey((n) => n + 1);
  };
  const saveHypothesis = async (payload) => {
    await api.createHypothesis(projectId, payload);
    setHypOpen(false);
    setBoardKey((n) => n + 1);
  };
  const saveLink = async (hypothesisId, payload) => {
    await api.linkHypothesisPain(hypothesisId, payload);
    setLinkOpen(false);
    setBoardKey((n) => n + 1);
  };

  // One shape for all three exports. The failure that matters is a 403 on the
  // summary — `canReadDecision` excludes partners — and it must read as a
  // refusal in the header rather than as a file that silently never arrives.
  const [busy, setBusy] = useState('');
  const [exportError, setExportError] = useState('');
  const runExport = async (key, fn) => {
    setBusy(key); setExportError('');
    try {
      await fn(projectId);
    } catch (e) {
      setExportError(e?.message || 'The export could not be produced.');
    } finally {
      setBusy('');
    }
  };
  // What the table's `kind: 'handler'` entries bind to. The busy flag and the
  // "no venture" disable both live here, which is the reason a table could not
  // express these ops and the reason the builder now takes an object rather than
  // a bare function.
  const exportHandler = (testid, fn) => ({
    disabled: !projectId, busy: busy === testid, onClick: () => runExport(testid, fn),
  });

  // RETIRE AND RESTORE. `retired_at` has existed since migration 211, created
  // for the canvas's "Retired" filter, and `api.updateHypothesis` had no caller
  // anywhere in the SPA — so the column could only ever be NULL and both labels
  // over it filtered an empty set forever. A failure re-reads the board rather
  // than leaving the card showing a state the server did not accept.
  const [retiring, setRetiring] = useState(null);
  const retireHypothesis = async (id, retired) => {
    setRetiring(id); setExportError('');
    try {
      await api.updateHypothesis(id, { retired });
    } catch (e) {
      setExportError(e?.message || 'That claim could not be updated.');
    } finally {
      setRetiring(null);
      setBoardKey((n) => n + 1);
    }
  };

  // Shared with the rail's switch through a module store — see
  // hooks/useAssistMode.js for why not a provider.
  const [fillsOn] = useAssistMode('Validate');

  // THE OPS THIS COMPONENT PERFORMS, named for the table's `handler:` keys. They
  // are this component's rather than a body's because the dialogs, the busy flag
  // and the shared error line are — which is the whole reason a table needed a
  // fourth kind to declare them.
  const handlers = {
    logInterview: { disabled: !projectId, onClick: () => setLogOpen(true) },
    newHypothesis: { disabled: !projectId, onClick: () => setHypOpen(true) },
    // Nothing to link until the board has both ends of a link. The dialog says
    // which end is missing; the button opens it either way so the reader learns
    // that rather than finding a control that does nothing.
    linkPain: { disabled: !projectId, onClick: () => setLinkOpen(true) },
    exportInterviews: exportHandler('action-export-interviews', api.exportValidateInterviews),
    exportPainMap: exportHandler('action-export-pain-map', api.exportValidatePainMap),
    exportSummary: exportHandler('action-export-summary', api.exportValidateSummary),
  };

  // EACH BODY NAMES ITS OWN ZONE, RATHER THAN THIS COMPONENT COMPUTING THE KEY.
  // `validate/${zone.slug}` worked and was invisible to both profile guards —
  // they find a mount by searching for the builder with a LITERAL key, which is
  // what proves a declared zone is on screen somewhere. A computed key satisfies
  // the compiler and nothing else, so the four keys are spelled out.
  const body = useMemo(() => {
    switch (zone?.slug) {
      case 'pain-map':
        return (
          <PainMap
            projectId={projectId}
            ready={ready}
            zoneFilters={(opts) => founderZoneFilters('validate/pain-map', opts)}
            zoneActions={() => founderZoneActions('validate/pain-map', { handlers })}
          />
        );
      case 'hypotheses':
        return (
          <HypothesisBoard
            projectId={projectId}
            ready={ready}
            board={board}
            onNew={() => setHypOpen(true)}
            onRetire={retireHypothesis}
            retiring={retiring}
            zoneFilters={(opts) => founderZoneFilters('validate/hypotheses', opts)}
            zoneActions={() => founderZoneActions('validate/hypotheses', { handlers })}
          />
        );
      case 'verdict':
        return (
          <ValidationSummary
            projectId={projectId}
            ready={ready}
            board={board}
            zoneFilters={(opts) => founderZoneFilters('validate/verdict', opts)}
            zoneActions={() => founderZoneActions('validate/verdict', { handlers })}
          />
        );
      case 'interviews':
      default:
        return (
          <Interviews
            projectId={projectId}
            ready={ready}
            reloadKey={reloadKey}
            onLog={() => setLogOpen(true)}
            zoneFilters={(opts) => founderZoneFilters('validate/interviews', opts)}
            zoneActions={() => founderZoneActions('validate/interviews', { handlers })}
          />
        );
    }
    // `busy`, `retiring` and `projectId` all change what the handlers report, so
    // the row would otherwise keep rendering a stale disabled or busy state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone?.slug, projectId, ready, reloadKey, board, busy, retiring]);

  // WHY THE ROW MOVED OUT OF THE SHELL'S `actions` SLOT AND INTO THE BODIES.
  // This workspace was the first zone page in the product to use that slot, and
  // for one release it held a local `ACTIONS` map — the only zone header in the
  // product built outside `founderZoneActions.js`, and therefore the only one no
  // canvas guard could check. It was outside by necessity: `zoneActionBuilder`
  // could express an export over loaded rows, a link, and a gap, and every op
  // here is a dialog this component owns or a server-side download it tracks.
  //
  // `kind: 'handler'` is that missing vocabulary (D67), so the map is gone and
  // the ops come from the shared table like every other zone's. The row is now a
  // `ZoneToolbar` rendered by each BODY rather than by the shell, because the
  // filter half needs `value` and `onChange` that only the body has — the shape
  // D53 records and `ResearchWorkspace` established. One toolbar per body, and
  // the shell's `actions` slot goes back to being unused here.

  const INTRO = {
    interviews: 'Every conversation logged against this venture. The same records Discovery writes — one log, two doors.',
    'pain-map': 'What the interviews actually said, grouped into themes you curate. Frequency is counted, never estimated.',
    hypotheses: 'What you believe, what would prove it, and what would kill it.',
    verdict: 'What the evidence decided, and when.',
  };

  return (
    <WorkspaceShell
      role="founder"
      rail={(
        <WorkerRail
          workspace="Validate"
          stance="Evidence-led view"
          note="Nothing is written without your click. Proposals are accept, edit or discard."
          coverage={[projectId ? `Venture #${projectId} selected` : 'No venture selected']}
          // The Transcription gap named here is closed by migration 215 — a
          // recording has a home and a transcript has a column — so the entry
          // is gone rather than left saying something untrue. What replaces it
          // is the next honest absence: Whisper returns speaker turns and
          // timestamps, and this product has nowhere to show either, so it
          // stores neither.
          unavailable={[['Speaker labels', 'A transcript is one block of text. Who said which line is not something this stores.']]}
          fills
        />
      )}
      scope="One venture"
      title={isRoot ? bucketTitle(bucket) : undefined}
      activeSlug={isRoot ? null : undefined}
      intro={INTRO[zone?.slug] || INTRO.interviews}
    >
      {exportError && (
        <p
          data-testid="status-export-error"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {exportError}
        </p>
      )}
      {/*
        The proposal band, above the records it is about. Two zones have one,
        because two things can be filled in: the pain map sorts phrases into
        themes, the hypothesis board drafts claims. The other two zones have
        nothing a model can propose — an interview is a conversation someone
        had, and a verdict is computed from evidence rather than suggested —
        so they draw nothing rather than an empty band.

        `key` on the zone so switching zones remounts it: the two kinds hold
        different lists and different copy, and a stale list flashing under a
        new heading is worse than a moment's blank.
      */}
      {zone?.slug === 'pain-map' && (
        <ValidateProposals
          key="pain-map"
          projectId={projectId}
          kind="pain_tag"
          enabled={fillsOn}
          onApplied={() => setBoardKey((n) => n + 1)}
        />
      )}
      {zone?.slug === 'hypotheses' && (
        <ValidateProposals
          key="hypotheses"
          projectId={projectId}
          kind="hypothesis"
          enabled={fillsOn}
          onApplied={() => setBoardKey((n) => n + 1)}
        />
      )}
      {body}
      <LogInterviewModal
        open={logOpen}
        interview={null}
        onClose={() => setLogOpen(false)}
        onSave={saveInterview}
      />
      <NewHypothesisDialog open={hypOpen} onClose={() => setHypOpen(false)} onSave={saveHypothesis} />
      <LinkPainDialog
        open={linkOpen}
        hypotheses={(board.data?.hypotheses || []).filter((h) => !h.retired_at)}
        painGroups={board.data?.pain_groups || []}
        onClose={() => setLinkOpen(false)}
        onSave={saveLink}
      />
    </WorkspaceShell>
  );
}
