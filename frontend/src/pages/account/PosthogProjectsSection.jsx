import { useEffect, useRef, useState } from 'react';
import { Unreadable } from '../../ui';
import Lightbox from '../../ui/Lightbox';
import { posthogApi } from '../../lib/api/posthog';
import { BTN } from './AccountCenter';
import { CHOOSE_LINE, NO_VENTURES, UNLINK_LINE, projectsRead, refusalOf, regionWords, rowOf } from './posthogProjectsModel';

/**
 * D1385 (#3731, #2409 part 1) — "Your PostHog projects" on PostHog's page:
 * one row per venture in the companies this connection is switched on for,
 * with its PostHog project, the teammate whose PostHog serves it, or Choose
 * project. Choosing and unlinking each open an in-page dialog that says what
 * changes; a refusal stays in the dialog. A failed read says so with Try
 * again; a failed project list blanks only the choices.
 */
export default function PosthogProjectsSection({ p, onChanged, api = posthogApi }) {
  const uid = p?.connection?.uid || null;
  const [read, setRead] = useState({ status: 'loading', message: '', data: null });
  const [round, setRound] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    api.projects(uid).then(
      (out) => { if (live) setRead({ status: 'ready', message: '', data: projectsRead(out) }); },
      (e) => { if (live) setRead({ status: 'refused', message: refusalOf(e), data: null }); },
    );
    return () => { live = false; };
  }, [api, uid, round]);

  if (!uid) return null;
  const data = read.data;
  const open = (kind, v) => { setError(''); setPick(v?.link?.posthog_project_id || ''); setDialog({ kind, venture: v }); };
  const save = async (value) => {
    setBusy(true); setError('');
    try {
      await api.setProject(uid, dialog.venture.project_id, value);
      if (!alive.current) return;
      setDialog(null);
      setRound((n) => n + 1);
      onChanged?.();
    } catch (e) {
      if (alive.current) setError(refusalOf(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section aria-label="Your PostHog projects" data-testid="connector-page-posthog-projects" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">Your PostHog projects</h3>
        <button type="button" className={`${BTN.ghost} ml-auto`} onClick={() => setRound((n) => n + 1)} disabled={read.status === 'loading'} data-testid="posthog-projects-refresh">Read again</button>
      </div>
      {read.status === 'loading' && <div className="h-16 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" data-testid="posthog-projects-loading" />}
      {read.status === 'refused' && <Unreadable what="Your PostHog projects" claim={read.message} onRetry={() => setRound((n) => n + 1)} />}
      {data && (
        <div className="flex flex-col gap-1 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
          {data.ventures.length === 0
            ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="posthog-projects-empty">{NO_VENTURES}</p>
            : (
              <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800" data-testid="posthog-projects-list">
                {data.ventures.map((v) => {
                  const row = rowOf(v);
                  return (
                    <li key={v.project_id} className="flex flex-wrap items-center gap-2 py-2" data-testid="posthog-project-row" data-state={row.state}>
                      <span className="min-w-0 break-words text-[13px] font-semibold text-axal-ink dark:text-gray-100">{v.name || 'Venture not named'}</span>
                      <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="posthog-project-line">{row.line}</span>
                      {row.action === 'choose' && <button type="button" className={`${BTN.primary} ml-auto`} onClick={() => open('choose', v)} data-testid="posthog-project-choose">Choose project</button>}
                      {row.action === 'change' && (
                        <span className="ml-auto flex gap-2">
                          <button type="button" className={BTN.ghost} onClick={() => open('choose', v)} data-testid="posthog-project-change">Change</button>
                          <button type="button" className={BTN.ghost} onClick={() => open('unlink', v)} data-testid="posthog-project-unlink">Unlink</button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      )}
      {dialog?.kind === 'choose' && (
        <Lightbox label="Choose a PostHog project" title={`Choose the PostHog project for ${dialog.venture.name || 'this venture'}`} sub={CHOOSE_LINE} onClose={() => !busy && setDialog(null)} testId="posthog-choose-dialog" width={480}
          footer={(
            <div className="flex flex-col gap-2">
              {error && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="posthog-choose-error">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN.ghost} onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
                <button type="button" className={BTN.primary} onClick={() => save(pick)} disabled={busy || !pick} data-testid="posthog-choose-save">{busy ? 'Saving…' : 'Use this project'}</button>
              </div>
            </div>
          )}>
          {data?.choices === null
            ? <Unreadable what="Your PostHog projects" claim={data.choicesError} onRetry={() => setRound((n) => n + 1)} />
            : data.choices.length === 0
              ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="posthog-choose-none">Your PostHog sign-in lists no project.</p>
              : (
                <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="posthog-choose-list">
                  {data.choices.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                      <input type="radio" name="posthog-project" value={c.id} checked={pick === c.id} onChange={() => setPick(c.id)} data-testid="posthog-choose-option" />
                      <span className="font-semibold">{c.name || 'Project not named'}</span>
                      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{regionWords(c.region)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
        </Lightbox>
      )}
      {dialog?.kind === 'unlink' && (
        <Lightbox label="Unlink the PostHog project" title={`Unlink ${dialog.venture.link?.name || 'this project'}?`} sub={UNLINK_LINE} onClose={() => !busy && setDialog(null)} testId="posthog-unlink-dialog" width={480}
          footer={(
            <div className="flex flex-col gap-2">
              {error && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="posthog-unlink-error">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN.ghost} onClick={() => setDialog(null)} disabled={busy}>Keep it</button>
                <button type="button" className={BTN.primary} onClick={() => save(null)} disabled={busy} data-testid="posthog-unlink-save">{busy ? 'Unlinking…' : 'Unlink'}</button>
              </div>
            </div>
          )}>
          <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{dialog.venture.name || 'The venture'} then shows Choose project again.</p>
        </Lightbox>
      )}
    </section>
  );
}
