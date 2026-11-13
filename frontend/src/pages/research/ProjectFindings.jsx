/**
 * D5157 part 2 (#5157) — a Research Project's Findings tab
 * (`/research/projects/:uid/findings`), to RS-02 C · Findings and its dark
 * twin RS-12 in `design/incoming/Research v2 Page.dc.html`, and the Overview's
 * Most recent findings card.
 *
 * WHAT IS BUILT. The kind chips (All · Source facts · Eadwyn · Yours ·
 * Discarded) with their counts; a card per finding with its kind first, its
 * state and its numbered citations; Accept / Edit / Discard on an Eadwyn
 * interpretation; Write a conclusion and Save a source fact; Edit and Delete
 * on your own; and the citation panel (a side panel, a bottom sheet on a
 * phone) with the passage the finding cited and its source's state now.
 *
 * WHAT IS NOT, and says so: an interpretation is one of the project's Ask
 * answers, since no run writes interpretations of its own; Freshness, Flagged
 * and Conflicting have no store, so the panel's Freshness reads Not recorded
 * and no finding is flagged or put in conflict.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill } from '../../ui';
import { Unrecorded } from '../../ui/Honesty';
import Sheet from '../../ui/Sheet.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { BTN_PRIMARY } from '../hq/security/ActionDialog.jsx';
import { researchProjectFindingsApi } from '../../lib/api/researchProjectFindings.js';
import { shortDate } from './researchHome.js';
import {
  FINDING_FILTERS, FINDING_TEXT_LIMIT, citationPanel, findingDraftBody, findingDraftErrors, findingError, findingsView, recentFindings,
} from './researchFindings.js';

const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const EADWYN_CARD = 'flex flex-col gap-3 rounded-xl border border-dashed border-violet-300 bg-white p-4 dark:border-violet-700 dark:bg-gray-900';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const H2 = 'text-[14px] font-extrabold text-axal-ink dark:text-white';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const FAILURE = 'text-[12.5px] font-semibold text-red-700 dark:text-red-300';
const KIND_TAG = 'inline-flex items-center rounded-md border border-axal-hairline bg-axal-ground px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const mark = (s) => <><span aria-hidden="true">{s.glyph}</span> {s.label}</>;

/** A numbered citation chip: a 44px target on a phone, opening the passage. */
function CitationChip({ c, findingKey, onOpen, selected }) {
  return (
    <button type="button" onClick={() => onOpen(c)} aria-label={`Source ${c.n}: ${c.title || 'Untitled document'}`} aria-pressed={selected ? 'true' : 'false'}
      data-testid={`cite-${findingKey}-${c.n}`}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-1.5 text-[11.5px] font-extrabold sm:min-h-[24px] sm:min-w-[24px] ${selected
        ? 'border-violet-700 bg-violet-700 text-white dark:border-violet-400 dark:bg-violet-500 dark:text-gray-950'
        : 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200 dark:hover:bg-violet-900'}`}>
      {c.n}
    </button>
  );
}

/** The citation panel's body: the recorded passage and the source's state now. */
function PassageBody({ c }) {
  const p = citationPanel(c);
  return (
    <div className="flex flex-col gap-2" data-testid="citation-panel-body">
      <b className="text-[13px] text-axal-ink dark:text-white">{p.title}</b>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="font-bold text-axal-muted dark:text-gray-400">Source</dt>
        <dd><Pill tone={p.availability.tone} className="!text-[10.5px]">{mark(p.availability)}</Pill></dd>
        <dt className="font-bold text-axal-muted dark:text-gray-400">Year</dt>
        <dd className="text-axal-ink dark:text-gray-100">{p.year ?? <Unrecorded />}</dd>
        <dt className="font-bold text-axal-muted dark:text-gray-400">Page</dt>
        <dd className="text-axal-ink dark:text-gray-100">{p.page ?? <Unrecorded />}</dd>
        <dt className="font-bold text-axal-muted dark:text-gray-400">Freshness</dt>
        <dd className="text-axal-ink dark:text-gray-100" data-testid="citation-panel-freshness"><Unrecorded /></dd>
        {p.index ? <><dt className="font-bold text-axal-muted dark:text-gray-400">Index</dt><dd><Pill tone={p.index.tone} className="!text-[10.5px]">{mark(p.index)}</Pill></dd></> : null}
        {p.answer ? <><dt className="font-bold text-axal-muted dark:text-gray-400">In Ask</dt><dd><Pill tone={p.answer.tone} className="!text-[10.5px]">{mark(p.answer)}</Pill></dd></> : null}
      </dl>
      {p.passage ? (
        <blockquote className="border-l-2 border-violet-500 pl-3 text-[13px] leading-relaxed text-axal-ink dark:border-violet-400 dark:text-gray-200" data-testid="citation-panel-passage">{p.passage}</blockquote>
      ) : <p className={MUTED} data-testid="citation-panel-no-passage">No passage was recorded with this citation; it names the document only.</p>}
      {p.note ? <p className={MUTED} data-testid="citation-panel-note">{p.note}</p> : null}
      {p.availability.label === 'Available' && !p.inEvidence ? <p className={MUTED}>This document is not in the project’s evidence.</p> : null}
      {p.openHref ? <Link to={p.openHref} className={`${SECONDARY} self-start`} data-testid="citation-panel-open">Open in Library →</Link> : null}
    </div>
  );
}

function FindingCard({ card, archived, selected, onOpen, onChanged, projectUid }) {
  const [mode, setMode] = useState(null); // 'edit' | 'confirm-delete'
  const [draft, setDraft] = useState(card.text);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const run = async (fn, fallback) => {
    setBusy(true);
    setFailure(null);
    try { await fn(); setMode(null); onChanged(); } catch (err) { setFailure(`${findingError(err, fallback)} Nothing was changed.`); } finally { setBusy(false); }
  };
  const decide = (decision, text) => run(() => researchProjectFindingsApi.decide(projectUid, card.answerUid, decision, text), 'The decision could not be saved.');
  const saveEdit = (e) => {
    e?.preventDefault?.();
    const text = String(draft || '').trim();
    if (!text) { setFailure('Write the words you want to keep.'); return; }
    if (card.decidable) return decide('edit', text);
    return run(() => researchProjectFindingsApi.update(projectUid, card.uid, { text }), 'The conclusion could not be saved.');
  };
  const eadwyn = card.kind === 'interpretation';
  return (
    <article className={eadwyn ? EADWYN_CARD : CARD} data-testid={`finding-${card.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={KIND_TAG} data-testid={`finding-kind-${card.key}`}>{card.kindWord.label}</span>
        {card.state ? <Pill tone={card.state.tone} className="!text-[10.5px]">{mark(card.state)}</Pill> : null}
        {card.when ? <span className="text-[11.5px] text-axal-faint dark:text-gray-500">{shortDate(card.when)}</span> : null}
      </div>
      {mode === 'edit' ? (
        <form onSubmit={saveEdit} className="flex flex-col gap-2" data-testid={`form-edit-finding-${card.key}`}>
          <label htmlFor={`fe-${card.key}`} className="text-[12.5px] font-bold text-axal-ink dark:text-white">{card.decidable ? 'Your version of Eadwyn’s interpretation' : 'Your conclusion'}</label>
          <textarea id={`fe-${card.key}`} rows={4} value={draft} maxLength={FINDING_TEXT_LIMIT} onChange={(e) => setDraft(e.target.value)} className={INPUT} data-testid={`input-edit-finding-${card.key}`} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={SECONDARY} onClick={() => { setMode(null); setDraft(card.text); setFailure(null); }} disabled={busy}>Cancel</button>
            <button type="submit" className={BTN_PRIMARY} disabled={busy} data-testid={`button-save-finding-${card.key}`}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100" data-testid={`finding-text-${card.key}`}>{card.text}</p>
      )}
      {card.proposal && card.question ? <p className={MUTED}>From your Ask question “{card.question}”. Nothing is kept until you decide.</p> : null}
      {card.proposedText ? (
        <details className="text-[12.5px]" data-testid={`finding-proposed-${card.key}`}>
          <summary className="cursor-pointer font-bold text-axal-muted dark:text-gray-400">Eadwyn’s words</summary>
          <p className="mt-1 whitespace-pre-line text-axal-muted dark:text-gray-400">{card.proposedText}</p>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5" data-testid={`finding-cites-${card.key}`}>
        {card.citations.length
          ? card.citations.map((c) => <CitationChip key={c.n} c={c} findingKey={card.key} onOpen={(x) => onOpen(card.key, x)} selected={selected === c.n} />)
          : <span className={MUTED}>{card.kind === 'conclusion' ? 'No source: kept as your conclusion.' : 'No source recorded.'}</span>}
      </div>
      {failure ? <p role="alert" className={FAILURE}>{failure}</p> : null}
      {mode === 'confirm-delete' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-950" data-testid={`confirm-delete-${card.key}`}>
          <p className="text-[12.5px] text-axal-ink dark:text-gray-100">Delete this {card.kind === 'conclusion' ? 'conclusion' : 'source fact'}? Its sources stay in your Library and in the project.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={SECONDARY} onClick={() => setMode(null)} disabled={busy}>Cancel</button>
            <button type="button" className={SECONDARY} disabled={busy} data-testid={`button-delete-confirm-${card.key}`}
              onClick={() => run(() => researchProjectFindingsApi.remove(projectUid, card.uid), 'The finding could not be deleted.')}>{busy ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      ) : null}
      {!archived && mode === null ? (
        <div className="flex flex-wrap gap-1.5">
          {card.decidable && card.stateSlug !== 'accepted' ? <button type="button" className={card.proposal ? BTN_PRIMARY : SECONDARY} disabled={busy} onClick={() => decide('accept')} data-testid={`button-accept-${card.key}`}>Accept</button> : null}
          {card.decidable || card.editable ? <button type="button" className={SECONDARY} disabled={busy} onClick={() => { setDraft(card.text); setMode('edit'); }} data-testid={`button-edit-${card.key}`}>Edit</button> : null}
          {card.decidable && card.stateSlug !== 'discarded' ? <button type="button" className={SECONDARY} disabled={busy} onClick={() => decide('discard')} data-testid={`button-discard-${card.key}`}>Discard</button> : null}
          {card.deletable ? <button type="button" className={SECONDARY} disabled={busy} onClick={() => setMode('confirm-delete')} data-testid={`button-delete-${card.key}`}>Delete</button> : null}
        </div>
      ) : null}
    </article>
  );
}

/** Write a conclusion, or save a source fact on a recorded passage. */
function Composer({ kind, projectUid, view, onSaved, onClose }) {
  const [draft, setDraft] = useState({ kind, text: '', passage: '', documents: [] });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const fact = kind === 'source_fact';
  const save = async (e) => {
    e?.preventDefault?.();
    const found = findingDraftErrors(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await researchProjectFindingsApi.create(projectUid, findingDraftBody(draft));
      onSaved();
    } catch (err) {
      setFailure(`${findingError(err, 'Could not be saved.')} Nothing was saved.`);
    } finally { setBusy(false); }
  };
  const toggleDoc = (uid) => setDraft((d) => ({ ...d, documents: d.documents.includes(uid) ? d.documents.filter((x) => x !== uid) : [...d.documents, uid] }));
  return (
    <form onSubmit={save} className={CARD} data-testid={`form-new-${kind}`} aria-labelledby="fc-heading">
      <h2 id="fc-heading" className={H2}>{fact ? 'Save a source fact' : 'Write a conclusion'}</h2>
      {fact ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[12.5px] font-bold text-axal-ink dark:text-white">The passage it stands on</legend>
          {view.passages.length ? (
            <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {view.passages.map((p) => {
                const value = `${p.answer_uid}:${p.n}`;
                return (
                  <li key={value}>
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-md border border-axal-hairline p-2 text-[12.5px] dark:border-gray-700">
                      <input type="radio" name="fc-passage" value={value} checked={draft.passage === value} onChange={() => setDraft((d) => ({ ...d, passage: value }))} data-testid={`input-passage-${value}`} className="mt-1" />
                      <span className="min-w-0">
                        <b className="text-axal-ink dark:text-white">{p.title}</b>{p.page != null ? <span className="text-axal-faint dark:text-gray-500"> · page {p.page}</span> : null}
                        <span className="block text-axal-muted dark:text-gray-400">“{p.passage}”</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : <p className={MUTED} data-testid="composer-no-passages">No passage to stand on yet. A source fact rests on a passage one of this project’s Ask answers cited from its evidence: keep an Ask session with the project, then come back.</p>}
          {errors.passage ? <span role="alert" className={FAILURE}>{errors.passage}</span> : null}
        </fieldset>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="fc-text" className="text-[12.5px] font-bold text-axal-ink dark:text-white">{fact ? 'The fact, in your words' : 'Your conclusion'}</label>
        <textarea id="fc-text" rows={3} value={draft.text} maxLength={FINDING_TEXT_LIMIT} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} className={INPUT} data-testid="input-finding-text" aria-invalid={errors.text ? 'true' : undefined} />
        {errors.text ? <span role="alert" className={FAILURE}>{errors.text}</span> : null}
      </div>
      {!fact && view.evidence.length ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[12.5px] font-bold text-axal-ink dark:text-white">Sources <span className="font-normal text-axal-muted dark:text-gray-400">· optional</span></legend>
          <div className="flex flex-wrap gap-1.5">
            {view.evidence.map((d) => (
              <label key={d.uid} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-axal-hairline px-2 text-[12.5px] text-axal-ink sm:min-h-[32px] dark:border-gray-700 dark:text-gray-100">
                <input type="checkbox" checked={draft.documents.includes(d.uid)} onChange={() => toggleDoc(d.uid)} data-testid={`input-cite-doc-${d.uid}`} />{d.title}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {failure ? <p role="alert" className={FAILURE}>{failure}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={SECONDARY} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || (fact && !view.passages.length)} data-testid="button-save-new-finding">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

export function ProjectFindings({ projectUid, read, retry, archived, onChanged }) {
  const [filter, setFilter] = useState('all');
  const [composing, setComposing] = useState(null);
  const [open, setOpen] = useState(null); // { key, c }
  const phone = usePhoneWidth();
  const view = findingsView(read, filter);
  if (view.state === 'loading') return <p className={MUTED} role="status" data-testid="findings-loading">Reading the findings…</p>;
  if (view.state === 'unreadable') {
    return (
      <section className={CARD} role="status" data-testid="findings-unreadable">
        <strong className="text-axal-ink dark:text-white">Unavailable</strong>
        <p className={MUTED}>The findings could not be read just now. Nothing about them has changed.</p>
        <button type="button" className={`${SECONDARY} self-start`} onClick={retry} data-testid="button-findings-retry">Retry</button>
      </section>
    );
  }
  const changed = () => { setComposing(null); onChanged(); };
  const openCite = (key, c) => setOpen((o) => (o && o.key === key && o.c.n === c.n ? null : { key, c }));
  const panel = open ? (
    phone ? (
      <Sheet label="Source" eyebrow={`Source ${open.c.n}`} title={open.c.title || 'Untitled document'} onClose={() => setOpen(null)} phone="sheet" width={480} testId="citation-sheet">
        <PassageBody c={open.c} />
      </Sheet>
    ) : (
      <aside className={`${CARD} lg:sticky lg:top-4 lg:self-start`} aria-label="Source for the selected citation" data-testid="citation-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className={H2}>Source {open.c.n}</h2>
          <button type="button" className={SECONDARY} aria-label="Close source" onClick={() => setOpen(null)} data-testid="button-close-citation">✕</button>
        </div>
        <PassageBody c={open.c} />
      </aside>
    )
  ) : null;
  return (
    <div className="flex flex-col gap-4" data-testid="project-findings-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Finding type" className="flex flex-wrap gap-1.5" data-testid="findings-filters">
          {FINDING_FILTERS.map((f) => (
            <button key={f.slug} type="button" role="radio" aria-checked={filter === f.slug ? 'true' : 'false'} onClick={() => setFilter(f.slug)} data-testid={`findings-filter-${f.slug}`}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-bold sm:min-h-[32px] ${filter === f.slug
                ? 'border-violet-700 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200'
                : 'border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
              {f.label}<span className="tabular-nums">{view.counts[f.slug]}</span>
            </button>
          ))}
        </div>
        {!archived ? (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={SECONDARY} onClick={() => setComposing('source_fact')} data-testid="button-new-source-fact">Save a source fact</button>
            <button type="button" className={SECONDARY} onClick={() => setComposing('conclusion')} data-testid="button-new-conclusion">Write a conclusion</button>
          </div>
        ) : null}
      </div>
      {composing && !archived ? <Composer key={composing} kind={composing} projectUid={projectUid} view={view} onSaved={changed} onClose={() => setComposing(null)} /> : null}
      <div className={`grid gap-4 ${open && !phone ? 'lg:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
        <div className="flex flex-col gap-2.5">
          {view.empty ? (
            <section className={CARD} data-testid="findings-empty">
              <strong className="text-axal-ink dark:text-white">No findings yet</strong>
              <p className={MUTED}>Save a source fact on a passage your Ask answers cited, or write your own conclusion. When an Ask session is kept with this project, Eadwyn’s answers appear here for you to accept, edit or discard.</p>
            </section>
          ) : !view.cards.length ? (
            <p className={MUTED} data-testid="findings-filter-empty">Nothing under this filter.</p>
          ) : view.cards.map((card) => (
            <FindingCard key={card.key} card={card} archived={archived} projectUid={projectUid} onChanged={onChanged}
              selected={open && open.key === card.key ? open.c.n : null} onOpen={openCite} />
          ))}
          <p className="text-[11.5px] text-axal-faint dark:text-gray-500">
            A numbered source is the passage the finding cites. It is a reference, not a check that the passage supports the sentence. An Eadwyn interpretation is one of this project’s Ask answers, kept only once you accept or edit it.
          </p>
        </div>
        {panel}
      </div>
    </div>
  );
}

/** The Overview's Most recent findings, from the same read. */
export function RecentFindingsCard({ projectUid, read, retry, className }) {
  const recent = recentFindings(read);
  const to = `/research/projects/${encodeURIComponent(projectUid)}/findings`;
  return (
    <section className={`${CARD} ${className || ''}`} data-testid="project-findings">
      <div className="flex items-center justify-between gap-2">
        <h2 className={H2}>Most recent findings</h2>
        <Link className="text-[12.5px] font-bold text-violet-700 dark:text-violet-300" to={to} data-testid="link-all-findings">All findings →</Link>
      </div>
      {recent.state === 'loading' ? <p className={MUTED} role="status">Reading the findings…</p> : null}
      {recent.state === 'unreadable' ? (
        <p className={MUTED} role="status" data-testid="project-findings-unreadable">Unavailable: the findings could not be read. <button type="button" className="underline" onClick={retry}>Retry</button></p>
      ) : null}
      {recent.state === 'ok' ? (
        <>
          {recent.cards.length ? (
            <ul className="flex flex-col gap-2">
              {recent.cards.map((card) => (
                <li key={card.key} className="flex flex-col gap-1 text-[12.5px]">
                  <span><span className={KIND_TAG}>{card.kindWord.label}</span>{card.state ? <span className="ml-1.5 text-axal-muted dark:text-gray-400">{card.state.label}</span> : null}</span>
                  <span className="line-clamp-3 text-axal-ink dark:text-gray-100">{card.text}</span>
                </li>
              ))}
            </ul>
          ) : <p className={MUTED} data-testid="project-findings-empty">No findings kept yet.</p>}
          {recent.waiting ? <p className={MUTED} data-testid="project-findings-waiting">{recent.waiting} Eadwyn {recent.waiting === 1 ? 'interpretation needs' : 'interpretations need'} your review.</p> : null}
        </>
      ) : null}
    </section>
  );
}

export default ProjectFindings;
