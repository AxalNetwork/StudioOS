import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, actionGhost, actionPrimary } from '../../ui';
import { buildPlanApi } from '../../lib/api/buildPlan';
import { connectorsApi } from '../../lib/api/connectors';
import {
  FOOTNOTE, NOT_CONNECTED, OPENS, PREPARE_NOTE, PRIVACY_PASSED, PROVIDERS, counterText, githubConnection, pickedRepositories, providerWord, sendRefusal,
} from './buildProgressModel';

/**
 * D1070 (#2940) — VB6–VB8, Send to…: the venture's founder sends accepted
 * items to Lovable, GitHub, Notion or Vercel on D1068's `POST /handoffs`.
 *
 * The founder chooses the items (nothing is chosen for them) and the tool;
 * each tab says what it opens. "Prepare" is the founder's press: the Worker
 * builds the text, runs the privacy check and records the send, so the sheet
 * says so before it. Then every send opens in the founder's own tool from
 * their own press (a link in a new tab), or is copied or downloaded. Nothing
 * is sent by StudioOS.
 *
 * GitHub and Vercel use a repository the founder picked on their GitHub
 * connection for this venture (`GET /connectors`, then
 * `GET /connectors/:uid/repositories`). With none, the tab reads "Not
 * connected": GitHub still gives the issues to copy; Vercel needs one.
 */

