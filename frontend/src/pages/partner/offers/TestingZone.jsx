import React, { useCallback, useEffect, useRef, useState } from 'react';
import { partnerTestingApi } from '../../../lib/api/productTesting';
import { makeZoneActions } from '../../../workspaces/zoneActionBuilder';
import { makeZoneFilters } from '../../../workspaces/zoneFilterBuilder';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import {
  ZoneBody, StatedLimit, SlideOver, NoPartnerProfile, isNoPartnerProfile,
  buttonClass, inputClass,
  // D4844: the Offers type scale, actions, empty state and status chip.
  OfferEmpty, OfferHeading, OfferStatus, offerButtonClass, offerGhostButtonClass,
} from '../kit';
import { WriteNote, writeFailureText } from './useGuardedWrite';
import ProgrammeForm from '../../testing/ProgrammeForm';
import ProgrammeApplicants from '../../testing/ProgrammeApplicants';
import { datesLine, isEditable, placesLine, refusalText, statusLabel } from '../../testing/programmeModel';
import ProgrammeLogo from '../../admin/productTesting/ProgrammeLogo';
import { lifecycleCells, nextStep, programmeOrder, stageLabel } from './testingLifecycle';

/**
 * Offers · Product testing — `/offers/testing` (D815 board D4, #2261), redrawn to Offers v2 board
 * OF-06 and its phone layout OF-09c by #4843 part 2 (D4843-p2).
 *
 * Each programme is one card: its logo, name, places and dates, the five-step lifecycle
 * (Draft → HQ review → Recruiting → Testing → Complete, `testingLifecycle.js`) and the one next
 * action its state calls for: Submit for approval, Edit and resubmit, Waiting for HQ, Review
 * applicants, Continue testing or View testers. "+ New programme" writes a draft. One programme's
 * applicants open with Pick and Decline (the shared `ProgrammeApplicants`).
 *
 * The data is D812's partner routes (`partnerTestingApi`): the Worker scopes
 * every read and write to this firm, and holds picks to the places.
 */
const FORM_CLASSES = { input: inputClass, button: buttonClass };
const CLOSED = { mode: null, programme: null };

/*
 * THE ZONE'S OWN ROW, NOT A LINE IN THE CANVAS TABLES. `PARTNER_ZONE_ACTIONS`
 * and `PARTNER_ZONE_FILTERS` are pinned to the Partner Operator Canvas's
 * artboards (profile_zone_actions, profile_zone_filters), and that canvas
 * predates product testing: it draws no board for this zone. The same builders
 * make this zone's row here, so it renders like every other zone's.
 */
// D4844 (#4844): `New programme` LEFT THIS ROW. The zone's one primary is
// `+ New programme` in its heading (and `Create a testing programme` in the
// empty state); the same action twice, once filled and once outlined, is the
// duplicate the Offers action hierarchy rules out. Export stays secondary.
const testingActions = makeZoneActions({
  'offers/testing': [
    { label: 'Export', kind: 'export' },
  ],
});
const testingFilters = makeZoneFilters({
  'offers/testing': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Drafts', key: 'drafts' },
    { canvas: 'Waiting for HQ', key: 'waiting' },
    { canvas: 'Live', key: 'live' },
    { canvas: 'Closed', key: 'closed' },
  ],
});

/** Which statuses each filter chip keeps. */
export const VIEW_STATUSES = {
  all: null,
  drafts: ['draft', 'rejected'],
  waiting: ['submitted'],
  live: ['approved', 'open', 'testing'],
  closed: ['closed'],
};
export const inView = (view, p) => !VIEW_STATUSES[view] || VIEW_STATUSES[view].includes(p?.status);

