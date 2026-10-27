import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded, Unreadable } from '../../ui';
import Lightbox from '../../ui/Lightbox';
import { BTN, INPUT } from './AccountCenter';
import { googleWorkspace } from '../../lib/api/googleWorkspace';
import { accountCompaniesApi } from '../../lib/api/accountCompanies';
import { chooseWorkspaceFiles, loadWorkspacePicker } from '../../lib/googleWorkspacePicker';
import {
  NEVER_READ, PAGE, WORKSPACE_MODULES, filesLine, kindWord, modulePath, readStamp, statePill, stopCopy, workspaceRefusal,
} from '../../lib/googleWorkspaceWords';

/**
 * D1091 (#2956), the boards D1314 gives it — Google Workspace's own section on
 * its connector page (`/account/connectors/google_workspace`):
 *
 *   GW1  "Permission: files you choose" and "Files you chose", each with
 *        Venture, Module, Last read and Stop using (its dialog);
 *   GW2  before the permission, one card: Allow Google files, or, with no
 *        Google sign-in, "Google is not connected yet" and the Google page;
 *   GW8  on a phone, the files as a stacked list, every target 44 px.
 *
 * Reads `GET /api/connectors/google-workspace/mine`. Choosing files opens
 * Google's own picker with its own `drive.file` token, which never reaches
 * Axal (`lib/googleWorkspacePicker.js`); the Worker confirms each id. Every
 * change opens an in-page dialog first. Nothing here writes to Google.
 */

const BOX = 'rounded-axal-sm border border-axal-hairline bg-white p-5 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const H2 = 'text-[15px] font-bold text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LABEL = 'text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const ERR = 'text-[12.5px] text-red-700 dark:text-red-300';
const GOOGLE_CONSENT = /^https:\/\/accounts\.google\.com\//;

/** The ventures a member may choose files for: their own or co-founded, inside a company. */
async function readVentures() {
  const r = await accountCompaniesApi.projects();
  return (r?.projects || []).filter((v) => v.company_id != null && ['owner', 'cofounder'].includes(v.my_seat))
    .map((v) => ({ id: v.id, name: String(v.name || '').trim() || 'Untitled venture', company: v.company_name || null }));
}

function Dialog({ title, onClose, busy, children, actions, testId }) {
  return (
    <Lightbox label={title} title={title} onClose={() => { if (!busy) onClose(); }} width={520} testId={testId}
      footer={<div className="flex flex-wrap justify-end gap-2">{actions}</div>}>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-axal-ink dark:text-gray-200">{children}</div>
    </Lightbox>
  );
}

function VenturePick({ ventures, value, onChange, testId }) {
  if (ventures === null) return <p className={MUTED}>Reading your ventures…</p>;
  if (ventures === false) return <p className={ERR} data-testid={`${testId}-unread`}>Your ventures could not be read. Close this and try again.</p>;
  if (!ventures.length) return <p className={MUTED} data-testid={`${testId}-none`}>Google files are chosen for a venture inside a company, and you have none yet.</p>;
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>Venture</span>
      <select className={INPUT} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid={testId}>
        <option value="">Choose a venture</option>
        {ventures.map((v) => <option key={v.id} value={v.id}>{v.name}{v.company ? ` · ${v.company}` : ''}</option>)}
      </select>
    </label>
  );
}

function useVentures(open) {
  const [ventures, setVentures] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    Promise.resolve().then(readVentures).then((v) => { if (alive) setVentures(v); }).catch(() => { if (alive) setVentures(false); });
    return () => { alive = false; };
  }, [open]);
  return ventures;
}

