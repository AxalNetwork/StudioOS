import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminGovernanceApi } from '../../../lib/api/adminGovernance';
import { reportError } from '../../../lib/log';
import { useRead, ReadState, button, card, input, date } from './parts';
import { statusLabel } from './governanceModel';

/**
 * D4811 (#4811) part 8 — a governance record's related documents (board
 * CT-11): the records and templates it governs, and the records that govern
 * it. When the record becomes Approved or Executed at a newer version, each
 * document it governs "may require review" until a person marks it reviewed
 * against that version. Nothing in a related document is ever changed here.
 * `RelatedBanner` is the workspace's note; "Dismiss for me" hides it for this
 * admin only.
 */

const KIND_TAG = Object.freeze({ governance: 'Governance', template: 'Template' });

/** What a related row can name: its title, or why it cannot be named. */
export function relationTitle(r) {
  if (r.restricted) return 'Restricted record · Super Admin only';
  if (r.missing) return r.kind === 'template' ? 'Template no longer in the library' : 'Record not found';
  return r.title || 'Untitled';
}

/** A row's review state in words. Unknown parts say so; nothing is guessed. */
export function stateLine(r) {
  if (r.state === 'review_suggested') return { tone: 'amber', text: '◷ May require review', detail: r.flag_version != null ? `since v${r.flag_version}${r.flagged_at ? ` (${date(r.flagged_at)})` : ''}` : null };
  if (r.state === 'reviewed') {
    const who = r.reviewed_by || 'reviewer not recorded';
    const when = date(r.reviewed_at) || 'date not recorded';
    return { tone: 'plain', text: `✓ Reviewed against v${r.reviewed_version}`, detail: `${who} · ${when}` };
  }
  return { tone: 'plain', text: 'Not affected', detail: null };
}

/** The banner's sentence, or null when there is nothing to say. */
export function bannerLine(banner) {
  if (!banner || !banner.affected) return null;
  const n = banner.affected;
  return `${n} related document${n === 1 ? '' : 's'} may require review.`;
}

export function RelatedBanner({ uid, banner, onReview, onDismissed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const line = bannerLine(banner);
  if (!line || banner.dismissed) return null;
  async function dismiss() {
    setBusy(true); setError('');
    try { await adminGovernanceApi.dismissRelated(uid); onDismissed?.(); }
    catch (e) { reportError('governance:related-dismiss', e); setError(e?.message || 'The banner could not be dismissed.'); }
    finally { setBusy(false); }
  }
  return <div role="note" data-testid="related-banner" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#fcd34d] bg-[#fffbeb] p-3 text-[12.5px] text-[#92400e] dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
    <p className="min-w-0"><b><span aria-hidden="true">! </span>{line}</b> This record became {banner.version != null ? `current at v${banner.version}` : 'current'}. Nothing has been changed in the related documents — each needs a person to review it.</p>
    <span className="flex flex-wrap gap-2">
      <button type="button" className={`${button} min-h-[44px] bg-violet-600 text-white md:min-h-0`} onClick={onReview}>Review affected documents</button>
      <button type="button" className={`${button} min-h-[44px] md:min-h-0`} disabled={busy} onClick={dismiss}>Dismiss for me</button>
    </span>
    {error && <p role="alert" className="w-full text-[11px] text-red-700 dark:text-red-300">{error}</p>}
  </div>;
}

export default function RelatedDocuments({ uid, read, onChanged, entities = [], affectedOnly = false, onShowAll }) {
  const data = read.data;
  const dependants = data?.dependants || [];
  const shown = affectedOnly ? dependants.filter((r) => r.state === 'review_suggested') : dependants;
  return <div className="space-y-4">
    <ReadState read={read} what="The related documents">{data && <>
      <section aria-labelledby="rel-down" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline p-3">
          <h4 id="rel-down" className="text-[13px] font-bold">Governed by this record</h4>
          <span className="font-mono text-[11px] text-axal-muted">{dependants.length} document{dependants.length === 1 ? '' : 's'}</span>
        </div>
        {affectedOnly && <p className="border-b border-axal-hairline p-3 text-[12px]">Showing: may require review ({shown.length}). <button type="button" className="underline" onClick={onShowAll}>Show all related documents</button></p>}
        {dependants.length === 0
          ? <p className="p-3 text-[12.5px] text-axal-muted">No document is linked to this record yet. Link the records and templates it governs below; nothing is inferred from titles.</p>
          : <ol aria-label="Documents this record governs" className="divide-y divide-axal-hairline">{shown.map((r) => <RelationRow key={r.id} uid={uid} r={r} onChanged={onChanged} />)}</ol>}
        <p className="border-t border-axal-hairline p-3 text-[11px] text-axal-muted">Related documents are never rewritten automatically. Marking one as reviewed records who checked it against which version of this record.</p>
      </section>
      <section aria-labelledby="rel-up" className={card}>
        <h4 id="rel-up" className="border-b border-axal-hairline p-3 text-[13px] font-bold">Records that govern this one</h4>
        {(data.governed_by || []).length === 0
          ? <p className="p-3 text-[12.5px] text-axal-muted">No record is linked as governing this one.</p>
          : <ul className="divide-y divide-axal-hairline">{data.governed_by.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[12.5px]">
            <span>{r.restricted || r.missing ? relationTitle(r) : <Link className="font-semibold underline" to={`/admin/contracts/governance/doc/${encodeURIComponent(r.ref)}?tab=related`}>{relationTitle(r)}</Link>}
              {r.status && <span className="ml-2 text-axal-muted">{statusLabel(r.status)}</span>}</span>
            <span className="text-[11px]">{r.state === 'review_suggested' ? 'This record may require review against it' : stateLine(r).text}</span>
          </li>)}</ul>}
      </section>
      <LinkForm uid={uid} entities={entities} taken={dependants} onLinked={onChanged} />
    </>}</ReadState>
  </div>;
}

