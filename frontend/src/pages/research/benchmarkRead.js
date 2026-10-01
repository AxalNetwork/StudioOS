/**
 * The readings the benchmark page (canvas f2eb2046) and its tests share. Pure,
 * so they run in Node.
 *
 * VALUES ARE TEXT WITH THEIR UNIT IN THE GLYPH ("1.4x", "18%"). Nothing here
 * parses a float, so nothing can render 1.4x as 1.40 or drop the unit.
 *
 * A TRACKED ROW IS NOT A COMPARISON WITH ZEROES. With no peer figure the peer
 * half reads Not recorded with its reason, the sample has nothing to size, and
 * nothing is coloured or ranked.
 */

/** The four tiles. `nr` marks Not recorded; `warn` marks a thin base. */
export function benchmarkTiles(item, { thin = false } = {}) {
  if (!item) return [];
  const cmp = Boolean(item.is_comparison);
  return [
    item.our_value
      ? { k: 'Ours', v: item.our_value, sub: 'as you recorded it' }
      : { k: 'Ours', nr: true, sub: 'no figure entered yet' },
    cmp
      ? { k: 'Peer', v: item.peer_value, sub: 'entered and sourced by you' }
      : { k: 'Peer', nr: true, sub: 'tracked, not compared' },
    cmp
      ? { k: 'Sample', v: `n=${item.peer_sample_size}`, warn: thin, sub: thin ? 'thin — read the base first' : 'wide enough to state plainly' }
      : { k: 'Sample', nr: true, sub: 'no peer set to size' },
    item.peer_as_of
      ? { k: 'As of', v: item.peer_as_of, sub: 'when the peer figure was measured' }
      : { k: 'As of', nr: true, sub: 'no peer figure to date' },
  ];
}

/**
 * The draft of "what this supports" — a restatement of the fields on the page,
 * as the canvas draws it. It has no peer data set to reach for, so it cannot
 * say more than the row does. Null when there is nothing to restate.
 */
export function readingDraft(item, { thin = false } = {}) {
  if (!item) return null;
  const cmp = Boolean(item.is_comparison);
  if (!item.our_value && !cmp) return null;
  const ours = item.our_value ? `Ours reads ${item.our_value}` : 'Ours is not recorded';
  if (!cmp) return `${ours}, with no peer figure entered, so there is nothing to compare it to.`;
  const base = `${item.peer_source}, n=${item.peer_sample_size}${item.peer_as_of ? `, as of ${item.peer_as_of}` : ''}`;
  const tail = thin
    ? ' At that sample the gap is not a market rate: one member moves the median.'
    : ' The comparison is only as good as that base.';
  return `${ours} against a peer of ${item.peer_value} from ${base}.${tail}`;
}

/** The editor's initial values, from the stored row; blanks stay blank. */
export function editorFields(item) {
  const s = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    metric: s(item?.metric),
    our_value: s(item?.our_value),
    peer_value: s(item?.peer_value),
    peer_source: s(item?.peer_source),
    peer_sample_size: s(item?.peer_sample_size),
    peer_as_of: s(item?.peer_as_of),
  };
}

/**
 * The PATCH body from the editor: blank text is sent as null so a cleared
 * field clears, and a blank sample is null — never 0.
 */
export function editorPatch(form) {
  const t = (v) => (String(v ?? '').trim() ? String(v).trim() : null);
  const n = String(form.peer_sample_size ?? '').trim();
  return {
    metric: String(form.metric ?? '').trim(),
    our_value: t(form.our_value),
    peer_value: t(form.peer_value),
    peer_source: t(form.peer_source),
    peer_sample_size: n === '' ? null : Number(n),
    peer_as_of: t(form.peer_as_of),
  };
}