/** GW2's Allow: the venture whose company it is switched on for, said and ticked, then Google's consent page. */
function AllowDialog({ onClose, assign }) {
  const ventures = useVentures(true);
  const [project, setProject] = useState(null);
  const [enable, setEnable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const chosen = (ventures || []).find((v) => v.id === project);
  const go = async () => {
    setBusy(true); setRefusal('');
    try {
      const r = await googleWorkspace.connect(project, enable);
      const url = r?.redirect_url || r?.auth_url;
      if (typeof url !== 'string' || !GOOGLE_CONSENT.test(url)) throw new Error('Google did not answer with its consent page. Try again in a moment.');
      assign(url);
    } catch (e) {
      setRefusal(e?.code || e?.data?.error ? workspaceRefusal(e) : (e?.message || workspaceRefusal(e)));
      setBusy(false);
    }
  };
  return (
    <Dialog title={PAGE.allowTitle} onClose={onClose} busy={busy} testId="gw-allow-dialog"
      actions={(
        <>
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN.primary} onClick={go} disabled={busy || !chosen || !enable} data-testid="gw-allow-confirm">{busy ? 'Opening Google…' : 'Continue to Google'}</button>
        </>
      )}>
      <p className="m-0">{PAGE.allowBody}</p>
      <VenturePick ventures={ventures} value={project} onChange={setProject} testId="gw-allow-venture" />
      {chosen ? (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={enable} onChange={(e) => setEnable(e.target.checked)} data-testid="gw-allow-enable" />
          <span>Switch Google files on for {chosen.company || 'this venture’s company'}. Its ventures can then read the files you choose.</span>
        </label>
      ) : null}
      <p className={`m-0 ${MUTED}`}>{PAGE.allowNote}</p>
      {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid="gw-allow-refusal">{refusal}</p> : null}
    </Dialog>
  );
}

/** Choose files: the venture and the module, then Google's own picker. */
function ChooseDialog({ onClose, onDone, picker }) {
  const ventures = useVentures(true);
  const [project, setProject] = useState(null);
  const [module, setModule] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const config = useRef(null);
  // The picker's libraries load before the press: Google's window opens only inside it.
  useEffect(() => {
    if (!project) return undefined;
    let alive = true;
    config.current = null;
    Promise.all([googleWorkspace.pickerConfig(project), picker.load()])
      .then(([c]) => { if (alive) config.current = c; })
      .catch((e) => { if (alive) setRefusal(workspaceRefusal(e)); });
    return () => { alive = false; };
  }, [project, picker]);
  const go = async () => {
    setBusy(true); setRefusal('');
    try {
      if (!config.current?.configured) throw Object.assign(new Error('picker_not_ready'), { code: 'picker_not_ready' });
      const ids = await picker.choose(config.current);
      if (!ids.length) { setBusy(false); return; }
      const r = await googleWorkspace.choose(project, module, ids);
      onDone(`${r?.added ?? ids.length} ${(r?.added ?? ids.length) === 1 ? 'file' : 'files'} chosen for ${modulePath(module)}.`);
    } catch (e) {
      setRefusal(workspaceRefusal(e?.code ? e : { code: e?.message, data: e?.data }));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Choose Google files" onClose={onClose} busy={busy} testId="gw-choose-dialog"
      actions={(
        <>
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN.primary} onClick={go} disabled={busy || !project || !module} data-testid="gw-choose-confirm">{busy ? 'Opening Google…' : 'Choose from Google Drive'}</button>
        </>
      )}>
      <p className="m-0">Pick the venture and the module, then the files in Google’s file picker. Axal VC opens only those files, and only to read them.</p>
      <VenturePick ventures={ventures} value={project} onChange={setProject} testId="gw-choose-venture" />
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Module</span>
        <select className={INPUT} value={module} onChange={(e) => setModule(e.target.value)} data-testid="gw-choose-module">
          <option value="">Choose a module</option>
          {Object.keys(WORKSPACE_MODULES).map((k) => <option key={k} value={k}>{modulePath(k)} · {WORKSPACE_MODULES[k][2].map(kindWord).join(', ')}</option>)}
        </select>
      </label>
      {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid="gw-choose-refusal">{refusal}</p> : null}
    </Dialog>
  );
}