function RelationRow({ uid, r, onChanged }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = stateLine(r);
  async function save() {
    setBusy(true); setError('');
    try { await adminGovernanceApi.markReviewed(uid, r.id, note.trim()); setOpen(false); setNote(''); onChanged?.(); }
    catch (e) { reportError('governance:related-reviewed', e); setError(e?.message || 'It could not be marked reviewed. Nothing was saved.'); }
    finally { setBusy(false); }
  }
  const title = relationTitle(r);
  return <li className="space-y-2 p-3 text-[12.5px]" data-testid="related-row">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0">
        <span className="mr-2 rounded border border-axal-hairline px-1 text-[10px] font-bold uppercase tracking-wider">{KIND_TAG[r.kind] || r.kind}</span>
        {r.kind === 'governance' && !r.restricted && !r.missing
          ? <Link className="font-semibold underline" to={`/admin/contracts/governance/doc/${encodeURIComponent(r.ref)}`}>{title}</Link>
          : <b>{title}</b>}
        {r.status && <span className="ml-2 text-axal-muted">{statusLabel(r.status)}</span>}
      </span>
      <span className="text-right">
        <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.tone === 'amber' ? 'border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200' : 'border-axal-hairline'}`}>{s.text}</span>
        {s.detail && <span className="block font-mono text-[11px] text-axal-muted">{s.detail}</span>}
      </span>
    </div>
    {r.review_note && <p className="text-[11px] text-axal-muted">Note: {r.review_note}</p>}
    {r.state === 'review_suggested' && !r.restricted && (open
      ? <div className="space-y-2">
        <label className="block text-[11px] font-semibold">What was checked (optional)
          <textarea className={`${input} mt-1`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <span className="flex gap-2">
          <button type="button" className={`${button} min-h-[44px] bg-violet-600 text-white md:min-h-0`} disabled={busy} onClick={save}>Mark reviewed against v{r.flag_version}</button>
          <button type="button" className={`${button} min-h-[44px] md:min-h-0`} onClick={() => { setOpen(false); setError(''); }}>Cancel</button></span>
      </div>
      : <button type="button" className={`${button} min-h-[44px] md:min-h-0`} aria-label={`Mark ${title} reviewed`} onClick={() => setOpen(true)}>Mark reviewed…</button>)}
    {r.state === 'review_suggested' && r.restricted && <p className="text-[11px] text-axal-muted">Only the Super Admin can open it, so only they can mark it reviewed.</p>}
    {error && <p role="alert" className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}
  </li>;
}

function LinkForm({ uid, entities, taken, onLinked }) {
  const [kind, setKind] = useState('governance');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linkable = useRead(() => (kind === 'template' ? adminGovernanceApi.linkable() : Promise.resolve(null)), [kind]);
  const used = new Set(taken.filter((r) => r.kind === kind && r.ref).map((r) => r.ref));
  const options = kind === 'governance'
    ? entities.flatMap((e) => (e.documents || []).filter((d) => d.uid !== uid && !used.has(d.uid)).map((d) => [d.uid, `${d.title} · ${e.name}`]))
    : (linkable.data?.templates || []).filter((t) => !used.has(t.slug)).map((t) => [t.slug, t.title]);
  async function add(e) {
    e.preventDefault();
    if (!ref) { setError('Choose a document to link.'); return; }
    setBusy(true); setError('');
    try { await adminGovernanceApi.relate(uid, { kind, ref }); setRef(''); onLinked?.(); }
    catch (err) { reportError('governance:related-link', err); setError(err?.message || 'The link could not be saved. Nothing was saved.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={add} aria-labelledby="rel-add" className={`${card} space-y-2 p-3 text-[12.5px]`}>
    <h4 id="rel-add" className="text-[13px] font-bold">Link a document this record governs</h4>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[11px] font-semibold">Kind
        <select className={`${input} mt-1`} value={kind} onChange={(e) => { setKind(e.target.value); setRef(''); setError(''); }}>
          <option value="governance">Governance record</option><option value="template">Template</option></select></label>
      <label className="min-w-[220px] flex-1 text-[11px] font-semibold">Document
        <select className={`${input} mt-1`} value={ref} onChange={(e) => setRef(e.target.value)} aria-describedby={error ? 'rel-add-error' : undefined}>
          <option value="">{kind === 'template' && linkable.loading ? 'Loading templates…' : options.length ? 'Choose…' : 'Nothing left to link'}</option>
          {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <button type="submit" className={`${button} min-h-[44px] md:min-h-0`} disabled={busy}>Link</button>
    </div>
    {kind === 'template' && linkable.error && <p className="text-[11px] text-red-700 dark:text-red-300">Unreadable: the template library could not be read.</p>}
    {error && <p id="rel-add-error" role="alert" className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}
    <p className="text-[11px] text-axal-muted">A link is a reference: it changes neither document. Linking flags nothing; the next time this record becomes Approved or Executed at a newer version, each linked document is flagged for review.</p>
  </form>;
}
