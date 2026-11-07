import React, { useEffect, useState } from 'react';
import { adminGovernanceApi } from '../../../lib/api/adminGovernance';
import { reportError } from '../../../lib/log';
import PdfPages from './PdfPages';
import { useRead, ReadState, Missing, SidePanel, button, card, input, date } from './parts';
import {
  ACCEPT, STATUS_TONES, byCategory, dayLabel, draftRow, executedHint, fileProblem, moveLabel,
  ownershipPayload, recordedPercent, statusLabel, versionLine,
} from './governanceModel';

/**
 * D4563 (#4563) — HQ Contracts › Corporate Governance, at its own address
 * `/admin/contracts/governance`: the governance documents of Axal VC Holdings
 * LLC, Axal VC Management LLC and Axal VC GP LLC, each as one collection
 * grouped by category, with status, effective date, versions, preview and
 * download, and links to the template library or a signed envelope. Every
 * change opens the side panel (an in-page dialog). A confidential document is
 * the Super Admin's alone: another admin sees only how many are withheld. The
 * ownership metadata is the Super Admin's alone too.
 */
export default function GovernanceTab() {
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState(null); // { kind: 'new', entity } | { kind: 'doc', uid } | { kind: 'ownership' }
  const read = useRead(() => adminGovernanceApi.list(), [revision]);
  const changed = () => setRevision((n) => n + 1);
  const data = read.data;
  return <section aria-label="Corporate Governance" data-testid="governance-tab" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold">Corporate Governance</h2>
        <p className="text-[12.5px] text-axal-muted">Operating agreements, formation certificates, member registers, resolutions and signing authority records of the three Axal entities. A file is never replaced: a corrected one is a new version.</p></div>
      {data?.super_admin && <button type="button" className={button} onClick={() => setPanel({ kind: 'ownership' })}>Ownership (Super Admin)</button>}
    </div>
    <ReadState read={read} what="Governance documents">
      {data && <div className="grid gap-4 xl:grid-cols-3">{data.entities.map((entity) => <EntityCard key={entity.key} entity={entity} categories={data.categories}
        onNew={() => setPanel({ kind: 'new', entity })} onOpen={(uid) => setPanel({ kind: 'doc', uid })} />)}</div>}
    </ReadState>
    {panel?.kind === 'new' && data && <NewDocument entity={panel.entity} categories={data.categories} superAdmin={data.super_admin}
      onClose={() => setPanel(null)} onCreated={(uid) => { changed(); setPanel({ kind: 'doc', uid }); }} />}
    {panel?.kind === 'doc' && data && <DocumentPanel uid={panel.uid} categories={data.categories} superAdmin={data.super_admin} onClose={() => setPanel(null)} onChanged={changed} />}
    {panel?.kind === 'ownership' && <OwnershipPanel onClose={() => setPanel(null)} />}
  </section>;
}

