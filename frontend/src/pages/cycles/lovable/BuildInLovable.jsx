import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { lovableApi } from '../../../lib/api/lovable';
import { lovableAppLinksApi } from '../../../lib/api/lovableAppLinks';
import { useEscapeClose } from '../../../components/useEscapeClose';
import {
  ALIAS_EDITED, ALIAS_NOTE, ANNOUNCE_OK, BRING_BACK, CHECKS, CHECK_HINT, CHECK_OK, DRAFTED_FROM, DRAFTED_LINE, ENTRY_LABEL, MAX, MEMBER_CHECK, NOT_COVERED,
  OPENED_LINE, OPENS_LINE, PREPARE_SUB, REVIEW, STEPS, SUPPORT_NOTE, VENTURE_NOTE,
  changedLines, checkTime, countText, dialogHead, exactCount, lineDiff, linesLabel, namesVenture, openedDay, showsEntry, testsRows,
} from './lovableModel';

/**
 * D1082 (#2947, part 2 of #2398) — Build in Lovable, from the owner's "From
 * Lovable" canvas (D1311): LV1's button on a Planned experiment, LV7's beside
 * Add must-have on Prototype / MVP, LV2 and LV3's dialog, LV4's row, and
 * LV8a's full-height sheet on the phone. D8773 (#8773) makes it two steps.
 *
 * PREPARE. Nothing leaves Axal VC. The Worker drafts the prompt from the
 * record; the founder edits it. Every edit is checked again by the Worker
 * (`check`), which refuses an email, a phone number, a tax, bank or card
 * number, a recorded legal name or one of this venture's interviewees'
 * names, and names only the kind and the line, never the words. The result
 * says which five checks ran and what they do not cover; it never says the
 * prompt holds no names. A member's name (a venture named after its founder)
 * is advice, not a refusal: Review waits for Keep or a neutral alias (owner
 * Q1, option A). The alias is drafted by the Worker, never string-replaced
 * here, and not saved (Q2, A). Edited · n lines, Compare with the draft and
 * Restore the draft keep the draft recoverable.
 *
 * REVIEW AND OPEN. The exact text, read only, with where it goes, how it
 * travels and what Axal VC records; Copy prompt beside Open in Lovable ↗,
 * under the same disclosure. Copy calls nothing. Open asks the Worker to
 * record the handoff (`launch`), which checks once more, and opens the link
 * it sends in a new tab opened on the press, so a browser does not block it;
 * a refusal closes it again. Nothing is sent to Lovable by Axal VC: the
 * prompt rides in the link's fragment, and Lovable waits for the founder to
 * press send there.
 *
 * One polite live region announces each result; refusals and an unavailable
 * check are `role="alert"`. A support session sees the prompt and its check,
 * and is told up front that the launch refuses it.
 */

const CHECK_MS = 400;

const SECONDARY = 'whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'whitespace-nowrap rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50';
const TEXT_BTN = 'min-h-[32px] whitespace-nowrap rounded-[7px] px-2 text-[12px] font-bold text-axal-violet underline hover:bg-axal-ground dark:text-violet-300 dark:hover:bg-gray-800';
const SUB = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const EYE = 'text-[11px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const TAG = 'inline-flex items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100';

