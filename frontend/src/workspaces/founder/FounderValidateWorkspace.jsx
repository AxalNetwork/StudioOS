import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card, EmptyState, ErrorState, Skeleton } from '../../ui';
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
 * Hypotheses and Verdict are net-new: nothing in the product stores either.
 * They render what they WOULD hold and say plainly that the store is missing,
 * which is the honest version of a page whose backend has not been built.
 */
function NotBackedYet({ title, what, feeds, from }) {
  return (
    <div className="space-y-4">
      <Card className="border-dashed bg-axal-surface-2 p-6">
        <div className="max-w-2xl">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-violet">
            No store behind this yet
          </div>
          <h2 className="mt-2 text-lg font-extrabold tracking-tight">{title}</h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{what}</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{feeds}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to={from.to}
              className="rounded-md border border-axal-violet bg-axal-violet px-3 py-1.5 text-[11px] font-bold text-white"
            >
              {from.label}
            </Link>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">
            This page ships empty on purpose. A board filled with example rows would be indistinguishable from a
            board filled with the founder’s own, and the first person to mistake one for the other would be the
            founder reading their own verdict.
          </p>
        </div>
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
        return (
          <NotBackedYet
            title="The hypothesis board is not built yet"
            what="A hypothesis names what you believe, what would prove it, and what would kill it — then collects the interviews that did either. No table in the product stores one today."
            feeds="It would read the pain themes next door as its starting claims, and feed the verdict with which claims survived contact."
            from={{ to: '/validate/pain-map', label: 'See the pain map' }}
          />
        );
      case 'verdict':
        return (
          <NotBackedYet
            title="The verdict ledger is not built yet"
            what="A verdict reconciles the hypotheses against the evidence and records what the venture decided — proceed, pivot, or stop — with the date and the reasoning attached."
            feeds="It would read the hypothesis board above it. Until that exists there is nothing to reconcile, so this page has nothing true to show."
            from={{ to: '/validate/hypotheses', label: 'See hypotheses' }}
          />
        );
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
      surface="validate"
      scope="One venture"
      intro={INTRO[zone?.slug] || INTRO.interviews}
    >
      {body}
    </WorkspaceShell>
  );
}
