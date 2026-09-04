import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card, EmptyState, ErrorState, WorkerRail, Skeleton } from '../../ui';
import WorkspaceShell, { NotRecorded } from '../WorkspaceShell';
import { bucketForPath, zoneForPath } from '../shellConfig';

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
 * HYPOTHESES AND VERDICT HAVE NO BACKEND YET. Nothing in the product stores a
 * hypothesis board or a reconciled verdict. They ship as honest empty states
 * that say so and name what would fill them — not as fabricated boards, and
 * not as a 404 behind a sidebar row that promises a page.
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

function Interviews({ projectId, ready }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ready || !projectId) return undefined;
    let alive = true;
    api.listInterviews(projectId)
      .then((r) => { if (alive) setRows(Array.isArray(r) ? r : (r?.interviews || [])); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [projectId, ready]);

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

  return (
    <div className="space-y-4">
      <StatRow items={[
        { label: 'Interviews logged', value: rows.length, note: 'the base every later stage counts against' },
        { label: 'With a pain recorded', value: withPain.length, note: 'an interview with no pain feeds nothing downstream' },
        { label: 'Consent to quote', value: null, note: 'no consent field is stored on an interview yet' },
        { label: 'Deck-eligible', value: null, note: 'eligibility needs the consent field above' },
      ]} />

      {rows.length === 0 ? (
        <EmptyState
          title="No interviews logged"
          description="Log the first conversation and the pain map, hypotheses and verdict all start from it. Nothing here is inferred — an empty log means an empty page, on purpose."
          action={<Link to="/build/discovery?tab=interviews" className="text-axal-violet underline">Log an interview</Link>}
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
                <li key={r.id} className="flex items-start justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-axal-ink">
                      {r.contact_name || r.name || 'Unnamed contact'}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-axal-ink-3">
                      {r.company || r.segment || <NotRecorded>No segment recorded</NotRecorded>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] tabular-nums text-axal-ink-2">{r.date || r.created_at?.slice(0, 10) || '—'}</div>
                    <div className="mt-0.5 text-[10px] text-axal-ink-3">
                      {pains.length ? `${pains.length} pain${pains.length === 1 ? '' : 's'}` : 'no pain recorded'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-t border-axal-border-soft pt-3 text-[11px] leading-relaxed text-axal-ink-3">
            These are the same records Discovery writes — one log, two doors. Consent to quote is not a field an
            interview carries yet, so both consent columns read “Not recorded” rather than defaulting to yes;
            an interview presumed quotable is the one mistake this stage cannot make.
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
        { label: 'Themes', value: groups.length, note: 'founder-curated, never AI-grouped' },
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

/** One shared load, so both zones agree about the same interviews. */
function useBoard(projectId, ready) {
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
  }, [projectId, ready]);
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

function HypothesisBoard({ projectId, ready }) {
  const { data, error } = useBoard(projectId, ready);
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
          action={<Link to="/validate/pain-map" className="text-axal-violet underline">See the pain map</Link>}
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

function ValidationSummary({ projectId, ready }) {
  const { data, error } = useBoard(projectId, ready);
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
  const zone = zoneForPath(bucket, location.pathname);

  const body = useMemo(() => {
    switch (zone?.slug) {
      case 'pain-map':
        return <PainMap projectId={projectId} ready={ready} />;
      case 'hypotheses':
        return <HypothesisBoard projectId={projectId} ready={ready} />;
      case 'verdict':
        return <ValidationSummary projectId={projectId} ready={ready} />;
      case 'interviews':
      default:
        return <Interviews projectId={projectId} ready={ready} />;
    }
  }, [zone?.slug, projectId, ready]);

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
          note="This workspace does not generate, transcribe, or change records. It keeps the evidence surface readable."
          coverage={[projectId ? `Venture #${projectId} selected` : 'No venture selected']}
          unavailable={[['Automated grouping', 'Pain themes are founder-curated. Nothing here groups, scores or summarises an interview for you.']]}
        />
      )}
      scope="One venture"
      intro={INTRO[zone?.slug] || INTRO.interviews}
    >
      {body}
    </WorkspaceShell>
  );
}
