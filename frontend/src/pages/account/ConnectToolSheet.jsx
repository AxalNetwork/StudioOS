import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { BrandIcon, Pill, Unreadable } from '../../ui';
import Lightbox from '../../ui/Lightbox.jsx';
import ActionSheet from '../../ui/ActionSheet.jsx';
import { BTN, INPUT, LoadingRows } from './AccountCenter';
import { connectorsApi } from '../../lib/api/connectors';
import { successBanner } from './githubSync';
import { Banner, ConnectorPanel, Group, Row, SheetFrame, disconnect, openingView, useConnectors } from './ConnectorSheet';
import {
  TOOL_FILTERS, accountDisconnectNote, companiesWith, companiesWithout, companyBanner, disconnectResult, disconnectReview, linkPrompt, projectCompany,
  retryOutcome, rowLastRead, scopeLadder, servesCompany, stopForCompanyNote, toolBanner, toolDeepLink, toolGroups, toolRow, ventureOwner,
} from './connectorsModel';
import { cyclesApi } from '../../lib/api/cycles.js';
import { useViewMode } from '../../contexts/ViewModeContext.js';
import { isFounderPreview } from '../cycles/previewUploadModel.js';
import { useAuth } from '../../hooks/useAuthSync';
import { companyActionsApi } from '../../lib/api/companyActions.js';
import { ActionDialog } from './companies/LifecycleDialogs.jsx';

/**
 * D651 (#1463) — Build's "Connect a tool", drawn to `Cycle Action.dc.html`'s
 * `connect` action (`list`, `failed`, `locked`, `loading`, `refused`,
 * `success`). It reads the same catalogue as the Connectors page and opens the
 * same panel, so a tool connected here is a connector there.
 *
 * `refused` and `success` are the panel's own `refused` and `connected` views.
 * A provider's sign-in started here returns to Build (D686 §5.2): the panel
 * sends `return_to=build` for registry tools, Google, Microsoft and LinkedIn,
 * and the Worker's callback sends the browser to `/build/connect`. A registry
 * tool returns `?oauth=…&provider=…`, Google `?google=…`, Microsoft
 * `?microsoft=…` and LinkedIn `?linkedin=…`; `oauthReturn` reads all four
 * and reopens that tool's view. One started on the Connectors page still
 * returns to `/integrations` (D651).
 *
 * ONE FRAME (D686 §5.4). The list and every panel view swap inside one
 * `<Lightbox size="tall">`, so a swap never remounts it or pulls focus back to
 * the CTA. The list is an `ActionSheet`; a panel is its `Sheet` in the frame's
 * layout (`SheetFrame`). × and the backdrop close the lightbox; Escape steps
 * back from a panel, and closes from the list; Back returns to the list; Done
 * and an Open link close it all. A tool's settings dialog is a nested
 * Lightbox, so it takes Escape alone.
 *
 * D686 §5.4 (#1597): the rows say what is true (`toolRow`), GitHub chooses
 * its repositories in the `sync` view (`GithubSyncSheet.jsx`), and every
 * connection is made for THIS project's company (`projectCompany`), which
 * is sent as the header the Worker scopes it by.
 *
 * D8774 (#8774): a row says a tool feeds this venture only when all three
 * scopes hold (`ventureFeed`): connected to the account, turned on for the
 * venture's company, and for GitHub reading repositories chosen for this
 * venture. Each connected row draws the three as a ladder (`scopeLadder`).
 * A venture in no company gets one action above the list: its owner links it
 * here (`LinkCompanyDialog`, the existing move route) and stays in this setup;
 * anyone else is told who the owner is and can copy a link to this setup.
 * Disconnect is a scope review: "Stop using for {company}" first, then the
 * account-wide disconnect, which names every company the connection serves.
 *
 * D8774 part 3 (BLS07, BLS04, BLS10): stopping or disconnecting is three
 * steps on the row, Scope → Review → Result. Review says what stops, what
 * stays and who acts, and its destructive button is never focused first;
 * Result is a polite status. The GitHub row names the last successful read of
 * this venture, from Operating systems' own read. A Super Admin previewing
 * the founder shell is told that the tools listed are their own and that
 * anything done here, linking included, is written as them.
 */

