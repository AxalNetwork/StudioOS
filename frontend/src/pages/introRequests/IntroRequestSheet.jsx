/**
 * D9068 (#9068): Network › Introductions › Request an introduction, the four-step request through Axal, to the
 * canvases `design/incoming/Network External Introduction Requests Page.dc.html` (D7678, boards NIE02 to NIE07,
 * NIE21) and `design/incoming/Network Requester Profile and Readiness Page.dc.html` (D7677, NRD-06, NRD-07, NRD-12),
 * at `/network/introductions/requests/new`.
 *
 * WHO, PURPOSE, SHARE, REVIEW. Step 1 names the person: a published directory person (`GET
 * /api/network/directory/entries`), someone not in it (a provisional target, `POST /provisional-targets`), or only
 * an organisation whose right person Axal identifies. Leaving step 1 creates the draft with one idempotency key, so a
 * retry or a second click returns the same draft (`?draft=<uid>` from then on). Steps 2 and 3 save the purpose,
 * the shareable brief and the private note with the revision they read; a newer save elsewhere is shown beside
 * what was typed here, never overwritten.
 *
 * SUBMIT IS THE SERVER'S. Step 4 shows the server's readiness and submits; when the server answers that readiness
 * is needed, the draft is kept and the blocking items link to Request readiness and back. A refused or failed
 * submit keeps the draft; a lost answer is checked by reading the request, never by sending a second one.
 * Submitting contacts nobody.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { DataState } from '../../ui/Honesty';
import { introRequestsApi } from '../../lib/api/introRequests.js';
import { reportError } from '../../lib/log';
import {
  AGGREGATE, EDITABLE, LIMITS, STAYS_PRIVATE, aggregateReadiness, blockingItems, capacityLabel, newIdempotencyKey,
  provisionalErrors, refusalSentence, sharePreview, stamp, targetLine,
} from './introRequestModel.js';
import { BTN, BTN_GHOST, BTN_PRIMARY, Card, Chip, EYE, FIELD_ERROR, Facts, Frame, HINT, INPUT, LABEL, Note, PageHeader, focusEl } from './introKit.jsx';

const STEPS = ['Who', 'Purpose', 'Share', 'Review'];
const KEY_STORE = 'intro-request:new-key';

function Steps({ step }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap gap-1.5">
      {STEPS.map((t, i) => {
        const n = i + 1;
        const on = n === step;
        return (
          <li key={t} aria-current={on ? 'step' : undefined} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-violet-500 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-500/10 dark:text-violet-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400'}`}>
            {n < step ? '✓ ' : ''}{n} {t}
          </li>
        );
      })}
    </ol>
  );
}

function storedKey() {
  try {
    const k = sessionStorage.getItem(KEY_STORE);
    if (k) return k;
    const n = newIdempotencyKey();
    sessionStorage.setItem(KEY_STORE, n);
    return n;
  } catch {
    return null;
  }
}
function clearKey() { try { sessionStorage.removeItem(KEY_STORE); } catch { /* storage off: nothing kept */ } }

/* ---------- step 1: who (NIE03) ---------- */

function EntryPick({ e, chosen, onPick }) {
  const meta = [e.geography, e.source?.name ? `Source: ${e.source.name}` : null, e.source?.observed_at ? `seen ${String(e.source.observed_at).slice(0, 10)}` : null].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" aria-pressed={chosen} onClick={() => onPick(e)} className={`flex min-h-[52px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${chosen ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-500/10' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'}`}>
        <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-full bg-violet-100 font-mono text-[11px] font-bold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">{String(e.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13.5px] text-gray-900 dark:text-gray-100">{e.name}</b>
          <small className="block break-words text-[12px] text-gray-600 dark:text-gray-400">{meta || 'Not recorded · the source gave no place or date'}</small>
        </span>
        {chosen ? <Chip s={{ word: 'Chosen', glyph: '✓', tone: 'violet' }} /> : null}
      </button>
    </li>
  );
}

