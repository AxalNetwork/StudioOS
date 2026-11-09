import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminGovernanceApi } from '../../../lib/api/adminGovernance';
import { reportError } from '../../../lib/log';
import { governanceLifecycle } from '../../../lib/contractLifecycle';
import { LifecycleBadge } from './LifecycleBadge';
import PdfPages from './PdfPages';
import { useRead, ReadState, Missing, button, card, date } from './parts';
import { dayLabel, fileKind, fileSize, statusLabel } from './governanceModel';

/**
 * D4811 (#4811) part 5 — one governance record's workspace (board CT-07), at
 * `/admin/contracts/governance/doc/:uid`: Overview · Document · Versions ·
 * Legal Review · Activity · Related, the tab in `?tab=`. Read-only: changes
 * still go through the record's side panel ("Edit in panel"), which keeps
 * every D4563 rule. A confidential record answers 404 to anyone but the
 * Super Admin, and the page says it is not available. Legal Review and
 * Related say Not recorded and why: neither store exists yet.
 */
export const WORKSPACE_TABS = Object.freeze([
  ['overview', 'Overview'], ['document', 'Document'], ['versions', 'Versions'],
  ['legal-review', 'Legal Review'], ['activity', 'Activity'], ['related', 'Related'],
]);

/** The markers a version carries (CT-91 VersionList): In force, Latest, Signed copy. */
export function versionMarkers(document, version, latestVersion) {
  const out = [];
  if (document?.executed_version === version.version) out.push('In force');
  if (version.version === latestVersion) out.push('Latest');
  if (version.signed) out.push('Signed copy');
  return out;
}
export const shortHash = (h) => (typeof h === 'string' && h.length >= 8 ? `sha ${h.slice(0, 4)}…${h.slice(-4)}` : null);

