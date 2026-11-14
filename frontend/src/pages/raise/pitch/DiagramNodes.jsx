import React, { useEffect, useState } from 'react';
import { placeOf } from './gridModel';
import { LABEL_MAX, checkLine, editableNodes, setNodeLabel } from './diagramEditModel';

/**
 * D1542 (#3780, deck v2 B4) — the selected diagram's nodes, editable on the
 * canvas: one field over each node the layout draws (an item's label, or a
 * matrix's axis), placed on the block's own box, so a founder types into the
 * diagram where it sits. Enter or leaving the field commits one edit through
 * `onCard` (one undo step, held until Save); Escape puts the words back. An
 * empty label is refused with its sentence and changes nothing.
 *
 * `DiagramCheck`, under the card: after each edit the Worker checks the
 * diagram in code (`check`, the adapter's `diagrams`), and the line says it
 * fits, or the first fit problem, or the figure a label names. A check that
 * could not be read says so, never "fits".
 */
export function DiagramNodes({ block, card, aspect, onCard, onError = () => {} }) {
  const nodes = editableNodes(block.diagram);
  const [draft, setDraft] = useState({});
  useEffect(() => { setDraft({}); onError(null); }, [block.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (n) => {
    if (draft[n.key] === undefined) return;
    const r = setNodeLabel(card, block.id, n, draft[n.key]);
    setDraft((d) => { const next = { ...d }; delete next[n.key]; return next; });
    if (r.error) { onError(r.error); return; }
    onError(null);
    if (r.card) onCard(r.card, 'diagram');
  };
  const at = placeOf(block.grid, aspect);
  return (
    <div className="pointer-events-none absolute z-20 p-1.5" style={at} data-testid={`pitch-editor-diagram-nodes-${block.id}`}>
      <div className="relative h-full w-full">
        {nodes.map((n) => (
          <input key={n.key} type="text" maxLength={LABEL_MAX} aria-label={n.axis ? `Diagram axis ${n.axis === 'x' ? 'across' : 'up'}` : `Diagram step ${n.item + 1}`}
            value={draft[n.key] ?? n.label}
            onChange={(e) => setDraft((d) => ({ ...d, [n.key]: e.target.value }))}
            onBlur={() => commit(n)}
            onKeyDown={(e) => {
              e.stopPropagation?.();
              if (e.key === 'Enter') { e.preventDefault?.(); commit(n); }
              if (e.key === 'Escape') { e.preventDefault?.(); setDraft((d) => { const next = { ...d }; delete next[n.key]; return next; }); }
            }}
            onPointerDown={(e) => e.stopPropagation?.()}
            className="pointer-events-auto absolute min-w-0 rounded-[6px] border border-violet-400 bg-white/90 px-1 text-center text-[11px] font-bold text-gray-900 outline-none focus:ring-2 focus:ring-violet-400 dark:border-violet-500 dark:bg-gray-900/90 dark:text-gray-100"
            style={{ left: `${n.x * 100}%`, top: `${(n.y + n.h / 2) * 100}%`, width: `${n.w * 100}%`, transform: 'translateY(-50%)' }}
            data-testid={`pitch-editor-diagram-node-${n.key}`} />
        ))}
      </div>
    </div>
  );
}

/** The check's line under the card (a status, never a dialog): an edit's refusal first, else the Worker's check. */
export function DiagramCheck({ block, check, error }) {
  const [answer, setAnswer] = useState(null);
  const key = JSON.stringify([block.diagram, block.grid]);
  useEffect(() => {
    if (!check) return undefined;
    let alive = true;
    check(block.diagram, block.grid).then((a) => { if (alive) setAnswer(a); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = error ? { ok: false, text: error } : checkLine(answer);
  if (!line?.text) return null;
  return (
    <span role="status" className={`self-start rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold ${line.ok ? 'bg-violet-50 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'}`}
      data-testid={`pitch-editor-diagram-check-${block.id}`}>{line.text}</span>
  );
}

export default DiagramNodes;
