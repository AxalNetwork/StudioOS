import { useState } from 'react';

/**
 * D6098 (#6098) — Product improvement's "Feedback themes" part: each theme
 * of the venture's feedback with its counts (`parts.themes`, a writer's only),
 * and Rename on each. A new name that is already a theme is a merge, and the
 * part asks first, saying how many rows move; a 409 from the Worker (the list
 * was stale) asks the same question with the Worker's own counts.
 * `PATCH /api/cycles/grow/feedback/themes` does the write.
 */
const BUTTON = 'whitespace-nowrap rounded-md border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'min-w-0 flex-1 rounded-md border border-axal-hairline px-2 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What a rename of `from` to `to` would do, given the themes the part holds. */
export function themeChange(themes, from, to) {
  const name = typeof to === 'string' ? to.trim().slice(0, 80) : '';
  if (!name) return { kind: 'empty', sentence: 'A theme needs a name.' };
  if (name === from) return { kind: 'same', sentence: 'The new name is the same as the old one.' };
  const source = (themes || []).find((t) => t?.theme === from);
  const target = (themes || []).find((t) => t?.theme === name);
  const feedback = Number(source?.feedback) || 0; const roadmapItems = Number(source?.roadmap_items) || 0;
  return target ? { kind: 'merge', to: name, feedback, roadmapItems } : { kind: 'rename', to: name, feedback, roadmapItems };
}

/** The confirmation a merge asks before it moves anything. */
export function mergeQuestion(from, to, feedback, roadmapItems) {
  return `Merge “${from}” into “${to}”? This moves ${plural(feedback, 'feedback row', 'feedback rows')} and ${plural(roadmapItems, 'roadmap item', 'roadmap items')} to “${to}”, and “${from}” is gone.`;
}

/** The line shown after a write, from the Worker's answer. */
export function doneLine(out) {
  const moved = `${plural(Number(out?.feedback) || 0, 'feedback row', 'feedback rows')} and ${plural(Number(out?.roadmap_items) || 0, 'roadmap item', 'roadmap items')}`;
  return out?.merged ? `Merged: ${moved} moved.` : `Renamed: ${moved} updated.`;
}

export default function FeedbackThemes({ themes, onRename, initialEditing = null, initialAsk = null }) {
  const [editing, setEditing] = useState(initialEditing);
  const [name, setName] = useState(initialEditing ?? '');
  const [ask, setAsk] = useState(initialAsk);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState('');
  const list = Array.isArray(themes) ? themes.filter((t) => t && typeof t.theme === 'string') : [];
  if (!list.length || !onRename) return null;

  const close = () => { setEditing(null); setName(''); setAsk(null); };
  const send = async (from, to, merge) => {
    setBusy(true); setRefusal(''); setNote('');
    try {
      const out = await onRename({ from, to, ...(merge ? { merge: true } : {}) });
      setNote(doneLine(out)); close();
    } catch (err) {
      const d = err?.data;
      if (err?.status === 409 && d?.merge_needed) setAsk({ from, to, feedback: Number(d.feedback) || 0, roadmapItems: Number(d.roadmap_items) || 0 });
      else setRefusal(err?.message || 'This could not be saved. Try again.');
    } finally { setBusy(false); }
  };
  const submit = (from) => {
    const change = themeChange(list, from, name);
    if (change.kind === 'empty' || change.kind === 'same') { setRefusal(change.sentence); return; }
    if (change.kind === 'merge') { setRefusal(''); setAsk({ from, to: change.to, feedback: change.feedback, roadmapItems: change.roadmapItems }); return; }
    send(from, change.to, false);
  };

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-feedback-themes">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Feedback themes</h2>
        <span className="text-[11px] text-axal-faint dark:text-gray-500">Rename a theme, or give it another theme’s name to merge them</span>
      </div>
      {refusal && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{refusal}</p>}
      {note && <p role="status" className="m-0 text-[12px] text-emerald-700 dark:text-emerald-300">{note}</p>}
      {ask && (
        <div role="alertdialog" aria-label="Merge themes" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-axal-ink dark:border-amber-700 dark:bg-amber-950 dark:text-gray-100" data-testid="feedback-theme-merge-confirm">
          <p className="m-0">{mergeQuestion(ask.from, ask.to, ask.feedback, ask.roadmapItems)}</p>
          <span className="flex gap-2">
            <button type="button" className={BUTTON} disabled={busy} onClick={() => send(ask.from, ask.to, true)} data-testid="feedback-theme-merge">Merge</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setAsk(null)}>Cancel</button>
          </span>
        </div>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {list.map((t) => (
          <li key={t.theme} className="flex flex-wrap items-center justify-between gap-2.5 border-b border-axal-ground py-[7px] text-[12px] last:border-b-0 dark:border-gray-800">
            {editing === t.theme ? (
              <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(t.theme); }}>
                <label className="sr-only" htmlFor={`theme-name-${t.theme}`}>New name for {t.theme}</label>
                <input id={`theme-name-${t.theme}`} className={INPUT} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                <button type="submit" className={BUTTON} disabled={busy}>Save</button>
                <button type="button" className={BUTTON} disabled={busy} onClick={close}>Cancel</button>
              </form>
            ) : (<>
              <span className="font-semibold text-axal-ink dark:text-gray-100">{t.theme}</span>
              <span className="flex items-center gap-2 text-axal-muted dark:text-gray-400">
                {plural(Number(t.feedback) || 0, 'feedback row', 'feedback rows')}
                {Number(t.roadmap_items) > 0 ? ` · ${plural(Number(t.roadmap_items), 'roadmap item', 'roadmap items')}` : ''}
                <button type="button" className={BUTTON} disabled={busy} onClick={() => { setEditing(t.theme); setName(t.theme); setAsk(null); setRefusal(''); }}
                  data-testid="feedback-theme-rename">Rename</button>
              </span>
            </>)}
          </li>
        ))}
      </ul>
    </section>
  );
}
