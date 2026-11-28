/**
 * D8546 part 2 (#9020, boards V17 and V29 of the Validate v2 Discovery and ICP canvas): Problem discovery's
 * "Proposed grouping" cards, on D8546's mounted routes (`/api/progress/pain-grouping-proposals`).
 *
 * One card per pending proposal: its quotes, each with the interviews that said it (a quote from an
 * interview that did not agree to be quoted is marked), the theme it goes to or the new theme's title,
 * and Discard, Edit and Accept. Edit keeps or drops quotes and, for a new theme, changes the title;
 * the original stays as proposed on the Worker. Accept is the whole set in one write, and the page's
 * themes are read again so the new or extended theme shows.
 *
 * Writers only. A reader who cannot write gets no section and no read (the Worker refuses them anyway).
 * A failed read says Unavailable, never 0 or "none waiting". Each 409 the Worker sends (`stale_source`,
 * `stale_target`, `stale_grouping`, `already_decided`) has its own sentence and reads the list again.
 * The Worker's own wording is never shown raw.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { painGroupingProposalsApi } from '../../lib/api/painGroupingProposals.js';

const SECTION = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-3 py-2.5 text-[12.5px] dark:border-gray-800 dark:bg-gray-950';
const BUTTON = 'inline-flex flex-1 items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:border-axal-violet disabled:opacity-50 max-lg:min-h-11 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-500';
const PRIMARY = 'inline-flex flex-1 items-center justify-center rounded-[9px] border border-axal-violet bg-axal-violet px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 max-lg:min-h-11 dark:border-violet-500 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500';
const NOTE = 'm-0 text-[11px] leading-relaxed text-axal-faint dark:text-gray-500';
const ERROR = 'm-0 text-[12px] text-red-700 dark:text-red-300';
const PILL = 'inline-flex whitespace-nowrap rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
const NO_CONSENT = 'inline-flex whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Each refusal the routes send, in the page's words; `refresh` reads the list again. */
const REFUSALS = {
  stale_source: { refresh: true, text: 'A quote in this grouping is no longer in the interview it came from. Nothing was saved. The groupings were read again: edit its quotes or discard it.' },
  stale_target: { refresh: true, text: 'The theme this grouping goes to is gone. Nothing was saved. The groupings were read again: discard it.' },
  stale_grouping: { refresh: true, text: 'The theme or an interview changed while this grouping was being accepted. Nothing was saved. The groupings were read again: check it and accept again.' },
  already_decided: { refresh: true, text: 'This grouping was already decided, perhaps in another tab. Nothing more was saved. The groupings were read again.' },
  proposal_not_found: { refresh: true, text: 'This grouping is no longer on this venture. Nothing was saved. The groupings were read again.' },
  accept_failed: { refresh: false, text: 'The grouping could not be accepted. Nothing was saved; try again.' },
  title_required: { refresh: false, text: 'A new theme needs a title. Nothing was changed.' },
};
const FALLBACK = { refresh: false, text: 'That could not be done just now. Nothing was changed; try again.' };

/** The sentence and whether to read again for a refused write. Never the raw error. */
export function groupingRefusal(err) {
  const code = typeof err?.code === 'string' ? err.code : null;
  return { code, ...(code && Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : FALLBACK) };
}

/** "2 quotes → new theme “…”" or "1 quote → add to “…”". */
export function groupingHeadline(p) {
  const n = Array.isArray(p?.members) ? p.members.length : 0;
  const quotes = plural(n, 'quote', 'quotes');
  if (p?.target_group_id == null) return `${quotes} → new theme “${p?.target_title || 'Untitled'}”`;
  return p.target_title ? `${quotes} → add to “${p.target_title}”` : `${quotes} → add to a theme that is no longer there`;
}

/** The PATCH body for the kept quotes: one { phrase, interview_id } per quote and interview that said it. */
export function editBody(p, kept, title) {
  const body = {};
  const members = (p.members || []).filter((m) => kept.has(m.phrase));
  if (members.length !== (p.members || []).length) {
    body.members = members.flatMap((m) => (m.sources || []).map((s) => ({ phrase: m.phrase, interview_id: s.interview_id })));
  }
  if (p.target_group_id == null && typeof title === 'string' && title.trim() !== (p.target_title || '')) body.title = title.trim();
  return body;
}

