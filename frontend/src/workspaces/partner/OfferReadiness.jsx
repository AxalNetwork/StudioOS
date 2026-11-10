import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Skeleton } from '../../ui';
import { zonePath } from '../shellConfig';
import AlsoIn from '../AlsoIn';
import useBucketSources from '../useBucketSources';
import {
  NOT_RECORDED, OFFER_GROUPS, ZONE_SOURCE, UNREADABLE, attentionItems, isNewFirm, readinessMetrics, zonePreview,
} from '../boards/offerReadiness.js';

/**
 * D4841 (#4841) — the `/offers` root: an Offer Readiness dashboard (Offers V2
 * canvas OF-01 A and B at desktop width, OF-09a on a phone).
 *
 * Top to bottom: a first step for a firm with an empty catalogue, the five
 * readiness figures, at most three things that need attention, then one compact
 * preview per group — Sell, Prove, Target, Test — with every zone a link.
 *
 * Every figure and every item comes from `../boards/offerReadiness.js`, over the
 * reads the zones themselves make (`partnerOffers.js` `sources`), so the root
 * and the zone print the same number. A failed read says Unreadable and offers
 * Try again for that read alone; nothing here prints a zero it did not count.
 *
 * The zone notes (how a figure is counted, what is not measured) are kept, but
 * behind a disclosure under each preview rather than as permanent paragraphs.
 *
 * The preview for each zone keeps that zone's board anchor (`of-catalog` …), so
 * a zone crumb's `/offers#of-proof` still lands on its preview (D403).
 */
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const SECONDARY = 'inline-flex min-h-[36px] items-center justify-center rounded-lg border border-axal-hairline px-3 py-1.5 text-[13px] font-semibold text-axal-ink hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-[38px] items-center justify-center rounded-lg bg-amber-700 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-500';

