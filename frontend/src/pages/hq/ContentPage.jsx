/**
 * HQ · Content — canvas H6, "one pipeline replacing three systems".
 *
 * THE SUBTITLE IS A THIRD OUT OF DATE, and this page says so rather than
 * drawing the pipeline as though it had been built. Checking the premise:
 * `admin_news.ts` reads the SAME `articles` table and already answers with
 * a `Deprecation` header pointing at `/api/admin/articles`, so news is not
 * a third system — it is a deprecated alias, and a third of the
 * unification has already happened. What is left is two stores with two
 * meanings of "published": an article is editorial and goes through review;
 * a publication is an audience-and-section digest.
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
        {sub && <span className="text-[11.5px] text-axal-ink-3">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

function Absent({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
      <Unrecorded /> — {reason}
    </p>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="rounded-xl border border-axal-line bg-axal-surface-2 p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight tabular-nums text-axal-ink dark:text-white">
        {value ?? <Unrecorded />}
      </div>
      {note && <div className="mt-0.5 text-[10px] text-axal-ink-3">{note}</div>}
    </div>
  );
}

export default function ContentPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqContent().then(setData, (e) => { reportError('hq-content', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  const pipeline = ready ? data.pipeline : null;
  const pubs = ready ? data.publications : null;
  const templates = ready ? data.templates : null;

  const rail = (
    <WorkerRail
      surface="hq_content"
      title="Content"
      unavailable={[
        ['One unified pipeline', 'Articles and publications are still two stores with two meanings of "published".'],
        ['Localisation', 'Nothing records that a piece localises another, or which subsidiary made it.'],
        ['Brand approval', 'No approval state exists for a localised piece.'],
        ['Per-subsidiary attribution', 'No account names its licence yet (U1).'],
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
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            <FileStack size={13} /> HQ · Content
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Content</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
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
                  <p className="mt-2 text-[11.5px] text-axal-ink-2">
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
                      <li key={a.id} className="flex items-baseline justify-between gap-3 rounded-lg border border-axal-line bg-axal-surface-2 px-3 py-2 text-[11.5px]">
                        <span className="truncate font-medium">{a.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-axal-ink-3">
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
                <p className="mt-3 text-[12.5px] leading-relaxed text-axal-ink-2" data-testid="hq-content-not-unified">
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
                  <p className="mt-3 text-[12.5px] leading-relaxed text-axal-ink-2">
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

            <Zone title="Localisation" sub="what the header would have counted">
              <Absent reason={ready ? data.localisation_reason : 'The content summary could not be read.'} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Localised" value={null} note="no localisation link exists" />
                <Stat label="Awaiting brand approval" value={null} note="no approval state exists" />
              </div>
            </Zone>
          </div>
        </div>
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
