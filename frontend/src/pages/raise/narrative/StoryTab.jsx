import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { narrativeApi } from '../../../lib/api/narrative';
import { Lightbox, Unreadable } from '../../../ui';
import { useDeckSources } from '../pitch/SourcesBoards';
import { gapLine, valueText, fillLink } from '../pitch/sourcesModel';
import { BoundFigure, SectionDot, SourceKind, TypedClaim } from './StoryComponents';
import {
  BINDINGS_UNREADABLE, INSERT_FOOT, LIVE_DECK, NOTE_MAX, NOTHING_TO_SAVE, NOT_RECORDED, SAVE_FAILED, SECTION_COUNT, STORY_UNREADABLE,
  audienceOf, bindingFromItem, bindingsBySection, boundChip, cannotInsert, claimSegments, draftOf, insertGroups, isLiveDeck,
  moveSection, saveDialog, savePlan, sectionDot, storySections,
} from './storyModel';
import { versionHref } from './narrativeModel';

/**
 * D910 (#2694) — NAR2, Story: the sections rail with its dots, reorderable by
 * keyboard; the writing surface for one section, saved through D908's
 * `PUT …/sections/:section`; the audience note; bound figures drawn from
 * PITCH's registry (NAR3, Insert a figure); typed numbers shown as claims;
 * and Save version, which opens a dialog that says what it changes. Dark
 * (NAR20) and the phone frame (NAR19b) are the same component. See
 * `storyModel.js` for every derivation.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13.5px] leading-relaxed text-axal-ink focus:border-axal-violet focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const NOT_SET = 'rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400';

function useNarrative(projectId, version, reload) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (!projectId || version == null) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    narrativeApi.read(projectId, version)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', data: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, version, reload]);
  return state;
}

/** The words as the founder will see them: typed numbers as claims. */
function ReadsAs({ text }) {
  if (!text.trim()) return <span className={`${NOT_SET} w-fit`} data-testid="story-not-recorded">{NOT_RECORDED}</span>;
  return (
    <p className={`m-0 whitespace-pre-line text-[13.5px] leading-[1.8] ${INK}`} data-testid="story-reads-as">
      {claimSegments(text).map((s, i) => (s.claim ? <TypedClaim key={i} text={s.text} state={s.state} /> : <React.Fragment key={i}>{s.text}</React.Fragment>))}
    </p>
  );
}

