import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { deckScriptApi } from '../../../lib/api/deckScript';
import { presentHref } from './presentExportModel';
import { NEW_PATH } from './newDeckModel';
import {
  AUDIENCES, CONFLICT, DEFAULT_LENGTH, DEFAULT_WPM, DOWNLOAD_NOTE, EMPTY, FAILED, LENGTHS, NOTES_MAX, NO_DECK, NO_UID, RULE, STALE, TONES,
  budgetsS, cardLabel, failReason, fileName, fingerprint, generatedLine, headerLine, holdLine, isStale, overLine, paceLine,
  rehearsalLength, scriptText, sectionLine, spokenS, timeLine, unsavedLine, wordsOf,
} from './scriptModel';

/**
 * D4268 (#4268, D4254 P2a) — Script & rehearsal › Script, built to the canvas
 * (ps4 desktop, ps9b phone, ps4-d dark).
 *
 *   Left   the cards, each with its spoken time against its budget; an
 *          over-budget card is marked. On a phone, a card picker instead.
 *   Right  one document, a section per card: its title, the script (edited
 *          in place), its words and its time against the budget.
 *
 * A section is: placed by Generate and Not saved; out of date (the card's
 * words changed after its script was generated); failed (Try again); empty;
 * or over budget. Generate runs every card under one hold and places drafts
 * only: Save script writes the notes alone, as one version
 * (`PUT /api/decks/:id/notes-script`). Nothing is saved without it.
 *
 * Out of date is read from the fingerprint of the card's words that a
 * generated script was saved against, kept in this browser
 * (`axal.script.from.<deck project>`): another browser does not mark it.
 *
 * An admin reads the script and copies or downloads it; nothing is run or saved.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const QUIET = `${BTN} text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800`;
const VIOLET = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:hover:bg-violet-500`;
const SMALL = 'inline-flex min-h-[28px] items-center justify-center whitespace-nowrap rounded-[8px] px-2.5 text-[11.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50';
const SMALL_GHOST = `${SMALL} text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800`;
const SMALL_LINE = `${SMALL} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono text-[11.5px]';
const OVER = 'font-bold text-amber-800 dark:text-amber-300';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_LAV = `${PILL} border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200`;
const PILL_GREY = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
const CHIP = 'inline-flex min-h-[30px] items-center rounded-full border px-3 text-[12px] font-bold';
const CHIP_ON = `${CHIP} border-axal-violet bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200`;
const CHIP_OFF = `${CHIP} border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-100`;
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';

const STORE = (projectId) => `axal.script.from.${projectId}`;
function readFrom(projectId) {
  try { return JSON.parse(localStorage.getItem(STORE(projectId)) || '{}') || {}; } catch { return {}; }
}
function writeFrom(projectId, next) {
  try { localStorage.setItem(STORE(projectId), JSON.stringify(next)); } catch { /* a per-browser hint only */ }
}
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `script-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const failureOf = (e, dflt) => e?.data?.message || (typeof e?.data?.error === 'string' && !/^[a-z_]+$/.test(e.data.error) ? e.data.error : null) || dflt;

function Group({ label, options, value, onPick, testId, disabled }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={MUTED}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5" data-testid={testId}>
        {options.map((o) => {
          const id = o.seconds ?? o.id;
          return (
            <button key={id} type="button" role="radio" aria-checked={id === value} disabled={disabled}
              className={id === value ? CHIP_ON : CHIP_OFF} onClick={() => onPick(id)} data-testid={`${testId}-${id}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ScriptTab({ reads, readOnly }) {
  const projectId = reads.project?.id ?? null;
  const deck = reads.deck.status === 'ok' ? reads.deck.data : null;
  const slides = useMemo(() => (Array.isArray(deck?.slides) ? deck.slides : []), [deck]);
  const [length, setLength] = useState(DEFAULT_LENGTH);
  const [audience, setAudience] = useState('investor_meeting');
  const [tone, setTone] = useState('clear');
  const [quote, setQuote] = useState({ status: 'idle', data: null });
  const [drafts, setDrafts] = useState({});
  const [failed, setFailed] = useState({});
  const [running, setRunning] = useState(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const [selected, setSelected] = useState(0);
  const [from, setFrom] = useState({});
  const sections = useRef({});

  // A new version (a save here or elsewhere) starts from what it holds.
  useEffect(() => { setDrafts({}); setFailed({}); setSelected(0); }, [deck?.id]);
  useEffect(() => { setFrom(projectId == null ? {} : readFrom(projectId)); }, [projectId, deck?.id]);

  useEffect(() => {
    if (readOnly || !deck?.id || !slides.length) { setQuote({ status: 'idle', data: null }); return undefined; }
    let live = true;
    setQuote((q) => ({ status: 'loading', data: q.data }));
    deckScriptApi.scriptQuote(deck.id, { length_s: length, audience, tone })
      .then((data) => { if (live) setQuote({ status: 'ok', data }); })
      .catch((e) => { if (live) setQuote({ status: 'error', data: null, message: failureOf(e, 'The script could not be priced. Try again.') }); });
    return () => { live = false; };
  }, [readOnly, deck?.id, slides.length, length, audience, tone]);

  // The last answer stays on screen while a new choice is priced.
  const q = quote.data;
  const wpm = q?.pace?.wpm || DEFAULT_WPM;
  const budgets = budgetsS(length, slides.length);
  const rows = slides.map((s, i) => {
    const uid = typeof s?.uid === 'string' ? s.uid : null;
    const saved = typeof s?.notes === 'string' ? s.notes : '';
    const draft = uid ? drafts[uid] : null;
    const text = draft ? draft.text : saved;
    const words = wordsOf(text);
    const spent = spokenS(words, wpm);
    return {
      i, uid, slide: s, title: String(s?.title || '').trim() || 'Untitled card', saved, draft, text, words, spent, budget: budgets[i],
      failed: uid ? failed[uid] : null, stale: !draft && isStale(s, uid ? from[uid] : null),
    };
  });
  const unsaved = rows.filter((r) => r.draft).length;
  const scripted = rows.filter((r) => r.words > 0).length;
  const totalS = rows.reduce((n, r) => n + r.spent, 0);
  const canRun = !readOnly && q?.ai === true && !running && !saving;

  const place = (res, only) => {
    const byUid = Object.fromEntries(slides.map((s) => [s?.uid, s]));
    setDrafts((d) => {
      const next = { ...d };
      for (const c of res.cards || []) if (c.card_uid) next[c.card_uid] = { text: c.notes, model: c.model || null, fp: fingerprint(byUid[c.card_uid]) };
      return next;
    });
    setFailed((f) => {
      const next = only ? { ...f } : {};
      for (const c of res.cards || []) if (c.card_uid) delete next[c.card_uid];
      for (const x of res.failed || []) if (x.card_uid && x.reason !== 'no_words') next[x.card_uid] = x.reason;
      return next;
    });
  };

  const generate = async (uid = null) => {
    if (!canRun) return;
    setRunning(uid || 'all');
    setNote(null);
    try {
      const res = await deckScriptApi.script(deck.id, { length_s: length, audience, tone, ...(uid ? { cards: [uid] } : {}) }, { 'Idempotency-Key': newKey() });
      place(res, uid);
      const placed = (res.cards || []).length;
      const lost = (res.failed || []).filter((x) => x.reason !== 'no_words').length;
      setNote(res.stopped ? res.stopped.message
        : `${placed} card${placed === 1 ? '' : 's'} drafted${lost ? `, ${lost} failed` : ''}. Nothing is saved until you press Save script.`);
    } catch (e) {
      if (uid) setFailed((f) => ({ ...f, [uid]: 'model_failed' }));
      setNote(failureOf(e, 'The script could not be generated. Nothing was charged.'));
    } finally {
      setRunning(null);
    }
  };

  const save = async () => {
    const list = rows.filter((r) => r.draft && r.uid);
    if (!list.length || saving || readOnly) return;
    setSaving(true);
    setNote(null);
    try {
      await deckScriptApi.saveScript(deck.id, list.map((r) => ({ card_uid: r.uid, notes: r.draft.text })), deck.version);
      const next = { ...from };
      for (const r of list) { if (r.draft.fp && r.draft.model) next[r.uid] = r.draft.fp; else delete next[r.uid]; }
      if (projectId != null) writeFrom(projectId, next);
      setFrom(next);
      setNote(`Script saved on ${list.length} card${list.length === 1 ? '' : 's'}, as one new version.`);
      reads.reload();
    } catch (e) {
      setNote(e?.status === 409 ? CONFLICT : failureOf(e, 'The script could not be saved. Your edits are still here; try again.'));
    } finally {
      setSaving(false);
    }
  };

  const edit = (r, value) => {
    setDrafts((d) => {
      const next = { ...d };
      if (value === r.saved) delete next[r.uid];
      else next[r.uid] = { text: value, model: d[r.uid]?.model ?? null, fp: d[r.uid]?.fp ?? null };
      return next;
    });
  };

  const text = () => scriptText(deck?.title, rows.map((r) => ({ title: r.title, text: r.text })));
  const copy = async () => {
    try { await navigator.clipboard.writeText(text()); setNote('The script is copied.'); }
    catch { setNote('The script could not be copied. Use Download instead.'); }
  };
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = fileName(deck?.title);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { setNote('The script could not be downloaded. Use Copy instead.'); }
  };
  const pick = (i) => {
    setSelected(i);
    sections.current[i]?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };

  if (reads.versions.status === 'ok' && !deck && reads.deck.status !== 'loading') {
    return (
      <div className={`${CARD} flex flex-col items-start gap-3 p-6`} data-testid="pitch-script-no-deck">
        <span className={`text-[15px] font-extrabold ${INK}`}>{NO_DECK}</span>
        <Link to={NEW_PATH} className={GHOST}>Build your deck</Link>
      </div>
    );
  }
  if (reads.deck.status === 'error' || reads.versions.status === 'error') {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} data-testid="pitch-script-error">
        <span className={`text-[13.5px] font-bold ${INK}`}>The deck could not be read.</span>
        <button type="button" className={GHOST} onClick={reads.reload}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </div>
    );
  }
  if (!deck) return <div className={`${SKEL} h-40 w-full`} aria-hidden="true" data-testid="pitch-script-loading" />;

  const hold = holdLine(q);
  const matchTo = rehearsalLength(q?.pace);
  const pace = paceLine(q?.pace);
  const version = deck.version != null ? `v${deck.version}` : null;
  const current = rows[Math.min(selected, Math.max(0, rows.length - 1))];

  return (
    <div className="flex flex-col gap-3" data-testid="pitch-script">
      <div role="tablist" aria-label="Script and rehearsal" className="inline-flex gap-0.5 self-start rounded-[10px] border border-axal-hairline bg-axal-ground p-[3px] dark:border-gray-700 dark:bg-gray-800">
        <span role="tab" aria-selected="true" className={`rounded-[7px] bg-white px-3 py-1.5 text-[12.5px] font-bold shadow-sm dark:bg-gray-900 ${INK}`}>Script</span>
      </div>
      <div className="flex items-start gap-4">
        <nav aria-label="Cards" className="hidden w-[250px] flex-none flex-col gap-1.5 lg:flex" data-testid="pitch-script-cards">
          {rows.map((r) => {
            const over = r.spent > r.budget;
            const on = r.i === selected;
            return (
              <button key={r.uid || r.i} type="button" onClick={() => pick(r.i)} aria-current={on ? 'true' : undefined}
                className={`flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left ${on ? 'bg-violet-50 outline outline-2 -outline-offset-1 outline-axal-violet dark:bg-violet-950/40 dark:outline-violet-400' : 'border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}
                data-testid={`pitch-script-card-${r.i}`}>
                <span aria-hidden="true" className={`flex h-[30px] w-[54px] flex-none items-end justify-end rounded-[4px] border border-axal-hairline bg-white px-1 dark:border-gray-700 dark:bg-gray-950 ${MONO} text-[8px] text-axal-muted dark:text-gray-400`}>{r.i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className={`truncate text-[12.5px] font-bold ${INK}`}>{r.title}</span>
                  {r.words ? (
                    <span className={`${MONO} text-[11px] ${over ? OVER : 'text-axal-muted dark:text-gray-400'}`} data-testid={`pitch-script-card-time-${r.i}`}>
                      {timeLine(r.spent, r.budget)}{over ? <span className="sr-only"> (over budget)</span> : null}
                    </span>
                  ) : <span className="text-[11px] text-axal-muted dark:text-gray-400">No script yet</span>}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <section aria-label="Script tools" className={`${CARD} flex flex-col gap-2.5 px-3.5 py-3`} data-testid="pitch-script-toolbar">
            <div className="flex flex-wrap items-center gap-2">
              {readOnly ? null : (
                <button type="button" className={VIOLET} disabled={!canRun} onClick={() => generate()} data-testid="pitch-script-generate">
                  {running === 'all' ? 'Generating…' : 'Generate script'}
                </button>
              )}
              {!readOnly && hold ? <span className={`${MONO} text-axal-muted dark:text-gray-400`} data-testid="pitch-script-hold">{hold}</span> : null}
              {!readOnly && q?.ai === false ? <span className={MUTED} role="status" data-testid="pitch-script-off">{q.message || 'AI assistance is off on this page.'}</span> : null}
              {!readOnly && quote.status === 'error' ? <span className={MUTED} role="status" data-testid="pitch-script-quote-error">{quote.message}</span> : null}
              <span className="flex-1" />
              {readOnly ? null : (
                <button type="button" className={QUIET} disabled={matchTo == null || running != null} onClick={() => matchTo != null && setLength(matchTo)}
                  title={matchTo == null ? 'Rehearse once to match it.' : undefined} data-testid="pitch-script-match">
                  Match my last rehearsal
                </button>
              )}
              <button type="button" className={QUIET} onClick={copy} data-testid="pitch-script-copy">Copy</button>
              <button type="button" className={QUIET} onClick={download} title={DOWNLOAD_NOTE} data-testid="pitch-script-download">Download .txt</button>
              {projectId != null ? <Link to={presentHref(projectId, deck.id)} className={GHOST} data-testid="pitch-script-teleprompter">Open teleprompter</Link> : null}
            </div>
            {readOnly ? null : (
              <div className="flex flex-wrap gap-4">
                <Group label="Length" options={LENGTHS} value={length} onPick={setLength} testId="pitch-script-length" disabled={running != null} />
                <Group label="Audience" options={AUDIENCES} value={audience} onPick={setAudience} testId="pitch-script-audience" disabled={running != null} />
                <Group label="Tone" options={TONES} value={tone} onPick={setTone} testId="pitch-script-tone" disabled={running != null} />
              </div>
            )}
            <span className={MUTED} data-testid="pitch-script-rule">{RULE}{pace ? ` ${pace}` : ''}</span>
          </section>

          <section aria-label="Script" className={`${CARD} flex flex-col px-3.5 pt-3`} data-testid="pitch-script-document">
            <div className="flex flex-wrap items-center gap-2.5 pb-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Script · {deck.title || 'Pitch deck'}{version ? ` ${version}` : ''}</h2>
                <span className={`${MONO} text-axal-muted dark:text-gray-400`} data-testid="pitch-script-estimate">
                  {headerLine({ spentS: totalS, lengthS: length, scripted, cards: rows.length })}
                </span>
              </div>
              {unsavedLine(unsaved) ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-violet-800 dark:text-violet-300" data-testid="pitch-script-unsaved">
                  <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-axal-violet dark:bg-violet-400" />{unsavedLine(unsaved)}
                </span>
              ) : null}
              {readOnly ? null : (
                <button type="button" className={VIOLET} disabled={!unsaved || saving || running != null} onClick={save} data-testid="pitch-script-save">
                  {saving ? 'Saving…' : 'Save script'}
                </button>
              )}
            </div>
            {note ? <p role="status" className={`m-0 pb-3 ${MUTED}`} data-testid="pitch-script-note">{note}</p> : null}
            <label className="flex flex-col gap-1 pb-3 lg:hidden">
              <span className="sr-only">Card</span>
              <select value={current ? current.i : 0} onChange={(e) => setSelected(Number(e.target.value))}
                className={`min-h-[44px] rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 ${INK}`} data-testid="pitch-script-picker">
                {rows.map((r) => <option key={r.uid || r.i} value={r.i}>{cardLabel(r.slide, r.i)}{r.words ? ` — ${timeLine(r.spent, r.budget)}` : ''}</option>)}
              </select>
            </label>
            {rows.map((r) => (
              <ScriptSection key={r.uid || r.i} r={r} readOnly={readOnly} shown={r.i === (current?.i ?? 0)}
                busy={running != null || saving} canRun={canRun} running={running}
                onEdit={(v) => edit(r, v)} onRegenerate={() => generate(r.uid)}
                sectionRef={(el) => { sections.current[r.i] = el; }} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function ScriptSection({ r, readOnly, shown, busy, canRun, running, onEdit, onRegenerate, sectionRef }) {
  const over = overLine(r.spent, r.budget);
  const regenerate = !readOnly && r.uid ? (
    <button type="button" className={SMALL_GHOST} disabled={!canRun} onClick={onRegenerate} data-testid={`pitch-script-regenerate-${r.i}`}>
      {running === r.uid ? 'Generating…' : 'Regenerate this card'}
    </button>
  ) : null;
  return (
    <section ref={sectionRef} aria-label={`Card ${r.i + 1}, ${r.title}`}
      className={`${shown ? 'flex' : 'hidden lg:flex'} flex-col gap-2 border-t border-axal-hairline py-3.5 dark:border-gray-700`} data-testid={`pitch-script-section-${r.i}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${MONO} text-axal-muted dark:text-gray-400`}>{r.i + 1}</span>
        <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>{r.title}</h3>
        {r.draft ? <span className={PILL_LAV} data-testid={`pitch-script-not-saved-${r.i}`}>Not saved</span> : null}
        {r.stale ? <span className={PILL_GREY} data-testid={`pitch-script-stale-pill-${r.i}`}>Out of date</span> : null}
        <span className="flex-1" />
        {r.words ? <span className={`${MONO} ${over ? OVER : 'text-axal-muted dark:text-gray-400'}`} data-testid={`pitch-script-line-${r.i}`}>{sectionLine(r.words, r.spent, r.budget)}</span> : null}
        {r.failed || r.stale ? null : regenerate}
      </div>
      {r.draft?.model ? <span className={MUTED} data-testid={`pitch-script-generated-${r.i}`}>{generatedLine(r.draft.model)}</span> : null}
      {r.failed ? (
        <div role="status" className="flex flex-wrap items-center gap-2.5 rounded-[9px] border border-axal-hairline bg-axal-ground px-3 py-2.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-800" data-testid={`pitch-script-failed-${r.i}`}>
          <span className={`flex-1 ${INK}`}>{FAILED} <span className="text-axal-muted dark:text-gray-400">{failReason(r.failed)}</span></span>
          {!readOnly ? <button type="button" className={SMALL_LINE} disabled={!canRun} onClick={onRegenerate} data-testid={`pitch-script-retry-${r.i}`}>Try again</button> : null}
        </div>
      ) : null}
      {!r.uid ? <span className={MUTED} data-testid={`pitch-script-no-uid-${r.i}`}>{NO_UID}</span> : (
        <>
          {!r.text && !readOnly ? <span className={MUTED} data-testid={`pitch-script-empty-${r.i}`}>{EMPTY}</span> : null}
          <textarea
            aria-label={`Script for ${r.title}`}
            value={r.text}
            readOnly={readOnly || busy}
            maxLength={NOTES_MAX}
            rows={Math.max(3, Math.ceil(r.text.length / 90))}
            placeholder={readOnly ? 'No script yet.' : 'Write what you say on this card.'}
            onChange={(e) => onEdit(e.target.value)}
            className={`w-full resize-y rounded-[9px] border px-3 py-2.5 text-[14px] leading-[1.65] ${r.draft ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40' : r.text ? 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900' : 'border-dashed border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'} ${INK}`}
            data-testid={`pitch-script-text-${r.i}`}
          />
        </>
      )}
      {r.stale ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400" data-testid={`pitch-script-stale-${r.i}`}>
          <span>{STALE}</span>
          {!readOnly ? <button type="button" className={SMALL_LINE} disabled={!canRun} onClick={onRegenerate}>Regenerate this card</button> : null}
        </div>
      ) : over ? <span className={`text-[12px] ${OVER}`} data-testid={`pitch-script-over-${r.i}`}>{over}</span> : null}
    </section>
  );
}
