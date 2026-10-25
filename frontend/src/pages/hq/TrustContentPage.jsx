import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { trustCenterAdminApi } from '../../lib/api';
import { reportError } from '../../lib/log';
import { AdminPageHeader, Card, Lightbox } from '../../ui';
import {
  NOTICE_DAYS, activeFrom, blankGroup, blankLine, blockRows, certificationProblem, certificationsPayload, confirmedCount,
  REFUSALS, linesPayload, linesProblem, noteState, pendingChanges, publishLine, publishedLine, refusalText, startBody,
  startCheckedAt, subprocessorRows,
} from './trustContentModel';

/**
 * D1079 (#2971, part 7 of #2425) — HQ › Security › Trust center content, the
 * canvas's TRU14 and its Publish dialog TRU14d, on D1075's routes
 * (`routes/admin_trust_center.ts`).
 *
 * ONLY A SUPER ADMIN REACHES IT. The route sits behind `hqOnly`, which shows
 * an admin without the elevation `SuperAdminOnlyNotice` instead, and the
 * Worker refuses the read to anyone else (`requireSuperAdmin`). Every write
 * also meets the write bar; a lapsed step-up is `api.js`'s StepUp prompt.
 *
 * NOTHING HERE IS PUBLIC UNTIL PUBLISH. Saving a block or adding a
 * subprocessor writes a draft. Publish changes opens TRU14d, which names
 * every block and subprocessor it changes and takes the change note the
 * public page shows under Changes to this page. Publish stays shut until the
 * note is 10 to 1000 characters, and the Worker refuses one that is not.
 *
 * NOT BUILT: TRU14's "Draft a note" by Eadwyn. No route drafts a note yet,
 * and a button that cannot answer is not drawn (D1079 §4).
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECONDARY = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline disabled:opacity-50 dark:text-violet-300';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'block text-[10.5px] font-extrabold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400';
const H2 = 'text-[14px] font-bold text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400';
const DRAFT_PILL = 'inline-flex items-center rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';

function Refusal({ text, testId }) {
  if (!text) return null;
  return <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid={testId}>{text}</p>;
}

/** One confirm for every change that is not a form: discard, delete, remove, keep. */
function ConfirmDialog({ ask, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await ask.run(); onDone(); } catch (e) { reportError('TrustContent:confirm', e); setError(refusalText(e)); setBusy(false); }
  };
  return (
    <Lightbox label={ask.title} title={ask.title} sub={ask.line} onClose={onClose} testId="trust-content-confirm"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>Back</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy} data-testid="trust-content-confirm-go">{ask.verb}</button>
        </div>
      )}>
      <Refusal text={error} testId="trust-content-confirm-error" />
    </Lightbox>
  );
}

