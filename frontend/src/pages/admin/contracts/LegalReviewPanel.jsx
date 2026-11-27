import React, { useState } from 'react';
import { adminLegalReviewsApi } from '../../../lib/api/adminLegalReviews';
import { reportError } from '../../../lib/log';
import { DECISION_LABELS, REVIEW_TYPE_LABELS, canDecide, lastReviewLine, reviewBadge, reviewFields, versionBound } from './legalReviewModel';
import { Missing, ReadState, button, card, input, useRead } from './parts';

/**
 * D4811 (#4811) part 16 — the Legal Review tab (board CT-08) for a template
 * or a governance record: the latest review's eleven fields bound to the
 * reviewed version's hash, earlier reviews, "Request legal review" (any HQ
 * admin, naming counsel), the decision form for the assigned counsel only,
 * and the counsel list the Super Admin keeps. Every rule is checked again by
 * `routes/admin_legal_reviews.ts`; its refusals are printed as they come.
 */
const TONES = { seal: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900', amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200', red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200', muted: 'border border-axal-hairline text-axal-muted' };
export function ReviewPill({ state }) {
  const b = reviewBadge(state);
  return b ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONES[b.tone]}`} data-testid="review-pill">{b.label}</span> : null;
}

/** The Overview's "Last review" line, read on its own. */
export function LastReview({ kind, refId }) {
  const read = useRead(() => adminLegalReviewsApi.list(kind, refId), [kind, refId]);
  if (read.loading) return <span className="text-axal-muted">Reading…</span>;
  if (read.error) return <span className="text-axal-muted">Unreadable</span>;
  return lastReviewLine(read.data?.reviews) || <Missing reason="No legal review has been recorded." />;
}

export default function LegalReviewPanel({ kind, refId }) {
  const [rev, setRev] = useState(0);
  const read = useRead(() => adminLegalReviewsApi.list(kind, refId), [kind, refId, rev]);
  const reload = () => setRev((n) => n + 1);
  return <div className={`${card} space-y-3 p-4 text-[12.5px]`} data-testid="legal-review-panel">
    <ReadState read={read} what="Legal review">{read.data && <Body data={read.data} kind={kind} refId={refId} onChanged={reload} />}</ReadState>
  </div>;
}

function Body({ data, kind, refId, onChanged }) {
  const [latest, ...earlier] = data.reviews;
  const [requesting, setRequesting] = useState(false);
  return <>
    {latest ? <section aria-label="Latest review" className="space-y-2">
      <h3 className="flex flex-wrap items-center gap-2 font-bold">Review LR-{latest.id} <ReviewPill state={latest.state} /></h3>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[180px_minmax(0,1fr)]">{reviewFields(latest).map(([k, v, why]) => <React.Fragment key={k}>
        <dt className="text-axal-muted">{k}</dt><dd className="font-semibold">{v ?? <Missing reason={why} />}</dd></React.Fragment>)}</dl>
      {latest.state === 'superseded' && <p className="text-axal-muted">A newer version exists (v{data.object.version}). This review is bound to {versionBound(latest)} and can no longer be decided; request a review of the current version.</p>}
      {canDecide(latest, data.viewer) && <DecisionForm review={latest} onDone={onChanged} />}
      {!canDecide(latest, data.viewer) && latest.state === 'pending' && <p className="text-axal-muted">Only the assigned counsel records the decision.</p>}
    </section> : <p><Missing reason="No legal review has been requested for this document." /></p>}
    <div className="flex flex-wrap gap-2">
      {data.object.version != null && !requesting && <button type="button" className={button} onClick={() => setRequesting(true)}>Request legal review</button>}
      {data.object.version == null && <p className="text-axal-muted">There is no version to review yet.</p>}
    </div>
    {requesting && <RequestForm data={data} kind={kind} refId={refId} onCancel={() => setRequesting(false)} onDone={() => { setRequesting(false); onChanged(); }} />}
    {earlier.length > 0 && <section aria-label="Previous reviews"><h3 className="font-bold">Previous reviews</h3>
      <ul className="divide-y divide-axal-hairline">{earlier.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
        <span>v{r.version} · {REVIEW_TYPE_LABELS[r.review_type] || r.review_type} review{r.reviewer?.name ? ` · ${r.reviewer.name}` : ''}</span><ReviewPill state={r.state} /></li>)}</ul></section>}
    <p className="text-[11px] text-axal-muted">Counsel's recorded decision is the only approval. Eadwyn's research in the rail is not approval.</p>
    {data.viewer.super_admin && <CounselList counsel={data.counsel} onChanged={onChanged} />}
  </>;
}

function RequestForm({ data, kind, refId, onCancel, onDone }) {
  const [form, setForm] = useState({ reviewer_id: '', review_type: '', jurisdiction: '', due_on: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function send() {
    setBusy(true); setError('');
    try { await adminLegalReviewsApi.request({ kind, ref: refId, ...form, reviewer_id: Number(form.reviewer_id) }); onDone(); }
    catch (e) { reportError('legal-review:request', e); setError(e?.message || 'The request was not recorded.'); }
    finally { setBusy(false); }
  }
  return <div role="group" aria-label="Request legal review" className="space-y-2 rounded-lg border border-axal-hairline p-3" data-testid="legal-review-request">
    <p>Review of v{data.object.version} · sha {String(data.object.sha256).slice(0, 4)}…{String(data.object.sha256).slice(-4)}. A newer version will need its own review.</p>
    {data.counsel.length === 0 && <p className="text-axal-muted">No one holds the counsel role yet. The Super Admin grants it below.</p>}
    <label className="block font-semibold">Counsel<select className={input} value={form.reviewer_id} onChange={set('reviewer_id')}>
      <option value="">Choose counsel</option>{data.counsel.map((c) => <option key={c.user_id} value={c.user_id}>{c.name || `Admin #${c.user_id}`}{c.firm ? ` · ${c.firm}` : ''}</option>)}</select></label>
    <label className="block font-semibold">Review type<select className={input} value={form.review_type} onChange={set('review_type')}>
      <option value="">Choose a type</option>{Object.entries(REVIEW_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <label className="block font-semibold">Jurisdiction<input className={input} maxLength={120} value={form.jurisdiction} onChange={set('jurisdiction')} placeholder="e.g. Delaware, United States (never assumed)" /></label>
    <label className="block font-semibold">Due on<input type="date" className={input} value={form.due_on} onChange={set('due_on')} /></label>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    <div className="flex gap-2"><button type="button" className={button} onClick={onCancel}>Cancel</button>
      <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy || !form.reviewer_id || !form.review_type || !form.jurisdiction.trim()} onClick={send}>{busy ? 'Requesting…' : 'Request review'}</button></div>
  </div>;
}

function DecisionForm({ review, onDone }) {
  const [form, setForm] = useState({ decision: '', findings: '', required_changes: '', sources: '', next_review_on: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function send() {
    setBusy(true); setError('');
    try { await adminLegalReviewsApi.decide(review.id, form); onDone(); }
    catch (e) { reportError('legal-review:decide', e); setError(e?.message || 'The decision was not recorded.'); }
    finally { setBusy(false); }
  }
  return <div role="group" aria-label="Record the counsel decision" className="space-y-2 rounded-lg border border-axal-hairline p-3" data-testid="legal-review-decision">
    <p className="font-semibold">Your decision, against {versionBound(review)}. It is recorded once, under your name, after you confirm who you are.</p>
    <label className="block font-semibold">Decision<select className={input} value={form.decision} onChange={set('decision')}>
      <option value="">Choose</option>{Object.entries(DECISION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <label className="block font-semibold">Findings<textarea className={input} rows={2} maxLength={4000} value={form.findings} onChange={set('findings')} /></label>
    <label className="block font-semibold">Required changes<textarea className={input} rows={2} maxLength={4000} value={form.required_changes} onChange={set('required_changes')} /></label>
    <label className="block font-semibold">Source references<input className={input} maxLength={2000} value={form.sources} onChange={set('sources')} /></label>
    <label className="block font-semibold">Next review<input type="date" className={input} value={form.next_review_on} onChange={set('next_review_on')} /></label>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy || !form.decision} onClick={send}>{busy ? 'Recording…' : 'Record decision'}</button>
  </div>;
}

function CounselList({ counsel, onChanged }) {
  const [userId, setUserId] = useState('');
  const [firm, setFirm] = useState('');
  const [error, setError] = useState('');
  async function act(fn) {
    setError('');
    try { await fn(); setUserId(''); setFirm(''); onChanged(); }
    catch (e) { reportError('legal-review:counsel', e); setError(e?.message || 'The counsel list was not changed.'); }
  }
  return <section aria-label="Counsel" className="space-y-2 border-t border-axal-hairline pt-3" data-testid="counsel-list">
    <h3 className="font-bold">Counsel (the Super Admin keeps this list)</h3>
    {counsel.length ? <ul className="space-y-1">{counsel.map((c) => <li key={c.user_id} className="flex flex-wrap items-center justify-between gap-2">
      <span>{c.name || `Admin #${c.user_id}`}{c.firm ? ` · ${c.firm}` : ''}{c.email_hint ? ` · ${c.email_hint}` : ''}</span>
      <button type="button" className={button} onClick={() => act(() => adminLegalReviewsApi.revokeCounsel(c.user_id))}>Remove</button></li>)}</ul>
      : <p className="text-axal-muted">No one holds the counsel role.</p>}
    <div className="flex flex-wrap items-end gap-2">
      <label className="font-semibold">Account id<input className={input} inputMode="numeric" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ''))} /></label>
      <label className="font-semibold">Firm<input className={input} maxLength={200} value={firm} onChange={(e) => setFirm(e.target.value)} /></label>
      <button type="button" className={button} disabled={!userId} onClick={() => act(() => adminLegalReviewsApi.grantCounsel(userId, firm))}>Grant counsel</button>
    </div>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
  </section>;
}
