import React from 'react';

/**
 * D717 (#1782) decision 11, #1855: the entity and money map on screen (L10's
 * "On screen" row). It prints the Worker's `model.map` as given: the boxes,
 * the numbered routes with their heads and markers, the guides, the labels and
 * the caption, every one a `<path>` or a `<text>`. It holds no coordinate of
 * its own, so it draws the same map, with the same numbers, as the paper page
 * (`services/fundStructurePaper.ts`).
 */
const STROKE = {
  licence: 'stroke-[#7C3AED] dark:stroke-violet-400',
  mercury: 'stroke-[#7C3AED] dark:stroke-violet-400',
  stripe: 'stroke-[#212B38] dark:stroke-gray-200',
};
const FILL = {
  licence: 'fill-[#7C3AED] dark:fill-violet-400',
  mercury: 'fill-[#7C3AED] dark:fill-violet-400',
  stripe: 'fill-[#212B38] dark:fill-gray-200',
};
const GREY_STROKE = 'stroke-[#8C8C94] dark:stroke-gray-500';
const GREY_FILL = 'fill-[#8C8C94] dark:fill-gray-400';
const PAPER = 'fill-white dark:fill-[#18161f]';

export default function FundStructureMap({ map }) {
  if (!map) return null;
  const [w, h] = map.view_box;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Structure of the Fund" className="block h-auto w-full" data-testid="fund-structure-map">
      <title>Structure of the Fund</title>
      {map.guides.map((g, i) => <path key={`g${i}`} d={g.d} fill="none" strokeWidth="0.6" className={GREY_STROKE} />)}
      {map.routes.map((r) => (
        <g key={r.id} data-route={r.id}>
          <path d={r.d} fill="none" strokeWidth="0.9" strokeDasharray={r.style === 'licence' ? '4 2' : undefined} className={STROKE[r.style]} />
          <path d={r.head} className={FILL[r.style]} />
          <path d={r.marker} strokeWidth="0.8" className={`${PAPER} ${STROKE[r.style]}`} data-testid="fund-structure-marker" />
          <text x={r.num.x} y={r.num.y} fontSize="7" fontWeight="700" textAnchor="middle" className={FILL[r.style]}>{r.id}</text>
        </g>
      ))}
      {map.boxes.map((b) => (
        <g key={b.id} data-box={b.id}>
          <path d={b.d} strokeWidth="0.9" strokeDasharray={b.outside ? '3 2' : undefined}
            className={`${PAPER} ${b.outside ? GREY_STROKE : STROKE.mercury}`} />
          <text x={b.title.x} y={b.title.y} fontSize="8.5" fontWeight="700" textAnchor="middle" className="fill-[#121726] dark:fill-gray-100">{b.title.text}</text>
          {b.sub && <text x={b.sub.x} y={b.sub.y} fontSize="6.5" textAnchor="middle" className={GREY_FILL}>{b.sub.text}</text>}
        </g>
      ))}
      {map.labels.map((l, i) => (
        <text key={`l${i}`} x={l.x} y={l.y} fontSize={l.size} textAnchor="middle"
          className={l.tone === 'ink' ? 'fill-[#212B38] dark:fill-gray-200' : GREY_FILL}>{l.text}</text>
      ))}
      <text x={map.caption.x} y={map.caption.y} fontSize={map.caption.size} textAnchor="middle" className={GREY_FILL}>{map.caption.text}</text>
    </svg>
  );
}