const CHIP = 'inline-flex min-h-[28px] items-center rounded-full border px-3 text-[12px] font-bold';
const CHIP_ON = 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300';
const CHIP_OFF = 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100';
const EYE = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'm-0 text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400';
const BOX = 'm-0 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[10px] border border-axal-hairline bg-axal-ground p-3 font-mono text-[12px] leading-[1.6] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const OK = 'flex items-center gap-2 rounded-[10px] border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300';
const OUT = 'inline-flex min-h-[32px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** The founder's picked repositories for this venture; `null` while reading, `[]` when none. */
function useRepositories(projectId) {
  const [state, setState] = useState({ status: 'loading', repos: [] });
  useEffect(() => {
    let alive = true;
    connectorsApi.list()
      .then((list) => {
        const uid = githubConnection(list, projectId);
        if (!uid) return [];
        return connectorsApi.repositories(uid).then(pickedRepositories);
      })
      .then((repos) => { if (alive) setState({ status: 'ready', repos }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', repos: [] }); });
    return () => { alive = false; };
  }, [projectId]);
  return state;
}

async function copy(text) {
  try { await globalThis.navigator?.clipboard?.writeText(text); return true; } catch { return false; }
}
function download(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}

export default function SendSheet({ projectId, scope = 'venture', items, onClose, onSent, initial = 'lovable' }) {
  const [tool, setTool] = useState(initial);
  const [chosen, setChosen] = useState(() => new Set());
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [result, setResult] = useState(null);
  const [said, setSaid] = useState('');
  const lock = useRef(false);
  const repos = useRepositories(projectId);
  useEffect(() => { if (!repo && repos.repos.length) setRepo(repos.repos[0]); }, [repos.repos, repo]);

  const needsRepo = tool === 'vercel';
  const connected = repos.repos.length > 0;
  const picked = items.filter((i) => chosen.has(i.uid));
  const canPrepare = picked.length > 0 && !busy && !(needsRepo && !connected);
  const toggle = (uid) => setChosen((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const choose = (id) => { setTool(id); setResult(null); setRefusal(null); setSaid(''); };
  const close = () => { if (!lock.current) onClose(); };

  const prepare = async () => {
    if (!canPrepare || lock.current) return;
    lock.current = true; setBusy(true); setRefusal(null); setSaid('');
    try {
      const out = await buildPlanApi.send(projectId, {
        provider: tool, items: picked.map((i) => i.uid), ...((tool === 'github' || tool === 'vercel') && connected && repo ? { repository: repo } : {}),
      }, scope);
      setResult(out);
      onSent?.(out);
    } catch (e) {
      setRefusal(sendRefusal(e, items));
    } finally { lock.current = false; setBusy(false); }
  };
  const say = (ok, yes, no) => setSaid(ok ? yes : no);

  const status = (id) => {
    if (id === 'github' || id === 'vercel') return repos.status === 'ready' && !connected ? NOT_CONNECTED : repos.status === 'unreadable' ? 'Could not be read' : null;
    return null;
  };

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className={actionGhost} onClick={close} disabled={busy}>Close</button>
      {!result ? (
        <button type="button" className={actionPrimary} onClick={prepare} disabled={!canPrepare} data-testid="plan-send-prepare">
          {busy ? 'Preparing…' : `Prepare for ${providerWord(tool)}`}
        </button>
      ) : null}
    </div>
  );

  return (
    <Lightbox label="Send to…" title="Send to…" sub={`Send · ${picked.length} accepted ${picked.length === 1 ? 'item' : 'items'}`} onClose={close} width={600} testId="plan-send" footer={footer}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Send to" data-testid="plan-send-tabs">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={tool === p.id} onClick={() => choose(p.id)} className={`${CHIP} ${tool === p.id ? CHIP_ON : CHIP_OFF}`} data-testid={`plan-send-tab-${p.id}`}>
              {p.label}{status(p.id) ? <span className="ml-1.5 font-semibold text-axal-muted dark:text-gray-400">· {status(p.id)}</span> : null}
            </button>
          ))}
        </div>
        <p className="m-0 text-[13px] font-semibold leading-[1.5] text-axal-ink dark:text-gray-100" data-testid="plan-send-opens">{OPENS[tool]}</p>

        {!result ? (
          <>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="plan-send-items">
              <legend className={EYE}>Accepted items to send</legend>
              {!items.length ? <p className={MUTED} data-testid="plan-send-none">No accepted item has landed yet, so there is nothing to send.</p> : null}
              {items.map((i) => (
                <label key={i.uid} className="flex min-h-[32px] items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                  <input type="checkbox" checked={chosen.has(i.uid)} onChange={() => toggle(i.uid)} data-testid={`plan-send-item-${i.uid}`} />
                  <span className="font-semibold">{i.title}</span>
                </label>
              ))}
            </fieldset>
            {(tool === 'github' || tool === 'vercel') ? (
              connected ? (
                <label className="flex flex-col gap-1">
                  <span className={EYE}>Repository</span>
                  <select value={repo} onChange={(e) => setRepo(e.target.value)} className="h-9 rounded-[7px] border border-axal-hairline bg-white px-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="plan-send-repo">
                    {repos.repos.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <span className={MUTED}>Only repositories you picked on the GitHub connector.</span>
                </label>
              ) : repos.status === 'loading' ? <p className={MUTED}>Reading your GitHub connection…</p> : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 dark:border-gray-700 dark:bg-gray-800" data-testid="plan-send-unconnected">
                  <span className="text-[12.5px] text-axal-ink dark:text-gray-100">
                    {repos.status === 'unreadable' ? 'Your GitHub connection could not be read. This is not a claim that it is off.' : `${NOT_CONNECTED}. Connect GitHub to pick a repository.`}
                    {tool === 'github' ? ' You can still prepare the issues to copy.' : ' Vercel imports from a repository you picked.'}
                  </span>
                  <Link to={`/build/connect?project_id=${encodeURIComponent(projectId)}`} className={OUT}>Connect GitHub</Link>
                </div>
              )
            ) : null}
            <p className={MUTED} data-testid="plan-send-note">{PREPARE_NOTE}</p>
          </>
        ) : null}

        {refusal ? (
          <div role="alert" className="flex flex-col gap-1 rounded-[10px] border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30" data-testid="plan-send-refused">
            <p className="m-0 text-[13px] font-semibold text-red-800 dark:text-red-300">{refusal.text}</p>
            {refusal.sub ? <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{refusal.sub}</p> : null}
          </div>
        ) : null}

        {result ? <Result tool={tool} result={result} onCopy={(t) => copy(t).then((ok) => say(ok, 'Copied.', 'Could not copy. Select the text and copy it yourself.'))}
          onDownload={(t) => say(download('plan-items.md', t), 'Downloaded plan-items.md.', 'Could not download. Copy it instead.')} /> : null}
        {said ? <p className={MUTED} role="status" data-testid="plan-send-said">{said}</p> : null}
      </div>
    </Lightbox>
  );
}

/** What the press prepared, per tool, with the founder's own way out to the tool. */
function Result({ tool, result, onCopy, onDownload }) {
  if (tool === 'lovable') {
    return (
      <div className="flex flex-col gap-2" data-testid="plan-send-result-lovable">
        <span className={EYE}>Prompt</span>
        <pre className={BOX} data-testid="plan-send-prompt">{result.text}</pre>
        <span className="self-end font-mono text-[11px] text-axal-muted dark:text-gray-400" data-testid="plan-send-counter">{counterText(result.prompt_chars)}</span>
        <p className={OK} data-testid="plan-send-privacy">✓ {PRIVACY_PASSED}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={OUT} onClick={() => onCopy(result.text)} data-testid="plan-send-copy">Copy prompt</button>
          <a href={result.link} target="_blank" rel="noopener noreferrer" className={actionPrimary} data-testid="plan-send-open">Open in Lovable ↗</a>
        </div>
        <p className={MUTED}>{FOOTNOTE.lovable}</p>
      </div>
    );
  }
  if (tool === 'github') {
    const issues = Array.isArray(result.issues) ? result.issues : [];
    const linked = issues.some((x) => x.url);
    return (
      <div className="flex flex-col gap-2" data-testid="plan-send-result-github">
        <p className={OK} data-testid="plan-send-privacy">✓ {PRIVACY_PASSED}</p>
        {issues.map((x) => (
          <div key={x.plan_item_uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="plan-send-issue">
            <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{x.title}</span>
            <pre className={`${BOX} !max-h-[140px] !text-[11px]`}>{x.body}</pre>
            {x.url
              ? <a href={x.url} target="_blank" rel="noopener noreferrer" className={`${OUT} self-start`} data-testid="plan-send-issue-open">Open on GitHub ↗</a>
              : <button type="button" className={`${OUT} self-start`} onClick={() => onCopy(`## ${x.title}\n\n${x.body}`)} data-testid="plan-send-issue-copy">Copy</button>}
          </div>
        ))}
        <button type="button" className={`${OUT} self-end`} onClick={() => onCopy(result.markdown || '')} data-testid="plan-send-copy-all">Copy all as Markdown</button>
        <p className={MUTED}>{linked ? FOOTNOTE.github : FOOTNOTE.github_unconnected}</p>
      </div>
    );
  }
  if (tool === 'notion') {
    return (
      <div className="flex flex-col gap-2" data-testid="plan-send-result-notion">
        <p className={OK} data-testid="plan-send-privacy">✓ {PRIVACY_PASSED}</p>
        <pre className={BOX} data-testid="plan-send-pages">{result.markdown}</pre>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={OUT} onClick={() => onDownload(result.markdown || '')} data-testid="plan-send-download">Download .md</button>
          <button type="button" className={actionPrimary} onClick={() => onCopy(result.markdown || '')} data-testid="plan-send-copy">Copy for Notion</button>
        </div>
        <p className={MUTED}>{FOOTNOTE.notion}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="plan-send-result-vercel">
      <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{result.repository}</p>
      <a href={result.link} target="_blank" rel="noopener noreferrer" className={`${actionPrimary} self-end`} data-testid="plan-send-open">Deploy {result.repository} on Vercel ↗</a>
      <p className={MUTED}>{FOOTNOTE.vercel}</p>
    </div>
  );
}