function StatusPill({ status }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONES[status] || ''}`}>{statusLabel(status)}</span>;
}

function EntityCard({ entity, categories, onNew, onOpen }) {
  const groups = byCategory(entity.documents, categories);
  return <article className={`${card} min-w-0 p-4 space-y-3`} data-testid={`governance-entity-${entity.key}`}>
    <header className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="font-bold">{entity.name}</h3>
      <p className="text-[11px] text-axal-muted">{entity.documents.length} {entity.documents.length === 1 ? 'document' : 'documents'}{entity.withheld > 0 && <> · <span data-testid={`governance-withheld-${entity.key}`}>{entity.withheld} confidential (Super Admin only)</span></>}</p></div>
      <button type="button" className={`${button} shrink-0`} aria-label={`New document for ${entity.name}`} onClick={onNew}>New document</button></header>
    {groups.map((g) => <div key={g.key}><h4 className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">{g.label}</h4>
      {g.documents.length === 0 ? <p className="py-1 text-[12px] text-axal-muted">None recorded.</p>
        : <ul className="divide-y divide-axal-hairline">{g.documents.map((d) => <li key={d.uid}>
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left" onClick={() => onOpen(d.uid)}>
            <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{d.title}</span>
              <span className="block text-[11px] text-axal-muted">{dayLabel(d.effective_date) ? `Effective ${dayLabel(d.effective_date)}` : 'Effective date not recorded'} · {versionLine(d.latest) || 'No file yet'}{d.confidential ? ' · Confidential' : ''}</span></span>
            <StatusPill status={d.status} /></button></li>)}</ul>}</div>)}
  </article>;
}

function Field({ label, children }) {
  return <label className="block text-xs font-semibold">{label}<div className="mt-1">{children}</div></label>;
}
function Problem({ text }) { return text ? <p role="alert" className="text-xs text-red-700 dark:text-red-300">{text}</p> : null; }

function NewDocument({ entity, categories, superAdmin, onClose, onCreated }) {
  const [form, setForm] = useState({ category: categories[0]?.key || '', title: '', effective_date: '', confidential: superAdmin });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function save() {
    if (!form.title.trim()) { setError('Give the document a title.'); return; }
    setBusy(true); setError('');
    try {
      const r = await adminGovernanceApi.create({ entity_key: entity.key, category: form.category, title: form.title.trim(), effective_date: form.effective_date || null, ...(superAdmin ? { confidential: form.confidential } : { confidential: false }) });
      onCreated(r.document.uid);
    } catch (e) { reportError('governance:create', e); setError(e?.message || 'The document could not be created. Nothing was saved.'); setBusy(false); }
  }
  return <SidePanel title={`New document · ${entity.name}`} onClose={onClose} testId="governance-new-panel">
    <p className="text-xs text-axal-muted">It starts as a draft. Upload its file once it is created.</p>
    <Field label="Category"><select className={input} value={form.category} onChange={set('category')}>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
    <Field label="Title"><input className={input} value={form.title} maxLength={200} onChange={set('title')} /></Field>
    <Field label="Effective date"><input type="date" className={input} value={form.effective_date} onChange={set('effective_date')} /></Field>
    {superAdmin ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.confidential} onChange={set('confidential')} /> Confidential: the Super Admin alone can open it</label>
      : <p className="text-xs text-axal-muted">Only the Super Admin can mark a document confidential.</p>}
    <Problem text={error} />
    <div className="flex justify-end gap-2"><button type="button" className={button} onClick={onClose}>Cancel</button>
      <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Create draft'}</button></div>
  </SidePanel>;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DocumentPanel({ uid, categories, superAdmin, onClose, onChanged }) {
  const [revision, setRevision] = useState(0);
  const read = useRead(() => adminGovernanceApi.read(uid), [uid, revision]);
  const refresh = () => { setRevision((n) => n + 1); onChanged(); };
  const d = read.data?.document;
  return <SidePanel title={d ? d.title : 'Governance document'} onClose={onClose} testId="governance-document-panel">
    <ReadState read={read} what="This document">{d && <>
      <div className="flex flex-wrap items-center gap-2 text-xs"><StatusPill status={d.status} /><span className="text-axal-muted">{categories.find((c) => c.key === d.category)?.label}</span>{d.confidential && <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px]">Confidential</span>}</div>
      <StatusMoves document={d} versions={read.data.versions} onDone={refresh} />
      <Details document={d} superAdmin={superAdmin} onDone={refresh} />
      <Links document={d} onDone={refresh} />
      <Versions document={d} versions={read.data.versions} onDone={refresh} />
    </>}</ReadState>
  </SidePanel>;
}

function StatusMoves({ document: d, versions, onDone }) {
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function move(to) {
    setBusy(true); setError('');
    try { await adminGovernanceApi.update(d.uid, { status: to }); setAsking(null); onDone(); }
    catch (e) { reportError('governance:status', e); setError(e?.message || 'The status did not change.'); }
    finally { setBusy(false); }
  }
  const hint = executedHint(d, versions);
  return <div className="space-y-2" data-testid="governance-status-moves">
    <h4 className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">Status</h4>
    {d.executed_version != null && <p className="text-xs">Executed from the signed copy, v{d.executed_version}.</p>}
    {d.status === 'executed' && d.executed_version == null && d.envelope_id != null && <p className="text-xs">Executed from completed envelope #{d.envelope_id}.</p>}
    <div className="flex flex-wrap gap-2">{d.next_statuses.map((to) => <button key={to} type="button" className={button} disabled={busy} onClick={() => { setAsking(to); setError(''); }}>{moveLabel(d.status, to)}</button>)}</div>
    {asking && <div role="dialog" aria-label={moveLabel(d.status, asking)} className="rounded-lg border border-axal-hairline p-3 space-y-2 text-xs">
      <p>Move “{d.title}” from {statusLabel(d.status)} to {statusLabel(asking)}?</p>
      {asking === 'executed' && hint && <p className="text-amber-700 dark:text-amber-300">{hint}</p>}
      <div className="flex gap-2"><button type="button" className={button} onClick={() => setAsking(null)}>Cancel</button>
        <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={() => move(asking)}>{moveLabel(d.status, asking)}</button></div></div>}
    <Problem text={error} />
  </div>;
}

function Details({ document: d, superAdmin, onDone }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!form.title.trim()) { setError('The title cannot be empty.'); return; }
    setBusy(true); setError('');
    try {
      await adminGovernanceApi.update(d.uid, { title: form.title.trim(), effective_date: form.effective_date || null, ...(superAdmin ? { confidential: form.confidential } : {}) });
      setForm(null); onDone();
    } catch (e) { reportError('governance:update', e); setError(e?.message || 'Nothing was saved.'); }
    finally { setBusy(false); }
  }
  if (!form) return <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
    <dt className="text-axal-muted">Effective date</dt><dd>{dayLabel(d.effective_date) || <Missing />}</dd>
    <dt className="text-axal-muted">Updated</dt><dd>{date(d.updated_at) || <Missing />}</dd>
    <dd className="col-span-2 pt-1"><button type="button" className={button} onClick={() => setForm({ title: d.title, effective_date: d.effective_date || '', confidential: d.confidential })}>Edit details</button></dd>
  </dl>;
  return <div role="dialog" aria-label="Edit details" className="space-y-2 rounded-lg border border-axal-hairline p-3">
    <Field label="Title"><input className={input} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
    <Field label="Effective date"><input type="date" className={input} value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></Field>
    {superAdmin && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} /> Confidential: the Super Admin alone can open it</label>}
    <Problem text={error} />
    <div className="flex gap-2"><button type="button" className={button} onClick={() => setForm(null)}>Cancel</button><button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={save}>Save</button></div>
  </div>;
}

function Links({ document: d, onDone }) {
  const [open, setOpen] = useState(false);
  const linkable = useRead(() => (open ? adminGovernanceApi.linkable() : Promise.resolve(null)), [open]);
  const [form, setForm] = useState({ template_slug: d.template_slug || '', envelope_id: d.envelope_id == null ? '' : String(d.envelope_id) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = d.status === 'executed';
  useEffect(() => { setForm({ template_slug: d.template_slug || '', envelope_id: d.envelope_id == null ? '' : String(d.envelope_id) }); }, [d.template_slug, d.envelope_id]);
  async function save() {
    setBusy(true); setError('');
    // An executed document keeps the envelope it was signed in (the Worker refuses a change), so only its template is sent.
    const body = { template_slug: form.template_slug || null, ...(locked ? {} : { envelope_id: form.envelope_id ? Number(form.envelope_id) : null }) };
    try { await adminGovernanceApi.update(d.uid, body); setOpen(false); onDone(); }
    catch (e) { reportError('governance:links', e); setError(e?.message || 'The links did not change.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 text-xs">
    <h4 className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">Linked records</h4>
    <p>Template: {d.template_slug ? <code>{d.template_slug}</code> : <Missing />}</p>
    <p>Signed envelope: {d.envelope_id != null ? `#${d.envelope_id}` : <Missing />}</p>
    {!open ? <button type="button" className={button} onClick={() => setOpen(true)}>Change links</button>
      : <div role="dialog" aria-label="Change links" className="space-y-2 rounded-lg border border-axal-hairline p-3">
        <p className="text-axal-muted">A link points at the record; nothing is copied.</p>
        <ReadState read={linkable} what="Templates and envelopes">{linkable.data && <>
          <Field label="Template"><select className={input} value={form.template_slug} onChange={(e) => setForm({ ...form, template_slug: e.target.value })}>
            <option value="">No template</option>{linkable.data.templates.map((t) => <option key={t.slug} value={t.slug}>{t.title}</option>)}</select></Field>
          {locked ? <p className="text-axal-muted">The envelope stays: this document was executed from it. Archive it to change it.</p> : <Field label="Completed envelope"><select className={input} value={form.envelope_id} onChange={(e) => setForm({ ...form, envelope_id: e.target.value })}>
            <option value="">No envelope</option>{linkable.data.envelopes.map((e) => <option key={e.id} value={String(e.id)}>{e.title || `Envelope #${e.id}`}{e.completed_at ? ` · ${date(e.completed_at)}` : ''}</option>)}</select></Field>}
        </>}</ReadState>
        <Problem text={error} />
        <div className="flex gap-2"><button type="button" className={button} onClick={() => setOpen(false)}>Cancel</button><button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy || !linkable.data} onClick={save}>Save links</button></div>
      </div>}
  </div>;
}

