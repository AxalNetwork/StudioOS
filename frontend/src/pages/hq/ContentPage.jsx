/**
 * HQ · Content — canvas H6, "one pipeline replacing three systems".
 *
 * THE SUBTITLE IS A THIRD OUT OF DATE, and this page says so rather than
 * drawing the pipeline as though it had been built. Checking the premise:
 * news was never a third store — the `/api/admin/news` queue read the SAME
 * `articles` table behind a `Deprecation` header — and D166 retired it
 * outright, because its publish handler accepted `in_review` and so let an
 * admin skip the recorded approve step the surviving queue enforces. A
 * third of the unification is therefore done rather than announced. What is
 * left is two stores with two meanings of "published": an article is
 * editorial and goes through review; a publication is an
 * audience-and-section digest.
 *
 * Merging them is a migration and a product decision, not a read. So the
 * page shows both honestly and states where they still disagree.
 *
 * THE MASTER TEMPLATE LIBRARY IS A LINK, NOT A SECOND COPY. The artboard
 * draws it here, but it already lives at `/admin/contracts` over the
 * `legal_templates` store. Two pages over one store drift apart; this one
 * carries the counts so the link is worth following and nothing else.
 *
 * NOT THE SAME PAGE AS `/admin/articles`. That is the plain-admin Content
 * Queue, which reviews one piece at a time. This is the HQ view above it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileStack } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

function Zone({ title, sub, children }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-faint">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

function Absent({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted">
      <Unrecorded /> — {reason}
    </p>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight tabular-nums text-axal-ink dark:text-white">
        {value ?? <Unrecorded />}
      </div>
      {note && <div className="mt-0.5 text-[10px] text-axal-faint">{note}</div>}
    </div>
  );
}

export default function ContentPage() {
  const [data, setData] = useState(null);
  // D112 — the localisation lane reads the escalation board, not this summary.
  // Its own state and its own retry: the summary is a pure read and the lane
  // has writes behind it, so folding them together would mean a slow escalation
  // board blanked the editorial pipeline too.
  const [lane, setLane] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqContent().then(setData, (e) => { reportError('hq-content', e); setData(UNAVAILABLE); });
  }, []);
  const loadLane = useCallback(() => {
    setLane(null);
    api.escalations({ kind: 'content' }).then(setLane, (e) => {
      reportError('hq-content-lane', e);
      setLane(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); loadLane(); }, [load, loadLane]);

  const ready = data && data !== UNAVAILABLE;
  const pipeline = ready ? data.pipeline : null;
  const pubs = ready ? data.publications : null;
  const templates = ready ? data.templates : null;
  const laneItems = lane && lane !== UNAVAILABLE && lane.available ? (lane.items || []) : null;

  // COVERAGE IS WHAT MAKES THE RAIL'S ONE ACTION WORK (D126). `canRun =
  // coverage.length > 0` in WorkerRail, so a mount that passes none renders
  // "Not recorded" and a permanently disabled button — which on this page was
  // false, since the reads above all answer.
  //
  // ONE LINE PER READ THAT ANSWERED. A source that failed contributes no line,
  // and `coverageNote` says so, because an empty rail must never be readable as
  // an empty pipeline. A real zero from a read that succeeded is a figure and
  // stays — `laneItems.length === 0` is the page's own "no branch has submitted
  // anything", which is not the fabricated `|| 0` the repo bans.
  const coverage = [
    pipeline?.available && num(pipeline.in_pipeline) !== null
      ? `${num(pipeline.in_pipeline)} articles in the editorial pipeline` : null,
    pubs?.available && num(pubs.total) !== null
      ? `${num(pubs.total)} publications in the second store` : null,
    templates?.available && num(templates.templates) !== null
      ? `${num(templates.templates)} templates · ${num(templates.versions)} versions` : null,
    laneItems ? `${laneItems.length} content ${laneItems.length === 1 ? 'submission' : 'submissions'} from branches` : null,
  ].filter(Boolean);

  const rail = (
    <WorkerRail
      workspace="Content"
      role="super_admin"
      stance="Read-only summary"
      note="This rail summarises the editorial pipeline, the publications store and the branch localisation lane. It takes no action and decides no submission."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === UNAVAILABLE || lane === UNAVAILABLE
          ? 'Neither read answered, so there is nothing to read back — this is not a claim that the pipeline is empty.'
          : 'Loading the content summary…')}
      unavailable={[
        ['One unified pipeline', 'Articles and publications are still two stores with two meanings of "published".'],
        // D112 — "Brand approval" and "Per-subsidiary attribution" came OFF
        // this list: a content escalation carries the branch code and takes a
        // decision. "Localisation" stays and is NARROWER: what is missing is
        // the link between a piece and the one it localises, not the lane.
        ['Localisation link', 'Nothing records that one piece is a localisation of another, so a count of localised items would be a count of submissions.'],
        ['Per-article attribution', 'An escalation names the branch that submitted it; an ARTICLE still names no licence (U1).'],
      ]}
      data-testid="hq-content-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-content-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          {/* The artboard's header counts "N in pipeline · M localised".
              The first is real; the second has no source, so it is named
              rather than filled with a number. */}
          <span className="text-[11px] opacity-80 tabular-nums">
            {pipeline?.available
              ? `${num(pipeline.in_pipeline)} in pipeline · localisation not recorded`
              : '…'}
          </span>
        </div>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <FileStack size={13} /> HQ · Content
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Content</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            The canvas calls this one pipeline replacing three systems. It is two now, not three — news already
            reads the articles store and answers with a deprecation notice. What is left is two meanings of
            &ldquo;published&rdquo;, shown apart because that is what they still are.
          </p>
        </header>

        {data === UNAVAILABLE && (
          <div className="mt-4">
            <Unreadable
              what="The content summary"
              claim="This is not a claim that nothing is in progress."
              onRetry={load}
            />
          </div>
        )}

        <div className="mt-4 space-y-4">
          <Zone title="Editorial pipeline" sub="articles, by the status they are actually in">
            {pipeline?.available ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="hq-content-lanes">
                  {pipeline.lanes.map((lane) => (
                    <Stat key={lane.key} label={lane.label} value={num(lane.n)} note={lane.statuses.join(', ')} />
                  ))}
                </div>
                {pipeline.rejected > 0 && (
                  <p className="mt-2 text-[11.5px] text-axal-muted">
                    {num(pipeline.rejected)} rejected, which is not a lane — a rejected piece is out of the
                    pipeline, not waiting in it.
                  </p>
                )}
                {pipeline.unmapped_statuses.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300" data-testid="hq-content-unmapped">
                    {pipeline.unmapped_statuses.map((s) => `${s.n} × ${s.status}`).join(', ')} —
                    {' '}in no lane above, so not counted in the totals. `articles.status` has no CHECK
                    constraint, so a new status can appear without a schema change.
                  </p>
                )}
                {pipeline.recent.length > 0 && (
                  <ul className="mt-3 space-y-1.5" data-testid="hq-content-recent">
                    {pipeline.recent.slice(0, 6).map((a) => (
                      <li key={a.id} className="flex items-baseline justify-between gap-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
                        <span className="truncate font-medium">{a.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-axal-faint">
                          {a.status} · {day(a.updated_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <Absent reason={pipeline?.reason || 'The content summary could not be read.'} />
            )}
          </Zone>

          <Zone title="Publications" sub="the second meaning of &ldquo;published&rdquo;">
            {pubs?.available ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Publications" value={num(pubs.total)} note="a separate store" />
                  {Object.entries(pubs.by_status).slice(0, 3).map(([status, n]) => (
                    <Stat key={status} label={status} value={num(n)} note="publication status" />
                  ))}
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-content-not-unified">
                  {ready ? data.unified_pipeline_reason : null}
                </p>
              </>
            ) : (
              <Absent reason={pubs?.reason || 'The content summary could not be read.'} />
            )}
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Master template library" sub="versioned · lives on Contracts">
              {templates?.available ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Templates" value={num(templates.templates)} note="legal template library" />
                    <Stat label="Versions" value={num(templates.versions)} note="archived versions stay binding" />
                  </div>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted">
                    The artboard draws the library in this zone, but it already has a page. Two consoles over one
                    store drift apart, so this one counts and points.
                  </p>
                  <Link
                    to={templates.owned_by}
                    className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-violet-700 underline dark:text-violet-300"
                  >
                    Open the template library on Contracts
                  </Link>
                </>
              ) : (
                <Absent reason={templates?.reason || 'The content summary could not be read.'} />
              )}
            </Zone>

            <Zone title="Localisation" sub="Axal-subsidiary brand decisions only">
              {/* D112 — TWO OF THE THREE ABSENCES CLOSED, AND THE THIRD NAMED.
                  A content escalation carries the branch code (attribution) and
                  takes a decision (brand approval). What still does not exist
                  is a LINK saying which piece a submission localises — so this
                  lane counts submissions, and the refusal below says that
                  rather than being deleted.

                  D206 — THE KIND IS SETTLED WHERE THE ESCALATION IS RECORDED,
                  NOT HERE. This note used to say the lane did not filter on
                  kind yet, because reaching it from a branch code is two joins.
                  D206 makes that join at the write instead: `recordEscalation`
                  reads the kind from HQ's own ledger and refuses a white-label's
                  `content` escalation without recording it, and nothing changes
                  a licence's kind after it is issued. So no white-label row can
                  reach this lane to be filtered out, and a filter here would be
                  a second copy of a rule that already has one home. */}
              <p className="mb-3 text-[12px] leading-relaxed text-axal-muted" data-testid="hq-brand-desk-scope">
                Brand approval is for Axal subsidiaries. A white-label has no HQ brand desk, so HQ refuses
                a white-label&rsquo;s content escalation before recording it, reading the kind from its
                own licence ledger. Nothing here filters by kind because no white-label submission can
                reach this lane.
              </p>
              {lane === UNAVAILABLE && (
                <Unreadable
                  what="Content submissions"
                  claim="This is not a claim that no branch has submitted anything."
                  onRetry={loadLane}
                />
              )}
              {lane && lane !== UNAVAILABLE && !lane.available && (
                <Absent reason={lane.reason} />
              )}
              {laneItems && laneItems.length === 0 && (
                <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-localisation-empty">
                  No branch has submitted content for brand approval. The lane reads escalations of
                  kind <code>content</code>; an empty one means nothing was pushed up, not that
                  nothing can be.
                </p>
              )}
              {laneItems && laneItems.length > 0 && (
                <ul className="space-y-2" data-testid="hq-localisation-lane">
                  {laneItems.map((it) => (
                    <li key={it.uid} className="rounded-xl border border-axal-hairline bg-axal-ground p-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-bold">{it.subject}</div>
                          <div className="mt-0.5 text-[10.5px] text-axal-faint">
                            {it.branch_code} · raised {it.created_at}
                            {it.sla === 'past' ? ' · past SLA' : it.sla === 'due_soon' ? ' · due soon' : ''}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em] ${
                          it.answer
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                        }`}>
                          {it.answer ? 'decided' : 'awaiting'}
                        </span>
                      </div>
                      {it.answer && (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-axal-muted">
                          {it.answer}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat
                  label="Submitted for approval"
                  value={laneItems ? String(laneItems.length) : null}
                  note={laneItems ? 'escalations of kind content' : 'the lane could not be read'}
                />
                {/* STILL PERMANENTLY BLANK, and for the one reason that did not
                    change: counting localisations needs a link between two
                    pieces, and nothing records one. */}
                <Stat label="Localised" value={null} note="no localisation link exists" />
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-axal-muted" data-testid="hq-localisation-reason">
                {ready ? data.localisation_reason : 'The content summary could not be read.'}
              </p>
            </Zone>
          </div>
        </div>
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
