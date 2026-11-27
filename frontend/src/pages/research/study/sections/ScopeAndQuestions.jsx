/**
 * D7729 (#7729, canvas D7703-p2 RST-03, RST-14 C and D, RST-15 C) — the study's
 * first section, Scope and questions: its Scope half. The product and the
 * decision it informs, the horizon, the customer segments (one beachhead), the
 * linked venture and where the study started. The questions half is #7730.
 *
 * WHAT IS STORED. Exactly the fields of the study record and its segments
 * (D7719): a PUT replaces the study with the version read, so a stale save is
 * 409 `study_changed` and writes nothing ("Someone saved this scope first";
 * the edits are kept). Segments save one at a time; a segment is archived,
 * never deleted. Every refusal is shown in the Worker's words.
 *
 * CUSTOMER GEOGRAPHY is a segment's own customer countries. It starts empty and
 * is never filled from the Markets filters the study started from, which say
 * where listed companies are based. Owner answer Q5 A: when the study started
 * with a country filter, Scope offers "Use [Germany] as customer geography?"
 * for one segment, and only a press of Use writes it.
 *
 * THE VENTURE is the one the study names (D7719, owner answer A): read here as
 * linked, none, or one you can no longer read (no name shown). Linking uses the
 * venture open in the company switcher; there is no picker on this page.
 */
import React, { useEffect, useRef, useState } from 'react';
import { DataState, StateChip } from '../../../../ui/Honesty';
import { useActiveProject } from '../../../../lib/activeProject.js';
import { researchStudiesApi } from '../../../../lib/api/researchStudies.js';
import { countryName } from '../../marketDirectoryQuery.js';
import {
  HORIZON_MONTHS_MAX, INDUSTRY_SCHEMES, SEGMENT_LIMITS, SEGMENT_MAX, STATISTICAL_UNITS, STUDY_LIMITS,
  countriesWords, geographyOffer, originOf, scopeBody, scopeDraft, scopeErrors, segmentBody, segmentDraft,
  segmentEditable, segmentErrors, segmentRows,
} from '../studyModel.js';
import {
  CARD, DD, DT, INPUT, MUTED, OriginLines, PRIMARY, SECONDARY, Shown, TEXT_BTN, FromOverview,
} from '../StudyParts.jsx';

const ERROR = 'text-[12px] font-semibold text-red-700 dark:text-red-300';
const H3 = 'text-[14px] font-extrabold text-axal-ink dark:text-white';

function Field({ id, label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] font-bold text-axal-ink dark:text-white">{label}{hint ? <span className="font-normal text-axal-muted dark:text-gray-400"> · {hint}</span> : null}</label>
      {children}
      {error ? <span id={`${id}-error`} role="alert" className={ERROR}>{error}</span> : null}
    </div>
  );
}

function TextInput({ id, value, onChange, max, area = false, rows = 2, error, testid, ...rest }) {
  const props = {
    id, value, onChange, maxLength: max, className: INPUT, 'data-testid': testid,
    'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${id}-error` : undefined, ...rest,
  };
  return area ? <textarea rows={rows} {...props} /> : <input {...props} />;
}

/** A refusal or failure in the Worker's words, with what was kept. */
function Failure({ failure, testid }) {
  if (!failure) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid={testid}>
      <StateChip kind={failure.refused ? 'refused' : 'unavailable'} label={failure.refused ? 'Refused' : 'Save failed'} />
      <span>{failure.message} {failure.kept || 'Your edits are kept. Nothing was saved.'}</span>
    </div>
  );
}
const failureOf = (err, kept) => ({
  message: err?.message || 'The save did not finish.',
  refused: Number(err?.status) >= 400 && Number(err?.status) < 500,
  kept,
});

// ---- Product and decision ---------------------------------------------------------------