function Versions({ document: d, versions, onDone }) {
  const closed = d.status === 'executed' || d.status === 'archived';
  const [upload, setUpload] = useState(null); // { file, signed, note }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { version, blob } | { version, loading } | { version, error }
  async function send() {
    const problem = fileProblem(upload?.file);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { await adminGovernanceApi.uploadVersion(d.uid, upload); setUpload(null); onDone(); }
    catch (e) { reportError('governance:upload', e); setError(e?.message || 'The file was not kept. Try again.'); }
    finally { setBusy(false); }
  }
  async function open(v) {
    setPreview({ version: v.version, loading: true });
    try { const f = await adminGovernanceApi.file(d.uid, v.version); setPreview({ version: v.version, blob: f.blob }); }
    catch (e) { reportError('governance:preview', e); setPreview({ version: v.version, error: e?.message || 'The file could not be read.' }); }
  }
  async function download(v) {
    try { const f = await adminGovernanceApi.file(d.uid, v.version, { download: true }); saveBlob(f.blob, f.filename); }
    catch (e) { reportError('governance:download', e); setError(e?.message || 'The file could not be downloaded.'); }
  }
  return <div className="space-y-2 text-xs" data-testid="governance-versions">
    <h4 className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">Versions</h4>
    {versions.length === 0 ? <p className="text-axal-muted">No file uploaded yet.</p>
      : <ul className="divide-y divide-axal-hairline">{versions.map((v) => <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span className="min-w-0"><span className="block font-semibold">{versionLine(v)}</span><span className="block text-axal-muted">{date(v.created_at) || 'Upload date not recorded'}{v.note ? ` · ${v.note}` : ''}</span></span>
        <span className="flex gap-2">{v.content_type === 'application/pdf' && <button type="button" className={button} aria-label={`Preview v${v.version}`} onClick={() => open(v)}>Preview</button>}
          <button type="button" className={button} aria-label={`Download v${v.version}`} onClick={() => download(v)}>Download</button></span></li>)}</ul>}
    {preview && <div className="rounded-lg border border-axal-hairline p-2" data-testid="governance-preview">
      <div className="mb-2 flex items-center justify-between"><b>v{preview.version}</b><button type="button" className={button} onClick={() => setPreview(null)}>Close preview</button></div>
      {preview.loading ? <p role="status">Loading the file…</p> : preview.error ? <p role="alert">{preview.error}</p> : <PdfPages blob={preview.blob} title={`${d.title} v${preview.version}`} />}</div>}
    {closed ? <p className="text-axal-muted">{d.status === 'executed' ? 'An executed document takes no new version. Archive it and restore it as a draft to revise it.' : 'An archived document takes no new version. Restore it as a draft first.'}</p>
      : !upload ? <button type="button" className={button} onClick={() => { setUpload({ file: null, signed: false, note: '' }); setError(''); }}>Upload a version</button>
        : <div role="dialog" aria-label="Upload a version" className="space-y-2 rounded-lg border border-axal-hairline p-3">
          <Field label="File (PDF or Word .docx, at most 25 MB)"><input type="file" accept={ACCEPT} className={input} onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={upload.signed} onChange={(e) => setUpload({ ...upload, signed: e.target.checked })} /> This is the signed copy</label>
          <Field label="Note"><input className={input} maxLength={500} value={upload.note} onChange={(e) => setUpload({ ...upload, note: e.target.value })} /></Field>
          <Problem text={error} />
          <div className="flex gap-2"><button type="button" className={button} onClick={() => setUpload(null)}>Cancel</button><button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={send}>{busy ? 'Uploading…' : `Upload as v${versions.length + 1}`}</button></div>
        </div>}
    {!upload && <Problem text={error} />}
  </div>;
}

