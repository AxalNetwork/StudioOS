import { useEffect, useRef, useState } from 'react';
import { Pill, Unreadable } from '../../ui';
import Lightbox from '../../ui/Lightbox';
import { api as mainApi } from '../../lib/api';
import { connectorsApi } from '../../lib/api/connectors';
import { BTN, INPUT } from './AccountCenter';
import { MAX_PROJECTS, emptyProjects, projectsRead, saveSentence, vercelRefusal, ventureOptions } from './vercelProjectsModel';

/**
 * D1096 (#2961, #2408 part 1) — Vercel's Choose projects, drawn in Your
 * connection on Vercel's page, as GitHub's Repositories are.
 *
 * It reads what the installation reaches (`GET /:uid/action/projects`); the
 * member picks a venture and up to 50 of those projects. Save opens an in-page
 * dialog that says what changes; confirming saves the choice (`PATCH
 * /:uid/config`) and syncs once. A failed read says so with Try again, and an
 * empty list says why, never "0 projects".
 */
export default function VercelProjectsSection({ p, onChanged, api = connectorsApi, projectsApi = mainApi }) {
  const uid = p?.connection?.uid || null;
  const [read, setRead] = useState({ status: 'loading', message: '', data: null });
  const [round, setRound] = useState(0);
  const [chosen, setChosen] = useState(new Set());
  const [venture, setVenture] = useState(null);
  const [ventures, setVentures] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    api.action(uid, 'projects').then((out) => {
      if (!live) return;
      const data = projectsRead(out);
      setRead({ status: 'ready', message: '', data });
      setChosen(new Set(data.selected));
      setVenture((v) => v ?? data.projectId);
    }, (e) => { if (live) setRead({ status: 'refused', message: vercelRefusal(e), data: null }); });
    return () => { live = false; };
  }, [api, uid, round]);

  useEffect(() => {
    if (!uid || ventures !== null) return undefined;
    let live = true;
    projectsApi.listProjects().then((r) => { if (live) setVentures(ventureOptions(r)); }, () => { if (live) setVentures(false); });
    return () => { live = false; };
  }, [uid, ventures, projectsApi]);

  if (!uid) return null;
  const data = read.data;
  const toggle = (id) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else if (n.size < MAX_PROJECTS) n.add(id);
    return n;
  });
  const ventureName = Array.isArray(ventures) ? ventures.find((v) => v.id === venture)?.name ?? null : null;
  const ordered = data ? data.available.filter((x) => chosen.has(x.id)).map((x) => x.id) : [];

  const save = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      await api.patchConfig(uid, { project_id: venture, projects: ordered });
      const out = await api.sync(uid);
      if (!alive.current) return;
      setDone(typeof out?.summary === 'string' ? out.summary : 'Synced.');
      setConfirming(false);
      onChanged?.();
    } catch (e) {
      if (alive.current) setError(vercelRefusal(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section aria-label="Projects" data-testid="connector-page-vercel-projects" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">Projects</h3>
        {data && <Pill tone="neutral">{data.selection === 'selected' ? 'Projects chosen on Vercel' : 'All projects on the account'}</Pill>}
        <button type="button" className={`${BTN.ghost} ml-auto`} onClick={() => setRound((n) => n + 1)} disabled={read.status === 'loading'} data-testid="vercel-projects-refresh">Read the list again</button>
      </div>
      {read.status === 'loading' && <div className="h-16 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" data-testid="vercel-projects-loading" />}
      {read.status === 'refused' && <Unreadable what="Vercel's projects" claim={read.message} onRetry={() => setRound((n) => n + 1)} />}
      {data && (
        <div className="flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">
            Feeds the venture
            <select className={INPUT} value={venture ?? ''} onChange={(e) => setVenture(e.target.value ? Number(e.target.value) : null)} data-testid="vercel-projects-venture">
              <option value="">Choose a venture</option>
              {(Array.isArray(ventures) ? ventures : []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {ventures === false && <span className="text-[11.5px] font-normal text-red-700 dark:text-red-300">Your ventures could not be read. Read the list again.</span>}
          </label>
          {data.available.length === 0
            ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="vercel-projects-empty">{emptyProjects(data.selection)}</p>
            : (
              <ul className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0" data-testid="vercel-projects-list">
                {data.available.map((x) => (
                  <li key={x.id}>
                    <label className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                      <input type="checkbox" checked={chosen.has(x.id)} onChange={() => toggle(x.id)} disabled={!chosen.has(x.id) && chosen.size >= MAX_PROJECTS} data-testid="vercel-project-choice" />
                      <span className="min-w-0 break-words font-semibold">{x.name}</span>
                      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{x.framework || 'Framework not recorded'}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN.primary} disabled={!ordered.length || venture == null} onClick={() => { setError(''); setConfirming(true); }} data-testid="vercel-projects-save">
              Save and sync
            </button>
            <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{ordered.length} of at most {MAX_PROJECTS} chosen. Axal VC only reads them.</span>
          </div>
          {done && <p role="status" className="m-0 text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="vercel-projects-done">{done}</p>}
        </div>
      )}
      {confirming && (
        <Lightbox label="Save and sync" title="Save these projects and sync?" sub={saveSentence(ordered.length, ventureName)} onClose={() => !busy && setConfirming(false)} testId="vercel-projects-confirm" width={480}
          footer={(
            <div className="flex flex-col gap-2">
              {error && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="vercel-projects-error">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN.ghost} onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                <button type="button" className={BTN.primary} onClick={save} disabled={busy} data-testid="vercel-projects-confirm-go">{busy ? 'Syncing…' : 'Save and sync'}</button>
              </div>
            </div>
          )}>
          <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">A project you leave out is no longer read, and what Axal VC recorded for it is deleted.</p>
        </Lightbox>
      )}
    </section>
  );
}
