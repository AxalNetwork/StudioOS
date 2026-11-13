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
  TOOL_FILTERS, companiesWith, companyBanner, disconnectNote, projectCompany, retryOutcome, servesCompany, toolBanner, toolDeepLink, toolGroups, toolRow,
} from './connectorsModel';

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
 */

// D703 (#1665): `asPage` is the cycle route's page mode below 1024px. Share an update's nested Connect a tool passes none, so it stays a dialog.
export default function ConnectToolSheet({ projectId = null, onClose, onChanged, asPage }) {
  // The project's company: undefined while read, null when it could not be.
  const [project, setProject] = useState(projectId ? undefined : null);
  useEffect(() => {
    if (!projectId) return undefined;
    let live = true;
    api.getProject(projectId).then((r) => { if (live) setProject(r || null); }, () => { if (live) setProject(null); });
    return () => { live = false; };
  }, [projectId]);
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
    if (!link?.strip?.length) return;
    setSearchParams((old) => { const next = new URLSearchParams(old); for (const k of link.strip) next.delete(k); return next; }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <ConnectToolView data={{ ...data, reload }} project={projectId ? project : false} projectId={projectId} onClose={onClose} deepLink={`?${deepSearch}`} asPage={asPage} />;
}

/**
 * The sheet, drawn from one `useConnectors()` read; exported so a test can
 * hand it each state. `project` is `GET /projects/:id` (undefined while read,
 * null when unreadable, false when the sheet has no project).
 */
export function ConnectToolView({ data, onClose, project = false, projectId = null, deepLink = '', asPage }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');
  const [panel, setPanel] = useState(null); // { key, view }
  // Per row: an inline Disconnect confirm, and Try again's answer.
  const [confirm, setConfirm] = useState(null);
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
  const doDisconnect = async (p) => {
    setBusy(p.key);
    try { await disconnect(p); setConfirm(null); data.reload(); }
    catch (e) { setRowNote((n) => ({ ...n, [p.key]: { tone: 'danger', text: e?.message || 'The tool could not be disconnected.' } })); }
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
    if (rowNote[p.key]?.reconnect || row.action === 'reconnect') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: 'pre' })}>Reconnect</button>;
    if (row.action === 'upgrade') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: 'pro' })}>{row.actionLabel}</button>;
    if (row.action === 'retry') return <button type="button" className={BTN.primary} data-testid={testid} disabled={busy === p.key} onClick={() => retry(p)}>{busy === p.key ? 'Trying…' : row.actionLabel}</button>;
    if (row.action === 'disconnect') return <button type="button" className={BTN.ghost} data-testid={testid} aria-expanded={confirm === p.key} onClick={() => setConfirm(confirm === p.key ? null : p.key)}>Disconnect</button>;
    if (row.action === 'connect') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: openingView(p) })}>Connect</button>;
    return null;
  };

  return frame(
    <ActionSheet eyebrow="Build" title="Connect a tool" sub="Connected tools fill your modules with real data. Each one says what it feeds." onClose={onClose} testId="connect-tool-sheet">
      {/* The rows keep the side sheet's own insets. */}
      <div className="-mx-5 -my-4">
      {data.status === 'unreadable' && <div className="mx-5 mt-4"><Unreadable what="The tools" claim="This is not a claim that none is connected." onRetry={data.reload} /></div>}
      {companyNote && <Banner tone="warn" data-testid={`connect-tool-company-${scope.state}`}>{companyNote}</Banner>}
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
            const row = toolRow(p);
            const note = rowNote[p.key];
            // A connected tool's name opens its detail; Disconnect is the row's action (D686 §3.1 item 2).
            const name = p.connection
              ? <button type="button" className="text-left font-semibold text-axal-ink hover:underline dark:text-gray-100" data-testid={`tool-name-${p.key}`} onClick={() => setPanel({ key: p.key, view: 'detail' })}>{p.display_name}</button>
              : p.display_name;
            return (
              <div key={p.key} data-testid={`tool-row-${p.key}`}>
                <Row icon={<BrandIcon provider={p.key} name={p.display_name} size={24} />} a={name} b={row.detail} tone={row.state === 'failing' ? 'danger' : undefined} pill={<Pill tone={row.pill[1]}>{row.pill[0]}</Pill>} action={action(p, row)} />
                {confirm === p.key && (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline bg-axal-ground px-3 py-2 dark:border-gray-800 dark:bg-gray-800" data-testid={`tool-confirm-${p.key}`}>
                    <span className="mr-auto text-[12px] text-axal-muted dark:text-gray-300">{`Disconnect ${p.display_name}? ${disconnectNote(p)}`}</span>
                    <button type="button" className={BTN.ghost} onClick={() => setConfirm(null)}>Keep it</button>
                    <button type="button" className={BTN.dangerSolid} disabled={busy === p.key} onClick={() => doDisconnect(p)} data-testid={`tool-confirm-disconnect-${p.key}`}>{busy === p.key ? 'Disconnecting…' : 'Disconnect'}</button>
                  </div>
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
