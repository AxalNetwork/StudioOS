/**
 * D8791 (#8791) — what the public Articles list may claim for one read.
 *
 * The browser retest reproduced three readings drawn as the same sentence,
 * "No articles yet. Be the first to publish.": a sector with no match, a
 * sector and author with no match, and a request that failed. Only one of
 * them is a publication with nothing in it. This module tells them apart, so
 * the page never calls a filtered or unreadable list an empty publication,
 * and it names the filters a zero result came from, so a visitor can return
 * to the full list in one action.
 *
 * Pure: no React, no fetch. The layout of the states waits on the canvas
 * (`needs-design`); the copy here is the interim wording until it lands.
 */

/** The filter values a cleared list starts from. */
export const CLEARED_ARTICLE_FILTERS = Object.freeze({ sector: '', role: '', search: '' });

/** True when any of the sector, author or search filters narrows the list. */
export function articleFiltersApplied({ sector, role, q } = {}) {
  return Boolean(sector) || Boolean(role) || Boolean(String(q || '').trim());
}

/**
 * The applied filters, in the order the page shows them: sector, author,
 * search. Each is `{ kind, value, label }`; labels come from the live sector
 * taxonomy and the author options the page passes in.
 */
export function appliedArticleFilters({ sector, role, q, sectors = [], roles = [] } = {}) {
  const out = [];
  if (sector) {
    const hit = Array.isArray(sectors) ? sectors.find((s) => s && s.key === sector) : null;
    out.push({ kind: 'sector', value: sector, label: (hit && hit.label) || sector });
  }
  if (role) {
    const hit = Array.isArray(roles) ? roles.find((r) => r && r.id === role) : null;
    out.push({ kind: 'author', value: role, label: (hit && hit.label) || role });
  }
  const term = String(q || '').trim();
  if (term) out.push({ kind: 'search', value: term, label: `“${term}”` });
  return out;
}

/**
 * The state of one read of the list:
 *   loading    — the read has not answered;
 *   unreadable — the read failed: no claim either way about what exists;
 *   no-match   — the read answered nothing for the applied filters;
 *   empty      — the read answered nothing with no filter: the publication is empty;
 *   list       — the read answered articles.
 */
export function articleListState({ loading = false, failed = false, items = [], total = 0, sector = '', role = '', q = '', sectors = [], roles = [] } = {}) {
  const filters = appliedArticleFilters({ sector, role, q, sectors, roles });
  const filtered = filters.length > 0;
  let kind;
  if (loading) kind = 'loading';
  else if (failed) kind = 'unreadable';
  else if (!Array.isArray(items) || items.length === 0) kind = filtered ? 'no-match' : 'empty';
  else kind = 'list';
  const count = kind === 'list' ? Math.max(Number(total) || 0, items.length) : 0;
  return { kind, filters, filtered, count };
}

/** The applied filters as one phrase: `Fintech · Investors · “ledger”`. */
export function filterPhrase(filters) {
  return (filters || []).map((f) => f.label).join(' · ');
}

/**
 * The sentence for a state, used both as the visible note and as the polite
 * status announcement. Interim wording until the canvas supplies its copy.
 */
export function articleListMessage(state) {
  switch (state?.kind) {
    case 'loading': return 'Loading…';
    case 'unreadable': return 'Unreadable: the articles could not be read, so this is not a claim that there are none.';
    case 'no-match': return `No articles match ${filterPhrase(state.filters)}.`;
    case 'empty': return 'No articles yet. Be the first to publish.';
    case 'list': {
      const n = state.count;
      const noun = n === 1 ? 'article' : 'articles';
      return state.filtered ? `${n} ${noun} match ${filterPhrase(state.filters)}.` : `${n} ${noun}.`;
    }
    default: return '';
  }
}

/** Whether the one-action return to the full list is offered for a state. */
export function offersShowAll(state) {
  return Boolean(state && state.filtered && (state.kind === 'no-match' || state.kind === 'unreadable'));
}
