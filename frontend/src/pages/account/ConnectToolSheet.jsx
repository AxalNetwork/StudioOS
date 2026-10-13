import { useState } from 'react';
import { Pill, Unreadable } from '../../ui';
import { BTN, INPUT, LoadingRows } from './AccountCenter';
import { connectorsApi } from '../../lib/api/connectors';
import { Banner, ConnectorPanel, Group, Row, Sheet, disconnect, openingView, useConnectors } from './ConnectorSheet';
import { TOOL_FILTERS, disconnectNote, retryOutcome, toolBanner, toolGroups, toolRow } from './connectorsModel';

/**
 * D651 (#1463) — Build's "Connect a tool", drawn to `Cycle Action.dc.html`'s
 * `connect` action (`list`, `failed`, `locked`, `loading`, `refused`,
 * `success`). It reads the same catalogue as the Connectors page and opens the
 * same panel, so a tool connected here is a connector there.
 *
 * `refused` and `success` are the panel's own `refused` and `connected` views.
 * A provider's sign-in still returns to `/integrations`, which lands on the
 * Connectors page; the Worker's callback chooses that address (D651).
 *
 * The canvas's `sync` view (choosing GitHub repositories) is not built here
 * yet. Its routes (`/:uid/repositories`, D655) are on main; GitHub is listed
 * as the Worker reports it meanwhile.
 */

export default function ConnectToolSheet({ onClose }) {
  const data = useConnectors();
  return <ConnectToolView data={data} onClose={onClose} />;
}

/** The sheet, drawn from one `useConnectors()` read; exported so a test can hand it each state. */
export function ConnectToolView({ data, onClose }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');
  const [panel, setPanel] = useState(null); // { key, view }
  // Per row: an inline Disconnect confirm, and Try again's answer.
  const [confirm, setConfirm] = useState(null);
  const [rowNote, setRowNote] = useState({});
  const [busy, setBusy] = useState(null);
  const banner = toolBanner(data.catalogue);
  // While the failed banner shows, the failing tool's group is drawn first.
  const pin = banner?.view === 'failed' ? (data.catalogue.find((p) => p.key === banner.key)?.category || 'Other') : null;
  const { groups, total } = toolGroups(data.catalogue, { q, filter, pin });
  const panelP = panel && data.catalogue.find((p) => p.key === panel.key);

  if (panelP) {
    return (
      <ConnectorPanel
        key={`${panel.key}:${panelP.connection ? 'c' : 'n'}`}
        eyebrow="Build"
        p={panelP}
        view={panel.view}
        setView={(view) => setPanel((s) => ({ ...s, view }))}
        onChanged={data.reload}
        onClose={() => setPanel(null)}
        back={() => setPanel(null)}
      />
    );
  }

  const retry = async (p) => {
    setBusy(p.key);
    let out;
    try { await connectorsApi.sync(p.connection.uid); out = retryOutcome(null); } catch (e) { out = retryOutcome(e); }
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

  const action = (p, row) => {
    const testid = `tool-action-${p.key}`;
    if (rowNote[p.key]?.reconnect || row.action === 'reconnect') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: 'pre' })}>Reconnect</button>;
    if (row.action === 'upgrade') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: 'pro' })}>{row.actionLabel}</button>;
    if (row.action === 'retry') return <button type="button" className={BTN.primary} data-testid={testid} disabled={busy === p.key} onClick={() => retry(p)}>{busy === p.key ? 'Trying…' : row.actionLabel}</button>;
    if (row.action === 'disconnect') return <button type="button" className={BTN.ghost} data-testid={testid} aria-expanded={confirm === p.key} onClick={() => setConfirm(confirm === p.key ? null : p.key)}>Disconnect</button>;
    if (row.action === 'connect') return <button type="button" className={BTN.primary} data-testid={testid} onClick={() => setPanel({ key: p.key, view: openingView(p) })}>Connect</button>;
    return null;
  };

  return (
    <Sheet eyebrow="Build" title="Connect a tool" sub="Connected tools fill your modules with real data. Each one says what it feeds." onClose={onClose} data-testid="connect-tool-sheet">
      {data.status === 'unreadable' && <div className="mx-5 mt-4"><Unreadable what="The tools" claim="This is not a claim that none is connected." onRetry={data.reload} /></div>}
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
                <Row a={name} b={row.detail} tone={row.state === 'failing' ? 'danger' : undefined} pill={<Pill tone={row.pill[1]}>{row.pill[0]}</Pill>} action={action(p, row)} />
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
    </Sheet>
  );
}
