import React, { useCallback, useEffect, useRef, useState } from 'react';
import { partnerTestingApi } from '../../../lib/api/productTesting';
import { makeZoneActions } from '../../../workspaces/zoneActionBuilder';
import { makeZoneFilters } from '../../../workspaces/zoneFilterBuilder';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill, SlideOver, NoPartnerProfile, isNoPartnerProfile,
  buttonClass, inputClass, ghostButtonClass,
} from '../kit';
import { WriteNote, writeFailureText } from './useGuardedWrite';
import ProgrammeForm from '../../testing/ProgrammeForm';
import ProgrammeApplicants from '../../testing/ProgrammeApplicants';
import {
  byStatus, datesLine, isEditable, isSubmittable, placesLine, refusalText, statusLabel, statusTone,
} from '../../testing/programmeModel';

/**
 * Offers · Product testing — `/offers/testing` (D815 board D4, #2261).
 *
 * The firm's testing programmes, by status: Draft, Waiting for HQ, Open,
 * Testing and Closed, and Sent back with HQ's note. "New programme" writes a
 * draft; "Submit for HQ approval" sends it. HQ opens it once approved. One
 * programme open shows its applicants with Pick and Decline (the shared
 * `ProgrammeApplicants`).
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
const testingActions = makeZoneActions({
  'offers/testing': [
    { label: 'New programme', kind: 'handler', handler: 'newProgramme' },
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
    if (!target || state.loading || panel.mode !== null) return;
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
  const visible = items.filter((p) => inView(view, p));
  const groups = byStatus(visible);
  const openNew = () => { setNote(null); setPanel({ mode: 'new', programme: null }); };
  const rowActions = testingActions('offers/testing', {
    handlers: { newProgramme: openNew },
    view: {
      header: ['Product', 'Status', 'Places', 'Applicants', 'Dates'],
      rows: visible,
      cells: (p) => [p.product_name, statusLabel(p.status), placesLine(p), p.applicant_count, datesLine(p)],
    },
  });
  const newButton = (
    <button ref={newButtonRef} type="button" className={buttonClass} onClick={openNew}
      data-testid="testing-new-programme">
      New programme
    </button>
  );

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
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={load}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || items.length === 0}
        empty={(
          <NothingYet
            title="No testing programmes yet"
            body="Recruit Axal members to test your product before it launches. A programme opens once HQ approves it."
            action={newButton}
          />
        )}
      >
        <div className="space-y-6" data-testid="testing-zone">
          <ZoneHeading
            title="Testing programmes"
            blurb="Members apply from their dashboard; you pick the testers. A programme opens once HQ approves it."
            action={newButton}
          />
          {note && <p className="text-[12.5px] font-semibold" role="status" data-testid="testing-note">{note}</p>}
          {groups.length === 0 && (
            <p className="text-[12.5px] text-axal-muted" data-testid="testing-view-empty">No programme is in this view.</p>
          )}
          {groups.map((g) => (
            <section key={g.status} data-testid={`testing-group-${g.status}`}>
              <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{g.label} · {(g.items || []).length}</h3>
              <ul className="space-y-2">
                {(g.items || []).map((p) => (
                  <li key={p.uid} ref={(node) => { if (node) programmeNodes.current.set(p.uid, node); else programmeNodes.current.delete(p.uid); }} tabIndex={-1} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800" data-testid={`testing-programme-${p.uid}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-bold">{p.product_name}</span>
                          <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
                        </div>
                        <p className="mt-1 text-[12px] text-axal-muted">
                          {placesLine(p)} · {p.applicant_count} {p.applicant_count === 1 ? 'applicant' : 'applicants'} · {datesLine(p)}
                        </p>
                        {p.status === 'rejected' && p.review_note && (
                          <p className="mt-1 text-[12px] text-red-700 dark:text-red-300" data-testid={`testing-review-note-${p.uid}`}>
                            HQ: {p.review_note}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {isEditable(p) && (
                          <button type="button" className={ghostButtonClass} onClick={() => setPanel({ mode: 'edit', programme: p })}
                            data-testid={`testing-edit-${p.uid}`}>Edit</button>
                        )}
                        {isSubmittable(p) && (
                          <button type="button" disabled={busy === p.uid} className={buttonClass} onClick={() => submit(p)}
                            data-testid={`testing-submit-${p.uid}`}>Submit for HQ approval</button>
                        )}
                        <button type="button" className={ghostButtonClass} onClick={() => setPanel({ mode: 'open', programme: p })}
                          data-testid={`testing-open-${p.uid}`}>Applicants</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
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