function ProductForm({ draft, setField, errors }) {
  const f = (name, label, opts = {}) => (
    <Field id={`study-${name}`} label={label} hint={opts.hint} error={errors[name]}>
      <TextInput id={`study-${name}`} value={draft[name]} onChange={(e) => setField(name, e.target.value)} max={STUDY_LIMITS[name]}
        area={opts.area} rows={opts.rows} error={errors[name]} testid={`input-study-${name}`} />
    </Field>
  );
  return (
    <section className={CARD} aria-labelledby="study-product-h">
      <h3 id="study-product-h" className={H3}>Product and decision</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {f('product', 'Product')}
        {f('business_model', 'Business model')}
      </div>
      {f('product_boundary', 'Product boundary', { area: true, hint: 'what is in and what is out' })}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        {f('decision', 'The decision to be made', { area: true })}
        <Field id="study-horizon_months" label="Horizon" hint="months" error={errors.horizon_months}>
          <TextInput id="study-horizon_months" value={draft.horizon_months} inputMode="numeric" onChange={(e) => setField('horizon_months', e.target.value)}
            max={3} error={errors.horizon_months} testid="input-study-horizon_months" placeholder={`1 to ${HORIZON_MONTHS_MAX}`} />
        </Field>
      </div>
    </section>
  );
}

function ProductRead({ study }) {
  const rows = [
    ['Product', study?.product], ['Business model', study?.business_model], ['Product boundary', study?.product_boundary],
    ['The decision to be made', study?.decision], ['Horizon', study?.horizon_months != null ? `${study.horizon_months} months` : null],
  ];
  return (
    <section className={CARD} aria-labelledby="study-product-h" data-testid="study-product-read">
      <h3 id="study-product-h" className={H3}>Product and decision</h3>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[170px_minmax(0,1fr)]">
        {rows.map(([k, v]) => <React.Fragment key={k}><dt className={DT}>{k}</dt><dd className={DD}><Shown value={v} /></dd></React.Fragment>)}
      </dl>
    </section>
  );
}

// ---- Segments ----------------------------------------------------------------------------