// D703 (#1665): `asPage` is the cycle route's page mode below 1024px. Share an update's nested Connect a tool passes none, so it stays a dialog.
export default function ConnectToolSheet({ projectId = null, onClose, onChanged, asPage }) {
  // The project's company: undefined while read, null when it could not be.
  const [project, setProject] = useState(projectId ? undefined : null);
  const [projectRead, setProjectRead] = useState(0);
  useEffect(() => {
    if (!projectId) return undefined;
    let live = true;
    api.getProject(projectId).then((r) => { if (live) setProject(r || null); }, () => { if (live) setProject(null); });
    return () => { live = false; };
  }, [projectId, projectRead]);
  const user = useAuth()?.user ?? null;
  const companyId = project?.company_id && Number.isSafeInteger(Number(project.company_id)) ? Number(project.company_id) : null;
  const data = useConnectors({ companyId });
  const reload = () => { data.reload(); onChanged?.(); };
  // A sign-in's return (`?oauth=…`) or `?tool=<key>` (D686 §5.4): read once,
  // then its keys are stripped so a reload does not replay it. The functional
  // update keeps the `project_id` the page itself just set.
  const [searchParams, setSearchParams] = useSearchParams();
  const [deepSearch] = useState(() => searchParams.toString());
  useEffect(() => {
    const link = toolDeepLink(`?${deepSearch}`, []);
    // D8774: `link=company` (Overview's Link to a company) opens the link dialog once, then leaves the address.
    const strip = [...(link?.strip || []), ...(searchParams.has('link') ? ['link'] : [])];
    if (!strip.length) return;
    setSearchParams((old) => { const next = new URLSearchParams(old); for (const k of strip) next.delete(k); return next; }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const linked = () => { setProjectRead((n) => n + 1); reload(); };
  // D8774 part 3 (BLS04): the last successful read of this venture, from Operating systems' read, only
  // while the viewer's GitHub is connected and the venture is in a company. Undefined while read, null unreadable.
  const githubConnected = data.catalogue.some((p) => p.key === 'github' && p.connection);
  const [tools, setTools] = useState(undefined);
  const [toolsRead, setToolsRead] = useState(0);
  useEffect(() => {
    if (!projectId || !companyId || !githubConnected) return undefined;
    let live = true;
    setTools(undefined);
    cyclesApi.module('build', projectId, 'operating-systems').then(
      (r) => { if (live) setTools(r?.parts?.tools ?? null); },
      () => { if (live) setTools(null); },
    );
    return () => { live = false; };
  }, [projectId, companyId, githubConnected, toolsRead]);
  const ventureRead = projectId && companyId && githubConnected ? { tools, retry: () => setToolsRead((n) => n + 1) } : null;
  return <ConnectToolView data={{ ...data, reload }} project={projectId ? project : false} projectId={projectId} onClose={onClose} deepLink={`?${deepSearch}`} asPage={asPage} user={user} onLinked={linked} ventureRead={ventureRead} />;
}

/**
 * D8774 (BLS02): link a venture in no company to one of the member's companies,
 * inside Build, on the one writer of `projects.company_id` (`POST
 * /projects/:id/move`: owner or admin, the owner a member of the company).
 * Its refusals (`slug_taken`, 409 when the venture moved meanwhile) are said
 * inside it. Done closes it and the sheet re-reads the venture, so the setup
 * continues with "Use {tool} for {company}".
 */
export function LinkCompanyDialog({ projectId, ventureName, companies, onClose, onDone, actor = null }) {
  const [to, setTo] = useState(null);
  const options = (Array.isArray(companies) ? companies : [])
    .filter((c) => Number.isSafeInteger(Number(c?.id)) && Number(c.id) > 0)
    .map((c) => ({ value: String(c.id), label: c.company_name || c.name || 'Unnamed company' }));
  const copy = {
    title: `Link ${ventureName || 'this venture'} to a company`,
    body: [
      'Tools turned on for that company can then feed it. It then shows only under that company.',
      // D8774 part 3 (BLS10): in Super Admin preview the dialog says whose name the move carries.
      ...(actor ? [`Axal admins may move a venture. This link is written as you, ${actor}, not as the founder.`] : []),
      'You come back to Connect a tool after.',
    ],
    button: 'Link', cancel: 'Cancel',
  };
  return (
    <ActionDialog copy={copy} testId="link-company-dialog" ready={to != null}
      run={() => companyActionsApi.moveProject(projectId, { company_id: Number(to) })} onClose={onClose} onDone={onDone}>
      {options.length ? (
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Companies" data-testid="link-company-options">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 rounded-[9px] border border-axal-hairline px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
              <input type="radio" name="link-company" checked={to === o.value} onChange={() => setTo(o.value)} data-testid={`link-company-${o.value}`} />
              <b>{o.label}</b>
            </label>
          ))}
        </div>
      ) : <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="link-company-none">You belong to no company yet. Create one in Account › Companies first.</p>}
    </ActionDialog>
  );
}

