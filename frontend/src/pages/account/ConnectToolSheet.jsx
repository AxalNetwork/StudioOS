import { useState } from 'react';
import { Pill, Unreadable } from '../../ui';
import { BTN, INPUT, LoadingRows } from './AccountCenter';
import { Banner, ConnectorPanel, Group, Row, Sheet, openingView, useConnectors } from './ConnectorSheet';
import { TIER_LABEL, TOOL_FILTERS, attentionReason, feedsLabel, lastSyncLabel, toolBanner, toolGroups, toolState } from './connectorsModel';

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

const STATE = {
  connected: ['Connected', 'ok'],
  failing: ['Failing', 'danger'],
  not_connected: ['Not connected', 'neutral'],
  soon: ['Coming soon', 'neutral'],
  unavailable: ['Not set up here', 'neutral'],
};

export default function ConnectToolSheet({ onClose }) {
  const data = useConnectors();
  return <ConnectToolView data={data} onClose={onClose} />;
}

/** The sheet, drawn from one `useConnectors()` read; exported so a test can hand it each state. */
export function ConnectToolView({ data, onClose }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');
  const [panel, setPanel] = useState(null); // { key, view }
  const { groups, total } = toolGroups(data.catalogue, { q, filter });
  const banner = toolBanner(data.catalogue);
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

  const action = (p) => {
    const s = toolState(p);
    if (p.locked && !p.connection && p.available) return <button type="button" className={BTN.primary} onClick={() => setPanel({ key: p.key, view: 'pro' })}>Upgrade</button>;
    if (s === 'connected') return <button type="button" className={BTN.ghost} onClick={() => setPanel({ key: p.key, view: 'detail' })}>Manage</button>;
    if (s === 'failing') return <button type="button" className={BTN.primary} onClick={() => setPanel({ key: p.key, view: 'pre' })}>Reconnect</button>;
    if (s === 'not_connected') return <button type="button" className={BTN.primary} onClick={() => setPanel({ key: p.key, view: openingView(p) })}>Connect</button>;
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
            const s = toolState(p);
            const [label, tone] = p.locked && !p.connection && p.available ? [TIER_LABEL[p.tier] || 'Paid plan', 'info']
              : s === 'unavailable' && p.unreadable ? ['Status unreadable', 'neutral'] : STATE[s];
            const feeds = feedsLabel(p);
            const detail = s === 'failing'
              ? `${attentionReason(p.connection)} · last good sync ${lastSyncLabel(p.connection)}`
              : `${feeds ? `Feeds ${feeds}` : (p.capabilities || []).slice(0, 2).join(', ')}${p.connection ? (p.connection.last_synced_at ? ` · synced ${lastSyncLabel(p.connection)}` : ' · last sync not recorded') : ''}`;
            return <Row key={p.key} a={p.display_name} b={detail} tone={s === 'failing' ? 'danger' : undefined} pill={<Pill tone={tone}>{label}</Pill>} action={action(p)} />;
          })}
        </Group>
      ))}
    </Sheet>
  );
}