function SegmentForm({ seg, onCancel, onSaved, projectUid }) {
  const [draft, setDraft] = useState(() => segmentDraft(seg));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const set = (name) => (e) => setDraft((d) => ({ ...d, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const id = (name) => `seg-${seg?.uid || 'new'}-${name}`;
  const save = async (e) => {
    e?.preventDefault?.();
    const found = segmentErrors(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    try {
      if (seg) await researchStudiesApi.saveSegment(projectUid, seg.uid, segmentBody(draft, seg.version));
      else await researchStudiesApi.addSegment(projectUid, segmentBody(draft));
      await onSaved(seg ? `Segment saved: ${draft.name.trim()}.` : `Segment added: ${draft.name.trim()}.`);
    } catch (err) {
      setFailure(err?.code === 'segment_changed'
        ? { message: 'Someone saved this segment first. Nothing was overwritten.', kept: 'Your edits are kept; cancel and edit again to start from the saved segment.' }
        : failureOf(err));
    } finally {
      setBusy(false);
    }
  };
  const text = (name, label, opts = {}) => (
    <Field id={id(name)} label={label} hint={opts.hint} error={errors[name]}>
      <TextInput id={id(name)} value={draft[name]} onChange={set(name)} max={opts.max ?? SEGMENT_LIMITS[name]} area={opts.area}
        error={errors[name]} testid={`input-segment-${name}`} />
    </Field>
  );
  const select = (name, label, options) => (
    <Field id={id(name)} label={label} error={errors[name]}>
      <select id={id(name)} value={draft[name]} onChange={set(name)} className={`${INPUT} min-h-[44px] sm:min-h-0`} data-testid={`input-segment-${name}`}>
        <option value="">Not recorded</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
  return (
    <form className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-800 dark:bg-violet-950/20" onSubmit={save}
      aria-label={seg ? `Edit ${seg.name}` : 'Add a segment'} data-testid={seg ? `form-segment-${seg.uid}` : 'form-segment-new'}>
      <div className="grid gap-3 sm:grid-cols-2">
        {text('name', 'Segment name', { hint: 'required' })}
        <label className="flex min-h-[44px] items-center gap-2 self-end text-[12.5px] font-bold text-axal-ink dark:text-white">
          <input type="checkbox" checked={draft.beachhead} onChange={set('beachhead')} data-testid="input-segment-beachhead" /> Beachhead segment
        </label>
        {text('buyer', 'Buyer')}
        {text('end_user', 'User')}
        {text('budget_holder', 'Budget holder')}
        {text('purchasing_unit', 'Purchasing unit')}
        {select('statistical_unit', 'What is counted', STATISTICAL_UNITS)}
        {text('size_band', 'Size band')}
        {select('industry_scheme', 'Industry scheme', INDUSTRY_SCHEMES)}
        {text('industry_codes', 'Industry codes', { hint: 'separated by commas', max: 400 })}
      </div>
      {text('customer_countries', 'Customer countries', { hint: 'two-letter codes, such as DE, FR; where the customers are', max: 400 })}
      {text('exclusions', 'Exclusions', { area: true })}
      <div className="grid gap-3 sm:grid-cols-2">
        {text('sample_note', 'Sample note', { area: true })}
        {text('sample_limits', 'Sample limits', { area: true })}
      </div>
      <Failure failure={failure} testid="status-segment-failed" />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={SECONDARY} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className={PRIMARY} disabled={busy} data-testid="button-save-segment">{busy ? 'Saving…' : seg ? 'Save segment' : 'Add segment'}</button>
      </div>
    </form>
  );
}

function ValidateLink({ v }) {
  if (!v) return <DataState state="none">None linked</DataState>;
  if (v.state === 'readable') return <span>{v.name || 'Unnamed segment'}{v.archived ? ' · archived in Validate' : ''}</span>;
  if (v.state === 'no_access') return <StateChip kind="refused" label="Cannot read" />;
  return <StateChip kind="unavailable" />;
}

function SegmentCard({ seg, index, count, archived, busy, act, onEdit }) {
  const editable = segmentEditable(seg);
  const rows = segmentRows(seg);
  const btn = `${SECONDARY} !min-h-[44px] sm:!min-h-[32px]`;
  return (
    <article className={`flex flex-col gap-2 rounded-lg border p-3 ${seg.beachhead ? 'border-violet-400 dark:border-violet-600' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`segment-${seg.uid}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[14px] text-axal-ink dark:text-white">{seg.name}</b>
          {seg.beachhead
            ? <span className="rounded-full bg-violet-100 px-2 text-[11px] font-bold text-violet-800 dark:bg-violet-900/50 dark:text-violet-200" data-testid={`segment-beachhead-${seg.uid}`}><span aria-hidden="true">★ </span>Beachhead</span>
            : null}
        </div>
        {archived ? null : (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={btn} disabled={busy || index === 0} onClick={() => act('up', seg)} aria-label={`Move ${seg.name} up`}>↑</button>
            <button type="button" className={btn} disabled={busy || index === count - 1} onClick={() => act('down', seg)} aria-label={`Move ${seg.name} down`}>↓</button>
            {seg.beachhead ? null : <button type="button" className={btn} disabled={busy || !editable.ok} onClick={() => act('beachhead', seg)} data-testid={`button-beachhead-${seg.uid}`}>Mark as beachhead</button>}
            <button type="button" className={btn} disabled={busy || !editable.ok} onClick={() => onEdit(seg)} data-testid={`button-edit-segment-${seg.uid}`}>Edit</button>
            <button type="button" className={btn} disabled={busy} onClick={() => act('archive', seg)} data-testid={`button-archive-segment-${seg.uid}`}>Archive</button>
          </div>
        )}
      </div>
      {!archived && !editable.ok ? <p className={MUTED}>{editable.reason}</p> : null}
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)_150px_minmax(0,1fr)]">
        {rows.slice(0, 7).map(([k, v]) => <React.Fragment key={k}><dt className={DT}>{k}</dt><dd className={DD}><Shown value={v} /></dd></React.Fragment>)}
        <dt className={DT}>Customer countries</dt>
        <dd className={DD} data-testid={`segment-countries-${seg.uid}`}>{countriesWords(seg.customer_countries) || <DataState state="none">None chosen</DataState>}</dd>
        {rows.slice(7).map(([k, v]) => <React.Fragment key={k}><dt className={DT}>{k}</dt><dd className={DD}><Shown value={v} /></dd></React.Fragment>)}
        <dt className={DT}>Validate segment</dt>
        <dd className={DD}><ValidateLink v={seg.validate_segment} /></dd>
      </dl>
    </article>
  );
}

function Segments({ projectUid, data, archived, reload, announce }) {
  const study = data?.study;
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  const archivedSegs = Array.isArray(data?.archived_segments) ? data.archived_segments : [];
  const [editing, setEditing] = useState(null); // 'new' | segment uid
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [declined, setDeclined] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const offer = archived || declined ? null : geographyOffer(study, segments);

  const run = async (fn, said) => {
    setBusy(true);
    setFailure(null);
    try { await fn(); await reload(); announce(said); } catch (err) { setFailure(failureOf(err, 'Nothing was changed.')); await reload().catch(() => {}); } finally { setBusy(false); }
  };
  const act = (kind, seg) => {
    const i = segments.findIndex((s) => s.uid === seg.uid);
    if (kind === 'up' || kind === 'down') {
      const order = segments.map((s) => s.uid);
      const j = kind === 'up' ? i - 1 : i + 1;
      [order[i], order[j]] = [order[j], order[i]];
      return run(() => researchStudiesApi.reorderSegments(projectUid, order), `Segment moved to position ${j + 1} of ${segments.length}.`);
    }
    if (kind === 'archive') return run(() => researchStudiesApi.archiveSegment(projectUid, seg.uid), `Segment archived: ${seg.name}.`);
    if (kind === 'restore') return run(() => researchStudiesApi.restoreSegment(projectUid, seg.uid), `Segment restored: ${seg.name}.`);
    if (kind === 'beachhead') {
      // One beachhead among live segments: the current one is cleared first, then this one is marked.
      const current = segments.find((s) => s.beachhead);
      return run(async () => {
        if (current) await researchStudiesApi.saveSegment(projectUid, current.uid, segmentBody({ ...segmentDraft(current), beachhead: false }, current.version));
        await researchStudiesApi.saveSegment(projectUid, seg.uid, segmentBody({ ...segmentDraft(seg), beachhead: true }, seg.version));
      }, `${seg.name} is the beachhead segment.`);
    }
    return null;
  };
  const useCountries = () => run(() => researchStudiesApi.saveSegment(projectUid, offer.segment.uid,
    segmentBody({ ...segmentDraft(offer.segment), customer_countries: offer.countries.join(', ') }, offer.segment.version)),
  `Customer countries set for ${offer.segment.name}.`);

  const names = offer ? offer.countries.map(countryName).join(', ') : '';
  return (
    <section className={CARD} aria-labelledby="study-segments-h" data-testid="study-segments">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="study-segments-h" className={H3}>Segments · {segments.length}</h3>
        {archived || !study || editing ? null : (
          <button type="button" className={SECONDARY} onClick={() => setEditing('new')} disabled={busy || segments.length >= SEGMENT_MAX}
            title={segments.length >= SEGMENT_MAX ? `A study holds at most ${SEGMENT_MAX} live segments. Archive one first.` : undefined} data-testid="button-add-segment">Add a segment</button>
        )}
      </div>
      {!study ? (
        <p className={MUTED} data-testid="segments-need-study">Segments are added to a saved study. Save the scope first.</p>
      ) : null}
      {offer ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-gray-100" data-testid="geography-offer">
          <span>You started from Markets with <b>companies based in {names}</b>.</span>
          <b>Use {names} as customer geography for {offer.segment.name}?</b>
          <button type="button" className={SECONDARY} onClick={useCountries} disabled={busy} data-testid="button-use-geography">Use {names}</button>
          <button type="button" className={TEXT_BTN} onClick={() => setDeclined(true)} disabled={busy} data-testid="button-decline-geography">No</button>
        </div>
      ) : null}
      <Failure failure={failure} testid="status-segments-failed" />
      {study && !segments.length && editing !== 'new' ? (
        <div className="flex flex-col items-start gap-1.5" data-testid="segments-empty">
          <DataState state="none">No segment</DataState>
          <p className={MUTED}>Add who you sell to: buyer, user and what is counted.</p>
        </div>
      ) : null}
      {editing === 'new' ? <SegmentForm projectUid={projectUid} onCancel={() => setEditing(null)} onSaved={async (said) => { setEditing(null); await reload(); announce(said); }} /> : null}
      {segments.map((seg, i) => (editing === seg.uid
        ? <SegmentForm key={seg.uid} seg={seg} projectUid={projectUid} onCancel={() => setEditing(null)} onSaved={async (said) => { setEditing(null); await reload(); announce(said); }} />
        : <SegmentCard key={seg.uid} seg={seg} index={i} count={segments.length} archived={archived} busy={busy} act={act} onEdit={(s) => setEditing(s.uid)} />))}
      {archivedSegs.length ? (
        <div className="flex flex-col gap-2">
          <p className={MUTED}>
            Archived segments: {archivedSegs.length} ·{' '}
            <button type="button" className={TEXT_BTN} onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived} data-testid="button-show-archived-segments">{showArchived ? 'Hide archived' : 'Show archived'}</button>
            {' '}(a segment is never deleted)
          </p>
          {showArchived ? archivedSegs.map((seg) => (
            <div key={seg.uid} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid={`archived-segment-${seg.uid}`}>
              <span className="text-[13px] text-axal-ink dark:text-gray-100">{seg.name}</span>
              {archived ? null : <button type="button" className={SECONDARY} disabled={busy} onClick={() => act('restore', seg)} data-testid={`button-restore-segment-${seg.uid}`}>Restore</button>}
            </div>
          )) : null}
        </div>
      ) : null}
    </section>
  );
}

// ---- The venture and the origin ----------------------------------------------------------

function VentureAndOrigin({ draft, setVenture, archived, study, retry }) {
  const active = useActiveProject();
  const v = draft.venture;
  const origin = originOf(study);
  let body;
  if (v.state === 'readable') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[13px] text-axal-ink dark:text-white" data-testid="study-venture-name">{v.name || 'Unnamed venture'}</b>
        {archived ? null : <button type="button" className={TEXT_BTN} onClick={() => setVenture({ state: 'none', id: null })} data-testid="button-unlink-venture">Unlink</button>}
      </div>
    );
  } else if (v.state === 'no_access') {
    body = (
      <div className="flex flex-col items-start gap-1.5" data-testid="study-venture-no-access">
        <StateChip kind="refused" label="Cannot read" />
        <p className="text-[12.5px] text-axal-ink dark:text-gray-100">A venture is linked that you can no longer read.</p>
        <p className={MUTED}>No name is shown. The venture’s founder can add you to the venture.</p>
        {archived ? null : <button type="button" className={SECONDARY} onClick={() => setVenture({ state: 'none', id: null })} data-testid="button-unlink-venture">Unlink it</button>}
      </div>
    );
  } else if (v.state === 'unreadable') {
    body = <DataState state="unavailable" what="The linked venture" claim="It is still linked." onRetry={retry} retryLabel="Try again" announce="always" />;
  } else {
    const id = active?.id != null && /^\d+$/.test(String(active.id)) ? Number(active.id) : null;
    body = (
      <div className="flex flex-col items-start gap-1.5" data-testid="study-venture-none">
        <DataState state="none">No venture linked</DataState>
        {archived ? null : id ? (
          <>
            <button type="button" className={SECONDARY} onClick={() => setVenture({ state: 'readable', id, name: active.name })} data-testid="button-link-venture">
              Link this study to {active.name || 'the open venture'}
            </button>
            <span className={MUTED}>{active.name || 'It'} is the venture open in the company switcher. Save scope to keep the link.</span>
          </>
        ) : <span className={MUTED}>Open a venture in the company switcher to link it here.</span>}
      </div>
    );
  }
  return (
    <section className={CARD} aria-labelledby="study-venture-h">
      <h3 id="study-venture-h" className={H3}>Linked venture</h3>
      {body}
      <div className="flex flex-col gap-1 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" data-testid="study-origin">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-axal-muted dark:text-gray-400">Started from · read-only</span>
        {origin ? (
          <>
            <OriginLines market={origin.market} sector={origin.sector} filters={origin.filters} />
            {origin.filters?.label ? <span className={MUTED}>{origin.filters.label}</span> : null}
          </>
        ) : <DataState state="none">Not started from Markets</DataState>}
      </div>
    </section>
  );
}