function StopDialog({ file, onClose, onDone }) {
  const copy = stopCopy(file);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const go = async () => {
    setBusy(true); setRefusal('');
    try { await googleWorkspace.stop(file.uid); onDone(`Axal VC no longer opens “${file.name}”.`); }
    catch (e) { setRefusal(workspaceRefusal(e)); setBusy(false); }
  };
  return (
    <Dialog title={copy.title} onClose={onClose} busy={busy} testId="gw-stop-dialog"
      actions={(
        <>
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN.dangerSolid} onClick={go} disabled={busy} data-testid="gw-stop-confirm">{busy ? 'Stopping…' : copy.button}</button>
        </>
      )}>
      <p className="m-0" data-testid="gw-stop-keeps">{copy.keeps}</p>
      <p className={`m-0 ${MUTED}`} data-testid="gw-stop-google">{copy.google}</p>
      {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid="gw-stop-refusal">{refusal}</p> : null}
    </Dialog>
  );
}

const LastRead = ({ f }) => (readStamp(f.last_synced_at) ? <span className="font-mono">{readStamp(f.last_synced_at)}</span> : <Unrecorded reason={NEVER_READ}>Not read yet</Unrecorded>);

function FilesTable({ items, onStop }) {
  return (
    <div className="hidden sm:block" data-testid="gw-files-table">
      <div className="grid grid-cols-[minmax(0,1.6fr)_70px_minmax(0,1fr)_minmax(0,1.3fr)_130px_100px] gap-3 border-b border-axal-hairline px-1 pb-2 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:border-gray-800 dark:text-gray-400">
        <span>Name</span><span>Kind</span><span>Venture</span><span>Module</span><span>Last read</span><span />
      </div>
      {items.map((f) => (
        <div key={f.uid} className="grid grid-cols-[minmax(0,1.6fr)_70px_minmax(0,1fr)_minmax(0,1.3fr)_130px_100px] items-center gap-3 border-b border-axal-hairline px-1 py-2 last:border-0 dark:border-gray-800" data-testid="gw-file-row">
          <span className="min-w-0 break-words font-semibold">{f.name}{f.status === 'unreadable' ? <span className="ml-2 text-[11.5px] font-normal text-amber-800 dark:text-amber-200">Could not be read</span> : null}</span>
          <span>{kindWord(f.kind)}</span>
          <span className="min-w-0 break-words">{f.venture_name || <Unrecorded reason="The venture's name is not recorded.">Not recorded</Unrecorded>}</span>
          <span className="min-w-0 break-words">{modulePath(f.module) || f.module}</span>
          <span className="text-[12.5px]"><LastRead f={f} /></span>
          <button type="button" className={BTN.ghost} onClick={() => onStop(f)} aria-label={`Stop using ${f.name}`} data-testid={`gw-stop-${f.uid}`}>Stop using</button>
        </div>
      ))}
    </div>
  );
}

/** GW8: the same files as a stacked list on a phone, every target at least 44 px. */
function FilesList({ items, onStop }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden" data-testid="gw-files-list">
      {items.map((f) => (
        <li key={f.uid} className="flex flex-col gap-1 rounded-axal-sm border border-axal-hairline p-3 dark:border-gray-800" data-testid="gw-file-item">
          <span className="font-semibold">{f.name}</span>
          <span className={`text-[12.5px] ${MUTED}`}>{kindWord(f.kind)} · {modulePath(f.module) || f.module}</span>
          <span className={`text-[12.5px] ${MUTED}`}>Last read <LastRead f={f} /></span>
          <button type="button" className={`${BTN.ghost} min-h-[44px] self-start`} onClick={() => onStop(f)} aria-label={`Stop using ${f.name}`} data-testid={`gw-stop-phone-${f.uid}`}>Stop using</button>
        </li>
      ))}
    </ul>
  );
}

const DEFAULT_PICKER = { load: loadWorkspacePicker, choose: chooseWorkspaceFiles };

