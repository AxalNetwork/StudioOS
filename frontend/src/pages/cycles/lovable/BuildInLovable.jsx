import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { lovableApi } from '../../../lib/api/lovable';
import { lovableAppLinksApi } from '../../../lib/api/lovableAppLinks';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { BRING_BACK, DRAFTED_LINE, MAX, OPENS_LINE, PRIVACY_OK, PRIVACY_OK_SUB, countText, dialogHead, openedDay, showsEntry, testsRows } from './lovableModel';

/**
 * D1082 (#2947, part 2 of #2398) — Build in Lovable, from the owner's "From
 * Lovable" canvas (D1311): LV1's button on a Planned experiment, LV7's beside
 * Add must-have on Prototype / MVP, LV2 and LV3's dialog, LV4's row, and
 * LV8a's full-height sheet on the phone.
 *
 * THE DIALOG. The Worker drafts the prompt from the record; the founder edits
 * it. Every edit is checked again by the Worker (`check`), which refuses an
 * email, a phone number or one of this venture's interviewees' names, and
 * names only the kind, never the words. "Open in Lovable ↗" stays disabled
 * until the text on screen has passed. Pressing it asks the Worker to record
 * the handoff (`launch`), which checks once more, and opens the link it sends
 * in a new tab. The tab is opened on the press, before the request, so a
 * browser does not block it; a refusal closes it again.
 *
 * Nothing is sent to Lovable by StudioOS: the prompt rides in the link's
 * fragment, and Lovable waits for the founder to press send there.
 *
 * The owner's re-export (`design/incoming/Lovable Page.dc.html`) draws the
 * dialog: the eyebrow and title, What this tests, the prompt, the privacy
 * check, Bring it back (D1083's app link, optional) and Copy prompt beside
 * Open in Lovable. Copy waits for the same check as Open.
 */

const CHECK_MS = 400;

const SECONDARY = 'whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'whitespace-nowrap rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50';
const SUB = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';