export default function OfferReadiness({ bucket, board, className = '' }) {
  const byKey = useBucketSources(board?.sources || EMPTY);
  const { hash } = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(String(hash || '').replace(/^#/, ''));
    if (!id || typeof document === 'undefined') return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return <OfferReadinessView bucket={bucket} board={board} byKey={byKey} className={className} />;
}

/** The view over already-read sources; `offer_readiness_4841.test.mjs` renders it with fixtures. */
export function OfferReadinessView({ bucket, board, byKey = EMPTY, className = '' }) {
  if (!bucket?.zones?.length || !board?.sections?.length) return null;

  const zoneBySlug = new Map(bucket.zones.map((z) => [z.slug, z]));
  const sectionBySlug = new Map(board.sections.map((s) => [s.slug, s]));
  const to = (slug) => (zoneBySlug.has(slug) ? zonePath(bucket, zoneBySlug.get(slug)) : bucket.prefix);
  const metrics = readinessMetrics(byKey);
  const attention = attentionItems(byKey);
  const newFirm = isNewFirm(byKey);
  const failed = Object.entries(byKey).filter(([, s]) => s.state === 'error');

  return (
    <div className={`flex flex-col gap-4 ${className}`.trim()} data-testid="offer-readiness">
      {newFirm && (
        <section className={`${CARD} flex flex-col items-start gap-2.5 p-6`} aria-labelledby="of-first-step" data-testid="offer-first-step">
          <h2 id="of-first-step" className="text-[20px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">Start with what you sell</h2>
          <p className="max-w-2xl text-[14px] leading-relaxed text-axal-muted dark:text-gray-300">
            Add your first service so founders and HQ can see what your firm offers. Proof, fit and testing build on it.
          </p>
          <Link to={to('catalog')} className={`${PRIMARY} max-lg:w-full max-lg:min-h-[44px]`}>Add your first service</Link>
        </section>
      )}

      <div role="list" aria-label="Commercial readiness"
        className={`${CARD} grid grid-cols-2 overflow-hidden lg:grid-cols-5`} data-testid="offer-readiness-metrics">
        {metrics.map((m) => (
          <Link key={m.key} role="listitem" to={to(m.slug)} data-testid={`readiness-${m.key}`} data-state={m.state}
            className="flex min-h-[44px] flex-col gap-1 border-b border-r border-axal-hairline px-4 py-3 hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-600 dark:border-gray-800 dark:hover:bg-gray-800 max-lg:last:col-span-2 lg:border-b-0 lg:last:border-r-0">
            <small className="text-[12.5px] text-axal-muted dark:text-gray-400">{m.label}</small>
            {m.state === 'loading'
              ? <Skeleton className="h-6 w-16" />
              : (
                <b className={`font-mono font-bold tracking-[-.02em] ${m.state === 'unreadable' || m.value === NOT_RECORDED ? 'text-[16px] text-axal-muted dark:text-gray-400' : 'text-[22px] text-axal-ink dark:text-gray-100'}`}>
                  {m.value}
                </b>
              )}
            {m.note && <em className="text-[12.5px] not-italic text-axal-muted dark:text-gray-400">{m.note}</em>}
          </Link>
        ))}
      </div>
      {failed.length > 0 && (
        <p role="alert" className="text-[13px] text-axal-muted dark:text-gray-300">
          {failed.length === 1 ? 'One read' : `${failed.length} reads`} could not be completed, so {failed.length === 1 ? 'its figure reads' : 'their figures read'} {UNREADABLE} rather than zero.{' '}
          <button type="button" className="font-semibold text-amber-800 underline dark:text-amber-300"
            onClick={() => failed.forEach(([, s]) => s.retry?.())}>
            Try again
          </button>
        </p>
      )}

      <section aria-labelledby="of-attention" className="flex flex-col gap-2.5" data-testid="offer-attention">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="of-attention" className="text-[16px] font-extrabold text-axal-ink dark:text-gray-100">What needs attention</h2>
          {attention.state === 'ready' && attention.items.length > 0 && (
            <span className="text-[12.5px] text-axal-muted dark:text-gray-400">
              {attention.candidates > attention.items.length
                ? `${attention.items.length} of ${attention.candidates}`
                : `${attention.items.length} shown`} · each from a recorded state
            </span>
          )}
        </div>
        {attention.state === 'loading' && (
          <div className="grid gap-3 lg:grid-cols-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        )}
        {attention.state === 'ready' && attention.items.length === 0 && (
          <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="offer-attention-empty">
            Nothing needs attention yet. Items appear here when a recorded state gives you something specific to act on.
          </p>
        )}
        {attention.state === 'ready' && attention.items.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-3">
            {attention.items.map((a, i) => (
              <article key={a.key} data-testid={`attention-${a.key}`}
                className={`${CARD} flex flex-col gap-1.5 border-l-[3px] border-l-amber-700 px-4 py-3 dark:border-l-amber-500`}>
                <b className="text-[14px] text-axal-ink dark:text-gray-100">{a.title}</b>
                <p className="text-[13px] leading-relaxed text-axal-muted dark:text-gray-300">{a.body}</p>
                {/* One primary on a phone (OF-09a): the first item's action. */}
                <Link to={to(a.slug)} data-testid={`attention-cta-${a.key}`}
                  className={`mt-auto self-start ${i === 0 && !newFirm
                    ? `${SECONDARY} max-lg:w-full max-lg:min-h-[44px] max-lg:border-transparent max-lg:bg-amber-700 max-lg:text-white`
                    : `${SECONDARY} max-lg:w-full max-lg:min-h-[44px]`}`}>
                  {a.cta}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-3.5 lg:grid-cols-2" data-testid="offer-groups">
        {OFFER_GROUPS.map((g) => (
          <section key={g.key} aria-label={g.label} className={`${CARD} flex flex-col gap-3 px-4 py-3.5`} data-testid={`offer-group-${g.key}`}>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[.08em] text-amber-800 dark:text-amber-300">{g.label}</span>
            {g.zones.filter((slug) => zoneBySlug.has(slug)).map((slug) => (
              <ZonePreview key={slug} slug={slug} zone={zoneBySlug.get(slug)} section={sectionBySlug.get(slug)}
                to={to(slug)} source={byKey[ZONE_SOURCE[slug]]} />
            ))}
          </section>
        ))}
      </div>
      <AlsoIn role="partner" row={bucket.label} />
    </div>
  );
}

const EMPTY = {};

function ZonePreview({ slug, zone, section, to, source }) {
  const state = source?.state || 'loading';
  const payload = source?.data;
  const rows = state === 'ready' ? zonePreview(slug, payload) : [];
  const sub = state === 'ready' ? section?.summary?.(payload) : null;
  const note = state === 'ready' ? section?.footnote?.(payload) : null;
  return (
    <div id={section?.anchor} className="scroll-mt-24 border-t border-axal-hairline pt-2.5 first-of-type:border-t-0 first-of-type:pt-0 dark:border-gray-800" data-testid={`offer-preview-${slug}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to={to} data-testid={`offer-zone-link-${slug}`}
          className="text-[14px] font-bold text-axal-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600 dark:text-gray-100">
          {zone.label} <span aria-hidden="true">→</span>
        </Link>
        {sub && <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{sub}</span>}
      </div>
      {state === 'loading' && <div className="mt-2 space-y-1.5" aria-busy="true"><Skeleton className="h-5" /><Skeleton className="h-5" /></div>}
      {state === 'error' && (
        <p className="mt-1.5 text-[13px] text-axal-muted dark:text-gray-300">
          {UNREADABLE}. This zone could not be read, so nothing is listed rather than an empty list.{' '}
          {typeof source.retry === 'function' && (
            <button type="button" onClick={source.retry} className="font-semibold text-amber-800 underline dark:text-amber-300">Try again</button>
          )}
        </p>
      )}
      {state === 'ready' && rows.length === 0 && (
        <p className="mt-1.5 text-[13px] text-axal-muted dark:text-gray-400">{section?.empty || 'Nothing is recorded here yet.'}</p>
      )}
      {rows.length > 0 && (
        <ul className="mt-1.5">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3 border-t border-axal-ground py-1.5 text-[13px] first:border-t-0 dark:border-gray-800">
              <span className="min-w-0 truncate text-axal-ink dark:text-gray-200">{r.label ?? <NotRecorded />}</span>
              <span className="shrink-0 text-axal-muted dark:text-gray-400">{r.status ?? <NotRecorded />}</span>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <details className="mt-1.5 text-[12.5px] text-axal-muted dark:text-gray-400">
          <summary className="cursor-pointer select-none font-semibold">How this is counted</summary>
          <p className="mt-1 leading-relaxed">{note}</p>
        </details>
      )}
    </div>
  );
}

function NotRecorded() {
  return <span className="italic text-axal-muted dark:text-gray-400">{NOT_RECORDED}</span>;
}
