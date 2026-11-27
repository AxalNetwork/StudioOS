// IP assignment rider. Four rows, each honestly derived:
//   - "Prior inventions disclosed" reflects what you typed in the exclusions box
//   - the two §3 rows are fixed template language
//   - open-source review has no data feed at all, and says so
//
// The design's "University tech-transfer disclosure not required — no sponsored
// research on this project" sentence is deliberately deleted: Axal cannot know
// how a founder's research was funded, and asserting it would be a fabricated
// legal claim.
import React from 'react';
import StatusPill from './StatusPill';

export default function IpRider({ items, note }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div data-testid="card-ip-rider">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
        IP assignment rider
      </div>
      <div className="space-y-3">
        {list.map((it, i) => (
          <div key={i} data-testid={`ip-item-${i}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-gray-700 dark:text-gray-200">{it.label}</span>
              <StatusPill tone={it.tone} label={it.status} size="xs" />
            </div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{it.detail}</div>
          </div>
        ))}
      </div>
      {/* The design closed this card with a caption asserting that no
          sponsored research applies. Axal cannot know how a founder's work was
          funded, so the slot is kept and the claim is inverted into the real
          gap it represents. */}
      {note && (
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-3 leading-snug" data-testid="ip-rider-note">{note}</p>
      )}
    </div>
  );
}
