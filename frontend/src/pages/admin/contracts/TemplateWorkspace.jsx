import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { templateActions, templateLifecycle } from '../../../lib/contractLifecycle';
import { LifecycleBadge, SafetyOverlayBadge } from './LifecycleBadge';
import PdfPages from './PdfPages';
import { useRead, ReadState, Missing, button, card, date } from './parts';

/**
 * D4811 (#4811) part 10 — one template's workspace (board CT-07 for a
 * template; CT-09/CT-10 overlays), at `/admin/contracts/templates/doc/:slug`:
 * Overview · Document · Versions · Legal Review · Activity · Related, the tab
 * in `?tab=`. Read-only: edits stay in the template editor ("Edit in
 * editor"), which keeps every D711/D717 rule. Reads only what the Worker
 * already serves: the library row (`GET /templates/store?recorded=true`, the
 * same read as the Templates tab: safety, publication, usage), `…/versions`
 * and `…/preview.pdf`. What no store holds says Not recorded and why.
 */
export const TEMPLATE_TABS = Object.freeze([
  ['overview', 'Overview'], ['document', 'Document'], ['versions', 'Versions'],
  ['legal-review', 'Legal Review'], ['activity', 'Activity'], ['related', 'Related'],
]);

/** The version rows, newest first: the current text, then each saved earlier text. */
export function versionRows(read) {
  const cur = read?.current;
  if (!cur) return [];
  const rows = [{ version: Number(cur.version), at: cur.updated_at ?? null, by: cur.updated_by ?? null, current: true }];
  for (const v of read.versions || []) {
    if (Number(v.version) === Number(cur.version)) continue;
    rows.push({ version: Number(v.version), at: v.created_at ?? null, by: v.created_by ?? null, current: false });
  }
  return rows.sort((a, b) => b.version - a.version);
}

/** A version's markers: Current, Published (the recorded publication), Superseded (older than it). */
export function templateVersionMarkers(row, publishedVersion) {
  const out = [];
  if (row.current) out.push('Current');
  if (Number.isInteger(publishedVersion) && row.version === publishedVersion) out.push('Published');
  else if (Number.isInteger(publishedVersion) && row.version < publishedVersion) out.push('Superseded');
  return out;
}

/** "Saved v3 · Admin #4" — who and when a version was saved, or why it is unknown. */
export function savedLine(row) {
  const who = row.by != null ? `Admin #${row.by}` : 'saver not recorded';
  return `Saved v${row.version} · ${who}`;
}

/** The library row for a slug, from the list read; null when the slug is not (or no longer) in the library. */
export function templateRow(data, slug) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.find((r) => r?.slug === slug) || null;
}

/** "3 agreements made from it" — the recorded usage, or why it is unknown. */
export function usageLine(t) {
  const n = Number(t?.usage_count);
  if (!Number.isInteger(n) || n < 0) return null;
  return `${n} ${n === 1 ? 'agreement' : 'agreements'} made from it`;
}

const editorPath = (slug) => `/admin/contracts?tab=templates&open=${encodeURIComponent(slug)}`;