function DirectorySearch({ kind, chosen, onPick }) {
  const [q, setQ] = useState('');
  const [read, setRead] = useState({ status: 'idle' });
  const run = useCallback((term) => {
    setRead({ status: 'loading' });
    introRequestsApi.searchTargets({ q: term, kind })
      .then((d) => setRead({ status: 'ok', entries: d.entries || [], total: d.total }))
      .catch((e) => { setRead({ status: 'error' }); reportError('intro-requests:directory-search', e); });
  }, [kind]);
  const noun = kind === 'organization' ? 'organisations' : 'people';
  return (
    <div className="flex flex-col gap-2">
      <form role="search" onSubmit={(e) => { e.preventDefault(); run(q.trim()); }} className="flex gap-2">
        <label htmlFor={`ir-q-${kind}`} className="sr-only">{kind === 'organization' ? 'Organisation name' : 'Name'}</label>
        <input id={`ir-q-${kind}`} className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'organization' ? 'Organisation name' : 'Name'} />
        <button type="submit" className={BTN}>Search</button>
      </form>
      {read.status === 'loading' ? <p role="status" className={HINT}>◌ Searching the shared directory…</p> : null}
      {read.status === 'error' ? <DataState state="unavailable" what="The directory" claim="This is not a claim that nobody matches." onRetry={() => run(q.trim())} retryLabel="Try again" /> : null}
      {read.status === 'ok' ? (
        <>
          <p className={HINT} aria-live="polite"><b className="font-mono">{read.total}</b> {read.total === 1 ? (kind === 'organization' ? 'organisation' : 'person') : noun} found in the directory{read.total > read.entries.length ? `, ${read.entries.length} shown: narrow the name to see the rest` : ''}. Pick by place and source.</p>
          {read.entries.length ? <ul className="flex flex-col gap-2">{read.entries.map((e) => <EntryPick key={e.uid} e={e} chosen={chosen?.uid === e.uid} onPick={onPick} />)}</ul> : null}
        </>
      ) : null}
      <p className={HINT}>Only published directory records are listed. Someone you cannot see is never shown.</p>
    </div>
  );
}

