import React, { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { diffText } from '../../../lib/textDiff';
import {
  columnHeading, compareNote, defaultPair, entryLabel, metaLines, pickPair, savedLine, versionEntries,
} from '../../../lib/templateVersions';
import { ReadState, button, date, useRead } from './parts';

// D717 (#1853) — Compare versions (board L9, frame "Version history"): any two
// saved versions, or a saved version and the unsaved draft, side by side. The
// Markdown source is compared as text (#1853 decision 10): React text nodes with
// <del> and <ins>, never generated HTML. Marks use the theme's tokens, and the
// strike and the underline carry the meaning, never the colour alone
// (#1853 decision 12). Restore copies a version's body into the draft and saves
// nothing (#1853 decision 13).

// The canvas's active fill, from Tailwind's palette: no hex literal in this file (#1853 decision 12).
const pairTint = 'bg-rose-50 dark:bg-rose-950/60';
const del = 'bg-axal-destructive-tint text-axal-destructive line-through dark:bg-red-950/50 dark:text-red-300';
const ins = 'bg-emerald-50 text-axal-positive underline dark:bg-emerald-950/50 dark:text-emerald-300';
const column = 'rounded-xl border border-axal-hairline bg-white px-4 py-[14px] dark:bg-gray-900';
const text = 'whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-[1.65]';
const textFont = { fontFamily: 'Helvetica, Arial, sans-serif' };

/** One side of the compare: equal parts as text, and this side's changes marked. */
function Side({ parts, op }) {
  return parts.map((p, i) => {
    if (p.op === 'eq') return <React.Fragment key={i}>{p.text}</React.Fragment>;
    if (p.op !== op) return null;
    return op === 'del'
      ? <del key={i} className={del}>{p.text}</del>
      : <ins key={i} className={ins}>{p.text}</ins>;
  });
}

export default function VersionCompare({ slug, draft, draftChanged, derived = null, partyLabel = (p) => p, authoring = false, onRestore }) {
  const read = useRead(() => api.adminTemplateStoreVersions(slug), [slug]);
  return (
    <ReadState read={read} what="Versions">
      {read.data && (
        <Compare data={read.data} draft={draft} draftChanged={draftChanged} derived={derived}
          partyLabel={partyLabel} authoring={authoring} onRestore={onRestore} />
      )}
    </ReadState>
  );
}

function Compare({ data, draft, draftChanged, derived, partyLabel, authoring, onRestore }) {
  const entries = useMemo(() => versionEntries(data, draftChanged ? draft : null), [data, draft, draftChanged]);
  const [choice, setChoice] = useState(() => ({ pair: defaultPair(entries, draftChanged), picked: null }));
  const pair = choice.pair && choice.pair.every(k => entries.some(e => e.key === k)) ? choice.pair : defaultPair(entries, draftChanged);
  const byKey = (k) => entries.find(e => e.key === k);
  const older = pair ? byKey(pair[0]) : null;
  const newer = pair ? byKey(pair[1]) : null;
  // About 190 ms at the word cap (D717.md), so only when the pair changes.
  const result = useMemo(() => (older && newer ? diffText(older.body_md, newer.body_md) : null), [older, newer]);
  const meta = older && newer ? metaLines(older, newer, { derived, partyLabel }) : [];
  const note = compareNote(result);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]" data-testid="version-compare">
      <div className="rounded-xl border border-axal-hairline bg-white p-3 dark:bg-gray-900">
        <div className="text-[12.5px] font-extrabold">Versions · read-only</div>
        <ul className="mt-2 space-y-1">
          {entries.map(e => {
            const on = !!pair?.includes(e.key);
            return (
              <li key={e.key} className="flex items-start gap-1">
                <button type="button" aria-pressed={on} data-version-row={e.key}
                  onClick={() => setChoice(c => pickPair(entries, pair, c.picked, e.key))}
                  className={`min-w-0 flex-1 rounded-lg p-2 text-left text-[12px] ${on ? pairTint : ''}`}>
                  <b>{entryLabel(e)}</b>
                  <span className="block text-axal-muted">{savedLine(e.saved, date)}</span>
                </button>
                {authoring && e.key !== 'draft' && (
                  <button type="button" className={`${button} mt-1 px-2 py-1`} onClick={() => onRestore?.(e.body_md)}>Restore</button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {!older || !newer ? (
        <p className={`${column} lg:col-span-2`} data-testid="version-compare-nothing">There is one saved version and no unsaved change to compare it with.</p>
      ) : (
        <>
          {(meta.length > 0 || note || !result.changed) && (
            <div className={`${column} space-y-1 text-[12px] lg:col-span-2 lg:col-start-2`} data-testid="version-compare-notes">
              {meta.map(line => <p key={line}>{line}</p>)}
              {note && <p className="text-axal-muted">{note}</p>}
              {!result.changed && <p>The text is the same in both.</p>}
            </div>
          )}
          <section className={`${column} lg:col-start-2`} aria-label={columnHeading(older, date)} data-testid="version-compare-older">
            <h3 className="mb-2 text-[12.5px] font-extrabold">{columnHeading(older, date)}</h3>
            <div className={text} style={textFont}><Side parts={result.parts} op="del" /></div>
          </section>
          <section className={column} aria-label={columnHeading(newer, date)} data-testid="version-compare-newer">
            <h3 className="mb-2 text-[12.5px] font-extrabold">{columnHeading(newer, date)}</h3>
            <div className={text} style={textFont}><Side parts={result.parts} op="ins" /></div>
          </section>
        </>
      )}
    </div>
  );
}
