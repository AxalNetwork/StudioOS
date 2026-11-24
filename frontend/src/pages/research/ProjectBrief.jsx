/**
 * D5157 part 4 — a Research Project's brief: the member's eight sections, each with its "Reviewed by you" tick.
 *
 * D7816 (#7816) — the draft is held by the project page, not by the tab. `useBriefDraft(uid, read)` runs in
 * `ResearchProject.jsx`, which stays mounted while the member moves between the project's tabs, so:
 *   - a successful save replaces the held copy (sections and version) in place, without remounting the
 *     editor, and the next save names the version it wrote;
 *   - text typed and not saved survives a tab switch, in memory for the open project only (never browser
 *     storage), and the switch asks nothing;
 *   - leaving the project with unsaved text (another route, Back or Forward, reload, close) asks first, through
 *     `lib/leaveGuard.js` with a destination test that lets the project's own tabs through;
 *   - a save refused because the brief changed keeps every typed word and offers one action, "Load version N,
 *     keep my changes" (D7176's wording): sections the member changed keep their text, the others take the
 *     saved text, and the next save is accepted. A save refused because the project was archived says so and
 *     offers no load.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LEAVE_MESSAGE, useLeaveGuard } from '../../lib/leaveGuard.js';
import { researchProjectBriefsApi } from '../../lib/api/researchProjectBriefs.js';

const headings = ['Executive summary', 'Key findings', 'Market context', 'Company comparison',
  'Risks and uncertainty', 'Open questions', 'Sources', 'Methodology'];

const blank = () => headings.map(() => ({ text: '', reviewed: false }));
const sameSection = (a, b) => (a?.text ?? '') === (b?.text ?? '') && Boolean(a?.reviewed) === Boolean(b?.reviewed);
const savedSections = (base) => base?.sections ?? blank();
const fromBrief = (brief) => (brief ? { sections: brief.sections, version: brief.version } : null);
const isDirty = (held) => held.sections.some((s, i) => !sameSection(s, savedSections(held.base)[i]));

/** Sections the member changed against `base` keep their text; the others take `next`'s (D7176's merge). */
export function mergeBrief(draft, base, next) {
  const was = savedSections(base);
  return savedSections(next).map((section, i) => (sameSection(draft[i], was[i]) ? section : draft[i]));
}

/** `/research/projects/:uid` and its tabs: the destinations that keep this project's held draft. */
export const keepsProject = (uid) => (path) => {
  const root = `/research/projects/${encodeURIComponent(uid)}`;
  const pathname = String(path?.pathname ?? '').replace(/\/+$/, '');
  return pathname === root || (pathname.startsWith(`${root}/`) && !pathname.slice(root.length + 1).includes('/'));
};

