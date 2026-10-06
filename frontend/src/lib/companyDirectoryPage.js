/**
 * One page of the company directory, as this card reads it. The directory
 * pages on the server since D534 (#1079): `items` is at most the requested
 * `limit`, and `total` counts every match, so "N matched" must come from
 * `total`, never from the length of the page.
 */
export function directoryPage(r) {
  const items = Array.isArray(r?.items) ? r.items : [];
  const total = Number.isFinite(Number(r?.total)) && r?.total != null ? Number(r.total) : items.length;
  return { items, total: Math.max(total, items.length) };
}