function LinesEditor({ body, setBody }) {
  const setGroup = (gi, patch) => setBody({ ...body, groups: body.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  const setLine = (gi, li, patch) => setGroup(gi, { lines: body.groups[gi].lines.map((l, i) => (i === li ? { ...l, ...patch } : l)) });
  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className={LABEL}>Introduction</span>
        <textarea className={`${FIELD} min-h-[60px]`} value={body.intro} onChange={(e) => setBody({ ...body, intro: e.target.value })} data-testid="trust-content-intro" />
      </label>
      {body.groups.map((g, gi) => (
        <fieldset key={gi} className="space-y-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-800" data-testid={`trust-content-group-${gi}`}>
          <div className="flex items-end gap-2">
            <label className="block flex-1 space-y-1">
              <span className={LABEL}>Group title</span>
              <input className={FIELD} value={g.title} onChange={(e) => setGroup(gi, { title: e.target.value })} />
            </label>
            <button type="button" className={LINK} onClick={() => setBody({ ...body, groups: body.groups.filter((_, i) => i !== gi) })}>Remove group</button>
          </div>
          {g.lines.map((l, li) => (
            <div key={li} className="space-y-2 border-t border-axal-hairline pt-2 dark:border-gray-800" data-testid={`trust-content-line-${gi}-${li}`}>
              <div className="flex items-start gap-2">
                <textarea aria-label="The line's words" className={`${FIELD} min-h-[44px]`} value={l.text} onChange={(e) => setLine(gi, li, { text: e.target.value })} data-testid={`trust-content-text-${gi}-${li}`} />
                <button type="button" aria-label="Remove line" className={LINK} onClick={() => setGroup(gi, { lines: g.lines.filter((_, i) => i !== li) })}><Trash2 size={14} aria-hidden="true" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" checked={!l.recorded} onChange={(e) => setLine(gi, li, { recorded: !e.target.checked })} data-testid={`trust-content-gap-${gi}-${li}`} />
                  Not recorded
                </label>
                {l.recorded ? (
                  <label className="inline-flex items-center gap-1.5 text-[12.5px]">
                    Checked
                    <input type="date" className={`${FIELD} w-auto py-1`} value={l.checked_at} onChange={(e) => setLine(gi, li, { checked_at: e.target.value })} />
                  </label>
                ) : (
                  <input aria-label="Why it is not recorded" placeholder="Why it is not recorded" className={`${FIELD} flex-1 py-1`} value={l.why} onChange={(e) => setLine(gi, li, { why: e.target.value })} data-testid={`trust-content-why-${gi}-${li}`} />
                )}
              </div>
            </div>
          ))}
          <button type="button" className={LINK} onClick={() => setGroup(gi, { lines: [...g.lines, blankLine()] })}><Plus size={12} aria-hidden="true" className="inline" /> Add a line</button>
        </fieldset>
      ))}
      <button type="button" className={SECONDARY} onClick={() => setBody({ ...body, groups: [...body.groups, blankGroup()] })} data-testid="trust-content-add-group"><Plus size={13} aria-hidden="true" /> Add a group</button>
    </div>
  );
}

/** Certifications: each with its auditor's report on file. One is added only once its report is attached. */
function CertificationsEditor({ body, setBody, api }) {
  const [form, setForm] = useState({ name: '', auditor: '', issued_on: '', expires_on: '', report_uid: '', size: null });
  const [attach, setAttach] = useState({ busy: false, error: null });
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttach({ busy: true, error: null });
    try {
      const out = await api.attachReport(new Uint8Array(await file.arrayBuffer()));
      setForm((f) => ({ ...f, report_uid: out.uid, size: out.size_bytes }));
      setAttach({ busy: false, error: null });
    } catch (err) { reportError('TrustContent:attach', err); setAttach({ busy: false, error: refusalText(err, 'The report could not be attached just now. Try again.') }); }
  };
  const problem = certificationProblem(form);
  const add = () => {
    if (problem) return;
    setBody({ items: [...body.items, { name: form.name, auditor: form.auditor, issued_on: form.issued_on, expires_on: form.expires_on, report_uid: form.report_uid }] });
    setForm({ name: '', auditor: '', issued_on: '', expires_on: '', report_uid: '', size: null });
  };
  return (
    <div className="space-y-4">
      {body.items.length === 0
        ? <p className={MUTED} data-testid="trust-content-none-held">None held. Add one only with the auditor&apos;s report on file.</p>
        : (
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
            {body.items.map((c, i) => (
              <li key={`${c.report_uid}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]" data-testid={`trust-content-cert-${i}`}>
                <span><strong>{c.name}</strong> · {c.auditor} · issued {c.issued_on}{c.expires_on ? ` · expires ${c.expires_on}` : ''} · report on file</span>
                <button type="button" className={LINK} onClick={() => setBody({ items: body.items.filter((_, j) => j !== i) })}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      <div className="grid gap-2 sm:grid-cols-2" data-testid="trust-content-cert-form">
        <label className="space-y-1"><span className={LABEL}>Name</span><input className={FIELD} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="trust-content-cert-name" /></label>
        <label className="space-y-1"><span className={LABEL}>Auditor</span><input className={FIELD} value={form.auditor} onChange={(e) => setForm({ ...form, auditor: e.target.value })} data-testid="trust-content-cert-auditor" /></label>
        <label className="space-y-1"><span className={LABEL}>Issued</span><input type="date" className={FIELD} value={form.issued_on} onChange={(e) => setForm({ ...form, issued_on: e.target.value })} data-testid="trust-content-cert-issued" /></label>
        <label className="space-y-1"><span className={LABEL}>Expires</span><input type="date" className={FIELD} value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></label>
        <label className="space-y-1 sm:col-span-2">
          <span className={LABEL}>Auditor&apos;s report · required</span>
          <input type="file" accept="application/pdf" className={FIELD} onChange={onFile} disabled={attach.busy} data-testid="trust-content-cert-report" />
          <span className={MUTED} data-testid="trust-content-cert-report-state">
            {form.report_uid ? 'The report is on file.' : attach.busy ? 'Attaching…' : 'Attach the report as a PDF, at most 20 MB.'}
          </span>
        </label>
      </div>
      <Refusal text={attach.error} testId="trust-content-attach-error" />
      <button type="button" className={SECONDARY} onClick={add} disabled={!!problem} data-testid="trust-content-cert-add">Add the certification</button>
      {problem ? <p className={MUTED}>Adding opens once the name, the auditor, the issue day and the auditor&apos;s report are in.</p> : null}
    </div>
  );
}

function BlockEditor({ block, api, onSaved, onDiscard }) {
  const [body, setBody] = useState(() => startBody(block));
  const [checkedAt, setCheckedAt] = useState(() => startCheckedAt(block));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const certs = block.key === 'certifications';
  const problem = certs ? null : linesProblem(body);
  const save = async () => {
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      await api.saveDraft(block.key, { body: certs ? certificationsPayload(body) : linesPayload(body), checked_at: checkedAt || null });
      onSaved();
    } catch (e) { reportError('TrustContent:saveDraft', e); setError(refusalText(e)); }
    setBusy(false);
  };
  return (
    <Card className="space-y-4 p-4" data-testid={`trust-content-editor-${block.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>{block.label}</h2>
        {block.draft ? <span className={DRAFT_PILL} data-testid="trust-content-editor-draft">Draft</span> : null}
      </div>
      <p className={MUTED}>{block.draft ? 'You are editing the draft. Visitors still see the published copy.' : 'Saving makes a draft. Visitors still see the published copy until you publish.'}</p>
      {certs ? <CertificationsEditor body={body} setBody={setBody} api={api} /> : <LinesEditor body={body} setBody={setBody} />}
      <label className="inline-flex items-center gap-2 text-[12.5px]">
        Block last checked
        <input type="date" className={`${FIELD} w-auto py-1`} value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} data-testid="trust-content-checked" />
      </label>
      <Refusal text={error} testId="trust-content-save-error" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} onClick={save} disabled={busy} data-testid="trust-content-save">Save draft</button>
        {block.draft ? <button type="button" className={SECONDARY} onClick={onDiscard} data-testid="trust-content-discard">Discard draft</button> : null}
      </div>
    </Card>
  );
}

const EMPTY_SUB = { name: '', purpose: '', data: '', location: '', starts_at: '' };

function SubprocessorDialog({ editing, api, onClose, onDone }) {
  const [f, setF] = useState(() => (editing ? { name: editing.name, purpose: editing.purpose, data: editing.data, location: editing.location, starts_at: editing.starts_at || '' } : EMPTY_SUB));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const complete = ['name', 'purpose', 'data', 'location'].every((k) => f[k].trim());
  const go = async () => {
    setBusy(true); setError(null);
    const body = { name: f.name.trim(), purpose: f.purpose.trim(), data: f.data.trim(), location: f.location.trim(), starts_at: f.starts_at || null };
    try {
      if (editing) await api.editSubprocessor(editing.uid, body); else await api.addSubprocessor(body);
      onDone();
    } catch (e) { reportError('TrustContent:subprocessor', e); setError(refusalText(e)); setBusy(false); }
  };
  const field = (k, label) => (
    <label className="block space-y-1"><span className={LABEL}>{label}</span><input className={FIELD} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`trust-content-sub-${k}`} /></label>
  );
  return (
    <Lightbox label={editing ? 'Edit the subprocessor' : 'Add a subprocessor'} title={editing ? `Edit ${editing.name}` : 'Add a subprocessor'}
      sub={`It is a draft until you publish. It is listed as active no sooner than ${NOTICE_DAYS} days after you publish, and confirmed subscribers are emailed when you publish.`}
      onClose={onClose} testId="trust-content-sub-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy || !complete} data-testid="trust-content-sub-save">{editing ? 'Save draft' : 'Add as a draft'}</button>
        </div>
      )}>
      <div className="space-y-3">
        {field('name', 'Company')}
        {field('purpose', 'What they do for us')}
        {field('data', 'Data they see')}
        {field('location', 'Where')}
        <label className="block space-y-1">
          <span className={LABEL}>Start date · optional</span>
          <input type="date" className={FIELD} value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
          <span className={MUTED}>An earlier date than {NOTICE_DAYS} days after Publish is moved to that day.</span>
        </label>
        <Refusal text={error} testId="trust-content-sub-error" />
      </div>
    </Lightbox>
  );
}

function PublishDialog({ read, api, onClose, onDone }) {
  const p = pendingChanges(read);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ns = noteState(note);
  const go = async () => {
    if (!ns.ok) { setError(REFUSALS.note_required); return; }
    setBusy(true); setError(null);
    try { await api.publish(note.trim()); onDone(); } catch (e) { reportError('TrustContent:publish', e); setError(refusalText(e, 'It could not be published just now. Nothing was published. Try again.')); setBusy(false); }
  };
  return (
    <Lightbox label="Publish?" title="Publish?" sub={publishLine(p, confirmedCount(read?.subscribers))} onClose={onClose} testId="trust-content-publish-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>Back</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy || !ns.ok} data-testid="trust-content-publish-go">Publish</button>
        </div>
      )}>
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-5 text-[13px]" data-testid="trust-content-publish-list">
          {p.blocks.map((b) => <li key={b.key}>{b.label} · the draft goes live</li>)}
          {p.added.map((s) => <li key={s.uid}>Subprocessors · {s.name} added, active from {activeFrom(s.starts_at)}</li>)}
          {p.removed.map((s) => <li key={s.uid}>Subprocessors · {s.name} removed</li>)}
        </ul>
        <label className="block space-y-1">
          <span className={LABEL}>Change note · required</span>
          <textarea className={`${FIELD} min-h-[80px]`} value={note} onChange={(e) => setNote(e.target.value)} data-testid="trust-content-note" />
          <span className={MUTED} data-testid="trust-content-note-hint">{ns.hint} The change note appears under Changes to this page.</span>
        </label>
        <Refusal text={error} testId="trust-content-publish-error" />
      </div>
    </Lightbox>
  );
}