function Sources({ sources }) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return <span className="text-axal-faint dark:text-gray-500">Interview not recorded</span>;
  return list.map((s, i) => (
    <span key={`${s.interview_id}-${i}`} className="inline-flex flex-wrap items-center gap-1">
      {i > 0 && <span aria-hidden="true">·</span>}
      <span>{s.interviewee || 'Interviewee not recorded'}</span>
      {s.quote_consent !== true && <span className={NO_CONSENT} data-testid="grouping-no-consent">No consent to quote</span>}
    </span>
  ));
}

function GroupingCard({ p, busy, saving, onDecide }) {
  const [editing, setEditing] = useState(false);
  const [kept, setKept] = useState(() => new Set((p.members || []).map((m) => m.phrase)));
  const [title, setTitle] = useState(p.target_title || '');
  const [local, setLocal] = useState('');
  const newTheme = p.target_group_id == null;
  const cancel = () => { setEditing(false); setKept(new Set((p.members || []).map((m) => m.phrase))); setTitle(p.target_title || ''); setLocal(''); };
  const toggle = (phrase) => setKept((prev) => { const next = new Set(prev); if (next.has(phrase)) next.delete(phrase); else next.add(phrase); return next; });
  const save = async () => {
    if (!kept.size) { setLocal('Keep at least one quote. To drop them all, discard the grouping.'); return; }
    if (newTheme && !title.trim()) { setLocal('A new theme needs a title.'); return; }
    const body = editBody(p, kept, title);
    if (!Object.keys(body).length) { cancel(); return; }
    setLocal('');
    if (await onDecide('edit', p, body)) setEditing(false);
  };
  return (
    <li className={CARD} data-testid="grouping-card" data-id={p.id} aria-busy={saving ? 'true' : undefined}>
      <span className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-axal-faint dark:text-gray-500">
        Proposed grouping{p.edited && <span className={PILL} data-testid="grouping-edited">Edited</span>}
      </span>
      <b className="text-[13px] leading-snug text-axal-ink dark:text-gray-100" data-testid="grouping-headline">{groupingHeadline(p)}</b>
      {editing ? (
        <fieldset className="m-0 flex flex-col gap-2 rounded-lg border border-axal-hairline p-2.5 dark:border-gray-800" disabled={busy} data-testid="grouping-edit-form">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-axal-faint dark:text-gray-500">Your version</legend>
          {newTheme && (
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">
              New theme’s title
              <input type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="grouping-edit-title"
                className="rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] font-normal text-axal-ink max-lg:min-h-11 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
            </label>
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {(p.members || []).map((m) => (
              <li key={m.phrase}>
                <label className="flex items-start gap-2 text-[12.5px] text-axal-ink max-lg:min-h-11 max-lg:items-center dark:text-gray-100">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-axal-violet max-lg:h-5 max-lg:w-5" checked={kept.has(m.phrase)} onChange={() => toggle(m.phrase)}
                    aria-label={`Keep “${m.phrase}”`} data-testid="grouping-edit-keep" />
                  <span>“{m.phrase}”</span>
                </label>
              </li>
            ))}
          </ul>
          <p className={NOTE}>The grouping as proposed is kept beside your version. Nothing is saved to a theme until you accept.</p>
        </fieldset>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="grouping-members">
          {(p.members || []).map((m) => (
            <li key={m.phrase} className="flex flex-col gap-0.5" data-testid="grouping-member">
              <span className="text-axal-ink dark:text-gray-100">“{m.phrase}”</span>
              <span className="flex flex-wrap items-center gap-1"><Sources sources={m.sources} /></span>
            </li>
          ))}
        </ul>
      )}
      {local && <p role="alert" className={ERROR} data-testid="grouping-edit-invalid">{local}</p>}
      <span className={NOTE}>{editing ? 'Save keeps it waiting for your review.' : 'Accept the set, or edit its title or quotes first. Not saved yet.'}</span>
      <div className="flex gap-1.5">
        {editing ? (
          <>
            <button type="button" className={BUTTON} disabled={busy} onClick={cancel} data-testid="grouping-edit-cancel">Cancel</button>
            <button type="button" className={PRIMARY} disabled={busy} onClick={save} data-testid="grouping-edit-save">{saving ? 'Saving…' : 'Save'}</button>
          </>
        ) : (
          <>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => onDecide('discard', p)} data-testid="grouping-discard">Discard</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setEditing(true)} data-testid="grouping-edit">Edit</button>
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => onDecide('accept', p)} data-testid="grouping-accept">{saving ? 'Saving…' : 'Accept'}</button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * The section. `canWrite` is the module read's `parts.can_write`; without it nothing is read or drawn.
 * `onAccepted` reads the module again, so the themes list shows the new or extended theme.
 */
export default function ProposedGroupings({ projectId, canWrite, onAccepted = null, api = painGroupingProposalsApi }) {
  const active = canWrite === true && projectId != null && projectId !== '';
  const [read, setRead] = useState({ status: 'loading', proposals: [] });
  const [busy, setBusy] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState('');
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!active) return;
    setRead((r) => ({ ...r, status: r.status === 'ready' ? 'ready' : 'loading' }));
    try {
      const res = await api.list(projectId);
      setRead({ status: 'ready', proposals: Array.isArray(res?.proposals) ? res.proposals.filter((p) => p?.status === 'pending' || p?.status == null) : [] });
    } catch {
      setRead({ status: 'error', proposals: [] });
    }
  }, [active, api, projectId]);

  useEffect(() => { load(); }, [load]);

  /** One decision at a time; a second press while one is in flight sends nothing. */
  const decide = useCallback(async (kind, p, body) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(p.id); setRefusal(null); setDone('');
    try {
      if (kind === 'accept') {
        const r = await api.accept(projectId, p.id);
        const n = Number(r?.assigned);
        setDone(`Accepted. ${Number.isFinite(n) ? plural(n, 'quote is', 'quotes are') : 'The quotes are'} in “${p.target_title || 'the theme'}”.`);
        await load();
        await onAccepted?.();
      } else if (kind === 'discard') {
        await api.discard(projectId, p.id);
        setDone('Discarded. No theme was changed.');
        await load();
      } else {
        await api.edit(projectId, p.id, body);
        setDone('Your version is saved. It is still waiting for your review.');
        await load();
      }
      return true;
    } catch (err) {
      const r = groupingRefusal(err);
      setRefusal(r);
      if (r.refresh) await load();
      return false;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }, [api, load, onAccepted, projectId]);

  if (!active) return null;
  const n = read.proposals.length;
  return (
    <section className={SECTION} data-testid="validate-proposed-groupings" data-state={read.status === 'ready' ? (n ? 'some' : 'none') : read.status} aria-labelledby="validate-proposed-groupings-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="validate-proposed-groupings-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Proposed groupings</h2>
        {read.status === 'ready' && n > 0 && <span className={PILL} data-testid="grouping-waiting">{n} waiting</span>}
      </div>
      <p className="m-0 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">Groupings of quotes from your interviews, proposed for one theme each. Nothing is saved until you accept.</p>
      {refusal && <p role="alert" className={ERROR} data-testid="grouping-refusal" data-code={refusal.code || ''}>{refusal.text}</p>}
      {done && <p role="status" className="m-0 text-[12px] text-emerald-700 dark:text-emerald-300" data-testid="grouping-done">{done}</p>}
      {read.status === 'loading' && <p className={NOTE} data-testid="grouping-loading">Reading proposed groupings…</p>}
      {read.status === 'error' && (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="grouping-unavailable">
          <b className="font-bold text-axal-ink dark:text-gray-100">Unavailable.</b> Proposed groupings could not be read. That is not the same as none waiting.{' '}
          <button type="button" className="font-semibold text-axal-violet underline max-lg:min-h-11 dark:text-violet-300" onClick={load} data-testid="grouping-retry">Try again</button>
        </p>
      )}
      {read.status === 'ready' && !n && <p className={NOTE} data-testid="grouping-none">No proposed groupings are waiting for your review.</p>}
      {read.status === 'ready' && n > 0 && (
        <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 lg:grid-cols-2">
          {read.proposals.map((p) => <GroupingCard key={`${p.id}-${p.edited ? 'e' : 'o'}-${(p.members || []).length}-${p.target_title || ''}`} p={p} busy={busy != null} saving={busy === p.id} onDecide={decide} />)}
        </ul>
      )}
    </section>
  );
}