export default function TemplateWorkspace({ slug }) {
  const [params, setParams] = useSearchParams();
  const tab = TEMPLATE_TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const read = useRead(() => contractsApi.templates(), [slug]);
  const versions = useRead(() => api.adminTemplateStoreVersions(slug), [slug]);
  const t = templateRow(read.data, slug);
  const go = (key) => { const next = new URLSearchParams(params); if (key === 'overview') next.delete('tab'); else next.set('tab', key); setParams(next); };
  const badge = t ? templateLifecycle(t) : null;
  const actions = t ? templateActions(t) : null;
  return <section aria-label="Template" className="space-y-4" data-testid="template-workspace">
    <nav aria-label="Breadcrumb" className="text-[11px] font-bold uppercase tracking-widest text-axal-faint">
      <Link to="/admin/contracts">Contracts</Link> › <Link to="/admin/contracts?tab=templates">Templates</Link>
      {t && <> › {t.layer_label || t.category || 'Layer not recorded'}</>}</nav>
    <ReadState read={read} what="This template">{read.data && !t && <div className={`${card} p-4 text-[12.5px]`} role="status">This template is not in the library: it may have been archived or removed. <Link className="underline" to="/admin/contracts?tab=templates">Open Templates</Link></div>}
    {t && <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded border border-dashed border-axal-hairline px-1 font-bold uppercase tracking-wider">Template</span>
            {badge && <LifecycleBadge badge={badge} />}
            {actions.overlays.map((k) => <SafetyOverlayBadge key={k} kind={k} />)}
          </div>
          <h3 className="text-xl font-bold">{t.title}</h3>
          <p className="font-mono text-[12px] text-axal-muted">{t.slug} · v{t.version}</p>
        </div>
        <Link className={`${button} min-h-[44px] md:min-h-0`} to={editorPath(t.slug)}>Edit in editor</Link>
      </header>
      {actions.banner && <div role="note" data-testid="template-workspace-banner" className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] p-3 text-[12.5px] text-[#92400e] dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <b>{actions.banner.title}</b> {actions.banner.reason} {actions.unavailable.length > 0 && <>Not available: {actions.unavailable.join(', ')}.</>}</div>}
      <div role="tablist" aria-label="Template workspace" className="flex gap-1 overflow-x-auto border-b border-axal-hairline">
        {TEMPLATE_TABS.map(([key, label]) => <button key={key} type="button" role="tab" id={`tw-tab-${key}`} aria-selected={tab === key} aria-controls={`tw-panel-${key}`}
          className={`min-h-[44px] whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === key ? 'border-violet-600 text-axal-ink dark:text-white' : 'border-transparent text-axal-muted'}`}
          onClick={() => go(key)}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`tw-panel-${tab}`} aria-labelledby={`tw-tab-${tab}`} data-testid={`template-workspace-${tab}`}>
        {tab === 'overview' && <Overview t={t} badge={badge} actions={actions} />}
        {tab === 'document' && <DocumentTab t={t} />}
        {tab === 'versions' && <VersionsTab t={t} read={versions} />}
        {tab === 'legal-review' && <div className={`${card} p-4 text-[12.5px]`}><Missing reason="The legal-review record (reviewer, type, jurisdiction, version reviewed, findings, sources, decision) is not built yet. It waits on who records counsel approval (D4811 question C). Restricted means counsel has not reviewed this template’s text." /></div>}
        {tab === 'activity' && <ActivityTab read={versions} />}
        {tab === 'related' && <RelatedTab t={t} />}
      </div>
    </>}</ReadState>
  </section>;
}

function Overview({ t, badge, actions }) {
  const fields = Array.isArray(t.merge_fields) ? t.merge_fields : null;
  const rows = [
    ['Layer', t.layer_label || t.category || null, 'Layer not recorded.'],
    ['Lifecycle state', badge?.label || null, 'State not recorded.'],
    ['Safety state', actions.overlays.length ? actions.overlays.map((k) => (k === 'restricted' ? 'Restricted' : 'Incomplete')).join(' · ') : 'Neither restricted nor incomplete', null],
    ['Current version', `v${t.version}`, null],
    ['Published version', Number.isInteger(t.published_version) ? `v${t.published_version}` : null, 'Not published.'],
    ['Merge fields', fields ? String(fields.length) : null, 'The merge fields could not be read.'],
    ['Last edited', date(t.updated_at) || null, 'Not recorded.'],
    ['Used by', usageLine(t), 'The usage count was not returned.'],
    ['Last review', null, 'The legal-review record is not built yet (D4811 question C).'],
  ];
  return <dl className={`${card} grid gap-x-4 gap-y-2 p-4 text-[12.5px] sm:grid-cols-[200px_minmax(0,1fr)]`}>
    {rows.map(([k, v, reason]) => <React.Fragment key={k}><dt className="text-axal-muted">{k}</dt><dd className="font-semibold">{v ?? <Missing reason={reason} />}</dd></React.Fragment>)}
  </dl>;
}

function RelatedTab({ t }) {
  const line = usageLine(t);
  return <div className={`${card} space-y-2 p-4 text-[12.5px]`}>
    <p><b>Agreements:</b> {line ? <>{line}. {Number(t.usage_count) > 0 && <Link className="underline" to={`/admin/contracts?template=${encodeURIComponent(t.slug)}`}>Open them in Agreements</Link>}</> : <Missing reason="The usage count was not returned." />}</p>
    <p><b>Governance records:</b> <Missing reason="Which governance records govern this template is recorded on each record's Related tab (D4811 part 8); it is not listed here yet." /></p>
  </div>;
}

function DocumentTab({ t }) {
  const [error, setError] = useState('');
  const file = useRead(() => api.adminTemplateStorePreviewPdfBlob(t.slug), [t.slug, t.version]);
  async function download() {
    setError('');
    try {
      const f = file.data || await api.adminTemplateStorePreviewPdfBlob(t.slug);
      const a = document.createElement('a'); a.href = f.url; a.download = f.filename; a.click();
    } catch (e) { reportError('contracts:template-workspace-download', e); setError(e?.message || 'The PDF could not be downloaded.'); }
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="text-axal-muted">v{t.version}, merge fields shown in brackets.</span>
      <button type="button" className={`${button} min-h-[44px] md:min-h-0`} onClick={download}>Download PDF</button>
      {error && <span role="alert" className="text-[11px] text-red-700 dark:text-red-300">{error}</span>}
    </div>
    <ReadState read={file} what="The preview">{file.data && <PdfPages blob={file.data.blob} renderer={file.data.renderer} title={`${t.title} v${t.version}`} />}</ReadState>
  </div>;
}

function VersionsTab({ t, read }) {
  return <ReadState read={read} what="The versions">{read.data && (() => {
    const rows = versionRows(read.data);
    if (!rows.length) return <div className={`${card} p-4 text-[12.5px]`}><Missing reason="No version is recorded for this template." /></div>;
    return <ol className={`${card} divide-y divide-axal-hairline`} aria-label="Versions, newest first">
      {rows.map((r) => <li key={r.version} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[12.5px]">
        <span className="font-semibold">v{r.version}
          {templateVersionMarkers(r, t.published_version).map((m) => <span key={m} className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] ${m === 'Published' ? 'border-dashed border-violet-600 text-violet-700 dark:text-violet-300' : 'border-axal-hairline'}`}>{m}</span>)}</span>
        <span className="font-mono text-[11px] text-axal-muted">{date(r.at) || 'date not recorded'}</span>
      </li>)}
    </ol>;
  })()}</ReadState>;
}

function ActivityTab({ read }) {
  return <ReadState read={read} what="The activity">{read.data && (() => {
    const rows = versionRows(read.data);
    return <div className="space-y-2">
      {rows.length === 0 ? <div className={`${card} p-4 text-[12.5px]`}><Missing reason="No save is recorded for this template." /></div>
        : <ol className={`${card} divide-y divide-axal-hairline`} aria-label="Saves, newest first">{rows.map((r) => <li key={r.version} className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-[12.5px]">
          <span>{savedLine(r)}</span><span className="font-mono text-[11px] text-axal-muted">{date(r.at) || 'time not recorded'}</span></li>)}</ol>}
      <p className="text-[11px] text-axal-muted">Only saves are recorded per template. Publish, withdraw and preview events are not listed here.</p>
    </div>;
  })()}</ReadState>;
}