function ChangeLog({ changes }) {
  const items = changes?.items || [];
  return (
    <Card className="space-y-2 p-4" data-testid="trust-content-changes">
      <h2 className={H2}>Changes to this page</h2>
      {items.length === 0 ? <p className={MUTED}>No changes published yet.</p> : (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
          {items.map((c) => (
            <li key={c.uid} className="space-y-0.5 py-2 text-[12.5px]" data-testid={`trust-content-change-${c.uid}`}>
              <div className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{String(c.published_at).slice(0, 10)}{c.blocks?.length ? ` · ${c.blocks.map((b) => b.label).join(', ')}` : ''}</div>
              <div>{c.note}</div>
            </li>
          ))}
        </ul>
      )}
      {changes && changes.complete === false ? <p className={MUTED}>The latest 50 are shown here; the public page reads the rest.</p> : null}
    </Card>
  );
}

export default function TrustContentPage({ api = trustCenterAdminApi }) {
  const [state, setState] = useState({ status: 'loading', read: null });
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => {
    setState((s) => ({ status: s.read ? 'ready' : 'loading', read: s.read }));
    return api.read().then(
      (read) => setState({ status: 'ready', read }),
      (e) => { reportError('TrustContent:read', e); setState({ status: 'unreadable', read: null }); },
    );
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const read = state.read;
  const rows = useMemo(() => blockRows(read?.blocks), [read]);
  const subs = useMemo(() => subprocessorRows(read?.subprocessors), [read]);
  const pending = pendingChanges(read);
  const block = read?.blocks?.find((b) => b.key === selected) || null;
  const after = (msg) => () => { setDialog(null); setNotice(msg); load(); };

  const header = (
    <AdminPageHeader
      crumb={{ label: 'Security', to: '/admin/security', current: 'Security › Trust center content' }}
      title="Trust center content"
      pills={[{ label: 'HQ only', tone: 'hq' }]}
      line="What the public trust center shows. Visitors see a change only after you publish it."
      actions={<button type="button" className={PRIMARY} disabled={!pending.any} onClick={() => setDialog({ kind: 'publish' })} data-testid="trust-content-publish">Publish changes</button>}
      data-testid="trust-content-header"
    />
  );

  if (state.status === 'loading') return <div className="space-y-4" data-testid="trust-content-page">{header}<p role="status" className={MUTED}>Reading…</p></div>;
  if (state.status === 'unreadable') {
    return (
      <div className="space-y-4" data-testid="trust-content-page">
        {header}
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-red-700 dark:text-red-300" data-testid="trust-content-unreadable">
          <span><strong>Unreadable.</strong> The trust center&apos;s content could not be read just now. That is not the same as having none.</span>
          <button type="button" onClick={load} className="inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={12} aria-hidden="true" /> Try again</button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="trust-content-page">
      {header}
      {notice ? <p role="status" className="rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] dark:border-violet-800 dark:bg-violet-950/40" data-testid="trust-content-notice">{notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-3" data-testid="trust-content-blocks">
          <h2 className={`${H2} px-1 pb-2`}>Blocks</h2>
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.key}>
                <button type="button" aria-current={selected === r.key ? 'true' : undefined} onClick={() => setSelected(r.key)}
                  className={`flex w-full items-center gap-2 rounded-[9px] border px-2.5 py-2 text-left ${selected === r.key ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40' : 'border-transparent hover:bg-axal-ground dark:hover:bg-gray-800'}`}
                  data-testid={`trust-content-block-${r.key}`}>
                  <span className="flex-1">
                    <span className="block text-[13px] font-bold">{r.label}</span>
                    <span className="block font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{publishedLine(r)}</span>
                  </span>
                  {r.hasDraft ? <span className={DRAFT_PILL}>Draft</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          {block
            ? <BlockEditor key={`${block.key}-${block.draft?.updated_at || ''}-${block.published?.published_at || ''}`} block={block} api={api}
                onSaved={() => { setNotice(`${block.label}: the draft is saved. Visitors see it after you publish.`); load(); }}
                onDiscard={() => setDialog({ kind: 'confirm', ask: { title: `Discard the draft of ${block.label}?`, line: 'The published copy stays as it is.', verb: 'Discard draft', run: () => api.discardDraft(block.key) }, done: `${block.label}: the draft is discarded.` })} />
            : <Card className="p-4"><p className={MUTED} data-testid="trust-content-pick">Choose a block to edit its draft.</p></Card>}
          <Card className="space-y-3 p-4" data-testid="trust-content-subprocessors">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={H2}>Subprocessors · editing</h2>
              <button type="button" className={SECONDARY} onClick={() => setDialog({ kind: 'sub' })} data-testid="trust-content-sub-add"><Plus size={13} aria-hidden="true" /> Add a subprocessor</button>
            </div>
            {subs.length === 0 ? <p className={MUTED} data-testid="trust-content-sub-empty">No subprocessor is listed or drafted yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="text-[10.5px] uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">
                    <tr><th className="py-1 pr-2">Company</th><th className="pr-2">What they do for us</th><th className="pr-2">Data they see</th><th className="pr-2">Where</th><th className="pr-2">Since</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
                    {subs.map((s) => (
                      <tr key={s.uid} className={s.state === 'published' ? '' : 'bg-axal-lavender/60 dark:bg-violet-950/30'} data-testid={`trust-content-sub-${s.uid}`}>
                        <td className="py-2 pr-2 font-bold">{s.name} {s.state !== 'published' ? <span className={DRAFT_PILL}>{s.stateLabel}</span> : null}</td>
                        <td className="pr-2">{s.purpose}</td>
                        <td className="pr-2">{s.data}</td>
                        <td className="pr-2">{s.location}</td>
                        <td className="pr-2 font-mono text-[11.5px]">{s.since}</td>
                        <td className="space-x-2 whitespace-nowrap">
                          {s.actions.includes('edit') ? <button type="button" className={LINK} onClick={() => setDialog({ kind: 'sub', editing: s })}>Edit</button> : null}
                          {s.actions.includes('delete') ? <button type="button" className={LINK} onClick={() => setDialog({ kind: 'confirm', ask: { title: `Delete the draft ${s.name}?`, line: 'It was never listed, so visitors see no change.', verb: 'Delete draft', run: () => api.removeSubprocessor(s.uid) }, done: `${s.name}: the draft is deleted.` })}>Delete</button> : null}
                          {s.actions.includes('remove') ? <button type="button" className={LINK} onClick={() => setDialog({ kind: 'confirm', ask: { title: `Remove ${s.name}?`, line: 'It stays listed until you publish, and the change log records its removal.', verb: 'Mark for removal', run: () => api.removeSubprocessor(s.uid) }, done: `${s.name} is marked for removal. Visitors see it until you publish.` })} data-testid={`trust-content-sub-remove-${s.uid}`}>Remove</button> : null}
                          {s.actions.includes('keep') ? <button type="button" className={LINK} onClick={() => setDialog({ kind: 'confirm', ask: { title: `Keep ${s.name}?`, line: 'The removal is cancelled. It stays listed.', verb: 'Keep it', run: () => api.keepSubprocessor(s.uid) }, done: `${s.name} stays listed.` })}>Keep</button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={MUTED}>Adding one: confirmed subscribers are emailed when you publish, and it is listed as active {NOTICE_DAYS} days after you publish.</p>
          </Card>
          <ChangeLog changes={read?.changes} />
        </div>
      </div>
      {dialog?.kind === 'confirm' ? <ConfirmDialog ask={dialog.ask} onClose={() => setDialog(null)} onDone={after(dialog.done)} /> : null}
      {dialog?.kind === 'sub' ? <SubprocessorDialog editing={dialog.editing} api={api} onClose={() => setDialog(null)} onDone={after(dialog.editing ? `${dialog.editing.name}: the draft is saved.` : 'The subprocessor is added as a draft. Visitors see it after you publish.')} /> : null}
      {dialog?.kind === 'publish' ? <PublishDialog read={read} api={api} onClose={() => setDialog(null)} onDone={after('Published. Visitors see the changes now, with your note under Changes to this page.')} /> : null}
    </div>
  );
}