export default function TestingZone({ api = partnerTestingApi }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  // { mode: null } | { mode: 'new' } | { mode: 'edit', programme } | { mode: 'open', programme }
  const [panel, setPanel] = useState(CLOSED);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [view, setView] = useState('all');
  const [logoJobs, setLogoJobs] = useState({});
  const logoBusy = useRef(new Set());
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const focusAfterRead = useRef(null);
  const newButtonRef = useRef(null);
  const bodyRef = useRef(null);
  const logoNodes = useRef(new Map());
  const programmeNodes = useRef(new Map());

  useEffect(() => {
    const target = focusAfterRead.current;
    if (!target || panel.mode !== null || (state.loading && target.kind !== 'logo')) return;
    const preferred = target.kind === 'logo' ? logoNodes.current.get(target.uid)
      : target.kind === 'programme' ? programmeNodes.current.get(target.uid) : newButtonRef.current;
    const node = preferred || newButtonRef.current || bodyRef.current;
    if (node?.isConnected) { node.focus(); focusAfterRead.current = null; }
  }, [state.loading, state.error, panel.mode, logoJobs]);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return Promise.resolve()
      .then(() => api.programmes())
      .then((r) => setState({ loading: false, error: null, items: Array.isArray(r?.items) ? r.items : [] }))
      .catch((e) => setState({ loading: false, error: refusalText(e, 'Your programmes could not be read.'), items: [] }));
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const close = useCallback(() => setPanel(CLOSED), []);

  // D4836: a persisted programme and its logo are separate writes. Retry holds the saved uid and file.
  async function writeLogo(job) {
    if (logoBusy.current.has(job.uid)) return false;
    logoBusy.current.add(job.uid);
    setLogoJobs((jobs) => ({ ...jobs, [job.uid]: { ...job, busy: true, error: null } }));
    try {
      if (job.file) await api.uploadLogo(job.uid, job.file);
      else await api.removeLogo(job.uid);
      setLogoJobs((jobs) => { const next = { ...jobs }; delete next[job.uid]; return next; });
      return true;
    } catch (e) {
      setLogoJobs((jobs) => ({ ...jobs, [job.uid]: { ...job, busy: false, error: writeFailureText(e) } }));
      return false;
    } finally { logoBusy.current.delete(job.uid); }
  }

  async function retryLogo(job) {
    if (await writeLogo(job)) {
      if (panelRef.current.mode === null) focusAfterRead.current = { kind: 'programme', uid: job.uid };
      setNote(`${job.title} is saved. Its logo ${job.file ? 'was uploaded' : 'was removed'}.`);
      await load();
    }
  }

  async function save(payload, logo) {
    const editing = panel.mode === 'edit';
    const r = editing ? await api.edit(panel.programme.uid, payload) : await api.create(payload);
    const uid = r?.programme?.uid || (editing ? panel.programme.uid : null);
    const title = r?.programme?.product_name || payload.product_name;
    // Nothing after persistence throws back into the programme form, which would invite a duplicate create.
    setNote(`${title} is saved as a draft. Submit it for HQ approval when it is ready.`);
    let logoFailed = false;
    if (logo?.file || logo?.remove) {
      if (uid) logoFailed = !await writeLogo({ uid, title, file: logo.file, remove: logo.remove });
      else setNote(`${title} is saved, but its logo could not be updated. Reload the list before editing its logo.`);
    }
    if (panelRef.current === panel) {
      focusAfterRead.current = logoFailed ? { kind: 'logo', uid } : { kind: 'new' };
      setPanel(CLOSED);
    }
    await load();
  }

  async function submit(p) {
    setBusy(p.uid);
    setNote(null);
    try {
      await api.submit(p.uid);
      setNote(`${p.product_name} is waiting for HQ. You will hear in the bell when HQ approves it or sends it back.`);
      await load();
    } catch (e) {
      setNote(refusalText(e, 'Axal could not send this programme to HQ. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  const unlinked = isNoPartnerProfile(state.error);
  const items = state.items || [];
  const visible = programmeOrder(items.filter((p) => inView(view, p)));
  const openNew = () => { setNote(null); setPanel({ mode: 'new', programme: null }); };
  const rowActions = testingActions('offers/testing', {
    view: {
      header: ['Product', 'Stage', 'Status', 'Places', 'Applicants', 'Dates'],
      rows: visible,
      cells: (p) => [p.product_name, stageLabel(p.status), statusLabel(p.status), placesLine(p), p.applicant_count, datesLine(p)],
    },
  });
  const newButton = (
    <button ref={newButtonRef} type="button" className={offerButtonClass} onClick={openNew} aria-haspopup="dialog"
      data-testid="testing-new-programme">
      + New programme
    </button>
  );
  const act = (p, step) => {
    if (step.action === 'submit') return submit(p);
    if (step.action === 'edit') return setPanel({ mode: 'edit', programme: p });
    return setPanel({ mode: 'open', programme: p });
  };
  const actionId = (step, uid) => (step.action === 'submit' ? `testing-submit-${uid}`
    : step.action === 'edit' ? `testing-edit-${uid}` : `testing-open-${uid}`);

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : testingFilters('offers/testing', { value: view, onChange: setView })}
        actions={rowActions}
      />
      {Object.values(logoJobs).map((job) => (
        <div key={job.uid} ref={(node) => { if (node) logoNodes.current.set(job.uid, node); else logoNodes.current.delete(job.uid); }}
          tabIndex={-1} role="group" aria-label={`${job.title} logo result`} aria-busy={job.busy} data-testid={`testing-logo-status-${job.uid}`}>
          <WriteNote busy={job.busy} note={{
            ok: !job.error,
            text: job.error ? `${job.title} is saved. Its logo was not ${job.file ? 'uploaded' : 'removed'}. ${job.error}` : `${job.title} is saved. Updating its logo…`,
            retry: () => retryLogo(job),
          }} />
        </div>
      ))}
      <div ref={bodyRef} tabIndex={-1} role="region" aria-label="Testing programmes">
      <ZoneBody
        what="Your testing programmes"
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={load}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || items.length === 0}
        empty={(
          <OfferEmpty
            testId="testing-empty"
            title="Validate an offer before launch"
            body="Recruit Axal members to test your product and give feedback. A programme opens once HQ approves it."
            action={(
              <button ref={newButtonRef} type="button" className={offerButtonClass} onClick={openNew} aria-haspopup="dialog" data-testid="testing-new-programme">
                Create a testing programme
              </button>
            )}
          />
        )}
      >
        <div className="space-y-4" data-testid="testing-zone">
          <OfferHeading
            title="Product testing"
            blurb="Recruit Axal members to test your product before launch."
            action={newButton}
          />
          {note && <p className="text-[13px] font-semibold" role="status" data-testid="testing-note">{note}</p>}
          {visible.length === 0 && (
            <p className="text-[13px] text-gray-600 dark:text-gray-400" data-testid="testing-view-empty">No programme is in this view.</p>
          )}
          <ul className="space-y-3" data-testid="testing-programmes">
            {visible.map((p) => {
              const step = nextStep(p);
              return (
                <li key={p.uid} ref={(node) => { if (node) programmeNodes.current.set(p.uid, node); else programmeNodes.current.delete(p.uid); }} tabIndex={-1}
                  className="space-y-3 rounded-xl border border-axal-hairline p-4 dark:border-gray-800" data-testid={`testing-programme-${p.uid}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProgrammeLogo p={p} size={34} />
                      <div className="min-w-0">
                        <h3 className="text-[16px] font-bold">{p.product_name}</h3>
                        <p className="text-[13px] text-gray-600 dark:text-gray-400" data-testid={`testing-meta-${p.uid}`}>{placesLine(p)} · {datesLine(p)}</p>
                      </div>
                    </div>
                    <span className="sm:hidden" data-testid={`testing-stage-${p.uid}`}><OfferStatus state={p.status === 'rejected' ? 'Rejected' : stageLabel(p.status)}>{stageLabel(p.status)}</OfferStatus></span>
                    <ol className="hidden flex-wrap gap-1 sm:flex" aria-label={`Lifecycle: ${stageLabel(p.status)}`} data-testid={`testing-life-${p.uid}`}>
                      {lifecycleCells(p.status).map((c) => (
                        <li key={c.label} aria-current={c.state === 'current' ? 'step' : undefined}
                          className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${c.state === 'current' ? 'bg-axal-violet-deep text-white dark:bg-violet-500' : c.state === 'done' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border border-dashed border-gray-400 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>
                          {/* D4844: done, current and to come differ by mark and border, not by colour alone. */}
                          {c.state === 'done' ? `✓ ${c.label}` : c.state === 'current' ? <><span aria-hidden="true">● </span>{c.label}</> : c.label}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${step.primary ? 'border-violet-200 bg-violet-50/60 dark:border-violet-500/30 dark:bg-violet-500/10' : 'border-axal-hairline bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40'}`}
                    data-testid={`testing-next-${p.uid}`}>
                    <div className="min-w-0 text-[13px]">
                      <b className="block">{step.title}</b>
                      <span className={p.status === 'rejected' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted'}
                        data-testid={p.status === 'rejected' ? `testing-review-note-${p.uid}` : undefined}>{step.line}</span>
                    </div>
                    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                      {p.status === 'draft' && isEditable(p) && (
                        <button type="button" className={offerGhostButtonClass} onClick={() => setPanel({ mode: 'edit', programme: p })}
                          data-testid={`testing-edit-${p.uid}`}>Edit</button>
                      )}
                      {step.action && (
                        <button type="button" disabled={busy === p.uid}
                          className={`${step.primary ? offerButtonClass : offerGhostButtonClass} min-h-[48px] w-full sm:min-h-0 sm:w-auto`}
                          onClick={() => act(p, step)} data-testid={actionId(step, p.uid)}>
                          {step.label}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </ZoneBody>
      </div>
      <StatedLimit title="What this zone does not show">
        Applicant email addresses are kept private. Picked testers receive email through Axal VC Mail only after they agree.
        Delivery and open figures are not recorded.
      </StatedLimit>
      <SlideOver
        open={panel.mode === 'new' || panel.mode === 'edit'}
        onClose={close}
        title={panel.mode === 'edit' ? `Edit ${panel.programme.product_name}` : 'New programme'}
        subtitle={panel.mode === 'edit' && panel.programme.status === 'rejected'
          ? 'Saving returns it to draft, to submit again.' : 'Saved as a draft until you submit it for HQ approval.'}
      >
        {(panel.mode === 'new' || panel.mode === 'edit') && (
          <ProgrammeForm programme={panel.mode === 'edit' ? panel.programme : null} onSave={save} onCancel={close}
            classes={FORM_CLASSES} logo />
        )}
      </SlideOver>
      <SlideOver open={panel.mode === 'open'} onClose={close} title={panel.programme?.product_name || ''} subtitle="Applicants">
        {panel.mode === 'open' && (
          <ProgrammeApplicants uid={panel.programme.uid} classes={FORM_CLASSES} onChanged={load}
            api={{ applicants: api.applicants, pick: api.pick, decline: api.decline }} />
        )}
      </SlideOver>
    </>
  );
}
