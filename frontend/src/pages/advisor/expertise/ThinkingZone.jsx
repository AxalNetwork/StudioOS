import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill } from '../../../ui';
import { api, articles as articlesApi } from '../../../lib/api';
import { MoreRows, NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading } from './kit';
import { usePagedList } from './pages';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { articleStage, revisionLine } from './expertiseModel';

/**
 * D4681 (#4681): one piece's saved revisions (D1406's author read), opened on
 * demand. A failed read says so; it is never drawn as "no revisions".
 */
function History({ id }) {
  const [read, setRead] = useState({ status: 'loading', rows: [] });
  useEffect(() => {
    let live = true;
    articlesApi.revisions(id).then(
      (r) => { if (live) setRead(Array.isArray(r?.revisions) ? { status: 'ok', rows: r.revisions } : { status: 'error', rows: [] }); },
      () => { if (live) setRead({ status: 'error', rows: [] }); },
    );
    return () => { live = false; };
  }, [id]);
  if (read.status === 'loading') return <p className="mt-2 text-[11.5px] text-axal-faint">Reading its history…</p>;
  if (read.status === 'error') return <p className="mt-2 text-[11.5px] text-axal-faint" data-testid={`advisor-thinking-history-error-${id}`}>Its history could not be read.</p>;
  if (!read.rows.length) return <p className="mt-2 text-[11.5px] text-axal-faint">No revision is saved yet.</p>;
  return (
    <ul className="mt-2 space-y-1 text-[11.5px] text-axal-muted" data-testid={`advisor-thinking-history-${id}`}>
      {read.rows.map(revisionLine).map((r) => <li key={r.key}><span className="font-semibold">{r.title}</span> · {r.line}</li>)}
    </ul>
  );
}

/**
 * Expertise · Thinking — what you have published, and how far it reached.
 *
 * THE CARD THIS REPLACES WAS TWO-THIRDS FALSE, and it is worth recording which
 * third was true. It said: "The `articles` table exists and records a date and
 * a publication state, but it has no advisor owner, no reach figure and no
 * record of where a piece ran. Listing articles against your name would require
 * a join that does not exist, and reporting reach would require a number nobody
 * stores."
 *
 *   · "no advisor owner" — FALSE. `articles.author_user_id` is NOT NULL.
 *   · "reach would require a number nobody stores" — FALSE. `articles.views`
 *     is a real counter incremented on every published read
 *     (`routes/articles.ts:320`), non-zero on four published pieces today.
 *   · "no record of where a piece ran" — TRUE, and the only genuine gap. It is
 *     stated below rather than quietly dropped.
 *
 * The zone therefore needed wiring, not a migration. That is the second card in
 * this pass found describing a gap that had already closed, which is why every
 * card in the bucket was checked against production before any of it was built.
 *
 * DRAFTS ARE INCLUDED, which is why this reads an authenticated route rather
 * than the public `/articles/by-author/:user_id`. That one filters to published
 * because it serves a public profile; an advisor looking at their own shelf
 * needs the drafts, and only their own.
 *
 * D4681 (#4681): EVERY STATE IS ITS OWN. The shelf used to draw "Draft" for
 * anything not published, so a piece an editor had approved, scheduled or
 * sent back read the same as one nobody had seen. Each row now carries its
 * real state (draft, submitted, in review, changes requested, not accepted,
 * approved, scheduled, published), who can read it, and one next step that
 * opens the editor or the published piece. History lists its saved revisions.
 */
const readThinkingPage = (page) => api.listMyAdvisorThinking(page);

/*
 * #4689: THE SHELF IS READ A PAGE AT A TIME, AND THE TILES ARE THE WHOLE SHELF.
 * `counts` is read by the Worker over every piece, so the tiles never describe
 * only the first 100. An OPEN IS COUNTED EACH TIME a published piece is read
 * here (`articles.views`), so it is "opens", never "people" or "readers".
 */
