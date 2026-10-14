import { useContext, useEffect, useRef, useState } from 'react';
import { Pill, Unreadable } from '../../ui';
import { api as mainApi } from '../../lib/api';
import { connectorsApi } from '../../lib/api/connectors';
import { BTN, INPUT, LoadingRows } from './AccountCenter';
import { Banner, FedGroup, Group, Row, Sheet, SheetFrame } from './ConnectorSheet';
import { repoLine, successBanner, syncFinished, syncProgress, syncRefusal } from './githubSync';

/**
 * D686 §5.4 (#1597) — GitHub's `sync` view (`Cycle Action.dc.html`, `connect`
 * › `sync`): choose what StudioOS reads, then sync it. Reached after GitHub's
 * sign-in returns, and from the connection's detail; Build and the Connectors
 * page open the same sheet.
 *
 * THE PROJECT. The repositories feed one project. Build passes its own; on
 * the Connectors page it is the one already chosen (GET's `project_id`), else
 * the member picks one. `companyId` is the project's company, sent as the
 * header the Worker scopes the connection by (Build only).
 *
 * THE SYNC RUNS INSIDE ITS REQUEST, so its progress is read from
 * `/sync-status` from the moment it starts, before the POST answers. A
 * percentage is drawn only when the Worker reports one.
 */