/** The brief's held draft, for the open project only; call it from the page that outlives the tabs. */
export function useBriefDraft(uid, read) {
  const [held, setHeld] = useState(null); // { uid, base, sections, busy, notice, error, conflict }
  const live = useRef(uid);
  live.current = uid;
  const readBrief = read?.status === 'ok' ? read.value?.brief ?? null : undefined;

  useEffect(() => {
    if (readBrief === undefined) return;
    setHeld((h) => {
      const base = fromBrief(readBrief);
      if (!h || h.uid !== uid) return { uid, base, sections: base?.sections ?? blank(), busy: false, notice: null, error: null, conflict: null };
      // A later read of the same project is taken only when nothing is typed and it is not older than the held copy.
      if (isDirty(h) || h.busy || (base?.version ?? 0) < (h.base?.version ?? 0)) return h;
      return { ...h, base, sections: base?.sections ?? blank() };
    });
  }, [uid, readBrief]);

  const mine = held && held.uid === uid ? held : null;
  const dirty = Boolean(mine) && isDirty(mine);
  const update = useCallback((forUid, change) => setHeld((h) => (h && h.uid === forUid ? { ...h, ...change(h) } : h)), []);
  useLeaveGuard(dirty, LEAVE_MESSAGE, undefined, keepsProject(uid));

  const edit = (index, value) => update(uid, (h) => ({
    notice: null,
    sections: h.sections.map((section, i) => (i === index ? { ...section, ...value } : section)),
  }));

  const save = async () => {
    if (!mine) return;
    const forUid = uid;
    const { sections, base } = mine;
    update(forUid, () => ({ busy: true, error: null, notice: null, conflict: null }));
    try {
      const { brief: saved } = await researchProjectBriefsApi.save(forUid, { sections, version: base?.version ?? 0 });
      update(forUid, () => ({ base: fromBrief(saved), sections: saved.sections, busy: false, notice: 'Brief saved.' }));
    } catch (err) {
      const archived = err?.status === 409 && err?.code === 'project_archived';
      const changed = err?.status === 409 && !archived;
      update(forUid, () => ({
        busy: false,
        error: archived
          ? 'Not saved: this project was archived while you were writing. Your text is still here; restore the project to save it.'
          : changed
            ? 'Not saved: this brief changed since you opened it. Your text is still here, exactly as typed.'
            : `${err?.message || 'The brief could not be saved.'} Your text is still here.`,
        conflict: changed ? { version: null } : null,
      }));
      if (!changed) return;
      // Name the version the action would load (D7176's "Load version N"); without it the action still works.
      try {
        const { brief } = await researchProjectBriefsApi.read(forUid);
        if (brief && live.current === forUid) update(forUid, (h) => (h.conflict ? { conflict: { version: brief.version } } : {}));
      } catch { /* the action reads again when pressed */ }
    }
  };

  const loadKeepingChanges = async () => {
    if (!mine) return;
    const forUid = uid;
    update(forUid, () => ({ busy: true }));
    try {
      const { brief } = await researchProjectBriefsApi.read(forUid);
      update(forUid, (h) => ({
        base: fromBrief(brief), sections: mergeBrief(h.sections, h.base, fromBrief(brief)),
        busy: false, error: null, conflict: null, notice: 'Saved brief loaded, with your changes kept. Save to keep them.',
      }));
    } catch (err) {
      update(forUid, () => ({ busy: false, error: `${err?.message || 'The saved brief could not be read.'} Your text is still here.` }));
    }
  };

  return mine ? { ...mine, dirty, edit, save, loadKeepingChanges } : null;
}

export default function ProjectBrief({ read, retry, archived, draft }) {
  if (!draft) {
    if (read.status === 'loading') return <p role="status">Reading brief…</p>;
    return <p role="status">Brief could not be read. <button type="button" onClick={retry}>Retry</button></p>;
  }
  return <BriefEditor draft={draft} archived={archived} />;
}

function BriefEditor({ draft, archived }) {
  const { busy, notice, error, conflict, edit } = draft;
  const sections = archived ? savedSections(draft.base) : draft.sections;
  const version = draft.base?.version ?? 0;
  const submit = (event) => { event.preventDefault(); draft.save(); };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} aria-label="Research brief">
      <h2>Research brief</h2>
      {archived && !version ? <p>No brief was saved.</p> : null}
      {headings.map((heading, i) => (
        <section key={heading} className="rounded-lg border border-axal-hairline p-4 dark:border-gray-700">
          <h3>{heading}</h3>
          {archived ? (
            <><p className="whitespace-pre-wrap break-words">{sections[i].text || 'Not recorded'}</p>
              {sections[i].text ? <p>{sections[i].reviewed ? 'Reviewed by you' : 'Draft'}</p> : null}</>
          ) : (
            <>
              <textarea aria-label={heading} rows={4} maxLength={8000} value={sections[i].text} disabled={busy}
                className="mt-2 w-full rounded border border-axal-hairline p-2 dark:border-gray-700 dark:bg-gray-950"
                onChange={(event) => edit(i, { text: event.target.value, reviewed: false })} />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sections[i].reviewed} disabled={busy || !sections[i].text.trim()}
                  onChange={(event) => edit(i, { reviewed: event.target.checked })} />
                Reviewed by you
              </label>
            </>
          )}
        </section>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      {conflict && !archived ? (
        <button type="button" disabled={busy} onClick={draft.loadKeepingChanges}
          className="self-start rounded border border-axal-hairline px-4 py-2 hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800">
          {conflict.version ? `Load version ${conflict.version}, keep my changes` : 'Load the saved brief, keep my changes'}
        </button>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!archived ? <button type="submit" className="self-start rounded bg-axal-violet px-4 py-2 text-white disabled:opacity-50"
        disabled={busy || !sections.some((section) => section.text.trim())}>{busy ? 'Saving…' : 'Save brief'}</button> : null}
    </form>
  );
}
