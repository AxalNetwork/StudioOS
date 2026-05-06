import React from 'react';
import { List } from 'react-window';

// T24 — Render-prop virtualization wrapper.
//
// Below VIRTUALIZE_THRESHOLD rows, we render the page's existing markup
// unchanged via the `children` render-prop. This preserves the current
// look + a11y semantics for the common case (every page is well under
// 300 rows in dev and most prod tenants).
//
// At/above the threshold we switch to react-window v2's `List`. The page
// passes a `virtualRow(item, index, style, ariaAttributes)` renderer that
// MUST apply BOTH the supplied `style` (react-window absolute-positions
// each row) AND the `ariaAttributes` (which carry the proper
// role="listitem" + aria-posinset / aria-setsize for screen readers) to
// its outermost element. Failing to spread ariaAttributes degrades the
// virtualized branch's a11y vs the table fallback.
//
// For table-shaped data the page renders the header statically above this
// wrapper and the virtualRow uses a CSS grid that lines up with the
// header columns; we accept slight markup drift in the >300-row branch
// since it's a pure scroll-perf optimisation.
export const VIRTUALIZE_THRESHOLD = 300;

// Stable row adapter — defined once at module load so react-window can
// reuse the component identity across renders.
function VirtualRowAdapter({ index, style, ariaAttributes, items, virtualRow }) {
  return virtualRow(items[index], index, style, ariaAttributes);
}

export default function VirtualList({
  items,
  itemHeight,
  height = 600,
  virtualRow,
  ariaLabel,
  children,
}) {
  if (!Array.isArray(items)) return null;
  if (items.length < VIRTUALIZE_THRESHOLD) {
    return children(items);
  }

  return (
    <List
      style={{ height }}
      rowCount={items.length}
      rowHeight={itemHeight}
      defaultHeight={height}
      overscanCount={4}
      aria-label={ariaLabel || `List of ${items.length} items`}
      rowComponent={VirtualRowAdapter}
      rowProps={{ items, virtualRow }}
    />
  );
}