/**
 * The sheet, drawn from one `useConnectors()` read; exported so a test can
 * hand it each state. `project` is `GET /projects/:id` (undefined while read,
 * null when unreadable, false when the sheet has no project).
 */
export function ConnectToolView({ data, onClose, project = false, projectId = null, deepLink = '', asPage, user = null, onLinked, ventureRead = null }) {
  const preview = isFounderPreview(useViewMode());
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');
  const [panel, setPanel] = useState(null); // { key, view }
  // Per row: the stop or disconnect steps (D8774 part 3, BLS07: { key, step: scope|review|result, choice, result }),
  // and Try again's answer.
  const [confirm, setConfirm] = useState(null);
  const actor = typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null;
  const [rowNote, setRowNote] = useState({});
  const [busy, setBusy] = useState(null);
  // The deep link opens its panel once the catalogue is read: only a key it holds opens anything.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || data.status !== 'ready' || !deepLink) return;
    linked.current = true;
    const link = toolDeepLink(deepLink, data.catalogue);
    if (link?.panel) setPanel(link.panel);
  }, [data.status, data.catalogue, deepLink]);
  const scope = project === false ? null : projectCompany(project, data.companies);
  const cannotConnect = !!scope && (scope.state === 'outside' || scope.state === 'unreadable' || scope.state === 'loading');
  const companyNote = scope ? companyBanner(scope) : null;
  // D8774: who can link a venture in no company, the context every row is drawn in, and the link dialog.
  const ventureName = project && typeof project === 'object' && typeof project.name === 'string' ? project.name : null;
  const owner = scope?.state === 'none' ? ventureOwner(project, user) : null;
  const ctx = scope ? { scope, projectId, ventureName } : null;
  const [linking, setLinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const wantsLink = useRef(new URLSearchParams(deepLink).get('link') === 'company');
  useEffect(() => {
    if (wantsLink.current && owner?.canLink) { wantsLink.current = false; setLinking(true); }
  }, [owner?.canLink]);
  const copySetupLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/build/connect?project_id=${encodeURIComponent(String(projectId))}`); setCopied(true); }
    catch { setCopied(false); }
  };
  const banner = toolBanner(data.catalogue);
  // While the failed banner shows, the failing tool's group is drawn first.
  const pin = banner?.view === 'failed' ? (data.catalogue.find((p) => p.key === banner.key)?.category || 'Other') : null;
  const { groups, total } = toolGroups(data.catalogue, { q, filter, pin });
  const panelP = panel && data.catalogue.find((p) => p.key === panel.key);

  const back = () => setPanel(null);
  const frame = (body) => (
    <Lightbox label="Connect a tool" size="tall" width={600} onClose={onClose} onEscape={panelP ? back : onClose} testId="connect-tool-lightbox" focusKey={panelP ? `${panel.key}:${panel.view}` : 'list'} {...asPage}>
      <SheetFrame.Provider value={{ onDismiss: onClose }}>{body}</SheetFrame.Provider>
    </Lightbox>
  );

  if (panelP) {
    return frame(
      <ConnectorPanel
        key={`${panel.key}:${panelP.connection ? 'c' : 'n'}`}
        eyebrow="Build"
        p={panelP}
        view={panel.view}
        ret={panel.ret || {}}
        returnTo="build"
        setView={(view) => setPanel((s) => ({ ...s, view }))}
        onChanged={data.reload}
        onClose={back}
        back={back}
        projectId={projectId}
        companyId={scope?.state === 'ok' ? scope.companyId : null}
        companyName={scope?.state === 'ok' ? scope.name : null}
        companyNote={companyNote}
        companyState={scope?.state || null}
        blocked={cannotConnect}
      />,
    );
  }

  const retry = async (p) => {
    setBusy(p.key);
    let out;
    // The sync runs for the project's company, as the panel's Sync now does.
    try {
      const r = await connectorsApi.sync(p.connection.uid, scope?.state === 'ok' ? { companyId: scope.companyId } : undefined);
      // The Worker's summary of what it synced, when it gives one (#1597).
      out = retryOutcome(null);
      const said = successBanner(p.key, r);
      if (said) out = { ...out, text: said };
    } catch (e) { out = retryOutcome(e); }
    setRowNote((n) => ({ ...n, [p.key]: out }));
    setBusy(null);
    if (out.tone === 'ok') data.reload();
  };
  const facts = () => ({ scope, companies: data.companies, ventureName, actor });
  const doDisconnect = async (p) => {
    setBusy(p.key);
    // The Result is worded from the connection as it was, before the list is read again.
    const before = { ...facts() };
    try { await disconnect(p); setConfirm({ key: p.key, step: 'result', choice: 'account', result: disconnectResult(p, 'account', { ...before, at: new Date() }) }); data.reload(); }
    catch (e) { setRowNote((n) => ({ ...n, [p.key]: { tone: 'danger', text: e?.message || 'The tool could not be disconnected.' } })); }
    finally { setBusy(null); }
  };

  // D8774 (BLS07): the scoped stop. The PUT replaces the set, so the others are sent back; the account connection stays.
  const stopHere = async (p) => {
    setBusy(p.key);
    const before = { ...facts() };
    try {
      await connectorsApi.setCompanies(p.connection.uid, companiesWithout(p.connection, scope.companyId));
      setConfirm({ key: p.key, step: 'result', choice: 'stop', result: disconnectResult(p, 'stop', { ...before, at: new Date() }) });
      data.reload();
    }
    catch (e) { setRowNote((n) => ({ ...n, [p.key]: { tone: 'danger', text: e?.message || 'The company could not be turned off.' } })); }
    finally { setBusy(null); }
  };

  const enableHere = async (p) => {
    setBusy(p.key);
    try { await connectorsApi.setCompanies(p.connection.uid, companiesWith(p.connection, scope.companyId)); data.reload(); }
    catch (e) { setRowNote((n) => ({ ...n, [p.key]: { tone: 'danger', text: e?.message || 'The company could not be turned on.' } })); }
    finally { setBusy(null); }
  };

  const action = (p, row) => {
    const testid = `tool-action-${p.key}`;
    // Connecting or reconnecting is for a company the member is in (D686 §5.4).
    if (cannotConnect && (row.action === 'connect' || row.action === 'reconnect' || row.action === 'upgrade')) return null;
    // A connection that does not serve this project's company yet: add it, keeping the others (the PUT replaces the set).
    if (scope?.state === 'ok' && servesCompany(p.connection, scope.companyId) === false) {
      return <button type="button" className={BTN.primary} data-testid={testid} disabled={busy === p.key} onClick={() => enableHere(p)}>{`Use for ${scope.name || 'this company'}`}</button>;
    }
    // D8774 (BLS03): GitHub on for the company with no repository for this venture: choose them, then sync.
    if (row.action === 'choose') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: 'sync' })}>{row.actionLabel}</button>;
    if (rowNote[p.key]?.reconnect || row.action === 'reconnect') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: 'pre' })}>Reconnect</button>;
    if (row.action === 'upgrade') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: 'pro' })}>{row.actionLabel}</button>;
    if (row.action === 'retry') return <button type="button" className={BTN.primary} data-testid={testid} disabled={busy === p.key} onClick={() => retry(p)}>{busy === p.key ? 'Trying…' : row.actionLabel}</button>;
    if (row.action === 'disconnect') {
      const open = confirm?.key === p.key;
      // With a scoped stop to offer, Scope comes first; otherwise there is one thing to stop, so Review.
      const first = scope?.state === 'ok' && servesCompany(p.connection, scope.companyId) === true
        ? { key: p.key, step: 'scope', choice: 'stop' } : { key: p.key, step: 'review', choice: 'account' };
      return <button type="button" className={BTN.ghost} data-testid={testid} aria-expanded={open} onClick={() => setConfirm(open ? null : first)}>Disconnect</button>;
    }
    if (row.action === 'connect') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: openingView(p) })}>Connect</button>;
    return null;
  };

  return frame(
    <ActionSheet eyebrow="Build" title="Connect a tool" sub="Connected tools fill your modules with real data. Each one says what it feeds." onClose={onClose} testId="connect-tool-sheet">
      {/* The rows keep the side sheet's own insets. */}
      <div className="-mx-5 -my-4">
      {data.status === 'unreadable' && <div className="mx-5 mt-4"><Unreadable what="The tools" claim="This is not a claim that none is connected." onRetry={data.reload} /></div>}
      {preview && (
        <Banner tone="warn" data-testid="connect-tool-preview">
          {`⚠ Super Admin preview of ${project && typeof project === 'object' && typeof project.founder?.name === 'string' && project.founder.name.trim() ? `${project.founder.name.trim()}’s` : 'the founder’s'} view. The tools listed are your own connections, and anything you do here, linking included, is written as you${actor ? `, ${actor}` : ''}.`}
        </Banner>
      )}
      {companyNote && <Banner tone="warn" data-testid={`connect-tool-company-${scope.state}`}>{companyNote}</Banner>}
      {owner && (
        <div className="mx-5 mt-3 flex flex-wrap items-center gap-2" data-testid={`connect-tool-link-${owner.canLink ? 'owner' : 'member'}`}>
          <p className="m-0 min-w-0 flex-1 text-[12.5px] text-axal-ink/80 dark:text-gray-300">{linkPrompt(owner, ventureName)}</p>
          {owner.canLink
            ? <button type="button" className={BTN.primary} onClick={() => setLinking(true)} data-testid="connect-tool-link-company">Link to a company…</button>
            : <button type="button" className={BTN.ghost} onClick={copySetupLink} data-testid="connect-tool-copy-link">{copied ? 'Link copied' : 'Copy link to this setup'}</button>}
        </div>
      )}
      {linking && (
        <LinkCompanyDialog projectId={projectId} ventureName={ventureName} companies={data.companies} actor={preview ? (actor || 'the Super Admin') : null} onClose={() => setLinking(false)}
          onDone={() => { setLinking(false); onLinked?.(); }} />
      )}
      {banner && <Banner tone={banner.tone} data-testid={`connect-tool-${banner.view}`}>{banner.text}</Banner>}
      <div className="mx-5 mt-4 flex flex-col gap-2">
        <input type="search" aria-label="Search tools" placeholder="Search tools…" className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-1.5">
          {TOOL_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={f === filter} onClick={() => setFilter(f)}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${f === filter ? 'border-axal-violet/30 bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-ink/80 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
              {f}
            </button>
          ))}
          <span className="ml-auto font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="connect-tool-count">Sorted by category · {total ? `1–${total} of ${total}` : '0 of 0'}</span>
        </div>
      </div>
      {data.status === 'loading' && !data.catalogue.length && <div className="mx-5 mt-4" data-testid="connect-tool-loading"><p className="text-[13px] text-axal-muted dark:text-gray-400">Loading tools…</p><LoadingRows lines={4} /></div>}
      {data.status === 'ready' && !groups.length && <p className="mx-5 mt-4 text-[13px] text-axal-muted dark:text-gray-400">No tool matches.</p>}
      {groups.map((g) => (
        <Group key={g.label} label={g.label}>
          {g.rows.map((p) => {
            const row = toolRow(p, ctx);
            const ladder = scopeLadder(p, scope, projectId, ventureName);
            // The scoped stop is offered only while the tool serves this venture's company (Q1 option A).
            const scoped = scope?.state === 'ok' && servesCompany(p.connection, scope.companyId) === true;
            const note = rowNote[p.key];
            // A connected tool's name opens its detail; Disconnect is the row's action (D686 §3.1 item 2).
            const name = p.connection
              ? <button type="button" className="text-left font-semibold text-axal-ink hover:underline dark:text-gray-100" data-testid={`tool-name-${p.key}`} onClick={() => setPanel({ key: p.key, view: 'detail' })}>{p.display_name}</button>
              : p.display_name;
            return (
              <div key={p.key} data-testid={`tool-row-${p.key}`}>
                <Row icon={<BrandIcon provider={p.key} name={p.display_name} size={24} />} a={name} b={row.detail} tone={row.state === 'failing' ? 'danger' : undefined} pill={<Pill tone={row.pill[1]}>{row.pill[0]}</Pill>} action={action(p, row)} />
                {ladder && (
                  <dl className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 px-3 pb-2 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`tool-scope-${p.key}`}>
                    {ladder.map((l) => <div key={l.key} className="flex gap-1" data-testid={`tool-scope-${p.key}-${l.key}`}><dt className="font-semibold">{l.label}:</dt><dd className="m-0">{l.value}</dd></div>)}
                  </dl>
                )}
                {p.key === 'github' && ventureRead && ladder && <LastRead ventureRead={ventureRead} ventureName={ventureName} />}
                {confirm?.key === p.key && (
                  <StopSteps p={p} step={confirm.step} choice={confirm.choice} result={confirm.result} scoped={scoped} busy={busy === p.key}
                    scopeNote={scoped ? stopForCompanyNote(p, scope, data.companies) : null} accountNote={accountDisconnectNote(p, data.companies)}
                    review={disconnectReview(p, confirm.choice, facts())} companyName={scope?.name || 'this company'}
                    onChoose={(choice) => setConfirm({ key: p.key, step: 'scope', choice })}
                    onReview={() => setConfirm((c) => ({ ...c, step: 'review' }))}
                    onBack={() => (scoped ? setConfirm((c) => ({ ...c, step: 'scope' })) : setConfirm(null))}
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => (confirm.choice === 'stop' ? stopHere(p) : doDisconnect(p))} />
                )}
                {note && <p role={note.tone === 'danger' ? 'alert' : 'status'} className={`px-3 pb-2 text-[12px] ${note.tone === 'danger' ? 'text-red-700 dark:text-red-300' : note.tone === 'warn' ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`} data-testid={`tool-note-${p.key}`}>{note.text}</p>}
              </div>
            );
          })}
        </Group>
      ))}
      </div>
    </ActionSheet>,
  );
}

/**
 * D8774 part 3 (BLS07): Scope → Review → Result on one row. Scope picks what
 * to stop (radios, the scoped stop first, Q1 A); Review lists what stops, what
 * stays and who, with focus on its heading so the destructive button is never
 * focused first; Result is a polite status with the time it was done.
 */
function StopSteps({ p, step, choice, result, scoped, busy, scopeNote, accountNote, review, companyName, onChoose, onReview, onBack, onCancel, onConfirm }) {
  const heading = useRef(null);
  useEffect(() => { if (step !== 'scope') heading.current?.focus?.(); }, [step]);
  const wrap = 'flex flex-col gap-2 border-t border-axal-hairline bg-axal-ground px-3 py-2 dark:border-gray-800 dark:bg-gray-800';
  const tap = 'min-h-[44px] sm:min-h-0';
  if (step === 'result' && result) {
    return (
      <div className={wrap} data-testid={`tool-confirm-${p.key}`}>
        <div role="status" aria-live="polite" data-testid={`tool-result-${p.key}`}>
          <h3 ref={heading} tabIndex={-1} className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">✓ {result.title}</h3>
          <p className="m-0 text-[12px] text-axal-muted dark:text-gray-300">{result.detail}</p>
        </div>
        <div className="flex justify-end"><button type="button" className={`${BTN.ghost} ${tap}`} onClick={onCancel} data-testid={`tool-result-done-${p.key}`}>Back to Connect a tool</button></div>
      </div>
    );
  }
  if (step === 'scope') {
    const option = (value, title, note, testid) => (
      <label className={`flex items-start gap-2 rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 ${tap}`}>
        <input type="radio" name={`stop-${p.key}`} checked={choice === value} onChange={() => onChoose(value)} data-testid={testid} className="mt-0.5" />
        <span className="min-w-0"><b className="text-axal-ink dark:text-gray-100">{title}</b><span className="block text-axal-muted dark:text-gray-400">{note}</span></span>
      </label>
    );
    return (
      <div className={wrap} data-testid={`tool-confirm-${p.key}`}>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid={`tool-scope-step-${p.key}`}>
          <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">What do you want to stop?</legend>
          {scoped && <div data-testid={`tool-stop-${p.key}`}>{option('stop', `Stop using ${p.display_name} for ${companyName}`, scopeNote, `tool-choose-stop-${p.key}`)}</div>}
          <div data-testid={`tool-confirm-account-${p.key}`}>{option('account', `Disconnect ${p.display_name} from your account`, accountNote, `tool-choose-account-${p.key}`)}</div>
        </fieldset>
        <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Either way, items already in Build stay.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={`${BTN.ghost} ${tap}`} onClick={onCancel}>Cancel</button>
          <button type="button" className={`${BTN.primary} ${tap}`} onClick={onReview} data-testid={`tool-review-${p.key}`}>Review</button>
        </div>
      </div>
    );
  }
  return (
    <div className={wrap} data-testid={`tool-confirm-${p.key}`}>
      <h3 ref={heading} tabIndex={-1} className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid={`tool-review-title-${p.key}`}>{review.title}</h3>
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]" data-testid={`tool-review-rows-${p.key}`}>
        {review.rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="font-semibold text-axal-ink dark:text-gray-200">{k}</dt><dd className="m-0 text-axal-muted dark:text-gray-300">{v}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={`${BTN.ghost} ${tap}`} onClick={onBack} data-testid={`tool-review-back-${p.key}`}>{scoped ? 'Back' : 'Keep it'}</button>
        <button type="button" className={`${BTN.dangerSolid} ${tap}`} disabled={busy} onClick={onConfirm}
          data-testid={choice === 'stop' ? `tool-confirm-stop-${p.key}` : `tool-confirm-disconnect-${p.key}`}>
          {busy ? (choice === 'stop' ? 'Stopping…' : 'Disconnecting…') : review.button}
        </button>
      </div>
    </div>
  );
}

/** D8774 part 3 (BLS04, BLS05, BLS10): the GitHub row's last successful read of this venture, or why it is not said. */
function LastRead({ ventureRead, ventureName }) {
  const { tools, retry } = ventureRead;
  if (tools === undefined) return <p className="m-0 px-3 pb-2 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="tool-last-read-github">Reading the last successful read…</p>;
  if (tools === null) {
    return (
      <p className="m-0 flex flex-wrap items-center gap-2 px-3 pb-2 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="tool-last-read-github">
        <span>Last successful read: Unreadable. The sync history could not be read; this is not a claim that none happened.</span>
        <button type="button" className="font-semibold text-axal-violet underline dark:text-violet-300" onClick={retry} data-testid="tool-last-read-retry">Try again</button>
      </p>
    );
  }
  const read = rowLastRead(tools, ventureName);
  if (!read) return null;
  return (
    <p className="m-0 px-3 pb-2 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="tool-last-read-github">
      {read.text}{read.stale && <> · <span className="font-semibold text-amber-800 dark:text-amber-300">◷ {read.stale}</span></>}
    </p>
  );
}
