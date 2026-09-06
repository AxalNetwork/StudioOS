import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card, EmptyState, ErrorState, WorkerRail, Skeleton } from '../../ui';
import WorkspaceShell, { NotRecorded } from '../WorkspaceShell';
import ZoneActions from '../ZoneActions';
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
 * boards read live records and the consent column is real. Two things are still
 * absent and are still said out loud rather than drawn: nothing WRITES
 * `quote_consent` from any screen, and `interview_pain_severities` exists with
 * no reader and no writer.
 *
 * THE HEADER'S ACTION SLOT. `WorkspaceShell` has always had one; until this
 * change no workspace zone page in the product passed it, which is why a page
 * built to log interviews had no way to log one. See `../ZoneActions.jsx`.
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

function Interviews({ projectId, ready, reloadKey = 0, onLog }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
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
        action={<Link to="/projects" className="text-axal-violet underline">Go to projects</Link>}
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

  return (
    <div className="space-y-4">
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
            <span className="text-[11px] text-axal-ink-3">One venture · newest first</span>
          </div>
          <ul className="divide-y divide-axal-border-soft">
            {rows.slice(0, 25).map((r) => {
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

function PainMap({ projectId, ready }) {
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
      action={<Link to="/projects" className="text-axal-violet underline">Go to projects</Link>}
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

function HypothesisBoard({ projectId, ready, board, onNew }) {
  const { data, error } = board;
  if (!ready) return <Skeleton className="h-40" />;
  if (!projectId) return <NoVenture what="The hypothesis board" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Skeleton className="h-40" />;

  const items = data.hypotheses || [];
  const live = items.filter((h) => !h.retired_at);
  const base = data.evidence_base || {};
  const byLane = (lane) => live.filter((h) => h.lane === lane);

  return (
    <div className="space-y-4">
      <StatRow items={[
        { label: 'Hypotheses', value: live.length, note: `${byLane('validated').length} validated, ${byLane('invalidated').length} invalidated` },
        { label: 'Awaiting evidence', value: byLane('testing').length + byLane('none').length, note: 'not yet at the bar either way' },
        { label: 'Bar per claim', value: data.bar, note: 'ICP interviews to validate · not configurable yet' },
        // A count that cannot be computed is shown as absent, not as zero.
        { label: 'Verdict withheld', value: byLane('unknown').length || null, note: 'claims whose evidence has no ICP fit recorded' },
      ]} />

      <FitGap base={base} />

      {live.length === 0 ? (
        <EmptyState
          title="No hypotheses yet"
          description="A hypothesis names what you believe and which pain themes would prove or disprove it. Add one and the interviews already logged start counting toward it. Nothing here is inferred — an empty board means an empty board, on purpose."
          action={(
            <button type="button" onClick={onNew} data-testid="link-empty-new-hypothesis" className="text-axal-violet underline">
              Add a hypothesis
            </button>
          )}
        />
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
        interviews put it. Verdict history, a generated summary and its screening
        state are drawn on the canvas and are not built — so no filter for them is
        shown here rather than one that filters nothing.
      </p>
    </div>
  );
}

function ValidationSummary({ projectId, ready, board }) {
  const { data, error } = board;
  const [decision, setDecision] = useState(undefined);

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

  const live = (data.hypotheses || []).filter((h) => !h.retired_at);
  const base = data.evidence_base || {};
  const current = decision === undefined ? undefined : decision?.current || null;

  return (
    <div className="space-y-4">
      <StatRow items={[
        { label: 'Validated', value: live.filter((h) => h.verdict === 'validated').length, note: `of ${live.length} claims` },
        { label: 'Evidence base', value: base.interviews ?? 0, note: `${base.icp ?? 0} recorded as ICP · bar is ${data.bar}` },
        // Consent is a three-state fact; when nobody has been asked, the tile
        // says so rather than reporting zero people willing to be quoted.
        { label: 'Quotable', value: base.consent_not_recorded === base.interviews && base.interviews > 0 ? null : base.quotable, note: 'consent on file' },
        { label: 'Deck anchors', value: null, note: 'the anchor rule is not built' },
      ]} />

      <FitGap base={base} />

      {live.length === 0 ? (
        <EmptyState
          title="Nothing to reconcile yet"
          description="The summary reads the hypothesis board. Add a claim there and its evidence appears here with the interviews behind it."
          action={<Link to="/validate/hypotheses" className="text-axal-violet underline">See hypotheses</Link>}
        />
      ) : (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">Every verdict, with its receipts</span>
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
                {live.map((h) => (
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
  const exportAction = (label, testid, fn) => ({
    label, testid, disabled: !projectId, busy: busy === testid,
    onClick: () => runExport(testid, fn),
  });

  // Shared with the rail's switch through a module store — see
  // hooks/useAssistMode.js for why not a provider.
  const [fillsOn] = useAssistMode('Validate');

  const body = useMemo(() => {
    switch (zone?.slug) {
      case 'pain-map':
        return <PainMap projectId={projectId} ready={ready} />;
      case 'hypotheses':
        return <HypothesisBoard projectId={projectId} ready={ready} board={board} onNew={() => setHypOpen(true)} />;
      case 'verdict':
        return <ValidationSummary projectId={projectId} ready={ready} board={board} />;
      case 'interviews':
      default:
        return <Interviews projectId={projectId} ready={ready} reloadKey={reloadKey} onLog={() => setLogOpen(true)} />;
    }
  }, [zone?.slug, projectId, ready, reloadKey, board]);

  // WHY THIS IS THE FIRST ZONE PAGE IN THE PRODUCT TO USE `actions`.
  // `WorkspaceShell` has had the slot since it was written, and every caller
  // passing it was a Spin-Out Lab page — so `/validate/interviews`, a page
  // whose whole job is logging interviews, offered no way to log one. The
  // create path was never missing: `api.createInterview` and
  // `components/discovery/LogInterviewModal` have both been in place all along,
  // used by Discovery and by the Lab. Only this door was.
  //
  // The other three zones get their actions as their endpoints land. A zone
  // with nothing backed draws nothing — a button is a promise.
  const ACTIONS = {
    interviews: [
      {
        label: 'Log an interview',
        testid: 'action-log-interview',
        onClick: () => setLogOpen(true),
        // No venture means no `project_id` to write against; the button would
        // 400. The body already explains the state, so this just stays shut.
        disabled: !projectId,
      },
      exportAction('Export interviews', 'action-export-interviews', api.exportValidateInterviews),
    ],
    'pain-map': [
      exportAction('Export map', 'action-export-pain-map', api.exportValidatePainMap),
    ],
    hypotheses: [
      { label: 'New hypothesis', testid: 'action-new-hypothesis', onClick: () => setHypOpen(true), disabled: !projectId },
      {
        label: 'Link to a pain',
        testid: 'action-link-pain',
        onClick: () => setLinkOpen(true),
        // Nothing to link until the board has both ends of a link. The dialog
        // says which end is missing; the button opens it either way so the
        // reader learns that rather than finding a control that does nothing.
        disabled: !projectId,
      },
    ],
    verdict: [
      exportAction('Export summary', 'action-export-summary', api.exportValidateSummary),
    ],
    // "Send to Problem slide" is on the canvas for Pain map and Verdict and is
    // NOT here. It has no endpoint — and more to the point, the pain themes
    // already feed the deck's slide 2 (`pain_groups` is curated for exactly
    // that, see progress.ts), so a button that "sends" would be theatre over a
    // pipe that already runs. What it should become is a link that says so.
  };
  const actions = ACTIONS[zone?.slug] ? <ZoneActions items={ACTIONS[zone.slug]} /> : null;

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
      actions={actions}
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