const POLL_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function GithubSyncSheet({ p, conn, projectId = null, companyId = null, eyebrow = 'Connector', onClose, back, onChanged, api = connectorsApi, projectsApi = mainApi, wait = sleep }) {
  const uid = conn?.uid;
  // In Build's lightbox Done and Open close it all (D686 §5.4); elsewhere they close the sheet.
  const dismiss = useContext(SheetFrame)?.onDismiss || onClose;
  const opts = companyId ? { companyId } : undefined;
  const [read, setRead] = useState({ status: 'loading', available: [], message: '' });
  const [chosen, setChosen] = useState(new Set());
  const [project, setProject] = useState(projectId);
  const [projects, setProjects] = useState(null);
  const [phase, setPhase] = useState('choose'); // choose | saving | syncing | done
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    api.repositories(uid, opts).then((r) => {
      if (!live) return;
      setRead({ status: 'ready', available: Array.isArray(r?.available) ? r.available : [], message: '' });
      setChosen(new Set((Array.isArray(r?.selected) ? r.selected : []).map(String)));
      if (projectId == null && r?.project_id != null) setProject(Number(r.project_id));
    }, (e) => { if (live) setRead({ status: 'refused', available: [], message: syncRefusal(e) }); });
    return () => { live = false; };
    // `opts` is derived from companyId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, uid, companyId, projectId]);

  // The Connectors page has no project of its own: with none chosen yet, the member picks one.
  const needsPicker = projectId == null && project == null && read.status === 'ready';
  useEffect(() => {
    if (!needsPicker || projects !== null) return undefined;
    let live = true;
    projectsApi.listProjects().then((r) => { if (live) setProjects(Array.isArray(r) ? r : r?.items || r?.projects || []); }, () => { if (live) setProjects(false); });
    return () => { live = false; };
  }, [needsPicker, projects, projectsApi]);

  const toggle = (name) => setChosen((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const syncSelected = async () => {
    setError('');
    setPhase('saving');
    try {
      await api.setRepositories(uid, [...chosen], project, opts);
    } catch (e) {
      setError(syncRefusal(e));
      setPhase('choose');
      return;
    }
    setPhase('syncing');
    setProgress(syncProgress(null));
    // Progress is read from before the POST answers: the sync runs inside it.
    let answered = false;
    const run = api.sync(uid, opts).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e })).finally(() => { answered = true; });
    (async () => {
      while (!answered && alive.current) {
        try {
          const st = await api.syncStatus(uid);
          if (alive.current) setProgress(syncProgress(st));
          if (syncFinished(st)) break;
        } catch { /* a progress read is a convenience; the POST's answer decides */ }
        await wait(POLL_MS);
      }
    })();
    const out = await run;
    if (!alive.current) return;
    if (!out.ok) {
      setError(syncRefusal(out.e));
      setPhase('choose');
      return;
    }
    setResult(out.r || null);
    setPhase('done');
    onChanged?.();
  };

  const name = p?.display_name || 'GitHub';

  if (phase === 'done') {
    const banner = successBanner(p?.key || 'github', result);
    return (
      <Sheet eyebrow={eyebrow} title={`${name} is synced`} onClose={onClose} data-testid="connector-sheet-success"
        footer={<button type="button" className={BTN.primary} onClick={() => { onChanged?.(); dismiss?.(); }} data-testid="button-connected-done">Done</button>}>
        {banner && <Banner tone="ok" data-testid="connect-success-banner">{banner}</Banner>}
        <FedGroup conn={conn} name={name} projectId={project} onOpen={dismiss} />
      </Sheet>
    );
  }

  const busy = phase === 'saving' || phase === 'syncing';
  const footer = (
    <>
      {back && <button type="button" className={BTN.ghost} onClick={back} disabled={busy}>Back</button>}
      <span className="mr-auto text-[11.5px] text-axal-muted dark:text-gray-400">Reads issues, pull requests and releases only.</span>
      <button type="button" className={BTN.primary} disabled={busy || chosen.size === 0 || project == null || read.status !== 'ready'} onClick={syncSelected} data-testid="button-sync-selected">
        {phase === 'saving' ? 'Saving…' : phase === 'syncing' ? 'Syncing…' : 'Sync selected'}
      </button>
    </>
  );

  return (
    <Sheet eyebrow={eyebrow} title={`Connect ${name}`} sub="Choose what StudioOS reads. You can change this later." onClose={onClose} footer={footer} data-testid="connector-sheet-sync">
      {error && <Banner tone="danger" data-testid="sync-error">{error}</Banner>}
      {phase === 'syncing' && progress && (
        <div className="mx-5 mt-3" role="status" data-testid="sync-progress">
          <p className="text-[12.5px] text-axal-ink dark:text-gray-200">
            {progress.reading ? `Reading ${progress.reading.replace(/^Reading /, '')}` : 'Syncing…'}{progress.pct != null ? ` · ${progress.pct}%` : ''}
          </p>
          {progress.pct != null && (
            <div className="mt-1 h-1.5 rounded-full bg-violet-100 dark:bg-violet-950" role="progressbar" aria-label="Sync progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct}>
              <div className="h-full rounded-full bg-violet-700 dark:bg-violet-400" style={{ width: `${progress.pct}%` }} />
            </div>
          )}
        </div>
      )}
      {read.status === 'loading' && <div className="mx-5 mt-4"><LoadingRows lines={3} /></div>}
      {read.status === 'refused' && <Banner tone="danger" data-testid="sync-refused">{read.message}</Banner>}
      {needsPicker && (
        <div className="mx-5 mt-4" data-testid="sync-project">
          {projects === false
            ? <Unreadable what="Your projects" claim="This is not a claim that you have none." />
            : (
              <label className="block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">The project these feed
                <select className={`${INPUT} mt-1`} value="" onChange={(e) => setProject(e.target.value ? Number(e.target.value) : null)} data-testid="sync-project-select">
                  <option value="">Choose a project</option>
                  {(projects || []).map((pr) => <option key={pr.id} value={pr.id}>{pr.name || pr.title || `Project ${pr.id}`}</option>)}
                </select>
              </label>
            )}
        </div>
      )}
      {read.status === 'ready' && (
        <Group label="Repositories">
          {read.available.length === 0
            ? <Row a="No repository" b="GitHub lists none this installation can read. Add repositories to the StudioOS app in GitHub, then come back." />
            : read.available.map((r) => {
              const on = chosen.has(r.full_name);
              return (
                <Row key={r.full_name} a={r.full_name} b={repoLine(r)}
                  action={(
                    <button type="button" aria-pressed={on} onClick={() => toggle(r.full_name)} disabled={busy} data-testid={`repo-${r.full_name}`}
                      className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-axal-violet/30 bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-ink/80 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
                      {on ? 'Selected' : 'Not selected'}
                    </button>
                  )} />
              );
            })}
        </Group>
      )}
      {read.status === 'ready' && <p className="mx-5 mt-2 text-[11.5px] text-axal-muted dark:text-gray-400"><Pill tone="neutral">{chosen.size} selected</Pill></p>}
    </Sheet>
  );
}