/** The sections rail: dots and words; Alt + arrow keys move the chosen section. */
function SectionRail({ order, byKey, sections, bindings, sources, active, onPick, onMove, readOnly }) {
  const label = (k) => sections.find((s) => s.key === k)?.label || k;
  const onKey = (e, key) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    if (e.altKey && !readOnly) onMove(key, delta);
    else {
      const next = order[order.indexOf(key) + delta];
      if (next) onPick(next);
    }
  };
  return (
    <nav aria-label="Sections" className={`${CARD} flex flex-col gap-1 p-2.5`} data-testid="story-rail">
      <div className="flex items-baseline justify-between px-1.5 pb-1">
        <span className={EYEBROW}>Sections</span>
        <span className={`text-[11px] ${MUTED}`}>{readOnly ? 'Read only' : 'Alt + ↑ ↓ to move'}</span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {order.map((key) => {
          const d = byKey[key];
          const dot = sectionDot({ body: d.body.trim() || null }, d.bindings, sources);
          const on = key === active;
          return (
            <li key={key}>
              <button type="button" aria-current={on ? 'true' : undefined} onClick={() => onPick(key)} onKeyDown={(e) => onKey(e, key)}
                className={`flex w-full items-start gap-2 rounded-[9px] border px-2 py-1.5 text-left ${on ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40' : 'border-transparent hover:bg-axal-ground dark:hover:bg-gray-800'}`}
                data-testid={`story-rail-${key}`}>
                <SectionDot state={dot} />
                <span className={`flex-1 text-[13px] ${on ? 'font-extrabold' : 'font-semibold'} ${INK}`}>{label(key)}</span>
                <span className={`pt-0.5 font-mono text-[10.5px] ${MUTED}`}>{dot}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** NAR3: the registry's items by area, each with its source, date and grade; a missing one says where to add it. */
function InsertFigure({ sources, current, onInsert, onClose }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => insertGroups(sources.data?.items, q), [sources.data, q]);
  return (
    <Lightbox label="Insert a figure" title="Insert a figure" sub="From your records, with its source, date and grade." onClose={onClose} width={520} testId="story-insert">
      <div className="flex flex-col gap-3">
        <input type="search" aria-label="Search your records" placeholder="Search your records" value={q} onChange={(e) => setQ(e.target.value)} className={FIELD} />
        {sources.status === 'loading' ? <p className={`m-0 text-[13px] ${MUTED}`}>Reading your records…</p>
          : sources.status !== 'ok' ? <Unreadable what="Your records" claim="This is not a claim that you have none." onRetry={sources.retry} />
            : groups.length === 0 ? <p className={`m-0 text-[13px] ${MUTED}`}>No record matches.</p>
              : groups.map((g) => (
                <section key={g.id} className="flex flex-col gap-1.5" data-testid={`story-insert-${g.id}`}>
                  <span className={EYEBROW}>{g.label}</span>
                  {g.items.map((it) => {
                    const why = cannotInsert(it, current);
                    const value = valueText(it);
                    if (it.state !== 'recorded') {
                      return (
                        <div key={it.source_key} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-dashed border-gray-300 px-3 py-2 dark:border-gray-600" data-testid={`story-insert-missing-${it.source_key}`}>
                          <span className={`text-[13px] font-semibold ${INK}`}>{it.label}</span>
                          <span className={`text-[11.5px] ${MUTED}`}>
                            {gapLine(it)}{it.state === 'not_recorded' && it.href ? <> · <Link to={fillLink(it).href} className={LINK}>{fillLink(it).text}</Link></> : null}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={it.source_key} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`story-insert-row-${it.source_key}`}>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className={`text-[13px] font-semibold ${INK}`}>{it.label} <span className="font-mono font-bold">{value}</span></span>
                          <span className={`inline-flex flex-wrap items-center gap-1 font-mono text-[10.5px] ${MUTED}`}><SourceKind source={it.source} /> · {it.module}{it.as_of ? ` · ${String(it.as_of).slice(0, 10)}` : ''} · {it.grade}</span>
                        </span>
                        <button type="button" className={GHOST} disabled={Boolean(why)} title={why || undefined} onClick={() => onInsert(it)} data-testid={`story-insert-${it.source_key}`}>Insert</button>
                      </div>
                    );
                  })}
                </section>
              ))}
        <p className={`m-0 text-[11.5px] leading-relaxed ${MUTED}`}>{INSERT_FOOT}</p>
      </div>
    </Lightbox>
  );
}

/** Save version: the dialog that says what it changes, then one write per changed section. */
function SaveDialog({ writes, version, onSave, onClose, saving, error }) {
  const d = saveDialog(writes, version);
  return (
    <Lightbox label={d.title} title={d.title} onClose={saving ? () => {} : onClose} width={500} testId="story-save"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={BTN} onClick={onSave} disabled={saving} data-testid="story-save-confirm">{saving ? 'Saving…' : d.confirm}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2.5">
        <ul className={`m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] ${INK}`}>{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {d.deck ? <p className={`m-0 text-[12.5px] leading-relaxed ${MUTED}`} data-testid="story-save-deck">{d.deck}</p> : null}
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{d.keep}</p>
        {error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="story-save-failed">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/** The Story tab for one version, read and written through D908's stores. */
export default function StoryTab({ projectId, version, search = '', phone = false }) {
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const read = useNarrative(projectId, version, reload);
  const sources = useDeckSources(projectId);
  const sections = read.status === 'ready' ? storySections(read.data) : null;
  const bindings = read.status === 'ready' ? bindingsBySection(read.data) : null;
  const [draft, setDraft] = useState(null);
  const [active, setActive] = useState(null);
  const [inserting, setInserting] = useState(false);
  const [saving, setSaving] = useState({ open: false, busy: false, error: null });

  useEffect(() => {
    if (!sections) { setDraft(null); return; }
    const d = draftOf(sections, bindings);
    setDraft(d);
    setActive((a) => (a && d.byKey[a] ? a : d.order[0] || null));
    // A fresh read replaces the draft; the read's own identity is the key.
  }, [read.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (read.status === 'loading') return <div className="h-40 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="narrative-loading" />;
  if (read.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`}>{read.message || 'This version could not be opened.'}</p>;
  if (read.status === 'error') return <Unreadable what={`Version ${version}`} claim="This is not a claim that it is empty." onRetry={retry} />;
  if (!sections) return <p role="alert" className="m-0 text-[13px] text-red-700 dark:text-red-300" data-testid="story-unreadable">{STORY_UNREADABLE}</p>;
  if (!draft) return null;

  const readOnly = isLiveDeck(read.data);
  const audience = audienceOf(read.data);
  const i = draft.order.indexOf(active);
  const spec = sections.find((s) => s.key === active);
  const cur = draft.byKey[active];
  const writes = savePlan({ sections, bindings }, draft);
  const patch = (key, p) => setDraft((d) => ({ ...d, byKey: { ...d.byKey, [key]: { ...d.byKey[key], ...p } } }));
  const srcState = sources.status === 'ok' ? { status: 'ok', items: sources.data?.items || [] } : { status: sources.status };
  const figures = (cur?.bindings || []).map((b) => ({ binding: b, view: boundChip(b, srcState) }));

  const doSave = async () => {
    setSaving({ open: true, busy: true, error: null });
    for (const w of writes) {
      try {
        await narrativeApi.saveSection(projectId, version, w.section, w.body);
      } catch (e) {
        setSaving({ open: true, busy: false, error: `${SAVE_FAILED} ${w.label}: ${e?.message || 'the save was refused'}.` });
        return;
      }
    }
    setSaving({ open: false, busy: false, error: null });
    retry();
  };

  const rail = (
    <SectionRail order={draft.order} byKey={draft.byKey} sections={sections} bindings={bindings} sources={srcState} active={active}
      onPick={setActive} onMove={(key, delta) => setDraft((d) => ({ ...d, order: moveSection(d.order, key, delta) }))} readOnly={readOnly} />
  );

  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-story">
      {readOnly ? <p role="status" className={`m-0 text-[12.5px] ${MUTED}`} data-testid="story-live-deck">{LIVE_DECK}</p> : null}
      <div className={phone ? 'flex flex-col gap-3' : 'grid grid-cols-1 gap-3.5 lg:grid-cols-[230px_minmax(0,1fr)]'}>
        {phone ? (
          <label className={`${CARD} flex items-center gap-2 px-3 py-2`}>
            <span className={EYEBROW}>Section</span>
            <select aria-label="Section" value={active || ''} onChange={(e) => setActive(e.target.value)} className="flex-1 bg-transparent text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="story-section-select">
              {draft.order.map((k) => <option key={k} value={k}>{sections.find((s) => s.key === k)?.label}</option>)}
            </select>
          </label>
        ) : rail}
        {spec && cur ? (
          <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`} data-testid="story-writer">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className={EYEBROW}>{SECTION_COUNT(i, draft.order.length)}</span>
                <h2 className={`m-0 text-[18px] font-extrabold tracking-[-.015em] ${INK}`}>{spec.label}</h2>
              </div>
              {!readOnly && !phone ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={GHOST} onClick={() => setInserting(true)} disabled={!bindings} title={!bindings ? BINDINGS_UNREADABLE : undefined} data-testid="story-insert-open">+ Insert a figure</button>
                  <button type="button" className={BTN} onClick={() => setSaving({ open: true, busy: false, error: null })} disabled={!writes.length} title={!writes.length ? NOTHING_TO_SAVE : undefined} data-testid="story-save-open">Save version</button>
                </div>
              ) : null}
            </div>
            {readOnly ? <ReadsAs text={cur.body} /> : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="sr-only">{spec.label} words</span>
                  <textarea aria-label={`${spec.label} words`} value={cur.body} maxLength={spec.max} rows={phone ? 8 : 6} className={FIELD}
                    onChange={(e) => patch(active, { body: e.target.value })} data-testid="story-words" />
                  <span className={`self-end font-mono text-[10.5px] ${MUTED}`}>{cur.body.length} / {spec.max}</span>
                </label>
                {spec.store === 'deck' ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="story-deck-words">These are the deck’s words for v{version}.</p> : null}
                <div className="flex flex-col gap-1">
                  <span className={EYEBROW}>Reads as</span>
                  <ReadsAs text={cur.body} />
                </div>
              </>
            )}
            <div className="flex flex-col gap-1.5" data-testid="story-figures">
              <span className={EYEBROW}>Figures in this section</span>
              {!bindings ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{BINDINGS_UNREADABLE}</p>
                : figures.length === 0 ? <span className={`text-[12px] ${MUTED}`}>No bound figure. {readOnly ? '' : 'Insert one from your records.'}</span>
                  : <div className="flex flex-wrap gap-1.5">{figures.map((f, n) => (
                    <BoundFigure key={f.binding.source_key} figure={f.view}
                      onRemove={readOnly ? undefined : () => patch(active, { bindings: cur.bindings.filter((_, j) => j !== n) })} />
                  ))}</div>}
            </div>
            <label className="flex flex-col gap-1">
              <span className={EYEBROW}>Audience note{audience ? ` · ${audience}` : ''}</span>
              {readOnly ? <span className={`text-[13px] ${cur.note ? INK : MUTED}`}>{cur.note || NOT_RECORDED}</span> : (
                <input type="text" aria-label="Audience note" value={cur.note} maxLength={NOTE_MAX} className={FIELD}
                  onChange={(e) => patch(active, { note: e.target.value })} data-testid="story-note" />
              )}
            </label>
            {phone && !readOnly ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={GHOST} onClick={() => setInserting(true)} disabled={!bindings}>+ Insert a figure</button>
                <button type="button" className={BTN} onClick={() => setSaving({ open: true, busy: false, error: null })} disabled={!writes.length}>Save version</button>
              </div>
            ) : null}
            <Link className={`${LINK} text-[12.5px]`} to={versionHref(version, search)} data-testid="narrative-story-open">One-liner, investor type and what it checks against: open v{version}</Link>
          </section>
        ) : null}
      </div>
      {inserting ? (
        <InsertFigure sources={sources} current={cur?.bindings || []} onClose={() => setInserting(false)}
          onInsert={(it) => { const b = bindingFromItem(it); if (b) patch(active, { bindings: [...cur.bindings, b] }); setInserting(false); }} />
      ) : null}
      {saving.open ? <SaveDialog writes={writes} version={version} saving={saving.busy} error={saving.error} onSave={doSave} onClose={() => setSaving({ open: false, busy: false, error: null })} /> : null}
    </div>
  );
}