/** The executed evidence in words: the signed copy, the completed envelope, or why there is none. */
export function executedLine(d) {
  if (d?.status !== 'executed') return null;
  if (d.executed_version != null) return `v${d.executed_version} · signed copy`;
  if (d.envelope_id != null) return `Completed envelope #${d.envelope_id}`;
  return null;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function GovernanceWorkspace({ uid, categories = [], entities = [], onEdit }) {
  const [params, setParams] = useSearchParams();
  const tab = WORKSPACE_TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const read = useRead(() => adminGovernanceApi.read(uid), [uid]);
  const d = read.data?.document;
  const versions = read.data?.versions || [];
  const entity = entities.find((e) => e.key === d?.entity_key);
  const category = categories.find((c) => c.key === d?.category)?.label;
  const badge = d ? governanceLifecycle(d.status) : null;
  const go = (key) => { const next = new URLSearchParams(params); if (key === 'overview') next.delete('tab'); else next.set('tab', key); setParams(next); };
  return <section aria-label="Governance record" className="space-y-4" data-testid="governance-workspace">
    <nav aria-label="Breadcrumb" className="text-[11px] font-bold uppercase tracking-widest text-axal-faint">
      <Link to="/admin/contracts">Contracts</Link> › <Link to="/admin/contracts/governance">Corporate Governance</Link>
      {entity && <> › <Link to={`/admin/contracts/governance?entity=${entity.key}`}>{entity.name}</Link></>}</nav>
    <ReadState read={read} what="This governance record">{d && <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded border border-axal-hairline px-1 font-bold uppercase tracking-wider">Governance</span>
            {badge ? <LifecycleBadge badge={badge} /> : <span className="text-axal-muted">{statusLabel(d.status)}</span>}
            {d.confidential && <span className="rounded-full border border-[#18181b] px-2 py-0.5 font-semibold dark:border-gray-200"><span aria-hidden="true">🔒 </span>Confidential · Super Admin only</span>}
          </div>
          <h3 className="text-xl font-bold">{d.title}</h3>
          <p className="text-[12.5px] text-axal-muted">{[category, entity?.name].filter(Boolean).join(' · ') || 'Category and entity not recorded'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {versions[0] && <DownloadButton uid={uid} version={versions[0]} label={`Download v${versions[0].version}`} />}
          <button type="button" className={`${button} min-h-[44px] md:min-h-0`} onClick={onEdit}>Edit in panel</button>
        </div>
      </header>
      <div role="tablist" aria-label="Record workspace" className="flex gap-1 overflow-x-auto border-b border-axal-hairline">
        {WORKSPACE_TABS.map(([key, label]) => <button key={key} type="button" role="tab" id={`gw-tab-${key}`} aria-selected={tab === key} aria-controls={`gw-panel-${key}`}
          className={`min-h-[44px] whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === key ? 'border-violet-600 text-axal-ink dark:text-white' : 'border-transparent text-axal-muted'}`}
          onClick={() => go(key)}>{label}{key === 'versions' && <span className="ml-1 font-mono text-[11px] text-axal-muted">{versions.length}</span>}</button>)}
      </div>
      <div role="tabpanel" id={`gw-panel-${tab}`} aria-labelledby={`gw-tab-${tab}`} data-testid={`governance-workspace-${tab}`}>
        {tab === 'overview' && <Overview d={d} versions={versions} entity={entity} category={category} />}
        {tab === 'document' && <DocumentTab uid={uid} d={d} versions={versions} />}
        {tab === 'versions' && <VersionsTab uid={uid} d={d} versions={versions} />}
        {tab === 'legal-review' && <div className={`${card} p-4 text-[12.5px]`}><Missing reason="The legal-review record (reviewer, type, jurisdiction, version reviewed, findings, sources, decision) is not built yet. It waits on who records counsel approval (D4811 question C). A record's review state is its In review status for now." /></div>}
        {tab === 'activity' && <ActivityTab uid={uid} />}
        {tab === 'related' && <div className={`${card} p-4 text-[12.5px]`}><Missing reason="Links between documents (governs, depends on) are not recorded yet, so no related document or change warning can be shown. Nothing is guessed from titles." /></div>}
      </div>
    </>}</ReadState>
  </section>;
}

function Overview({ d, versions, entity, category }) {
  const latest = versions[0];
  const rows = [
    ['Entity', entity?.name || null, 'Not one of the three entities.'],
    ['Document type', category || null, 'Category not recorded.'],
    ['Lifecycle state', statusLabel(d.status), null],
    ['Safety state', d.confidential ? 'Confidential: the Super Admin alone can open it' : 'Not confidential', null],
    ['Effective date', dayLabel(d.effective_date), 'No effective date was entered.'],
    ['Latest version', latest ? `v${latest.version} · ${date(latest.created_at) || 'upload date not recorded'}` : null, 'No file uploaded yet.'],
    ['Executed version', executedLine(d), d.status === 'executed' ? 'Executed, but neither evidence field is set.' : 'Not executed.'],
    ['Last review', null, 'The legal-review record is not built yet (D4811 question C).'],
    ['Reviewer', null, 'The legal-review record is not built yet (D4811 question C).'],
    ['Linked template', d.template_slug || null, 'No template linked.'],
    ['Linked envelope', d.envelope_id != null ? `#${d.envelope_id}` : null, 'No envelope linked.'],
  ];
  return <dl className={`${card} grid gap-x-4 gap-y-2 p-4 text-[12.5px] sm:grid-cols-[200px_minmax(0,1fr)]`}>
    {rows.map(([k, v, reason]) => <React.Fragment key={k}><dt className="text-axal-muted">{k}</dt><dd className="font-semibold">{v ?? <Missing reason={reason} />}</dd></React.Fragment>)}
  </dl>;
}

function DownloadButton({ uid, version, label }) {
  const [error, setError] = useState('');
  async function download() {
    setError('');
    try { const f = await adminGovernanceApi.file(uid, version.version, { download: true }); saveBlob(f.blob, f.filename); }
    catch (e) { reportError('governance:workspace-download', e); setError(e?.message || 'The file could not be downloaded.'); }
  }
  return <span className="inline-flex flex-col"><button type="button" className={`${button} min-h-[44px] md:min-h-0`} aria-label={`${label} of this record`} onClick={download}>{label}</button>
    {error && <span role="alert" className="text-[11px] text-red-700 dark:text-red-300">{error}</span>}</span>;
}

function DocumentTab({ uid, d, versions }) {
  const [pick, setPick] = useState(versions[0]?.version ?? null);
  const v = versions.find((x) => x.version === pick);
  const file = useRead(() => (v && v.content_type === 'application/pdf' ? adminGovernanceApi.file(uid, v.version) : Promise.resolve(null)), [uid, pick]);
  if (!versions.length) return <div className={`${card} p-4 text-[12.5px]`}><Missing reason="No file has been uploaded for this record yet." /></div>;
  return <div className="space-y-3">
    <label className="flex flex-wrap items-center gap-2 text-[12.5px]">Version
      <select className="rounded-lg border border-axal-hairline bg-white px-2 py-1 dark:bg-gray-900" value={pick ?? ''} onChange={(e) => setPick(Number(e.target.value))}>
        {versions.map((x) => <option key={x.version} value={x.version}>v{x.version}{x.signed ? ' · signed copy' : ''}{d.executed_version === x.version ? ' · in force' : ''}</option>)}</select>
      {v && <DownloadButton uid={uid} version={v} label={`Download v${v.version}`} />}</label>
    {v && v.content_type !== 'application/pdf'
      ? <p className="text-[12.5px] text-axal-muted">v{v.version} is a Word file; it cannot be previewed here. Download it to read it.</p>
      : <ReadState read={file} what="The file">{file.data && <PdfPages blob={file.data.blob} title={`${d.title} v${pick}`} />}</ReadState>}
  </div>;
}

function VersionsTab({ uid, d, versions }) {
  if (!versions.length) return <div className={`${card} p-4 text-[12.5px]`}><Missing reason="No file has been uploaded for this record yet." /></div>;
  const latest = versions[0].version;
  return <ol className={`${card} divide-y divide-axal-hairline`} aria-label="Versions, newest first">
    {versions.map((v) => <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[12.5px]">
      <span className="min-w-0"><span className="block font-semibold">v{v.version}
        {versionMarkers(d, v, latest).map((m) => <span key={m} className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] ${m === 'In force' ? 'border-[#18181b] bg-[#18181b] text-white dark:border-white dark:bg-white dark:text-[#18181b]' : 'border-axal-hairline'}`}>{m}</span>)}</span>
        <span className="block font-mono text-[11px] text-axal-muted">{[fileKind(v.content_type), fileSize(v.file_bytes), shortHash(v.file_sha256), date(v.created_at) || 'upload date not recorded'].filter(Boolean).join(' · ')}</span>
        {v.note && <span className="block text-[11px] text-axal-muted">{v.note}</span>}</span>
      <DownloadButton uid={uid} version={v} label={`Download v${v.version}`} />
    </li>)}
  </ol>;
}

function ActivityTab({ uid }) {
  const read = useRead(() => adminGovernanceApi.activity(uid), [uid]);
  return <ReadState read={read} what="The activity">{read.data && (read.data.events.length === 0
    ? <div className={`${card} p-4 text-[12.5px]`}><Missing reason="No action on this record has been recorded." /></div>
    : <ol className={`${card} divide-y divide-axal-hairline`} aria-label="Activity, newest first">{read.data.events.map((e, i) => <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-[12.5px]">
      <span>{e.line}</span>
      <span className="font-mono text-[11px] text-axal-muted">{e.actor || 'Actor not recorded'} · {date(e.at) || 'time not recorded'}</span></li>)}</ol>)}
  </ReadState>;
}
