// #3938 (D1478 task 4, part 8): the page side of every "Rank by fit" press, as pure rules.
//
// Each rank route (RA11, LE10, IN10, GR17, NE1 on the co-founder and advisor
// pages) answers `{ job, rows: [{ <key>, position, line }] }`: the same list
// the page already shows, best first, with at most one written line per row.
// This file turns that answer into the page's order and words. It never
// drops a row: a row the press did not rank stays, after the ranked ones, in
// the page's own order. A missing line is no line, never invented.

/** The id a rank row names, whichever route answered (`uid`, `event_id`, `need_id`, `ref`, `application_id`). */
export function rankKeyOf(row) {
  const k = row?.uid ?? row?.event_id ?? row?.need_id ?? row?.ref ?? row?.application_id ?? null;
  return k == null ? null : String(k);
}

/**
 * The page's rows in ranked order. `keyOf(item)` is the item's id as the
 * route names it. Returns `{ list, lineFor, ranked }`: `list` holds every item
 * (ranked first, by position, then the rest as they were); `lineFor(item)` is
 * the press's line for it or null; `ranked` counts the items the press placed.
 */
export function applyRank(items, keyOf, answer) {
  const all = Array.isArray(items) ? items : [];
  const rows = Array.isArray(answer?.rows) ? answer.rows : [];
  if (!rows.length) return { list: all, lineFor: () => null, ranked: 0 };
  const byKey = new Map();
  for (const r of rows) {
    const k = rankKeyOf(r);
    if (k != null && !byKey.has(k)) byKey.set(k, { position: Number(r.position) || 0, line: typeof r.line === 'string' && r.line.trim() ? r.line.trim() : null });
  }
  const placed = [];
  const rest = [];
  all.forEach((item, i) => {
    const hit = byKey.get(String(keyOf(item)));
    (hit ? placed : rest).push({ item, i, hit });
  });
  placed.sort((a, b) => a.hit.position - b.hit.position || a.i - b.i);
  return {
    list: [...placed, ...rest].map((x) => x.item),
    lineFor: (item) => byKey.get(String(keyOf(item)))?.line ?? null,
    ranked: placed.length,
  };
}

/** What a refused or failed press says. The Worker's own sentence first; never a bare status. */
export function rankRefusal(err) {
  const status = err?.status;
  const said = err?.data?.message || err?.data?.detail || err?.message || '';
  if (status === 402) return said || 'Not enough AI tokens for this press. Add tokens, then try again.';
  if (status === 403) return said || 'Eadwyn is switched off for this page.';
  if (status === 400 || status === 409 || status === 422) return said || 'Type what you are looking for, then rank.';
  return said && status && status < 500 ? said : 'The ranking could not be run just now. Nothing changed. Try again.';
}

/** The line under the control once a press answered. */
export function rankedLine(ranked, total) {
  if (!ranked) return 'Eadwyn found nothing on this list to rank first. The list is as it was.';
  return `Ranked by fit: ${ranked} of ${total} first. The rest follow in their usual order.`;
}