export default function GoogleWorkspaceFiles({ picker = DEFAULT_PICKER, assign = (url) => window.location.assign(url) }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [done, setDone] = useState('');
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    Promise.resolve().then(() => googleWorkspace.mine())
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [tick]);

  if (read.status === 'loading' && !read.data) return <div className={`${BOX} ${MUTED}`} data-testid="gw-loading">Reading your Google files…</div>;
  if (read.status === 'error') return <div className={BOX} data-testid="gw-unreadable"><Unreadable what="Your Google files" claim="That is not the same as having none." onRetry={reload} /></div>;

  const { state, account_email: email, items = [], ventures = 0 } = read.data || {};
  const pill = statePill(state, email);
  const finish = (msg) => { setDialog(null); setDone(msg); reload(); };

  return (
    <section aria-label="Google files" className="flex min-w-0 flex-col gap-4" data-testid="gw-section" data-state={state}>
      {pill ? <span className="self-start" data-testid="gw-pill"><Pill tone={pill.tone}>{pill.text}</Pill></span> : null}
      {done ? <p role="status" className="m-0 rounded-axal-sm bg-axal-ground px-3 py-2 text-[12.5px] dark:bg-gray-800" data-testid="gw-done">{done}</p> : null}

      {state === 'google_not_connected' ? (
        <div className={`${BOX} flex flex-col gap-2`} data-testid="gw-no-google">
          <h2 className={H2}>{PAGE.noGoogleTitle}</h2>
          <p className="m-0">{PAGE.noGoogleBody}</p>
          <Link to={PAGE.googlePageHref} className={`${BTN.link} max-sm:inline-flex max-sm:min-h-[44px] max-sm:items-center`} data-testid="gw-open-google">{PAGE.noGoogleLink}</Link>
        </div>
      ) : state === 'workspace_not_allowed' ? (
        <div className={`${BOX} flex flex-col gap-2`} data-testid="gw-allow">
          <h2 className={H2}>{PAGE.allowTitle}</h2>
          <p className="m-0">{PAGE.allowBody}</p>
          <p className={`m-0 ${MUTED}`}>{PAGE.allowNote}</p>
          <button type="button" className={`${BTN.primary} self-start`} onClick={() => setDialog({ kind: 'allow' })} data-testid="gw-allow-button">{PAGE.allowButton}</button>
        </div>
      ) : (
        <>
          <div className={`${BOX} flex flex-wrap items-start justify-between gap-3`} data-testid="gw-permission">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 className={H2}>{PAGE.permissionTitle}</h2>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {PAGE.permissionLines.map((l) => <li key={l}><span aria-hidden="true" className="mr-1.5 text-emerald-700 dark:text-emerald-300">✓</span>{l}</li>)}
              </ul>
              <Link to={PAGE.googlePageHref} className={`${BTN.link} max-sm:inline-flex max-sm:min-h-[44px] max-sm:items-center`}>{PAGE.googlePage}</Link>
            </div>
            <button type="button" className={BTN.primary} onClick={() => setDialog({ kind: 'choose' })} data-testid="gw-choose-button">{PAGE.chooseButton}</button>
          </div>
          <div className={`${BOX} flex flex-col gap-3`} data-testid="gw-files">
            <h2 className={`${H2} flex flex-wrap items-baseline gap-2`}>{PAGE.filesTitle}<span className={`text-[12.5px] font-normal ${MUTED}`} data-testid="gw-files-line">{filesLine(items.length, ventures)}</span></h2>
            {items.length ? (
              <>
                <FilesTable items={items} onStop={(f) => setDialog({ kind: 'stop', file: f })} />
                <FilesList items={items} onStop={(f) => setDialog({ kind: 'stop', file: f })} />
              </>
            ) : <p className={`m-0 ${MUTED}`} data-testid="gw-files-none">{PAGE.noFiles}</p>}
          </div>
        </>
      )}

      {dialog?.kind === 'allow' ? <AllowDialog onClose={() => setDialog(null)} assign={assign} /> : null}
      {dialog?.kind === 'choose' ? <ChooseDialog picker={picker} onClose={() => setDialog(null)} onDone={finish} /> : null}
      {dialog?.kind === 'stop' ? <StopDialog file={dialog.file} onClose={() => setDialog(null)} onDone={finish} /> : null}
    </section>
  );
}