/** The clipboard, so the test can stand in for it. */
const CLIPBOARD = { write: (text) => (typeof navigator !== 'undefined' && navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'))) };

/** Opens the new tab on the press, so a browser keeps it; the test stands in for it. */
function blankTab() {
  try { return typeof window !== 'undefined' && window.open ? window.open('', '_blank') : null; } catch { return null; }
}

export function BuildInLovableDialog({ cycle, projectId, record, onClose, onOpened, api = lovableApi, openTab = blankTab, linkApi = lovableAppLinksApi, clipboard = CLIPBOARD }) {
  const calls = api[cycle];
  const [draft, setDraft] = useState({ status: 'loading', data: null, error: null });
  const [text, setText] = useState('');
  const [check, setCheck] = useState({ status: 'idle', for: null, view: null });
  const [launch, setLaunch] = useState({ status: 'idle', error: null, url: null });
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState('idle');
  const [link, setLink] = useState({ url: '', status: 'idle', error: null });
  const box = useRef(null);
  useEscapeClose(onClose);

  useEffect(() => {
    let live = true;
    setDraft({ status: 'loading', data: null, error: null });
    calls.draft({ project_id: projectId, record }).then((data) => {
      if (!live) return;
      setDraft({ status: 'ready', data, error: null });
      setText(String(data?.prompt ?? ''));
      setCheck({ status: 'ready', for: String(data?.prompt ?? ''), view: data?.check ?? null });
    }, (error) => { if (live) setDraft({ status: 'error', data: null, error }); });
    return () => { live = false; };
  }, [calls, projectId, record?.kind, record?.id, round]);

  // Each edit is checked by the Worker, after a pause; the button waits for the text on screen.
  useEffect(() => {
    if (draft.status !== 'ready' || check.for === text) return undefined;
    if (!text.trim() || text.length > MAX) { setCheck({ status: 'idle', for: null, view: null }); return undefined; }
    let live = true;
    setCheck((c) => ({ ...c, status: 'checking' }));
    const timer = setTimeout(() => {
      calls.check({ project_id: projectId, prompt: text }).then(
        (res) => { if (live) setCheck({ status: 'ready', for: text, view: res?.check ?? null }); },
        () => { if (live) setCheck({ status: 'error', for: null, view: null }); },
      );
    }, CHECK_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [text, draft.status, calls, projectId, check.for]);

  const passed = check.status === 'ready' && check.for === text && check.view?.ok === true;
  const over = text.length > MAX;
  const canOpen = passed && !over && !!text.trim() && launch.status !== 'opening';

  const open = async () => {
    if (!canOpen) return;
    const tab = openTab();
    setLaunch({ status: 'opening', error: null, url: null });
    try {
      const res = await calls.launch({ project_id: projectId, record, prompt: text });
      if (tab && !tab.closed) { try { tab.opener = null; } catch { /* a cross-origin tab */ } tab.location.href = res.url; }
      setLaunch({ status: 'opened', error: null, url: tab ? null : res.url });
      onOpened?.(res?.handoff?.opened_at ?? null);
    } catch (error) {
      try { tab?.close?.(); } catch { /* already gone */ }
      if (error?.data?.check) setCheck({ status: 'ready', for: text, view: error.data.check });
      setLaunch({ status: 'idle', error: error?.message || 'Lovable could not be opened. Nothing was opened. Try again.', url: null });
    }
  };

  const copy = async () => {
    if (!canOpen) return;
    try { await clipboard.write(text); setCopied('copied'); } catch { setCopied('failed'); }
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

  const findingsLine = check.view?.line;
  const head = dialogHead(cycle, draft.data?.tests);
  const tests = testsRows(draft.data?.tests);
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4" data-testid="lovable-backdrop">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="lovable-title"
        className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-white px-5 py-5 dark:bg-gray-900 sm:h-auto sm:max-h-[88vh] sm:max-w-[620px] sm:rounded-[16px]"
        data-testid="lovable-dialog">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400" data-testid="lovable-eyebrow">{head.eyebrow}</span>
            <h2 id="lovable-title" className="m-0 text-[17px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{head.title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-[9px] text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"><X size={18} aria-hidden="true" /></button>
        </div>
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
                <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">What this tests</span>
                {tests.map((r) => <span key={r.key} className={`text-[13px] ${r.strong ? 'font-semibold text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`lovable-tests-${r.key}`}>{r.text}</span>)}
              </section>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Prompt</span>
              <span className={SUB} data-testid="lovable-drafted">{DRAFTED_LINE[cycle] || DRAFTED_LINE.validate}</span>
              <textarea value={text} onChange={(e) => { setText(e.target.value); setLaunch((l) => ({ ...l, error: null })); }} rows={12}
                aria-describedby="lovable-count" data-testid="lovable-prompt"
                className="w-full rounded-[10px] border border-axal-hairline bg-white p-3 font-mono text-[12.5px] leading-[1.5] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span id="lovable-count" className={`${MONO} text-[12px] ${over ? 'font-bold text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="lovable-count">{countText(text.length)}</span>
              {over && <span className="text-[12px] text-red-700 dark:text-red-300" data-testid="lovable-over">Lovable takes {MAX.toLocaleString('en-US')} characters. Shorten the prompt to continue.</span>}
            </div>
            {draft.data?.cut && <p className={SUB} data-testid="lovable-cut">{draft.data.cut}</p>}
            <div className="rounded-[10px] border px-3.5 py-2.5 text-[13px]" data-testid="lovable-check"
              data-state={check.status === 'checking' ? 'checking' : passed ? 'ok' : check.status === 'error' ? 'error' : check.view && check.view.ok === false ? 'refused' : 'idle'}>
              {check.status === 'checking' ? <span className="text-axal-muted dark:text-gray-400">Checking for personal data…</span>
                : check.status === 'error' ? <span className="text-red-700 dark:text-red-300">The prompt could not be checked just now. Edit it to check again.</span>
                  : passed ? <span className="flex flex-col"><span className="font-semibold text-emerald-700 dark:text-emerald-300" data-testid="lovable-check-ok"><span aria-hidden="true">✓ </span>{PRIVACY_OK}</span><span className="text-[12.5px] text-axal-muted dark:text-gray-400">{PRIVACY_OK_SUB}</span></span>
                    : check.view && check.view.ok === false ? <span className="font-semibold text-red-700 dark:text-red-300" role="alert">{findingsLine}</span>
                      : <span className="text-axal-muted dark:text-gray-400">Write the prompt to check it.</span>}
            </div>
            <section className="flex flex-col gap-1.5" data-testid="lovable-bring-back">
              <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{BRING_BACK.title}</span>
              <p className={SUB}>{BRING_BACK.line[cycle] || BRING_BACK.line.validate}</p>
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{BRING_BACK.label}
                <span className="flex gap-2">
                  <input type="url" inputMode="url" value={link.url} onChange={(e) => setLink({ url: e.target.value, status: 'idle', error: null })} placeholder="https://"
                    className="min-h-[44px] min-w-0 flex-1 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] font-normal text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" data-testid="lovable-link-url" />
                  <button type="button" className={SECONDARY} disabled={!link.url.trim() || link.status === 'saving'} onClick={saveLink} data-testid="lovable-link-save">{link.status === 'saving' ? 'Linking…' : 'Link'}</button>
                </span>
              </label>
              {link.status === 'saved' && <p className="m-0 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" role="status" data-testid="lovable-link-saved">Linked. It shows as From Lovable.</p>}
              {link.error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="lovable-link-error">{link.error}</p>}
              <p className={SUB}>{BRING_BACK.note}</p>
            </section>
            {launch.error && <p role="alert" className="m-0 text-[13px] text-red-700 dark:text-red-300" data-testid="lovable-launch-error">{launch.error}</p>}
            {launch.status === 'opened' && (
              <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="lovable-opened">
                Opened in Lovable. Press send there to start building.
                {launch.url && <> Your browser kept the new tab closed: <a href={launch.url} target="_blank" rel="noopener noreferrer" className="text-axal-violet underline dark:text-violet-300" data-testid="lovable-open-link">open Lovable ↗</a></>}
              </p>
            )}
          </>
        )}
        <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1 sm:mt-0">
          {launch.status === 'opened' && <button type="button" className={SECONDARY} onClick={onClose} data-testid="lovable-cancel">Close</button>}
          {launch.status !== 'opened' && draft.status === 'ready' && (
            <button type="button" className={SECONDARY} disabled={!canOpen} onClick={copy} data-testid="lovable-copy">
              {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy prompt'}
            </button>
          )}
          {launch.status !== 'opened' && (
            <button type="button" className={PRIMARY} disabled={!canOpen} onClick={open} data-testid="lovable-open">
              {launch.status === 'opening' ? 'Opening…' : 'Open in Lovable ↗'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * LV1, LV7 and LV4: the button for a writer, and "Opened in Lovable on
 * [date]" once it has been opened. `lovable` is the Worker's: `{ cycle,
 * project_id, record, can_launch, opened_at }`.
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
      {lovable.can_launch && <button type="button" className={SECONDARY} onClick={() => setOpen(true)} data-testid="lovable-build">Build in Lovable</button>}
      {open && <BuildInLovableDialog cycle={lovable.cycle} projectId={lovable.project_id} record={lovable.record} api={api} openTab={openTab}
        onClose={() => setOpen(false)} onOpened={onOpened} />}
    </span>
  );
}
