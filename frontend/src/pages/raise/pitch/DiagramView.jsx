import React from 'react';
import { diagramName } from './diagramLayout';

/**
 * D903 §11 (#3660): a typed diagram (timeline, flow, cycle, matrix) drawn from
 * its layout (`diagramLayout.js`, the Worker's mirror), read-only: the editor's
 * card, Present, and the print page the PDF and the PowerPoint pictures
 * photograph. Connectors are an inline SVG; every word is text. Editing a
 * diagram's items on the canvas is #3780's.
 */
export default function DiagramView({ layout, colours, big = false, blockId = 'd' }) {
  const mark = `dga-${String(blockId).replace(/[^A-Za-z0-9_-]/g, '')}`;
  const pc = (n) => `${n * 100}%`;
  const ink = colours?.ink || undefined;
  const muted = colours?.muted || '#64748b';
  const label = big ? 'text-[26px]' : 'text-[11px]';
  const small = big ? 'text-[19px]' : 'text-[9px]';
  return (
    <span className="relative block h-full w-full" role="group" aria-label={`${diagramName(layout.type)} diagram`} data-testid={`deck-diagram-${blockId}`} data-diagram={layout.type}>
      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <marker id={mark} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill={muted} />
          </marker>
        </defs>
        {layout.shapes.filter((s) => s.kind === 'line').map((s, i) => (
          <line key={i} x1={s.x1 * 100} y1={s.y1 * 100} x2={s.x2 * 100} y2={s.y2 * 100} stroke={muted} strokeWidth={big ? 3 : 1.5}
            vectorEffect="non-scaling-stroke" markerEnd={s.arrow ? `url(#${mark})` : undefined} />
        ))}
      </svg>
      {layout.shapes.map((s, i) => {
        if (s.kind === 'dot') {
          return <span key={i} aria-hidden="true" className={`absolute rounded-full ${big ? 'h-4 w-4 -ml-2 -mt-2' : 'h-2 w-2 -ml-1 -mt-1'}`} style={{ left: pc(s.x + s.w / 2), top: pc(s.y + s.h / 2), background: muted }} />;
        }
        if (s.kind !== 'node') return null;
        const at = { left: pc(s.x), top: pc(s.y), width: pc(s.w), height: pc(s.h) };
        if (s.role === 'axis') {
          return (
            <span key={i} className={`absolute flex items-center justify-center text-center ${small}`}
              style={{ ...at, color: muted, ...(s.vertical ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)' } : {}) }}>{s.label}</span>
          );
        }
        return (
          <span key={i} className={`absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-[8px] border text-center ${big ? 'px-3 py-2' : 'px-1 py-0.5'}`}
            style={{ ...at, borderColor: 'rgba(100,116,139,0.3)', background: 'rgba(148,163,184,0.12)', color: ink }}>
            {s.date ? <span className={`${small} font-bold uppercase`} style={{ color: muted }}>{s.date}</span> : null}
            <span className={`${label} font-bold leading-tight`}>{s.label}</span>
            {s.detail ? <span className={`${small} leading-snug`} style={{ color: muted }}>{s.detail}</span> : null}
          </span>
        );
      })}
    </span>
  );
}
