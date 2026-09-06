import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading } from './kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';

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
 */
export default function ThinkingZone() {
  const [state, setState] = useState({ loading: true, error: '', payload: null });

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      setState({ loading: false, error: '', payload: await api.listMyAdvisorThinking() });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your published thinking could not be read.', payload: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = state.payload?.items || [];
  const counts = state.payload?.counts || null;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Published thinking"
        blurb="What you have written, and how many people opened it."
      />

      <ZoneBody
        actions={advisorZoneActions('expertise/thinking', { view: { header: ['Title', 'Subtitle', 'Sector', 'Status', 'Published', 'Words', 'Read minutes', 'Views'], rows: items, cells: (a) => [a.title, a.subtitle, a.sector, a.status, a.published_at, a.word_count, a.read_minutes, a.views] } })}
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={!state.loading && !state.error && items.length === 0}
        empty={(
          <NothingYet
            title="Nothing published or drafted yet"
            body="Articles you write appear here with their real view counts. Nothing is inferred — an empty shelf means you have not written, not that nobody read."
            action={<Link to="/articles" className="text-emerald-700 underline">The articles hub →</Link>}
          />
        )}
      >
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[
            { label: 'Published', value: counts?.published, note: 'live on the hub' },
            { label: 'In draft', value: counts?.drafts, note: 'not yet visible to anyone' },
            { label: 'Best reach', value: counts?.best_reach, note: 'views on your most-read piece' },
            // The one true claim on the old card: nothing records an external
            // publication or a talk, so this is absent rather than zero.
            { label: 'Talk reach', value: counts?.talk_reach ?? null, note: 'where a piece ran is not recorded' },
          ].map((t) => (
            <Card key={t.label} className="px-3 py-2.5">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{t.label}</div>
              {t.value === null || t.value === undefined
                ? <div className="mt-1.5"><Unrecorded /></div>
                : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{t.value}</div>}
              <div className="mt-1 text-[10px] leading-snug text-axal-ink-3">{t.note}</div>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">Your shelf</span>
            <span className="text-[11px] text-axal-ink-3">Newest first</span>
          </div>
          <ul className="divide-y divide-axal-border-soft">
            {items.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={a.status === 'published' ? 'ok' : 'neutral'}>
                      {a.status === 'published' ? 'Published' : 'Draft'}
                    </Pill>
                    {a.sector && <span className="text-[11px] text-axal-ink-3">{a.sector}</span>}
                  </div>
                  <div className="mt-1 text-[12.5px] font-semibold leading-snug">
                    {a.status === 'published' && a.slug
                      ? <Link to={`/articles/${a.slug}`} className="hover:underline">{a.title}</Link>
                      : a.title}
                  </div>
                  {a.subtitle && (
                    <div className="mt-0.5 truncate text-[11px] text-axal-ink-3">{a.subtitle}</div>
                  )}
                </div>
                <div className="shrink-0 text-right text-[11px] tabular-nums text-axal-ink-3">
                  {/* A draft has no views because nobody can open it — that is a
                      real zero, not a missing number, so it is shown as one. */}
                  <div className="font-semibold text-axal-ink-2">
                    {a.status === 'published' ? `${a.views ?? 0} views` : '—'}
                  </div>
                  <div>{a.read_minutes ? `${a.read_minutes} min read` : `${a.word_count || 0} words`}</div>
                  {a.published_at && <div>{String(a.published_at).slice(0, 10)}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <StatedLimit title="Where a piece ran is not recorded">
          <p>
            Views are counted on this product's own hub and nowhere else. If an article was
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