/** The clipboard, so the test can stand in for it. */
const CLIPBOARD = { write: (text) => (typeof navigator !== 'undefined' && navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'))) };

/** Opens the new tab on the press, so a browser keeps it; the test stands in for it. */
function blankTab() {
  try { return typeof window !== 'undefined' && window.open ? window.open('', '_blank') : null; } catch { return null; }
}

/** What the live region says once a check settles on the text on screen. */
function settledWords(view, prefix = '') {
  if (!view) return '';
  if (view.ok === false) return '';
  const said = view.advisories?.length ? `${view.advisory_line || 'This prompt contains a member’s name.'} Choose Keep or Use an alias.` : ANNOUNCE_OK;
  return prefix ? `${prefix} ${said}` : said;
}

/** The five checks, then the member advisory, each named in the words of what the code matches. */
function CheckList({ found }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="lovable-check-list">
      {CHECKS.map((c) => (
        <li key={c.key} className="flex flex-col text-[12.5px]" data-testid={`lovable-check-${c.key}`}>
          <span className="font-semibold text-axal-ink dark:text-gray-100">{c.name}{found?.has(c.key) ? ' · Found' : ' · None found'}</span>
          <span className="text-axal-muted dark:text-gray-400">{c.what}</span>
        </li>
      ))}
      <li className="flex flex-col text-[12.5px]" data-testid="lovable-check-members">
        <span className="font-semibold text-axal-ink dark:text-gray-100">{MEMBER_CHECK.name}{found?.has('members') ? ' · Found' : ' · None found'}</span>
        <span className="text-axal-muted dark:text-gray-400">{MEMBER_CHECK.what}</span>
      </li>
    </ul>
  );
}

/** Which of the listed checks a view found something in. */
function foundKeys(view) {
  const keys = new Set();
  for (const f of view?.findings || []) {
    if (f.kind === 'email') keys.add('email');
    else if (f.kind === 'phone') keys.add('phone');
    else if (['tax_id', 'bank_iban', 'card_like'].includes(f.kind)) keys.add('numbers');
    else if (['private_in_public', 'consent_missing'].includes(f.kind)) keys.add('legal_names');
    else if (f.kind === 'interviewee_name') keys.add('interviewees');
  }
  if (view?.advisories?.length) keys.add('members');
  return keys;
}

export function BuildInLovableDialog({ cycle, projectId, record, onClose, onOpened, api = lovableApi, openTab = blankTab, linkApi = lovableAppLinksApi, clipboard = CLIPBOARD }) {
  const calls = api[cycle];
  const [draft, setDraft] = useState({ status: 'loading', data: null, error: null });
  const [text, setText] = useState('');
  const [check, setCheck] = useState({ status: 'idle', for: null, view: null });
  const [again, setAgain] = useState(0);
  const [step, setStep] = useState('prepare');
  const [alias, setAlias] = useState({ open: false, value: '', status: 'idle', error: null, applied: null });
  const [naming, setNaming] = useState(null);
  const [compare, setCompare] = useState(false);
  const [live, setLive] = useState('');
  const [launch, setLaunch] = useState({ status: 'idle', error: null, url: null });
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState('idle');
  const [link, setLink] = useState({ url: '', status: 'idle', error: null });
  const prefix = useRef('');
  const reviewHead = useRef(null);
  const promptBox = useRef(null);
  useEscapeClose(onClose);

  useEffect(() => {
    let alive = true;
    setDraft({ status: 'loading', data: null, error: null });
    setLive('Drafting the prompt.');
    calls.draft({ project_id: projectId, record }).then((data) => {
      if (!alive) return;
      const prompt = String(data?.prompt ?? '');
      setDraft({ status: 'ready', data, error: null });
      setText(prompt);
      setCheck({ status: 'ready', for: prompt, view: data?.check ?? null });
      setLive(settledWords(data?.check));
    }, (error) => { if (alive) { setDraft({ status: 'error', data: null, error }); setLive(''); } });
    return () => { alive = false; };
  }, [calls, projectId, record?.kind, record?.id, round]);

  // Each edit is checked by the Worker, after a pause; Review waits for the text on screen.
  useEffect(() => {
    if (draft.status !== 'ready' || check.for === text) return undefined;
    if (!text.trim() || text.length > MAX) { setCheck({ status: 'idle', for: null, view: null }); return undefined; }
    let alive = true;
    setCheck((c) => ({ ...c, status: 'checking' }));
    const timer = setTimeout(() => {
      calls.check({ project_id: projectId, prompt: text }).then(
        (res) => {
          if (!alive) return;
          setCheck({ status: 'ready', for: text, view: res?.check ?? null });
          setLive(settledWords(res?.check, prefix.current));
          prefix.current = '';
        },
        () => { if (alive) { setCheck({ status: 'error', for: null, view: null }); prefix.current = ''; } },
      );
    }, CHECK_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [text, draft.status, calls, projectId, check.for, again]);

  useEffect(() => { if (step === 'review') reviewHead.current?.focus?.(); }, [step]);

  const base = String(draft.data?.prompt ?? '');
  const reference = alias.applied ? alias.applied.prompt : base;
  const label = alias.applied ? alias.applied.label : draft.data?.venture_label;
  const ventureLines = alias.applied ? alias.applied.lines : draft.data?.venture_lines;
  const edited = changedLines(reference, text);
  const differs = text !== base;
  const settled = check.status === 'ready' && check.for === text;
  const passed = settled && check.view?.ok === true;
  const advisory = settled && (check.view?.advisories?.length || 0) > 0;
  const needsChoice = passed && advisory && naming !== 'keep';
  const support = draft.data?.support_session === true;
  const over = text.length > MAX;
  const canReview = passed && !needsChoice && !over && !!text.trim() && !support;
  const canOpen = canReview && launch.status !== 'opening';
  const whyNot = support ? null
    : over ? 'Shorten the prompt to continue.'
      : !text.trim() ? 'Write the prompt to continue.'
        : check.status === 'error' ? 'The check could not run just now. Review, Copy and Open are off.'
          : !settled ? 'Review stays off until the check finishes on the text on screen.'
            : check.view?.ok === false ? 'Remove what the check found to continue. Nothing has left Axal VC.'
              : needsChoice ? 'Choose how the prompt names your venture to continue.' : null;

  const edit = (value) => { setText(value); setLaunch((l) => ({ ...l, error: null })); setCopied('idle'); };
  const restore = () => {
    prefix.current = 'Draft restored.';
    setAlias((a) => ({ ...a, applied: null, status: 'idle', error: null }));
    setNaming(null);
    setCompare(false);
    setText(base);
    setCheck({ status: 'idle', for: null, view: null });
    setLive('Draft restored. Checking again.');
  };
  const applyAlias = async () => {
    const value = alias.value.replace(/\s+/g, ' ').trim();
    if (!value || alias.status === 'applying' || text !== reference) return;
    setAlias((a) => ({ ...a, status: 'applying', error: null }));
    try {
      const data = await calls.draft({ project_id: projectId, record, alias: value });
      const prompt = String(data?.prompt ?? '');
      setAlias((a) => ({ ...a, status: 'idle', error: null, applied: { prompt, label: data?.venture_label ?? value, lines: data?.venture_lines ?? [] } }));
      setNaming('alias');
      setText(prompt);
      setCheck({ status: 'ready', for: prompt, view: data?.check ?? null });
      const res = data?.check;
      setLive(res?.ok === false ? '' : `Alias applied: ${data?.venture_label ?? value}. Checked again: ${res?.advisories?.length ? res.advisory_line : 'no matches.'}`);
    } catch (error) {
      setAlias((a) => ({ ...a, status: 'idle', error: error?.message || 'The alias could not be applied just now. The prompt is unchanged.' }));
    }
  };

  const open = async () => {
    if (!canOpen) return;
    const tab = openTab();
    setLaunch({ status: 'opening', error: null, url: null });
    try {
      const res = await calls.launch({ project_id: projectId, record, prompt: text });
      if (tab && !tab.closed) { try { tab.opener = null; } catch { /* a cross-origin tab */ } tab.location.href = res.url; }
      setLaunch({ status: 'opened', error: null, url: tab ? null : res.url });
      setLive(OPENED_LINE);
      onOpened?.(res?.handoff?.opened_at ?? null);
    } catch (error) {
      try { tab?.close?.(); } catch { /* already gone */ }
      if (error?.data?.check) setCheck({ status: 'ready', for: text, view: error.data.check });
      setLaunch({ status: 'idle', error: error?.message || 'Lovable could not be opened. Nothing was opened. Try again.', url: null });
    }
  };

  const copy = async () => {
    if (!canOpen) return;
    try {
      await clipboard.write(text);
      setCopied('copied');
      setLive(`Copied ${text.length.toLocaleString('en-US')} characters. Nothing was recorded.`);
    } catch { setCopied('failed'); }
  };
  // Bring it back: D1083's app link, on the record this dialog opened for.
  const saveLink = async () => {
    if (!link.url.trim() || link.status === 'saving') return;
    setLink((l) => ({ ...l, status: 'saving', error: null }));
    try {
      await linkApi.link(cycle, projectId, Number(record?.id), link.url.trim());
      setLink((l) => ({ ...l, status: 'saved', error: null }));
    } catch (error) {
      setLink((l) => ({ ...l, status: 'idle', error: error?.message || 'The link could not be saved. Nothing was changed.' }));
    }
  };
  const back = () => { setStep('prepare'); setLaunch((l) => ({ ...l, error: null })); setTimeout(() => promptBox.current?.focus?.(), 0); };

  const head = dialogHead(cycle, draft.data?.tests);
  const tests = testsRows(draft.data?.tests);
  const at = checkTime(check.view?.checked_at);
  const stepNo = step === 'review' ? 2 : 1;
  const where = linesLabel(ventureLines);

  const bringBack = (
    <section className="flex flex-col gap-1.5" data-testid="lovable-bring-back">
      <span className={EYE}>{BRING_BACK.title}</span>
      <p className={SUB}>{BRING_BACK.line[cycle] || BRING_BACK.line.validate}</p>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{BRING_BACK.label}
        <span className="flex gap-2">
          <input type="url" inputMode="url" value={link.url} onChange={(e) => setLink({ url: e.target.value, status: 'idle', error: null })} placeholder="https://"
            className="min-h-[44px] min-w-0 flex-1 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] font-normal text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" data-testid="lovable-link-url" />
          <button type="button" className={SECONDARY} disabled={!link.url.trim() || link.status === 'saving'} onClick={saveLink} data-testid="lovable-link-save">{link.status === 'saving' ? 'Linking…' : 'Link'}</button>
        </span>
      </label>
      {link.status === 'saved' && <p className="m-0 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="lovable-link-saved">Linked. It shows as From Lovable.</p>}
      {link.error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="lovable-link-error">{link.error}</p>}
      <p className={SUB}>{BRING_BACK.note}</p>
    </section>
  );

  // The choice stays on screen while any member's name is in the checked text, an aliased draft included.
  const ventureBlock = draft.status !== 'ready' || support ? null : advisory ? (
    <fieldset className="m-0 flex flex-col gap-2 rounded-[10px] border border-amber-300 px-3.5 py-3 dark:border-amber-800" data-testid="lovable-naming">
      <legend className="px-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">How should the prompt name your venture? <span className="text-[11px] font-bold uppercase text-amber-800 dark:text-amber-300">Required</span></legend>
      <label className="flex items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100">
        <input type="radio" name="lovable-naming" checked={naming === 'keep'} onChange={() => { setNaming('keep'); setLive('Kept as it is. Lovable will see the name.'); }} data-testid="lovable-naming-keep" />
        <span className="flex flex-col"><b>{label && namesVenture(text, label) ? `Keep “${label}”` : 'Keep the text as it is'}</b><span className={SUB}>Lovable will see this name.</span></span>
      </label>
      <label className="flex items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100">
        <input type="radio" name="lovable-naming" checked={naming === 'alias'} onChange={() => { setNaming('alias'); setAlias((a) => ({ ...a, open: true })); }} data-testid="lovable-naming-alias" />
        <span className="flex flex-col"><b>Use a neutral alias</b><span className={SUB}>{ALIAS_NOTE}</span></span>
      </label>
    </fieldset>
  ) : where && label ? (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-[10px] border border-axal-hairline px-3.5 py-2.5 dark:border-gray-700" data-testid="lovable-venture-note">
      <span className="flex min-w-0 flex-col text-[13px]">
        <b className="text-axal-ink dark:text-gray-100">{alias.applied ? `${where} names your venture by an alias: ${label}.` : `${where} names your venture: ${label}.`}</b>
        <span className={SUB}>{alias.applied ? `Your venture is still ${draft.data?.venture_name ?? 'named as it is'}.` : VENTURE_NOTE}</span>
      </span>
      {!alias.applied && !alias.open && <button type="button" className={SECONDARY} onClick={() => setAlias((a) => ({ ...a, open: true }))} data-testid="lovable-alias-open">Use an alias</button>}
    </div>
  ) : null;

  const aliasField = draft.status === 'ready' && !support && !alias.applied && (alias.open || naming === 'alias') ? (
    <div className="flex flex-col gap-1" data-testid="lovable-alias">
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">Alias for this prompt
        <span className="flex gap-2">
          <input type="text" value={alias.value} maxLength={60} placeholder="For example, Project Kestrel" onChange={(e) => setAlias((a) => ({ ...a, value: e.target.value, error: null }))}
            className="min-h-[44px] min-w-0 flex-1 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] font-normal text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" data-testid="lovable-alias-input" />
          <button type="button" className={SECONDARY} disabled={!alias.value.trim() || alias.status === 'applying' || text !== reference} onClick={applyAlias} data-testid="lovable-alias-apply">{alias.status === 'applying' ? 'Applying…' : 'Apply alias'}</button>
        </span>
      </label>
      {text !== reference ? <p className={SUB} data-testid="lovable-alias-edited">{ALIAS_EDITED}</p> : <p className={SUB}>{ALIAS_NOTE}</p>}
      {alias.error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="lovable-alias-error">{alias.error}</p>}
    </div>
  ) : null;

  const diff = compare ? lineDiff(base, text).filter((o) => o.op !== 'same') : [];
  const checkState = check.status === 'checking' ? 'checking' : check.status === 'error' ? 'error' : passed ? (advisory ? 'choice' : 'ok') : settled && check.view?.ok === false ? 'refused' : 'idle';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4" data-testid="lovable-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="lovable-title"
        className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-white px-5 py-5 dark:bg-gray-900 sm:h-auto sm:max-h-[88vh] sm:max-w-[680px] sm:rounded-[16px]"
        data-testid="lovable-dialog" data-step={step}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400" data-testid="lovable-eyebrow">{head.eyebrow}</span>
            <h2 id="lovable-title" className="m-0 text-[17px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{head.title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-[9px] text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"><X size={18} aria-hidden="true" /></button>
        </div>
        <ol className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label={`Step ${stepNo} of 2`} data-testid="lovable-steps">
          {STEPS.map((s, i) => (
            <li key={s.name} aria-current={i + 1 === stepNo ? 'step' : undefined} className={`flex flex-col text-[12px] ${i + 1 === stepNo ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
              <b>{i + 1}. {s.name}</b><span>{s.sub}</span>
            </li>
          ))}
        </ol>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="lovable-live">{live}</p>
        {draft.status === 'ready' && support && <p className="m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3.5 py-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" data-testid="lovable-support">{SUPPORT_NOTE}</p>}

        {step === 'prepare' && (
          <>
            <p className={SUB} data-testid="lovable-prepare-sub">{PREPARE_SUB}</p>
            <p className={SUB} data-testid="lovable-opens-line">{OPENS_LINE}</p>
            {draft.status === 'loading' && <div className="h-[220px] animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" data-testid="lovable-loading" />}
            {draft.status === 'error' && (
              <div role="alert" className="flex flex-col items-start gap-1 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid="lovable-unreadable">
                <span>{draft.error?.message || 'The prompt could not be drafted just now.'}</span>
                <button type="button" className="font-bold underline" onClick={() => setRound((n) => n + 1)} data-testid="lovable-retry">Try again</button>
              </div>
            )}
            {draft.status === 'ready' && (
              <>
                {tests.length > 0 && (
                  <section className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid="lovable-tests">
                    <span className={EYE}>What this tests</span>
                    {tests.map((r) => <span key={r.key} className={`text-[13px] ${r.strong ? 'font-semibold text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`lovable-tests-${r.key}`}>{r.text}</span>)}
                  </section>
                )}
                {ventureBlock}
                {aliasField}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className={EYE}>Prompt</span>
                    <span className={TAG} data-testid="lovable-prompt-tag">{edited ? `Edited · ${edited} ${edited === 1 ? 'line' : 'lines'}` : alias.applied ? 'Alias applied' : 'Drafted'}</span>
                  </span>
                  {differs ? (
                    <span className="flex gap-1">
                      <button type="button" className={TEXT_BTN} onClick={() => setCompare((v) => !v)} aria-expanded={compare} data-testid="lovable-compare">{compare ? 'Hide changes' : 'Compare with the draft'}</button>
                      <button type="button" className={TEXT_BTN} onClick={restore} data-testid="lovable-restore">Restore the draft</button>
                    </span>
                  ) : <span className={SUB}>Edit freely. The draft stays recoverable.</span>}
                </div>
                <span className={SUB} data-testid="lovable-drafted">{DRAFTED_LINE[cycle] || DRAFTED_LINE.validate}</span>
                {compare && (
                  <ul className="m-0 flex list-none flex-col gap-0.5 rounded-[10px] border border-axal-hairline p-2 font-mono text-[12px] dark:border-gray-700" data-testid="lovable-diff">
                    {diff.length ? diff.map((o, i) => (
                      <li key={`${o.op}-${o.n}-${i}`} className={o.op === 'add' ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 line-through dark:text-red-300'} data-testid={`lovable-diff-${o.op}`}>
                        {o.op === 'add' ? `Now, line ${o.n}: ` : `Draft, line ${o.n}: `}{o.text || '(empty line)'}
                      </li>
                    )) : <li className={SUB}>No changes.</li>}
                  </ul>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="sr-only">Prompt</span>
                  <textarea ref={promptBox} value={text} onChange={(e) => edit(e.target.value)} rows={12}
                    aria-describedby="lovable-count lovable-check-head" data-testid="lovable-prompt" readOnly={support}
                    className="w-full rounded-[10px] border border-axal-hairline bg-white p-3 font-mono text-[12.5px] leading-[1.5] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span id="lovable-count" className={`${MONO} text-[12px] ${over ? 'font-bold text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="lovable-count">{countText(text.length)}</span>
                  {over && <span className="text-[12px] text-red-700 dark:text-red-300" data-testid="lovable-over">Lovable takes {MAX.toLocaleString('en-US')} characters. Shorten the prompt to continue.</span>}
                </div>
                {draft.data?.cut && <p className={SUB} data-testid="lovable-cut">{draft.data.cut}</p>}
                <section className="flex flex-col gap-1.5 rounded-[10px] border px-3.5 py-2.5 text-[13px]" data-testid="lovable-check" data-state={checkState} aria-labelledby="lovable-check-head">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={EYE}>Privacy check</span>
                    <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="lovable-check-at">
                      {checkState === 'checking' ? `Changed since the last check${at ? ` · last checked ${at}` : ''}` : settled && at ? `This exact text · checked ${at}` : checkState === 'error' ? 'Not checked' : ''}
                    </span>
                  </span>
                  {checkState === 'checking' && <h3 id="lovable-check-head" className="m-0 text-[13px] font-semibold text-axal-muted dark:text-gray-400">Checking this text…</h3>}
                  {checkState === 'error' && (
                    <div role="alert" className="flex flex-col items-start gap-1" data-testid="lovable-check-unavailable">
                      <h3 id="lovable-check-head" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300">The check could not run just now.</h3>
                      <p className={SUB}>Review, Copy and Open stay off until this exact text is checked. Your edits are kept.</p>
                      <button type="button" className={SECONDARY} onClick={() => { setCheck({ status: 'idle', for: null, view: null }); setAgain((n) => n + 1); }} data-testid="lovable-check-again">Check again</button>
                    </div>
                  )}
                  {checkState === 'refused' && (
                    <div role="alert" className="flex flex-col gap-1">
                      <h3 id="lovable-check-head" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="lovable-check-line">{check.view?.line}</h3>
                      <p className={SUB}>{CHECK_HINT}</p>
                    </div>
                  )}
                  {checkState === 'choice' && (
                    <>
                      <h3 id="lovable-check-head" className="m-0 text-[13px] font-semibold text-amber-800 dark:text-amber-300" data-testid="lovable-check-line">{check.view?.advisory_line}</h3>
                      <p className={SUB}>The five checks below found nothing. Choose how the prompt names your venture before you review it.</p>
                    </>
                  )}
                  {checkState === 'ok' && <h3 id="lovable-check-head" className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="lovable-check-line">{CHECK_OK}</h3>}
                  {checkState === 'idle' && <span className="text-axal-muted dark:text-gray-400">Write the prompt to check it.</span>}
                  {['ok', 'choice', 'refused'].includes(checkState) && <CheckList found={foundKeys(check.view)} />}
                  {['ok', 'choice'].includes(checkState) && <p className={SUB} data-testid="lovable-not-covered">{NOT_COVERED}</p>}
                </section>
                <p className={SUB} data-testid="lovable-drafted-from">{DRAFTED_FROM[cycle] || DRAFTED_FROM.validate}</p>
                {bringBack}
              </>
            )}
          </>
        )}

        {step === 'review' && (
          <section className="flex flex-col gap-2" data-testid="lovable-review" aria-labelledby="lovable-review-head">
            <h3 id="lovable-review-head" ref={reviewHead} tabIndex={-1} className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Review what will be sent</h3>
            <dl className="m-0 grid grid-cols-1 gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-[150px_1fr]" data-testid="lovable-review-facts">
              <dt className="font-semibold text-axal-muted dark:text-gray-400">Destination</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="lovable-review-destination">{REVIEW.destination}</dd>
              <dt className="font-semibold text-axal-muted dark:text-gray-400">How it travels</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{REVIEW.travels}</dd>
              <dt className="font-semibold text-axal-muted dark:text-gray-400">Names your venture as</dt>
              <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="lovable-review-named">
                {label && namesVenture(text, label) ? `${label}${alias.applied ? ` (an alias; your venture is still ${draft.data?.venture_name ?? 'named as it is'})` : ''}` : 'Not in the text'}
              </dd>
              <dt className="font-semibold text-axal-muted dark:text-gray-400">Exactly this text</dt>
              <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="lovable-review-count">{exactCount(text)}{at ? ` · checked ${at}, unchanged since` : ''}</dd>
            </dl>
            <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[10px] border border-axal-hairline bg-axal-ground p-3 font-mono text-[12.5px] leading-[1.5] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              role="region" aria-label="The exact text that will be sent" tabIndex={0} data-testid="lovable-review-text">{text}</pre>
            <dl className="m-0 grid grid-cols-1 gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-[150px_1fr]">
              <dt className="font-semibold text-axal-muted dark:text-gray-400">Nothing else goes</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{REVIEW.nothingElse}</dd>
              <dt className="font-semibold text-axal-muted dark:text-gray-400">Axal VC records</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="lovable-review-records">{REVIEW.records}</dd>
              <dt className="font-semibold text-axal-muted dark:text-gray-400">Copy instead</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="lovable-review-copy">{REVIEW.copyInstead}</dd>
            </dl>
            {launch.error && <p role="alert" className="m-0 text-[13px] text-red-700 dark:text-red-300" data-testid="lovable-launch-error">{launch.error}</p>}
            {copied === 'copied' && <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="lovable-copied">Copied {text.length.toLocaleString('en-US')} characters. Nothing was recorded.</p>}
            {launch.status === 'opened' && (
              <>
                <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="lovable-opened">
                  {OPENED_LINE}
                  {launch.url && <> Your browser kept the new tab closed: <a href={launch.url} target="_blank" rel="noopener noreferrer" className="text-axal-violet underline dark:text-violet-300" data-testid="lovable-open-link">open Lovable ↗</a></>}
                </p>
                {bringBack}
              </>
            )}
          </section>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1 sm:mt-0">
          {step === 'prepare' && draft.status === 'ready' && !support && (
            <>
              {whyNot && <span className="mr-auto text-[12px] text-axal-muted dark:text-gray-400" data-testid="lovable-review-why">{whyNot}</span>}
              <button type="button" className={PRIMARY} disabled={!canReview} onClick={() => { if (canReview) { setCopied('idle'); setStep('review'); } }} data-testid="lovable-review-go">Review what will be sent →</button>
            </>
          )}
          {step === 'review' && launch.status === 'opened' && <button type="button" className={SECONDARY} onClick={onClose} data-testid="lovable-cancel">Close</button>}
          {step === 'review' && launch.status !== 'opened' && (
            <>
              <button type="button" className={`${TEXT_BTN} mr-auto`} onClick={back} data-testid="lovable-back">← Back to edit</button>
              <button type="button" className={SECONDARY} disabled={!canOpen} onClick={copy} data-testid="lovable-copy">
                {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy prompt'}
              </button>
              <button type="button" className={PRIMARY} disabled={!canOpen} onClick={open} data-testid="lovable-open">
                {launch.status === 'opening' ? 'Opening…' : 'Open in Lovable ↗'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * LV1, LV7 and LV4: the button for a writer, and "Opened in Lovable on
 * [date]" once it has been opened. `lovable` is the Worker's: `{ cycle,
 * project_id, record, can_launch, opened_at }`. D8773: the button says what
 * it does, Prepare a Lovable prompt (owner Q4, option A).
 */
export function BuildInLovable({ lovable, api, openTab, className = '' }) {
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(lovable?.opened_at ?? null);
  useEffect(() => { setOpenedAt(lovable?.opened_at ?? null); }, [lovable?.opened_at]);
  const onOpened = useCallback((at) => { if (at) setOpenedAt(at); }, []);
  if (!showsEntry({ ...lovable, opened_at: openedAt })) return null;
  const day = openedDay(openedAt);
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`} data-testid="lovable-entry">
      {day && <span className={`${MONO} text-[11.5px] text-axal-muted dark:text-gray-400`} data-testid="lovable-opened-on">Opened in Lovable on {day}</span>}
      {lovable.can_launch && <button type="button" className={SECONDARY} onClick={() => setOpen(true)} data-testid="lovable-build">{ENTRY_LABEL}</button>}
      {open && <BuildInLovableDialog cycle={lovable.cycle} projectId={lovable.project_id} record={lovable.record} api={api} openTab={openTab}
        onClose={() => setOpen(false)} onOpened={onOpened} />}
    </span>
  );
}
