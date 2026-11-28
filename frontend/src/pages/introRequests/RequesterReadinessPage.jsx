/**
 * D9068 (#9068): Network › Introductions › Request readiness, to the canvas
 * `design/incoming/Network Requester Profile and Readiness Page.dc.html` (D7677, boards NRD-01, NRD-03, NRD-04,
 * NRD-10, NRD-12, NRD-13), at `/network/introductions/readiness`.
 *
 * EVERY VALUE IS THE WORKER'S. `GET /api/intro-requests/readiness` answers the active policy, each requirement's
 * status from stored reviews, and `ready`. This page groups and words them; it never decides a member is ready. A
 * read that fails reads Unreadable, which is never ready, and the draft it came from stays as it was.
 *
 * SAVING CONTACTS NOBODY. `PUT /readiness/:key` stores the shareable value and sends it back to review; a failed
 * save keeps what was typed. `?draft=<uid>` carries the draft the member came from, so Return goes back to it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataState } from '../../ui/Honesty';
import { introRequestsApi } from '../../lib/api/introRequests.js';
import { reportError } from '../../lib/log';
import {
  AGGREGATE, CAPACITIES, aggregateLine, aggregateReadiness, capacityErrors, capacityLabel, groupRequirements,
  profileErrors, refusalSentence, requirementCopy, requirementStatus, validityLine,
} from './introRequestModel.js';
import { BTN, BTN_GHOST, BTN_PRIMARY, Card, Chip, EYE, FIELD_ERROR, Frame, HINT, INPUT, LABEL, Note, PageHeader, focusEl } from './introKit.jsx';

const GROUPS = [
  ['needs_you', '✎ Needs you'],
  ['reviewer', '◷ With a reviewer', 'no date is promised'],
  ['done', '✓ Done'],
];

function ErrorSummary({ errors, summaryRef }) {
  if (!errors.length) return null;
  return (
    <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="rq-err" className="rounded-lg border-2 border-red-600 bg-red-50 p-3 outline-none dark:border-red-400 dark:bg-red-500/10">
      <h3 id="rq-err" className="text-[14px] font-extrabold text-gray-900 dark:text-gray-100">{errors.length} {errors.length === 1 ? 'field needs' : 'fields need'} attention</h3>
      <ul className="mt-1 list-disc pl-5 text-[13px]">
        {errors.map((x) => <li key={x.field}><a href={`#rq-${x.field}`} className="font-semibold text-red-800 underline dark:text-red-300">{x.message}</a></li>)}
      </ul>
    </div>
  );
}

/** NRD-04: the professional profile, as the base policy holds it (headline and an optional https link). */
function ProfileForm({ row, onSaved, onCancel }) {
  const [form, setForm] = useState({ headline: row?.value?.headline || '', profile_url: row?.value?.profile_url || '' });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const summary = useRef(null);
  const byField = Object.fromEntries(errors.map((x) => [x.field, x.message]));
  const save = async (ev) => {
    ev.preventDefault();
    const errs = profileErrors(form);
    setErrors(errs);
    if (errs.length) { setTimeout(() => focusEl(summary.current), 0); return; }
    setBusy(true); setFailed(null);
    try {
      const out = await introRequestsApi.putReadiness('professional_profile', { headline: form.headline.trim(), ...(form.profile_url ? { profile_url: form.profile_url.trim() } : {}) });
      onSaved(out, 'Profile saved. It is with a reviewer.');
    } catch (e) {
      reportError('intro-requests:readiness-profile', e);
      setFailed(refusalSentence(e));
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3 border-t border-gray-200 pt-3 dark:border-gray-700" aria-label="Professional profile">
      <ErrorSummary errors={errors} summaryRef={summary} />
      <fieldset className="flex flex-col gap-3">
        <legend className={EYE}>Professional profile · shareable</legend>
        <div>
          <label htmlFor="rq-headline" className={LABEL}>Headline <span className="font-normal text-gray-600 dark:text-gray-400">(required)</span></label>
          <input id="rq-headline" className={`${INPUT} mt-1`} value={form.headline} maxLength={300} aria-invalid={byField.headline ? 'true' : undefined} aria-describedby={byField.headline ? 'rq-headline-e' : 'rq-headline-h'} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
          {byField.headline ? <span id="rq-headline-e" className={FIELD_ERROR}>✕ {byField.headline}</span> : <span id="rq-headline-h" className={HINT}>What you do, in one line. Example: “Seed investor in health software.” {Array.from(form.headline).length} / 300</span>}
        </div>
        <div>
          <label htmlFor="rq-profile_url" className={LABEL}>Profile link <span className="font-normal text-gray-600 dark:text-gray-400">(optional)</span></label>
          <input id="rq-profile_url" type="url" inputMode="url" className={`${INPUT} mt-1`} value={form.profile_url} aria-invalid={byField.profile_url ? 'true' : undefined} aria-describedby={byField.profile_url ? 'rq-profile_url-e' : undefined} onChange={(e) => setForm({ ...form, profile_url: e.target.value })} />
          {byField.profile_url ? <span id="rq-profile_url-e" className={FIELD_ERROR}>✕ {byField.profile_url}</span> : null}
        </div>
      </fieldset>
      {failed ? <Note tone="bad" glyph="!" role="alert"><b>Not saved.</b> {failed} Everything you typed is kept here.</Note> : null}
      <p className={HINT}>Visible to you and Axal reviewers. Saving sends it for review again and contacts nobody.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : failed ? 'Try again' : 'Save profile'}</button>
        <button type="button" className={BTN} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** NRD-03 and NRD-03 B: the capacity asked in, and the organisation represented, if any. */
function CapacityForm({ row, onSaved, onCancel }) {
  const [form, setForm] = useState({ capacity: row?.value?.capacity || '', represented_organization: row?.value?.represented_organization || '' });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const summary = useRef(null);
  const byField = Object.fromEntries(errors.map((x) => [x.field, x.message]));
  const known = CAPACITIES.some((c) => c.value === form.capacity);
  const save = async (ev) => {
    ev.preventDefault();
    const errs = capacityErrors(form);
    setErrors(errs);
    if (errs.length) { setTimeout(() => focusEl(summary.current), 0); return; }
    setBusy(true); setFailed(null);
    try {
      const out = await introRequestsApi.putReadiness('capacity', { capacity: form.capacity, ...(form.represented_organization.trim() ? { represented_organization: form.represented_organization.trim() } : {}) });
      onSaved(out, `Capacity saved as ${capacityLabel(form.capacity)}. It is with a reviewer.`);
    } catch (e) {
      reportError('intro-requests:readiness-capacity', e);
      setFailed(refusalSentence(e));
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3 border-t border-gray-200 pt-3 dark:border-gray-700" aria-label="Capacity">
      <ErrorSummary errors={errors} summaryRef={summary} />
      <fieldset id="rq-capacity" tabIndex={-1} className="flex flex-col gap-2 outline-none" aria-describedby={byField.capacity ? 'rq-capacity-e' : undefined}>
        <legend className={EYE}>You are asking as</legend>
        {CAPACITIES.map((c) => (
          <label key={c.value} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${form.capacity === c.value ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-500/10' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'}`}>
            <input type="radio" name="rq-capacity" value={c.value} checked={form.capacity === c.value} onChange={() => setForm({ ...form, capacity: c.value })} className="h-4 w-4 accent-violet-700" />
            <span><b className="text-[13.5px] text-gray-900 dark:text-gray-100">{c.label}</b><span className="block text-[12px] text-gray-600 dark:text-gray-400">{c.hint}</span></span>
          </label>
        ))}
        {form.capacity && !known ? <p className={HINT}>On record: “{form.capacity}”. Choosing one above replaces it.</p> : null}
        {byField.capacity ? <span id="rq-capacity-e" className={FIELD_ERROR}>✕ {byField.capacity}</span> : null}
      </fieldset>
      <div>
        <label htmlFor="rq-represented_organization" className={LABEL}>Organisation you represent <span className="font-normal text-gray-600 dark:text-gray-400">(optional)</span></label>
        <input id="rq-represented_organization" className={`${INPUT} mt-1`} value={form.represented_organization} maxLength={300} aria-invalid={byField.represented_organization ? 'true' : undefined} onChange={(e) => setForm({ ...form, represented_organization: e.target.value })} />
        <span className={HINT}>Leave it empty to ask for yourself. You cannot confirm your own authority; an Axal reviewer does.</span>
        {byField.represented_organization ? <span className={FIELD_ERROR}>✕ {byField.represented_organization}</span> : null}
      </div>
      {failed ? <Note tone="bad" glyph="!" role="alert"><b>Not saved.</b> {failed} Your choice is kept here.</Note> : null}
      <p className={HINT}>Changing capacity sends it for review again. Your drafts stay as they are.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : failed ? 'Try again' : 'Save capacity'}</button>
        <button type="button" className={BTN} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const FORMS = { professional_profile: ProfileForm, capacity: CapacityForm };

function RequirementRow({ row, policy, open, onOpen, onClose, onSaved }) {
  const copy = requirementCopy(row.key);
  const st = requirementStatus(row.status);
  const Form = FORMS[row.key];
  const valid = validityLine(row, policy);
  return (
    <li className={`flex flex-col gap-2 rounded-lg border p-3 ${st.group === 'needs_you' ? 'border-amber-300 dark:border-amber-500/50' : 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-900`} data-requirement={row.key}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[14px] text-gray-900 dark:text-gray-100">{copy.title}</b>
        <span className="rounded border border-gray-300 px-1.5 text-[10.5px] font-bold uppercase text-gray-700 dark:border-gray-600 dark:text-gray-300">Required</span>
        <Chip s={st} extra={row.status === 'expired' && row.valid_until ? `on ${String(row.valid_until).slice(0, 10)}` : null} />
        {Form && !open ? <button type="button" className={`${BTN} ml-auto`} onClick={onOpen}>{copy.action}<span className="sr-only"> · {copy.title}</span></button> : null}
      </div>
      {copy.why ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400">{copy.why}</p> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-gray-700 dark:text-gray-300">
        <span><em className="not-italic text-gray-600 dark:text-gray-400">Next </em>{st.next}</span>
        <span><em className="not-italic text-gray-600 dark:text-gray-400">On record </em>{row.value ? (row.key === 'capacity' ? capacityLabel(row.value.capacity) : row.value.headline || 'Saved') : 'Nothing yet'}</span>
        <span><em className="not-italic text-gray-600 dark:text-gray-400">Reviewed </em>{row.reviewed_at ? String(row.reviewed_at).slice(0, 10) : '—'}</span>
        {valid ? <span><em className="not-italic text-gray-600 dark:text-gray-400">Valid </em>{valid}</span> : null}
        <span><em className="not-italic text-gray-600 dark:text-gray-400">Evidence </em>{row.has_evidence_ref ? 'A reference is on record (private)' : 'None'}</span>
      </div>
      {open && Form ? <Form row={row} onSaved={onSaved} onCancel={onClose} /> : null}
    </li>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading readiness">
      <p role="status" className="text-[12.5px] text-gray-600 dark:text-gray-400">◌ Loading · readiness for your requests. No counts until the read answers.</p>
      {[90, 70, 80].map((w) => <span key={w} className="block h-3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" style={{ width: `${w}%` }} />)}
    </div>
  );
}

export default function RequesterReadinessPage() {
  const [params] = useSearchParams();
  const draft = params.get('draft');
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [open, setOpen] = useState(params.get('edit'));
  const [said, setSaid] = useState('');
  const load = useCallback(() => {
    setRead((r) => ({ status: 'loading', data: r.data }));
    introRequestsApi.readiness()
      .then((data) => setRead({ status: 'ok', data }))
      .catch((e) => { reportError('intro-requests:readiness', e); setRead({ status: 'error', data: null, code: e?.code }); });
  }, []);
  useEffect(load, [load]);

  const data = read.status === 'ok' ? read.data : null;
  const agg = read.status === 'loading' ? null : aggregateReadiness(data);
  const line = aggregateLine(data);
  const groups = groupRequirements(data?.requirements);
  const profile = data?.requirements?.find((r) => r.key === 'professional_profile');
  const capacity = data?.requirements?.find((r) => r.key === 'capacity');
  const reviewed = (data?.requirements || []).filter((r) => r.reviewed_at).length;
  const onSaved = (out, sentence) => { setRead({ status: 'ok', data: out }); setOpen(null); setSaid(sentence); };
  const back = draft ? `/network/introductions/requests/new?draft=${encodeURIComponent(draft)}&step=4` : null;

  return (
    <Frame bar={back ? <Link to={back} className={`${BTN_PRIMARY} flex-1`}>Return to introduction</Link> : null}>
      <PageHeader
        crumb={[{ label: 'Introductions', to: '/network/introductions/requests' }, ...(draft ? [{ label: 'Your draft', to: back }] : []), { label: 'Request readiness' }]}
        eye="Network · Introductions · requester readiness"
        title="Request readiness"
        sub="What Axal’s policy asks of you before a request goes to an operator: what is done, what needs you and what awaits review."
        actions={back ? <Link to={back} className={`${BTN_PRIMARY} hidden lg:inline-flex`}>Return to introduction →</Link> : <Link to="/network/introductions/requests/new" className={BTN}>Request an introduction</Link>}
      />
      <div aria-live="polite" className="sr-only">{said}</div>
      {draft ? (
        <Note glyph="✎"><b>Your draft is saved.</b> Its person, purpose and brief stay as you left them while you work here.</Note>
      ) : null}

      {read.status === 'loading' && !read.data ? <Card><Skeleton /></Card> : null}

      {read.status === 'error' ? (
        <Card tone="bad" title="Ready to request?" id="rq-agg">
          <Chip s={AGGREGATE.unr} />
          <DataState state="unavailable" size="block" what="Your readiness" claim="It is never shown as ready, and submitting stays off. Your draft is kept." onRetry={load} retryLabel="Try again" />
        </Card>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:grid-cols-3">
            <div><span className={EYE}>Asking as</span><b className="block text-[14px] text-gray-900 dark:text-gray-100">{capacity?.value?.capacity ? capacityLabel(capacity.value.capacity) : 'Not chosen yet'}</b><small className="text-[12px] text-gray-600 dark:text-gray-400">{capacity?.value?.represented_organization ? `for ${capacity.value.represented_organization}` : 'for yourself'}</small></div>
            <div><span className={EYE}>Request</span><b className="block text-[14px] text-gray-900 dark:text-gray-100">Introduction through Axal</b><small className="text-[12px] text-gray-600 dark:text-gray-400">to a person in or outside the directory</small></div>
            <div><span className={EYE}>Policy</span><b className="block font-mono text-[14px] text-gray-900 dark:text-gray-100">v{data.policy?.version}</b><small className="text-[12px] text-gray-600 dark:text-gray-400">{(data.policy?.requirements || []).length} required items · set by Axal</small></div>
          </div>

          <Card title="Ready to request?" id="rq-agg" tone={agg === 'ready' ? 'good' : agg === 'unr' || agg === 'blk' ? 'bad' : 'warn'}>
            <div className="flex flex-wrap items-center gap-2" data-aggregate={agg}>
              <Chip s={AGGREGATE[agg]} />
              <span className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">
                {agg === 'ready' ? 'Every required item is approved.' : agg === 'unr' ? 'Your readiness could not be read in full, so it is not shown as ready.' : `Not yet: ${line.rest || 'items remain'}.`}
              </span>
            </div>
            <p className="text-[12.5px] text-gray-600 dark:text-gray-400">{line.done} of {line.total} required items are approved. Decided by the server from stored reviews; checked again when you submit. You can keep browsing and editing your drafts meanwhile.</p>
          </Card>

          <section aria-label="Separate facts, each with its own date" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <span className={EYE}>Profile completeness</span>
              <Chip s={profile ? requirementStatus(profile.status) : null} className="self-start" />
              <small className="text-[12px] text-gray-600 dark:text-gray-400">{profile?.value?.headline ? 'Headline on record' : 'No headline yet'}</small>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <span className={EYE}>Identity verification</span>
              <DataState state="not_applicable" reason={`policy v${data.policy?.version} does not ask for it`} />
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <span className={EYE}>Review</span>
              <b className="text-[13.5px] text-gray-900 dark:text-gray-100">{reviewed} of {line.total} reviewed</b>
              <small className="text-[12px] text-gray-600 dark:text-gray-400">{groups.reviewer.length} with a reviewer</small>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <span className={EYE}>Eligible to request</span>
              <Chip s={data.ready === true && agg === 'ready' ? AGGREGATE.ready : { word: 'Not yet', glyph: '○', tone: 'plain' }} className="self-start" />
              <small className="text-[12px] text-gray-600 dark:text-gray-400">Decided by the server · policy v{data.policy?.version}</small>
            </div>
          </section>
          <p className="text-[12px] text-gray-600 dark:text-gray-400">A legal agreement is not part of readiness. The Trust Center NDA step still follows only an accepted investor ask to a founder on Axal.</p>

          <Card title="Requirements" id="rq-list" aside={`${line.total} required · policy v${data.policy?.version}`}>
            {GROUPS.map(([key, label, foot]) => groups[key].length ? (
              <div key={key} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2"><h3 className="text-[13px] font-extrabold text-gray-900 dark:text-gray-100">{label} · {groups[key].length}</h3>{foot ? <span className="text-[11.5px] text-gray-600 dark:text-gray-400">{foot}</span> : null}</div>
                <ul className="flex flex-col gap-2">
                  {groups[key].map((row) => (
                    <RequirementRow key={row.key} row={row} policy={data.policy} open={open === row.key} onOpen={() => { setOpen(row.key); setSaid(''); }} onClose={() => setOpen(null)} onSaved={onSaved} />
                  ))}
                </ul>
              </div>
            ) : null)}
            <p className="text-[12px] text-gray-600 dark:text-gray-400">Axal’s policy sets these items. A saved item is not an approval: an Axal reviewer decides, and a change goes back to review.</p>
          </Card>
          {!back ? <Link to="/network/introductions/requests" className={`${BTN_GHOST} self-start`}>Back to your requests</Link> : null}
        </>
      ) : null}
    </Frame>
  );
}