export default function ThinkingZone() {
  const list = usePagedList(readThinkingPage, { errorText: 'Your published thinking could not be read.' });
  const state = { loading: list.loading, error: list.error };
  const [view, setView] = useState('all');
  const [history, setHistory] = useState(null);
  const load = list.load;
  useEffect(() => { load(); }, [load]);

  const items = list.rows;
  const counts = list.res?.counts || null;
  const total = list.res?.page?.total ?? items.length;
  // D392 — the chips are the pill's own two states: published, and anything
  // not yet published (which the shelf already labels "Draft").
  const THINKING_VIEWS = {
    published: (a) => a.status === 'published',
    draft: (a) => a.status !== 'published',
  };
  const shown = THINKING_VIEWS[view] ? items.filter(THINKING_VIEWS[view]) : items;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Published thinking"
        blurb="What you have written, and how many times it was opened here."
      />

      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('expertise/thinking', { value: view, onChange: setView })}
        actions={advisorZoneActions('expertise/thinking', { view: { header: ['Title', 'Subtitle', 'Sector', 'Status', 'Published', 'Words', 'Read minutes', 'Opens here'], rows: shown, cells: (a) => [a.title, a.subtitle, a.sector, a.status, a.published_at, a.word_count, a.read_minutes, a.views] } })}
      />
      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={!state.loading && !state.error && items.length === 0}
        empty={(
          <NothingYet
            title="Nothing published or drafted yet"
            body="Articles you write appear here with how many times each was opened. Nothing is inferred — an empty shelf means you have not written, not that nobody read."
            action={<Link to="/articles" className="text-emerald-700 underline">The articles hub →</Link>}
          />
        )}
      >
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[
            { label: 'Published', value: counts?.published, note: 'live on the hub' },
            { label: 'Not public yet', value: counts?.drafts, note: 'drafts, and pieces with the editors' },
            { label: 'Best reach', value: counts?.best_reach, note: 'opens of your most-opened piece' },
            // The one true claim on the old card: nothing records an external
            // publication or a talk, so this is absent rather than zero.
            { label: 'Talk reach', value: counts?.talk_reach ?? null, note: 'where a piece ran is not recorded' },
          ].map((t) => (
            <Card key={t.label} className="px-3 py-2.5">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{t.label}</div>
              {t.value === null || t.value === undefined
                ? <div className="mt-1.5"><Unrecorded /></div>
                : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{t.value}</div>}
              <div className="mt-1 text-[10px] leading-snug text-axal-faint">{t.note}</div>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">Your shelf</span>
            <span className="text-[11px] text-axal-faint">Newest first</span>
          </div>
          {shown.length === 0 && (
            <p className="text-[12.5px] text-axal-muted">{`No piece is in this state. ${total} in total.`}</p>
          )}
          <ul className="divide-y divide-axal-hairline">
            {shown.map((a) => { const stage = articleStage(a); return (
              <li key={a.id} className="flex items-start justify-between gap-4 py-2.5" data-testid={`advisor-thinking-${a.id}`} data-stage={stage.key}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={stage.tone}>{stage.label}</Pill>
                    {a.sector && <span className="text-[11px] text-axal-faint">{a.sector}</span>}
                  </div>
                  <div className="mt-1 text-[12.5px] font-semibold leading-snug">
                    {a.status === 'published' && a.slug
                      ? <Link to={`/articles/${a.slug}`} className="hover:underline">{a.title}</Link>
                      : a.title}
                  </div>
                  {a.subtitle && (
                    <div className="mt-0.5 truncate text-[11px] text-axal-faint">{a.subtitle}</div>
                  )}
                  <div className="mt-1 text-[11.5px] text-axal-muted" data-testid={`advisor-thinking-audience-${a.id}`}>{stage.audience}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11.5px]">
                    <Link to={stage.next.to} className="font-semibold text-emerald-700 underline dark:text-emerald-300" data-testid={`advisor-thinking-next-${a.id}`}>{stage.next.label}</Link>
                    <button type="button" className="font-semibold text-axal-muted underline" onClick={() => setHistory(history === a.id ? null : a.id)}
                      aria-expanded={history === a.id} data-testid={`advisor-thinking-history-toggle-${a.id}`}>
                      {history === a.id ? 'Hide history' : 'History'}
                    </button>
                  </div>
                  {history === a.id ? <History id={a.id} /> : null}
                </div>
                <div className="shrink-0 text-right text-[11px] tabular-nums text-axal-faint">
                  {/* A draft has no views because nobody can open it, so it shows
                      no open figure at all. A published piece whose counter did
                      not come back is absent, never a typed zero (D392). */}
                  <div className="font-semibold text-axal-muted">
                    {a.status !== 'published'
                      ? 'Not public yet'
                      : (a.views === null || a.views === undefined ? <Unrecorded /> : `${a.views} opens`)}
                  </div>
                  <div>
                    {a.read_minutes
                      ? `${a.read_minutes} min read`
                      : (a.word_count === null || a.word_count === undefined ? <Unrecorded /> : `${a.word_count} words`)}
                  </div>
                  {a.published_at && <div>{String(a.published_at).slice(0, 10)}</div>}
                </div>
              </li>
            ); })}
          </ul>
          <MoreRows line={list.line} onMore={list.more} busy={list.moreBusy} error={list.moreError} testid="advisor-thinking-more" />
        </Card>

        <StatedLimit title="Where a piece ran is not recorded">
          <p>
            Opens are counted each time a piece is opened on this product's own hub, so one
            person reading twice counts twice, and nothing is counted anywhere else. If an article was
            syndicated, quoted, or became a talk, nothing here knows — so there is no
            combined reach figure and no “talk reach”, only the number this product can
            actually see.
          </p>
          <p>
            That was the one accurate claim on the card this zone replaces. The other two —
            that articles have no author and that reach is unstored — were already false
            when it was written.
          </p>
        </StatedLimit>
      </ZoneBody>
    </div>
  );
}
