/**
 * The three reads the Learning home makes today (D562), through client
 * methods that already exist. Nothing here adds one: the Learning client
 * (`lib/api/learning.js`) arrives with #1158, and the catalog it serves will
 * replace these three reads with one.
 *
 *   articles.list        → GET /api/articles                       (routes/articles.ts)
 *   publications.publicList → GET /api/market-intel-public/publications (routes/market_intel_public.ts)
 *   eventsPublic.list    → GET /api/public/events                  (routes/events_public.ts)
 *
 * A REPLY IN THE WRONG SHAPE IS A FAILED READ, NOT AN EMPTY ONE. Each read
 * throws when its list is missing, so the page says "could not be read"
 * rather than "nothing is published", the defect D332 fixed on My Events.
 */
import { articles, publications, eventsPublic } from '../../lib/api';
import { ARTICLES_PAGE_SIZE, EVENTS_PAGE_SIZE, articleRow, eventRow, publicationRow } from './learningModel';

function listOf(reply, key, what) {
  const list = reply?.[key];
  if (!Array.isArray(list)) throw new Error(`${what} came back in a shape this page cannot read.`);
  return list;
}

/** One page of published articles, newest first, with the route's own total. */
export async function readArticles({ q = '', page = 0 } = {}) {
  const offset = page * ARTICLES_PAGE_SIZE;
  const reply = await articles.list({ limit: ARTICLES_PAGE_SIZE, offset, q: q || undefined });
  const total = Number(reply?.total);
  return {
    rows: listOf(reply, 'items', 'The article list').map(articleRow),
    total: Number.isFinite(total) ? total : null,
    offset,
  };
}

/** Every published publication the public list serves (it caps itself at 100). */
export async function readPublications() {
  const reply = await publications.publicList();
  return { rows: listOf(reply, 'publications', 'The publication list').map(publicationRow) };
}

/** The next upcoming events, soonest first. The route sends no total. */
export async function readEvents({ q = '' } = {}) {
  const reply = await eventsPublic.list({ limit: EVENTS_PAGE_SIZE, offset: 0, q: q || undefined });
  return { rows: listOf(reply, 'events', 'The event list').map((e) => eventRow(e, eventsPublic.icsUrl)) };
}