function StepWho({ preset, busy, failed, onCreate }) {
  const [mode, setMode] = useState(preset?.org ? 'org' : 'person');
  const [person, setPerson] = useState(preset?.person || null);
  const [org, setOrg] = useState(preset?.org || null);
  const [manual, setManual] = useState({ display_name: '', organization_text: '', profile_url: '' });
  const [errors, setErrors] = useState([]);
  const byField = Object.fromEntries(errors.map((x) => [x.field, x.message]));
  const MODES = [['person', 'Person'], ['new', 'Not in the directory'], ['org', 'I only know an organisation']];
  const ready = mode === 'person' ? !!person : mode === 'org' ? !!org : true;
  const go = () => {
    if (mode === 'new') {
      const errs = provisionalErrors(manual);
      setErrors(errs);
      if (errs.length) { document.getElementById(`ir-${errs[0].field}`)?.focus(); return; }
      onCreate({ provisional: manual });
    } else if (mode === 'person') onCreate({ target_entry_uid: person.uid });
    else onCreate({ organization_entry_uid: org.uid });
  };
  return (
    <Card title="The person" id="ir-who">
      <div role="radiogroup" aria-label="Who you name" className="flex flex-wrap gap-2">
        {MODES.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={`min-h-[44px] rounded-lg border px-3 text-[13px] font-semibold sm:min-h-[36px] ${mode === k ? 'border-violet-500 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-500/10 dark:text-violet-200' : 'border-gray-300 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'}`}>{label}</button>
        ))}
      </div>
      {mode === 'person' ? <DirectorySearch kind="person" chosen={person} onPick={setPerson} /> : null}
      {mode === 'org' ? (
        <>
          <DirectorySearch kind="organization" chosen={org} onPick={setOrg} />
          <Note tone="warn" glyph="!"><b>An organisation cannot receive an introduction.</b> It is kept as context, and the request goes to Axal as “person to be identified”. Nobody is contacted until a person is named and reviewed.</Note>
        </>
      ) : null}
      {mode === 'new' ? (
        <div className="flex flex-col gap-3">
          <Note glyph="○">You can name someone who is not in the directory. Axal reviews who they are before anyone contacts them. No email is asked for.</Note>
          <div>
            <label htmlFor="ir-display_name" className={LABEL}>Full name <span className="font-normal text-gray-600 dark:text-gray-400">(required)</span></label>
            <input id="ir-display_name" className={`${INPUT} mt-1`} maxLength={300} value={manual.display_name} aria-invalid={byField.display_name ? 'true' : undefined} aria-describedby={byField.display_name ? 'ir-display_name-e' : undefined} onChange={(e) => setManual({ ...manual, display_name: e.target.value })} />
            {byField.display_name ? <span id="ir-display_name-e" className={FIELD_ERROR}>✕ {byField.display_name}</span> : null}
          </div>
          <div>
            <label htmlFor="ir-organization_text" className={LABEL}>Organisation <span className="font-normal text-gray-600 dark:text-gray-400">(optional)</span></label>
            <input id="ir-organization_text" className={`${INPUT} mt-1`} maxLength={300} value={manual.organization_text} onChange={(e) => setManual({ ...manual, organization_text: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ir-profile_url" className={LABEL}>Public professional page <span className="font-normal text-gray-600 dark:text-gray-400">(optional)</span></label>
            <input id="ir-profile_url" type="url" inputMode="url" className={`${INPUT} mt-1`} value={manual.profile_url} aria-invalid={byField.profile_url ? 'true' : undefined} aria-describedby={byField.profile_url ? 'ir-profile_url-e' : undefined} onChange={(e) => setManual({ ...manual, profile_url: e.target.value })} />
            {byField.profile_url ? <span id="ir-profile_url-e" className={FIELD_ERROR}>✕ {byField.profile_url}</span> : null}
          </div>
          <Chip s={{ word: 'Provisional · until Axal reviews', glyph: '≈', tone: 'warn' }} className="self-start" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1 border-t border-gray-200 pt-3 dark:border-gray-700">
        <b className="text-[13px] text-gray-900 dark:text-gray-100">Through Axal</b>
        <span className="text-[12.5px] text-gray-600 dark:text-gray-400">Axal reviews your request and decides whether and how to contact the person. This service spends no credit.</span>
      </div>
      {failed ? <Note tone="bad" glyph="!" role="alert"><b>No draft yet.</b> {failed}</Note> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={!ready || busy} aria-busy={busy || undefined} onClick={go}>{busy ? 'Saving draft…' : 'Continue'}</button>
        <Link to="/network/introductions/requests" className={BTN}>Cancel</Link>
      </div>
    </Card>
  );
}

/* ---------- the draft's text, steps 2 to 4 ---------- */

function useDraft(uid) {
  const [read, setRead] = useState({ status: uid ? 'loading' : 'none', request: null });
  const load = useCallback(() => {
    if (!uid) return undefined;
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    introRequestsApi.get(uid)
      .then((d) => { if (live) setRead({ status: 'ok', request: d.request }); })
      .catch((e) => { if (live) setRead({ status: e?.status === 404 ? 'refused' : 'error', request: null }); reportError('intro-requests:draft', e); });
    return () => { live = false; };
  }, [uid]);
  useEffect(load, [load]);
  return [read, setRead, load];
}

const textOf = (r) => ({ purpose: r?.purpose || '', shareable_brief: r?.shareable_brief || '', private_notes: r?.private_notes || '' });

export default function IntroRequestSheet() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const uid = params.get('draft');
  const step = uid ? Math.min(4, Math.max(2, Number(params.get('step')) || 2)) : 1;
  const [draft, setDraft, reload] = useDraft(uid);
  const [text, setText] = useState(textOf(null));
  const [saved, setSaved] = useState(textOf(null));
  const [conflict, setConflict] = useState(null);
  const [save, setSave] = useState({ status: 'idle' });
  const [readiness, setReadiness] = useState({ status: 'loading', data: null });
  const [submit, setSubmit] = useState({ status: 'idle' });
  const [create, setCreate] = useState({ status: 'idle' });
  const [preset, setPreset] = useState({ status: params.get('person') || params.get('org') ? 'loading' : 'none' });
  const titleRef = useRef(null);
  const r = draft.request;

  // A Person Sheet or an organisation's person row opens the sheet with that exact record (NIE02).
  useEffect(() => {
    const ref = params.get('person') || params.get('org');
    if (!ref || uid) return;
    introRequestsApi.targetEntry(ref)
      .then((d) => setPreset({ status: 'ok', [d.entry?.kind === 'organization' ? 'org' : 'person']: d.entry }))
      .catch((e) => { setPreset({ status: 'none' }); reportError('intro-requests:preset', e); });
  }, [params, uid]);

  // The server's text replaces the local copy only when a new revision arrives; a conflict sets the local copy itself.
  const rev = r ? `${r.uid}:${r.revision}` : null;
  useEffect(() => { if (r) { setText(textOf(r)); setSaved(textOf(r)); } }, [rev]);

  const loadReadiness = useCallback(() => {
    setReadiness((x) => ({ ...x, status: 'loading' }));
    introRequestsApi.readiness()
      .then((data) => setReadiness({ status: 'ok', data }))
      .catch((e) => { setReadiness({ status: 'error', data: null }); reportError('intro-requests:sheet-readiness', e); });
  }, []);
  useEffect(() => { if (uid) loadReadiness(); }, [uid, loadReadiness]);
  // Focus follows a step change (not the first paint), so a keyboard or screen-reader user lands on the new step.
  const firstStep = useRef(step);
  useEffect(() => { if (step !== firstStep.current) { firstStep.current = -1; focusEl(titleRef.current); } }, [step]);

  const goStep = (n) => setParams((p) => { const q = new URLSearchParams(p); q.set('step', String(n)); return q; });
  const dirty = text.purpose !== saved.purpose || text.shareable_brief !== saved.shareable_brief || text.private_notes !== saved.private_notes;

  const onCreate = async (target) => {
    setCreate({ status: 'busy' });
    try {
      let body = target;
      if (target.provisional) {
        const p = await introRequestsApi.createProvisionalTarget({
          display_name: target.provisional.display_name.trim(),
          ...(target.provisional.organization_text.trim() ? { organization_text: target.provisional.organization_text.trim() } : {}),
          ...(target.provisional.profile_url.trim() ? { profile_url: target.provisional.profile_url.trim() } : {}),
        });
        body = { target_provisional_uid: p.uid };
      }
      const key = storedKey() || newIdempotencyKey();
      const out = await introRequestsApi.create({ idempotency_key: key, ...body });
      clearKey();
      setCreate({ status: 'idle' });
      navigate(`/network/introductions/requests/new?draft=${encodeURIComponent(out.request.uid)}&step=2`, { replace: true });
    } catch (e) {
      reportError('intro-requests:create', e);
      setCreate({ status: 'error', sentence: refusalSentence(e) });
    }
  };

  /** Save the text with the revision it was read at. A newer save is kept beside, not overwritten. */
  const saveText = async (base = r) => {
    if (!base) return null;
    setSave({ status: 'busy' });
    try {
      const out = await introRequestsApi.update(base.uid, { expected_revision: base.revision, ...text });
      setDraft({ status: 'ok', request: out.request });
      setSaved(textOf(out.request));
      setConflict(null);
      setSave({ status: 'saved', at: stamp(out.request.updated_at) });
      return out.request;
    } catch (e) {
      reportError('intro-requests:save', e);
      if (e?.code === 'revision_conflict') {
        try {
          const fresh = (await introRequestsApi.get(base.uid)).request;
          setConflict({ theirs: fresh, mine: { ...text } });
          setDraft({ status: 'ok', request: fresh });
        } catch (e2) { reportError('intro-requests:save-reload', e2); }
      }
      setSave({ status: 'error', sentence: refusalSentence(e) });
      return null;
    }
  };
  const keepMine = async () => {
    const mine = conflict.mine;
    setConflict(null);
    setText(mine);
    const out = await introRequestsApi.update(r.uid, { expected_revision: r.revision, ...mine }).catch((e) => { reportError('intro-requests:keep-mine', e); setSave({ status: 'error', sentence: refusalSentence(e) }); return null; });
    if (out) { setDraft({ status: 'ok', request: out.request }); setSaved(textOf(out.request)); setSave({ status: 'saved', at: stamp(out.request.updated_at) }); }
  };
  const useTheirs = () => { setText(textOf(conflict.theirs)); setSaved(textOf(conflict.theirs)); setConflict(null); setSave({ status: 'idle' }); };

  const next = async (n) => {
    if (dirty) { const ok = await saveText(); if (!ok) return; }
    goStep(n);
  };

  const doSubmit = async () => {
    if (submit.status === 'busy') return; // a second click while submitting does nothing
    setSubmit({ status: 'busy' });
    let base = r;
    if (dirty) { base = await saveText(); if (!base) { setSubmit({ status: 'idle' }); return; } }
    try {
      const out = await introRequestsApi.submit(base.uid, base.revision);
      if (out.request?.state === 'readiness_needed') {
        setDraft({ status: 'ok', request: out.request });
        if (out.readiness) setReadiness({ status: 'ok', data: out.readiness });
        setSubmit({ status: 'blocked' });
        return;
      }
      navigate(`/network/introductions/requests/${encodeURIComponent(base.uid)}?submitted=1`);
    } catch (e) {
      reportError('intro-requests:submit', e);
      if (e?.status == null) setSubmit({ status: 'lost' });
      else { setSubmit({ status: 'refused', sentence: refusalSentence(e) }); if (e.code === 'revision_conflict' || e.code === 'request_not_submittable') reload(); }
    }
  };
  /** A lost answer is checked by reading the request: found submitted opens the receipt, found draft keeps it. */
  const checkRecorded = async () => {
    setSubmit({ status: 'checking' });
    try {
      const fresh = (await introRequestsApi.get(r.uid)).request;
      if (!EDITABLE.includes(fresh.state)) { navigate(`/network/introductions/requests/${encodeURIComponent(r.uid)}?submitted=1`); return; }
      setDraft({ status: 'ok', request: fresh });
      setSubmit({ status: 'not_found' });
    } catch (e) {
      reportError('intro-requests:check-recorded', e);
      setSubmit({ status: 'lost' });
    }
  };

  const agg = readiness.status === 'loading' ? null : aggregateReadiness(readiness.data);
  const blocking = useMemo(() => blockingItems(readiness.data), [readiness.data]);
  const t = targetLine(r);
  const cap = readiness.data?.requirements?.find((x) => x.key === 'capacity')?.value;
  const readinessHref = uid ? `/network/introductions/readiness?draft=${encodeURIComponent(uid)}` : '/network/introductions/readiness';

  if (uid && draft.status === 'ok' && r && !EDITABLE.includes(r.state)) return <Navigate to={`/network/introductions/requests/${encodeURIComponent(r.uid)}`} replace />;

  const titleFor = { 1: 'Who do you want to meet?', 2: 'What is the introduction for?', 3: 'What Axal will share', 4: 'Review your request' }[step];
  const savedLine = save.status === 'saved' ? `Draft saved ${save.at || ''}` : r ? `Draft saved ${stamp(r.updated_at) || ''}` : null;

  const bar = step === 1 ? null : step < 4
    ? <><button type="button" className={`${BTN} flex-1`} onClick={() => (step === 2 ? null : goStep(step - 1))} disabled={step === 2}>Back</button><button type="button" className={`${BTN_PRIMARY} flex-1`} onClick={() => next(step + 1)} disabled={save.status === 'busy' || (step === 2 && !text.purpose.trim())}>Continue</button></>
    : <><button type="button" className={`${BTN} flex-1`} onClick={() => saveText()}>Save draft</button><button type="button" className={`${BTN_PRIMARY} flex-1`} onClick={doSubmit} disabled={agg !== 'ready' || submit.status === 'busy'} aria-disabled={agg !== 'ready' || undefined} aria-busy={submit.status === 'busy' || undefined} aria-describedby={agg !== 'ready' ? 'ir-blocked' : undefined}>{submit.status === 'busy' ? 'Submitting…' : 'Submit request'}</button></>;

  return (
    <Frame bar={bar}>
      <PageHeader
        crumb={[{ label: 'Introductions', to: '/network/introductions/requests' }, { label: uid ? 'Draft' : 'New request' }]}
        eye={`Request an introduction · step ${step} of 4`}
        title={titleFor}
        titleRef={titleRef}
        sub={uid && t.name ? `To ${t.name}${t.kind ? ` · ${t.kind}` : ''}` : 'You can search, write and save before you are ready. Submitting is checked by Axal.'}
        actions={savedLine && step > 1 ? <span role="status" className="text-[12.5px] text-gray-600 dark:text-gray-400">✓ {savedLine}</span> : null}
      />
      <Steps step={step} />

      {step === 1 ? (
        preset.status === 'loading'
          ? <Card><p role="status" className={HINT}>◌ Opening the person you chose…</p></Card>
          : <StepWho key={preset.status} preset={preset} busy={create.status === 'busy'} failed={create.status === 'error' ? create.sentence : null} onCreate={onCreate} />
      ) : null}

      {uid && draft.status === 'loading' && !r ? <Card><p role="status" className={HINT}>◌ Loading your draft…</p></Card> : null}
      {uid && draft.status === 'error' ? <DataState state="unavailable" size="block" what="Your draft" claim="It is not lost: it is kept on the server." onRetry={reload} retryLabel="Try again" /> : null}
      {uid && draft.status === 'refused' ? <DataState state="refused" size="block" claim="This request is not available to you." /> : null}

      {conflict ? (
        <Note tone="warn" glyph="!" role="alert">
          <b>This draft changed in another tab at {stamp(conflict.theirs.updated_at)}.</b> Your text here is kept beside the newer version.
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={BTN} onClick={keepMine}>Keep this tab’s text</button><button type="button" className={BTN} onClick={useTheirs}>Use the newer text</button></div>
        </Note>
      ) : save.status === 'error' ? <Note tone="bad" glyph="!" role="alert"><b>Not saved.</b> {save.sentence}</Note> : null}

      {r && step === 2 ? (
        <Card title="Purpose" id="ir-purpose-card">
          <div>
            <label htmlFor="ir-purpose" className={LABEL}>Why this person, and why now <span className="font-normal text-gray-600 dark:text-gray-400">(required)</span></label>
            <textarea id="ir-purpose" rows={5} className={`${INPUT} mt-1`} maxLength={LIMITS.purpose} value={text.purpose} onChange={(e) => setText({ ...text, purpose: e.target.value })} />
            <span className={HINT}>{Array.from(text.purpose).length} / {LIMITS.purpose.toLocaleString('en-US')}. Axal operators read it; the person may, after review.</span>
          </div>
          <div>
            <label htmlFor="ir-private" className={LABEL}>Private note <span className="font-normal text-gray-600 dark:text-gray-400">(optional · only you)</span></label>
            <textarea id="ir-private" rows={3} className={`${INPUT} mt-1`} maxLength={LIMITS.private_notes} value={text.private_notes} onChange={(e) => setText({ ...text, private_notes: e.target.value })} />
            <span className={HINT}>Kept for you. Axal operators and the person never read it.</span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <span className={EYE}>You are asking as</span>
            {readiness.status === 'error' ? <DataState state="unavailable" what="Your capacity" onRetry={loadReadiness} retryLabel="Try again" /> : (
              <span className="text-[13.5px] text-gray-900 dark:text-gray-100">
                {cap?.capacity ? `${capacityLabel(cap.capacity)}${cap.represented_organization ? ` · for ${cap.represented_organization}` : ' · for yourself'}` : 'Not chosen yet'}
                {' '}<Link to={`${readinessHref}&edit=capacity`} className={BTN_GHOST}>Change capacity</Link>
              </span>
            )}
          </div>
          <div className="hidden gap-2 lg:flex">
            <button type="button" className={BTN_PRIMARY} onClick={() => next(3)} disabled={save.status === 'busy' || !text.purpose.trim()}>Continue</button>
            <button type="button" className={BTN} onClick={() => saveText()} disabled={!dirty}>Save draft</button>
          </div>
        </Card>
      ) : null}

      {r && step === 3 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card title={`Shared with ${t.name || 'the person'}, after review`} id="ir-share">
            <div>
              <label htmlFor="ir-brief" className={LABEL}>Shareable brief <span className="font-normal text-gray-600 dark:text-gray-400">(what the person would read)</span></label>
              <textarea id="ir-brief" rows={5} className={`${INPUT} mt-1`} maxLength={LIMITS.shareable_brief} value={text.shareable_brief} onChange={(e) => setText({ ...text, shareable_brief: e.target.value })} />
              <span className={HINT}>{Array.from(text.shareable_brief).length} / {LIMITS.shareable_brief.toLocaleString('en-US')}</span>
            </div>
            {readiness.status === 'error' ? <DataState state="unavailable" what="Your shareable profile" onRetry={loadReadiness} retryLabel="Try again" /> : (
              <Facts rows={sharePreview(readiness.data, text).map((x) => [x.label, x.value || <DataState state="not_recorded" reason={x.label === 'Brief' || x.label === 'Purpose' ? 'not written yet' : 'not on your readiness record'} />])} />
            )}
            <Link to={`${readinessHref}&edit=professional_profile`} className={`${BTN_GHOST} self-start`}>Edit your profile</Link>
          </Card>
          <Card title="Stays private" id="ir-private-list">
            <ul className="flex flex-col gap-1.5 text-[13px] text-gray-800 dark:text-gray-200">{STAYS_PRIVATE.map((s) => <li key={s}><span aria-hidden="true">⊘ </span>{s}</li>)}</ul>
            <p className={HINT}>Nothing is sent now. Axal shares these fields only if an operator contacts the person, and only these fields.</p>
          </Card>
          <div className="hidden gap-2 lg:col-span-2 lg:flex">
            <button type="button" className={BTN} onClick={() => goStep(2)}>Back</button>
            <button type="button" className={BTN_PRIMARY} onClick={() => next(4)} disabled={save.status === 'busy'}>Confirm and review</button>
          </div>
        </div>
      ) : null}

      {r && step === 4 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card title="Your request" id="ir-review">
            <Facts rows={[
              ['Person', <><b>{t.name || 'Not recorded'}</b>{t.kind ? <span className="text-gray-600 dark:text-gray-400"> · {t.kind}</span> : null}</>],
              t.organization && !String(t.name || '').startsWith('Person to be') ? ['Organisation', `${t.organization} · context only`] : null,
              ['Purpose', text.purpose || <DataState state="not_recorded" reason="not written yet" />],
              ['Brief', text.shareable_brief || <DataState state="not_recorded" reason="not written yet" />],
              ['You ask as', cap?.capacity ? `${capacityLabel(cap.capacity)}${cap.represented_organization ? ` · for ${cap.represented_organization}` : ''}` : 'Not chosen yet'],
              ['Coordinated by', 'Axal · an operator is assigned after you submit'],
              ['Cost', 'No charge · this service spends no credit'],
              ['Timing', 'No response time is promised'],
            ]} />
            <Note glyph="i"><b>Submitting asks Axal to coordinate. It sends nothing to {t.name || 'the person'}.</b> An operator reviews the request and decides what is sent, and you see when it is.</Note>
            <div className="hidden flex-wrap gap-2 lg:flex">
              <button type="button" className={BTN} onClick={() => goStep(3)}>Back</button>
              <button type="button" className={BTN} onClick={() => saveText()} disabled={!dirty}>Save draft</button>
              <button type="button" className={BTN_PRIMARY} onClick={doSubmit} disabled={agg !== 'ready' || submit.status === 'busy'} aria-busy={submit.status === 'busy' || undefined} aria-describedby={agg !== 'ready' ? 'ir-blocked' : undefined}>{submit.status === 'busy' ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </Card>

          <div className="order-first flex flex-col gap-4 lg:order-none">
            {submit.status === 'blocked' ? <Note tone="warn" glyph="!" role="alert"><b>Not submitted.</b> The server checked your readiness and items remain. Your draft, person and purpose are kept.</Note> : null}
            {submit.status === 'refused' ? <Note tone="bad" glyph="!" role="alert"><b>Not submitted.</b> {submit.sentence} Your draft is kept.</Note> : null}
            {submit.status === 'lost' || submit.status === 'checking' ? (
              <Note tone="warn" glyph="?" role="alert">
                <b>We could not confirm the request.</b> The connection dropped before an answer; it may or may not be recorded. Your text is kept.
                <div className="mt-2"><button type="button" className={BTN} onClick={checkRecorded} disabled={submit.status === 'checking'}>{submit.status === 'checking' ? 'Checking…' : 'Check what was recorded'}</button></div>
              </Note>
            ) : null}
            {submit.status === 'not_found' ? <Note tone="plain" glyph="○" role="status"><b>Not submitted.</b> Your draft is intact; you can submit again.</Note> : null}

            <Card title={agg === 'ready' ? 'Ready to submit' : 'Before you submit'} id="ir-blocked" tone={agg === 'ready' ? 'good' : 'warn'}>
              {readiness.status === 'loading' ? <p role="status" className={HINT}>◌ Checking your readiness…</p> : null}
              {readiness.status === 'error' ? (
                <>
                  <Chip s={AGGREGATE.unr} className="self-start" />
                  <DataState state="unavailable" what="Your readiness" claim="It is never counted as ready, so submitting stays off. Your draft is kept." onRetry={loadReadiness} retryLabel="Try again" />
                </>
              ) : null}
              {readiness.status === 'ok' ? (
                <>
                  <Chip s={AGGREGATE[agg]} className="self-start" />
                  {blocking.length ? (
                    <ul className="flex flex-col gap-2">
                      {blocking.map((b) => (
                        <li key={b.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                          <span><b className="block text-[13px] text-gray-900 dark:text-gray-100">{b.title}</b><Chip s={b.status} /></span>
                          <Link to={`${readinessHref}&edit=${encodeURIComponent(b.key)}`} className={BTN}>{b.status.group === 'reviewer' ? 'View' : 'Resolve'}<span className="sr-only"> · {b.title}</span></Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className={HINT}>Checked by the server from your readiness record, policy v{readiness.data?.policy?.version}. It is checked again when you submit.</p>
                </>
              ) : null}
            </Card>
          </div>
        </div>
      ) : null}
    </Frame>
  );
}
