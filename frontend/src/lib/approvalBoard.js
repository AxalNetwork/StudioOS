/**
 * S3's lane board (D470). The list is the primary view. These columns are the
 * second: five lanes, chosen by which one has waited longest, not by a fixed
 * order and not by how many items a lane holds.
 *
 * An unreadable lane (`count === null`) is not a column. An item whose age is
 * not a finite number does not make its lane older, and it is not treated as
 * zero hours. Empty lanes come after every lane that has an item.
 */

export const KANBAN_COLUMNS = 5;

function finiteAge(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tier(group) {
  if (group.oldest !== null) return 2;
  if (group.hasItem) return 1;
  return 0;
}

/**
 * @param {Array<{ lane: string, age_hours: number | null }>} items
 * @param {Array<{ key: string, label: string, count: number | null }>} lanes
 * @param {number} [columns]
 */
export function hurtingLanes(items, lanes, columns = KANBAN_COLUMNS) {
  const groups = new Map();
  for (const ln of lanes || []) {
    if (!ln || ln.count === null) continue;
    groups.set(ln.key, {
      key: ln.key,
      label: ln.label,
      items: [],
      oldest: null,
      hasItem: false,
    });
  }
  for (const it of items || []) {
    const group = groups.get(it?.lane);
    if (!group) continue;
    group.hasItem = true;
    group.items.push(it);
    const age = finiteAge(it?.age_hours);
    if (age !== null && (group.oldest === null || age > group.oldest)) group.oldest = age;
  }
  const ranked = [...groups.values()].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return tb - ta;
    if (ta === 2 && a.oldest !== b.oldest) return b.oldest - a.oldest;
    return 0;
  });
  const width = Number.isInteger(columns) && columns > 0 ? columns : KANBAN_COLUMNS;
  return ranked.slice(0, width).map((group) => ({
    key: group.key,
    label: group.label,
    oldest: group.oldest,
    items: [...group.items].sort((a, b) => {
      const aa = finiteAge(a?.age_hours);
      const bb = finiteAge(b?.age_hours);
      if (aa !== null && bb !== null && aa !== bb) return bb - aa;
      if (aa !== null && bb === null) return -1;
      if (aa === null && bb !== null) return 1;
      return 0;
    }),
  }));
}