function OwnershipPanel({ onClose }) {
  const [revision, setRevision] = useState(0);
  const read = useRead(() => adminGovernanceApi.ownership(), [revision]);
  const [editing, setEditing] = useState(null); // { key, name, rows }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    const got = ownershipPayload(editing.rows);
    if (got.error) { setError(got.error); return; }
    setBusy(true); setError('');
    try { await adminGovernanceApi.setOwnership(editing.key, got.rows); setEditing(null); setRevision((n) => n + 1); }
    catch (e) { reportError('governance:ownership', e); setError(e?.message || 'The ownership was not saved.'); }
    finally { setBusy(false); }
  }
  const setRow = (i, k, v) => setEditing((ed) => ({ ...ed, rows: ed.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  return <SidePanel title="Ownership (Super Admin only)" onClose={onClose} testId="governance-ownership-panel">
    <p className="text-xs text-axal-muted">Who holds each entity, as you record it. Restricted: no other account can read it.</p>
    <ReadState read={read} what="Ownership">{read.data && (editing ? <div role="dialog" aria-label={`Edit ownership of ${editing.name}`} className="space-y-3">
      <h4 className="font-bold">{editing.name}</h4>
      {editing.rows.map((r, i) => <fieldset key={i} className="grid gap-2 rounded-lg border border-axal-hairline p-2 sm:grid-cols-2">
        <Field label="Holder"><input className={input} value={r.holder} maxLength={200} onChange={(e) => setRow(i, 'holder', e.target.value)} /></Field>
        <Field label="Interest"><input className={input} value={r.interest} maxLength={120} onChange={(e) => setRow(i, 'interest', e.target.value)} /></Field>
        <Field label="Percent"><input className={input} inputMode="decimal" value={r.percent} onChange={(e) => setRow(i, 'percent', e.target.value)} /></Field>
        <Field label="Note"><input className={input} value={r.note} maxLength={300} onChange={(e) => setRow(i, 'note', e.target.value)} /></Field>
        <div className="sm:col-span-2"><button type="button" className={button} onClick={() => setEditing({ ...editing, rows: editing.rows.filter((_, j) => j !== i) })}>Remove row</button></div>
      </fieldset>)}
      <button type="button" className={button} disabled={editing.rows.length >= 50} onClick={() => setEditing({ ...editing, rows: [...editing.rows, draftRow()] })}>Add a holder</button>
      <Problem text={error} />
      <div className="flex gap-2"><button type="button" className={button} onClick={() => { setEditing(null); setError(''); }}>Cancel</button><button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={save}>Save ownership</button></div>
    </div> : read.data.entities.map((e) => <div key={e.key} className={`${card} p-3 text-xs space-y-2`} data-testid={`governance-ownership-${e.key}`}>
      <div className="flex items-center justify-between gap-2"><b>{e.name}</b><button type="button" className={button} onClick={() => { setError(''); setEditing({ key: e.key, name: e.name, rows: (e.ownership.length ? e.ownership : [{}]).map(draftRow) }); }}>Edit</button></div>
      {e.ownership.length === 0 ? <Missing reason="No ownership has been recorded for this entity." />
        : <><ul className="space-y-1">{e.ownership.map((o, i) => <li key={i}><span className="font-semibold">{o.holder}</span>{o.interest ? ` · ${o.interest}` : ''} · {o.percent == null ? 'percent not recorded' : `${o.percent}%`}{o.note ? <span className="block text-axal-muted">{o.note}</span> : null}</li>)}</ul>
          <p className="text-axal-muted">{recordedPercent(e.ownership) == null ? 'No percent recorded.' : `${recordedPercent(e.ownership)}% recorded`}{e.updated_at ? ` · updated ${date(e.updated_at)}` : ''}</p></>}
    </div>))}</ReadState>
  </SidePanel>;
}