// ---- The section ------------------------------------------------------------------------

/** The Scope and questions section (`/research/projects/:uid/study/scope`). */
export default function ScopeAndQuestions({ projectUid, project, data, archived, replace, retry }) {
  const study = data?.study || null;
  const [draft, setDraft] = useState(() => scopeDraft(study, data?.venture));
  const [version, setVersion] = useState(study?.version ?? 0);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [said, setSaid] = useState('');
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // A newer read (a segment saved, Try again) refreshes the form unless the member has edits in it.
  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(scopeDraft(data?.study, data?.venture));
    setVersion(data?.study?.version ?? 0);
  }, [data]);

  const setField = (name, value) => { setDraft((d) => ({ ...d, [name]: value })); setDirty(true); };
  const setVenture = (venture) => { setDraft((d) => ({ ...d, venture })); setDirty(true); };
  const announce = (text) => setSaid(text);
  const reload = async () => { replace(await researchStudiesApi.read(projectUid)); };

  const save = async (e) => {
    e?.preventDefault?.();
    const found = scopeErrors(draft, { hasOrigin: Boolean(study?.origin) });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    setConflict(false);
    try {
      const res = await researchStudiesApi.save(projectUid, scopeBody(draft, version));
      setDirty(false);
      dirtyRef.current = false;
      replace(res);
      setDraft(scopeDraft(res?.study, res?.venture));
      setVersion(res?.study?.version ?? version);
      announce('Scope saved.');
    } catch (err) {
      if (err?.code === 'study_changed') setConflict(true);
      else setFailure(failureOf(err));
    } finally {
      setBusy(false);
    }
  };
  // "Reload and keep my edits": the newer study's version, the member's own text.
  const reloadKeep = async () => {
    setBusy(true);
    try {
      const fresh = await researchStudiesApi.read(projectUid);
      replace(fresh);
      setVersion(fresh?.study?.version ?? 0);
      setConflict(false);
      announce('The saved scope was read again. Your edits are kept; save to replace it.');
    } catch (err) {
      setFailure(failureOf(err, 'Your edits are kept.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="study-scope-h" data-testid="study-scope">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="study-scope-h" className="text-[16px] font-extrabold text-axal-ink dark:text-white">Scope and questions · Scope</h3>
          <p className={MUTED}>The definition is yours. Eadwyn proposes nothing on Scope.</p>
        </div>
        {archived ? null : <button type="button" className={PRIMARY} onClick={save} disabled={busy} data-testid="button-save-scope">{busy ? 'Saving…' : study ? 'Save scope' : 'Save scope and start the study'}</button>}
      </div>
      <p role="status" aria-live="polite" className="sr-only" data-testid="study-live">{said}</p>
      {conflict ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-gray-100" data-testid="study-conflict">
          <span><b>Someone saved this scope first.</b> Your edits are kept below and nothing was overwritten.</span>
          <button type="button" className={SECONDARY} onClick={reloadKeep} disabled={busy} data-testid="button-reload-keep">Reload and keep my edits</button>
        </div>
      ) : null}
      <Failure failure={failure} testid="status-scope-failed" />
      {errors.empty ? <p role="alert" className={ERROR} data-testid="scope-empty-error">{errors.empty}</p> : null}
      {errors.venture ? <p role="alert" className={ERROR} data-testid="scope-venture-error">{errors.venture}</p> : null}
      {!study && !archived ? (
        <p className={MUTED} data-testid="study-not-saved">This project has no study yet. Nothing is saved until you save the scope.</p>
      ) : null}
      {!study && archived ? (
        <div className={`${CARD} items-start`}><DataState state="none">None</DataState><p className={MUTED}>This project has no study. Restore the project to start one.</p></div>
      ) : null}
      <FromOverview project={project} archived={archived} />
      {archived ? (study ? <ProductRead study={study} /> : null) : <ProductForm draft={draft} setField={setField} errors={errors} />}
      <Segments projectUid={projectUid} data={data} archived={archived} reload={reload} announce={announce} />
      {study || !archived ? <VentureAndOrigin draft={draft} setVenture={setVenture} archived={archived} study={study} retry={retry} /> : null}
      <section className={`${CARD} items-start`} aria-labelledby="study-questions-h" data-testid="study-questions-not-built">
        <h3 id="study-questions-h" className={H3}>Questions</h3>
        <StateChip kind="not_applicable" label="Not built yet" />
        <p className={MUTED}>Questions with evidence for and against come in a later release.</p>
      </section>
    </section>
  );
}
